use std::collections::{BTreeMap, HashSet};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use hypotaxis_contracts::{HermesBridgeStatus, ProviderKind, ProviderProfile};
use serde::{Deserialize, Serialize};

use crate::error::BridgeError;

/// Parsed contents of Hermes Agent's `install-stamp.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallStamp {
    pub schema_version: Option<u32>,
    pub commit: Option<String>,
    pub branch: Option<String>,
    pub built_at: Option<String>,
    pub dirty: Option<bool>,
    pub source: Option<String>,
    pub base_version: Option<String>,
    pub display_version: Option<String>,
    pub tag: Option<String>,
}

impl InstallStamp {
    /// Returns the best human-facing Hermes version string recorded in the stamp.
    pub fn preferred_version(&self) -> Option<String> {
        if let Some(v) = self.display_version.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            return Some(v.to_string());
        }
        if let Some(v) = self.base_version.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            return Some(v.to_string());
        }
        if let Some(tag) = self.tag.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            return Some(tag.to_string());
        }
        self.commit
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|c| c.chars().take(8).collect())
    }
}

/// Configurable paths & overrides for probing Hermes Agent and provider availability.
///
/// Leaving fields as `None` uses standard host paths and environment variables.
/// Tests can populate overrides to keep probes isolated from host state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryOptions {
    pub hermes_home_override: Option<PathBuf>,
    pub hermes_agent_dir_override: Option<PathBuf>,
    pub hermes_bin_override: Option<PathBuf>,
    pub claude_bin_override: Option<PathBuf>,
    pub search_path_dirs: Option<Vec<PathBuf>>,
    pub user_home_override: Option<PathBuf>,
    pub local_appdata_override: Option<PathBuf>,
    pub ollama_endpoint: String,
    pub ollama_reachable_override: Option<bool>,
    pub env_overrides: Option<BTreeMap<String, String>>,
    pub cache_stabilizer_enabled: bool,
}

impl Default for DiscoveryOptions {
    fn default() -> Self {
        Self {
            hermes_home_override: None,
            hermes_agent_dir_override: None,
            hermes_bin_override: None,
            claude_bin_override: None,
            search_path_dirs: None,
            user_home_override: None,
            local_appdata_override: None,
            ollama_endpoint: "127.0.0.1:11434".to_string(),
            ollama_reachable_override: None,
            env_overrides: None,
            cache_stabilizer_enabled: true,
        }
    }
}

/// Detailed discovery output combining `HermesBridgeStatus` with resolved binary/directory paths.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HermesDiscoveryReport {
    pub status: HermesBridgeStatus,
    pub hermes_agent_dir: Option<PathBuf>,
    pub hermes_bin: Option<PathBuf>,
    pub claude_bin: Option<PathBuf>,
    pub install_stamp: Option<InstallStamp>,
}

/// Parses Hermes's `install-stamp.json` payload.
pub fn parse_install_stamp(json_str: &str) -> Result<InstallStamp, BridgeError> {
    Ok(serde_json::from_str::<InstallStamp>(json_str)?)
}

/// Probes the local machine using default host locations (`LOCALAPPDATA\hermes`, `~/.hermes`, `$HERMES_HOME`, `PATH`).
pub fn probe_hermes_bridge() -> HermesBridgeStatus {
    probe_hermes_bridge_with(&DiscoveryOptions::default()).status
}

/// Probes Hermes Agent, `claude` CLI, and providers using the provided `DiscoveryOptions`.
pub fn probe_hermes_bridge_with(options: &DiscoveryOptions) -> HermesDiscoveryReport {
    let ollama_reachable = options
        .ollama_reachable_override
        .unwrap_or_else(|| check_tcp_reachable(&options.ollama_endpoint, Duration::from_millis(120)));
    probe_with_ollama_state(options, ollama_reachable)
}

/// Async version of `probe_hermes_bridge_with` using Tokio non-blocking I/O for Ollama probing.
pub async fn probe_hermes_bridge_async(
    options: &DiscoveryOptions,
) -> anyhow::Result<HermesDiscoveryReport> {
    let ollama_reachable = match options.ollama_reachable_override {
        Some(v) => v,
        None => check_tcp_reachable_async(&options.ollama_endpoint, Duration::from_millis(150)).await,
    };
    let opts = options.clone();
    let report = tokio::task::spawn_blocking(move || probe_with_ollama_state(&opts, ollama_reachable))
        .await?;
    Ok(report)
}

