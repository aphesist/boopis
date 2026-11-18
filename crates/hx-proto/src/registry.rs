//! The extensible method registry: [`Handler`] and [`Dispatcher`].
//!
//! Each crate that serves methods (`hx-txn`, later `hx-pack` and `hx-sandbox`) implements
//! [`Handler`] and registers it. The binary builds one [`Dispatcher`]; the stdio server and the
//! one-shot subcommands both go through it.
//!
//! # Cancellation contract
//! A handler receives a [`CancellationToken`] in its [`CallContext`]. It must poll the token at
//! safe points and return [`AppError::cancelled`] only if it has **not** changed anything. The
//! dispatcher never drops a running handler future, so a response always tells the truth about
//! what happened.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use tokio_util::sync::CancellationToken;
use tracing::Instrument;

use crate::describe::{DescribeResult, PROTOCOL};
use crate::error::{AppError, codes};
use crate::jsonrpc::{Id, Request, Response};
use crate::method::{self, Namespace};

/// A boxed, sendable future. The registry's object-safe stand-in for `async fn` in a trait.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// What a handler returns: a JSON result or an [`AppError`].
pub type HandlerResult = Result<Value, AppError>;

/// Per-request context handed to a handler.
#[derive(Debug, Clone)]
pub struct CallContext {
    /// Cancelled when the client sends `$/cancelRequest` for this request, or on shutdown.
    pub cancel: CancellationToken,
    /// The request id (absent for one-shot calls that have none).
    pub id: Option<Id>,
}

impl CallContext {
    /// A context that is never cancelled, for one-shot calls and tests.
    #[must_use]
    pub fn detached() -> Self {
        Self {
            cancel: CancellationToken::new(),
            id: None,
        }
    }
}

/// A set of methods in one namespace.
pub trait Handler: Send + Sync + 'static {
    /// The namespace every method of this handler belongs to.
    fn namespace(&self) -> Namespace;

    /// The full method names served, such as `"txn.apply"`. Each must be in [`Self::namespace`].
    fn methods(&self) -> &'static [&'static str];

    /// Capability strings advertised by `hx.describe`.
    fn capabilities(&self) -> Vec<String>;

    /// Handles one call. `method` is one of [`Self::methods`].
    fn call<'a>(
        &'a self,
        method: &'a str,
        params: Value,
        ctx: CallContext,
    ) -> BoxFuture<'a, HandlerResult>;
}

/// Deserialises request params. Missing params read as `null`, so a params-free type works.
///
/// # Errors
/// `hx.invalid_params` with serde's message.
pub fn parse_params<T: DeserializeOwned>(params: Value) -> Result<T, AppError> {
    serde_json::from_value(params).map_err(|e| AppError::invalid_params(e.to_string()))
}

/// Serialises a result value.
///
/// # Errors
/// `hx.internal_error` if serialisation fails, which plain data types never do.
pub fn to_result<T: Serialize>(value: &T) -> HandlerResult {
    serde_json::to_value(value).map_err(|e| AppError::internal(e.to_string()))
}

/// Why a handler could not be registered.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[non_exhaustive]
pub enum RegisterError {
    /// A method is outside the handler's declared namespace.
    #[error("method `{method}` is not in namespace `{namespace}`")]
    WrongNamespace {
        /// The offending method.
        method: String,
        /// The declared namespace prefix.
        namespace: &'static str,
    },
    /// Two handlers claim the same method.
    #[error("method `{0}` is already registered")]
    Duplicate(String),
    /// The `hx.*` namespace belongs to the dispatcher itself.
    #[error("the `hx` namespace is reserved for the dispatcher")]
    ReservedNamespace,
}

/// Routes requests to registered handlers and answers `hx.describe` itself.
pub struct Dispatcher {
    version: String,
    routes: BTreeMap<&'static str, Arc<dyn Handler>>,
    capabilities: Vec<String>,
}

impl std::fmt::Debug for Dispatcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Dispatcher")
            .field("version", &self.version)
            .field("methods", &self.routes.keys().collect::<Vec<_>>())
            .field("capabilities", &self.capabilities)
            .finish()
    }
}

impl Dispatcher {
    /// An empty dispatcher that reports `version` in `hx.describe`.
    #[must_use]
    pub fn new(version: impl Into<String>) -> Self {
        Self {
            version: version.into(),
            routes: BTreeMap::new(),
            capabilities: vec!["rpc.cancel".to_owned()],
        }
    }

    /// Registers a handler for every method it declares.
    ///
    /// # Errors
    /// - a method outside the handler's namespace;
    /// - a method already registered;
    /// - a handler in the reserved `hx` namespace.
    ///
    /// On error nothing is registered.
    #[allow(clippy::needless_pass_by_value)] // Callers hand over ownership: `register(Arc::new(h))`.
    pub fn register(&mut self, handler: Arc<dyn Handler>) -> Result<(), RegisterError> {
        let ns = handler.namespace();
        if ns == Namespace::Hx {
            return Err(RegisterError::ReservedNamespace);
        }
        for m in handler.methods() {
            if !ns.owns(m) {
                return Err(RegisterError::WrongNamespace {
                    method: (*m).to_owned(),
                    namespace: ns.prefix(),
                });
            }
            if self.routes.contains_key(m) {
                return Err(RegisterError::Duplicate((*m).to_owned()));
            }
        }
        for m in handler.methods() {
            self.routes.insert(m, Arc::clone(&handler));
        }
        for cap in handler.capabilities() {
            if !self.capabilities.contains(&cap) {
                self.capabilities.push(cap);
            }
        }
        Ok(())
    }

