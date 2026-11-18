use anyhow::{bail, Result};
use hypotaxis_contracts::{AppleVmBackendKind, AppleVmConfig};
use serde::{Deserialize, Serialize};

use crate::detector::HostCapabilities;
use crate::remote_ssh::CommandSpec;

pub const DEFAULT_QEMU_SSH_FORWARD_PORT: u16 = 50922;
pub const DEFAULT_QEMU_GUEST_SSH_PORT: u16 = 10022;

pub const APPLE_EULA_NOTICE: &str = "Apple macOS SLA/EULA notice: macOS virtualization is legally permitted only on Apple-branded hardware using user-supplied OpenCore and macOS recovery images.";
pub const METAL_CAPABILITY_NOTICE: &str = "Metal capability notice: QEMU/KVM/WHPX runs without Apple GPU passthrough; Metal hardware acceleration is unavailable (CoreAnimation/SwiftUI fall back to software rendering; use RemoteAppleSsh for full Metal iOS Simulator performance).";

/// Configuration options for generating a QEMU + OpenCore + VirtioFS macOS VM launch spec.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QemuVmOptions {
    pub vcpus: u16,
    pub memory_mb: u32,
    pub host_repo_path: String,
    pub opencore_image: String,
    pub macos_disk_image: String,
    pub ovmf_code_path: String,
    pub ovmf_vars_path: String,
    pub virtiofs_socket: String,
    pub ssh_forward_port: u16,
    pub host_os: String,
    pub kvm_available: bool,
}

impl Default for QemuVmOptions {
    fn default() -> Self {
        Self {
            vcpus: 4,
            memory_mb: 8192,
            host_repo_path: ".".to_string(),
            opencore_image: "OpenCore.qcow2".to_string(),
            macos_disk_image: "mac_hdd_ng.img".to_string(),
            ovmf_code_path: "OVMF_CODE.fd".to_string(),
            ovmf_vars_path: "OVMF_VARS-1920x1080.fd".to_string(),
            virtiofs_socket: "/tmp/hypotaxis-virtiofs.sock".to_string(),
            ssh_forward_port: DEFAULT_QEMU_SSH_FORWARD_PORT,
            host_os: std::env::consts::OS.to_string(),
            kvm_available: cfg!(target_os = "linux") && std::path::Path::new("/dev/kvm").exists(),
        }
    }
}

impl QemuVmOptions {
    /// Builds `QemuVmOptions` informed by probed `HostCapabilities` and `AppleVmConfig`.
    pub fn from_config(config: &AppleVmConfig, caps: &HostCapabilities) -> Self {
        let port = if config.ssh_port == 0 || config.ssh_port == 22 {
            DEFAULT_QEMU_SSH_FORWARD_PORT
        } else {
            config.ssh_port
        };
        Self {
            host_repo_path: config.repo_mount_path.clone(),
            ssh_forward_port: port,
            host_os: caps.os.clone(),
            kvm_available: caps.kvm_available,
            ..Self::default()
        }
    }
}

/// Complete launch specification for OpenCore + QEMU KVM/WHPX + VirtioFS + SSH forwarding.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QemuLaunchSpec {
    pub binary: String,
    pub accelerator: String,
    pub args: Vec<String>,
    pub virtiofsd_command: CommandSpec,
    pub ssh_forward_flag: String,
    pub ssh_connect_command: CommandSpec,
    pub eula_notice: String,
    pub metal_notice: String,
    pub notices: Vec<String>,
}

/// Generates QEMU/KVM/WHPX + OpenCore launch specs for local macOS guest automation.
#[derive(Debug, Clone, Default)]
pub struct QemuKvmRunner;

impl QemuKvmRunner {
    pub fn new() -> Self {
        Self
    }

