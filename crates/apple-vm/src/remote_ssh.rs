use std::path::Path;
use std::time::Instant;

use anyhow::{bail, Context, Result};
use hypotaxis_contracts::{AppleVmBackendKind, AppleVmConfig, XcodeBuildResult};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// Structured command specification avoiding shell interpolation on the local host.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
}

impl CommandSpec {
    /// Formats a human-readable shell-like command preview for diagnostics and UI display.
    pub fn to_display_string(&self) -> String {
        let mut parts = Vec::with_capacity(self.args.len() + 1);
        parts.push(self.program.clone());
        for arg in &self.args {
            if arg.contains(' ') || arg.contains('\'') || arg.contains('"') {
                parts.push(posix_single_quote(arg));
            } else {
                parts.push(arg.clone());
            }
        }
        parts.join(" ")
    }
}

/// VirtioFS file-sharing specification for pairing a host checkout with a guest macOS/Linux VM.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VirtioFsSyncSpec {
    pub tag: String,
    pub host_path: String,
    pub guest_mount_path: String,
    pub guest_mount_command: CommandSpec,
}

/// Drives remote `xcodebuild test` runs over OpenSSH against a paired Apple Silicon / Intel Mac.
#[derive(Debug, Clone, Default)]
pub struct RemoteAppleSshRunner;

impl RemoteAppleSshRunner {
    pub fn new() -> Self {
        Self
    }

    /// Validates SSH and Xcode parameters against injection or malformed options.
    pub fn validate_config(config: &AppleVmConfig) -> Result<()> {
        validate_ssh_token("ssh_host", &config.ssh_host)?;
        validate_ssh_token("ssh_user", &config.ssh_user)?;
        if config.ssh_port == 0 {
            bail!("ssh_port must be >= 1");
        }
        validate_non_control("repo_mount_path", &config.repo_mount_path)?;
        validate_non_control("scheme", &config.scheme)?;
        validate_non_control("simulator_device", &config.simulator_device)?;

        if config.scheme.trim().starts_with('-') {
            bail!("scheme must not start with '-'");
        }
        if config.simulator_device.trim().starts_with('-') {
            bail!("simulator_device must not start with '-'");
        }
        Ok(())
    }

    /// Builds the safely quoted remote command executed via SSH on the Mac host.
    pub fn build_xcodebuild_remote_cmd(config: &AppleVmConfig) -> Result<String> {
        Self::validate_config(config)?;
        let repo = posix_single_quote(config.repo_mount_path.trim());
        let scheme = posix_single_quote(config.scheme.trim());
        let destination = posix_single_quote(&format!(
            "platform=iOS Simulator,name={}",
            config.simulator_device.trim()
        ));
        Ok(format!(
            "cd {repo} && xcodebuild test -scheme {scheme} -destination {destination}"
        ))
    }

    /// Builds a safe `ssh -p <port> <user>@<host> <remote_cmd>` `CommandSpec`.
    pub fn build_ssh_command(&self, config: &AppleVmConfig) -> Result<CommandSpec> {
        let remote_cmd = Self::build_xcodebuild_remote_cmd(config)?;
        let target = format!("{}@{}", config.ssh_user.trim(), config.ssh_host.trim());
        Ok(CommandSpec {
            program: "ssh".to_string(),
            args: vec![
                "-p".to_string(),
                config.ssh_port.to_string(),
                "-o".to_string(),
                "BatchMode=yes".to_string(),
                "-o".to_string(),
                "ConnectTimeout=10".to_string(),
                "-o".to_string(),
                "StrictHostKeyChecking=accept-new".to_string(),
                target,
                remote_cmd,
            ],
        })
    }

    /// Builds an `rsync` over SSH command spec to mirror local repo changes onto the remote Mac.
    pub fn build_rsync_command(
        &self,
        config: &AppleVmConfig,
        local_repo: &Path,
    ) -> Result<CommandSpec> {
        Self::validate_config(config)?;
        let local_str = local_repo.to_string_lossy();
        if local_str.trim().is_empty() {
            bail!("local_repo path must not be empty");
        }
        let mut src = local_str.replace('\\', "/");
        if !src.ends_with('/') {
            src.push('/');
        }
        let mut dst_path = config.repo_mount_path.trim().to_string();
        if !dst_path.ends_with('/') {
            dst_path.push('/');
        }
        let ssh_transport = format!("ssh -p {} -o BatchMode=yes", config.ssh_port);
        let remote_dst = format!(
            "{}@{}:{dst_path}",
            config.ssh_user.trim(),
            config.ssh_host.trim()
        );

        Ok(CommandSpec {
            program: "rsync".to_string(),
            args: vec![
                "-az".to_string(),
                "--delete".to_string(),
                "--exclude".to_string(),
                ".git".to_string(),
                "-e".to_string(),
                ssh_transport,
                src,
                remote_dst,
            ],
        })
    }

    /// Builds a VirtioFS mount specification for shared host-to-guest workspace syncing.
    pub fn build_virtiofs_sync_spec(
        &self,
        config: &AppleVmConfig,
        local_repo: &Path,
    ) -> Result<VirtioFsSyncSpec> {
        validate_non_control("repo_mount_path", &config.repo_mount_path)?;
        let tag = "hypotaxis-repo".to_string();
        let guest_mount_path = config.repo_mount_path.trim().to_string();
        let host_path = local_repo.to_string_lossy().to_string();

        Ok(VirtioFsSyncSpec {
            tag: tag.clone(),
            host_path,
            guest_mount_path: guest_mount_path.clone(),
            guest_mount_command: CommandSpec {
                program: "mount_virtiofs".to_string(),
                args: vec![tag, guest_mount_path],
            },
        })
    }

