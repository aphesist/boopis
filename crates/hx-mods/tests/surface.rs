//! The `$` API the spike implements, the element trees a mod draws, and the round trip from a
//! tree back to the mod's handlers.

// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::{handler, runtime, simple_plugin, text_of, tree, write_plugin};
use hx_mods::fixtures::MemoryHost;
use hx_mods::{HostCalls, HostRequest, ModRuntime, Render, RuntimeConfig, Tier};
use serde_json::{Value, json};
use tempfile::tempdir;

/// Loads one JavaScript mod from `source` into a fresh runtime.
fn with_mod(source: &str) -> (ModRuntime, MemoryHost, tempfile::TempDir) {
    let dir = tempdir().unwrap();
    let plugin = simple_plugin(dir.path(), "mod", source);
    let (mut rt, host) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    (rt, host, dir)
}

fn render(rt: &mut ModRuntime, component: &str, id: Option<&str>) -> Render {
    rt.render(component, id, &json!({})).unwrap()
}

// ---- `$.ui` and `$.plugin` ----------------------------------------------------------------------

#[test]
fn every_ui_call_leaves_the_isolate_as_one_host_request_with_the_callers_name() {
    let (mut rt, host, _dir) = with_mod(
        "export function register(on) { on('go', async ($) => {
            const placed = await $.ui.open({ id: 'p', title: 'T', focus: true, rows: 5 });
            await $.ui.invalidate();
            await $.ui.invalidate('ui.render');
            await $.ui.toast('hello', { timeoutMs: 1500 });
            await $.ui.toast('plain');
            await $.ui.status('busy');
            await $.ui.log('a line');
            await $.ui.close({ id: 'p' });
            return { placed, name: $.plugin.name, tier: $.plugin.tier };
        }); }",
    );
    let out = rt.dispatch("go", &json!({})).unwrap().value;
    assert_eq!(
        out,
        json!({ "placed": { "isPlaced": true }, "name": "mod", "tier": "user" })
    );
    let calls: Vec<(String, Value)> = host.calls().into_iter().map(|c| (c.call, c.args)).collect();
    assert_eq!(
        calls,
        [
            (
                "ui.open".to_owned(),
                json!({ "id": "p", "title": "T", "focus": true, "rows": 5 })
            ),
            ("ui.invalidate".to_owned(), json!({ "target": "ui.render" })),
            ("ui.invalidate".to_owned(), json!({ "target": "ui.render" })),
            (
                "ui.toast".to_owned(),
                json!({ "text": "hello", "timeoutMs": 1500 })
            ),
            ("ui.toast".to_owned(), json!({ "text": "plain" })),
            ("ui.status".to_owned(), json!({ "text": "busy" })),
            ("ui.log".to_owned(), json!({ "text": "a line" })),
            ("ui.close".to_owned(), json!({ "id": "p" })),
        ]
    );
    assert!(host.calls().iter().all(|c| c.plugin == "mod"));
}

#[test]
fn dollar_is_frozen_and_a_mod_cannot_name_another_plugin_in_a_call() {
    let (mut rt, host, _dir) = with_mod(
        "export function register(on) { on('t', async ($) => {
            const out = { frozen: Object.isFrozen($) && Object.isFrozen($.ui), keys: Object.keys($).sort() };
            try { $.ui.log = () => {}; } catch { out.threw = true; }
            try { $.evil = 1; } catch { out.threwAdd = true; }
            await $.ui.log('x');
            return out;
        }); }",
    );
    let out = rt.dispatch("t", &json!({})).unwrap().value;
    assert_eq!(out["frozen"], true);
    assert_eq!(
        out["keys"],
        json!([
            "agent",
            "audio",
            "clock",
            "command",
            "config",
            "env",
            "fs",
            "http",
            "mcp",
            "model",
            "plugin",
            "process",
            "prompt",
            "session",
            "settings",
            "state",
            "store",
            "telemetry",
            "theme",
            "tool",
            "turn",
            "ui"
        ])
    );
    assert_eq!(
        (out["threw"].as_bool(), out["threwAdd"].as_bool()),
        (Some(true), Some(true))
    );
    assert_eq!(host.calls()[0].plugin, "mod");
}

