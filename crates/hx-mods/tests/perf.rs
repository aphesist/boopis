//! The spike's budgets from `docs/MODS.md` section 5, measured:
//!
//! | What | Budget |
//! |---|---|
//! | isolate start plus loading the three example mods | 50 ms |
//! | one no-op event through the chain | 1 ms |
//!
//! plus a `ui.render` of 1,000 elements and the memory an isolate holds. The strict run is
//! `#[ignore]` because wall-clock budgets depend on the machine and need an optimised build:
//!
//! ```text
//! cargo test -p hx-mods --release --test perf -- --ignored --nocapture
//! ```
//!
//! A lenient guard runs in the normal suite to catch an order-of-magnitude regression.

// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::fs;
use std::hint::black_box;
use std::time::{Duration, Instant};

use common::{example, simple_plugin, write_plugin};
use hx_mods::fixtures::MemoryHost;
use hx_mods::{ModRuntime, Render, RuntimeConfig, Tier, transform};
use serde_json::json;
use tempfile::tempdir;

const EXAMPLES: [&str; 3] = ["counter-pane", "hello-command", "prompt-band"];

struct Stats {
    median: Duration,
    p95: Duration,
    min: Duration,
    max: Duration,
}

fn stats(mut runs: Vec<Duration>) -> Stats {
    runs.sort();
    Stats {
        median: runs[runs.len() / 2],
        p95: runs[runs.len() * 95 / 100],
        min: runs[0],
        max: runs[runs.len() - 1],
    }
}

impl std::fmt::Display for Stats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "median {:?}, p95 {:?}, min {:?}, max {:?}",
            self.median, self.p95, self.min, self.max
        )
    }
}

fn time<T>(f: impl FnOnce() -> T) -> (T, Duration) {
    let start = Instant::now();
    let out = f();
    (out, start.elapsed())
}

fn load_examples(rt: &mut ModRuntime) {
    let dirs: Vec<_> = EXAMPLES.iter().map(|n| example(n)).collect();
    let plugins: Vec<_> = dirs.iter().map(|d| (d.as_path(), Tier::User)).collect();
    rt.load_plugins(&plugins).unwrap();
}

fn new_runtime() -> ModRuntime {
    ModRuntime::new(Box::new(MemoryHost::new()), RuntimeConfig::default()).unwrap()
}

/// Isolate start, loading the three examples, and the two together.
fn start_and_load(rounds: usize) -> (Stats, Stats, Stats) {
    let (mut start, mut load, mut total) = (Vec::new(), Vec::new(), Vec::new());
    for _ in 0..rounds {
        let (mut rt, s) = time(new_runtime);
        let ((), l) = time(|| load_examples(&mut rt));
        start.push(s);
        load.push(l);
        total.push(s + l);
    }
    (stats(start), stats(load), stats(total))
}

/// A plugin whose `perf` hook passes the event on, so an event crosses `hooks` of them.
fn pass_through_chain(root: &std::path::Path, hooks: usize) -> ModRuntime {
    let mut rt = new_runtime();
    for i in 0..hooks {
        let p = simple_plugin(
            root,
            &format!("pass{i}"),
            "export function register(on) { on('perf', async (_$, e, next) => next(e)); }",
        );
        rt.load_plugin(&p, Tier::User).unwrap();
    }
    rt
}

fn dispatch_times(rt: &mut ModRuntime, event: &str, rounds: usize) -> Stats {
    for _ in 0..50 {
        black_box(rt.dispatch(event, &json!({ "text": "hello" })).unwrap());
    }
    stats(
        (0..rounds)
            .map(|_| time(|| black_box(rt.dispatch(event, &json!({ "text": "hello" })).unwrap())).1)
            .collect(),
    )
}

const THOUSAND: &str = "
import { Box, Text, Button } from 'claude-code';
export function register(on) {
  on('ui.render', { component: 'Pane', id: 'plain' }, async () =>
    Box({ flexDirection: 'column' }, Array.from({ length: 999 }, (_, i) => Text({ color: i % 2 ? 'subtle' : 'text', dimColor: i % 3 === 0 }, `row ${i}: some text that is typical of a line`))));
  on('ui.render', { component: 'Pane', id: 'buttons' }, async ($) =>
    Box({ flexDirection: 'column' }, Array.from({ length: 999 }, (_, i) => (i % 4 === 0 ? Button({ onPress: () => $.ui.log('x' + i) }, `row ${i}`) : Text(`row ${i}`)))));
}";

fn render_times(rt: &mut ModRuntime, id: &str, rounds: usize) -> (Stats, usize) {
    let mut elements = 0;
    let mut one = || {
        let r = rt.render("Pane", Some(id), &json!({})).unwrap();
        let Render::Tree { stats, .. } = r else {
            panic!("expected a tree, got {r:?}")
        };
        elements = stats.elements;
    };
    for _ in 0..3 {
        one();
    }
    let runs = (0..rounds).map(|_| time(&mut one).1).collect();
    (stats(runs), elements)
}

fn status_kb(field: &str) -> Option<u64> {
    let text = fs::read_to_string("/proc/self/status").ok()?;
    let line = text.lines().find(|l| l.starts_with(field))?;
    line.split_whitespace().nth(1)?.parse().ok()
}

