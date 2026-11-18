//! `pack.bundle`: many requests, one call, one byte budget.
//!
//! The budget is shared by water-filling. Every item starts with an equal
//! share. An item that finishes under its share gives the unused bytes back,
//! and the leftover is split among the items the budget cut short, which are
//! then run again with their larger share. A few rounds settle it, the result
//! is deterministic, and the total never passes `max_bytes`. The response lists
//! every item that is still truncated and why.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::{Error, ErrorBody, Result};
use crate::outline::{OutlineParams, OutlineResponse, outline};
use crate::read::{ReadParams, ReadResponse, read};
use crate::root::Root;
use crate::search::{SearchParams, SearchResponse, search};
use crate::status::{StatusParams, StatusResponse, status};
use crate::symbol::{SymbolParams, SymbolResponse, symbol};
use crate::types::{Control, Truncation};

/// Most requests in one bundle.
pub const MAX_ITEMS: usize = 32;
/// Default bundle budget in bytes.
pub const DEFAULT_BUNDLE_BYTES: usize = 128 * 1024;
/// Rounds of redistribution after the first pass.
const REFILL_ROUNDS: usize = 4;
/// Leftover below this is not worth another round.
const MIN_REFILL: usize = 256;

/// One request of a bundle. The root is the bundle's.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "method", content = "params")]
pub enum BundleItem {
    /// `pack.search`.
    #[serde(rename = "pack.search")]
    Search(SearchParams),
    /// `pack.read`.
    #[serde(rename = "pack.read")]
    Read(ReadParams),
    /// `pack.symbol`.
    #[serde(rename = "pack.symbol")]
    Symbol(SymbolParams),
    /// `pack.outline`.
    #[serde(rename = "pack.outline")]
    Outline(OutlineParams),
    /// `pack.status`.
    #[serde(rename = "pack.status")]
    Status(StatusParams),
}

impl BundleItem {
    /// The wire method name.
    #[must_use]
    pub fn method(&self) -> &'static str {
        match self {
            Self::Search(_) => "pack.search",
            Self::Read(_) => "pack.read",
            Self::Symbol(_) => "pack.symbol",
            Self::Outline(_) => "pack.outline",
            Self::Status(_) => "pack.status",
        }
    }

    /// The item's own cap on its output, if it sets one.
    fn cap(&self) -> usize {
        match self {
            Self::Search(p) => p.max_bytes,
            Self::Read(p) => p.max_bytes,
            Self::Symbol(p) => p.max_bytes,
            Self::Outline(p) => p.max_bytes,
            Self::Status(_) => None,
        }
        .unwrap_or(usize::MAX)
    }

    /// A copy whose budget is `bytes`.
    fn with_budget(&self, bytes: usize) -> Self {
        let mut item = self.clone();
        match &mut item {
            Self::Search(p) => p.max_bytes = Some(bytes),
            Self::Read(p) => p.max_bytes = Some(bytes),
            Self::Symbol(p) => p.max_bytes = Some(bytes),
            Self::Outline(p) => p.max_bytes = Some(bytes),
            Self::Status(_) => {}
        }
        item
    }
}

fn d_bytes() -> usize {
    DEFAULT_BUNDLE_BYTES
}

/// The parameters of `pack.bundle` apart from the root.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct BundleParams {
    /// Up to 32 requests, run in order. Their results come back in the same order.
    pub requests: Vec<BundleItem>,
    /// The budget for all results together (default 131072).
    #[serde(default = "d_bytes")]
    pub max_bytes: usize,
}

/// The request of `pack.bundle`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct BundleRequest {
    /// The root directory, shared by every item.
    pub root: String,
    /// The rest of the parameters.
    #[serde(flatten)]
    pub params: BundleParams,
}

/// The result of one item, by method.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum ItemOutput {
    /// Result of `pack.search`.
    Search(SearchResponse),
    /// Result of `pack.read`.
    Read(ReadResponse),
    /// Result of `pack.symbol`.
    Symbol(SymbolResponse),
    /// Result of `pack.outline`.
    Outline(OutlineResponse),
    /// Result of `pack.status`.
    Status(StatusResponse),
}

/// One item's outcome.
#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct BundleEntry {
    /// Position in `requests`.
    pub index: usize,
    /// The method that ran.
    pub method: String,
    /// False when the item failed; see `error`.
    pub ok: bool,
    /// The result, when `ok`.
    pub result: Option<ItemOutput>,
    /// The failure, when not `ok`. The other items are unaffected.
    pub error: Option<ErrorBody>,
    /// Bytes this item used.
    pub bytes: usize,
}

/// An item that did not finish, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
pub struct BundleTruncation {
    /// Position in `requests`.
    pub index: usize,
    /// The method of that item.
    pub method: String,
    /// Why it is incomplete.
    pub reasons: Vec<Truncation>,
}

/// The response of `pack.bundle`.
#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct BundleResponse {
    /// One entry per request, in order.
    pub results: Vec<BundleEntry>,
    /// Items that are incomplete. Empty when everything fit.
    pub truncated: Vec<BundleTruncation>,
    /// Bytes used by all items together; never more than `max_bytes`.
    pub bytes: usize,
    /// The budget the call ran with.
    pub max_bytes: usize,
}

struct Ran {
    output: Result<ItemOutput>,
    bytes: usize,
    truncated: Vec<Truncation>,
}

