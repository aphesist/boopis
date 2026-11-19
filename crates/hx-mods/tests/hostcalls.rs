//! Asynchronous host calls, `console`, bundles, unloading and timers.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::{runtime, simple_plugin, write_plugin};
use hx_mods::{
    Budgets, Bundle, CallId, Completion, HostCalls, HostReply, HostRequest, ModRuntime,
    RuntimeConfig, Tier,
};
use serde_json::{Value, json};
use tempfile::tempdir;

/// A host whose `ui.ask` is pending and answers `delay` later; everything else is immediate.
#[derive(Clone, Default)]
struct Slow {
    calls: Arc<Mutex<Vec<HostRequest>>>,
    queue: Arc<Mutex<VecDeque<CallId>>>,
    delay: Duration,
    never: bool,
}

impl HostCalls for Slow {
    fn call(&mut self, id: CallId, request: &HostRequest) -> HostReply {
        self.calls.lock().unwrap().push(request.clone());
        if request.call == "ui.ask" {
            self.queue.lock().unwrap().push_back(id);
            return HostReply::Pending;
        }
        HostReply::Ready(Ok(Value::Null))
    }

    fn wait(&mut self, timeout: Duration) -> Option<Completion> {
        if self.never {
            std::thread::sleep(timeout);
            return None;
        }
        let id = self.queue.lock().unwrap().pop_front()?;
        std::thread::sleep(self.delay);
        Some((id, Ok(json!("Yes"))))
    }
}

fn runtime_on(host: Slow, config: RuntimeConfig) -> ModRuntime {
    ModRuntime::new(Box::new(host), config).unwrap()
}

#[test]
fn a_pending_call_is_awaited_and_the_hook_budget_does_not_run_meanwhile() {
    let dir = tempdir().unwrap();
    let plugin = simple_plugin(
        dir.path(),
        "asker",
        "export function register(on) { on('go', async ($) => ({ answer: await $.ui.ask('Sure?', { options: ['Yes', 'No'] }) })); }",
    );
    let host = Slow {
        delay: Duration::from_millis(400),
        ..Slow::default()
    };
    // The hook's budget is 100 ms and the host takes 400 ms: waiting for the host is not the
    // hook's time, so it is not skipped.
    let config = RuntimeConfig {
        budgets: Budgets {
            event: Duration::from_millis(100),
            ..Budgets::default()
        },
        ..RuntimeConfig::default()
    };
    let mut rt = runtime_on(host, config);
    rt.load_plugin(&plugin, Tier::User).unwrap();
    let started = Instant::now();
    let answer = rt.dispatch("go", &json!({})).unwrap();
    assert!(started.elapsed() >= Duration::from_millis(400));
    assert_eq!(answer.value, json!({ "answer": "Yes" }));
    assert!(rt.take_diagnostics().is_empty());
}

#[test]
fn a_hook_that_spins_after_the_host_answered_is_still_bounded() {
    let dir = tempdir().unwrap();
    let plugin = simple_plugin(
        dir.path(),
        "spinner",
        "export function register(on) { on('go', async ($) => { await $.ui.ask('?'); while (true) {} }); on('go', async () => 'next'); }",
    );
    let host = Slow {
        delay: Duration::from_millis(10),
        ..Slow::default()
    };
    let config = RuntimeConfig {
        budgets: Budgets {
            event: Duration::from_millis(100),
            ..Budgets::default()
        },
        ..RuntimeConfig::default()
    };
    let mut rt = runtime_on(host, config);
    rt.load_plugin(&plugin, Tier::User).unwrap();
    let answer = rt.dispatch("go", &json!({})).unwrap();
    assert_eq!(answer.value, json!("next"));
    assert!(
        rt.take_diagnostics()
            .iter()
            .any(|d| d.message.contains("timed out"))
    );
}

