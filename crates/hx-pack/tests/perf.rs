//! Performance budget (`docs/STANDARDS.md` section 6): `pack.search` on a
//! 100k-file tree under 300 ms p95, a known file range under 50 ms.
//!
//! Run with `cargo test -p hx-pack --release --test perf -- --ignored --nocapture`.
//! The fixture is generated, never checked in: 100,000 source-like files across
//! 1,000 directories, plus 20,000 files under `node_modules` and `target` that
//! the walk must skip, plus a `.gitignore`.
// Test code: a failing unwrap is the failure report, and these pedantic style
// lints (casts in assertions, `Default::default()` in fixtures, `format!` in
// iterator chains) add noise without protecting anything.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::default_trait_access,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::format_collect,
    clippy::too_many_lines
)]

mod common;

use std::fmt::Write as _;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use common::Tree;
use hx_pack::{
    PatternMode, ReadParams, ReadRequest, SearchParams, SearchRequest, handle_read, handle_search,
};

const FILES: usize = 100_000;
const DIRS: usize = 1_000;
const RUNS: usize = 20;

/// A small xorshift generator so the fixture is the same on every run.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

const WORDS: &[&str] = &[
    "alpha", "beta", "gamma", "delta", "config", "handler", "request", "response", "buffer",
    "cache", "index", "token", "parser", "writer", "reader", "stream", "queue", "worker", "task",
    "state",
];

fn source_file(rng: &mut Rng, ext: &str, id: usize) -> String {
    let mut s = String::with_capacity(1800);
    let lines = 30 + (rng.next() % 30) as usize;
    for i in 0..lines {
        let a = WORDS[(rng.next() % WORDS.len() as u64) as usize];
        let b = WORDS[(rng.next() % WORDS.len() as u64) as usize];
        let n = rng.next() % 1000;
        let _ = match ext {
            "py" => writeln!(
                s,
                "def {a}_{b}_{i}(x, y={n}):\n    return x + y * {n}  # {a} {b}"
            ),
            "ts" => writeln!(
                s,
                "export function {a}{b}{i}(x: number): number {{ return x * {n}; }} // {a}"
            ),
            "go" => writeln!(s, "func {a}{b}{i}(x int) int {{ return x * {n} }} // {b}"),
            _ => writeln!(
                s,
                "pub fn {a}_{b}_{i}(x: u32) -> u32 {{ x.wrapping_mul({n}) }} // {a} {id}"
            ),
        };
    }
    s
}

fn generate(root: &Path) {
    let threads = 8;
    std::thread::scope(|scope| {
        for t in 0..threads {
            scope.spawn(move || {
                let mut rng = Rng(0x9E37_79B9_7F4A_7C15 ^ (t as u64 + 1));
                for d in (t..DIRS).step_by(threads) {
                    let dir = root.join(format!("src/mod_{d:04}"));
                    fs::create_dir_all(&dir).unwrap();
                    for f in 0..FILES / DIRS {
                        let ext = ["rs", "py", "ts", "go", "rs", "ts"][f % 6];
                        let id = d * 1000 + f;
                        let mut body = source_file(&mut rng, ext, id);
                        // Rare needles: 5 files in the whole tree.
                        if id % 20_011 == 7 {
                            body.push_str("// RARE_NEEDLE_7f3a\n");
                        }
                        fs::write(dir.join(format!("file_{f:03}.{ext}")), body).unwrap();
                    }
                }
            });
        }
    });
    let mut rng = Rng(42);
    for d in 0..20 {
        for (top, name) in [("node_modules", "pkg"), ("target", "debug")] {
            let dir = root.join(format!("{top}/{name}_{d}"));
            fs::create_dir_all(&dir).unwrap();
            for f in 0..500 {
                fs::write(dir.join(format!("f{f}.js")), source_file(&mut rng, "ts", f)).unwrap();
            }
        }
    }
    fs::write(root.join(".gitignore"), "*.log\ndist/\n").unwrap();
}

fn percentile(samples: &mut [Duration], p: f64) -> Duration {
    samples.sort();
    let idx = ((samples.len() as f64) * p).ceil() as usize;
    samples[idx.saturating_sub(1).min(samples.len() - 1)]
}

fn measure(label: &str, mut f: impl FnMut()) -> Duration {
    f(); // warm the page cache and the compiled-pattern paths
    let mut samples = Vec::with_capacity(RUNS);
    for _ in 0..RUNS {
        let t = Instant::now();
        f();
        samples.push(t.elapsed());
    }
    let p50 = percentile(&mut samples, 0.50);
    let p95 = percentile(&mut samples, 0.95);
    eprintln!(
        "{label:<58} p50 {:>7.1} ms   p95 {:>7.1} ms",
        ms(p50),
        ms(p95)
    );
    p95
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

#[test]
#[ignore = "generates 120,000 files; run explicitly"]
fn search_on_a_100k_file_tree() {
    let tree = Tree::new();
    let t = Instant::now();
    generate(tree.path());
    eprintln!(
        "fixture: {FILES} files + 20000 skipped, generated in {:.1} s",
        t.elapsed().as_secs_f64()
    );
    let root = tree.root().to_owned();
    let search = |p: SearchParams| {
        let r = handle_search(&SearchRequest {
            root: root.clone(),
            params: p,
        })
        .unwrap();
        std::hint::black_box(r)
    };
    let probe = search(SearchParams::new("RARE_NEEDLE_7f3a"));
    eprintln!(
        "walked {} files, scanned {}, found {} matches",
        probe.files_walked, probe.files_scanned, probe.matches
    );
    assert_eq!(
        probe.files_walked,
        FILES + 1,
        "100k sources plus the .gitignore"
    );

    let mut worst = Duration::ZERO;
    let mut lit = SearchParams::new("RARE_NEEDLE_7f3a");
    lit.mode = PatternMode::Literal;
    worst = worst.max(measure("rare literal, whole tree (full scan)", || {
        search(lit.clone());
    }));
    worst = worst.max(measure("rare regex, whole tree (full scan)", || {
        search(SearchParams::new(r"RARE_NEEDLE_[0-9a-f]{4}"));
    }));
    let mut common_pat = SearchParams::new("wrapping_mul");
    common_pat.max_matches = 200;
    worst = worst.max(measure(
        "common literal, max_matches 200 (early stop)",
        || {
            search(common_pat.clone());
        },
    ));
    let mut narrowed = SearchParams::new("alpha");
    narrowed.globs = vec!["src/mod_0420/**".into()];
    worst = worst.max(measure(
        "glob src/mod_0420/** (one of 1000 directories)",
        || {
            search(narrowed.clone());
        },
    ));
    let mut by_ext = SearchParams::new("RARE_NEEDLE_7f3a");
    by_ext.globs = vec!["*.go".into()];
    worst = worst.max(measure("rare literal, glob *.go", || {
        search(by_ext.clone());
    }));
    let range = measure("read of a known file range (lines 10-30)", || {
        let r = handle_read(&ReadRequest {
            root: root.clone(),
            params: ReadParams {
                path: "src/mod_0500/file_048.rs".into(),
                ranges: vec![hx_pack::LineRange {
                    start: 10,
                    end: Some(30),
                }],
                max_bytes: None,
                walk: Default::default(),
            },
        })
        .unwrap();
        std::hint::black_box(r);
    });
    eprintln!(
        "worst search p95: {:.1} ms (budget 300 ms); read p95: {:.1} ms (budget 50 ms)",
        ms(worst),
        ms(range)
    );
    assert!(range < Duration::from_millis(50), "read range over budget");
}
