use std::path::PathBuf;
use std::process::Command;

use anyhow::Result;
use globset::{Glob, GlobSet, GlobSetBuilder};
use hypotaxis_contracts::TaskBrief;
use serde::{Deserialize, Serialize};

use crate::{new_correlation_id, normalize_against_root, normalize_rel_path};

const PROTECTED_PATTERNS: &[&str] = &[
    "*test*",
    "**/*test*",
    "*spec*",
    "**/*spec*",
    ".git",
    ".git/**",
    "**/.git",
    "**/.git/**",
    ".env*",
    "**/.env*",
    ".githooks",
    ".githooks/**",
    "**/.githooks",
    "**/.githooks/**",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GateFailureKind {
    EmptyScopeGlobs,
    ProtectedFileViolation,
    OutOfScope,
    CommandFailed,
    CommandSpawnError,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GateReport {
    pub correlation_id: String,
    pub passed: bool,
    pub pure_scope_violation: bool,
    pub failure_kind: Option<GateFailureKind>,
    pub violations: Vec<String>,
    pub command_ran: Option<String>,
    pub exit_code: Option<i32>,
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GateConfig {
    pub workspace_root: PathBuf,
    /// Explicit pinned command (used for deterministic test/runner config).
    /// Never derived from `TaskBrief` text.
    pub pinned_command: Option<String>,
    /// Whether to consult `std::env::var("HARNESS_GATE_CMD")` when `pinned_command` is `None`.
    pub read_env_cmd: bool,
}

/// Contraprova Kernel Gate verifying:
/// 1. Non-empty `brief.scope_globs`
/// 2. No test or protected files edited (`*test*`, `*spec*`, `.git/**`, `.env*`, `.githooks/**`)
/// 3. Every changed file matches `brief.scope_globs` via `globset`
/// 4. Optional env-pinned command (`HARNESS_GATE_CMD` or explicit config, never from brief text)
#[derive(Debug, Clone)]
pub struct KernelGate {
    config: GateConfig,
}

impl KernelGate {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            config: GateConfig {
                workspace_root: workspace_root.into(),
                pinned_command: None,
                read_env_cmd: true,
            },
        }
    }

    /// Construct a `KernelGate` with an explicit command override (bypassing process env).
    pub fn with_command(workspace_root: impl Into<PathBuf>, command: Option<String>) -> Self {
        Self {
            config: GateConfig {
                workspace_root: workspace_root.into(),
                pinned_command: command,
                read_env_cmd: false,
            },
        }
    }

    pub fn config(&self) -> &GateConfig {
        &self.config
    }

    /// Resolve the pinned verification command strictly from config or `HARNESS_GATE_CMD`,
    /// never from `TaskBrief` fields.
    pub fn resolve_command(&self) -> Option<String> {
        if let Some(cmd) = &self.config.pinned_command {
            let trimmed = cmd.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
            return None;
        }
        if self.config.read_env_cmd {
            if let Ok(env_cmd) = std::env::var("HARNESS_GATE_CMD") {
                let trimmed = env_cmd.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
        None
    }

    /// Validate `changed_files` against `brief` in exact Contraprova order (1 -> 2 -> 3 -> 4).
    pub fn evaluate<S: AsRef<str>>(
        &self,
        brief: &TaskBrief,
        changed_files: &[S],
    ) -> Result<GateReport> {
        let correlation_id = new_correlation_id();

        // Step 1: non-empty `brief.scope_globs`.
        let mut scope_builder = GlobSetBuilder::new();
        let mut valid_glob_count = 0usize;
        for raw_glob in &brief.scope_globs {
            let mut pat = normalize_rel_path(raw_glob);
            if pat.is_empty() {
                continue;
            }
            if raw_glob.trim().ends_with('/') {
                pat.push_str("/**");
            }
            match Glob::new(&pat) {
                Ok(glob) => {
                    scope_builder.add(glob);
                    valid_glob_count += 1;
                }
                Err(err) => {
                    return Ok(GateReport {
                        correlation_id,
                        passed: false,
                        pure_scope_violation: true,
                        failure_kind: Some(GateFailureKind::EmptyScopeGlobs),
                        violations: vec![format!("invalid scope glob '{raw_glob}': {err}")],
                        command_ran: None,
                        exit_code: None,
                        output: format!("gate blocked at step 1 (invalid scope glob '{raw_glob}')"),
                    });
                }
            }
        }

        if valid_glob_count == 0 {
            return Ok(GateReport {
                correlation_id,
                passed: false,
                pure_scope_violation: true,
                failure_kind: Some(GateFailureKind::EmptyScopeGlobs),
                violations: vec!["brief.scope_globs must be non-empty".to_string()],
                command_ran: None,
                exit_code: None,
                output: "gate blocked at step 1: brief.scope_globs is empty".to_string(),
            });
        }

        let scope_set = scope_builder.build()?;
        let protected_set = build_protected_globset()?;

        let normalized_files: Vec<String> = changed_files
            .iter()
            .map(|f| normalize_against_root(&self.config.workspace_root, f.as_ref()))
            .filter(|f| !f.is_empty())
            .collect();

        // Step 2: no test/protected files edited (`*test*`, `*spec*`, `.git/**`, `.env*`, `.githooks/**`).
        let mut protected_violations = Vec::new();
        for path in &normalized_files {
            if is_protected_path_with_set(path, &protected_set) {
                protected_violations.push(path.clone());
            }
        }
        if !protected_violations.is_empty() {
            return Ok(GateReport {
                correlation_id,
                passed: false,
                pure_scope_violation: true,
                failure_kind: Some(GateFailureKind::ProtectedFileViolation),
                violations: protected_violations.clone(),
                command_ran: None,
                exit_code: None,
                output: format!(
                    "gate blocked at step 2 (protected/test files): {}",
                    protected_violations.join(", ")
                ),
            });
        }

        // Step 3: every changed file matches `brief.scope_globs` via `globset`.
        let mut scope_violations = Vec::new();
        for path in &normalized_files {
            if !scope_set.is_match(path) {
                scope_violations.push(path.clone());
            }
        }
        if !scope_violations.is_empty() {
            return Ok(GateReport {
                correlation_id,
                passed: false,
                pure_scope_violation: true,
                failure_kind: Some(GateFailureKind::OutOfScope),
                violations: scope_violations.clone(),
                command_ran: None,
                exit_code: None,
                output: format!(
                    "gate blocked at step 3 (out of scope): {}",
                    scope_violations.join(", ")
                ),
            });
        }

        // Step 4: optional env-pinned command (HARNESS_GATE_CMD or explicit config, never brief text).
        let Some(cmd) = self.resolve_command() else {
            return Ok(GateReport {
                correlation_id,
                passed: true,
                pure_scope_violation: false,
                failure_kind: None,
                violations: Vec::new(),
                command_ran: None,
                exit_code: None,
                output: "gate checks (1-3) passed; no gate command configured".to_string(),
            });
        };

        let output = run_pinned_command(&self.config.workspace_root, &cmd);
        match output {
            Ok(out) => {
                let code = out.status.code().unwrap_or(-1);
                let stdout = String::from_utf8_lossy(&out.stdout);
                let stderr = String::from_utf8_lossy(&out.stderr);
                let combined = format_command_output(&cmd, code, &stdout, &stderr);
                if out.status.success() {
                    Ok(GateReport {
                        correlation_id,
                        passed: true,
                        pure_scope_violation: false,
                        failure_kind: None,
                        violations: Vec::new(),
                        command_ran: Some(cmd),
                        exit_code: Some(code),
                        output: combined,
                    })
                } else {
                    Ok(GateReport {
                        correlation_id,
                        passed: false,
                        pure_scope_violation: false,
                        failure_kind: Some(GateFailureKind::CommandFailed),
                        violations: vec![format!("gate command exited with status {code}")],
                        command_ran: Some(cmd),
                        exit_code: Some(code),
                        output: combined,
                    })
                }
            }
            Err(err) => Ok(GateReport {
                correlation_id,
                passed: false,
                pure_scope_violation: false,
                failure_kind: Some(GateFailureKind::CommandSpawnError),
                violations: vec![format!("failed to execute gate command: {err}")],
                command_ran: Some(cmd),
                exit_code: None,
                output: format!("gate command spawn error: {err}"),
            }),
        }
    }
}

/// Check whether a normalized relative path hits Contraprova's protected/test fence.
pub fn is_protected_path(raw_path: &str) -> bool {
    let norm = normalize_rel_path(raw_path);
    if let Ok(set) = build_protected_globset() {
        is_protected_path_with_set(&norm, &set)
    } else {
        false
    }
}

fn build_protected_globset() -> Result<GlobSet, globset::Error> {
    let mut builder = GlobSetBuilder::new();
    for pat in PROTECTED_PATTERNS {
        builder.add(Glob::new(pat)?);
    }
    builder.build()
}

fn is_protected_path_with_set(norm_path: &str, protected_set: &GlobSet) -> bool {
    if protected_set.is_match(norm_path) {
        return true;
    }
    let lower = norm_path.to_ascii_lowercase();
    for seg in lower.split('/') {
        if seg == ".git" || seg == ".githooks" || seg.starts_with(".env") {
            return true;
        }
    }
    false
}

fn run_pinned_command(root: &PathBuf, cmd: &str) -> std::io::Result<std::process::Output> {
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", cmd])
            .current_dir(root)
            .output()
    }
    #[cfg(not(windows))]
    {
        Command::new("sh")
            .args(["-c", cmd])
            .current_dir(root)
            .output()
    }
}

fn format_command_output(cmd: &str, exit_code: i32, stdout: &str, stderr: &str) -> String {
    let mut out = format!("$ {cmd} (exit {exit_code})");
    if !stdout.trim().is_empty() {
        out.push_str("\nstdout:\n");
        out.push_str(stdout.trim_end());
    }
    if !stderr.trim().is_empty() {
        out.push_str("\nstderr:\n");
        out.push_str(stderr.trim_end());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn make_brief(scope_globs: Vec<&str>, goal: &str) -> TaskBrief {
        TaskBrief {
            id: "brief-1".into(),
            goal: goal.into(),
            scope_globs: scope_globs.into_iter().map(String::from).collect(),
            lane_id: "lane/kernel".into(),
            invariants: vec!["never run brief commands".into()],
        }
    }

    #[test]
    fn rejects_empty_scope_globs_first() {
        let dir = std::env::temp_dir().join(format!("hypo-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let gate = KernelGate::with_command(&dir, Some("exit 1".into()));
        let brief = make_brief(vec![], "test");
        let report = gate.evaluate(&brief, &[".env"]).unwrap();
        assert!(!report.passed);
        assert!(report.pure_scope_violation);
        assert_eq!(report.failure_kind, Some(GateFailureKind::EmptyScopeGlobs));
        assert!(report.command_ran.is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn blocks_protected_and_test_files_even_if_scope_allows_all() {
        let dir = std::env::temp_dir().join(format!("hypo-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let gate = KernelGate::with_command(&dir, None);
        let brief = make_brief(vec!["**/*"], "edit files");

        for blocked in [
            "src/foo_test.rs",
            "tests/integration.rs",
            "ui/app.spec.ts",
            ".env",
            "config/.env.local",
            ".git/config",
            ".githooks/commit-msg",
        ] {
            let report = gate.evaluate(&brief, &[blocked]).unwrap();
            assert!(!report.passed, "expected {blocked} to be blocked");
            assert!(report.pure_scope_violation);
            assert_eq!(
                report.failure_kind,
                Some(GateFailureKind::ProtectedFileViolation)
            );
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn blocks_out_of_scope_before_running_command() {
        let dir = std::env::temp_dir().join(format!("hypo-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let gate = KernelGate::with_command(&dir, Some("echo SHOULD_NOT_RUN".into()));
        let brief = make_brief(vec!["src/**"], "only edit src");
        let report = gate.evaluate(&brief, &["docs/plan.md"]).unwrap();

        assert!(!report.passed);
        assert!(report.pure_scope_violation);
        assert_eq!(report.failure_kind, Some(GateFailureKind::OutOfScope));
        assert!(report.command_ran.is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_brief_text_commands_and_runs_env_pinned_command() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("hypo-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let marker_from_brief = dir.join("from_brief.txt");
        let brief = make_brief(
            vec!["src/**"],
            &format!(
                "HARNESS_GATE_CMD=\"echo pwned > {}\" && echo pwned > {}",
                marker_from_brief.display(),
                marker_from_brief.display()
            ),
        );

        let gate = KernelGate::new(&dir);
        std::env::set_var("HARNESS_GATE_CMD", "echo gate-ok");
        let report = gate.evaluate(&brief, &["src/lib.rs"]).unwrap();
        std::env::remove_var("HARNESS_GATE_CMD");

        assert!(report.passed);
        assert!(!report.pure_scope_violation);
        assert_eq!(report.command_ran.as_deref(), Some("echo gate-ok"));
        assert!(report.output.contains("gate-ok"));
        assert!(!marker_from_brief.exists());

        // Failing gate command reports pure_scope_violation = false (triggers semantic escalation).
        let failing_gate = KernelGate::with_command(&dir, Some("exit 2".into()));
        let fail_report = failing_gate.evaluate(&brief, &["src/lib.rs"]).unwrap();
        assert!(!fail_report.passed);
        assert!(!fail_report.pure_scope_violation);
        assert_eq!(fail_report.failure_kind, Some(GateFailureKind::CommandFailed));
        assert_eq!(fail_report.exit_code, Some(2));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validates_exact_contraprova_check_ordering() {
        let dir = std::env::temp_dir().join(format!("hypo-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let gate = KernelGate::with_command(&dir, Some("exit 9".into()));

        // Both protected (.env) and out-of-scope (docs/x.md) present -> Step 2 (ProtectedFileViolation) runs before Step 3 (OutOfScope).
        let brief = make_brief(vec!["src/**"], "order check");
        let report = gate
            .evaluate(&brief, &["docs/x.md", ".env.production"])
            .unwrap();
        assert!(!report.passed);
        assert!(report.pure_scope_violation);
        assert_eq!(
            report.failure_kind,
            Some(GateFailureKind::ProtectedFileViolation)
        );
        assert!(report.command_ran.is_none());

        let _ = fs::remove_dir_all(&dir);
    }
}
