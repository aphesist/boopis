//! The store's shapes, field for field the ones of `apps/shared/data/store.schema.json` (the contract: ADR-0038). Every key is
//! `snake_case`; the enums are kebab-case words (`engine-plugin`, `not-reviewed`). A field the schema requires but allows to be
//! null is an `Option` that serializes as `null`; a field the schema lets be absent is an `Option` that is skipped when `None`.
//! Unknown keys are refused, so the host and the data cannot drift: the round-trip tests below read the shared fixture and the
//! sources file and compare them to what these types write back.
//!
//! The field names are the contract and carry the schema's descriptions, so the fields are not documented again here.
#![allow(missing_docs)]

use serde::{Deserialize, Serialize};
use specta::Type;

/// What an item is.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreKind")]
pub enum ItemKind {
    Skill,
    Connector,
    Plugin,
    Mod,
    EnginePlugin,
}

/// The item's tier: "Recommended by boopis", "Verified by its source", "Not reviewed".
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreTier")]
pub enum Tier {
    Recommended,
    Verified,
    NotReviewed,
}

/// What a pin is made of.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StorePinKind")]
pub enum PinKind {
    Commit,
    ArchiveSha256,
    TreeSha256,
    OciDigest,
    Version,
}

/// What an item is pinned to. Pinned or refused.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StorePin")]
pub struct Pin {
    #[serde(rename = "type")]
    pub kind: PinKind,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
}

/// How far to trust a host list.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreHostBasis")]
pub enum HostBasis {
    Declared,
    Verified,
    Loopback,
    Unknown,
}

/// The network hosts an item reaches.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreHosts")]
pub struct HostList {
    pub basis: HostBasis,
    pub hosts: Vec<String>,
}

/// A key or credential an item needs (never its value).
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreSecret")]
pub struct SecretNeed {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    pub optional: bool,
}

/// What an item holds, as counts.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreComponentCounts")]
pub struct ComponentCounts {
    pub known: bool,
    pub skills: u32,
    pub commands: u32,
    pub agents: u32,
    pub hooks: u32,
    pub mcp_servers: u32,
    pub modules: u32,
    pub scripts: u32,
    pub python: u32,
}

/// Who took an item down.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreRemovedBy")]
pub enum RemovedBy {
    Boopis,
    Source,
    Registry,
    Engine,
}

/// The kill list's entry for an item.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreRemoved")]
pub struct Removed {
    pub reason: String,
    pub by: RemovedBy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}

/// A static check's verdict.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreScanVerdict")]
pub enum ScanVerdict {
    Safe,
    Caution,
    Dangerous,
    NotScanned,
}

/// How serious a finding, a warning or a note is.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreFindingLevel")]
pub enum FindingLevel {
    Info,
    Caution,
    Dangerous,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreScanFinding")]
pub struct ScanFinding {
    pub level: FindingLevel,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreScan")]
pub struct Scan {
    pub verdict: ScanVerdict,
    pub scanner: String,
    pub findings: Vec<ScanFinding>,
}

/// How the source proved the publisher owns the name.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreNamespaceProof")]
pub enum NamespaceProof {
    Github,
    Dns,
    Http,
    Curated,
    Registry,
    None,
}

/// Where an item came from and how far that can be checked.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Provenance {
    pub source: String,
    pub publisher: String,
    pub namespace_proof: NamespaceProof,
    pub pinned: Option<Pin>,
    pub tree_sha256: Option<String>,
    pub scan: Scan,
    pub source_url: String,
    pub fetched_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_updated: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_tier: Option<String>,
}

/// One catalogue entry, normalised from any source.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StoreItem {
    pub id: String,
    pub kind: ItemKind,
    pub title: String,
    pub publisher: String,
    pub summary: String,
    pub license: String,
    pub homepage: Option<String>,
    pub version: Option<String>,
    pub pinned: Option<Pin>,
    pub components: ComponentCounts,
    pub hosts: HostList,
    pub secrets: Vec<SecretNeed>,
    pub tier: Tier,
    pub source: String,
    pub verified: Option<String>,
    pub removed: Option<Removed>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    pub provenance: Provenance,
}

/// How the host reads a source.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreSourceFetch")]
pub enum SourceFetch {
    CompiledIn,
    EngineGateway,
    GitMarketplace,
    GitRepo,
    HttpJson,
    RegistryApi,
    GithubApi,
    Local,
}

/// Whether the terms for listing a source's items were read.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreTerms")]
pub enum Terms {
    Own,
    Checked,
    Unverified,
    NotApplicable,
}

