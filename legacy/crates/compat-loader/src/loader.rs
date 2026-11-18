use std::collections::HashSet;
use std::path::Path;
use std::sync::OnceLock;

use anyhow::{Context, Result};
use hypotaxis_contracts::{CompatAsset, CompatSource};
use ignore::WalkBuilder;
use regex::Regex;
use serde_json::Value;

use crate::frontmatter::{parse_frontmatter, parse_yaml_fields};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RootKind {
    Project,
    HermesHome,
    ClaudeHome,
    UserHome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AssetMatch {
    HermesSkill,
    HermesCatalogYaml,
    HermesPluginManifest,
    ClaudeSkill,
    ClaudeCommand,
    ClaudeAgent,
    ClaudeHooksJson,
    ClaudeMd,
    CursorRule,
    CodexAgentsMd,
    AntigravitySkill,
    AntigravityRule,
}

struct CompiledMatchers {
    hermes_dot_skill: Regex,
    hermes_dot_catalog: Regex,
    hermes_home_skill: Regex,
    hermes_home_plugin_yaml: Regex,
    claude_skill: Regex,
    claude_command: Regex,
    claude_agent: Regex,
    claude_hooks: Regex,
    claude_md: Regex,
    claude_home_skill: Regex,
    claude_home_command: Regex,
    claude_home_agent: Regex,
    claude_home_hooks: Regex,
    cursor_rule: Regex,
    codex_agents_md: Regex,
    antigravity_skill: Regex,
    antigravity_rule: Regex,
}

fn matchers() -> &'static CompiledMatchers {
    static MATCHERS: OnceLock<CompiledMatchers> = OnceLock::new();
    MATCHERS.get_or_init(|| CompiledMatchers {
        hermes_dot_skill: Regex::new(r"(?i)^(?:.+/)?\.hermes/skills/.+/skill\.md$").unwrap(),
        hermes_dot_catalog: Regex::new(r"(?i)^(?:.+/)?(?:\.hermes/)?plugin-catalog/.+\.ya?ml$").unwrap(),
        hermes_home_skill: Regex::new(r"(?i)^(?:skills|plugins)/.+/(?:skill\.md)$").unwrap(),
        hermes_home_plugin_yaml: Regex::new(r"(?i)^plugins/[^/]+/plugin\.ya?ml$").unwrap(),
        claude_skill: Regex::new(r"(?i)^(?:.+/)?\.claude/skills/.+/skill\.md$").unwrap(),
        claude_command: Regex::new(r"(?i)^(?:.+/)?\.claude/commands/.+\.md$").unwrap(),
        claude_agent: Regex::new(r"(?i)^(?:.+/)?\.claude/agents/.+\.md$").unwrap(),
        claude_hooks: Regex::new(r"(?i)^(?:.+/)?\.claude/hooks\.json$").unwrap(),
        claude_md: Regex::new(r"(?i)^(?:.+/)?(?:\.claude/)?claude\.md$").unwrap(),
        claude_home_skill: Regex::new(r"(?i)^skills/.+/skill\.md$").unwrap(),
        claude_home_command: Regex::new(r"(?i)^commands/.+\.md$").unwrap(),
        claude_home_agent: Regex::new(r"(?i)^agents/.+\.md$").unwrap(),
        claude_home_hooks: Regex::new(r"(?i)^hooks\.json$").unwrap(),
        cursor_rule: Regex::new(r"(?i)^(?:.+/)?\.cursor/rules/.+\.mdc$").unwrap(),
        codex_agents_md: Regex::new(r"(?i)^(?:.+/)?agents\.md$").unwrap(),
        antigravity_skill: Regex::new(r"(?i)^(?:.+/)?\.agents/skills/.+/skill\.md$").unwrap(),
        antigravity_rule: Regex::new(r"(?i)^(?:.+/)?\.agents/rules/.+\.md$").unwrap(),
    })
}

/// Discovers and normalizes all cross-harness skills, plugins, commands, rules, and hooks
/// in `project_root` and an optional `user_config_root`.
pub fn discover_compat_assets(
    project_root: &Path,
    user_config_root: Option<&Path>,
) -> Result<Vec<CompatAsset>> {
    let mut assets = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut seen_paths = HashSet::new();

    if project_root.exists() {
        scan_root(
            project_root,
            RootKind::Project,
            &mut assets,
            &mut seen_ids,
            &mut seen_paths,
        )?;
    }

    if let Some(user_root) = user_config_root {
        if user_root.exists() {
            let kind = infer_user_root_kind(user_root);
            scan_root(
                user_root,
                kind,
                &mut assets,
                &mut seen_ids,
                &mut seen_paths,
            )?;
        }
    }

    assets.sort_by(|a, b| {
        source_rank(a.source)
            .cmp(&source_rank(b.source))
            .then_with(|| a.path.cmp(&b.path))
            .then_with(|| a.id.cmp(&b.id))
    });

    Ok(assets)
}