/// A host that panics on every call: the panic must come back as an error, not abort the process.
struct Panicky;
impl HostCalls for Panicky {
    fn call(&mut self, _: hx_mods::CallId, _: &HostRequest) -> hx_mods::HostReply {
        panic!("the host is broken");
    }
}

#[test]
fn a_panicking_host_becomes_an_error_in_the_hook() {
    let dir = tempdir().unwrap();
    let plugin = simple_plugin(
        dir.path(),
        "mod",
        "export function register(on) { on('t', async ($) => { try { await $.ui.log('x'); return 'no error'; } catch (e) { return e.code; } }); }",
    );
    let mut rt = ModRuntime::new(Box::new(Panicky), RuntimeConfig::default()).unwrap();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    assert_eq!(
        rt.dispatch("t", &json!({})).unwrap().value,
        json!("hx.internal")
    );
    assert_eq!(
        rt.dispatch("t", &json!({})).unwrap().value,
        json!("hx.internal"),
        "the isolate is still usable"
    );
}

// ---- `$.state` ----------------------------------------------------------------------------------

const TWO_SITES: &str = "
import { Text } from 'claude-code';
let a, b;
export function register(on) {
  on('init', async ($) => { a = $.state.atom(1); b = $.state.atom(10); });
  on('bump-a', async ($) => $.state.update(a, (n) => n + 1));
  on('bump-b', async ($) => $.state.update(b, 99));
  on('foreign', async ($) => { try { $.state.read({ id: 'a1' + 'x' }); return 'read'; } catch (e) { return e.constructor.name; } });
  on('ui.render', { component: 'Pane' }, async ($) => Text($.state.read(a)));
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => (e.props.useB ? Text($.state.read(b)) : Text('static')));
}";

fn invalidations(host: &MemoryHost) -> Vec<Value> {
    host.calls_to("ui.invalidate")
        .into_iter()
        .map(|c| c.args)
        .collect()
}

#[test]
fn updating_an_atom_redraws_exactly_the_sites_that_read_it() {
    let dir = tempdir().unwrap();
    let plugin = write_plugin(
        dir.path(),
        "mod",
        "register.jsx",
        &[("register.jsx", TWO_SITES)],
    );
    let (mut rt, host) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    rt.dispatch("init", &json!({})).unwrap();

    assert_eq!(
        text_of(&json!({ "children": [tree(rt.render("Pane", None, &json!({})).unwrap())] })),
        "1"
    );
    rt.render("AbovePrompt", None, &json!({ "useB": true }))
        .unwrap();

    rt.dispatch("bump-a", &json!({})).unwrap();
    assert_eq!(
        invalidations(&host),
        [json!({ "target": "ui.render", "component": "Pane" })]
    );
    host.clear();
    rt.dispatch("bump-b", &json!({})).unwrap();
    assert_eq!(
        invalidations(&host),
        [json!({ "target": "ui.render", "component": "AbovePrompt" })]
    );

    // A redraw that stops reading the atom drops the subscription: no more invalidations.
    rt.render("AbovePrompt", None, &json!({ "useB": false }))
        .unwrap();
    host.clear();
    rt.dispatch("bump-b", &json!({})).unwrap();
    assert!(invalidations(&host).is_empty());
}

#[test]
fn state_updates_are_visible_to_the_next_render_and_return_the_new_value() {
    let (mut rt, _host, _dir) = with_mod(
        "import { Text } from 'claude-code';
         let n;
         export function register(on) {
           on('init', async ($) => { n = $.state.atom(0); });
           on('add', async ($, e) => $.state.update(n, (v) => v + e.by));
           on('ui.render', { component: 'Pane' }, async ($) => Text(String($.state.read(n))));
         }",
    );
    rt.dispatch("init", &json!({})).unwrap();
    assert_eq!(
        rt.dispatch("add", &json!({ "by": 2 })).unwrap().value,
        json!(2)
    );
    assert_eq!(
        rt.dispatch("add", &json!({ "by": 3 })).unwrap().value,
        json!(5)
    );
    let t = tree(render(&mut rt, "Pane", None));
    assert_eq!(t["children"], json!(["5"]));
}