    /// Generates the QEMU + OpenCore + VirtioFS + SSH port-forward launch specification.
    pub fn build_launch_spec(
        &self,
        config: &AppleVmConfig,
        opts: &QemuVmOptions,
    ) -> Result<QemuLaunchSpec> {
        if opts.vcpus == 0 {
            bail!("vcpus must be >= 1");
        }
        if opts.memory_mb < 2048 {
            bail!("memory_mb must be >= 2048 MB for macOS guest");
        }
        if opts.ssh_forward_port == 0 {
            bail!("ssh_forward_port must be >= 1");
        }

        let accelerator = match opts.host_os.as_str() {
            "linux" if opts.kvm_available => "kvm",
            "windows" => "whpx",
            "macos" => "hvf",
            _ => "tcg",
        }
        .to_string();

        let machine_flag = match accelerator.as_str() {
            "whpx" => "q35,accel=whpx,kernel-irqchip=off".to_string(),
            other => format!("q35,accel={other}"),
        };

        let cpu_flag = match accelerator.as_str() {
            "kvm" => {
                "Penryn,kvm=on,vendor=GenuineIntel,+invtsc,vmware-cpuid-freq=on,+ssse3,+sse4.2,+popcnt,+avx,+avx2,+aes,+fma,+bmi1,+bmi2,check"
            }
            _ => {
                "Penryn,vendor=GenuineIntel,+ssse3,+sse4.2,+popcnt,+avx,+aes,check"
            }
        }
        .to_string();

        let ssh_user = if config.ssh_user.trim().is_empty() {
            "developer"
        } else {
            config.ssh_user.trim()
        };

        let hostfwd = format!(
            "user,id=net0,hostfwd=tcp:127.0.0.1:{}-:{DEFAULT_QEMU_GUEST_SSH_PORT}",
            opts.ssh_forward_port
        );
        let ssh_forward_flag = format!(
            "-p {}:{DEFAULT_QEMU_GUEST_SSH_PORT}",
            opts.ssh_forward_port
        );

        let args = vec![
            "-machine".to_string(),
            machine_flag,
            "-cpu".to_string(),
            cpu_flag,
            "-smp".to_string(),
            opts.vcpus.to_string(),
            "-m".to_string(),
            opts.memory_mb.to_string(),
            "-object".to_string(),
            format!(
                "memory-backend-memfd,id=mem,size={}M,share=on",
                opts.memory_mb
            ),
            "-numa".to_string(),
            "node,memdev=mem".to_string(),
            "-drive".to_string(),
            format!(
                "if=pflash,format=raw,readonly=on,file={}",
                opts.ovmf_code_path
            ),
            "-drive".to_string(),
            format!("if=pflash,format=raw,file={}", opts.ovmf_vars_path),
            "-drive".to_string(),
            format!(
                "id=OpenCore,if=none,format=qcow2,file={}",
                opts.opencore_image
            ),
            "-device".to_string(),
            "ide-hd,bus=ide.0,drive=OpenCore".to_string(),
            "-drive".to_string(),
            format!(
                "id=MacHDD,if=none,format=qcow2,file={}",
                opts.macos_disk_image
            ),
            "-device".to_string(),
            "ide-hd,bus=ide.1,drive=MacHDD".to_string(),
            "-chardev".to_string(),
            format!("socket,id=char0,path={}", opts.virtiofs_socket),
            "-device".to_string(),
            "virtio-fs-pci,queue-size=1024,chardev=char0,tag=hypotaxis-repo".to_string(),
            "-netdev".to_string(),
            hostfwd,
            "-device".to_string(),
            "vmxnet3,netdev=net0".to_string(),
            "-display".to_string(),
            "none".to_string(),
        ];

        let virtiofsd_command = CommandSpec {
            program: "virtiofsd".to_string(),
            args: vec![
                format!("--socket-path={}", opts.virtiofs_socket),
                "--shared-dir".to_string(),
                opts.host_repo_path.clone(),
                "--cache".to_string(),
                "always".to_string(),
            ],
        };

        let ssh_connect_command = CommandSpec {
            program: "ssh".to_string(),
            args: vec![
                "-p".to_string(),
                opts.ssh_forward_port.to_string(),
                "-o".to_string(),
                "BatchMode=yes".to_string(),
                format!("{ssh_user}@127.0.0.1"),
            ],
        };

        let mut notices = vec![
            APPLE_EULA_NOTICE.to_string(),
            METAL_CAPABILITY_NOTICE.to_string(),
        ];
        if opts.host_os == "windows" {
            notices.push(
                "Windows WHPX notice: VirtioFS requires WSL2/Linux virtiofsd; on native Windows WHPX use rsync over SSH port 50922."
                    .to_string(),
            );
        } else if accelerator == "tcg" {
            notices.push(
                "TCG notice: Hardware virtualization (KVM/WHPX) unavailable; falling back to slow software CPU emulation."
                    .to_string(),
            );
        }

        Ok(QemuLaunchSpec {
            binary: "qemu-system-x86_64".to_string(),
            accelerator,
            args,
            virtiofsd_command,
            ssh_forward_flag,
            ssh_connect_command,
            eula_notice: APPLE_EULA_NOTICE.to_string(),
            metal_notice: METAL_CAPABILITY_NOTICE.to_string(),
            notices,
        })
    }

    /// Converts a `LocalQemuKvm` config into an `AppleVmConfig` targeting the forwarded local SSH port.
    pub fn forwarded_ssh_config(&self, config: &AppleVmConfig) -> AppleVmConfig {
        let port = if config.ssh_port == 0 || config.ssh_port == 22 {
            DEFAULT_QEMU_SSH_FORWARD_PORT
        } else {
            config.ssh_port
        };
        let user = if config.ssh_user.trim().is_empty() {
            "developer".to_string()
        } else {
            config.ssh_user.clone()
        };
        AppleVmConfig {
            backend: AppleVmBackendKind::RemoteAppleSsh,
            ssh_host: "127.0.0.1".to_string(),
            ssh_user: user,
            ssh_port: port,
            repo_mount_path: config.repo_mount_path.clone(),
            scheme: config.scheme.clone(),
            simulator_device: config.simulator_device.clone(),
        }
    }
}
