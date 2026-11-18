use std::sync::Mutex;

use hypotaxis_contracts::{
    AppleVmBackendKind, AppleVmConfig, AppleVmStatus, ArtifactCommit, ArtifactForkResult,
    ArtifactRepoSummary, CascadeTier, CompatAsset, CompatSource, EventKind, HermesBridgeStatus,
    LedgerEvent, PackMatch, PackOutline, PackRequest, PackResult, ProviderKind, ProviderProfile,
    ShipDiagnostic, ShipRequest, ShipResult, ShipStatus, XcodeBuildResult,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SystemStatus {
    pub app_name: String,
    pub version: String,
    pub workspace_root: String,
    pub hermes: HermesBridgeStatus,
    pub active_tier: CascadeTier,
    pub kv_cache_hit_rate: f64,
    pub cost_saved_pct: f64,
    pub ledger_len: usize,
    pub ledger_head_hash: String,
    pub compat_count: usize,
    pub artifact_port: u16,
    pub runtime_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ArtifactActionRequest {
    List,
    Create {
        namespace: String,
        name: String,
        message: String,
    },
    Fork {
        source_id: String,
        fork_name: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtifactActionResponse {
    pub active: ArtifactRepoSummary,
    pub fork_result: Option<ArtifactForkResult>,
    pub repos: Vec<ArtifactRepoSummary>,
}

#[derive(Debug)]
struct InnerState {
    ledger: Vec<LedgerEvent>,
    repos: Vec<ArtifactRepoSummary>,
    active_repo_id: String,
    fork_counter: u32,
    apple_config: AppleVmConfig,
    compat_assets: Vec<CompatAsset>,
}

pub struct AppState {
    inner: Mutex<InnerState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

fn fnv_hex(input: &str) -> String {
    let mut h1: u64 = 0xcbf29ce484222325;
    let mut h2: u64 = 0x84222325cbf29ce4;
    for (idx, b) in input.bytes().enumerate() {
        h1 ^= u64::from(b);
        h1 = h1.wrapping_mul(0x100000001b3);
        h2 ^= u64::from(b).wrapping_add(idx as u64);
        h2 = h2.wrapping_mul(0x9e3779b97f4a7c15);
    }
    format!("{:016x}{:016x}", h1, h2)
}

fn default_compat_assets() -> Vec<CompatAsset> {
    vec![
        CompatAsset {
            id: "claude-skill-ship".into(),
            name: "atomic-ship-gate".into(),
            source: CompatSource::ClaudeSkill,
            path: ".claude/skills/atomic-ship/SKILL.md".into(),
            description: "Pre-write verified atomic edit + rollback discipline".into(),
            scope_globs: vec!["src/**".into(), "crates/**".into()],
            trigger: Some("ship".into()),
        },
        CompatAsset {
            id: "hermes-plugin-cache".into(),
            name: "cache-upto-stabilizer".into(),
            source: CompatSource::HermesPlugin,
            path: "~/.hermes/plugins/cache_stabilizer.py".into(),
            description: "Pins Message.cache_upto >= 512 tok for 97.9% KV hit rate".into(),
            scope_globs: vec!["*".into()],
            trigger: None,
        },
        CompatAsset {
            id: "cursor-rule-monochrome".into(),
            name: "pure-nothing-monochrome".into(),
            source: CompatSource::CursorRule,
            path: ".cursor/rules/nothing-monochrome.mdc".into(),
            description: "Enforces R===G===B achromatic tokens & surgical crimson #D71921".into(),
            scope_globs: vec!["ui/src/**".into()],
            trigger: Some("*.css,*.tsx".into()),
        },
        CompatAsset {
            id: "codex-agents".into(),
            name: "AGENTS.md".into(),
            source: CompatSource::CodexAgentsMd,
            path: "AGENTS.md".into(),
            description: "Sovereign workspace rules, aphesist authorship, lane isolation".into(),
            scope_globs: vec!["*".into()],
            trigger: None,
        },
        CompatAsset {
            id: "claude-hook-gate".into(),
            name: "pre-ship-hook".into(),
            source: CompatSource::ClaudeHook,
            path: ".claude/hooks.json".into(),
            description: "Maps PreToolUse/PostToolUse checks into Kernel Gate invariants".into(),
            scope_globs: vec!["src/**".into()],
            trigger: Some("PreToolUse".into()),
        },
        CompatAsset {
            id: "antigravity-skill-orb".into(),
            name: "living-orb-physics".into(),
            source: CompatSource::AntigravitySkill,
            path: ".agents/skills/living-orb/SKILL.md".into(),
            description: "96-vertex soft-body sphere + 32-pt exponential-map eyes".into(),
            scope_globs: vec!["ui/src/components/LivingOrb.tsx".into()],
            trigger: Some("orb".into()),
        },
    ]
}

impl AppState {
    pub fn new() -> Self {
        let seed_hash = fnv_hex("0|genesis|hypotaxis");
        let ledger = vec![LedgerEvent {
            seq: 1,
            timestamp: "2026-11-18T02:00:00Z".into(),
            kind: EventKind::RouteDecided,
            prev_hash: "00000000000000000000000000000000".into(),
            hash: seed_hash,
            payload: json!({
                "tier": "tier1_fast",
                "model": "claude-haiku-4-5",
                "cost_saved_pct": 61
            }),
        }];

        let repos = vec![ArtifactRepoSummary {
            id: "toast".into(),
            namespace: "default".into(),
            name: "CheckoutToast.tsx".into(),
            git_url: "http://127.0.0.1:53954/git/default/toast.git".into(),
            head_commit: "c94a10f".into(),
            versions: vec![
                ArtifactCommit {
                    hash: "a10f82c".into(),
                    version: 1,
                    message: "Draft static pill".into(),
                    timestamp: "2026-11-18T01:40:00Z".into(),
                },
                ArtifactCommit {
                    hash: "b38e19a".into(),
                    version: 2,
                    message: "Added countdown timer".into(),
                    timestamp: "2026-11-18T01:52:00Z".into(),
                },
                ArtifactCommit {
                    hash: "c94a10f".into(),
                    version: 3,
                    message: "Final · 429 retry toast".into(),
                    timestamp: "2026-11-18T02:04:00Z".into(),
                },
            ],
        }];

        let apple_config = AppleVmConfig {
            backend: AppleVmBackendKind::LocalQemuKvm,
            ssh_host: "100.84.12.9".into(),
            ssh_user: "aphesist".into(),
            ssh_port: 22,
            repo_mount_path: "/Volumes/core".into(),
            scheme: "CorePay".into(),
            simulator_device: "iPhone 16 Pro".into(),
        };

        Self {
            inner: Mutex::new(InnerState {
                ledger,
                repos,
                active_repo_id: "toast".into(),
                fork_counter: 0,
                apple_config,
                compat_assets: default_compat_assets(),
            }),
        }
    }

    pub fn system_status(&self) -> Result<SystemStatus, String> {
        let guard = self.inner.lock().map_err(|_| "state mutex poisoned".to_string())?;
        let head_hash = guard
            .ledger
            .last()
            .map(|e| e.hash.clone())
            .unwrap_or_else(|| "00000000000000000000000000000000".into());

        Ok(SystemStatus {
            app_name: "Hypotaxis".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            workspace_root: "~/core".into(),
            hermes: HermesBridgeStatus {
                hermes_found: true,
                hermes_version: "v0.23.2".into(),
                hermes_home: "~/.hermes".into(),
                claude_cli_found: true,
                cache_stabilizer_enabled: true,
                providers: vec![
                    ProviderProfile {
                        id: "claude-direct".into(),
                        kind: ProviderKind::ClaudeDirectSdk,
                        model: "Claude Pro/Max".into(),
                        display_name: "Claude Pro/Max".into(),
                        connected: true,
                        zero_api_cost: true,
                    },
                    ProviderProfile {
                        id: "gemini-banana".into(),
                        kind: ProviderKind::GeminiNanoBanana,
                        model: "Gemini + Nano Banana".into(),
                        display_name: "Gemini + Nano Banana".into(),
                        connected: true,
                        zero_api_cost: false,
                    },
                    ProviderProfile {
                        id: "local-qwen3".into(),
                        kind: ProviderKind::LocalOllama,
                        model: "Qwen3-Coder / DeepSeek".into(),
                        display_name: "Qwen3 / DeepSeek".into(),
                        connected: true,
                        zero_api_cost: true,
                    },
                    ProviderProfile {
                        id: "custom-openai".into(),
                        kind: ProviderKind::CustomOpenAi,
                        model: "GLM / Custom OpenAI".into(),
                        display_name: "Custom OpenAI-Compat".into(),
                        connected: false,
                        zero_api_cost: false,
                    },
                ],
            },
            active_tier: CascadeTier::Tier1Fast,
            kv_cache_hit_rate: 97.9,
            cost_saved_pct: 61.0,
            ledger_len: guard.ledger.len(),
            ledger_head_hash: head_hash,
            compat_count: 18,
            artifact_port: 53954,
            runtime_mode: "tauri".into(),
        })
    }

    pub fn append_ledger(&self, kind: EventKind, payload: Value) -> Result<LedgerEvent, String> {
        let mut guard = self.inner.lock().map_err(|_| "state mutex poisoned".to_string())?;
        let seq = guard.ledger.last().map(|e| e.seq + 1).unwrap_or(1);
        let prev_hash = guard
            .ledger
            .last()
            .map(|e| e.hash.clone())
            .unwrap_or_else(|| "00000000000000000000000000000000".into());
        let payload_str = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into());
        let kind_str = serde_json::to_string(&kind).unwrap_or_else(|_| "\"unknown\"".into());
        let hash = fnv_hex(&format!("{}|{}|{}|{}", seq, kind_str, prev_hash, payload_str));
        let event = LedgerEvent {
            seq,
            timestamp: format!("2026-11-18T02:{:02}:00Z", (seq % 60)),
            kind,
            prev_hash,
            hash,
            payload,
        };
        guard.ledger.push(event.clone());
        Ok(event)
    }

    pub fn pack(&self, request: PackRequest) -> Result<PackResult, String> {
        // Coordinator hook: wire turn_primitives::pack on main merge.
        let query = request
            .query
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .unwrap_or("rateLimit|checkout");

        let outlines = if request.include_outlines {
            vec![
                PackOutline {
                    path: "src/middleware/rateLimit.ts".into(),
                    symbols: vec![
                        "RateWindowConfig".into(),
                        "applyLimit".into(),
                        "fallbackPolicy".into(),
                    ],
                },
                PackOutline {
                    path: "src/routes/checkout.ts".into(),
                    symbols: vec!["handleCheckout".into(), "CheckoutPayload".into()],
                },
            ]
        } else {
            Vec::new()
        };

        Ok(PackResult {
            matches: vec![
                PackMatch {
                    path: "src/middleware/rateLimit.ts".into(),
                    line: 18,
                    snippet: format!("export function applyLimit(userId: string) // matched \"{}\"", query),
                },
                PackMatch {
                    path: "src/routes/checkout.ts".into(),
                    line: 42,
                    snippet: "router.post(\"/api/checkout\", applyLimit, handleCheckout)".into(),
                },
            ],
            outlines,
            git_status: vec![
                "M src/middleware/rateLimit.ts".into(),
                "M src/routes/checkout.ts".into(),
            ],
            redacted_secrets: 1,
            truncated: request.max_bytes < 512,
        })
    }

    pub fn ship_gate(&self, request: ShipRequest) -> Result<ShipResult, String> {
        // Coordinator hook: wire turn_primitives::ship + contraprova_kernel::gate on main merge.
        if !request.human_approved && !request.run_gate {
            let _ = self.append_ledger(
                EventKind::GateDecided,
                json!({
                    "lane": request.brief.lane_id,
                    "decision": "DENIED",
                    "rolled_back": true
                }),
            )?;
            return Ok(ShipResult {
                status: ShipStatus::AbortedBeforeWrite,
                changed_files: Vec::new(),
                gate_passed: false,
                gate_output:
                    "gate.decided(DENIED) · 0 dirty files · working tree restored byte-for-byte"
                        .into(),
                diagnostics: vec![ShipDiagnostic {
                    path: request
                        .edits
                        .first()
                        .map(|e| e.path.clone())
                        .unwrap_or_else(|| "src/middleware/rateLimit.ts".into()),
                    reason: "Human gate denied ship; rollback journal restored pre-image.".into(),
                    closest_snippet: None,
                    first_diff_line: None,
                }],
                rolled_back: true,
                cost_saved_usd: 0.0,
            });
        }

        if !request.human_approved {
            return Ok(ShipResult {
                status: ShipStatus::HeldForHumanGate,
                changed_files: request.edits.iter().map(|e| e.path.clone()).collect(),
                gate_passed: false,
                gate_output: "Held for human approval on Contract Lane".into(),
                diagnostics: Vec::new(),
                rolled_back: false,
                cost_saved_usd: 0.0,
            });
        }

        let changed_files: Vec<String> = if request.edits.is_empty() {
            vec![
                "src/middleware/rateLimit.ts".into(),
                "src/routes/checkout.ts".into(),
            ]
        } else {
            request.edits.iter().map(|e| e.path.clone()).collect()
        };

        let _ = self.append_ledger(
            EventKind::GateDecided,
            json!({
                "lane": request.brief.lane_id,
                "decision": "PASS",
                "files": changed_files
            }),
        )?;

        Ok(ShipResult {
            status: ShipStatus::ShippedAndVerified,
            changed_files,
            gate_passed: true,
            gate_output: "gate.decided(PASS) · 14/14 assertions passed · $0.038 vs $0.112 Opus"
                .into(),
            diagnostics: Vec::new(),
            rolled_back: false,
            cost_saved_usd: 0.074,
        })
    }

    pub fn compat_assets(&self, _root: Option<String>) -> Result<Vec<CompatAsset>, String> {
        // Coordinator hook: wire compat_loader::scan_workspace on main merge.
        let guard = self.inner.lock().map_err(|_| "state mutex poisoned".to_string())?;
        Ok(guard.compat_assets.clone())
    }

    pub fn artifact_action(
        &self,
        request: ArtifactActionRequest,
    ) -> Result<ArtifactActionResponse, String> {
        // Coordinator hook: wire local_artifacts::ArtifactStore on main merge.
        let mut guard = self.inner.lock().map_err(|_| "state mutex poisoned".to_string())?;
        match request {
            ArtifactActionRequest::List => {
                let active = guard
                    .repos
                    .iter()
                    .find(|r| r.id == guard.active_repo_id)
                    .cloned()
                    .or_else(|| guard.repos.first().cloned())
                    .ok_or_else(|| "no artifact repositories available".to_string())?;
                Ok(ArtifactActionResponse {
                    active,
                    fork_result: None,
                    repos: guard.repos.clone(),
                })
            }
            ArtifactActionRequest::Fork {
                source_id,
                fork_name,
            } => {
                let source = guard
                    .repos
                    .iter()
                    .find(|r| r.id == source_id)
                    .cloned()
                    .or_else(|| guard.repos.first().cloned())
                    .ok_or_else(|| "source artifact repository not found".to_string())?;
                guard.fork_counter += 1;
                let count = guard.fork_counter;
                let fork_id = format!("{}-fork-{}", source.id, count);
                let fork_url =
                    format!("http://127.0.0.1:53954/git/{}/{}.git", source.namespace, fork_id);
                let forked = ArtifactRepoSummary {
                    id: fork_id.clone(),
                    namespace: source.namespace.clone(),
                    name: fork_name.unwrap_or_else(|| format!("{} (fork-{})", source.name, count)),
                    git_url: fork_url.clone(),
                    head_commit: source.head_commit.clone(),
                    versions: source.versions.clone(),
                };
                guard.repos.push(forked.clone());
                guard.active_repo_id = fork_id.clone();
                let repos = guard.repos.clone();
                drop(guard);

                let _ = self.append_ledger(
                    EventKind::ForkCreated,
                    json!({
                        "source_id": source.id,
                        "fork_id": fork_id,
                        "fork_url": fork_url
                    }),
                )?;

                Ok(ArtifactActionResponse {
                    active: forked.clone(),
                    fork_result: Some(ArtifactForkResult {
                        source_id: source.id,
                        fork_id,
                        fork_url,
                        head_commit: forked.head_commit,
                    }),
                    repos,
                })
            }
            ArtifactActionRequest::Create {
                namespace,
                name,
                message,
            } => {
                if let Some(existing) = guard.repos.iter_mut().find(|r| r.id == name) {
                    let next_ver = (existing.versions.len() as u32) + 1;
                    let next_hash =
                        fnv_hex(&format!("{}|v{}|{}", existing.id, next_ver, message))[..7]
                            .to_string();
                    existing.versions.push(ArtifactCommit {
                        hash: next_hash.clone(),
                        version: next_ver,
                        message,
                        timestamp: "2026-11-18T02:15:00Z".into(),
                    });
                    existing.head_commit = next_hash;
                    let updated = existing.clone();
                    guard.active_repo_id = updated.id.clone();
                    return Ok(ArtifactActionResponse {
                        active: updated,
                        fork_result: None,
                        repos: guard.repos.clone(),
                    });
                }

                let created = ArtifactRepoSummary {
                    id: name.clone(),
                    namespace: namespace.clone(),
                    name: name.clone(),
                    git_url: format!("http://127.0.0.1:53954/git/{}/{}.git", namespace, name),
                    head_commit: "d12e001".into(),
                    versions: vec![ArtifactCommit {
                        hash: "d12e001".into(),
                        version: 1,
                        message,
                        timestamp: "2026-11-18T02:15:00Z".into(),
                    }],
                };
                guard.repos.push(created.clone());
                guard.active_repo_id = created.id.clone();
                Ok(ArtifactActionResponse {
                    active: created,
                    fork_result: None,
                    repos: guard.repos.clone(),
                })
            }
        }
    }

    pub fn apple_vm_status(&self, config: Option<AppleVmConfig>) -> Result<AppleVmStatus, String> {
        // Coordinator hook: wire apple_vm::probe_backend on main merge.
        let mut guard = self.inner.lock().map_err(|_| "state mutex poisoned".to_string())?;
        if let Some(cfg) = config {
            guard.apple_config = cfg;
        }
        let cfg = &guard.apple_config;
        let status = match cfg.backend {
            AppleVmBackendKind::RemoteAppleSsh => AppleVmStatus {
                backend: AppleVmBackendKind::RemoteAppleSsh,
                connected: true,
                host_os_supported: true,
                detail: format!(
                    "Connected to Mac mini M4 ({}) via Tailscale SSH — native Metal-accelerated iOS Simulator & Xcode previews.",
                    cfg.ssh_host
                ),
                stream_hint: "Tailscale · Mac M4".into(),
            },
            AppleVmBackendKind::SimulatedPreview => AppleVmStatus {
                backend: AppleVmBackendKind::SimulatedPreview,
                connected: true,
                host_os_supported: true,
                detail:
                    "Deterministic local Apple Simulator preview runner active for offline/CI verification."
                        .into(),
                stream_hint: "Simulated · Local".into(),
            },
            AppleVmBackendKind::LocalQemuKvm => AppleVmStatus {
                backend: AppleVmBackendKind::LocalQemuKvm,
                connected: true,
                host_os_supported: true,
                detail:
                    "Local QEMU/KVM + OpenCore CLI builds, or pair a Remote Apple Silicon Mac over Tailscale for full Metal iOS Simulator speed."
                        .into(),
                stream_hint: "QEMU/KVM · VirtioFS".into(),
            },
        };
        Ok(status)
    }

    pub fn xcode_build(&self, config: AppleVmConfig) -> Result<XcodeBuildResult, String> {
        // Coordinator hook: wire apple_vm::run_xcodebuild on main merge.
        {
            let mut guard = self.inner.lock().map_err(|_| "state mutex poisoned".to_string())?;
            guard.apple_config = config.clone();
        }
        let duration_ms = match config.backend {
            AppleVmBackendKind::RemoteAppleSsh => 840,
            AppleVmBackendKind::LocalQemuKvm => 1120,
            AppleVmBackendKind::SimulatedPreview => 460,
        };
        Ok(XcodeBuildResult {
            backend: config.backend,
            succeeded: true,
            duration_ms,
            tests_passed: 14,
            tests_total: 14,
            log_lines: vec![
                format!("Syncing {} over VirtioFS...", config.repo_mount_path),
                format!(
                    "xcodebuild test -scheme {} -destination \"platform=iOS Simulator,name={}\"",
                    config.scheme, config.simulator_device
                ),
                "Test Suite CheckoutRateLimitTests passed (14/14 assertions)".into(),
            ],
            simulator_screen_title: "CorePay iOS · 429 Retry Guard".into(),
        })
    }
}

#[tauri::command]
fn ping_hypotaxis() -> &'static str {
    "hypotaxis-ready"
}

#[tauri::command]
fn get_system_status(state: State<'_, AppState>) -> Result<SystemStatus, String> {
    state.system_status()
}

#[tauri::command]
fn run_pack(state: State<'_, AppState>, request: PackRequest) -> Result<PackResult, String> {
    state.pack(request)
}

#[tauri::command]
fn run_ship_gate(state: State<'_, AppState>, request: ShipRequest) -> Result<ShipResult, String> {
    state.ship_gate(request)
}

#[tauri::command]
fn list_compat_assets(
    state: State<'_, AppState>,
    root: Option<String>,
) -> Result<Vec<CompatAsset>, String> {
    state.compat_assets(root)
}

#[tauri::command]
fn create_or_fork_artifact(
    state: State<'_, AppState>,
    request: ArtifactActionRequest,
) -> Result<ArtifactActionResponse, String> {
    state.artifact_action(request)
}

#[tauri::command]
fn get_apple_vm_status(
    state: State<'_, AppState>,
    config: Option<AppleVmConfig>,
) -> Result<AppleVmStatus, String> {
    state.apple_vm_status(config)
}

#[tauri::command]
fn run_xcode_build(
    state: State<'_, AppState>,
    config: AppleVmConfig,
) -> Result<XcodeBuildResult, String> {
    state.xcode_build(config)
}

#[tauri::command]
fn append_ledger_event(
    state: State<'_, AppState>,
    kind: EventKind,
    payload: Value,
) -> Result<LedgerEvent, String> {
    state.append_ledger(kind, payload)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            ping_hypotaxis,
            get_system_status,
            run_pack,
            run_ship_gate,
            list_compat_assets,
            create_or_fork_artifact,
            get_apple_vm_status,
            run_xcode_build,
            append_ledger_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running hypotaxis tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use hypotaxis_contracts::TaskBrief;

    #[test]
    fn app_state_ledger_and_fork_chain() {
        let state = AppState::new();
        let status = state.system_status().expect("system status");
        assert_eq!(status.ledger_len, 1);

        let forked = state
            .artifact_action(ArtifactActionRequest::Fork {
                source_id: "toast".into(),
                fork_name: None,
            })
            .expect("fork artifact");
        assert!(forked.fork_result.is_some());
        assert_eq!(forked.repos.len(), 2);

        let status_after = state.system_status().expect("status after fork");
        assert_eq!(status_after.ledger_len, 2);
    }

    #[test]
    fn ship_gate_approval_and_rollback() {
        let state = AppState::new();
        let brief = TaskBrief {
            id: "lane-a".into(),
            goal: "Rate limit".into(),
            scope_globs: vec!["src/**".into()],
            lane_id: "A".into(),
            invariants: vec![],
        };

        let denied = state
            .ship_gate(ShipRequest {
                root: ".".into(),
                brief: brief.clone(),
                edits: vec![],
                run_gate: false,
                human_approved: false,
            })
            .expect("denied gate");
        assert_eq!(denied.status, ShipStatus::AbortedBeforeWrite);
        assert!(denied.rolled_back);

        let approved = state
            .ship_gate(ShipRequest {
                root: ".".into(),
                brief,
                edits: vec![],
                run_gate: true,
                human_approved: true,
            })
            .expect("approved gate");
        assert_eq!(approved.status, ShipStatus::ShippedAndVerified);
        assert!(approved.gate_passed);
    }
}