/// Builds the prioritized list of `ProviderProfile` entries.
///
/// Order is strictly:
/// 1. `ClaudeDirectSdk` (Claude subscription relay, zero incremental API cost)
/// 2. `GeminiNanoBanana` (Gemini + Nano Banana image generation)
/// 3. `LocalOllama` (local models on `:11434`, zero API cost)
/// 4. `CustomOpenAi` (DeepSeek / Qwen3-Coder / GLM / Kimi compatible endpoints)
pub fn prioritized_providers(
    claude_connected: bool,
    gemini_connected: bool,
    ollama_connected: bool,
    custom_openai_connected: bool,
) -> Vec<ProviderProfile> {
    vec![
        ProviderProfile {
            id: "claude-subscription-directsdk".to_string(),
            kind: ProviderKind::ClaudeDirectSdk,
            model: "claude-sonnet-4-6".to_string(),
            display_name: "Claude Subscription (DirectSDK)".to_string(),
            connected: claude_connected,
            zero_api_cost: true,
        },
        ProviderProfile {
            id: "gemini-nano-banana".to_string(),
            kind: ProviderKind::GeminiNanoBanana,
            model: "gemini-2.5-pro / nano-banana".to_string(),
            display_name: "Gemini + Nano Banana".to_string(),
            connected: gemini_connected,
            zero_api_cost: false,
        },
        ProviderProfile {
            id: "local-ollama".to_string(),
            kind: ProviderKind::LocalOllama,
            model: "qwen3-coder:30b".to_string(),
            display_name: "Local Ollama (:11434)".to_string(),
            connected: ollama_connected,
            zero_api_cost: true,
        },
        ProviderProfile {
            id: "custom-openai-compatible".to_string(),
            kind: ProviderKind::CustomOpenAi,
            model: "deepseek-chat / qwen3-coder / glm / kimi".to_string(),
            display_name: "DeepSeek / Qwen3-Coder / GLM / Kimi".to_string(),
            connected: custom_openai_connected,
            zero_api_cost: false,
        },
    ]
}

fn probe_with_ollama_state(
    options: &DiscoveryOptions,
    ollama_reachable: bool,
) -> HermesDiscoveryReport {
    let isolated = options.hermes_home_override.is_some()
        || options.hermes_agent_dir_override.is_some()
        || options.user_home_override.is_some()
        || options.local_appdata_override.is_some()
        || options.search_path_dirs.is_some()
        || options.env_overrides.is_some();

    let home_candidates = collect_hermes_home_candidates(options, isolated);
    let agent_candidates = collect_agent_dir_candidates(options, &home_candidates, isolated);

    let hermes_agent_dir = agent_candidates
        .into_iter()
        .find(|dir| is_valid_hermes_agent_dir(dir));

    let search_dirs = collect_search_dirs(options, &home_candidates, isolated);

    let hermes_bin = options
        .hermes_bin_override
        .as_ref()
        .filter(|p| p.is_file())
        .cloned()
        .or_else(|| find_binary(&search_dirs, "hermes"));

    let claude_bin = options
        .claude_bin_override
        .as_ref()
        .filter(|p| p.is_file())
        .cloned()
        .or_else(|| find_binary(&search_dirs, "claude"));

    let resolved_hermes_home = resolve_existing_hermes_home(&home_candidates, hermes_agent_dir.as_deref())
        .or_else(|| home_candidates.first().cloned());

    let install_stamp = find_install_stamp(
        hermes_agent_dir.as_deref(),
        resolved_hermes_home.as_deref(),
    );

    let hermes_found = hermes_agent_dir.is_some()
        || hermes_bin.is_some()
        || install_stamp.is_some()
        || resolved_hermes_home
            .as_deref()
            .is_some_and(has_hermes_home_markers);

    let hermes_version = if !hermes_found {
        String::new()
    } else {
        resolve_hermes_version(
            install_stamp.as_ref(),
            hermes_agent_dir.as_deref(),
        )
    };

    let gemini_connected = has_any_env(
        options,
        &["GEMINI_API_KEY", "GOOGLE_API_KEY", "NANO_BANANA_API_KEY"],
    );
    let custom_openai_connected = has_any_env(
        options,
        &[
            "DEEPSEEK_API_KEY",
            "DASHSCOPE_API_KEY",
            "QWEN_API_KEY",
            "GLM_API_KEY",
            "ZHIPU_API_KEY",
            "ZAI_API_KEY",
            "KIMI_API_KEY",
            "MOONSHOT_API_KEY",
            "OPENAI_COMPAT_BASE_URL",
        ],
    );

    let claude_cli_found = claude_bin.is_some();
    let providers = prioritized_providers(
        claude_cli_found,
        gemini_connected,
        ollama_reachable,
        custom_openai_connected,
    );

    let status = HermesBridgeStatus {
        hermes_found,
        hermes_version,
        hermes_home: resolved_hermes_home
            .map(|p| normalize_display_path(&p))
            .unwrap_or_default(),
        claude_cli_found,
        cache_stabilizer_enabled: options.cache_stabilizer_enabled,
        providers,
    };

    HermesDiscoveryReport {
        status,
        hermes_agent_dir,
        hermes_bin,
        claude_bin,
        install_stamp,
    }
}

