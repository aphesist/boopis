//! The store's sources, read for real: the host's own store code (`store::Store` with its real HTTPS fetcher) reads every source a
//! read reaches, one at a time as the store's view does when it opens, and Browse then lists what each one holds. Ignored by
//! default, because it reads real services:
//!
//! ```sh
//! cargo test -p boopis-host --test live_store -- --ignored --nocapture
//! ```
//!
//! `.github/workflows/live-store.yml` runs it on Linux and Windows, on demand, every week, and when the store's network code or
//! this file changes.
//!
//! - **The app's own code**: the same `Store`, the same fetcher (`store::net::Https`, its TLS setup included), the same parsers
//!   and the same words a source row shows. rustls's process default is never installed here, so a pass proves the store's own
//!   HTTPS agent names its crypto provider.
//! - **No engine runs here**: the skills hub, which is read through the engine, must say so in plain words ("The engine is not
//!   running yet"), which is the row a person sees before the engine has started.
//! - **Blocked is not failed**: a source refused by something between this machine and the service (a proxy, a firewall) is shown
//!   as blocked with what it said; it is not counted as boopis's failure. Any other failure fails the test.
//! - The table goes to standard output and to `$GITHUB_STEP_SUMMARY` on GitHub Actions.

#![allow(clippy::expect_used, clippy::unwrap_used, clippy::too_many_lines)] // a test: failing loudly is the point

use std::fmt::Write as _;
use std::sync::Arc;
use std::time::Instant;

use boopis_host::config::Limits;
use boopis_host::connectors::Engine;
use boopis_host::error::{Error, Result};
use boopis_host::store::Store;
use boopis_host::store::backend::{Backend, Host};
use boopis_host::store::net::{Ask, Fetcher, Hosts, Https};
use boopis_host::store::types::{StoreFilter, Tier};
use sha2::{Digest, Sha256};

/// The host with no engine: what a person has before the engine has started.
struct NoEngine;

impl Host for NoEngine {
    fn bot(&self, _profile: Option<String>) -> Result<String> {
        Ok("default".into())
    }
    fn connectors(&self, _bot: &str) -> Result<Arc<Engine>> {
        Err(Error::Unavailable(
            "no engine in the live store test".into(),
        ))
    }
    fn backend(&self, _bot: &str) -> Result<Arc<dyn Backend>> {
        Err(Error::Unavailable(
            "no engine in the live store test".into(),
        ))
    }
}

/// Words a person must never read in a source row: a panic, a transport's words, a status number, JSON, a code.
fn raw_words(t: &str) -> Option<&'static str> {
    [
        "panicked",
        "CryptoProvider",
        "os error",
        "Connection refused",
        "hx.",
        "{",
        "answered 4",
        "answered 5",
    ]
    .into_iter()
    .find(|w| t.contains(w))
}

/// A refusal by something between this machine and the service: shown, not counted as boopis's failure.
fn blocked(t: &str) -> bool {
    t.contains("is limiting requests") || t.contains("not its list")
}

