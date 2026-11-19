//! The event chain: tiers, middleware, frozen events, matchers, budgets, `.catch`.

mod common;

use std::time::{Duration, Instant};

use common::{runtime, runtime_with, simple_plugin, write_plugin_with};
use hx_mods::{Budgets, RuntimeConfig, Tier};
use serde_json::json;
use tempfile::tempdir;

fn logs(host: &hx_mods::fixtures::MemoryHost) -> Vec<String> {
    host.calls_to("ui.log").iter().map(|c| c.args["text"].as_str().unwrap().to_owned()).collect()
}

fn fast_budgets() -> RuntimeConfig {
    RuntimeConfig {
        budgets: Budgets { event: Duration::from_millis(150), prompt_edit: Duration::from_millis(50), catch: Duration::from_millis(150) },
        ..RuntimeConfig::default()
    }
}

/// A plugin whose `probe` hook logs its own name and passes the event on.
fn tracer(name: &str) -> String {
    format!("export function register(on) {{ on('probe', async ($, e, next) => {{ await $.ui.log('{name}'); return next(e); }}); }}")
}

#[test]
fn tiers_run_prepend_then_user_dependencies_first_then_append() {
    let dir = tempdir().unwrap();
    let late = write_plugin_with(dir.path(), "late", &[], "register.js", &[("register.js", &tracer("late"))]);
    let user = write_plugin_with(dir.path(), "user", &["dep"], "register.js", &[("register.js", &tracer("user"))]);
    let dep = write_plugin_with(dir.path(), "dep", &[], "register.js", &[("register.js", &tracer("dep"))]);
    let early = write_plugin_with(dir.path(), "early", &[], "register.js", &[("register.js", &tracer("early"))]);
    let (mut rt, host) = runtime();
    // Given in a scrambled order: tiers and dependencies decide, not the order of the list.
    rt.load_plugins(&[(&late, Tier::Append), (&user, Tier::User), (&dep, Tier::User), (&early, Tier::Prepend)]).unwrap();
    assert!(!rt.dispatch("probe", &json!({})).unwrap().answered);
    assert_eq!(logs(&host), ["early", "dep", "user", "late"]);
}

#[test]
fn returning_without_next_answers_and_stops_the_chain() {
    let dir = tempdir().unwrap();
    let first = simple_plugin(dir.path(), "first", "export function register(on) { on('q', async () => 'first'); }");
    let second = simple_plugin(dir.path(), "second", "export function register(on) { on('q', async ($) => { await $.ui.log('second'); return 'second'; }); }");
    let (mut rt, host) = runtime();
    rt.load_plugins(&[(&first, Tier::User), (&second, Tier::User)]).unwrap();
    let a = rt.dispatch("q", &json!({})).unwrap();
    assert_eq!((a.answered, a.value), (true, json!("first")));
    assert!(logs(&host).is_empty());
}

#[test]
fn next_passes_a_changed_copy_and_the_original_stays_frozen() {
    let dir = tempdir().unwrap();
    let a = simple_plugin(dir.path(), "a", "export function register(on) { on('n', async ($, e, next) => next({ ...e, n: e.n + 1 })); }");
    let b = simple_plugin(dir.path(), "b", "export function register(on) { on('n', async ($, e, next) => next()); }");
    let c = simple_plugin(dir.path(), "c", "export function register(on) { on('n', async ($, e) => ({ n: e.n, frozen: Object.isFrozen(e) && Object.isFrozen(e.nested) })); }");
    let (mut rt, _) = runtime();
    rt.load_plugins(&[(&a, Tier::User), (&b, Tier::User), (&c, Tier::User)]).unwrap();
    let out = rt.dispatch("n", &json!({ "n": 1, "nested": { "x": 1 } })).unwrap();
    // `a` added one, `b` passed the event on with a bare `next()`, `c` saw both frozen deeply.
    assert_eq!(out.value, json!({ "n": 2, "frozen": true }));
}

#[test]
fn a_hook_that_mutates_its_frozen_event_throws_and_is_skipped() {
    let dir = tempdir().unwrap();
    let bad = simple_plugin(dir.path(), "bad", "export function register(on) { on('f', async (_$, e) => { e.props.x = 1; return 'mutated'; }); }");
    let good = simple_plugin(dir.path(), "good", "export function register(on) { on('f', async (_$, e) => e.props.x ?? 'untouched'); }");
    let (mut rt, _) = runtime();
    rt.load_plugins(&[(&bad, Tier::User), (&good, Tier::User)]).unwrap();
    assert_eq!(rt.dispatch("f", &json!({ "props": {} })).unwrap().value, json!("untouched"));
    assert!(rt.take_diagnostics().iter().any(|d| d.plugin == "bad" && d.message.contains("threw")));
}