    /// What `hx.describe` returns.
    #[must_use]
    pub fn describe(&self) -> DescribeResult {
        let mut capabilities = self.capabilities.clone();
        capabilities.sort();
        DescribeResult {
            version: self.version.clone(),
            protocol: PROTOCOL.to_owned(),
            capabilities,
        }
    }

    /// The registered method names, sorted.
    #[must_use]
    pub fn methods(&self) -> Vec<&'static str> {
        let mut v = vec![method::DESCRIBE];
        v.extend(self.routes.keys().copied());
        v.sort_unstable();
        v
    }

    /// Handles one request and builds its response. Never panics the caller: a handler error
    /// becomes an error response.
    pub async fn handle(&self, req: Request, cancel: CancellationToken) -> Response {
        let id = req.id.clone();
        let span = tracing::debug_span!("request", method = %req.method, id = id.as_ref().map(ToString::to_string));
        let outcome = self.route(req, cancel, id.clone()).instrument(span).await;
        match outcome {
            Ok(value) => Response::ok(id, value),
            Err(err) => {
                tracing::debug!(code = err.code, "request failed");
                Response::err(id, &err)
            }
        }
    }

    async fn route(
        &self,
        req: Request,
        cancel: CancellationToken,
        id: Option<Id>,
    ) -> HandlerResult {
        if req.method == method::DESCRIBE {
            return to_result(&self.describe());
        }
        let Some((name, handler)) = self.routes.get_key_value(req.method.as_str()) else {
            return Err(AppError::new(
                codes::HX_METHOD_NOT_FOUND,
                format!("no handler for method `{}`", req.method),
            ));
        };
        handler
            .call(
                name,
                req.params.unwrap_or(Value::Null),
                CallContext { cancel, id },
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Echo(Namespace, &'static [&'static str]);

    impl Handler for Echo {
        fn namespace(&self) -> Namespace {
            self.0
        }
        fn methods(&self) -> &'static [&'static str] {
            self.1
        }
        fn capabilities(&self) -> Vec<String> {
            vec![format!("{}.echo", self.0.prefix())]
        }
        fn call<'a>(
            &'a self,
            method: &'a str,
            params: Value,
            _: CallContext,
        ) -> BoxFuture<'a, HandlerResult> {
            Box::pin(async move { Ok(json!({"method": method, "params": params})) })
        }
    }

    fn req(method: &str) -> Request {
        Request::new(Id::Num(1), method, Some(json!({"x": 1})))
    }

    #[tokio::test]
    async fn routes_to_the_registered_handler() {
        let mut d = Dispatcher::new("0.0.0");
        d.register(Arc::new(Echo(Namespace::Pack, &["pack.search"])))
            .unwrap();
        let resp = d.handle(req("pack.search"), CancellationToken::new()).await;
        assert_eq!(resp.result.unwrap()["method"], "pack.search");
    }

    #[tokio::test]
    async fn unknown_and_reserved_methods_are_not_found() {
        let d = Dispatcher::new("0.0.0");
        for m in ["pack.search", "sandbox.run", "nope.nope"] {
            let resp = d.handle(req(m), CancellationToken::new()).await;
            assert_eq!(
                resp.error.unwrap().string_code(),
                Some("hx.method_not_found")
            );
        }
    }

    #[tokio::test]
    async fn describe_lists_capabilities() {
        let mut d = Dispatcher::new("1.2.3");
        d.register(Arc::new(Echo(Namespace::Txn, &["txn.a"])))
            .unwrap();
        let resp = d.handle(req("hx.describe"), CancellationToken::new()).await;
        let result: DescribeResult = serde_json::from_value(resp.result.unwrap()).unwrap();
        assert_eq!(result.version, "1.2.3");
        assert_eq!(result.protocol, "hx-v1");
        assert!(result.capabilities.contains(&"txn.echo".to_owned()));
        assert!(result.capabilities.contains(&"rpc.cancel".to_owned()));
    }

    #[test]
    fn registration_is_validated() {
        let mut d = Dispatcher::new("0");
        assert_eq!(
            d.register(Arc::new(Echo(Namespace::Txn, &["pack.x"]))),
            Err(RegisterError::WrongNamespace {
                method: "pack.x".into(),
                namespace: "txn"
            })
        );
        assert_eq!(
            d.register(Arc::new(Echo(Namespace::Hx, &["hx.x"]))),
            Err(RegisterError::ReservedNamespace)
        );
        d.register(Arc::new(Echo(Namespace::Txn, &["txn.a"])))
            .unwrap();
        assert_eq!(
            d.register(Arc::new(Echo(Namespace::Txn, &["txn.b", "txn.a"]))),
            Err(RegisterError::Duplicate("txn.a".into()))
        );
        // The failed registration left nothing behind.
        assert_eq!(d.methods(), vec!["hx.describe", "txn.a"]);
    }
}
