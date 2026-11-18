use std::fs;
use std::path::PathBuf;

use contraprova_kernel::{
    CascadeRouter, CascadeTier, ContractLane, ContractLaneRegistry, EventKind, KernelGate, Ledger,
    UsageRecordInput,
};
use hypotaxis_contracts::{
    ExecRequest, ExecToolCall, PackRequest, ShipEdit, ShipRequest, ShipStatus, TaskBrief,
};
use serde_json::json;
use turn_primitives::{exec, pack, ship_with_gate};

fn temp_dir_hypo() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("hypo-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[tokio::test]
async fn end_to_end_contraprova_cascade_and_primitives() {
    let dir = temp_dir_hypo();
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(
        dir.join("src/math.rs"),
        "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n",
    )
    .unwrap();
    fs::write(dir.join(".env"), "SECRET_TOKEN=sk-ant-secret1234567890\n").unwrap();

    let mut ledger = Ledger::open(dir.join(".ledger/events.jsonl")).unwrap();
    let mut lanes = ContractLaneRegistry::new();
    lanes
        .register_lane(ContractLane {
            id: "lane/math".into(),
            owner_bot: "kernel".into(),
            frozen_interfaces: vec!["src/frozen.rs".into()],
            scope_globs: vec!["src/**".into()],
        })
        .unwrap();

    // 1. Pack context with secret redaction and symbol outlines.
    let packed = pack(PackRequest {
        root: dir.to_string_lossy().into_owned(),
        query: Some("SECRET_TOKEN|pub fn add".into()),
        files: Vec::new(),
        include_outlines: true,
        max_bytes: 16 * 1024,
    })
    .unwrap();
    assert!(packed.redacted_secrets >= 1);
    assert!(packed
        .outlines
        .iter()
        .any(|o| o.path == "src/math.rs" && o.symbols.contains(&"fn add".to_string())));

    // 2. Exec stateful REPL + parallel pack tool dispatch.
    let sid = format!("e2e-{}", uuid::Uuid::new_v4());
    let exec_res = exec(ExecRequest {
        session_id: sid.clone(),
        code: "matches = len(tool_results[0]['output']['matches'])\nprint(matches)".into(),
        parallel_tools: vec![ExecToolCall {
            tool: "pack".into(),
            args: json!({
                "root": dir.to_string_lossy(),
                "query": "add",
                "files": [],
                "include_outlines": false,
                "max_bytes": 4096
            }),
        }],
        timeout_ms: 5000,
    })
    .await
    .unwrap();
    assert_eq!(exec_res.exit_code, 0, "stderr: {}", exec_res.stderr);
    assert!(exec_res.persisted_vars.contains(&"matches".to_string()));
    turn_primitives::global_exec_manager()
        .close_session(&sid)
        .await;

    // 3. Ship out-of-scope edit first -> gate blocks & rolls back -> router retries same tier once.
    let mut router = CascadeRouter::new();
    let tier = router.initial_tier();
    assert_eq!(tier, CascadeTier::Tier1Fast);

    let brief = TaskBrief {
        id: "t-1".into(),
        goal: "add mul helper".into(),
        scope_globs: vec!["src/math.rs".into()],
        lane_id: "lane/math".into(),
        invariants: vec!["pure functions".into()],
    };
    let gate = KernelGate::with_command(&dir, Some("echo ok".into()));

    let bad_ship = ship_with_gate(
        ShipRequest {
            root: dir.to_string_lossy().into_owned(),
            brief: brief.clone(),
            edits: vec![ShipEdit {
                path: "docs/extra.md".into(),
                old_text: None,
                new_text: "not allowed\n".into(),
                create_if_missing: true,
            }],
            run_gate: true,
            human_approved: true,
        },
        &gate,
    )
    .unwrap();
    assert_eq!(bad_ship.status, ShipStatus::FailedAndRolledBack);
    assert!(bad_ship.rolled_back);
    assert!(!dir.join("docs/extra.md").exists());

    let retry_tier = router.escalate(tier, false, true);
    assert_eq!(retry_tier, Some(CascadeTier::Tier1Fast));

    // 4. Retry within lane & scope -> ships and verifies!
    assert!(lanes
        .detect_clash("lane/math", &["src/math.rs"])
        .unwrap()
        .disjoint);

    let good_ship = ship_with_gate(
        ShipRequest {
            root: dir.to_string_lossy().into_owned(),
            brief,
            edits: vec![ShipEdit {
                path: "src/math.rs".into(),
                old_text: Some("    a + b\n}".into()),
                new_text: "    a + b\n}\n\npub fn mul(a: i32, b: i32) -> i32 {\n    a * b\n}"
                    .into(),
                create_if_missing: false,
            }],
            run_gate: true,
            human_approved: false,
        },
        &gate,
    )
    .unwrap();
    assert_eq!(good_ship.status, ShipStatus::ShippedAndVerified);
    assert!(good_ship.gate_passed);

    ledger
        .append(
            EventKind::GateDecided,
            json!({"passed": good_ship.gate_passed, "tier": "tier1_fast"}),
        )
        .unwrap();
    ledger
        .append_usage(UsageRecordInput {
            input_tokens: 1_500,
            output_tokens: 400,
            cache_read_tokens: 8_500,
            tier: Some(CascadeTier::Tier1Fast),
            subscription_covered: true,
        })
        .unwrap();

    assert_eq!(ledger.verify_chain().unwrap(), 2);
    assert!(ledger.project_usage_cost().unwrap().cost_saved_usd > 0.0);

    let _ = fs::remove_dir_all(&dir);
}