#[test]
#[ignore = "wall-clock budgets; run explicitly with --release --nocapture"]
fn budgets_and_measurements() {
    println!("--- isolate start and loading (budget 50 ms for the sum) ---");
    let (start, load, total) = start_and_load(40);
    println!("isolate start:               {start}");
    println!("load three example mods:     {load}");
    println!("start + load:                {total}");
    // The cost of the transform alone, per file, for the TypeScript and JSX in the examples.
    for file in [
        "counter-pane/src/register.ts",
        "counter-pane/src/view.tsx",
        "hello-command/register.mts",
        "prompt-band/register.jsx",
    ] {
        let source = fs::read_to_string(example(".").join(file)).unwrap();
        let runs = (0..50)
            .map(|_| time(|| black_box(transform::prepare(file, &source).unwrap())).1)
            .collect();
        println!("  oxc transform {file:<32} {}", stats(runs));
    }

    println!("--- chain dispatch overhead (budget 1 ms per event) ---");
    let dir = tempdir().unwrap();
    let mut none = pass_through_chain(dir.path(), 0);
    let no_hooks = dispatch_times(&mut none, "perf", 5000);
    println!("event, no hooks:             {no_hooks}");
    let mut one = pass_through_chain(dir.path(), 1);
    let one_hook = dispatch_times(&mut one, "perf", 5000);
    println!("event, 1 pass-through hook:  {one_hook}");
    let mut three = pass_through_chain(dir.path(), 3);
    let three_hooks = dispatch_times(&mut three, "perf", 5000);
    println!("event, 3 pass-through hooks: {three_hooks}");
    let mut miss = pass_through_chain(dir.path(), 3);
    let missed = dispatch_times(&mut miss, "other", 5000);
    println!("event nobody registered for, with 3 mods loaded: {missed}");

    println!("--- ui.render of 1,000 elements ---");
    let plugin = write_plugin(
        dir.path(),
        "thousand",
        "register.jsx",
        &[("register.jsx", THOUSAND)],
    );
    let mut rt = new_runtime();
    rt.load_plugin(&plugin, Tier::User).unwrap();
    let (plain, n) = render_times(&mut rt, "plain", 100);
    println!("{n} elements, no handlers:   {plain}");
    let (buttons, n) = render_times(&mut rt, "buttons", 100);
    println!("{n} elements, 250 buttons:   {buttons}");

    println!("--- memory ---");
    let rss_before = status_kb("VmRSS:");
    let mut keep = Vec::new();
    for _ in 0..10 {
        let mut rt = new_runtime();
        load_examples(&mut rt);
        keep.push(rt);
    }
    let rss_after = status_kb("VmRSS:");
    let one_rt = &keep[0];
    println!(
        "engine heap, 3 mods loaded:  used {} KiB, allocated {} KiB",
        one_rt.memory().used / 1024,
        one_rt.memory().allocated / 1024
    );
    if let (Some(a), Some(b)) = (rss_before, rss_after) {
        println!(
            "resident set, 10 isolates with 3 mods each: +{} KiB (about {} KiB per isolate); process peak {} KiB",
            b.saturating_sub(a),
            b.saturating_sub(a) / 10,
            status_kb("VmHWM:").unwrap_or(0)
        );
    }
    drop(keep);
    let heavy = rt.memory();
    println!(
        "engine heap after the 1,000-element renders: used {} KiB",
        heavy.used / 1024
    );

    // The budgets.
    assert!(
        total.median < Duration::from_millis(50),
        "start + load: {total}"
    );
    assert!(
        no_hooks.median < Duration::from_millis(1),
        "no hooks: {no_hooks}"
    );
    assert!(
        three_hooks.median < Duration::from_millis(1),
        "three hooks: {three_hooks}"
    );
}

#[test]
fn start_load_and_dispatch_stay_far_inside_their_budgets_even_in_a_debug_build() {
    let (_, _, total) = start_and_load(3);
    assert!(total.min < Duration::from_secs(1), "{total}");
    let dir = tempdir().unwrap();
    let mut rt = pass_through_chain(dir.path(), 3);
    let t = dispatch_times(&mut rt, "perf", 200);
    assert!(t.median < Duration::from_millis(20), "{t}");
}

#[test]
fn the_heap_does_not_grow_with_events_renders_presses_and_ticks() {
    // Every kind of traffic, repeated: the kernel keeps handler, atom, site and timer tables, and
    // none of them may grow with the number of events. A leak shows as the heap climbing.
    let dir = tempdir().unwrap();
    let mut rt = new_runtime();
    let pane = example("counter-pane");
    rt.load_plugin(&pane, Tier::User).unwrap();
    let pass = simple_plugin(
        dir.path(),
        "pass",
        "export function register(on) { on('perf', async (_$, e, next) => next({ ...e, n: 1 })); }",
    );
    rt.load_plugin(&pass, Tier::User).unwrap();
    rt.dispatch("session.start", &json!({})).unwrap();
    let timer = {
        // The clock id the pane registered: read it from the tick that works.
        (1..=3)
            .map(|n| format!("0.t{n}"))
            .find(|id| rt.tick(id).unwrap())
            .unwrap()
    };
    let round = |rt: &mut ModRuntime| {
        for _ in 0..200 {
            rt.dispatch("perf", &json!({ "text": "hello" })).unwrap();
            rt.tick(&timer).unwrap();
            let Render::Tree { tree, .. } = rt.render("Pane", Some("counter"), &json!({})).unwrap()
            else {
                panic!("no tree")
            };
            let id = tree["children"][2]["props"]["onPress"]["$handler"]
                .as_str()
                .unwrap()
                .to_owned();
            assert!(rt.press(&id).unwrap());
        }
    };
    for _ in 0..3 {
        round(&mut rt); // warm up the allocator and the collector
    }
    rt.collect_garbage();
    let warm = rt.memory().used;
    for _ in 0..10 {
        round(&mut rt);
    }
    rt.collect_garbage();
    let after = rt.memory().used;
    println!("heap after warm-up {warm} B, after 2,000 more rounds {after} B");
    // 2,000 more rounds of everything: allow slack for collector timing, nothing like growth per round.
    assert!(
        after < warm + 256 * 1024,
        "heap went from {warm} to {after} bytes over 2,000 rounds"
    );
}
