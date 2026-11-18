//! A wrapper that drops the walk cache whenever a transaction may have changed the workspace.

use std::sync::Arc;

use hx_pack::WalkCache;
use hx_proto::method::Namespace;
use hx_proto::registry::{BoxFuture, CallContext, Handler, HandlerResult};
use serde_json::Value;

/// Methods after which the cached file lists are stale.
const MUTATING: &[&str] = &["txn.apply", "txn.restore", "txn.recover", "txn.discard"];

/// Delegates to `inner` and, after any mutating method (successful or not, since a failed
/// apply may have written and restored), clears the cache.
pub struct InvalidatingHandler<H> {
    inner: H,
    cache: Arc<WalkCache>,
}

impl<H> InvalidatingHandler<H> {
    /// Wraps `inner`.
    pub fn new(inner: H, cache: Arc<WalkCache>) -> Self {
        Self { inner, cache }
    }
}

impl<H: Handler> Handler for InvalidatingHandler<H> {
    fn namespace(&self) -> Namespace {
        self.inner.namespace()
    }

    fn methods(&self) -> &'static [&'static str] {
        self.inner.methods()
    }

    fn capabilities(&self) -> Vec<String> {
        self.inner.capabilities()
    }

    fn call<'a>(
        &'a self,
        method: &'a str,
        params: Value,
        ctx: CallContext,
    ) -> BoxFuture<'a, HandlerResult> {
        Box::pin(async move {
            let result = self.inner.call(method, params, ctx).await;
            if MUTATING.contains(&method) {
                self.cache.invalidate_all();
            }
            result
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hx_pack::{Control, Root, SearchParams, search::search};
    use serde_json::json;

    /// Answers every method with `{ok: true}` or, for `txn.fail`, an error.
    struct Stub;

    impl Handler for Stub {
        fn namespace(&self) -> Namespace {
            Namespace::Txn
        }
        fn methods(&self) -> &'static [&'static str] {
            &[
                "txn.apply",
                "txn.validate",
                "txn.restore",
                "txn.recover",
                "txn.discard",
                "txn.fail",
            ]
        }
        fn capabilities(&self) -> Vec<String> {
            vec!["stub".into()]
        }
        fn call<'a>(
            &'a self,
            method: &'a str,
            _: Value,
            _: CallContext,
        ) -> BoxFuture<'a, HandlerResult> {
            Box::pin(async move {
                if method == "txn.fail" {
                    Err(hx_proto::AppError::internal("boom"))
                } else {
                    Ok(json!({"ok": true}))
                }
            })
        }
    }

    struct FailingApply;
    impl Handler for FailingApply {
        fn namespace(&self) -> Namespace {
            Namespace::Txn
        }
        fn methods(&self) -> &'static [&'static str] {
            &["txn.apply"]
        }
        fn capabilities(&self) -> Vec<String> {
            vec![]
        }
        fn call<'a>(
            &'a self,
            _: &'a str,
            _: Value,
            _: CallContext,
        ) -> BoxFuture<'a, HandlerResult> {
            Box::pin(async { Err(hx_proto::AppError::internal("write failed after restore")) })
        }
    }

    /// A cached tree: files are aged so the settle window lets the walk be stored.
    fn primed() -> (tempfile::TempDir, Arc<WalkCache>) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "needle\n").unwrap();
        let then = std::time::SystemTime::now() - std::time::Duration::from_hours(1);
        for p in [dir.path().join("a.txt"), dir.path().to_path_buf()] {
            std::fs::File::open(p).unwrap().set_modified(then).unwrap();
        }
        let cache = Arc::new(WalkCache::default());
        let ctl = Control::none().with_cache(Arc::clone(&cache));
        let root = Root::open(dir.path().to_str().unwrap()).unwrap();
        search(&root, &SearchParams::new("needle"), &ctl).unwrap();
        assert_eq!(cache.len(), 1, "the fixture must populate the cache");
        (dir, cache)
    }

    async fn call(h: &impl Handler, method: &str) -> HandlerResult {
        h.call(method, Value::Null, CallContext::detached()).await
    }

    #[tokio::test]
    async fn every_mutating_method_clears_the_cache_even_when_it_fails() {
        for method in ["txn.apply", "txn.restore", "txn.recover", "txn.discard"] {
            let (_dir, cache) = primed();
            let h = InvalidatingHandler::new(Stub, Arc::clone(&cache));
            call(&h, method).await.unwrap();
            assert!(cache.is_empty(), "{method}");
        }
    }

    #[tokio::test]
    async fn a_failed_apply_still_clears_it_and_a_read_only_call_does_not() {
        let (_dir, cache) = primed();
        let h = InvalidatingHandler::new(Stub, Arc::clone(&cache));
        call(&h, "txn.validate").await.unwrap();
        assert_eq!(cache.len(), 1, "validate writes nothing");
        let _ = call(&h, "txn.fail").await.unwrap_err();
        assert_eq!(cache.len(), 1, "an unrelated failure is not a mutation");
        // A wrapper around a handler whose apply errors still clears the cache.
        let h = InvalidatingHandler::new(FailingApply, Arc::clone(&cache));
        assert!(call(&h, "txn.apply").await.is_err());
        assert!(cache.is_empty());
    }
}
