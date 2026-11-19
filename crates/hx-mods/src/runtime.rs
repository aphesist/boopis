//! An in-process runtime, for tests, the benchmark and embedders that do not need a sandbox: the
//! same chain (`chain.rs`) and the same worker (`worker.rs`) that `hx` runs, with each mod's worker
//! in a thread of this process instead of a sandboxed process.
//!
//! **`hx` never uses this.** The product runs every mod in its own sandboxed process
//! (`crates/hx/src/mods.rs`); a thread shares the process's authority and cannot be killed, so this
//! type is for code that trusts its mods (a test, a measurement). It keeps the blocking,
//! one-call-at-a-time shape the tests were written against.
//!
//! The host (`HostCalls`) is served from one thread of its own, so a host that is not thread-safe
//! (a test double) needs no locking: it is called from that thread only.

use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde_json::{Value as Json, json};
use tokio::sync::oneshot;

use crate::chain::{BoxFut, Chain, HostSink, ModWorker, WorkerError};
use crate::error::{Error, Result};
use crate::files::{Bundle, Files, PluginDir};
use crate::host::{CallId, HostCalls, HostError, HostReply, HostRequest};
use crate::manifest;
pub use crate::types::{Answer, Diagnostic, LoadedPlugin, Memory, Render, RuntimeConfig, Tier};

type Reply = oneshot::Sender<std::result::Result<Json, HostError>>;

/// What the host thread is told: a call to perform, or a barrier to acknowledge once everything queued
/// before it has been handed to the host.
enum HostMsg {
    Call(HostRequest, Reply),
    Barrier(mpsc::Sender<()>),
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Serves `$` calls from one thread, with the `HostCalls` the embedder gave.
struct LocalSink {
    calls: Mutex<mpsc::Sender<HostMsg>>,
    diagnostics: Arc<Mutex<Vec<Diagnostic>>>,
}

impl HostSink for LocalSink {
    fn begin(&self, request: HostRequest) -> BoxFut<BoxFut<std::result::Result<Json, HostError>>> {
        let (reply, answer) = oneshot::channel();
        let sent = lock(&self.calls)
            .send(HostMsg::Call(request, reply))
            .is_ok();
        Box::pin(async move {
            let inner: BoxFut<std::result::Result<Json, HostError>> = Box::pin(async move {
                if !sent {
                    return Err(HostError {
                        code: "hx.mods.host_failed".into(),
                        message: "the host is gone".into(),
                    });
                }
                answer.await.unwrap_or_else(|_| {
                    Err(HostError {
                        code: "hx.mods.host_failed".into(),
                        message: "the host dropped the call".into(),
                    })
                })
            });
            inner
        })
    }

    fn diagnostic(&self, diagnostic: Diagnostic) {
        lock(&self.diagnostics).push(diagnostic);
    }
}

/// Runs the host: a call is answered at once or stays pending, and `wait` delivers the pending ones.
fn serve_host(mut host: Box<dyn HostCalls>, rx: &mpsc::Receiver<HostMsg>) {
    let mut pending: HashMap<CallId, Reply> = HashMap::new();
    let mut next: CallId = 0;
    loop {
        let incoming = if pending.is_empty() {
            rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected)
        } else {
            rx.recv_timeout(Duration::from_millis(1))
        };
        match incoming {
            Ok(HostMsg::Barrier(done)) => {
                let _ = done.send(());
            }
            Ok(HostMsg::Call(request, reply)) => {
                next += 1;
                let id = next;
                let called = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    host.call(id, &request)
                }));
                match called {
                    Ok(HostReply::Ready(r)) => {
                        let _ = reply.send(r);
                    }
                    Ok(HostReply::Pending) => {
                        pending.insert(id, reply);
                    }
                    Err(_) => {
                        let _ = reply.send(Err(HostError {
                            code: "hx.internal".into(),
                            message: "the host panicked while performing the call".into(),
                        }));
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
        if !pending.is_empty() {
            let waited = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                host.wait(Duration::from_millis(5))
            }))
            .unwrap_or(None);
            if let Some((id, result)) = waited
                && let Some(reply) = pending.remove(&id)
            {
                let _ = reply.send(result);
            }
        }
    }
}

