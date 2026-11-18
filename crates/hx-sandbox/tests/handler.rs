//! The `sandbox.*` methods through the real `hx-proto` dispatcher: the wire shapes, the error
//! codes, and the spawn/channel/wait/kill lifecycle.
#![cfg(target_os = "linux")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code: a failing unwrap is a failing test"
)]

mod common;

use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use std::time::Duration;

use common::*;
use hx_proto::{Dispatcher, Id, Request, Response};
use hx_sandbox::SandboxHandler;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

fn dispatcher() -> Dispatcher {
    let mut d = Dispatcher::new("test");
    d.register(Arc::new(SandboxHandler::new())).unwrap();
    d
}

async fn call(d: &Dispatcher, method: &str, params: Value) -> Response {
    d.handle(
        Request::new(Id::Num(1), method, Some(params)),
        CancellationToken::new(),
    )
    .await
}

fn ok(r: Response) -> Value {
    assert!(r.error.is_none(), "{:?}", r.error);
    r.result.unwrap()
}

fn error_code(r: &Response) -> String {
    r.error.as_ref().unwrap().data.as_ref().unwrap()["code"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn base_params(w: &World, argv: &[String]) -> Value {
    let p = w.policy();
    json!({
        "argv": argv,
        "cwd": p.cwd,
        "ro": p.ro_paths,
        "rw": p.rw_paths,
        "env": p.env_set,
    })
}

#[tokio::test(flavor = "multi_thread")]
async fn run_returns_the_wire_result_and_describe_lists_the_methods() {
    if !fs_available() {
        return;
    }
    let d = dispatcher();
    let described = d.describe();
    for m in [
        "sandbox.run",
        "sandbox.spawn",
        "sandbox.wait",
        "sandbox.kill",
        "sandbox.capabilities",
    ] {
        assert!(d.methods().contains(&m), "{m}");
    }
    assert!(
        described.capabilities.contains(&"sandbox.fs".to_owned()),
        "{:?}",
        described.capabilities
    );

    let w = World::new();
    let result = ok(call(&d, "sandbox.run", base_params(&w, &probe(&["exit", "5"]))).await);
    assert_eq!(result["exit"], json!({"kind": "exited", "code": 5}));
    assert_eq!(result["enforcement"]["platform"], "linux");
    assert_eq!(result["enforcement"]["fs"]["status"], "enforced");
}

#[tokio::test(flavor = "multi_thread")]
async fn errors_carry_stable_codes_and_details() {
    let d = dispatcher();
    let w = World::new();
    // An allowlist of a real host cannot be enforced: hx.sandbox.unavailable with the dimension.
    let mut p = base_params(&w, &probe(&["exit", "0"]));
    p["net"] = json!(["pypi.org"]);
    let r = call(&d, "sandbox.run", p).await;
    assert_eq!(error_code(&r), "hx.sandbox.unavailable");
    let data = r.error.unwrap().data.unwrap();
    assert_eq!(data["dimension"], "network");
    assert!(data["reason"].as_str().unwrap().contains("host name"));
    // A malformed policy is hx.invalid_params, a missing handle is hx.sandbox.unknown_handle.
    let r = call(
        &d,
        "sandbox.run",
        json!({"argv": ["x"], "cwd": "relative/path"}),
    )
    .await;
    assert_eq!(error_code(&r), "hx.invalid_params");
    let r = call(&d, "sandbox.run", json!({"nonsense": true})).await;
    assert_eq!(error_code(&r), "hx.invalid_params");
    let r = call(&d, "sandbox.wait", json!({"handle": "nope"})).await;
    assert_eq!(error_code(&r), "hx.sandbox.unknown_handle");
    let r = call(&d, "sandbox.kill", json!({"handle": "nope"})).await;
    assert_eq!(error_code(&r), "hx.sandbox.unknown_handle");
}

#[tokio::test(flavor = "multi_thread")]
async fn spawn_gives_the_plugin_a_private_channel_that_works_with_the_network_off() {
    if !fs_available() {
        return;
    }
    let d = dispatcher();
    let w = World::new();
    let dir = w.scratch.join("chan");
    let mut p = base_params(&w, &probe(&["fdenv", "HX_CHANNEL_FD"]));
    p["channel"] = json!({"dir": dir});
    let spawned = ok(call(&d, "sandbox.spawn", p).await);
    let channel = &spawned["channel"];
    assert_eq!(channel["kind"], "unix_socket");
    assert_eq!(channel["env"], "HX_CHANNEL_FD");
    let path = channel["path"].as_str().unwrap().to_owned();
    assert_eq!(
        spawned["enforcement"]["network"]["status"], "enforced",
        "the channel needs no network"
    );

    // The directory and the socket are private to this user.
    assert_eq!(
        std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );

    // The plugin side: connect, hear the child, answer it.
    let mut plugin = std::os::unix::net::UnixStream::connect(&path).unwrap();
    plugin
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let mut greeting = [0u8; 16];
    plugin.read_exact(&mut greeting).unwrap();
    assert_eq!(&greeting, b"hello-from-child");
    plugin.write_all(b"howdy").unwrap();

    let handle = spawned["handle"].as_str().unwrap();
    let done = ok(call(
        &d,
        "sandbox.wait",
        json!({"handle": handle, "timeout_ms": 10_000}),
    )
    .await);
    assert_eq!(done["running"], false);
    assert_eq!(done["exit"], json!({"kind": "exited", "code": 0}));
    assert!(
        done["stdout"]["text"]
            .as_str()
            .unwrap()
            .contains("reply howdy"),
        "{done}"
    );
    // Finished: the handle is gone and the socket was removed on connect.
    assert_eq!(
        error_code(&call(&d, "sandbox.wait", json!({"handle": handle})).await),
        "hx.sandbox.unknown_handle"
    );
    assert!(!std::path::Path::new(&path).exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn wait_polls_kill_ends_the_tree_and_the_exit_is_reported() {
    let d = dispatcher();
    let w = World::new();
    let spawned = ok(call(
        &d,
        "sandbox.spawn",
        base_params(&w, &probe(&["sleep", "300"])),
    )
    .await);
    let handle = spawned["handle"].as_str().unwrap().to_owned();
    assert!(spawned["channel"].is_null());
    assert!(spawned["pid"].as_u64().unwrap() > 0);

    // timeout_ms 0 is a poll.
    let polled = ok(call(&d, "sandbox.wait", json!({"handle": handle})).await);
    assert_eq!(polled["running"], true);
    assert!(polled["exit"].is_null());

    assert_eq!(
        ok(call(&d, "sandbox.kill", json!({"handle": handle})).await)["killed"],
        true
    );
    let done = ok(call(
        &d,
        "sandbox.wait",
        json!({"handle": handle, "timeout_ms": 10_000}),
    )
    .await);
    assert_eq!(done["running"], false);
    assert_eq!(done["exit"], json!({"kind": "signaled", "signal": 9}));
}

#[tokio::test(flavor = "multi_thread")]
async fn spawn_output_is_captured_and_capped() {
    let d = dispatcher();
    let w = World::new();
    let mut p = base_params(&w, &probe(&["flood", "100000"]));
    p["output_cap"] = json!(100);
    let spawned = ok(call(&d, "sandbox.spawn", p).await);
    let handle = spawned["handle"].as_str().unwrap();
    let done = ok(call(
        &d,
        "sandbox.wait",
        json!({"handle": handle, "timeout_ms": 10_000}),
    )
    .await);
    assert_eq!(done["exit"], json!({"kind": "exited", "code": 0}));
    assert_eq!(done["stdout"]["text"].as_str().unwrap().len(), 100);
    assert_eq!(done["stdout"]["truncated"], true);
    assert_eq!(done["stdout"]["total_bytes"], 100_000);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cancelled_run_kills_the_tree_and_answers_cancelled() {
    let d = Arc::new(dispatcher());
    let w = World::new();
    let base = w.scratch.join("cancelled");
    let beats = beat_files(&base, &["top", "mid", "leaf"]);
    let cancel = CancellationToken::new();
    let params = base_params(&w, &probe(&["tree", base.to_str().unwrap()]));
    let task = {
        let (d, cancel) = (d.clone(), cancel.clone());
        tokio::spawn(async move {
            d.handle(
                Request::new(Id::Num(2), "sandbox.run", Some(params)),
                cancel,
            )
            .await
        })
    };
    for _ in 0..100 {
        if all_started(&beats) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    cancel.cancel();
    let r = task.await.unwrap();
    assert_eq!(error_code(&r), "hx.cancelled");
    assert!(heartbeats_stopped(&beats), "cancelling must kill the tree");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_channel_nobody_connects_to_closes_for_the_child() {
    if !fs_available() {
        return;
    }
    let d = dispatcher();
    let w = World::new();
    let mut p = base_params(&w, &probe(&["fdenv", "HX_CHANNEL_FD"]));
    p["channel"] = json!({"dir": w.scratch.join("lonely"), "accept_timeout_ms": 200});
    let spawned = ok(call(&d, "sandbox.spawn", p).await);
    let handle = spawned["handle"].as_str().unwrap();
    // The child writes its greeting into a closed channel and then fails to read the reply.
    let done = ok(call(
        &d,
        "sandbox.wait",
        json!({"handle": handle, "timeout_ms": 10_000}),
    )
    .await);
    assert_ne!(done["exit"], json!({"kind": "exited", "code": 0}), "{done}");
}
