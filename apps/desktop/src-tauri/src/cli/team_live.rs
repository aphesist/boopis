//! The live [`Backend`] of `team apply`: the engine of this machine, reached the way the app reaches it.
//!
//! What it asks, and where each answer comes from: the bots are the folders under `profiles/` (`bots::Layout`), described by
//! `profiles.describe` and the plugin's `bots.read`; a bot's servers by `connectors::ops::GatewayMcp` on the bot's own
//! link; rooms by `groups.*` and boopis's `rooms.json`; boards by the engine's `kanban boards` commands; jobs by
//! `cron.manage` on the bot's own link, with the whole prompt read from the bot's `cron/jobs.json` (the list gives 100
//! characters). Bot creation is the Bots form's path: `profiles.create`, `bots.write`, then `bots::engine::Service::prepare`.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::headless::Host;
use crate::bots::{self, Layout};
use crate::connectors::ops::{GatewayMcp, McpOps};
use crate::error::{Error, Result};
use crate::rooms::settings::RoomSettings;
use crate::rooms::{self, NewRoom, Rpc, Seat};
use crate::team::apply::Backend;
use crate::team::plan::{BoardNow, BotNow, ConnectorNow, Current, JobNow, Op, RoomNow};
use crate::team::spec::Look;

/// The approvals a new bot starts with: it asks before every kind of thing (the Bots form's `OWN_SETTINGS`).
const APPROVALS: [&str; 6] = ["deploys", "push", "network", "spend", "people", "outside"];

/// The live engine.
pub struct Live<'a> {
    host: &'a Host,
    layout: Layout,
    service: Arc<bots::engine::Service>,
    settings: PathBuf,
}

impl<'a> Live<'a> {
    /// The live backend over `host`; `carried` are the plugins the runtime carries (`runtime.json`).
    #[must_use]
    pub fn new(host: &'a Host, carried: &[String]) -> Self {
        Self {
            layout: Layout::new(host.root().to_path_buf(), carried),
            service: Arc::new(bots::engine::Service::new(host.supervisor().clone())),
            settings: host.data_dir().join(crate::rooms::settings::FILE),
            host,
        }
    }

    fn mcp(&self, bot: &str) -> Result<GatewayMcp> {
        let home = self
            .host
            .supervisor()
            .environment()
            .profile_home(Some(bot))?;
        Ok(GatewayMcp::new(self.host.supervisor().clone(), home))
    }

    async fn describe(&self, name: &str) -> Result<Value> {
        self.host
            .rpc()
            .call("profiles.describe", json!({"name": name}))
            .await
    }

    /// A model as the file names it, as the provider and model the engine takes.
    async fn resolve_model(&self, label: &str) -> Result<(String, String)> {
        if let Some((p, m)) = label.split_once('/') {
            return Ok((p.to_owned(), m.to_owned()));
        }
        Ok((self.default_provider().await, label.to_owned()))
    }

    async fn default_provider(&self) -> String {
        match self
            .host
            .engine_cli(&["config", "get", "--json", "model.provider"])
            .await
        {
            Ok(o) if o.code == 0 => serde_json::from_str::<Value>(o.stdout.trim())
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default(),
            _ => String::new(),
        }
    }

    async fn plugin(&self, method: &str, params: Value) -> Result<Value> {
        self.host
            .rpc()
            .call(&format!("plugin.boopis.{method}"), params)
            .await
    }

    async fn kanban(&self, args: &[&str]) -> Result<String> {
        let mut full = vec!["kanban"];
        full.extend_from_slice(args);
        let out = self.host.engine_cli(&full).await?;
        if out.code != 0 {
            let why = out
                .stderr
                .lines()
                .chain(out.stdout.lines())
                .rfind(|l| !l.trim().is_empty())
                .unwrap_or("it failed");
            return Err(Error::Unavailable(format!(
                "the board command failed: {why}"
            )));
        }
        Ok(out.stdout)
    }

