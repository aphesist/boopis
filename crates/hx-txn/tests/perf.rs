//! The performance budget from `docs/STANDARDS.md` section 6: `ship` validate + journal + apply
//! on 10 files in under 100 ms (the gate excluded).
//!
//! The strict measurement is `#[ignore]` because wall-clock budgets depend on the machine's
//! fsync latency:
//!
//! ```text
//! cargo test -p hx-txn --release --test perf -- --ignored --nocapture
//! ```
//!
//! A lenient guard runs in the normal suite to catch an order-of-magnitude regression.
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::time::{Duration, Instant};

use common::{Fixture, engine, fixture, never, put, replace};
use hx_proto::txn::ApplyParams;

fn body(i: usize) -> String {
    (0..200)
        .map(|l| format!("line {l} of file {i}: let value_{l} = compute({l});\n"))
        .collect::<Vec<_>>()
        .concat()
}

fn ten_files() -> (Fixture, ApplyParams) {
    let fx = fixture();
    let mut edits = Vec::new();
    for i in 0..10 {
        let path = format!("src/mod{}/file{i}.rs", i % 3);
        put(&fx.root, &path, &body(i), 0o644);
        edits.push(replace(&path, "line 100 of", "LINE 100 of"));
    }
    let params = fx.apply_params(edits);
    (fx, params)
}

fn time_once() -> Duration {
    let (fx, params) = ten_files();
    let start = Instant::now();
    let applied = engine().apply(&params, &never()).unwrap();
    let took = start.elapsed();
    engine()
        .discard(&fx.journal_ref(&applied.journal_id), &never())
        .unwrap();
    took
}

#[test]
#[ignore = "wall-clock budget; run explicitly with --release --nocapture"]
fn apply_ten_files_within_the_100ms_budget() {
    let mut runs: Vec<Duration> = (0..30).map(|_| time_once()).collect();
    runs.sort();
    let median = runs[runs.len() / 2];
    let p95 = runs[runs.len() * 95 / 100];
    println!(
        "apply, 10 files: median {median:?}, p95 {p95:?}, min {:?}, max {:?}",
        runs[0],
        runs[runs.len() - 1]
    );
    assert!(median < Duration::from_millis(100), "median {median:?}");
}

#[test]
fn apply_ten_files_stays_far_below_a_second() {
    let took = (0..3).map(|_| time_once()).min().unwrap();
    assert!(took < Duration::from_secs(1), "{took:?}");
}
