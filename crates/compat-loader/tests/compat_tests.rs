use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use compat_loader::{
    discover_compat_assets, load_project_assets, parse_frontmatter, CompatSource,
};

static TEST_DIR_SEQ: AtomicU64 = AtomicU64::new(1);

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(label: &str) -> Self {
        let id = TEST_DIR_SEQ.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("hypo-compat-{label}-{}-{id}", std::process::id()));
        fs::create_dir_all(&path).expect("create temp test dir");
        Self { path }
    }

    fn write_rel(&self, rel: &str, content: &str) {
        let full = self.path.join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).expect("create parent dirs");
        }
        fs::write(full, content).expect("write fixture file");
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn parse_frontmatter_handles_cursor_globs_yaml_lists_and_folded_descriptions() {
    let mdc = concat!(
        "\u{feff}---\r\n",
        "description: \"Enforce Rust ownership and zero-warning rules\"\r\n",
        "globs: \"crates/**/*.rs, src/**/*.{ts,tsx}\"\r\n",
        "alwaysApply: false\r\n",
        "---\r\n",
        "# Rust Rules\r\n",
        "Never leave unused imports.\r\n",
    );

    let fm = parse_frontmatter(mdc);
    assert_eq!(
        fm.description.as_deref(),
        Some("Enforce Rust ownership and zero-warning rules")
    );
    assert_eq!(
        fm.globs,
        vec![
            "crates/**/*.rs".to_string(),
            "src/**/*.{ts,tsx}".to_string()
        ]
    );
    assert_eq!(fm.always_apply, Some(false));
    assert!(fm.body.contains("# Rust Rules"));

    let multiline = concat!(
        "---\n",
        "name: deploy-check\n",
        "description: >-\n",
        "  Verify release manifest\n",
        "  before shipping.\n",
        "globs:\n",
        "  - \"src-tauri/**/*.rs\"\n",
        "  - \"ui/src/**/*.tsx\"\n",
        "trigger: pre_ship\n",
        "metadata:\n",
        "  hermes:\n",
        "    name: nested-must-not-override\n",
        "---\n",
        "Body text",
    );

    let fm2 = parse_frontmatter(multiline);
    assert_eq!(fm2.name.as_deref(), Some("deploy-check"));
    assert_eq!(
        fm2.description.as_deref(),
        Some("Verify release manifest before shipping.")
    );
    assert_eq!(
        fm2.globs,
        vec![
            "src-tauri/**/*.rs".to_string(),
            "ui/src/**/*.tsx".to_string()
        ]
    );
    assert_eq!(fm2.trigger.as_deref(), Some("pre_ship"));

    let inline_arr = "---\nname: inline\nglobs: [\"*.rs\", \"*.toml\"]\n---\nBody";
    let fm3 = parse_frontmatter(inline_arr);
    assert_eq!(
        fm3.globs,
        vec!["*.rs".to_string(), "*.toml".to_string()]
    );
}