#[test]
fn an_atom_handle_from_another_plugin_is_rejected() {
    let dir = tempdir().unwrap();
    let a = simple_plugin(
        dir.path(),
        "owner",
        "export function register(on) { on('mk', async ($) => $.state.atom(1)); }",
    );
    let b = simple_plugin(
        dir.path(),
        "thief",
        "export function register(on) { on('steal', async ($, e) => { try { return $.state.read(e.handle); } catch (x) { return x.constructor.name; } }); }",
    );
    let (mut rt, _) = runtime();
    rt.load_plugins(&[(&a, Tier::User), (&b, Tier::User)])
        .unwrap();
    let handle = rt.dispatch("mk", &json!({})).unwrap().value;
    assert_eq!(
        rt.dispatch("steal", &json!({ "handle": handle }))
            .unwrap()
            .value,
        json!("TypeError")
    );
}

// ---- `$.clock` ----------------------------------------------------------------------------------

#[test]
fn clock_every_registers_with_the_host_ticks_on_demand_and_stops() {
    let (mut rt, host, _dir) = with_mod(
        "let ticks = 0, stop;
         export function register(on) {
           on('start', async ($) => { stop = $.clock.every(250, () => { ticks++; }); return stop.id; });
           on('read', async () => ticks);
           on('stop', async () => { stop(); stop(); });
           on('bad', async ($) => { const out = []; for (const args of [[0, () => {}], [-1, () => {}], [10, 'x'], [NaN, () => {}]]) { try { $.clock.every(...args); out.push('ok'); } catch (e) { out.push(e.constructor.name); } } return out; });
         }",
    );
    let id = rt.dispatch("start", &json!({})).unwrap().value;
    assert_eq!(
        host.calls_to("clock.every")[0].args,
        json!({ "id": id, "ms": 250 })
    );
    let id = id.as_str().unwrap();
    assert!(rt.tick(id).unwrap());
    assert!(rt.tick(id).unwrap());
    assert_eq!(rt.dispatch("read", &json!({})).unwrap().value, json!(2));
    rt.dispatch("stop", &json!({})).unwrap();
    // Cancelled once, however many times `stop` is called, and a late tick does nothing.
    assert_eq!(host.calls_to("clock.cancel").len(), 1);
    assert!(!rt.tick(id).unwrap());
    assert_eq!(rt.dispatch("read", &json!({})).unwrap().value, json!(2));
    assert_eq!(
        rt.dispatch("bad", &json!({})).unwrap().value,
        json!(["TypeError", "TypeError", "TypeError", "TypeError"])
    );
}

#[test]
fn a_tick_handler_that_throws_is_skipped_and_logged() {
    let (mut rt, _host, _dir) = with_mod(
        "export function register(on) { on('start', async ($) => $.clock.every(5, () => { throw new Error('tick broke'); }).id); }",
    );
    let id = rt.dispatch("start", &json!({})).unwrap().value;
    assert!(!rt.tick(id.as_str().unwrap()).unwrap());
    assert!(
        rt.take_diagnostics()
            .iter()
            .any(|d| d.message.contains("tick broke"))
    );
}

// ---- `$.command` ------------------------------------------------------------------------------

#[test]
fn command_register_goes_to_the_host_and_command_run_reaches_the_matching_hook() {
    let (mut rt, host, _dir) = with_mod(
        "export function register(on) {
           on('session.start', async ($) => { await $.command.register({ name: 'ping', description: 'Pong', argumentHint: '[x]', immediate: true }); });
           on('command.run', { name: 'ping' }, async (_$, e) => ({ text: 'pong ' + e.args }));
         }",
    );
    rt.dispatch("session.start", &json!({})).unwrap();
    assert_eq!(
        host.calls_to("command.register")[0].args,
        json!({ "name": "ping", "description": "Pong", "argumentHint": "[x]", "immediate": true })
    );
    assert_eq!(
        rt.run_command("ping", "now").unwrap().value,
        json!({ "text": "pong now" })
    );
    assert!(!rt.run_command("other", "").unwrap().answered);
}

// ---- element trees --------------------------------------------------------------------------