fn run_item(root: &Root, item: &BundleItem, budget: usize, ctl: &Control) -> Ran {
    let item = item.with_budget(budget);
    let (output, bytes, truncated) = match &item {
        BundleItem::Search(p) => unpack(
            search(root, p, ctl),
            |r| (r.bytes, r.truncated.clone()),
            ItemOutput::Search,
        ),
        BundleItem::Read(p) => unpack(
            read(root, p),
            |r| (r.bytes, r.truncated.clone()),
            ItemOutput::Read,
        ),
        BundleItem::Symbol(p) => unpack(
            symbol(root, p, ctl),
            |r| (r.bytes, r.truncated.clone()),
            ItemOutput::Symbol,
        ),
        BundleItem::Outline(p) => unpack(
            outline(root, p, ctl),
            |r| (r.bytes, r.truncated.clone()),
            ItemOutput::Outline,
        ),
        BundleItem::Status(p) => unpack(
            status(root, p),
            |r| (r.bytes, r.truncated.clone()),
            ItemOutput::Status,
        ),
    };
    Ran {
        output,
        bytes,
        truncated,
    }
}

fn unpack<R>(
    res: Result<R>,
    measure: impl Fn(&R) -> (usize, Vec<Truncation>),
    wrap: impl Fn(R) -> ItemOutput,
) -> (Result<ItemOutput>, usize, Vec<Truncation>) {
    match res {
        Ok(r) => {
            let (b, t) = measure(&r);
            (Ok(wrap(r)), b, t)
        }
        Err(e) => (Err(e), 0, Vec::new()),
    }
}

/// Whether a bigger share could change this item's result.
fn hungry(item: &BundleItem, ran: &Ran, share: usize) -> bool {
    ran.output.is_ok() && ran.truncated.contains(&Truncation::MaxBytes) && share < item.cap()
}

/// Runs `pack.bundle` against an open root.
///
/// # Errors
/// [`Error::InvalidRequest`] for an empty or oversized list; cancellation and
/// timeouts abort the whole call. Failures of single items are reported in
/// their entries, not here.
pub fn bundle(root: &Root, p: &BundleParams, ctl: &Control) -> Result<BundleResponse> {
    let n = p.requests.len();
    if n == 0 || n > MAX_ITEMS {
        return Err(Error::InvalidRequest(format!(
            "requests must hold 1..={MAX_ITEMS} items"
        )));
    }
    if p.max_bytes == 0 {
        return Err(Error::InvalidRequest("max_bytes must be positive".into()));
    }
    let mut shares: Vec<usize> = p
        .requests
        .iter()
        .map(|it| (p.max_bytes / n).min(it.cap()))
        .collect();
    let mut ran: Vec<Ran> = Vec::with_capacity(n);
    for (item, &share) in p.requests.iter().zip(&shares) {
        ctl.check()?;
        ran.push(run_item(root, item, share, ctl));
    }
    for _ in 0..REFILL_ROUNDS {
        // Items that finished under their share give the rest back.
        for (i, r) in ran.iter().enumerate() {
            if !hungry(&p.requests[i], r, shares[i]) {
                shares[i] = shares[i].min(r.bytes);
            }
        }
        let allocated: usize = shares.iter().sum();
        let hungry_idx: Vec<usize> = (0..n)
            .filter(|&i| hungry(&p.requests[i], &ran[i], shares[i]))
            .collect();
        let leftover = p.max_bytes.saturating_sub(allocated);
        if hungry_idx.is_empty() || leftover < MIN_REFILL {
            break;
        }
        let extra = leftover / hungry_idx.len();
        for &i in &hungry_idx {
            shares[i] = (shares[i] + extra).min(p.requests[i].cap());
            ctl.check()?;
            ran[i] = run_item(root, &p.requests[i], shares[i], ctl);
        }
    }
    let mut resp = BundleResponse {
        results: Vec::with_capacity(n),
        truncated: Vec::new(),
        bytes: 0,
        max_bytes: p.max_bytes,
    };
    for (index, (item, r)) in p.requests.iter().zip(ran).enumerate() {
        let method = item.method().to_owned();
        resp.bytes += r.bytes;
        if !r.truncated.is_empty() {
            resp.truncated.push(BundleTruncation {
                index,
                method: method.clone(),
                reasons: r.truncated.clone(),
            });
        }
        let (ok, result, error) = match r.output {
            Ok(out) => (true, Some(out), None),
            Err(e @ (Error::Cancelled | Error::Timeout)) => return Err(e),
            Err(e) => (false, None, Some(e.to_body())),
        };
        resp.results.push(BundleEntry {
            index,
            method,
            ok,
            result,
            error,
            bytes: r.bytes,
        });
    }
    Ok(resp)
}

/// `pack.bundle`: the entry point a dispatcher calls.
///
/// # Errors
/// See [`bundle`].
pub fn handle_bundle(req: &BundleRequest) -> Result<BundleResponse> {
    handle_bundle_with(req, &Control::none())
}

/// [`handle_bundle`] with cancellation and a deadline.
///
/// # Errors
/// See [`bundle`].
pub fn handle_bundle_with(req: &BundleRequest, ctl: &Control) -> Result<BundleResponse> {
    bundle(&Root::open(&req.root)?, &req.params, ctl)
}