#[test]
fn discover_compat_assets_across_all_ecosystems_in_temp_fixture() {
    let project = TempDir::new("project");
    let user_home = TempDir::new("hermes-user");

    // 1. Hermes skills & plugin-catalog
    project.write_rel(
        ".hermes/skills/deploy-app/SKILL.md",
        "---\nname: deploy-app\ndescription: Deploy application safely\n---\n# Deploy\n",
    );
    project.write_rel(
        "plugin-catalog/claude-subscription-directsdk.yaml",
        "name: claude-subscription-directsdk\ndescription: >-\n  Run Hermes turns via Claude Pro/Max CLI\n  with zero API markup.\ncategory: models\n",
    );

    // 2. Claude Code skills, commands, agents, hooks.json, CLAUDE.md
    project.write_rel(
        ".claude/skills/rust-check/SKILL.md",
        "---\nname: rust-check\ndescription: Validate Rust workspace builds\ntrigger: manual\n---\nRun cargo test.\n",
    );
    project.write_rel(
        ".claude/commands/ship-pr.md",
        "---\ndescription: Run gate checks and open PR\n---\nCheck diff first.\n",
    );
    project.write_rel(
        ".claude/agents/reviewer.md",
        "---\nname: reviewer\ndescription: Read-only code reviewer\n---\nInspect diff.\n",
    );
    project.write_rel(
        ".claude/hooks.json",
        r#"{
            "hooks": {
                "PreToolUse": [
                    { "matcher": "Bash|Edit", "hooks": [{ "type": "command", "command": "gate-pre.sh" }] }
                ],
                "PostToolUse": [
                    { "matcher": "Write", "command": "cargo fmt --check" }
                ]
            }
        }"#,
    );
    project.write_rel(
        "CLAUDE.md",
        "# Project Instructions\nAlways run cargo test before committing.\n",
    );

    // 3. Cursor rules (.cursor/rules/*.mdc)
    project.write_rel(
        ".cursor/rules/rust-rules.mdc",
        "---\ndescription: Keep Rust crates modular\nglobs: crates/**/*.rs, src-tauri/*.rs\n---\nKeep functions small.\n",
    );

    // 4. Codex AGENTS.md
    project.write_rel(
        "AGENTS.md",
        "# Repository Guidelines\nFollow strict contract lane ownership.\n",
    );

    // 5. Antigravity skills & rules
    project.write_rel(
        ".agents/skills/orb-physics/SKILL.md",
        "---\nname: orb-physics\ndescription: Soft-body orb canvas physics\n---\nUse 96 points.\n",
    );
    project.write_rel(
        ".agents/rules/monochrome.md",
        "---\ntrigger: always_on\ndescription: Pure neutral R=G=B grays only\n---\nZero blue-tinted grays.\n",
    );

    // 6. Gitignore verification (must skip ignored_dir/AGENTS.md while walking dotdirs)
    project.write_rel(".gitignore", "ignored_dir/\n");
    project.write_rel("ignored_dir/AGENTS.md", "# Should be ignored\n");

    // 7. User config root (Hermes home style)
    user_home.write_rel(
        "install-stamp.json",
        r#"{ "displayVersion": "0.23.2" }"#,
    );
    user_home.write_rel(
        "skills/apple-notes/SKILL.md",
        "---\nname: apple-notes\ndescription: Manage Apple Notes\n---\n",
    );

    let project_only = load_project_assets(&project.path).unwrap();
    assert!(!project_only.iter().any(|a| a.path.contains("ignored_dir")));

    let all = discover_compat_assets(&project.path, Some(&user_home.path)).unwrap();

    // Verify all 7 CompatSource variants are present
    assert!(all.iter().any(|a| a.source == CompatSource::HermesPlugin && a.name == "deploy-app"));
    assert!(all.iter().any(|a| {
        a.source == CompatSource::HermesPlugin && a.name == "claude-subscription-directsdk"
    }));
    assert!(all.iter().any(|a| a.source == CompatSource::HermesPlugin && a.name == "apple-notes"));

    assert!(all.iter().any(|a| a.source == CompatSource::ClaudeSkill && a.name == "rust-check"));
    assert!(all.iter().any(|a| {
        a.source == CompatSource::ClaudeSkill
            && a.name == "reviewer"
            && a.trigger.as_deref() == Some("subagent")
    }));
    assert!(all.iter().any(|a| a.source == CompatSource::ClaudeSkill && a.name == "CLAUDE.md"));
    assert!(all.iter().any(|a| {
        a.source == CompatSource::ClaudeCommand
            && a.name == "ship-pr"
            && a.trigger.as_deref() == Some("/ship-pr")
    }));

    let pre_hook = all
        .iter()
        .find(|a| {
            a.source == CompatSource::ClaudeHook && a.trigger.as_deref() == Some("PreToolUse")
        })
        .expect("PreToolUse hook discovered");
    assert_eq!(pre_hook.scope_globs, vec!["Bash|Edit".to_string()]);

    let cursor = all
        .iter()
        .find(|a| a.source == CompatSource::CursorRule && a.name == "rust-rules")
        .expect("Cursor .mdc rule discovered");
    assert_eq!(cursor.description, "Keep Rust crates modular");
    assert_eq!(
        cursor.scope_globs,
        vec!["crates/**/*.rs".to_string(), "src-tauri/*.rs".to_string()]
    );
    assert_eq!(cursor.trigger.as_deref(), Some("glob"));

    let agents_md = all
        .iter()
        .find(|a| a.source == CompatSource::CodexAgentsMd)
        .expect("AGENTS.md discovered");
    assert_eq!(agents_md.name, "AGENTS.md");

    assert!(all.iter().any(|a| {
        a.source == CompatSource::AntigravitySkill && a.name == "orb-physics"
    }));
    assert!(all.iter().any(|a| {
        a.source == CompatSource::AntigravitySkill
            && a.name == "monochrome"
            && a.trigger.as_deref() == Some("always_on")
    }));
}

#[test]
fn parse_frontmatter_handles_missing_and_unclosed_blocks_safely() {
    let plain = "# Plain Markdown\nJust instructions.";
    let fm = parse_frontmatter(plain);
    assert_eq!(fm.name, None);
    assert!(fm.globs.is_empty());
    assert_eq!(fm.body, plain);

    let unclosed = "---\nname: incomplete\nNo closing fence";
    let fm_unclosed = parse_frontmatter(unclosed);
    assert_eq!(fm_unclosed.name, None);
    assert_eq!(fm_unclosed.body, unclosed);
}
