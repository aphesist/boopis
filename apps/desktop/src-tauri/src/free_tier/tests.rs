//! The challenge flow against a window that is a value: an event's payload in, a hidden window requested, the reveal and the
//! close on the page's signal. No display, no network.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;
use url::Url;

use super::challenge::{
    Outcome, Phase, Request, Window, WindowHost, Windows, parse_request, phase_of, pinned,
};
use crate::config::Challenge;
use crate::error::{Error, Result};

pub(crate) const PAGE: &str = "https://portal.nousresearch.com/challenge/abc123";

/// What a fake window does, scripted by the test.
pub(crate) struct Script {
    pub url: Url,
    pub alive: bool,
    pub revealed: u32,
    pub closed: bool,
}

pub(crate) struct FakeWindow(pub Arc<Mutex<Script>>);

impl Window for FakeWindow {
    fn url(&self) -> Option<Url> {
        Some(self.0.lock().unwrap().url.clone())
    }
    fn alive(&self) -> bool {
        self.0.lock().unwrap().alive
    }
    fn reveal(&self) {
        self.0.lock().unwrap().revealed += 1;
    }
    fn close(&self) {
        let mut s = self.0.lock().unwrap();
        s.closed = true;
        s.alive = false;
    }
}

#[derive(Default)]
pub(crate) struct FakeHost {
    pub opened: Mutex<Vec<(Url, Arc<Mutex<Script>>)>>,
    pub fail: bool,
}

impl WindowHost for FakeHost {
    fn open_hidden(&self, url: &Url) -> Result<Box<dyn Window>> {
        if self.fail {
            return Err(Error::Os("no display".into()));
        }
        let script = Arc::new(Mutex::new(Script {
            url: url.clone(),
            alive: true,
            revealed: 0,
            closed: false,
        }));
        self.opened
            .lock()
            .unwrap()
            .push((url.clone(), script.clone()));
        Ok(Box::new(FakeWindow(script)))
    }
}

impl FakeHost {
    pub(crate) fn window(&self, n: usize) -> Arc<Mutex<Script>> {
        self.opened.lock().unwrap()[n].1.clone()
    }
    pub(crate) fn count(&self) -> usize {
        self.opened.lock().unwrap().len()
    }
}

pub(crate) fn request(required: bool) -> Request {
    Request {
        url: PAGE.into(),
        required,
        expires_in: Some(600.0),
        attempt: 1,
    }
}

/// Make the window's address become `to` after `after`.
pub(crate) fn navigate(script: &Arc<Mutex<Script>>, after: Duration, to: &str) {
    let (s, to) = (script.clone(), to.to_owned());
    tokio::spawn(async move {
        tokio::time::sleep(after).await;
        s.lock().unwrap().url = Url::parse(&to).unwrap();
    });
}

fn rig() -> (Arc<FakeHost>, Windows) {
    let host = Arc::new(FakeHost::default());
    (host.clone(), Windows::new(host, Challenge::default()))
}

#[test]
fn the_fragment_is_the_signal() {
    let at = |f: &str| phase_of(&Url::parse(&format!("{PAGE}{f}")).unwrap());
    assert_eq!(at("#working"), Some(Phase::Working));
    assert_eq!(at("#interactive"), Some(Phase::Interactive));
    assert_eq!(at("#done"), Some(Phase::Done));
    assert_eq!(at("#failed"), Some(Phase::Failed));
    assert_eq!(at("#other"), None);
    assert_eq!(at(""), None);
}

#[test]
fn only_a_browser_challenge_of_the_documented_shape_is_read() {
    let ok = json!({"type":"browser","url":PAGE,"required":true,"expires_in":600,"message":"m","attempt":2});
    let r = parse_request(&ok, 2048).unwrap();
    assert_eq!((r.url.as_str(), r.required, r.attempt), (PAGE, true, 2));
    assert_eq!(r.expires_in, Some(600.0));
    let optional = json!({"type":"browser","url":PAGE,"required":false});
    assert!(!parse_request(&optional, 2048).unwrap().required);
    assert!(
        parse_request(&json!({"type":"pow","url":PAGE}), 2048).is_none(),
        "another primitive"
    );
    assert!(parse_request(&json!({"type":"browser"}), 2048).is_none());
    assert!(parse_request(&json!({"type":"browser","url":""}), 2048).is_none());
    let long = format!("{PAGE}?{}", "x".repeat(3000));
    assert!(parse_request(&json!({"type":"browser","url":long}), 2048).is_none());
    assert_eq!(
        parse_request(&json!({"type":"browser","url":PAGE,"expires_in":-1}), 2048)
            .unwrap()
            .expires_in,
        None
    );
}

