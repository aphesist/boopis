//! The sandbox through the real binary: `hx sandbox ...` one-shots and `sandbox.*` over `serve`.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

fn hx() -> Command {
    Command::new(env!("CARGO_BIN_EXE_hx"))
}

fn frames(output: &std::process::Output) -> Vec<Value> {
    String::from_utf8(output.stdout.clone())
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).expect("stdout holds only JSON frames"))
        .collect()
}

#[test]
fn capabilities_one_shot_reports_this_host() {
    let out = hx().args(["sandbox", "capabilities"]).output().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let frame = &frames(&out)[0];
    let result = &frame["result"];
    assert!(
        ["linux", "macos", "windows"].contains(&result["platform"].as_str().unwrap()),
        "{result}"
    );
    assert!(result["fs"]["available"].is_boolean());
    assert_eq!(result["network_allowlist"]["available"], false);
}

#[test]
fn run_over_serve_fails_closed_for_an_unenforceable_allowlist() {
    let dir = tempfile::tempdir().unwrap();
    let cwd = std::fs::canonicalize(dir.path()).unwrap();
    let request = json!({
        "jsonrpc": "2.0", "id": 1, "method": "sandbox.run",
        "params": {"argv": ["true"], "cwd": cwd, "ro": [cwd], "net": ["example.org"]}
    });
    let mut child = hx()
        .arg("serve")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    writeln!(child.stdin.take().unwrap(), "{request}").unwrap();
    let out = child.wait_with_output().unwrap();
    let frame = &frames(&out)[0];
    assert_eq!(frame["error"]["code"], -32000);
    assert_eq!(frame["error"]["data"]["code"], "hx.sandbox.unavailable");
    assert_eq!(frame["error"]["data"]["dimension"], "network");
}

#[test]
fn the_schema_command_includes_the_sandbox_methods() {
    let out = hx().arg("schema").output().unwrap();
    let schema: Value = serde_json::from_slice(&out.stdout).unwrap();
    for m in [
        "sandbox.run",
        "sandbox.spawn",
        "sandbox.wait",
        "sandbox.kill",
        "sandbox.capabilities",
    ] {
        assert!(schema["methods"][m].is_object(), "{m}");
    }
    assert!(schema["errors"]["hx.sandbox.unavailable"]["data"].is_object());
}
