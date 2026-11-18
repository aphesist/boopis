//! The `txn.*` handler registered with the dispatcher.

use hx_proto::method::{self, Namespace};
use hx_proto::registry::{BoxFuture, CallContext, Handler, HandlerResult, parse_params, to_result};
use hx_proto::{AppError, codes};

use crate::engine::Engine;

/// Serves `txn.validate`, `txn.apply`, `txn.restore`, `txn.discard` and `txn.recover`.
///
/// The engine is blocking, so each call runs on the blocking pool.
#[derive(Debug, Clone, Default)]
pub struct TxnHandler {
    engine: Engine,
}

impl TxnHandler {
    /// A handler with the default limits.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A handler around a configured engine.
    #[must_use]
    pub fn with_engine(engine: Engine) -> Self {
        Self { engine }
    }
}

const METHODS: &[&str] = &[
    method::TXN_VALIDATE,
    method::TXN_APPLY,
    method::TXN_RESTORE,
    method::TXN_DISCARD,
    method::TXN_RECOVER,
];

impl Handler for TxnHandler {
    fn namespace(&self) -> Namespace {
        Namespace::Txn
    }

    fn methods(&self) -> &'static [&'static str] {
        METHODS
    }

    fn capabilities(&self) -> Vec<String> {
        [
            "txn.edit.replace",
            "txn.edit.create",
            "txn.edit.delete",
            "txn.edit.diff",
            "txn.scope",
            "txn.protected",
            "txn.recover",
        ]
        .map(str::to_owned)
        .to_vec()
    }

    fn call<'a>(
        &'a self,
        method: &'a str,
        params: serde_json::Value,
        ctx: CallContext,
    ) -> BoxFuture<'a, HandlerResult> {
        let engine = self.engine.clone();
        let method = method.to_owned();
        Box::pin(async move {
            let cancel = ctx.cancel;
            let joined = tokio::task::spawn_blocking(move || -> HandlerResult {
                match method.as_str() {
                    method::TXN_VALIDATE => to_result(
                        &engine
                            .validate(&parse_params(params)?, &cancel)
                            .map_err(AppError::from)?,
                    ),
                    method::TXN_APPLY => to_result(
                        &engine
                            .apply(&parse_params(params)?, &cancel)
                            .map_err(AppError::from)?,
                    ),
                    method::TXN_RESTORE => to_result(
                        &engine
                            .restore(&parse_params(params)?, &cancel)
                            .map_err(AppError::from)?,
                    ),
                    method::TXN_DISCARD => to_result(
                        &engine
                            .discard(&parse_params(params)?, &cancel)
                            .map_err(AppError::from)?,
                    ),
                    method::TXN_RECOVER => to_result(
                        &engine
                            .recover(&parse_params(params)?, &cancel)
                            .map_err(AppError::from)?,
                    ),
                    other => Err(AppError::new(
                        codes::HX_METHOD_NOT_FOUND,
                        format!("no handler for `{other}`"),
                    )),
                }
            })
            .await;
            joined.unwrap_or_else(|e| {
                Err(AppError::internal(format!(
                    "the transaction task failed: {e}"
                )))
            })
        })
    }
}