#[test]
fn only_a_portal_challenge_page_may_be_loaded() {
    let cfg = Challenge::default();
    assert!(pinned(PAGE, &cfg).is_some());
    assert!(pinned("https://portal.nousresearch.com/challenge", &cfg).is_some());
    for bad in [
        "https://evil.example/challenge/x",
        "https://portal.nousresearch.com.evil.example/challenge/x",
        "http://portal.nousresearch.com/challenge/x",
        "https://portal.nousresearch.com/challengex",
        "https://portal.nousresearch.com/login",
        "https://portal.nousresearch.com:8443/challenge/x",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "not a url",
    ] {
        assert!(pinned(bad, &cfg).is_none(), "{bad}");
    }
}

#[tokio::test(start_paused = true)]
async fn a_challenge_that_clears_while_hidden_is_never_shown_and_closes() {
    let (host, windows) = rig();
    let run = windows.run(request(true));
    let nav = async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        navigate(
            &host.window(0),
            Duration::from_secs(2),
            &format!("{PAGE}#working"),
        );
        navigate(
            &host.window(0),
            Duration::from_secs(5),
            &format!("{PAGE}#done"),
        );
    };
    let (outcome, ()) = tokio::join!(run, nav);
    assert_eq!(outcome, Outcome::Done);
    let w = host.window(0);
    let w = w.lock().unwrap();
    assert_eq!(w.revealed, 0, "the page never asked for a person");
    assert!(w.closed);
}

#[tokio::test(start_paused = true)]
async fn the_window_is_revealed_when_the_page_asks_for_the_person_and_closed_when_it_clears() {
    let (host, windows) = rig();
    let run = windows.run(request(true));
    let nav = async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        navigate(
            &host.window(0),
            Duration::from_secs(3),
            &format!("{PAGE}#interactive"),
        );
        navigate(
            &host.window(0),
            Duration::from_secs(30),
            &format!("{PAGE}#done"),
        );
    };
    let started = tokio::time::Instant::now();
    let (outcome, ()) = tokio::join!(run, nav);
    assert_eq!(outcome, Outcome::Done);
    let w = host.window(0);
    let w = w.lock().unwrap();
    assert_eq!(w.revealed, 1, "revealed once, however often it is read");
    assert!(w.closed);
    assert!(
        started.elapsed() >= Duration::from_secs(31),
        "a revealed window lingers on its success before it closes"
    );
}

#[tokio::test(start_paused = true)]
async fn an_optional_challenge_is_never_revealed() {
    let (host, windows) = rig();
    let run = windows.run(request(false));
    let nav = async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        navigate(
            &host.window(0),
            Duration::from_secs(1),
            &format!("{PAGE}#interactive"),
        );
    };
    let (outcome, ()) = tokio::join!(run, nav);
    assert_eq!(outcome, Outcome::Failed);
    let w = host.window(0);
    assert_eq!(w.lock().unwrap().revealed, 0);
    assert!(w.lock().unwrap().closed);
}

#[tokio::test(start_paused = true)]
async fn a_window_that_leaves_the_portal_ends_the_run_and_no_phase_is_read_from_it() {
    let (host, windows) = rig();
    let run = windows.run(request(true));
    let nav = async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        // a foreign page asking to be shown under the app's name
        navigate(
            &host.window(0),
            Duration::from_secs(1),
            "https://evil.example/x#interactive",
        );
    };
    let (outcome, ()) = tokio::join!(run, nav);
    assert_eq!(outcome, Outcome::Failed);
    assert_eq!(host.window(0).lock().unwrap().revealed, 0);
}

#[tokio::test(start_paused = true)]
async fn closing_the_window_by_hand_ends_it_as_closed() {
    let (host, windows) = rig();
    let run = windows.run(request(true));
    let closer = async {
        tokio::time::sleep(Duration::from_secs(4)).await;
        host.window(0).lock().unwrap().alive = false;
    };
    let (outcome, ()) = tokio::join!(run, closer);
    assert_eq!(outcome, Outcome::Closed);
}

