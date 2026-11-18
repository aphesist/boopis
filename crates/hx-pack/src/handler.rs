//! The `pack.*` methods for the `hx` dispatcher.
//!
//! The engine is blocking, so every call runs on the blocking pool with a [`Control`] built
//! from the request's cancellation token, a deadline and the shared [`WalkCache`]. Pack never
//! changes anything, so cancelling is always allowed and always truthful: a cancelled call
//! answers `hx.cancelled`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use hx_proto::method::{self, Namespace};
use hx_proto::registry::{BoxFuture, CallContext, Handler, HandlerResult, parse_params, to_result};
use hx_proto::schema::SchemaBuilder;
use hx_proto::{AppError, codes};
use serde_json::Value;

use crate::bundle::{BundleRequest, BundleResponse, handle_bundle_with};
use crate::cache::WalkCache;
use crate::languages::Registry;
use crate::outline::{OutlineRequest, OutlineResponse, handle_outline_with};
use crate::read::{ReadRequest, ReadResponse, handle_read};
use crate::search::{SearchRequest, SearchResponse, handle_search_with};
use crate::status::{StatusRequest, StatusResponse, handle_status};
use crate::symbol::{SymbolRequest, SymbolResponse, handle_symbol_with};
use crate::types::Control;

/// A call that has not finished after this long is answered `hx.pack.timeout`.
pub const DEFAULT_DEADLINE: Duration = Duration::from_mins(1);

const METHODS: &[&str] = &[
    method::PACK_SEARCH,
    method::PACK_READ,
    method::PACK_SYMBOL,
    method::PACK_OUTLINE,
    method::PACK_STATUS,
    method::PACK_BUNDLE,
];

/// Serves `pack.search`, `pack.read`, `pack.symbol`, `pack.outline`, `pack.status` and
/// `pack.bundle`.
#[derive(Debug, Clone)]
pub struct PackHandler {
    cache: Arc<WalkCache>,
    deadline: Duration,
}

impl PackHandler {
    /// A handler that serves whole-tree walks from `cache`. The caller keeps a clone of the
    /// `Arc` to invalidate it after workspace changes.
    #[must_use]
    pub fn new(cache: Arc<WalkCache>) -> Self {
        Self {
            cache,
            deadline: DEFAULT_DEADLINE,
        }
    }

    /// Changes the per-call deadline.
    #[must_use]
    pub fn with_deadline(mut self, deadline: Duration) -> Self {
        self.deadline = deadline;
        self
    }
}

/// Adds the `pack.*` methods to the schema.
pub fn add_schema(b: &mut SchemaBuilder) {
    b.method::<SearchRequest, SearchResponse>(method::PACK_SEARCH);
    b.method::<ReadRequest, ReadResponse>(method::PACK_READ);
    b.method::<SymbolRequest, SymbolResponse>(method::PACK_SYMBOL);
    b.method::<OutlineRequest, OutlineResponse>(method::PACK_OUTLINE);
    b.method::<StatusRequest, StatusResponse>(method::PACK_STATUS);
    b.method::<BundleRequest, BundleResponse>(method::PACK_BUNDLE);
}

fn run(method: &str, params: Value, ctl: &Control) -> HandlerResult {
    match method {
        method::PACK_SEARCH => to_result(&handle_search_with(&parse_params(params)?, ctl)?),
        method::PACK_READ => to_result(&handle_read(&parse_params(params)?)?),
        method::PACK_SYMBOL => to_result(&handle_symbol_with(&parse_params(params)?, ctl)?),
        method::PACK_OUTLINE => to_result(&handle_outline_with(&parse_params(params)?, ctl)?),
        method::PACK_STATUS => to_result(&handle_status(&parse_params(params)?)?),
        method::PACK_BUNDLE => to_result(&handle_bundle_with(&parse_params(params)?, ctl)?),
        other => Err(AppError::new(
            codes::HX_METHOD_NOT_FOUND,
            format!("no handler for `{other}`"),
        )),
    }
}

impl Handler for PackHandler {
    fn namespace(&self) -> Namespace {
        Namespace::Pack
    }

    fn methods(&self) -> &'static [&'static str] {
        METHODS
    }

    fn capabilities(&self) -> Vec<String> {
        let mut caps: Vec<String> = [
            "pack.search",
            "pack.read",
            "pack.symbol",
            "pack.outline",
            "pack.status",
            "pack.bundle",
            "pack.redact",
            "pack.never_pack",
            "pack.walk_cache",
        ]
        .map(str::to_owned)
        .to_vec();
        if let Ok(registry) = Registry::builtin() {
            caps.extend(
                registry
                    .languages()
                    .map(|l| format!("pack.lang.{}", l.id())),
            );
        }
        caps
    }

    fn call<'a>(
        &'a self,
        method: &'a str,
        params: Value,
        ctx: CallContext,
    ) -> BoxFuture<'a, HandlerResult> {
        let ctl = Control::none()
            .with_cancel(ctx.cancel)
            .with_deadline(Instant::now() + self.deadline)
            .with_cache(Arc::clone(&self.cache));
        let method = method.to_owned();
        Box::pin(async move {
            tokio::task::spawn_blocking(move || run(&method, params, &ctl))
                .await
                .unwrap_or_else(|e| Err(AppError::internal(format!("the pack task failed: {e}"))))
        })
    }
}