#[test]
fn a_call_the_host_never_answers_rejects_after_the_host_timeout() {
    let dir = tempdir().unwrap();
    let plugin = simple_plugin(
        dir.path(),
        "patient",
        "export function register(on) { on('go', async ($) => { try { await $.ui.ask('?'); return 'answered'; } catch (e) { return e.code; } }); }",
    );
    let host = Slow {
        never: true,
        ..Slow::default()
    };
    let config = RuntimeConfig {
        host_timeout: Duration::from_millis(150),
        ..RuntimeConfig::default()
    };
    let mut rt = runtime_on(host, config);
    rt.load_plugin(&plugin, Tier::User).unwrap();
    assert_eq!(
        rt.dispatch("go", &json!({})).unwrap().value,
        json!("hx.mods.host_timeout")
    );
}

#[test]
fn console_writes_to_the_mods_log_line_and_debug_goes_to_debug() {
    let dir = tempdir().unwrap();
    let plugin = simple_plugin(
        dir.path(),
        "chatty",
        "export function register(on) { on('go', async () => {
           console.log('a', 1, { b: 2 }); console.info('i'); console.warn('w'); console.error(new Error('e')); console.debug('d');
           return 'done';
         }); }",
    );
    let (mut rt, host) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    rt.dispatch("go", &json!({})).unwrap();
    let logs: Vec<(String, Option<String>)> = host
        .calls_to("ui.log")
        .iter()
        .map(|c| {
            (
                c.args["text"].as_str().unwrap().to_owned(),
                c.args["to"].as_str().map(str::to_owned),
            )
        })
        .collect();
    assert_eq!(
        logs,
        [
            ("a 1 {\"b\":2}".to_owned(), None),
            ("i".to_owned(), None),
            ("w".to_owned(), None),
            ("Error: e".to_owned(), None),
            ("d".to_owned(), Some("debug".to_owned())),
        ]
    );
}

#[test]
fn ordinary_assignments_survive_frozen_intrinsics() {
    // The "override mistake": with the prototypes frozen, `this.name = ...` in an error subclass and
    // `obj.toString = ...` must still work.
    let dir = tempdir().unwrap();
    let plugin = simple_plugin(
        dir.path(),
        "ordinary",
        "class Mine extends Error { constructor(m) { super(m); this.name = 'Mine'; } }
         export function register(on) { on('go', async () => {
           const o = {}; o.toString = () => 'custom'; o.valueOf = () => 7;
           const err = new Mine('x'); err.message = 'y';
           return { s: String(o), n: +o, name: err.name, message: err.message, e: err instanceof Error };
         }); }",
    );
    let (mut rt, _h) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    assert_eq!(
        rt.dispatch("go", &json!({})).unwrap().value,
        json!({ "s": "custom", "n": 7, "name": "Mine", "message": "y", "e": true })
    );
}

#[test]
fn unsupported_namespaces_go_to_the_host_by_name() {
    let dir = tempdir().unwrap();
    let plugin = simple_plugin(
        dir.path(),
        "reacher",
        "export function register(on) { on('go', async ($) => { await $.process.run({ argv: ['ls'] }); await $.mcp.call({ server: 'x' }); await $.model.ask({}); await $.agent.spawn({}); return 1; }); }",
    );
    let (mut rt, host) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    rt.dispatch("go", &json!({})).unwrap();
    let names: Vec<_> = host.calls().iter().map(|c| c.call.clone()).collect();
    assert_eq!(
        names,
        ["process.run", "mcp.call", "model.ask", "agent.spawn"]
    );
}

#[test]
fn a_bundle_loads_like_a_directory_and_cannot_import_what_it_does_not_hold() {
    let dir = tempdir().unwrap();
    let plugin = write_plugin(
        dir.path(),
        "bundled",
        "register.ts",
        &[
            (
                "register.ts",
                "import { greet } from './lib/greet';
                 export function register(on: any) { on('go', async () => greet('bundle')); }",
            ),
            (
                "lib/greet.ts",
                "export const greet = (n: string): string => `hi ${n}`;",
            ),
            ("notes.txt", "not a module"),
        ],
    );
    let bundle = Bundle::read(&plugin).unwrap();
    assert!(bundle.files.contains_key("lib/greet.ts"));
    assert!(bundle.files.contains_key(".claude-plugin/plugin.json"));
    assert!(!bundle.files.contains_key("notes.txt"));
    // The directory is gone: the runtime has only the bundle.
    std::fs::remove_dir_all(&plugin).unwrap();
    let (mut rt, _h) = runtime();
    rt.load_bundle(bundle, Tier::User).unwrap();
    assert_eq!(
        rt.dispatch("go", &json!({})).unwrap().value,
        json!("hi bundle")
    );

    let mut missing = Bundle::default();
    missing.files.insert(
        ".claude-plugin/plugin.json".into(),
        r#"{"name":"m"}"#.into(),
    );
    missing.files.insert(
        "hooks/hooks.json".into(),
        r#"{"modules":["./r.js"]}"#.into(),
    );
    missing.files.insert(
        "r.js".into(),
        "import './other.js'; export function register() {}".into(),
    );
    let err = rt.load_bundle(missing, Tier::User).unwrap_err();
    assert!(err.to_string().contains("no such file"), "{err}");
}

