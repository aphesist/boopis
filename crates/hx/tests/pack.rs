//! `pack.*` through the real dispatcher and the real binary.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::Write;
use std::process::{Command, Stdio};

use hx_proto::{Id, Request};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

fn tree() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("src")).unwrap();
    std::fs::write(
        dir.path().join("src/lib.rs"),
        "/// Adds.\npub fn add(a: u32, b: u32) -> u32 {\n    a + b\n}\n",
    )
    .unwrap();
    std::fs::write(dir.path().join(".env"), "TOKEN=abc\n").unwrap();
    dir
}

async fn call(method: &str, params: Value) -> hx_proto::Response {
    let d = hx::build_dispatcher();
    d.handle(
        Request::new(Id::Num(1), method, Some(params)),
        CancellationToken::new(),
    )
    .await
}

#[tokio::test]
async fn describe_lists_the_pack_methods_and_capabilities() {
    let resp = call("hx.describe", Value::Null).await;
    let result = resp.result.unwrap();
    let methods: Vec<&str> = result["methods"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m.as_str().unwrap())
        .collect();
    for m in [
        "pack.search",
        "pack.read",
        "pack.symbol",
        "pack.outline",
        "pack.status",
        "pack.bundle",
    ] {
        assert!(methods.contains(&m), "{m}");
    }
    let caps: Vec<&str> = result["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m.as_str().unwrap())
        .collect();
    for c in [
        "pack.search",
        "pack.bundle",
        "pack.redact",
        "pack.never_pack",
        "pack.walk_cache",
        "pack.lang.rust",
        "pack.lang.go",
    ] {
        assert!(caps.contains(&c), "{c}");
    }
}

#[tokio::test]
async fn every_method_answers_through_the_dispatcher() {
    let dir = tree();
    let root = dir.path().to_str().unwrap();
    let r = call(
        "pack.search",
        json!({"root": root, "pattern": "a \\+ b", "context_before": 1}),
    )
    .await;
    let r = r.result.unwrap();
    assert_eq!(r["matches"], 1);
    assert_eq!(r["blocks"][0]["path"], "src/lib.rs");
    let r = call(
        "pack.read",
        json!({"root": root, "path": "src/lib.rs", "ranges": [{"start": 2, "end": 2}]}),
    )
    .await;
    assert_eq!(
        r.result.unwrap()["segments"][0]["text"],
        "2|pub fn add(a: u32, b: u32) -> u32 {\n"
    );
    let r = call("pack.symbol", json!({"root": root, "name": "add"}))
        .await
        .result
        .unwrap();
    assert_eq!(r["definitions"][0]["kind"], "function");
    assert_eq!(
        r["definitions"][0]["start_line"], 1,
        "the doc comment belongs to it"
    );
    let r = call("pack.outline", json!({"root": root, "paths": ["src"]}))
        .await
        .result
        .unwrap();
    assert_eq!(r["files"][0]["symbols"][0]["name"], "add");
    let r = call("pack.status", json!({"root": root}))
        .await
        .result
        .unwrap();
    assert!(r["is_repo"].is_boolean());
    let r = call(
        "pack.bundle",
        json!({"root": root, "requests": [
            {"method": "pack.search", "params": {"pattern": "add"}},
            {"method": "pack.read", "params": {"path": ".env"}}]}),
    )
    .await
    .result
    .unwrap();
    assert_eq!(r["results"][1]["result"]["status"], "withheld");
}

#[tokio::test]
async fn pack_errors_carry_catalog_codes_on_the_wire() {
    let dir = tree();
    let root = dir.path().to_str().unwrap();
    let cases = [
        (json!({"root": root, "path": "../x"}), "hx.pack.path_escape"),
        (
            json!({"root": root, "path": "nope.rs"}),
            "hx.pack.not_found",
        ),
        (
            json!({"root": "/no/such/dir", "path": "a"}),
            "hx.pack.invalid_root",
        ),
        (
            json!({"root": root, "path": "src"}),
            "hx.pack.invalid_request",
        ),
        (json!({"root": root}), "hx.invalid_params"),
    ];
    for (params, code) in cases {
        let err = call("pack.read", params).await.error.unwrap();
        assert_eq!(err.string_code(), Some(code));
        assert_eq!(
            err.code,
            if code == "hx.invalid_params" {
                -32602
            } else {
                -32000
            }
        );
    }
}

#[tokio::test]
async fn a_cancelled_call_answers_hx_cancelled() {
    let dir = tree();
    let d = hx::build_dispatcher();
    let token = CancellationToken::new();
    token.cancel();
    let req = Request::new(
        Id::Num(1),
        "pack.search",
        Some(json!({"root": dir.path(), "pattern": "add"})),
    );
    let err = d.handle(req, token).await.error.unwrap();
    assert_eq!(err.string_code(), Some("hx.cancelled"));
}

#[test]
fn the_binary_runs_pack_subcommands_and_lists_methods() {
    let dir = tree();
    let hx = || Command::new(env!("CARGO_BIN_EXE_hx"));
    let mut child = hx()
        .args(["pack", "outline", "--json", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let params = json!({"root": dir.path(), "paths": ["src/lib.rs"]});
    child
        .stdin
        .take()
        .unwrap()
        .write_all(params.to_string().as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let frame: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(frame["result"]["files"][0]["symbols"][0]["name"], "add");

    let out = hx().arg("describe").output().unwrap();
    let frame: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(
        frame["result"]["methods"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m == "pack.search")
    );
}

#[test]
fn logs_pass_through_the_pack_redactor() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("hx.log");
    // The server logs the method of an ignored notification at debug level.
    let mut child = Command::new(env!("CARGO_BIN_EXE_hx"))
        .args([
            "--log-file",
            log.to_str().unwrap(),
            "--log-level",
            "debug",
            "serve",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    stdin
        .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"sk-ant-api03-abcdefghijklmnopqrstuv\"}\n")
        .unwrap();
    drop(stdin);
    child.wait_with_output().unwrap();
    let text = std::fs::read_to_string(&log).unwrap();
    assert!(
        !text.contains("sk-ant-api03-abcdef"),
        "a secret reached the log: {text}"
    );
    assert!(text.contains("REDACTED:anthropic_key"), "{text}");
}