fn get_env(options: &DiscoveryOptions, key: &str) -> Option<String> {
    if let Some(map) = &options.env_overrides {
        return map.get(key).cloned().filter(|v| !v.trim().is_empty());
    }
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn has_any_env(options: &DiscoveryOptions, keys: &[&str]) -> bool {
    keys.iter().any(|k| get_env(options, k).is_some())
}

fn resolve_user_home(options: &DiscoveryOptions, isolated: bool) -> Option<PathBuf> {
    if let Some(home) = &options.user_home_override {
        return Some(home.clone());
    }
    if isolated && options.env_overrides.is_some() {
        return get_env(options, "HOME")
            .or_else(|| get_env(options, "USERPROFILE"))
            .map(PathBuf::from);
    }
    get_env(options, "USERPROFILE")
        .or_else(|| get_env(options, "HOME"))
        .map(PathBuf::from)
}

fn collect_hermes_home_candidates(options: &DiscoveryOptions, isolated: bool) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(explicit) = &options.hermes_home_override {
        push_unique_path(&mut candidates, explicit.clone());
    }
    if let Some(env_home) = get_env(options, "HERMES_HOME") {
        push_unique_path(&mut candidates, PathBuf::from(env_home));
    }

    let local_appdata = options
        .local_appdata_override
        .clone()
        .or_else(|| get_env(options, "LOCALAPPDATA").map(PathBuf::from));
    if let Some(local) = local_appdata {
        push_unique_path(&mut candidates, local.join("hermes"));
    }

    if let Some(user_home) = resolve_user_home(options, isolated) {
        if cfg!(windows) {
            push_unique_path(&mut candidates, user_home.join("AppData").join("Local").join("hermes"));
        }
        push_unique_path(&mut candidates, user_home.join(".hermes"));
    }

    if !isolated && cfg!(windows) {
        push_unique_path(&mut candidates, PathBuf::from(r"C:\Users\x80\AppData\Local\hermes"));
    }

    candidates
}

fn collect_agent_dir_candidates(
    options: &DiscoveryOptions,
    home_candidates: &[PathBuf],
    isolated: bool,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(explicit) = &options.hermes_agent_dir_override {
        push_unique_path(&mut candidates, explicit.clone());
    }
    for home in home_candidates {
        push_unique_path(&mut candidates, home.join("hermes-agent"));
    }
    if !isolated && cfg!(windows) {
        push_unique_path(
            &mut candidates,
            PathBuf::from(r"C:\Users\x80\AppData\Local\hermes\hermes-agent"),
        );
    }
    candidates
}

fn collect_search_dirs(
    options: &DiscoveryOptions,
    home_candidates: &[PathBuf],
    isolated: bool,
) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for home in home_candidates {
        push_unique_path(&mut dirs, home.join("bin"));
    }

    if let Some(explicit_dirs) = &options.search_path_dirs {
        for dir in explicit_dirs {
            push_unique_path(&mut dirs, dir.clone());
        }
        return dirs;
    }

    if let Some(path_var) = get_env(options, "PATH") {
        for dir in std::env::split_paths(&path_var) {
            push_unique_path(&mut dirs, dir);
        }
    }

    if !isolated {
        if let Some(appdata) = get_env(options, "APPDATA") {
            push_unique_path(&mut dirs, PathBuf::from(appdata).join("npm"));
        }
        if let Some(user_home) = resolve_user_home(options, false) {
            push_unique_path(&mut dirs, user_home.join(".local").join("bin"));
            push_unique_path(&mut dirs, user_home.join(".cargo").join("bin"));
        }
    }

    dirs
}