/// Convenience wrapper scanning only a target project root.
pub fn load_project_assets(project_root: &Path) -> Result<Vec<CompatAsset>> {
    discover_compat_assets(project_root, None)
}

fn infer_user_root_kind(root: &Path) -> RootKind {
    let dir_name = root
        .file_name()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    if dir_name == ".hermes"
        || dir_name == "hermes"
        || root.join("hermes-agent").is_dir()
        || root.join("install-stamp.json").is_file()
    {
        RootKind::HermesHome
    } else if dir_name == ".claude" {
        RootKind::ClaudeHome
    } else {
        RootKind::UserHome
    }
}

fn scan_root(
    root: &Path,
    root_kind: RootKind,
    out: &mut Vec<CompatAsset>,
    seen_ids: &mut HashSet<String>,
    seen_paths: &mut HashSet<String>,
) -> Result<()> {
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .require_git(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .parents(false)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !matches!(
                name.as_ref(),
                ".git"
                    | "node_modules"
                    | "target"
                    | "__pycache__"
                    | ".venv"
                    | "installs"
                    | "audio_cache"
                    | "image_cache"
            )
        })
        .build();

    for result in walker {
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }

        let abs_path = entry.path();
        let Ok(rel_path) = abs_path.strip_prefix(root) else {
            continue;
        };
        let rel_slash = normalize_path(rel_path);
        let Some(matched) = classify_rel_path(&rel_slash, root_kind) else {
            continue;
        };

        let full_slash = normalize_path(abs_path);
        if !seen_paths.insert(full_slash.clone()) {
            continue;
        }

        let parsed_assets = load_matched_assets(
            abs_path,
            &full_slash,
            &rel_slash,
            root_kind != RootKind::Project,
            matched,
        )
        .with_context(|| format!("failed loading compatibility asset {}", abs_path.display()))?;

        for asset in parsed_assets {
            if seen_ids.insert(asset.id.clone()) {
                out.push(asset);
            }
        }
    }

    Ok(())
}

fn classify_rel_path(rel_slash: &str, root_kind: RootKind) -> Option<AssetMatch> {
    let m = matchers();

    if m.hermes_dot_skill.is_match(rel_slash) {
        return Some(AssetMatch::HermesSkill);
    }
    if m.hermes_dot_catalog.is_match(rel_slash) {
        return Some(AssetMatch::HermesCatalogYaml);
    }
    if root_kind == RootKind::HermesHome {
        if m.hermes_home_skill.is_match(rel_slash) {
            return Some(AssetMatch::HermesSkill);
        }
        if m.hermes_home_plugin_yaml.is_match(rel_slash) {
            return Some(AssetMatch::HermesPluginManifest);
        }
    }

    if m.claude_skill.is_match(rel_slash) {
        return Some(AssetMatch::ClaudeSkill);
    }
    if m.claude_command.is_match(rel_slash) {
        return Some(AssetMatch::ClaudeCommand);
    }
    if m.claude_agent.is_match(rel_slash) {
        return Some(AssetMatch::ClaudeAgent);
    }
    if m.claude_hooks.is_match(rel_slash) {
        return Some(AssetMatch::ClaudeHooksJson);
    }
    if m.claude_md.is_match(rel_slash) {
        return Some(AssetMatch::ClaudeMd);
    }

    if root_kind == RootKind::ClaudeHome {
        if m.claude_home_skill.is_match(rel_slash) {
            return Some(AssetMatch::ClaudeSkill);
        }
        if m.claude_home_command.is_match(rel_slash) {
            return Some(AssetMatch::ClaudeCommand);
        }
        if m.claude_home_agent.is_match(rel_slash) {
            return Some(AssetMatch::ClaudeAgent);
        }
        if m.claude_home_hooks.is_match(rel_slash) {
            return Some(AssetMatch::ClaudeHooksJson);
        }
    }

    if m.cursor_rule.is_match(rel_slash) {
        return Some(AssetMatch::CursorRule);
    }
    if m.codex_agents_md.is_match(rel_slash) {
        return Some(AssetMatch::CodexAgentsMd);
    }
    if m.antigravity_skill.is_match(rel_slash) {
        return Some(AssetMatch::AntigravitySkill);
    }
    if m.antigravity_rule.is_match(rel_slash) {
        return Some(AssetMatch::AntigravityRule);
    }

    None
}

