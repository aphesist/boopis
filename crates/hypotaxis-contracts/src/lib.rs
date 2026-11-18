use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The 9 canonical Contraprova governance ledger event types.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    TaskCreated,
    TaskClaimed,
    TaskSubmitted,
    GateDecided,
    RouteDecided,
    RouterTrained,
    ForkCreated,
    UsageRecorded,
    OutcomeScored,
}

/// Hash-chained, append-only JSONL ledger record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LedgerEvent {
    pub seq: u64,
    pub timestamp: String,
    pub kind: EventKind,
    pub prev_hash: String,
    pub hash: String,
    pub payload: Value,
}

/// Counterfactual cascade model tiers.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum CascadeTier {
    Tier1Fast,
    Tier2Balanced,
    Tier3Frontier,
}

impl CascadeTier {
    pub fn next(self) -> Option<Self> {
        match self {
            Self::Tier1Fast => Some(Self::Tier2Balanced),
            Self::Tier2Balanced => Some(Self::Tier3Frontier),
            Self::Tier3Frontier => None,
        }
    }
}

/// Structured orchestrator brief enforcing scope globs and invariants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskBrief {
    pub id: String,
    pub goal: String,
    pub scope_globs: Vec<String>,
    pub lane_id: String,
    pub invariants: Vec<String>,
}

/// Contract Lane isolating parallel workers without merge clashes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContractLane {
    pub id: String,
    pub owner_bot: String,
    pub frozen_interfaces: Vec<String>,
    pub scope_globs: Vec<String>,
}

/// Compound Primitive 1 (`pack`): 1-call context, outline & git status request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackRequest {
    pub root: String,
    pub query: Option<String>,
    pub files: Vec<String>,
    pub include_outlines: bool,
    pub max_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackMatch {
    pub path: String,
    pub line: usize,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackOutline {
    pub path: String,
    pub symbols: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackResult {
    pub matches: Vec<PackMatch>,
    pub outlines: Vec<PackOutline>,
    pub git_status: Vec<String>,
    pub redacted_secrets: usize,
    pub truncated: bool,
}

/// Compound Primitive 2 (`exec`): persistent stateful Python REPL + parallel tool bindings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExecToolCall {
    pub tool: String,
    pub args: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExecRequest {
    pub session_id: String,
    pub code: String,
    pub parallel_tools: Vec<ExecToolCall>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub persisted_vars: Vec<String>,
    pub duration_ms: u64,
}

/// Compound Primitive 3 (`ship`): pre-write validated edit + kernel gate + rollback journal.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShipEdit {
    pub path: String,
    pub old_text: Option<String>,
    pub new_text: String,
    pub create_if_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShipRequest {
    pub root: String,
    pub brief: TaskBrief,
    pub edits: Vec<ShipEdit>,
    pub run_gate: bool,
    pub human_approved: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ShipStatus {
    ShippedAndVerified,
    AbortedBeforeWrite,
    FailedAndRolledBack,
    HeldForHumanGate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShipDiagnostic {
    pub path: String,
    pub reason: String,
    pub closest_snippet: Option<String>,
    pub first_diff_line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShipResult {
    pub status: ShipStatus,
    pub changed_files: Vec<String>,
    pub gate_passed: bool,
    pub gate_output: String,
    pub diagnostics: Vec<ShipDiagnostic>,
    pub rolled_back: bool,
    pub cost_saved_usd: f64,
}

/// Cross-harness skill, plugin, rule, and hook compatibility catalog.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompatSource {
    HermesPlugin,
    ClaudeSkill,
    ClaudeCommand,
    ClaudeHook,
    CursorRule,
    CodexAgentsMd,
    AntigravitySkill,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CompatAsset {
    pub id: String,
    pub name: String,
    pub source: CompatSource,
    pub path: String,
    pub description: String,
    pub scope_globs: Vec<String>,
    pub trigger: Option<String>,
}

/// Git-backed Local Artifacts (@dinasaur_404 model).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtifactRepoSummary {
    pub id: String,
    pub namespace: String,
    pub name: String,
    pub git_url: String,
    pub head_commit: String,
    pub versions: Vec<ArtifactCommit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtifactCommit {
    pub hash: String,
    pub version: u32,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtifactForkResult {
    pub source_id: String,
    pub fork_id: String,
    pub fork_url: String,
    pub head_commit: String,
}

/// Apple Bubble VM backends & Xcode / Simulator builds.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppleVmBackendKind {
    RemoteAppleSsh,
    LocalQemuKvm,
    SimulatedPreview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppleVmConfig {
    pub backend: AppleVmBackendKind,
    pub ssh_host: String,
    pub ssh_user: String,
    pub ssh_port: u16,
    pub repo_mount_path: String,
    pub scheme: String,
    pub simulator_device: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppleVmStatus {
    pub backend: AppleVmBackendKind,
    pub connected: bool,
    pub host_os_supported: bool,
    pub detail: String,
    pub stream_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct XcodeBuildResult {
    pub backend: AppleVmBackendKind,
    pub succeeded: bool,
    pub duration_ms: u64,
    pub tests_passed: u32,
    pub tests_total: u32,
    pub log_lines: Vec<String>,
    pub simulator_screen_title: String,
}

/// Hermes Base & Subscription Provider Broker.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    ClaudeDirectSdk,
    GeminiNanoBanana,
    LocalOllama,
    CustomOpenAi,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProviderProfile {
    pub id: String,
    pub kind: ProviderKind,
    pub model: String,
    pub display_name: String,
    pub connected: bool,
    pub zero_api_cost: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HermesBridgeStatus {
    pub hermes_found: bool,
    pub hermes_version: String,
    pub hermes_home: String,
    pub claude_cli_found: bool,
    pub cache_stabilizer_enabled: bool,
    pub providers: Vec<ProviderProfile>,
}