#[test]
fn box_text_button_markdown_input_and_select_serialize_with_handlers_as_ids() {
    let (mut rt, _host, _dir) = with_mod(
        "import { Box, Text, Button, Markdown, Input, Select } from 'claude-code';
         export function register(on) {
           on('ui.render', { component: 'Pane' }, async () =>
             Box({ flexDirection: 'column', padding: 1, borderStyle: 'round' },
               Text({ color: 'success', bold: true }, 'a', 2, null, false, ['x', undefined, 'y']),
               Button({ onPress: () => {}, hotkey: 'ctrl+k', variant: 'primary' }, 'Go'),
               Markdown({ text: '**hi**' }),
               Input({ placeholder: 'type', rows: 2, onInput: () => {}, onSubmit: () => {} }),
               Select({ options: [{ label: 'One', value: '1' }], onSelect: () => {} }),
               Text({ dimColor: undefined, size: 12 }),
             ));
         }",
    );
    let Render::Tree { tree: t, stats } = render(&mut rt, "Pane", None) else {
        panic!("no tree")
    };
    assert_eq!((stats.elements, stats.depth), (7, 2));
    assert_eq!(t["type"], "Box");
    assert_eq!(
        t["props"],
        json!({ "flexDirection": "column", "padding": 1, "borderStyle": "round" })
    );
    let kids = t["children"].as_array().unwrap();
    // Numbers become text, null/false/undefined vanish, and nested arrays flatten.
    assert_eq!(
        kids[0],
        json!({ "type": "Text", "props": { "color": "success", "bold": true }, "children": ["a", "2", "x", "y"] })
    );
    assert_eq!(kids[1]["props"]["hotkey"], "ctrl+k");
    assert!(
        kids[1]["props"]["onPress"]["$handler"]
            .as_str()
            .unwrap()
            .contains(".h")
    );
    assert_eq!(kids[2]["props"], json!({ "text": "**hi**" }));
    assert!(
        kids[3]["props"]["onInput"]["$handler"].is_string()
            && kids[3]["props"]["onSubmit"]["$handler"].is_string()
    );
    assert_eq!(kids[3]["props"]["placeholder"], "type");
    assert_eq!(
        kids[4]["props"]["options"],
        json!([{ "label": "One", "value": "1" }])
    );
    // An `undefined` prop is dropped, so the wire JSON has no `null` stand-ins.
    assert_eq!(kids[5]["props"], json!({ "size": 12 }));
    // Handler ids are distinct, and no function survives into the JSON.
    assert!(!t.to_string().contains("function"));
}