/// A place items come from. The last five fields are the host's runtime state and are absent in the data file.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StoreSource {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub kinds: Vec<ItemKind>,
    pub fetch: SourceFetch,
    pub default_tier: Tier,
    pub default_on: bool,
    pub user_added: bool,
    pub engine_origin: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terms: Option<Terms>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refreshed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Which layer installs the item.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreLayer")]
pub enum Layer {
    Connector,
    Plugin,
    Engine,
}

/// What a component is.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreComponentKind")]
pub enum ComponentKind {
    Skill,
    Command,
    Agent,
    Hook,
    McpServer,
    Module,
    Script,
    PythonPlugin,
    Theme,
    Other,
}

/// One thing an install adds.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreComponent")]
pub struct Component {
    #[serde(rename = "type")]
    pub kind: ComponentKind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// What kind of code runs.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreCodeKind")]
pub enum CodeKind {
    Hook,
    McpCommand,
    PackageStart,
    Script,
    Module,
    Python,
}

/// Where code runs.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreCodeWhere")]
pub enum CodeWhere {
    Sandbox,
    OutsideSandbox,
    EngineProcess,
}

/// Code that runs on the user's machine once the item is installed and active.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreCodeRun")]
pub struct CodeRun {
    pub what: CodeKind,
    pub command: String,
    #[serde(rename = "where")]
    pub runs_where: CodeWhere,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreFileWrite")]
pub struct FileWrite {
    pub path: String,
    pub purpose: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<f64>)]
    pub bytes: Option<u64>,
}

/// Where an install lives.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreScopeLevel")]
pub enum ScopeLevel {
    Bot,
    BotProject,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreScope")]
pub struct Scope {
    pub level: ScopeLevel,
    pub bot: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
}

/// One thing the user agrees to.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreConsent")]
pub struct ConsentItem {
    pub id: String,
    pub text: String,
    pub runs_code: bool,
}

/// How strong a warning is.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreWarningLevel")]
pub enum WarningLevel {
    Info,
    Caution,
    Strong,
}

/// A line the review card must show.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreWarning")]
pub struct Warning {
    pub code: String,
    pub level: WarningLevel,
    pub text: String,
}

/// What governed mode does with the item.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreGoverned")]
pub struct GovernedNote {
    pub allowed: bool,
    pub switch_blocks: bool,
    pub text: String,
}

/// What an item costs every session.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreCost")]
pub struct Cost {
    pub tools: Option<u32>,
    pub context_tokens: Option<u32>,
}

/// What an install would do, exactly: the review card's data.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InstallPlan {
    pub item_id: String,
    pub kind: ItemKind,
    pub title: String,
    pub source: String,
    pub publisher: String,
    pub version: Option<String>,
    pub pinned: Pin,
    pub tree_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage_id: Option<String>,
    pub layer: Layer,
    pub components: Vec<Component>,
    pub code_runs: Vec<CodeRun>,
    pub hosts: HostList,
    pub secrets: Vec<SecretNeed>,
    pub files_written: Vec<FileWrite>,
    pub scope: Scope,
    pub consent: Vec<ConsentItem>,
    pub warnings: Vec<Warning>,
    pub governed: GovernedNote,
    pub cost: Cost,
    pub tier: Tier,
    pub scan: Scan,
    pub sessions_open: Option<u32>,
    pub plan_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreInstallStep")]
pub struct InstallStep {
    pub name: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// The version kept one step back, and a version in an update's diff.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StorePrevious")]
pub struct PreviousVersion {
    pub version: Option<String>,
    pub pinned: Pin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tree_sha256: Option<String>,
}

/// An install takes effect in the next session, always.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreEffective")]
pub enum Effective {
    NextSession,
}

/// What an install, update or rollback did; also the row of the installed list.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InstallReceipt {
    pub item_id: String,
    pub kind: ItemKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub source: String,
    pub layer: Layer,
    pub version: Option<String>,
    pub pinned: Pin,
    pub plan_hash: String,
    pub tree_sha256: Option<String>,
    pub installed_at: String,
    pub scope: Scope,
    pub files: Vec<String>,
    pub enabled: bool,
    pub effective: Effective,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trusted_projects: Option<Vec<String>>,
    pub previous: Option<PreviousVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kill_listed: Option<Removed>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restart_needed: Option<bool>,
    pub steps: Vec<InstallStep>,
    pub notes: Vec<String>,
}

/// Whether a line of a diff adds, removes or changes.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreChangeAction")]
pub enum ChangeAction {
    Added,
    Removed,
    Changed,
}

/// What a line of a diff is about: a component kind, a host, a secret or the licence.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreChangeKind")]
pub enum ChangeKind {
    Skill,
    Command,
    Agent,
    Hook,
    McpServer,
    Module,
    Script,
    PythonPlugin,
    Theme,
    Other,
    Host,
    Secret,
    License,
}

/// One line of an update's component diff.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreChange")]
pub struct Change {
    #[serde(rename = "change")]
    pub action: ChangeAction,
    #[serde(rename = "type")]
    pub kind: ChangeKind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Where an update stands.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreUpdateStatus")]
pub enum UpdateStatus {
    Available,
    UpToDate,
    Removed,
    Unpinned,
    SourceUnreachable,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename = "StoreTierChange")]
pub struct TierChange {
    pub from: Tier,
    pub to: Tier,
}

/// What changes if an installed item moves to the catalogue's pin.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UpdateDiff {
    pub item_id: String,
    pub status: UpdateStatus,
    pub from: PreviousVersion,
    pub to: Option<PreviousVersion>,
    pub changes: Vec<Change>,
    pub new_hosts: Vec<String>,
    pub new_secrets: Vec<SecretNeed>,
    pub new_code: Vec<CodeRun>,
    pub widened: bool,
    pub tier_changed: Option<TierChange>,
    pub removed: Option<Removed>,
    pub to_plan_hash: Option<String>,
}

