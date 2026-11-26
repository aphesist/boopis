//! One request line to one answer line (section 4.2 to 4.4 and 9), in this order: the envelope, the peer's verdict, the
//! version and the token (all three answered alike, `hx.host.unauthorized`), the verb (`hx.method_not_found`), the line's
//! size for that verb, the idempotency key, the parameters, the rate limit, then the run table (a repeated key answers the
//! first answer and acts once), the verb, and the audit line. Every refusal is decided before anything changes.
//!
//! The verbs that need the app (rooms, bots, sessions, `team.plan`) go to the host's [`Ops`]; `jobs.*` and `grant.redeem`
//! are answered here.

use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Instant;

use serde_json::{Value, json};
use subtle::ConstantTimeEq;

use crate::Refusal;
use crate::audit::{Audit, Entry, Outcome};
use crate::grants::Grants;
use crate::jobs::Jobs;
use crate::limits::Limits;
use crate::plans::{OPEN_PER_JOB, PlanStore};
use crate::protocol::{self, Request};
use crate::runtable::{RunTable, Seen};

/// One verb for the host to do, its parameters checked already.
#[derive(Debug, Clone, Copy)]
pub struct Call<'a> {
    /// The verb.
    pub op: &'a str,
    /// The idempotency key (present for every changing verb).
    pub key: Option<&'a str>,
    /// Answer `{would: …}` and change nothing.
    pub dry_run: bool,
    /// The parameters.
    pub params: &'a Value,
}

/// The future a verb answers with.
pub type OpFuture<'a> = Pin<Box<dyn Future<Output = Result<Value, Refusal>> + Send + 'a>>;

/// What the host does for the verbs that need the app: `team.plan`, `room.*`, `bot.*`, `session.stop`.
pub trait Ops: Send + Sync {
    /// Do `call`.
    fn call<'a>(&'a self, call: Call<'a>) -> OpFuture<'a>;
}

/// The channel's state: its token and its stores.
#[derive(Debug)]
pub struct Dispatcher {
    token: String,
    runs: RunTable,
    limits: Limits,
    audit: Audit,
    grants: Arc<Grants>,
    jobs: Jobs,
    plans: PlanStore,
}

impl Dispatcher {
    /// A dispatcher for a channel whose token is `token`, its files under `house` (`<app data>/house`), its audit trail at
    /// `audit`, and the owner grants the window mints in `grants`.
    #[must_use]
    pub fn new(token: String, house: &Path, audit: Audit, grants: Arc<Grants>) -> Self {
        Self {
            token,
            runs: RunTable::at(&house.join("ops.json")),
            limits: Limits::default(),
            audit,
            grants,
            jobs: Jobs::at(&house.join("jobs.jsonl")),
            plans: PlanStore::under(house),
        }
    }

    /// The jobs file.
    #[must_use]
    pub fn jobs(&self) -> &Jobs {
        &self.jobs
    }

    /// The plans folder.
    #[must_use]
    pub fn plans(&self) -> &PlanStore {
        &self.plans
    }

    /// Answer one request line. `admitted` is the peer check's verdict, taken before the line was read; `mono` and `now`
    /// (milliseconds since the epoch) are the clocks.
    pub async fn handle(
        &self,
        ops: &dyn Ops,
        line: &str,
        admitted: bool,
        mono: Instant,
        now: u64,
    ) -> String {
        let req = Request::parse(line.trim_end_matches(['\r', '\n']));
        let op_word = req
            .as_ref()
            .map(|r| r.op.as_str())
            .filter(|o| protocol::VERBS.contains(o))
            .unwrap_or("unknown");
        let entry = |outcome, code| Entry {
            op: op_word,
            target: req
                .as_ref()
                .map(|r| protocol::target(&r.op, &r.params))
                .unwrap_or_default(),
            job_id: req
                .as_ref()
                .and_then(|r| r.params.get("job_id").and_then(Value::as_str))
                .filter(|j| protocol::name_ok(j)),
            key: req.as_ref().and_then(|r| r.id.as_deref()),
            dry_run: req.as_ref().is_some_and(|r| r.dry_run),
            outcome,
            code,
        };
        let answer = match &req {
            None if admitted => Err((
                Refusal::new("hx.invalid_request", "That is not a host-ops request."),
                Outcome::Refused,
            )),
            None => Err((protocol::unauthorized(), Outcome::Refused)),
            Some(r) => self.answer(ops, r, line.len(), admitted, mono, now).await,
        };
        match answer {
            Ok(result) => {
                self.audit.write(&entry(Outcome::Ok, None), now);
                protocol::ok(&result)
            }
            Err((r, outcome)) => {
                self.audit.write(&entry(outcome, Some(r.code)), now);
                protocol::refused(&r)
            }
        }
    }