#[test]
fn unloading_a_mod_removes_its_hooks_timers_and_context() {
    let dir = tempdir().unwrap();
    let keep = simple_plugin(
        dir.path(),
        "keep",
        "export function register(on) { on('go', async (_$, e, next) => { const r = await next(e); return { keep: true, below: r }; }); }",
    );
    let gone = simple_plugin(
        dir.path(),
        "gone",
        "export function register(on) { on('go', async () => 'gone says hi'); on('session.start', async ($) => { $.clock.every(20, () => { $.ui.status('tick'); }); }); }",
    );
    let host = hx_mods::fixtures::MemoryHost::new();
    let mut rt = ModRuntime::new(
        Box::new(host.clone()),
        RuntimeConfig {
            min_timer: Duration::from_millis(1),
            ..RuntimeConfig::default()
        },
    )
    .unwrap();
    rt.load_plugin(&keep, Tier::User).unwrap();
    rt.load_plugin(&gone, Tier::User).unwrap();
    rt.dispatch("session.start", &json!({})).unwrap();
    wait_for(|| !host.calls_to("ui.status").is_empty());
    assert_eq!(
        rt.dispatch("go", &json!({})).unwrap().value,
        json!({ "keep": true, "below": "gone says hi" })
    );
    assert!(rt.unload_plugin("gone").unwrap());
    assert!(!rt.unload_plugin("gone").unwrap());
    // Its timer stopped with it: no more ticks arrive.
    std::thread::sleep(Duration::from_millis(100));
    let seen = host.calls_to("ui.status").len();
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(host.calls_to("ui.status").len(), seen);
    assert_eq!(
        rt.dispatch("go", &json!({})).unwrap().value,
        json!({ "keep": true })
    );
    assert_eq!(rt.plugins().len(), 1);
    // The name is free again.
    rt.load_plugin(&gone, Tier::User).unwrap();
}

/// Polls until `cond` holds, for at most five seconds.
fn wait_for(cond: impl Fn() -> bool) {
    let end = Instant::now() + Duration::from_secs(5);
    while !cond() {
        assert!(Instant::now() < end, "the condition never held");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_worker_keeps_time_for_clock_every_and_a_tick_runs_through_the_chain() {
    let dir = tempdir().unwrap();
    let plugin = simple_plugin(
        dir.path(),
        "ticker",
        "export function register(on) {
           on('session.start', async ($) => { let n = 0; const stop = $.clock.every(30, () => { n++; if (n === 2) stop(); $.ui.status('tick ' + n); }); });
         }",
    );
    let host = hx_mods::fixtures::MemoryHost::new();
    let mut rt = ModRuntime::new(
        Box::new(host.clone()),
        RuntimeConfig {
            min_timer: Duration::from_millis(1),
            ..RuntimeConfig::default()
        },
    )
    .unwrap();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    rt.dispatch("session.start", &json!({})).unwrap();
    wait_for(|| host.calls_to("ui.status").len() >= 2 && !host.calls_to("clock.cancel").is_empty());
    // The second tick cancelled it: no third one arrives.
    std::thread::sleep(Duration::from_millis(150));
    let statuses: Vec<_> = host
        .calls_to("ui.status")
        .iter()
        .map(|c| c.args["text"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(statuses, ["tick 1", "tick 2"]);
    assert_eq!(host.calls_to("clock.cancel").len(), 1);
}