/// The schema's root: the shapes bundled, as the fixture and the sources file are.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Bundle {
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<StoreSource>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<StoreItem>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plans: Option<Vec<InstallPlan>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipts: Option<Vec<InstallReceipt>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diffs: Option<Vec<UpdateDiff>>,
}

/// What browse and search narrow by.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StoreFilter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<ItemKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tier: Option<Tier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide_unpinned: Option<bool>,
}

/// A page of the catalogue, from the local cache.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StoreBrowse {
    pub items: Vec<StoreItem>,
    pub total: u32,
    pub next_cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended: Option<Vec<StoreItem>>,
    pub refreshed_at: Option<String>,
    pub stale: bool,
    pub offline: bool,
}

/// Everything the detail page shows.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StoreDetail {
    pub item: StoreItem,
    pub installed: Option<InstallReceipt>,
    pub update: Option<UpdateDiff>,
    pub governed: GovernedNote,
    pub cost: Cost,
}

/// What staging an item left in the staging folder. Nothing has run.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StageResult {
    pub stage_id: String,
    pub item_id: String,
    pub pinned: Pin,
    pub tree_sha256: Option<String>,
    pub files: u32,
    #[specta(type = f64)]
    pub bytes: u64,
    pub scan: Scan,
    pub expires_at: String,
}

/// What the plugin returns from `plugin.boopis.store.prepare`: its half of an install plan.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PluginPlan {
    pub kind: ItemKind,
    pub slug: String,
    pub tree_sha256: Option<String>,
    pub components: Vec<Component>,
    pub code_runs: Vec<CodeRun>,
    pub hosts: HostList,
    pub secrets: Vec<SecretNeed>,
    pub files_written: Vec<FileWrite>,
    pub consent: Vec<ConsentItem>,
    pub warnings: Vec<Warning>,
    pub governed: GovernedNote,
    pub cost: Cost,
    pub scan: Scan,
    pub plugin_hash: String,
}

/// When an install that needs an engine restart happens.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[serde(rename = "StoreRestartWhen")]
pub enum RestartWhen {
    Now,
    WhenIdle,
}

/// The staging handle and the hash of the plan the user saw; secret values travel to the keychain and no further.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InstallRequest {
    pub stage_id: String,
    pub plan_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secrets: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restart: Option<RestartWhen>,
}

/// What an uninstall removed and what it kept.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UninstallResult {
    pub item_id: String,
    pub removed: Vec<String>,
    pub kept_secrets: Vec<String>,
    pub notes: Vec<String>,
}