    async fn jobs_of(&self, bot: &str) -> Result<Vec<JobNow>> {
        let rpc = self.host.rpc_for(bot)?;
        let res = rpc
            .call(
                "cron.manage",
                json!({"action": "list", "include_disabled": true}),
            )
            .await?;
        if let Some(e) = res.get("error").and_then(Value::as_str) {
            return Err(Error::Unavailable(e.to_owned()));
        }
        let whole = whole_prompts(
            &self
                .host
                .supervisor()
                .environment()
                .profile_home(Some(bot))?,
        );
        Ok(res
            .get("jobs")
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .map(|j| {
                        let id = text(j, "job_id");
                        let full = whole.get(&id);
                        JobNow {
                            name: text(j, "name"),
                            schedule: text(j, "schedule"),
                            prompt: full.cloned().unwrap_or_else(|| text(j, "prompt_preview")),
                            prompt_whole: full.is_some(),
                            deliver: j
                                .get("deliver")
                                .and_then(Value::as_str)
                                .unwrap_or("local")
                                .to_owned(),
                            paused: j.get("enabled").and_then(Value::as_bool) == Some(false),
                            id,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    async fn job_id(&self, bot: &str, name: &str) -> Result<String> {
        self.jobs_of(bot)
            .await?
            .into_iter()
            .find(|j| j.name.trim() == name.trim())
            .map(|j| j.id)
            .ok_or_else(|| Error::InvalidInput(format!("{bot} has no job called {name:?}")))
    }

    async fn cron(&self, bot: &str, params: Value) -> Result<()> {
        let res = self.host.rpc_for(bot)?.call("cron.manage", params).await?;
        match res.get("error").and_then(Value::as_str) {
            Some(e) => Err(Error::Unavailable(e.to_owned())),
            None => Ok(()),
        }
    }

    async fn set_bot_record(
        &self,
        name: &str,
        look: Option<&Look>,
        governed: Option<bool>,
    ) -> Result<()> {
        let mut body = json!({"name": name});
        if let Some(l) = look {
            body["look"] = json!({"shape": l.shape, "color": l.color});
        }
        if let Some(g) = governed {
            body["settings"] = json!({"gov": if g { "governed" } else { "ungoverned" }});
        }
        self.plugin("bots.write", body).await.map(|_| ())
    }

    async fn prepare(&self, name: &str, fresh: bool) -> Result<()> {
        let done = self.service.prepare(&self.layout, name, fresh).await?;
        if done.problems.is_empty() {
            Ok(())
        } else {
            Err(Error::Bots(
                "hx.bots.prepare_failed",
                done.problems.join("; "),
            ))
        }
    }
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_owned()
}

/// The whole prompt of each job of a home, from its `cron/jobs.json` (read only; the engine owns the file). Empty when the
/// file is not there or is not a shape this reads.
fn whole_prompts(home: &std::path::Path) -> BTreeMap<String, String> {
    let Ok(raw) = std::fs::read_to_string(home.join("cron").join("jobs.json")) else {
        return BTreeMap::new();
    };
    let Ok(v) = serde_json::from_str::<Value>(&raw) else {
        return BTreeMap::new();
    };
    let rows = v
        .get("jobs")
        .and_then(Value::as_array)
        .or_else(|| v.as_array());
    rows.map(|rows| {
        rows.iter()
            .filter_map(|j| {
                Some((
                    j.get("id")?.as_str()?.to_owned(),
                    j.get("prompt")?.as_str()?.to_owned(),
                ))
            })
            .collect()
    })
    .unwrap_or_default()
}

fn expand(path: &str) -> String {
    match (path.strip_prefix("~/"), dirs::home_dir()) {
        (Some(rest), Some(h)) => h.join(rest).display().to_string(),
        (None, Some(h)) if path == "~" => h.display().to_string(),
        _ => path.to_owned(),
    }
}

fn contract(path: &str) -> String {
    match dirs::home_dir() {
        Some(h) => std::path::Path::new(path)
            .strip_prefix(&h)
            .map_or_else(|_| path.to_owned(), |rest| format!("~/{}", rest.display())),
        None => path.to_owned(),
    }
}

#[async_trait]
impl Backend for Live<'_> {
    #[allow(clippy::too_many_lines)] // one read per kind of thing
    async fn read(&self) -> Result<Current> {
        let mut now = Current {
            default_provider: self.default_provider().await,
            ..Current::default()
        };
        let records = self
            .plugin("bots.read", json!({}))
            .await
            .unwrap_or(Value::Null);
        let record_of = |name: &str| -> Option<Value> {
            records
                .get("bots")
                .and_then(Value::as_array)?
                .iter()
                .find(|b| b.get("name").and_then(Value::as_str) == Some(name))
                .and_then(|b| b.get("record").cloned())
        };
        for name in self.layout.bots() {
            let d = self.describe(&name).await?;
            let (provider, model) = bots::model_of(d.get("model"));
            let rec = record_of(&name);
            let look = rec.as_ref().and_then(|r| r.get("look")).and_then(|l| {
                Some(Look {
                    shape: l.get("shape")?.as_str()?.to_owned(),
                    color: l.get("color")?.as_str()?.to_owned(),
                })
            });
            let governed = rec
                .as_ref()
                .and_then(|r| r.get("settings"))
                .and_then(|s| s.get("gov"))
                .and_then(Value::as_str)
                == Some("governed");
            let skills = d
                .get("skills")
                .and_then(Value::as_array)
                .map(|s| {
                    s.iter()
                        .map(|e| {
                            (
                                text(e, "name"),
                                e.get("enabled").and_then(Value::as_bool) != Some(false),
                            )
                        })
                        .collect()
                })
                .unwrap_or_default();
            let connectors = match self.mcp(&name)?.list().await {
                Ok(list) => list
                    .into_iter()
                    .filter(|c| c.plugin.is_none())
                    .map(|c| ConnectorNow {
                        name: c.name,
                        command: c.command,
                        args: c.args,
                        url: c.url,
                        env: c.env,
                    })
                    .collect(),
                Err(e) => {
                    tracing::debug!(error = %e, bot = %name, "a bot's connectors could not be read");
                    Vec::new()
                }
            };
            now.bots.insert(
                name.clone(),
                BotNow {
                    role: text(&d, "description"),
                    soul: text(&d, "soul"),
                    provider,
                    model,
                    look,
                    governed,
                    max_turns: self.service.run_limit(&self.layout, &name).unwrap_or_else(|e| {
                        tracing::debug!(error = %e, bot = %name, "a bot's cap on turns could not be read");
                        None
                    }),
                    skills,
                    connectors,
                    toolsets: d
                        .get("toolsets")
                        .and_then(Value::as_array)
                        .map(|s| {
                            s.iter()
                                .map(|e| (text(e, "name"), e.get("enabled").and_then(Value::as_bool) == Some(true)))
                                .collect()
                        })
                        .unwrap_or_default(),
                },
            );
            now.jobs
                .insert(name.clone(), self.jobs_of(&name).await.unwrap_or_default());
        }
        now.baseline_skills = self.describe("default").await.ok().and_then(|d| {
            d.get("skills")
                .and_then(Value::as_array)
                .map(|s| s.iter().map(|e| text(e, "name")).collect())
        });
        let kept = RoomSettings::load(&self.settings).unwrap_or_default();
        for r in rooms::list(&self.host.rpc(), false).await? {
            let state = rooms::state(&self.host.rpc(), &r.id).await?;
            now.rooms.push(RoomNow {
                members: r.members.iter().map(|m| m.id.clone()).collect(),
                lead: if state.context.routing == "lead" {
                    state.context.lead
                } else {
                    String::new()
                },
                purpose: state.context.purpose,
                max_rounds: kept.max_rounds(&r.id),
                id: r.id,
                name: r.name,
            });
        }
        let boards = self
            .kanban(&["boards", "list", "--json"])
            .await
            .unwrap_or_default();
        if let Ok(Value::Array(rows)) = serde_json::from_str::<Value>(boards.trim()) {
            for b in rows {
                let slug = text(&b, "slug");
                if slug.is_empty() || b.get("archived").and_then(Value::as_bool) == Some(true) {
                    continue;
                }
                now.boards.insert(
                    slug,
                    BoardNow {
                        name: text(&b, "name"),
                        workdir: b
                            .get("default_workdir")
                            .and_then(Value::as_str)
                            .filter(|w| !w.is_empty())
                            .map(contract),
                    },
                );
            }
        }
        Ok(now)
    }

    #[allow(clippy::too_many_lines)] // one arm per operation
    async fn run(&self, op: &Op) -> Result<()> {
        match op {
            Op::CreateBot { name, bot } => {
                let mut params = json!({"name": name, "description": bot.role.clone().unwrap_or_default().trim(), "no_alias": true});
                if let Some(s) = &bot.soul_text
                    && !s.trim().is_empty()
                {
                    params["soul"] = json!(format!("{}\n", s.trim()));
                }
                let mut provider = String::new();
                let mut model = String::new();
                if let Some(m) = &bot.model {
                    (provider, model) = self.resolve_model(m).await?;
                    params["provider"] = json!(provider);
                    params["model"] = json!(model);
                }
                self.host.rpc().call("profiles.create", params).await?;
                let gov = bot.governed == Some(true);
                if gov && !crate::frontier::is_frontier(&provider, &model) {
                    return Err(Error::Bots(
                        "hx.bots.not_governable",
                        format!(
                            "{name} was made, but governed mode runs on a frontier model and {model:?} is not one, so it stays ungoverned"
                        ),
                    ));
                }
                let mut body = json!({"name": name, "settings": {"gov": if gov { "governed" } else { "ungoverned" }, "cap": "0.60", "workspace": "worktree"},
                    "approvals": APPROVALS.iter().map(|a| ((*a).to_owned(), json!(true))).collect::<serde_json::Map<_, _>>()});
                if let Some(l) = &bot.look {
                    body["look"] = json!({"shape": l.shape, "color": l.color});
                }
                self.plugin("bots.write", body).await?;
                self.prepare(name, true).await?;
                if let Some(n) = bot.max_turns {
                    self.service
                        .set_run_limit(&self.layout, name, Some(n))
                        .await?;
                }
                Ok(())
            }
            Op::UpdateBot {
                name,
                role,
                soul,
                model,
                look,
                governed,
                max_turns,
            } => {
                let mut params = json!({"name": name});
                if let Some(r) = role {
                    params["description"] = json!(r);
                }
                if let Some(s) = soul {
                    params["soul"] = json!(format!("{}\n", s.trim()));
                }
                let mut next = None;
                if let Some(m) = model {
                    let (p, mo) = self.resolve_model(m).await?;
                    params["provider"] = json!(p);
                    params["model"] = json!(mo);
                    next = Some((p, mo));
                }
                if let Some(true) = governed {
                    let (p, m) = match next.clone() {
                        Some(x) => x,
                        None => bots::model_of(self.describe(name).await?.get("model")),
                    };
                    if !crate::frontier::is_frontier(&p, &m) {
                        return Err(Error::Bots(
                            "hx.bots.not_governable",
                            format!("governed mode runs on a frontier model, and {m:?} is not one"),
                        ));
                    }
                }
                if params.as_object().is_some_and(|o| o.len() > 1) {
                    let res = self.host.rpc().call("profiles.configure", params).await?;
                    if res.get("confirm_required").and_then(Value::as_bool) == Some(true) {
                        return Err(Error::Unavailable(format!(
                            "the model {} needs your confirmation: change it in the app's Bots page once",
                            model.clone().unwrap_or_default()
                        )));
                    }
                }
                if look.is_some() || governed.is_some() {
                    self.set_bot_record(name, look.as_ref(), *governed).await?;
                }
                if model.is_some() || governed.is_some() {
                    self.prepare(name, false).await?;
                }
                if let Some(cap) = max_turns {
                    self.service
                        .set_run_limit(&self.layout, name, cap.kept())
                        .await?;
                }
                Ok(())
            }
            Op::EnableSkills { bot, skills } => {
                let d = self.describe(bot).await?;
                let off: Vec<String> = d
                    .get("skills")
                    .and_then(Value::as_array)
                    .map(|s| {
                        s.iter()
                            .filter(|e| e.get("enabled").and_then(Value::as_bool) == Some(false))
                            .map(|e| text(e, "name"))
                            .filter(|n| !skills.contains(n))
                            .collect()
                    })
                    .unwrap_or_default();
                self.host
                    .rpc()
                    .call(
                        "profiles.configure",
                        json!({"name": bot, "disabled_skills": off}),
                    )
                    .await
                    .map(|_| ())
            }
            Op::SetToolsets { bot, on, off } => {
                self.plugin("bots.toolsets", json!({"name": bot, "on": on, "off": off}))
                    .await?;
                // the team file's list is the owner's own: boopis does not apply its defaults to this bot again
                bots::toolsets::chosen(&self.layout.root, bot)
            }
            Op::AddConnector { bot, connector } => {
                let config = if let Some(u) = &connector.url {
                    json!({"url": u})
                } else {
                    let mut c = json!({"command": connector.command, "args": connector.args});
                    if !connector.env.is_empty() {
                        c["env"] = json!(connector.env);
                    }
                    c
                };
                self.mcp(bot)?.add(&connector.name, &config).await
            }
            Op::RemoveConnector { bot, name } => self.mcp(bot)?.remove(name).await,
            Op::CreateRoom {
                name,
                id,
                members,
                lead,
                purpose,
                max_rounds,
            } => {
                let new = NewRoom {
                    id: Some(id.clone()),
                    name: name.clone(),
                    seats: members
                        .iter()
                        .map(|b| Seat {
                            bot: b.clone(),
                            display: b.clone(),
                        })
                        .collect(),
                    lead: lead.clone(),
                    purpose: purpose.clone(),
                };
                let room = rooms::create(&self.host.rpc(), &new).await?;
                if let Some(n) = max_rounds {
                    let mut kept = RoomSettings::load(&self.settings)?;
                    kept.set_max_rounds(&room.id, Some(*n))?;
                    kept.save(&self.settings)?;
                }
                Ok(())
            }
            Op::SetRoomContext { id, lead, purpose } => {
                let rpc = self.host.rpc();
                let mut ctx = rooms::state(&rpc, id).await?.context;
                ctx.purpose.clone_from(purpose);
                ctx.lead.clone_from(lead);
                if lead.is_empty() { "everyone" } else { "lead" }.clone_into(&mut ctx.routing);
                rooms::set_context(&rpc, id, &ctx).await
            }
            Op::SetMaxRounds { id, max_rounds } => {
                let mut kept = RoomSettings::load(&self.settings)?;
                kept.set_max_rounds(id, *max_rounds)?;
                kept.save(&self.settings)
            }
            Op::CreateBoard {
                slug,
                name,
                workdir,
            } => {
                let mut args = vec!["boards", "create", slug.as_str()];
                if let Some(n) = name {
                    args.extend(["--name", n.as_str()]);
                }
                let dir = workdir.as_deref().map(expand);
                if let Some(d) = &dir {
                    args.extend(["--default-workdir", d.as_str()]);
                }
                self.kanban(&args).await.map(|_| ())
            }
            Op::UpdateBoard {
                slug,
                name,
                workdir,
            } => {
                if let Some(n) = name {
                    self.kanban(&["boards", "rename", slug, n]).await?;
                }
                if let Some(w) = workdir {
                    self.kanban(&["boards", "set-default-workdir", slug, &expand(w)])
                        .await?;
                }
                Ok(())
            }
            Op::AddJob { bot, job, deliver } => {
                let mut p = json!({"action": "add", "name": job.name, "schedule": job.schedule, "prompt": job.prompt.clone().unwrap_or_default()});
                if let Some(d) = deliver {
                    p["deliver"] = json!(d);
                }
                self.cron(bot, p).await
            }
            Op::RemoveJob { bot, id } => {
                self.cron(bot, json!({"action": "remove", "name": id}))
                    .await
            }
            Op::SetJobPaused { bot, name, paused } => {
                let id = self.job_id(bot, name).await?;
                self.cron(
                    bot,
                    json!({"action": if *paused { "pause" } else { "resume" }, "name": id}),
                )
                .await
            }
            Op::ArchiveBot { name } => {
                let running: Vec<String> = self
                    .jobs_of(name)
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|j| !j.paused)
                    .map(|j| j.id)
                    .collect();
                self.plugin(
                    "bots.archive",
                    json!({"name": name, "paused_jobs": running}),
                )
                .await?;
                self.service
                    .release(self.host.root(), name)
                    .await
                    .map(|_| ())
            }
            Op::DisbandRoom { id } => self
                .host
                .rpc()
                .call(
                    "groups.disband",
                    json!({"room_id": id, "cancel_id": rooms::new_event_id("disband")}),
                )
                .await
                .map(|_| ()),
            Op::ArchiveBoard { slug } => self.kanban(&["boards", "rm", slug]).await.map(|_| ()),
        }
    }

    async fn missing_skills(&self, bot: &str, wanted: &[String]) -> Result<Vec<String>> {
        let d = self.describe(bot).await?;
        let have: Vec<String> = d
            .get("skills")
            .and_then(Value::as_array)
            .map(|s| s.iter().map(|e| text(e, "name")).collect())
            .unwrap_or_default();
        Ok(wanted
            .iter()
            .filter(|w| !have.contains(w))
            .cloned()
            .collect())
    }
}