    #[allow(clippy::too_many_lines)] // the checks in their order, one place
    async fn answer(
        &self,
        ops: &dyn Ops,
        r: &Request,
        len: usize,
        admitted: bool,
        mono: Instant,
        now: u64,
    ) -> Result<Value, (Refusal, Outcome)> {
        let refuse = |x: Refusal| (x, Outcome::Refused);
        if !admitted || r.v != 1 || !bool::from(r.token.as_bytes().ct_eq(self.token.as_bytes())) {
            return Err(refuse(protocol::unauthorized()));
        }
        let Some(class) = protocol::class(&r.op) else {
            return Err(refuse(Refusal::new(
                "hx.method_not_found",
                "There is no such operation.",
            )));
        };
        if len > protocol::line_cap(&r.op) {
            return Err(refuse(Refusal::new(
                "hx.invalid_params",
                "The request is too long.",
            )));
        }
        let changes = protocol::changes(&r.op);
        let key = r.id.as_deref();
        if changes && key.is_none_or(|k| k.trim().is_empty() || k.len() > protocol::MAX_KEY) {
            return Err(refuse(Refusal::new(
                "hx.invalid_params",
                "A change needs an id (its idempotency key), at most 200 characters.",
            )));
        }
        protocol::check_params(&r.op, &r.params).map_err(refuse)?;
        if !self.limits.take(class, mono) {
            return Err(refuse(Refusal::new(
                "hx.host.rate_limited",
                "Too many requests. Wait a moment and try again.",
            )));
        }
        let job = r.params.get("job_id").and_then(Value::as_str);
        // The checks that read the host's own files.
        match r.op.as_str() {
            "bot.say" => {
                let session = r.params["session"].as_str().unwrap_or_default();
                let bot = r.params["bot"].as_str().unwrap_or_default();
                if session != "new" && !job.is_some_and(|j| self.jobs.owns_session(j, bot, session))
                {
                    return Err(refuse(Refusal::new(
                        "hx.invalid_params",
                        "A bot is given a message only in a session this job started. Use \"new\".",
                    )));
                }
            }
            "team.plan" if job.is_some_and(|j| self.plans.open_for_job(j, now) >= OPEN_PER_JOB) => {
                return Err(refuse(Refusal::new(
                    "hx.host.rate_limited",
                    "This job has 4 plans waiting for the owner. Wait for an answer first.",
                )));
            }
            _ => {}
        }
        match r.op.as_str() {
            "jobs.get" => return Ok(json!({"jobs": self.jobs.get(job)})),
            "jobs.put" if r.dry_run => return Ok(json!({"would": "put"})),
            "jobs.put" => {
                let line = &r.params["line"];
                return self
                    .jobs
                    .put(job.unwrap_or_default(), line, now)
                    .map(|j| json!({"job": j}))
                    .map_err(refuse);
            }
            "grant.redeem" if r.dry_run => return Ok(json!({"would": "redeem"})),
            "grant.redeem" => {
                let grant = r.params["grant"].as_str().unwrap_or_default();
                let purpose = r.params["purpose"].as_str().unwrap_or_default();
                return if self.grants.redeem(grant, purpose, now) {
                    Ok(json!({"ok": true}))
                } else {
                    Err(refuse(Refusal::new(
                        "hx.host.owner_grant_required",
                        "That needs the owner's permission, given in boopis just before. Ask the owner.",
                    )))
                };
            }
            _ => {}
        }
        let call = Call {
            op: &r.op,
            key,
            dry_run: r.dry_run,
            params: &r.params,
        };
        let kept_key = key.filter(|_| protocol::kept(&r.op) && !r.dry_run);
        let Some(k) = kept_key else {
            return ops.call(call).await.map_err(|x| (x, Outcome::Failed));
        };
        match self.runs.seen(k, &r.op, now).map_err(refuse)? {
            Seen::Done(first) => return Ok(first),
            Seen::Pending => {
                return Err(refuse(Refusal::new(
                    "hx.host.in_progress",
                    "A call with this key is still running, or stopped before it finished. Check before you try again.",
                )));
            }
            Seen::New => {}
        }
        if !self.runs.reserve(k, &r.op, now).map_err(refuse)? {
            return Err(refuse(Refusal::new(
                "hx.host.in_progress",
                "A call with this key is still running. Check before you try again.",
            )));
        }
        match ops.call(call).await {
            Ok(result) => {
                if let Some(j) = job {
                    self.note_started(j, &r.op, &r.params, &result, now);
                }
                if self.runs.finish(k, &r.op, &result, now).is_err() {
                    tracing::warn!(op = %r.op, "the host-ops run table could not keep an answer; its key stays pending");
                }
                Ok(result)
            }
            Err(e) => {
                self.runs.release(k, now);
                Err((e, Outcome::Failed))
            }
        }
    }

    fn note_started(&self, job: &str, op: &str, p: &Value, result: &Value, now: u64) {
        let what = match op {
            "bot.say" | "bot.run" => {
                json!({"bot": p["bot"], "session_id": result["session_id"], "run_id": result.get("run_id")})
            }
            "room.run" => json!({"room_id": p["room_id"], "run_id": result["run_id"]}),
            _ => return,
        };
        if self.jobs.job(job).is_none() {
            return; // a job the plugin never opened has no file to note in
        }
        if self.jobs.started(job, &what, now).is_err() {
            tracing::warn!(op, "the host could not note what it started for a job");
        }
    }
}