#[tokio::test(start_paused = true)]
async fn a_hidden_challenge_that_never_answers_times_out() {
    let (host, windows) = rig();
    let started = tokio::time::Instant::now();
    let outcome = windows.run(request(true)).await;
    assert_eq!(outcome, Outcome::Timeout);
    assert!(started.elapsed() >= Duration::from_secs(90));
    assert!(host.window(0).lock().unwrap().closed);
}

#[tokio::test]
async fn a_url_off_the_portal_opens_nothing() {
    let (host, windows) = rig();
    let mut r = request(true);
    r.url = "https://evil.example/challenge/x".into();
    assert_eq!(windows.run(r).await, Outcome::Refused);
    assert_eq!(host.count(), 0);
}

#[tokio::test]
async fn a_window_that_cannot_be_created_is_an_error_not_a_hang() {
    let host = Arc::new(FakeHost {
        fail: true,
        ..FakeHost::default()
    });
    let windows = Windows::new(host, Challenge::default());
    assert_eq!(windows.run(request(true)).await, Outcome::Error);
}

#[tokio::test(start_paused = true)]
async fn the_same_challenge_announced_twice_runs_in_one_window() {
    let (host, windows) = rig();
    let nav = async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        navigate(
            &host.window(0),
            Duration::from_secs(2),
            &format!("{PAGE}#done"),
        );
    };
    let (a, b, ()) = tokio::join!(windows.run(request(true)), windows.run(request(true)), nav);
    assert_eq!((a, b), (Outcome::Done, Outcome::Done));
    assert_eq!(host.count(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_settled_challenge_does_not_come_back_but_a_timed_out_one_may() {
    let (host, windows) = rig();
    // closed by the person: remembered, the next announcement of the same attempt opens nothing
    let closer = async {
        tokio::time::sleep(Duration::from_secs(1)).await;
        host.window(0).lock().unwrap().alive = false;
    };
    let (first, ()) = tokio::join!(windows.run(request(true)), closer);
    assert_eq!(first, Outcome::Closed);
    assert_eq!(windows.run(request(true)).await, Outcome::Closed);
    assert_eq!(host.count(), 1, "the closed window did not come back");
    // a new attempt (a foreground caller about to wait) may reopen it
    let mut again = request(true);
    again.attempt = 2;
    let closer = async {
        tokio::time::sleep(Duration::from_secs(1)).await;
        host.window(1).lock().unwrap().alive = false;
    };
    let (second, ()) = tokio::join!(windows.run(again), closer);
    assert_eq!(second, Outcome::Closed);
    assert_eq!(host.count(), 2);
    // a timeout is worth another window for the same attempt
    let mut third = request(true);
    third.attempt = 3;
    assert_eq!(windows.run(third.clone()).await, Outcome::Timeout);
    assert_eq!(windows.run(third).await, Outcome::Timeout);
    assert_eq!(host.count(), 4);
}

#[test]
fn every_outcome_is_a_word_of_hermes_contract() {
    for (o, w) in [
        (Outcome::Done, "done"),
        (Outcome::Failed, "failed"),
        (Outcome::Closed, "closed"),
        (Outcome::Timeout, "timeout"),
        (Outcome::Refused, "refused"),
        (Outcome::Error, "error"),
    ] {
        assert_eq!(o.as_str(), w);
    }
}

/// The challenge window must match no capability: none of the host's commands may answer a remote page.
#[test]
fn challenge_window_has_no_capability() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    let mut seen = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let text = std::fs::read_to_string(entry.unwrap().path()).unwrap();
        let cap: serde_json::Value = serde_json::from_str(&text).unwrap();
        seen += 1;
        assert!(cap.get("remote").is_none(), "a capability for remote pages");
        for w in cap["windows"].as_array().unwrap_or(&Vec::new()) {
            let w = w.as_str().unwrap();
            assert!(
                !w.contains('*')
                    && !super::windows::LABEL_PREFIX.starts_with(w.trim_end_matches('*')),
                "capability window {w:?} would match the challenge window"
            );
        }
        assert!(
            cap["webviews"].is_null(),
            "a capability by webview label could match the challenge window"
        );
    }
    assert!(seen > 0);
}
