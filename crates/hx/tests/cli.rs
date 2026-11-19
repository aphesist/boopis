//! The real binary: stdout carries frames only, logs go elsewhere, one-shot mirrors the methods.
// Integration-test helpers are not `#[test]` functions, so clippy's allow-*-in-tests config does not
// reach them. Failing loudly is exactly what test code should do.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

fn hx() -> Command {
    Command::new(env!("CARGO_BIN_EXE_hx"))
}

fn run_with_stdin(mut cmd: Command, input: &str) -> std::process::Output {
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn serve_writes_only_frames_to_stdout_and_exits_on_eof() {
    let log_dir = tempfile::tempdir().unwrap();
    let log = log_dir.path().join("logs/hx.log");
    let mut cmd = hx();
    cmd.args(["serve", "--log-file"])
        .arg(&log)
        .args(["--log-level", "debug"]);
    let input = format!(
        "{}\n{}\n",
        json!({"jsonrpc": "2.0", "id": 1, "method": "hx.describe"}),
        json!({"jsonrpc": "2.0", "id": 2, "method": "nope.nope"}),
    );
    let out = run_with_stdin(cmd, &input);
    assert!(
        out.status.success(),
        "{:?}",
        String::from_utf8_lossy(&out.stderr)
    );

    let stdout = String::from_utf8(out.stdout).unwrap();
    let frames: Vec<Value> = stdout
        .lines()
        .map(|l| serde_json::from_str(l).expect("stdout holds only JSON frames"))
        .collect();
    assert_eq!(frames.len(), 2);
    for f in &frames {
        assert_eq!(f["jsonrpc"], "2.0");
    }
    let by_id = |id: i64| frames.iter().find(|f| f["id"] == id).unwrap();
    assert_eq!(by_id(1)["result"]["protocol"], "hx-v1");
    assert_eq!(by_id(2)["error"]["data"]["code"], "hx.method_not_found");

    let log_text = std::fs::read_to_string(&log).unwrap();
    assert!(
        log_text
            .lines()
            .all(|l| serde_json::from_str::<Value>(l).is_ok()),
        "the log is JSON lines"
    );
    assert!(log_text.contains("hx serving on stdio"));
    assert!(
        out.stderr.is_empty(),
        "with --log-file nothing goes to stderr"
    );
}

#[test]
fn describe_and_schema_subcommands() {
    let out = hx().arg("describe").output().unwrap();
    assert!(out.status.success());
    let frame: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(frame["result"]["protocol"], "hx-v1");
    assert_eq!(frame["result"]["version"], env!("CARGO_PKG_VERSION"));

    let out = hx().arg("schema").output().unwrap();
    assert!(out.status.success());
    let committed = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../hx-proto/schema/hx-v1.schema.json"
    ))
    .unwrap();
    assert_eq!(String::from_utf8(out.stdout).unwrap(), committed);
}

#[test]
fn txn_subcommands_mirror_the_methods() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("ws");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("a.txt"), "one\n").unwrap();
    let journals = tmp.path().join("journals");
    let params = json!({
        "root": root, "journal_dir": journals, "protected": [],
        "edits": [{"op": "replace", "path": "a.txt", "old": "one", "new": "two"}]
    });

    let mut cmd = hx();
    cmd.args(["txn", "apply", "--json", "-"]);
    let out = run_with_stdin(cmd, &params.to_string());
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stdout)
    );
    let applied: Value = serde_json::from_slice(&out.stdout).unwrap();
    let id = applied["result"]["journal_id"].as_str().unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("a.txt")).unwrap(),
        "two\n"
    );

    // From a file this time.
    let file = tmp.path().join("restore.json");
    std::fs::write(
        &file,
        json!({"journal_dir": journals, "journal_id": id, "root": root}).to_string(),
    )
    .unwrap();
    let out = hx()
        .args(["txn", "restore", "--json"])
        .arg(&file)
        .output()
        .unwrap();
    assert!(out.status.success());
    assert_eq!(
        std::fs::read_to_string(root.join("a.txt")).unwrap(),
        "one\n"
    );

    // An error response sets a non-zero exit code and still prints a frame.
    let out = hx()
        .args(["txn", "restore", "--json"])
        .arg(&file)
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    let err: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(err["error"]["data"]["code"], "hx.txn.journal_not_found");
}

#[test]
fn bad_json_input_is_a_parse_error_frame() {
    let mut cmd = hx();
    cmd.args(["txn", "validate", "--json", "-"]);
    let out = run_with_stdin(cmd, "{nope");
    assert_eq!(out.status.code(), Some(1));
    let frame: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(frame["error"]["data"]["code"], "hx.parse_error");
}