#[test]
fn matchers_compare_values_arrays_and_regexes() {
    let src = "export function register(on) {
        on('m', { kind: 'exact' }, async () => 'value');
        on('m', { kind: ['one', 'two'] }, async () => 'array');
        on('m', { name: /^tool\\./, kind: 'rx' }, async () => 'regex+value');
        on('m', { missing: 'x' }, async () => 'never');
        on('m', async () => 'fallback');
    }";
    let dir = tempdir().unwrap();
    let p = simple_plugin(dir.path(), "p", src);
    let (mut rt, _) = runtime();
    rt.load_plugin(&p, Tier::User).unwrap();
    let ask = |rt: &mut hx_mods::ModRuntime, e: serde_json::Value| rt.dispatch("m", &e).unwrap().value;
    assert_eq!(ask(&mut rt, json!({ "kind": "exact" })), json!("value"));
    assert_eq!(ask(&mut rt, json!({ "kind": "two" })), json!("array"));
    assert_eq!(ask(&mut rt, json!({ "kind": "rx", "name": "tool.call" })), json!("regex+value"));
    // Every key must match: the regex fails here, so the fallback answers.
    assert_eq!(ask(&mut rt, json!({ "kind": "rx", "name": "other" })), json!("fallback"));
    assert_eq!(ask(&mut rt, json!({ "kind": "none" })), json!("fallback"));
}

#[test]
fn an_infinite_loop_is_interrupted_at_the_budget_and_skipped() {
    let dir = tempdir().unwrap();
    let spin = simple_plugin(dir.path(), "spin", "export function register(on) { on('s', async () => { while (true) {} }); }");
    let next = simple_plugin(dir.path(), "next", "export function register(on) { on('s', async () => 'after'); }");
    let (mut rt, _) = runtime_with(fast_budgets());
    rt.load_plugins(&[(&spin, Tier::User), (&next, Tier::User)]).unwrap();
    let t = Instant::now();
    let out = rt.dispatch("s", &json!({})).unwrap();
    let took = t.elapsed();
    assert_eq!(out.value, json!("after"));
    assert!(took >= Duration::from_millis(150) && took < Duration::from_secs(2), "{took:?}");
    assert!(rt.take_diagnostics().iter().any(|d| d.plugin == "spin" && d.message.contains("timed out")));
    // The isolate is fine afterwards, and the interrupted hook is skipped again, within budget.
    let again = rt.dispatch("s", &json!({})).unwrap();
    assert_eq!(again.value, json!("after"));
}

#[test]
fn a_hook_that_never_settles_is_skipped_without_waiting_for_the_budget() {
    let dir = tempdir().unwrap();
    let hang = simple_plugin(dir.path(), "hang", "export function register(on) { on('h', async () => { await new Promise(() => {}); }); }");
    let next = simple_plugin(dir.path(), "next", "export function register(on) { on('h', async () => 'after'); }");
    // The default 10 s budget: nothing can ever settle the promise, so the driver does not wait.
    let (mut rt, _) = runtime();
    rt.load_plugins(&[(&hang, Tier::User), (&next, Tier::User)]).unwrap();
    let t = Instant::now();
    assert_eq!(rt.dispatch("h", &json!({})).unwrap().value, json!("after"));
    assert!(t.elapsed() < Duration::from_secs(1), "{:?}", t.elapsed());
}

#[test]
fn prompt_edit_has_a_50_ms_budget_by_default() {
    let dir = tempdir().unwrap();
    let spin = simple_plugin(dir.path(), "spin", "export function register(on) { on('prompt.edit', async () => { while (true) {} }); }");
    let next = simple_plugin(dir.path(), "next", "export function register(on) { on('prompt.edit', async (_$, e) => e.text + '!'); }");
    let (mut rt, _) = runtime();
    rt.load_plugins(&[(&spin, Tier::User), (&next, Tier::User)]).unwrap();
    let t = Instant::now();
    assert_eq!(rt.dispatch("prompt.edit", &json!({ "text": "hi" })).unwrap().value, json!("hi!"));
    let took = t.elapsed();
    assert!(took >= Duration::from_millis(50) && took < Duration::from_millis(500), "{took:?}");
}

#[test]
fn catch_answers_for_a_throw_and_for_a_timeout() {
    let src = "export function register(on) {
        on('c', { kind: 'throw' }, async () => { throw new Error('nope'); })
            .catch(async (_$, e, next) => ({ error: next.error, called: next.called, cause: next.cause.message }));
        on('c', { kind: 'timeout' }, async () => { while (true) {} })
            .catch(async (_$, e, next) => ({ error: next.error, called: next.called }));
        on('c', { kind: 'continue' }, async () => { throw new Error('x'); })
            .catch(async (_$, e, next) => next(e));
        on('c', async () => 'downstream');
    }";
    let dir = tempdir().unwrap();
    let p = simple_plugin(dir.path(), "p", src);
    let (mut rt, _) = runtime_with(fast_budgets());
    rt.load_plugin(&p, Tier::User).unwrap();
    let v = |rt: &mut hx_mods::ModRuntime, kind: &str| rt.dispatch("c", &json!({ "kind": kind })).unwrap().value;
    assert_eq!(v(&mut rt, "throw"), json!({ "error": "throw", "called": false, "cause": "nope" }));
    assert_eq!(v(&mut rt, "timeout"), json!({ "error": "timeout", "called": false }));
    // A catch handler that calls `next` carries the chain on.
    assert_eq!(v(&mut rt, "continue"), json!("downstream"));
}

