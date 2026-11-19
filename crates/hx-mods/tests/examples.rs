//! The three example mods, loaded from disk and driven the way the host will drive them.
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::{example, handler, runtime, text_of, tree};
use hx_mods::{Render, Tier};
use serde_json::json;

#[test]
fn pane_with_state_counter_button_and_clock_tick() {
    let (mut rt, host) = runtime();
    let loaded = rt
        .load_plugin(&example("counter-pane"), Tier::User)
        .unwrap();
    assert_eq!((loaded.name.as_str(), loaded.hooks), ("counter-pane", 2));
    assert!(loaded.modules[0].ends_with("src/register.ts"));

    rt.dispatch("session.start", &json!({})).unwrap();
    // `options` came from the manifest's userConfig defaults.
    assert_eq!(
        host.calls_to("ui.open")[0].args,
        json!({ "id": "counter", "title": "Counter" })
    );
    let every = host.calls_to("clock.every");
    assert_eq!(every.len(), 1);
    assert_eq!(every[0].args["ms"], 1000);
    let timer = every[0].args["id"].as_str().unwrap().to_owned();

    let first = tree(rt.render("Pane", Some("counter"), &json!({})).unwrap());
    assert_eq!(text_of(&first), "Count: 0|Ticks: 0|Increment");

    // Press: the button's handler id reaches the right `onPress`, which updates state, which
    // asks the host to redraw the sites that read it.
    host.clear();
    let button = handler(&first, "Button", "onPress");
    assert!(rt.press(&button).unwrap());
    let invalidations = host.calls_to("ui.invalidate");
    assert_eq!(invalidations.len(), 1);
    assert_eq!(
        invalidations[0].args,
        json!({ "target": "ui.render", "component": "Pane", "id": "counter" })
    );
    let second = tree(rt.render("Pane", Some("counter"), &json!({})).unwrap());
    assert_eq!(text_of(&second), "Count: 1|Ticks: 0|Increment");

    // The clock tick redraws the same site through state.
    host.clear();
    assert!(rt.tick(&timer).unwrap());
    assert_eq!(host.calls_to("ui.invalidate").len(), 1);
    let third = tree(rt.render("Pane", Some("counter"), &json!({})).unwrap());
    assert_eq!(text_of(&third), "Count: 1|Ticks: 1|Increment");

    // A handler id from a tree that has since been replaced is gone: nothing runs.
    assert!(!rt.press(&button).unwrap());
    assert!(
        rt.take_diagnostics()
            .iter()
            .any(|d| d.message.contains("is gone"))
    );
    assert!(rt.press(&handler(&third, "Button", "onPress")).unwrap());
}

#[test]
fn command_mod_registers_and_answers_command_run() {
    let (mut rt, host) = runtime();
    rt.load_plugin(&example("hello-command"), Tier::User)
        .unwrap();
    rt.dispatch("session.start", &json!({})).unwrap();
    let names: Vec<_> = host
        .calls_to("command.register")
        .iter()
        .map(|c| c.args["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(names, ["hello", "fingerprint"]);

    assert_eq!(
        rt.run_command("hello", " Ada ").unwrap().value,
        json!({ "text": "Hello, Ada!" })
    );
    assert_eq!(
        rt.run_command("hello", "").unwrap().value,
        json!({ "text": "Hello, world!" })
    );
    // TextEncoder and crypto.subtle.digest, matched through an array matcher.
    let sha = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    assert_eq!(
        rt.run_command("fingerprint", "abc").unwrap().value,
        json!({ "text": sha })
    );
    assert_eq!(
        rt.run_command("fp", "abc").unwrap().value,
        json!({ "text": sha })
    );
    assert!(!rt.run_command("nope", "").unwrap().answered);
}

#[test]
fn band_reads_is_working_and_a_throwing_hook_is_skipped_or_caught() {
    let (mut rt, _host) = runtime();
    rt.load_plugin(&example("prompt-band"), Tier::User).unwrap();

    let working = tree(
        rt.render("AbovePrompt", None, &json!({ "isWorking": true }))
            .unwrap(),
    );
    assert_eq!(text_of(&working), "Working");
    assert_eq!(working["children"][0]["props"]["color"], "warning");
    let idle = tree(
        rt.render("AbovePrompt", None, &json!({ "isWorking": false }))
            .unwrap(),
    );
    assert_eq!(text_of(&idle), "Idle");

    // The first AbovePrompt hook throws with no `.catch`: skipped, and the band still drew.
    let diags = rt.take_diagnostics();
    assert!(
        diags
            .iter()
            .any(|d| d.plugin == "prompt-band" && d.message.contains("threw: boom")),
        "{diags:?}"
    );

    // The list hook throws too, but its `.catch` answers, and sees why.
    let list = tree(rt.render("AbovePromptList", None, &json!({})).unwrap());
    assert_eq!(
        text_of(&list),
        "recovered from a throw (hook called next: false)"
    );

    // Nothing for a site no mod draws: the host keeps its own drawing.
    assert_eq!(
        rt.render("Spinner", None, &json!({ "a": 1 })).unwrap(),
        Render::Default {
            props: Some(json!({ "a": 1 }))
        }
    );
}

#[test]
fn all_three_share_one_isolate() {
    let (mut rt, host) = runtime();
    let a = example("counter-pane");
    let b = example("hello-command");
    let c = example("prompt-band");
    let loaded = rt
        .load_plugins(&[(&a, Tier::User), (&b, Tier::User), (&c, Tier::User)])
        .unwrap();
    assert_eq!(loaded.len(), 3);
    rt.dispatch("session.start", &json!({})).unwrap();
    assert_eq!(host.calls_to("ui.open").len(), 1);
    assert_eq!(host.calls_to("command.register").len(), 2);
    assert!(rt.render("Pane", Some("counter"), &json!({})).is_ok());
    assert_eq!(
        rt.run_command("hello", "x").unwrap().value,
        json!({ "text": "Hello, x!" })
    );
    assert_eq!(
        text_of(&tree(
            rt.render("AbovePrompt", None, &json!({ "isWorking": false }))
                .unwrap()
        )),
        "Idle"
    );
    // Every call carries the plugin it came from.
    assert!(
        host.calls()
            .iter()
            .all(|c| ["counter-pane", "hello-command", "prompt-band"].contains(&c.plugin.as_str()))
    );
}