/// The runtime: a chain, and one worker thread per mod.
pub struct ModRuntime {
    rt: tokio::runtime::Runtime,
    chain: Arc<Chain>,
    diagnostics: Arc<Mutex<Vec<Diagnostic>>>,
    loaded: Vec<LoadedPlugin>,
    sink: Arc<dyn HostSink>,
    host: mpsc::Sender<HostMsg>,
    config: RuntimeConfig,
}

fn worker_error(e: &WorkerError) -> Error {
    serde_json::from_value::<Error>(e.detail.clone()).unwrap_or_else(|_| match e.code.as_str() {
        "hx.mods.crashed" => Error::Crashed(e.message.clone()),
        _ => Error::Script(e.message.clone()),
    })
}

impl ModRuntime {
    /// Starts a runtime with no mods.
    ///
    /// # Errors
    /// [`Error::Script`] if the runtime's threads cannot start.
    pub fn new(host: Box<dyn HostCalls>, config: RuntimeConfig) -> Result<Self> {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| Error::Script(e.to_string()))?;
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("hx-mods-host".into())
            .spawn(move || serve_host(host, &rx))
            .map_err(|e| Error::Script(e.to_string()))?;
        let diagnostics: Arc<Mutex<Vec<Diagnostic>>> = Arc::default();
        let sink: Arc<dyn HostSink> = Arc::new(LocalSink {
            calls: Mutex::new(tx.clone()),
            diagnostics: diagnostics.clone(),
        });
        Ok(Self {
            rt,
            chain: Chain::new(sink.clone(), config),
            diagnostics,
            loaded: Vec::new(),
            sink,
            host: tx,
            config,
        })
    }

    /// Waits until every `$` call the workers made so far has reached the host. A call is queued
    /// before the reply to the operation that made it, so after an operation this makes the host's
    /// record complete (fire-and-forget calls such as `ui.invalidate` included).
    fn sync_host(&self) {
        let (done, wait) = mpsc::channel();
        if self.host.send(HostMsg::Barrier(done)).is_ok() {
            let _ = wait.recv_timeout(Duration::from_secs(5));
        }
    }

    /// Loads one plugin from a directory.
    ///
    /// # Errors
    /// Anything [`Error`] describes. A failed load leaves nothing behind.
    pub fn load_plugin(&mut self, dir: &Path, tier: Tier) -> Result<LoadedPlugin> {
        let bundle = Bundle::read(dir)?;
        self.load_bundle(bundle, tier)
    }

    /// Loads one plugin from sources already read.
    ///
    /// # Errors
    /// As [`Self::load_plugin`].
    pub fn load_bundle(&mut self, bundle: Bundle, tier: Tier) -> Result<LoadedPlugin> {
        Ok(self.load_set(vec![(bundle, tier)])?.remove(0))
    }

    /// Loads several plugins in dependency order, each into its tier.
    ///
    /// # Errors
    /// [`Error::DependencyCycle`] or the first plugin that fails to load.
    pub fn load_plugins(&mut self, plugins: &[(&Path, Tier)]) -> Result<Vec<LoadedPlugin>> {
        let mut set = Vec::with_capacity(plugins.len());
        for (dir, tier) in plugins {
            // Opening the directory first keeps the error a missing directory has always had.
            drop(PluginDir::open(dir)?);
            set.push((Bundle::read(dir)?, *tier));
        }
        self.load_set(set)
    }

    /// Loads several bundles in dependency order, each into its tier.
    ///
    /// # Errors
    /// As [`Self::load_plugins`].
    pub fn load_bundles(&mut self, bundles: Vec<(Bundle, Tier)>) -> Result<Vec<LoadedPlugin>> {
        self.load_set(bundles)
    }

    fn load_set(&mut self, set: Vec<(Bundle, Tier)>) -> Result<Vec<LoadedPlugin>> {
        let mut opened = Vec::with_capacity(set.len());
        for (bundle, tier) in set {
            let manifest = manifest::read(&Files::Memory(bundle.clone()))?;
            opened.push((bundle, manifest, tier));
        }
        let graph: Vec<_> = opened
            .iter()
            .map(|(_, m, _)| (m.name.clone(), m.dependencies.clone()))
            .collect();
        let order = manifest::load_order(&graph)?;
        let mut slots: Vec<_> = opened.into_iter().map(Some).collect();
        let mut loaded = Vec::with_capacity(slots.len());
        for i in order {
            if let Some((bundle, manifest, tier)) = slots[i].take() {
                if self.loaded.iter().any(|l| l.name == manifest.name) {
                    return Err(Error::AlreadyLoaded(manifest.name));
                }
                loaded.push(self.load_one(bundle, &manifest.name, tier)?);
            }
        }
        Ok(loaded)
    }

    #[cfg(unix)]
    fn load_one(&mut self, bundle: Bundle, name: &str, tier: Tier) -> Result<LoadedPlugin> {
        use std::net::Shutdown;
        use std::os::unix::net::UnixStream;

        let (theirs, ours) = UnixStream::pair().map_err(|e| Error::Script(e.to_string()))?;
        let control = ours.try_clone().map_err(|e| Error::Script(e.to_string()))?;
        let worker_side = theirs
            .try_clone()
            .map_err(|e| Error::Script(e.to_string()))?;
        let config = self.config;
        std::thread::Builder::new()
            .name(format!("hx-mods-worker-{name}"))
            .spawn(move || {
                let _ = crate::worker::serve(theirs, worker_side, config);
            })
            .map_err(|e| Error::Script(e.to_string()))?;
        ours.set_nonblocking(true)
            .map_err(|e| Error::Script(e.to_string()))?;
        let budgets = self.config.budgets;
        let idx = self.chain.add_slot(name, tier, budgets);
        let worker = {
            let _guard = self.rt.enter();
            let stream =
                tokio::net::UnixStream::from_std(ours).map_err(|e| Error::Script(e.to_string()))?;
            let (r, w) = stream.into_split();
            ModWorker::attach(
                r,
                w,
                (name, idx, 0),
                self.sink.clone(),
                Box::new(move || {
                    let _ = control.shutdown(Shutdown::Both);
                }),
                self.chain.tick_handler(),
            )
        };
        let reply = self.rt.block_on(worker.request(
            json!({ "op": "load", "bundle": bundle, "tier": tier.name(), "idx": idx, "gen": 0 }),
            Duration::from_mins(5),
        ));
        match reply {
            Ok(v) => {
                self.chain.set_worker(idx, Some(worker));
                let l = LoadedPlugin {
                    name: name.to_owned(),
                    tier,
                    modules: v["loaded"]["modules"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|m| m.as_str().map(str::to_owned))
                        .collect(),
                    hooks: v["loaded"]["hooks"]
                        .as_u64()
                        .and_then(|n| usize::try_from(n).ok())
                        .unwrap_or(0),
                };
                self.loaded.push(l.clone());
                Ok(l)
            }
            Err(e) => {
                worker.kill();
                self.chain.retire(idx);
                Err(worker_error(&e))
            }
        }
    }

    #[cfg(not(unix))]
    fn load_one(&mut self, _bundle: Bundle, _name: &str, _tier: Tier) -> Result<LoadedPlugin> {
        Err(Error::Crashed(
            "the in-process runtime needs Unix sockets".into(),
        ))
    }

    /// The plugins loaded now, in load order.
    #[must_use]
    pub fn plugins(&self) -> Vec<LoadedPlugin> {
        self.loaded.clone()
    }

    /// Unloads a plugin: its hooks leave the chain, its timers stop, and its worker is stopped with
    /// everything in it. Unloading a name that is not loaded is `Ok(false)`.
    ///
    /// # Errors
    /// Never, today; the signature keeps the shape callers were written against.
    pub fn unload_plugin(&mut self, name: &str) -> Result<bool> {
        let Some(slot) = self.chain.slot_named(name) else {
            return Ok(false);
        };
        if let Some(w) = &slot.worker {
            w.kill();
        }
        self.chain.retire(slot.idx);
        self.loaded.retain(|l| l.name != name);
        Ok(true)
    }

    /// Sends one event through the chain and returns the answer.
    ///
    /// # Errors
    /// The answer could not be read as JSON.
    pub fn dispatch(&mut self, event: &str, payload: &Json) -> Result<Answer> {
        let answer = self.rt.block_on(self.chain.dispatch(event, payload, None));
        self.sync_host();
        answer
    }

    /// Asks the chain to draw `component` (with `id` for a pane) and validates the tree.
    ///
    /// # Errors
    /// The answer could not be read as JSON.
    pub fn render(&mut self, component: &str, id: Option<&str>, props: &Json) -> Result<Render> {
        Ok(self.render_attributed(component, id, props)?.0)
    }

    /// Like [`Self::render`], and also names the mod that drew the tree.
    ///
    /// # Errors
    /// The answer could not be read as JSON.
    pub fn render_attributed(
        &mut self,
        component: &str,
        id: Option<&str>,
        props: &Json,
    ) -> Result<(Render, Option<String>)> {
        let r = self.rt.block_on(self.chain.render(component, id, props))?;
        self.sync_host();
        Ok((r.render, r.plugin))
    }

    /// Delivers `ui.press` for a handler id from a drawn tree. True when a handler ran.
    ///
    /// # Errors
    /// The answer could not be read as JSON.
    pub fn press(&mut self, handler: &str) -> Result<bool> {
        let handled = self
            .rt
            .block_on(self.chain.callback("ui.press", handler, None));
        self.sync_host();
        handled
    }

    /// Delivers `ui.input` (`onInput`, `onSubmit`) with the text. True when a handler ran.
    ///
    /// # Errors
    /// The answer could not be read as JSON.
    pub fn input(&mut self, handler: &str, value: &str) -> Result<bool> {
        let handled = self
            .rt
            .block_on(self.chain.callback("ui.input", handler, Some(value)));
        self.sync_host();
        handled
    }

    /// Delivers `ui.select` (`onSelect`) with the chosen value. True when a handler ran.
    ///
    /// # Errors
    /// The answer could not be read as JSON.
    pub fn select(&mut self, handler: &str, value: &str) -> Result<bool> {
        let handled = self
            .rt
            .block_on(self.chain.callback("ui.select", handler, Some(value)));
        self.sync_host();
        handled
    }

    /// Fires a `$.clock.every` timer by id, as its worker would when it came due.
    ///
    /// # Errors
    /// The answer could not be read as JSON.
    pub fn tick(&mut self, timer: &str) -> Result<bool> {
        Ok(self
            .dispatch("clock.tick", &json!({ "id": timer }))?
            .value
            .get("handled")
            == Some(&Json::Bool(true)))
    }

    /// Delivers `command.run` for a command a mod registered.
    ///
    /// # Errors
    /// The answer could not be read as JSON.
    pub fn run_command(&mut self, name: &str, args: &str) -> Result<Answer> {
        self.dispatch("command.run", &json!({ "name": name, "args": args }))
    }

    /// Takes the diagnostics recorded since the last call.
    pub fn take_diagnostics(&mut self) -> Vec<Diagnostic> {
        std::mem::take(&mut *lock(&self.diagnostics))
    }

    /// Runs every worker's cycle collector. Measuring memory after it separates a leak from garbage
    /// the collector has not got to yet. (`memory` does it itself.)
    pub fn collect_garbage(&mut self) {
        let _ = self.memory();
    }

    /// The engines' memory use, summed over every mod's own heap.
    #[must_use]
    pub fn memory(&self) -> Memory {
        self.rt.block_on(self.chain.memory())
    }

    /// The chain, for tests that drive it directly.
    #[must_use]
    pub fn chain(&self) -> &Arc<Chain> {
        &self.chain
    }
}