#[test]
fn a_catch_handler_over_its_own_budget_is_skipped_too() {
    let src = "export function register(on) {
        on('c', async () => { throw new Error('x'); }).catch(async () => { while (true) {} });
        on('c', async () => 'downstream');
    }";
    let dir = tempdir().unwrap();
    let p = simple_plugin(dir.path(), "p", src);
    let (mut rt, _) = runtime_with(fast_budgets());
    rt.load_plugin(&p, Tier::User).unwrap();
    assert_eq!(rt.dispatch("c", &json!({})).unwrap().value, json!("downstream"));
    let d = rt.take_diagnostics();
    assert!(d.iter().any(|d| d.message.contains(".catch handler timed out")), "{d:?}");
}

#[test]
fn a_hook_that_throws_after_next_keeps_the_downstream_answer() {
    let src = "export function register(on) {
        on('late', async (_$, e, next) => { await next(e); throw new Error('too late'); });
        on('late', async () => 'downstream');
    }";
    let dir = tempdir().unwrap();
    let p = simple_plugin(dir.path(), "p", src);
    let (mut rt, _) = runtime();
    rt.load_plugin(&p, Tier::User).unwrap();
    assert_eq!(rt.dispatch("late", &json!({})).unwrap().value, json!("downstream"));
}

#[test]
fn next_to_jumps_to_a_tier_and_next_origin_names_the_hook() {
    let dir = tempdir().unwrap();
    let jump = simple_plugin(
        dir.path(),
        "jump",
        "export function register(on) { on('t', async (_$, e, next) => ({ origin: next.origin, down: await next.to(e, 'append') })); }",
    );
    let skipped = simple_plugin(dir.path(), "skipped", "export function register(on) { on('t', async () => 'user tier'); }");
    let tail = simple_plugin(dir.path(), "tail", "export function register(on) { on('t', async () => 'append tier'); }");
    let (mut rt, _) = runtime();
    rt.load_plugins(&[(&jump, Tier::User), (&skipped, Tier::User), (&tail, Tier::Append)]).unwrap();
    let v = rt.dispatch("t", &json!({})).unwrap().value;
    assert_eq!(v, json!({ "origin": { "plugin": "jump", "tier": "user" }, "down": "append tier" }));
}

#[test]
fn memory_and_stack_overruns_throw_inside_the_hook_and_the_isolate_survives() {
    let src = "export function register(on) {
        on('mem', async () => { const keep = []; for (;;) keep.push(new Array(10000).fill(1)); });
        on('mem', async () => 'after');
        on('deep', async () => { const f = (n) => f(n + 1) + 1; return f(0); });
        on('deep', async () => 'after');
    }";
    let dir = tempdir().unwrap();
    let p = simple_plugin(dir.path(), "p", src);
    let (mut rt, _) = runtime_with(RuntimeConfig { memory_limit: 16 * 1024 * 1024, ..RuntimeConfig::default() });
    rt.load_plugin(&p, Tier::User).unwrap();
    assert_eq!(rt.dispatch("mem", &json!({})).unwrap().value, json!("after"));
    assert_eq!(rt.dispatch("deep", &json!({})).unwrap().value, json!("after"));
    assert!(rt.memory().used < 16 * 1024 * 1024, "{:?}", rt.memory());
}

#[test]
fn a_refused_host_call_rejects_with_its_code() {
    let src = "export function register(on) { on('r', async ($) => { try { await $.ui.toast('hi'); return 'sent'; } catch (e) { return e.code; } }); }";
    let dir = tempdir().unwrap();
    let p = simple_plugin(dir.path(), "p", src);
    let (mut rt, host) = runtime();
    rt.load_plugin(&p, Tier::User).unwrap();
    host.refuse("ui.toast");
    assert_eq!(rt.dispatch("r", &json!({})).unwrap().value, json!("hx.policy.denied"));
}

#[test]
fn register_that_throws_or_spins_fails_the_load() {
    let dir = tempdir().unwrap();
    let throws = simple_plugin(dir.path(), "throws", "export function register() { throw new Error('bad config'); }");
    let spins = simple_plugin(dir.path(), "spins", "export function register() { while (true) {} }");
    let (mut rt, _) = runtime_with(fast_budgets());
    let e = rt.load_plugin(&throws, Tier::User).unwrap_err();
    assert!(e.to_string().contains("bad config"), "{e}");
    let e = rt.load_plugin(&spins, Tier::User).unwrap_err();
    assert!(e.to_string().contains("timed out") || e.to_string().contains("budget"), "{e}");
}