#[tokio::test]
#[ignore = "reads the real sources over the network"]
async fn every_source_a_read_reaches_loads_and_browse_lists_it() {
    let dir = tempfile::tempdir().unwrap();
    let limits = Limits::default();
    let store = Store::new(
        &dir.path().join("store"),
        limits.clone(),
        Arc::new(Https::new(&limits.store)),
        Arc::new(NoEngine),
    )
    .expect("the store starts");
    let platform =
        std::env::var("HX_LIVE_PLATFORM").unwrap_or_else(|_| std::env::consts::OS.into());

    // Before any read: every source a read reaches is due, and says so (it is read when the store opens).
    let due: Vec<String> = store
        .sources()
        .into_iter()
        .filter(|s| s.stale == Some(true))
        .map(|s| s.id)
        .collect();
    assert_eq!(
        due,
        ["engine-plugins", "skills-hub", "anthropic", "mcp-registry"],
        "the sources the store reads when it opens"
    );

    let mut table = format!(
        "### The store's sources, read live ({platform})\n\n| source | result | items | seconds | what the row says |\n|---|---|---|---|---|\n"
    );
    let mut failures = Vec::new();
    for id in &due {
        let t0 = Instant::now();
        let read = store.refresh(Some(id)).await;
        let secs = t0.elapsed().as_secs_f32();
        let s = store.sources().into_iter().find(|s| &s.id == id).unwrap();
        let row = s
            .error
            .clone()
            .unwrap_or_else(|| format!("{} items. Read just now.", s.items.unwrap_or(0)));
        if let Some(w) = raw_words(&row) {
            failures.push(format!("{id}: the row shows raw words ({w}): {row}"));
        }
        let verdict = match (id.as_str(), &read) {
            ("skills-hub", Err(_)) if row.starts_with("The engine is not running yet.") => {
                "pass (no engine here)"
            }
            ("skills-hub", _) => {
                failures.push(format!(
                    "{id}: with no engine the row must say so, not: {row}"
                ));
                "fail"
            }
            (_, Ok(_)) if s.items.unwrap_or(0) > 0 && s.stale == Some(false) => "pass",
            (_, Err(_)) if blocked(&row) => "blocked",
            _ => {
                failures.push(format!("{id}: {row}"));
                "fail"
            }
        };
        writeln!(
            table,
            "| {id} | {verdict} | {} | {secs:.1} | {row} |",
            s.items.unwrap_or(0)
        )
        .unwrap();
    }

    // Browse lists what each source that was read holds, and boopis's own list leads the front page.
    let page = store
        .browse(None, &StoreFilter::default(), None, Some(100))
        .unwrap();
    let rec = page.recommended.clone().unwrap_or_default();
    assert!(
        !rec.is_empty(),
        "the front page leads with boopis's own list"
    );
    assert!(rec.iter().all(|i| i.tier == Tier::Recommended));
    for id in ["engine-plugins", "anthropic", "mcp-registry"] {
        let src = store
            .browse(
                None,
                &StoreFilter {
                    source: Some((*id).into()),
                    ..StoreFilter::default()
                },
                None,
                Some(5),
            )
            .unwrap();
        let read = store
            .sources()
            .into_iter()
            .find(|s| s.id == *id)
            .is_some_and(|s| s.error.is_none());
        if read && src.items.is_empty() {
            failures.push(format!("{id}: read, but Browse lists nothing from it"));
        }
        writeln!(table, "\nBrowse, {id}: {} items listed.", src.total).unwrap();
    }
    println!("{table}");
    if let Ok(path) = std::env::var("GITHUB_STEP_SUMMARY") {
        let mut old = std::fs::read_to_string(&path).unwrap_or_default();
        old.push_str(&table);
        std::fs::write(&path, old).unwrap();
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

/// boopis's own skills and plugins (`apps/shared/data/recommended.json`) are what a person read: each pinned commit is still there
/// in its publisher's own repository, and the manifest read at it (`SKILL.md`, `plugin.json`) has the bytes whose hash was
/// recorded. A commit a publisher removed, or a manifest that is not the one read, is a failure; a refusal by something between this
/// machine and GitHub is shown as blocked.
#[tokio::test]
#[ignore = "reads GitHub"]
async fn every_recommended_entry_is_still_what_was_read() {
    let limits = Limits::default();
    let fetcher = Arc::new(Https::new(&limits.store));
    let list = boopis_host::store::recommended::load().expect("the list parses");
    let max = limits.store.max_catalogue_bytes;
    let mut table = String::from(
        "### boopis's recommended skills and plugins, read at their pinned commits\n\n| entry | result |\n|---|---|\n",
    );
    let mut failures = Vec::new();
    for (kind, entries) in [("skill", &list.skills), ("plugin", &list.plugins)] {
        for e in entries {
            let path = e.repo.trim_start_matches("https://github.com/");
            let (owner, name) = path.split_once('/').expect("owner/name");
            let url = boopis_host::store::github::raw_url(
                owner,
                name,
                &e.commit,
                &e.verified.manifest.path,
            );
            let (f, u) = (fetcher.clone(), url.clone());
            let got = tokio::task::spawn_blocking(move || {
                f.get(
                    &u,
                    &Hosts::new(&[]),
                    &Ask {
                        max_bytes: max,
                        etag: None,
                        accept: None,
                    },
                )
            })
            .await
            .unwrap();
            let verdict = match got {
                Ok(r) => {
                    let sum = Sha256::digest(&r.body)
                        .iter()
                        .fold(String::new(), |mut acc, b| {
                            let _ = write!(acc, "{b:02x}");
                            acc
                        });
                    if sum == e.verified.manifest.sha256 {
                        "pass".to_owned()
                    } else {
                        failures.push(format!(
                            "{kind} {}: {} is not the file that was read ({sum})",
                            e.id, e.verified.manifest.path
                        ));
                        "fail: the manifest differs".to_owned()
                    }
                }
                Err(err) => {
                    let said = err.to_string();
                    if blocked(&said) {
                        "blocked".to_owned()
                    } else {
                        failures.push(format!("{kind} {}: {said}", e.id));
                        format!("fail: {said}")
                    }
                }
            };
            writeln!(table, "| {kind} {} | {verdict} |", e.id).unwrap();
        }
    }
    println!("{table}");
    if let Ok(path) = std::env::var("GITHUB_STEP_SUMMARY") {
        let mut old = std::fs::read_to_string(&path).unwrap_or_default();
        old.push_str(&table);
        std::fs::write(&path, old).unwrap();
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
