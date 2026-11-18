use std::path::Path;

use hypotaxis_contracts::{AppleVmBackendKind, AppleVmConfig, AppleVmStatus};
use serde::{Deserialize, Serialize};

/// Probed host operating system and Apple VM / remote build tooling capabilities.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostCapabilities {
    pub os: String,
    pub arch: String,
    pub ssh_available: bool,
    pub qemu_x86_64_available: bool,
    pub docker_available: bool,
    pub wsl_available: bool,
    pub kvm_available: bool,
}

/// Probes the current host OS and availability of `ssh`, `qemu-system-x86_64`, `docker`, and `wsl`
/// via PATH inspection (never invoking slow/interactive shells or WMI/CIM queries).
pub fn probe_host_capabilities() -> HostCapabilities {
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();
    let kvm_available = os == "linux" && Path::new("/dev/kvm").exists();

    HostCapabilities {
        os,
        arch,
        ssh_available: tool_in_path("ssh"),
        qemu_x86_64_available: tool_in_path("qemu-system-x86_64"),
        docker_available: tool_in_path("docker"),
        wsl_available: tool_in_path("wsl"),
        kvm_available,
    }
}

/// Detects the best Apple VM / Simulator status for the current host and optional config.
pub fn detect_apple_vm(config: Option<&AppleVmConfig>) -> AppleVmStatus {
    let caps = probe_host_capabilities();
    detect_with_capabilities(config, &caps)
}

/// Evaluates status for all three Apple VM backends given `config`.
pub fn probe_all_backends(config: &AppleVmConfig) -> Vec<AppleVmStatus> {
    let caps = probe_host_capabilities();
    probe_all_with_capabilities(config, &caps)
}

/// Pure capability-based status detection (deterministic for cross-OS unit testing).
pub fn detect_with_capabilities(
    config: Option<&AppleVmConfig>,
    caps: &HostCapabilities,
) -> AppleVmStatus {
    if let Some(cfg) = config {
        return status_for_backend(cfg.backend, Some(cfg), caps);
    }

    let env_host = std::env::var("HYPOTAXIS_APPLE_SSH_HOST")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let Some(host) = env_host {
        if caps.ssh_available {
            let user = std::env::var("HYPOTAXIS_APPLE_SSH_USER")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "aphesist".to_string());
            let port = std::env::var("HYPOTAXIS_APPLE_SSH_PORT")
                .ok()
                .and_then(|p| p.parse::<u16>().ok())
                .unwrap_or(22);
            return AppleVmStatus {
                backend: AppleVmBackendKind::RemoteAppleSsh,
                connected: true,
                host_os_supported: true,
                detail: format!(
                    "Remote Apple SSH configured for {user}@{host}:{port} (host OS: {}, ssh ready).",
                    caps.os
                ),
                stream_hint: format!("SSH -> {user}@{host}:{port} (Metal iOS Simulator)"),
            };
        }
    }

    status_for_backend(AppleVmBackendKind::SimulatedPreview, None, caps)
}

/// Pure capability-based probe returning statuses for all 3 backends.
pub fn probe_all_with_capabilities(
    config: &AppleVmConfig,
    caps: &HostCapabilities,
) -> Vec<AppleVmStatus> {
    vec![
        status_for_backend(AppleVmBackendKind::RemoteAppleSsh, Some(config), caps),
        status_for_backend(AppleVmBackendKind::LocalQemuKvm, Some(config), caps),
        status_for_backend(AppleVmBackendKind::SimulatedPreview, Some(config), caps),
    ]
}

fn status_for_backend(
    backend: AppleVmBackendKind,
    config: Option<&AppleVmConfig>,
    caps: &HostCapabilities,
) -> AppleVmStatus {
    match backend {
        AppleVmBackendKind::RemoteAppleSsh => {
            let (host, user, port) = match config {
                Some(c) => (
                    c.ssh_host.trim().to_string(),
                    c.ssh_user.trim().to_string(),
                    c.ssh_port,
                ),
                None => (String::new(), String::new(), 22),
            };
            let has_target = !host.is_empty() && !user.is_empty() && port > 0;
            let connected = caps.ssh_available && has_target;

            let detail = if !caps.ssh_available {
                format!(
                    "OpenSSH client (`ssh`) not found in PATH on {} {}; install OpenSSH or switch to SimulatedPreview.",
                    caps.os, caps.arch
                )
            } else if !has_target {
                "Remote Mac SSH target not configured (specify ssh_host, ssh_user, and ssh_port)."
                    .to_string()
            } else {
                format!(
                    "Remote Apple Silicon Mac SSH runner ready for {user}@{host}:{port} (native Xcode & Metal iOS Simulator)."
                )
            };

            let stream_hint = if has_target {
                format!("SSH -> {user}@{host}:{port} (Metal iOS Simulator)")
            } else {
                "SSH -> unconfigured remote Mac host".to_string()
            };

            AppleVmStatus {
                backend: AppleVmBackendKind::RemoteAppleSsh,
                connected,
                host_os_supported: true,
                detail,
                stream_hint,
            }
        }
        AppleVmBackendKind::LocalQemuKvm => {
            let host_supported = matches!(caps.os.as_str(), "linux" | "windows" | "macos");
            let accel_ready = match caps.os.as_str() {
                "linux" => caps.qemu_x86_64_available && caps.kvm_available,
                "windows" => caps.qemu_x86_64_available || (caps.docker_available && caps.wsl_available),
                "macos" => caps.qemu_x86_64_available,
                _ => false,
            };
            let connected = host_supported && accel_ready;

            let detail = format!(
                "Local QEMU/OpenCore spec ({} {}; qemu-system-x86_64={}, kvm={}, docker={}, wsl={}). Notice: Apple macOS EULA requires Apple-branded hardware; software rendering lacks Metal GPU acceleration.",
                caps.os,
                caps.arch,
                caps.qemu_x86_64_available,
                caps.kvm_available,
                caps.docker_available,
                caps.wsl_available
            );

            AppleVmStatus {
                backend: AppleVmBackendKind::LocalQemuKvm,
                connected,
                host_os_supported: host_supported,
                detail,
                stream_hint: "QEMU/KVM + OpenCore + VirtioFS (SSH port 50922 -> 10022)".to_string(),
            }
        }
        AppleVmBackendKind::SimulatedPreview => {
            let detail = format!(
                "Simulated 16:10 Bot Simulator active on {} {} (probed: ssh={}, qemu={}, docker={}, wsl={}). Runs deterministic XCTest pipelines locally without physical Mac hardware.",
                caps.os,
                caps.arch,
                caps.ssh_available,
                caps.qemu_x86_64_available,
                caps.docker_available,
                caps.wsl_available
            );

            AppleVmStatus {
                backend: AppleVmBackendKind::SimulatedPreview,
                connected: true,
                host_os_supported: true,
                detail,
                stream_hint: "Simulated 16:10 iOS Simulator Preview (deterministic XCTest)"
                    .to_string(),
            }
        }
    }
}

fn tool_in_path(tool: &str) -> bool {
    let Some(path_var) = std::env::var_os("PATH") else {
        return false;
    };

    for dir in std::env::split_paths(&path_var) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let candidate = dir.join(tool);
        if candidate.is_file() {
            return true;
        }
        if cfg!(windows) {
            let exe_candidate = dir.join(format!("{tool}.exe"));
            if exe_candidate.is_file() {
                return true;
            }
            let cmd_candidate = dir.join(format!("{tool}.cmd"));
            if cmd_candidate.is_file() {
                return true;
            }
        }
    }
    false
}