fn load_matched_assets(
    abs_path: &Path,
    full_slash: &str,
    rel_slash: &str,
    is_user_scope: bool,
    matched: AssetMatch,
) -> Result<Vec<CompatAsset>> {
    let raw = std::fs::read_to_string(abs_path)
        .with_context(|| format!("unable to read {}", abs_path.display()))?;

    if matched == AssetMatch::ClaudeHooksJson {
        return Ok(parse_claude_hooks_json(
            &raw,
            full_slash,
            rel_slash,
            is_user_scope,
        ));
    }

    if matches!(
        matched,
        AssetMatch::HermesCatalogYaml | AssetMatch::HermesPluginManifest
    ) {
        let fm = parse_yaml_fields(&raw);
        let fallback_name = match matched {
            AssetMatch::HermesPluginManifest => parent_dir_name(abs_path)
                .unwrap_or_else(|| file_stem_or_name(abs_path)),
            _ => file_stem_or_name(abs_path),
        };
        let name = fm.name.unwrap_or(fallback_name);
        let description = fm
            .description
            .unwrap_or_else(|| format!("Hermes plugin manifest: {name}"));
        return Ok(vec![CompatAsset {
            id: make_asset_id(
                CompatSource::HermesPlugin,
                rel_slash,
                is_user_scope,
                None,
            ),
            name,
            source: CompatSource::HermesPlugin,
            path: full_slash.to_string(),
            description,
            scope_globs: fm.globs,
            trigger: fm.trigger.or_else(|| Some("plugin".to_string())),
        }]);
    }

    let fm = parse_frontmatter(&raw);
    let source = match matched {
        AssetMatch::HermesSkill => CompatSource::HermesPlugin,
        AssetMatch::ClaudeSkill | AssetMatch::ClaudeAgent | AssetMatch::ClaudeMd => {
            CompatSource::ClaudeSkill
        }
        AssetMatch::ClaudeCommand => CompatSource::ClaudeCommand,
        AssetMatch::CursorRule => CompatSource::CursorRule,
        AssetMatch::CodexAgentsMd => CompatSource::CodexAgentsMd,
        AssetMatch::AntigravitySkill | AssetMatch::AntigravityRule => {
            CompatSource::AntigravitySkill
        }
        AssetMatch::HermesCatalogYaml
        | AssetMatch::HermesPluginManifest
        | AssetMatch::ClaudeHooksJson => unreachable!(),
    };

    let fallback_name = match matched {
        AssetMatch::HermesSkill | AssetMatch::ClaudeSkill | AssetMatch::AntigravitySkill => {
            parent_dir_name(abs_path).unwrap_or_else(|| file_stem_or_name(abs_path))
        }
        AssetMatch::ClaudeMd => "CLAUDE.md".to_string(),
        AssetMatch::CodexAgentsMd => "AGENTS.md".to_string(),
        _ => file_stem_or_name(abs_path),
    };

    let name = fm.name.unwrap_or(fallback_name);
    let description = fm
        .description
        .or_else(|| first_markdown_summary(&fm.body))
        .unwrap_or_else(|| name.clone());

    let trigger = fm.trigger.or_else(|| match matched {
        AssetMatch::HermesSkill => Some("skill".to_string()),
        AssetMatch::ClaudeSkill => Some("skill".to_string()),
        AssetMatch::ClaudeCommand => Some(format!("/{name}")),
        AssetMatch::ClaudeAgent => Some("subagent".to_string()),
        AssetMatch::ClaudeMd => Some("project_instructions".to_string()),
        AssetMatch::CursorRule => {
            if fm.always_apply == Some(true) {
                Some("always_apply".to_string())
            } else if !fm.globs.is_empty() {
                Some("glob".to_string())
            } else {
                Some("manual".to_string())
            }
        }
        AssetMatch::CodexAgentsMd => Some("always_on".to_string()),
        AssetMatch::AntigravitySkill => Some("skill".to_string()),
        AssetMatch::AntigravityRule => Some("rule".to_string()),
        AssetMatch::HermesCatalogYaml
        | AssetMatch::HermesPluginManifest
        | AssetMatch::ClaudeHooksJson => None,
    });

    Ok(vec![CompatAsset {
        id: make_asset_id(source, rel_slash, is_user_scope, None),
        name,
        source,
        path: full_slash.to_string(),
        description,
        scope_globs: fm.globs,
        trigger,
    }])
}