/// A project's switch "no engine plugins and no plugin hooks".
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectPolicy {
    pub project: String,
    pub governed: bool,
    pub explicit: Option<bool>,
    pub effective: bool,
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use serde_json::Value;
    use sha2::{Digest, Sha256};

    use super::*;

    const FIXTURES: &str = include_str!("../../../../shared/data/store.fixtures.json");
    const SOURCES: &str = include_str!("../../../../shared/data/store-sources.json");

    fn round_trip(raw: &str) -> Bundle {
        let value: Value = serde_json::from_str(raw).unwrap();
        let bundle: Bundle = serde_json::from_str(raw).unwrap();
        assert_eq!(
            serde_json::to_value(&bundle).unwrap(),
            value,
            "the types write back what the data says"
        );
        bundle
    }

    #[test]
    fn the_fixture_round_trips() {
        let b = round_trip(FIXTURES);
        let items = b.items.unwrap();
        for kind in [
            ItemKind::Skill,
            ItemKind::Connector,
            ItemKind::Plugin,
            ItemKind::Mod,
            ItemKind::EnginePlugin,
        ] {
            assert!(
                items.iter().any(|i| i.kind == kind),
                "a {kind:?} in the fixture"
            );
        }
        for tier in [Tier::Recommended, Tier::Verified, Tier::NotReviewed] {
            assert!(
                items.iter().any(|i| i.tier == tier),
                "a {tier:?} item in the fixture"
            );
        }
        assert!(items.iter().any(|i| i.pinned.is_none()), "an unpinned item");
        assert!(
            items.iter().any(|i| i.removed.is_some()),
            "a kill-listed item"
        );
        assert_eq!(b.plans.unwrap().len(), 2);
    }

    #[test]
    fn the_sources_file_round_trips_and_names_every_source_of_the_brief() {
        let sources = round_trip(SOURCES).sources.unwrap();
        let ids: Vec<&str> = sources.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "boopis",
                "engine-plugins",
                "skills-hub",
                "anthropic",
                "mcp-registry",
                "github",
                "marketplace-url",
                "local"
            ]
        );
        assert!(
            sources.iter().all(|s| !s.user_added),
            "the data file holds the built-in sources only"
        );
    }

    #[test]
    fn an_item_id_is_its_source_and_a_name() {
        let items = round_trip(FIXTURES).items.unwrap();
        for item in &items {
            let (source, name) = item.id.split_once(':').unwrap();
            assert_eq!(source, item.source);
            assert_eq!(source, item.provenance.source);
            assert!(!name.is_empty());
        }
    }

    /// The plan hash is the sha256 of the canonical JSON (keys sorted, no whitespace) without `plan_hash` and `sessions_open`:
    /// this is the reference the plugin's golden vector (workstream B) must match.
    pub(crate) fn plan_hash(plan: &InstallPlan) -> String {
        let mut v = serde_json::to_value(plan).unwrap();
        let o = v.as_object_mut().unwrap();
        o.remove("plan_hash");
        o.remove("sessions_open");
        hex::encode(Sha256::digest(
            serde_json::to_string(&v).unwrap().as_bytes(),
        ))
    }

    #[test]
    fn the_fixture_plan_hashes_follow_the_documented_rule() {
        for plan in round_trip(FIXTURES).plans.unwrap() {
            assert_eq!(plan_hash(&plan), plan.plan_hash, "{}", plan.item_id);
        }
    }

    #[test]
    fn the_command_shapes_hold_the_fixture_items() {
        let b = round_trip(FIXTURES);
        let items = b.items.unwrap();
        let page = StoreBrowse {
            items: items.clone(),
            total: 10,
            next_cursor: None,
            recommended: Some(items[..2].to_vec()),
            refreshed_at: Some("2026-11-21T09:30:00Z".into()),
            stale: false,
            offline: false,
        };
        let back: StoreBrowse =
            serde_json::from_value(serde_json::to_value(&page).unwrap()).unwrap();
        assert_eq!(back, page);
        let detail = StoreDetail {
            item: items[0].clone(),
            installed: b.receipts.unwrap().into_iter().next(),
            update: b.diffs.unwrap().into_iter().next(),
            governed: b.plans.unwrap()[0].governed.clone(),
            cost: Cost {
                tools: None,
                context_tokens: None,
            },
        };
        let back: StoreDetail =
            serde_json::from_value(serde_json::to_value(&detail).unwrap()).unwrap();
        assert_eq!(back, detail);
        let request: InstallRequest =
            serde_json::from_str(r#"{"stage_id":"stg-1","plan_hash":"00","restart":"when-idle"}"#)
                .unwrap();
        assert_eq!(request.restart, Some(RestartWhen::WhenIdle));
    }

    #[test]
    fn unknown_keys_are_refused() {
        let mut v: Value = serde_json::from_str(FIXTURES).unwrap();
        v["items"][0]["surprise"] = Value::Bool(true);
        assert!(serde_json::from_value::<Bundle>(v).is_err());
    }
}