    /// Executes `xcodebuild test` on the configured remote Mac over SSH and parses the result.
    pub async fn execute(&self, config: &AppleVmConfig) -> Result<XcodeBuildResult> {
        let spec = self.build_ssh_command(config)?;
        let started = Instant::now();
        let output = Command::new(&spec.program)
            .args(&spec.args)
            .output()
            .await
            .with_context(|| format!("failed to launch `{}`", spec.program))?;

        let elapsed_ms = started.elapsed().as_millis() as u64;
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        let mut result = parse_xcodebuild_output(&combined, config, elapsed_ms);
        if !output.status.success() && result.tests_total == 0 && !combined.contains("TEST FAILED")
        {
            bail!(
                "remote ssh command failed ({}): {}",
                output.status,
                combined.trim()
            );
        }
        if !output.status.success() {
            result.succeeded = false;
        }
        Ok(result)
    }
}

/// Parses `xcodebuild test` output into a structured `XcodeBuildResult`.
pub fn parse_xcodebuild_output(
    raw_output: &str,
    config: &AppleVmConfig,
    fallback_duration_ms: u64,
) -> XcodeBuildResult {
    let mut log_lines: Vec<String> = Vec::new();
    let mut current_suite: Option<String> = None;
    let mut all_tests_summary: Option<(u32, u32, Option<u64>)> = None;
    let mut last_summary: Option<(u32, u32, Option<u64>)> = None;
    let mut case_passed = 0u32;
    let mut case_failed = 0u32;
    let mut explicit_outcome: Option<bool> = None;
    let mut saw_error = false;

    for raw_line in raw_output.lines() {
        let line = raw_line.trim_end_matches('\r');
        if !line.trim().is_empty() {
            log_lines.push(line.to_string());
        }
        let trimmed = line.trim();

        if let Some(suite_name) = extract_suite_name(trimmed) {
            current_suite = Some(suite_name);
        }

        if let Some(summary) = parse_executed_summary_line(trimmed) {
            last_summary = Some(summary);
            if matches!(
                current_suite.as_deref(),
                Some("All tests") | Some("Selected tests")
            ) {
                all_tests_summary = Some(summary);
            }
        }

        if trimmed.starts_with("Test Case '") {
            if trimmed.contains("' passed (") {
                case_passed = case_passed.saturating_add(1);
            } else if trimmed.contains("' failed (") {
                case_failed = case_failed.saturating_add(1);
            }
        }

        if trimmed.contains("** TEST SUCCEEDED **") || trimmed.contains("** BUILD SUCCEEDED **") {
            explicit_outcome = Some(true);
        } else if trimmed.contains("** TEST FAILED **") || trimmed.contains("** BUILD FAILED **") {
            explicit_outcome = Some(false);
        } else if trimmed.starts_with("xcodebuild: error:") {
            saw_error = true;
            explicit_outcome = Some(false);
        }
    }

    let chosen = all_tests_summary.or(last_summary);
    let (tests_total, failures, parsed_duration_ms) = match chosen {
        Some((total, fails, dur)) => (total, fails, dur),
        None => {
            let total = case_passed.saturating_add(case_failed);
            (total, case_failed, None)
        }
    };

    let tests_passed = tests_total.saturating_sub(failures);
    let duration_ms = parsed_duration_ms.unwrap_or(fallback_duration_ms);
    let succeeded = if saw_error || failures > 0 {
        false
    } else {
        explicit_outcome.unwrap_or(tests_total > 0)
    };

    XcodeBuildResult {
        backend: AppleVmBackendKind::RemoteAppleSsh,
        succeeded,
        duration_ms,
        tests_passed,
        tests_total,
        log_lines,
        simulator_screen_title: format!(
            "{} · {}",
            config.scheme.trim(),
            config.simulator_device.trim()
        ),
    }
}

fn extract_suite_name(line: &str) -> Option<String> {
    let rest = line.strip_prefix("Test Suite '")?;
    let end_quote = rest.find('\'')?;
    Some(rest[..end_quote].to_string())
}

fn parse_executed_summary_line(line: &str) -> Option<(u32, u32, Option<u64>)> {
    // Matches lines such as:
    // "Executed 14 tests, with 0 failures (0 unexpected) in 1.104 (1.120) seconds"
    // "Executed 1 test, with 1 failure (0 unexpected) in 0.042 (0.045) seconds"
    let rest = line.strip_prefix("Executed ")?;
    let total_str = rest.split_whitespace().next()?;
    let total = total_str.parse::<u32>().ok()?;

    let after_with = rest.split("with ").nth(1)?;
    let fail_str = after_with.split_whitespace().next()?;
    let failures = fail_str.parse::<u32>().ok()?;

    let duration_ms = rest.split(" in ").nth(1).and_then(|dur_part| {
        let first_num = dur_part.split_whitespace().next()?;
        let seconds = first_num.parse::<f64>().ok()?;
        Some((seconds * 1000.0).round() as u64)
    });

    Some((total, failures, duration_ms))
}

fn validate_ssh_token(field: &str, value: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("{field} must not be empty");
    }
    if trimmed.starts_with('-') {
        bail!("{field} must not start with '-'");
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':'))
    {
        bail!("{field} contains unsafe characters: '{trimmed}'");
    }
    Ok(())
}

fn validate_non_control(field: &str, value: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("{field} must not be empty");
    }
    if trimmed
        .chars()
        .any(|c| c.is_control() || c == '\0' || matches!(c, ';' | '&' | '|' | '`' | '$'))
    {
        bail!("{field} contains disallowed control or shell characters");
    }
    Ok(())
}

fn posix_single_quote(input: &str) -> String {
    let escaped = input.replace('\'', "'\\''");
    format!("'{escaped}'")
}