fn push_unique_path(list: &mut Vec<PathBuf>, path: PathBuf) {
    if !list.iter().any(|existing| existing == &path) {
        list.push(path);
    }
}

fn is_valid_hermes_agent_dir(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    dir.join("install-stamp.json").is_file()
        || dir.join("hermes_constants.py").is_file()
        || dir.join("pyproject.toml").is_file()
        || dir.join("cli.py").is_file()
}

fn has_hermes_home_markers(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    dir.join("install-stamp.json").is_file()
        || dir.join("config.yaml").is_file()
        || dir.join("state.db").is_file()
        || dir.join("hermes-agent").is_dir()
        || dir.join("bin").join("hermes.exe").is_file()
        || dir.join("bin").join("hermes").is_file()
}

fn resolve_existing_hermes_home(
    home_candidates: &[PathBuf],
    hermes_agent_dir: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(home) = home_candidates.iter().find(|h| has_hermes_home_markers(h)) {
        return Some(home.clone());
    }
    if let Some(agent_dir) = hermes_agent_dir {
        if let Some(parent) = agent_dir.parent() {
            return Some(parent.to_path_buf());
        }
    }
    home_candidates.iter().find(|h| h.is_dir()).cloned()
}

fn find_binary(search_dirs: &[PathBuf], base_name: &str) -> Option<PathBuf> {
    let candidates: Vec<String> = if cfg!(windows) {
        vec![
            format!("{base_name}.exe"),
            format!("{base_name}.cmd"),
            format!("{base_name}.ps1"),
            format!("{base_name}.bat"),
            base_name.to_string(),
        ]
    } else {
        vec![base_name.to_string()]
    };

    let mut seen = HashSet::new();
    for dir in search_dirs {
        if !seen.insert(dir.clone()) || !dir.is_dir() {
            continue;
        }
        for name in &candidates {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn find_install_stamp(
    hermes_agent_dir: Option<&Path>,
    hermes_home: Option<&Path>,
) -> Option<InstallStamp> {
    let mut candidates = Vec::new();
    if let Some(agent_dir) = hermes_agent_dir {
        candidates.push(agent_dir.join("install-stamp.json"));
    }
    if let Some(home) = hermes_home {
        candidates.push(home.join("hermes-agent").join("install-stamp.json"));
        candidates.push(home.join("install-stamp.json"));
    }

    for path in candidates {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(stamp) = parse_install_stamp(&raw) {
                return Some(stamp);
            }
        }
    }
    None
}

fn resolve_hermes_version(
    install_stamp: Option<&InstallStamp>,
    hermes_agent_dir: Option<&Path>,
) -> String {
    if let Some(version) = install_stamp.and_then(InstallStamp::preferred_version) {
        return version;
    }

    if let Some(agent_dir) = hermes_agent_dir {
        let pyproject = agent_dir.join("pyproject.toml");
        if let Ok(content) = std::fs::read_to_string(&pyproject) {
            if let Some(ver) = extract_toml_version(&content) {
                if ver != "0.0.0" {
                    return ver;
                }
            }
        }
    }

    "detected".to_string()
}

fn extract_toml_version(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("version") {
            let rest = rest.trim_start();
            if let Some(val) = rest.strip_prefix('=') {
                let cleaned = val.trim().trim_matches('"').trim_matches('\'');
                if !cleaned.is_empty() {
                    return Some(cleaned.to_string());
                }
            }
        }
    }
    None
}

fn check_tcp_reachable(endpoint: &str, timeout: Duration) -> bool {
    let Ok(addr) = endpoint.parse::<SocketAddr>() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

async fn check_tcp_reachable_async(endpoint: &str, timeout: Duration) -> bool {
    let Ok(addr) = endpoint.parse::<SocketAddr>() else {
        return false;
    };
    tokio::time::timeout(timeout, tokio::net::TcpStream::connect(addr))
        .await
        .is_ok_and(|res| res.is_ok())
}

fn normalize_display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