#[test]
fn each_handler_kind_reaches_its_own_callback_with_the_value() {
    let (mut rt, host, _dir) = with_mod(
        "import { Box, Button, Input, Select } from 'claude-code';
         export function register(on) {
           on('ui.render', { component: 'Pane' }, async ($) =>
             Box(
               Button({ onPress: () => $.ui.log('pressed') }, 'b'),
               Input({ onInput: (v) => $.ui.log('input:' + v), onSubmit: (v) => $.ui.log('submit:' + v) }),
               Select({ options: [], onSelect: (v) => $.ui.log('select:' + v) }),
             ));
         }",
    );
    let t = tree(render(&mut rt, "Pane", None));
    assert!(rt.press(&handler(&t, "Button", "onPress")).unwrap());
    assert!(rt.input(&handler(&t, "Input", "onInput"), "he").unwrap());
    assert!(
        rt.input(&handler(&t, "Input", "onSubmit"), "hello")
            .unwrap()
    );
    assert!(
        rt.select(&handler(&t, "Select", "onSelect"), "two")
            .unwrap()
    );
    let logs: Vec<_> = host
        .calls_to("ui.log")
        .iter()
        .map(|c| c.args["text"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(logs, ["pressed", "input:he", "submit:hello", "select:two"]);
    assert!(!rt.press("h99999").unwrap());
}

#[test]
fn a_press_reaches_the_mod_that_drew_the_button() {
    let dir = tempdir().unwrap();
    let make = |name: &str| {
        simple_plugin(
            dir.path(),
            name,
            &format!(
                "import {{ Button }} from 'claude-code';
                 export function register(on) {{ on('ui.render', {{ component: '{name}' }}, async ($) => Button({{ onPress: () => $.ui.log('{name} pressed') }}, 'b')); }}"
            ),
        )
    };
    let (one, two) = (make("one"), make("two"));
    let (mut rt, host) = runtime();
    rt.load_plugins(&[(&one, Tier::User), (&two, Tier::User)])
        .unwrap();
    let t1 = tree(rt.render("one", None, &json!({})).unwrap());
    let t2 = tree(rt.render("two", None, &json!({})).unwrap());
    let (h1, h2) = (
        handler(&t1, "Button", "onPress"),
        handler(&t2, "Button", "onPress"),
    );
    assert_ne!(h1, h2);
    rt.press(&h2).unwrap();
    rt.press(&h1).unwrap();
    let seen: Vec<_> = host
        .calls()
        .into_iter()
        .map(|c| (c.plugin, c.args["text"].as_str().unwrap().to_owned()))
        .collect();
    assert_eq!(
        seen,
        [
            ("two".to_owned(), "two pressed".to_owned()),
            ("one".to_owned(), "one pressed".to_owned())
        ]
    );
}

#[test]
fn a_handler_that_throws_is_logged_and_the_next_press_still_works() {
    let (mut rt, host, _dir) = with_mod(
        "import { Button } from 'claude-code';
         let fail = true;
         export function register(on) { on('ui.render', { component: 'Pane' }, async ($) => Button({ onPress: () => { if (fail) { fail = false; throw new Error('first press'); } $.ui.log('ok'); } }, 'b')); }",
    );
    let h = handler(&tree(render(&mut rt, "Pane", None)), "Button", "onPress");
    assert!(!rt.press(&h).unwrap());
    assert!(
        rt.take_diagnostics()
            .iter()
            .any(|d| d.message.contains("first press"))
    );
    assert!(rt.press(&h).unwrap());
    assert_eq!(host.calls_to("ui.log").len(), 1);
}

#[test]
fn a_hook_can_change_props_with_next_and_a_site_nobody_draws_stays_with_the_host() {
    let (mut rt, _host, _dir) = with_mod(
        "export function register(on) { on('ui.render', { component: 'Spinner' }, async (_$, e, next) => next({ ...e, props: { ...e.props, label: 'Thinking' } })); }",
    );
    let r = rt
        .render("Spinner", None, &json!({ "label": 'x', "keep": 1 }))
        .unwrap();
    assert_eq!(
        r,
        Render::Default {
            props: Some(json!({ "label": "Thinking", "keep": 1 }))
        }
    );
    assert_eq!(
        rt.render("Pane", None, &json!({})).unwrap(),
        Render::Default {
            props: Some(json!({}))
        }
    );
}

#[test]
fn something_that_is_not_an_element_is_skipped_with_a_log_line() {
    let (mut rt, _host, _dir) = with_mod(
        "export function register(on) {
           on('ui.render', { component: 'Pane', id: 'str' }, async () => 'just text');
           on('ui.render', { component: 'Pane', id: 'obj' }, async () => ({ type: 'Box', props: {}, children: [] }));
           on('ui.render', { component: 'Pane', id: 'html' }, async () => ({ __html: '<b>x</b>' }));
         }",
    );
    for id in ["str", "obj", "html"] {
        assert!(
            matches!(render(&mut rt, "Pane", Some(id)), Render::Skipped { .. }),
            "{id}"
        );
    }
    assert_eq!(
        rt.take_diagnostics()
            .iter()
            .filter(|d| d.message.contains("tree skipped"))
            .count(),
        3
    );
}

#[test]
fn a_prop_cannot_smuggle_a_handler_id_and_a_cycle_does_not_hang_or_crash() {
    let (mut rt, _host, _dir) = with_mod(
        "import { Box, Text } from 'claude-code';
         export function register(on) {
           on('ui.render', { component: 'Pane', id: 'forge' }, async () => Box({ onPress: { $handler: 'h1' } }));
           on('ui.render', { component: 'Pane', id: 'cycle' }, async () => { const c = {}; c.self = c; return Text({ data: c }, 'x'); });
           on('ui.render', { component: 'Pane', id: 'big' }, async () => Text({ n: 10n }, 'x'));
         }",
    );
    for id in ["forge", "cycle", "big"] {
        assert!(
            matches!(render(&mut rt, "Pane", Some(id)), Render::Skipped { .. }),
            "{id}"
        );
    }
}

// ---- the documented limits, through the whole pipeline ------------------------------------------

const BUILDERS: &str = "
import { Box, Text, Markdown, Button } from 'claude-code';
const nest = (depth) => { let t = Text('leaf'); for (let i = 1; i < depth; i++) t = Box(t); return t; };
export function register(on) {
  on('ui.render', { component: 'Pane' }, async (_$, e) => {
    const { kind, n } = e.props;
    if (kind === 'flat') return Box(Array.from({ length: n - 1 }, () => Text('x')));
    if (kind === 'deep') return nest(n);
    if (kind === 'chars') return Markdown({ text: 'é'.repeat(n) });
    return Button({ onPress: () => {} }, 'ok');
  });
}";

fn limits_runtime() -> (ModRuntime, tempfile::TempDir) {
    let dir = tempdir().unwrap();
    let plugin = write_plugin(
        dir.path(),
        "mod",
        "register.jsx",
        &[("register.jsx", BUILDERS)],
    );
    let (mut rt, _) = runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    (rt, dir)
}

fn draw(rt: &mut ModRuntime, kind: &str, n: u64) -> Render {
    rt.render("Pane", None, &json!({ "kind": kind, "n": n }))
        .unwrap()
}

#[test]
fn trees_at_the_documented_limits_draw() {
    let (mut rt, _dir) = limits_runtime();
    let Render::Tree { stats, .. } = draw(&mut rt, "flat", 20_000) else {
        panic!("20,000 elements")
    };
    assert_eq!(stats.elements, 20_000);
    let Render::Tree { stats, .. } = draw(&mut rt, "deep", 32) else {
        panic!("depth 32")
    };
    assert_eq!(stats.depth, 32);
    let Render::Tree { stats, .. } = draw(&mut rt, "chars", 100_000) else {
        panic!("100,000 characters")
    };
    assert_eq!(stats.chars, 100_000);
}

#[test]
fn trees_past_the_limits_are_skipped_and_the_mod_gets_a_log_line() {
    let (mut rt, _dir) = limits_runtime();
    for (kind, n, why) in [
        ("flat", 20_001, "elements"),
        ("deep", 33, "deeper"),
        ("deep", 70, "deeper"),
        ("chars", 100_001, "characters"),
    ] {
        match draw(&mut rt, kind, n) {
            Render::Skipped { reason } => assert!(reason.contains(why), "{kind} {n}: {reason}"),
            other => panic!("{kind} {n}: {other:?}"),
        }
    }
    let logged = rt.take_diagnostics();
    assert_eq!(
        logged
            .iter()
            .filter(|d| d.message.contains("tree skipped"))
            .count(),
        4,
        "{logged:?}"
    );
}

#[test]
fn a_skipped_tree_keeps_the_handlers_of_the_last_good_one() {
    let (mut rt, _dir) = limits_runtime();
    let good = tree(draw(&mut rt, "button", 0));
    let h = handler(&good, "Button", "onPress");
    assert!(matches!(
        draw(&mut rt, "chars", 100_001),
        Render::Skipped { .. }
    ));
    assert!(
        rt.press(&h).unwrap(),
        "the visible tree is still the good one"
    );
    // A newer good tree replaces them.
    let newer = tree(draw(&mut rt, "button", 0));
    assert!(!rt.press(&h).unwrap());
    assert!(rt.press(&handler(&newer, "Button", "onPress")).unwrap());
}

#[test]
fn the_limits_are_configurable_data() {
    let dir = tempdir().unwrap();
    let plugin = write_plugin(
        dir.path(),
        "mod",
        "register.jsx",
        &[("register.jsx", BUILDERS)],
    );
    let mut config = RuntimeConfig::default();
    config.tree.max_elements = 10;
    let (mut rt, _) = common::runtime_with(config);
    rt.load_plugin(&plugin, Tier::User).unwrap();
    assert!(matches!(draw(&mut rt, "flat", 10), Render::Tree { .. }));
    assert!(matches!(draw(&mut rt, "flat", 11), Render::Skipped { .. }));
}