fn parse_claude_hooks_json(
    raw: &str,
    full_slash: &str,
    rel_slash: &str,
    is_user_scope: bool,
) -> Vec<CompatAsset> {
    let parsed: Result<Value, _> = serde_json::from_str(raw);
    let Ok(val) = parsed else {
        return vec![CompatAsset {
            id: make_asset_id(CompatSource::ClaudeHook, rel_slash, is_user_scope, None),
            name: "claude-hooks".to_string(),
            source: CompatSource::ClaudeHook,
            path: full_slash.to_string(),
            description: "Claude Code hooks configuration (unparsed JSON)".to_string(),
            scope_globs: Vec::new(),
            trigger: Some("hooks".to_string()),
        }];
    };

    let hooks_obj = val
        .get("hooks")
        .and_then(Value::as_object)
        .or_else(|| val.as_object());

    let Some(map) = hooks_obj else {
        return vec![CompatAsset {
            id: make_asset_id(CompatSource::ClaudeHook, rel_slash, is_user_scope, None),
            name: "claude-hooks".to_string(),
            source: CompatSource::ClaudeHook,
            path: full_slash.to_string(),
            description: "Claude Code hooks configuration".to_string(),
            scope_globs: Vec::new(),
            trigger: Some("hooks".to_string()),
        }];
    };

    let mut out = Vec::new();
    for (event_name, entries) in map {
        if event_name == "$schema" || event_name == "description" {
            continue;
        }
        let mut matchers_found = Vec::new();
        let mut commands_found = Vec::new();

        if let Some(arr) = entries.as_array() {
            for item in arr {
                if let Some(m) = item.get("matcher").and_then(Value::as_str) {
                    if !m.trim().is_empty() {
                        matchers_found.push(m.trim().to_string());
                    }
                }
                if let Some(cmd) = item.get("command").and_then(Value::as_str) {
                    commands_found.push(cmd.trim().to_string());
                }
                if let Some(nested) = item.get("hooks").and_then(Value::as_array) {
                    for h in nested {
                        if let Some(cmd) = h.get("command").and_then(Value::as_str) {
                            commands_found.push(cmd.trim().to_string());
                        }
                    }
                }
            }
        }

        let description = if commands_found.is_empty() {
            format!("Claude Code {event_name} hook")
        } else {
            format!("Claude Code {event_name} hook: {}", commands_found.join("; "))
        };

        out.push(CompatAsset {
            id: make_asset_id(
                CompatSource::ClaudeHook,
                rel_slash,
                is_user_scope,
                Some(event_name),
            ),
            name: format!("hook:{event_name}"),
            source: CompatSource::ClaudeHook,
            path: full_slash.to_string(),
            description,
            scope_globs: matchers_found,
            trigger: Some(event_name.clone()),
        });
    }

    if out.is_empty() {
        out.push(CompatAsset {
            id: make_asset_id(CompatSource::ClaudeHook, rel_slash, is_user_scope, None),
            name: "claude-hooks".to_string(),
            source: CompatSource::ClaudeHook,
            path: full_slash.to_string(),
            description: "Claude Code hooks configuration".to_string(),
            scope_globs: Vec::new(),
            trigger: Some("hooks".to_string()),
        });
    }

    out
}

fn first_markdown_summary(body: &str) -> Option<String> {
    for raw_line in body.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed.starts_with("---")
            || trimmed.starts_with("```")
            || trimmed.starts_with("<!--")
        {
            continue;
        }
        let cleaned = trimmed
            .trim_start_matches(['>', '-', '*', ' '])
            .trim();
        if cleaned.is_empty() {
            continue;
        }
        let truncated: String = cleaned.chars().take(200).collect();
        return Some(truncated);
    }
    None
}

fn parent_dir_name(path: &Path) -> Option<String> {
    path.parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
}

fn file_stem_or_name(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "asset".to_string())
}

fn make_asset_id(
    source: CompatSource,
    rel_slash: &str,
    is_user_scope: bool,
    suffix: Option<&str>,
) -> String {
    let prefix = match source {
        CompatSource::HermesPlugin => "hermes_plugin",
        CompatSource::ClaudeSkill => "claude_skill",
        CompatSource::ClaudeCommand => "claude_command",
        CompatSource::ClaudeHook => "claude_hook",
        CompatSource::CursorRule => "cursor_rule",
        CompatSource::CodexAgentsMd => "codex_agents_md",
        CompatSource::AntigravitySkill => "antigravity_skill",
    };
    let scope = if is_user_scope { "user:" } else { "" };
    match suffix {
        Some(s) => format!("{scope}{prefix}:{rel_slash}#{s}"),
        None => format!("{scope}{prefix}:{rel_slash}"),
    }
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn source_rank(source: CompatSource) -> u8 {
    match source {
        CompatSource::HermesPlugin => 0,
        CompatSource::ClaudeSkill => 1,
        CompatSource::ClaudeCommand => 2,
        CompatSource::ClaudeHook => 3,
        CompatSource::CursorRule => 4,
        CompatSource::CodexAgentsMd => 5,
        CompatSource::AntigravitySkill => 6,
    }
}
