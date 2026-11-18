pub mod detector;
pub mod qemu_kvm;
pub mod remote_ssh;
pub mod simulated;

use anyhow::Result;
pub use detector::{
    detect_apple_vm, detect_with_capabilities, probe_all_backends, probe_all_with_capabilities,
    probe_host_capabilities, HostCapabilities,
};
pub use hypotaxis_contracts::*;
pub use qemu_kvm::{
    QemuKvmRunner, QemuLaunchSpec, QemuVmOptions, APPLE_EULA_NOTICE, DEFAULT_QEMU_GUEST_SSH_PORT,
    DEFAULT_QEMU_SSH_FORWARD_PORT, METAL_CAPABILITY_NOTICE,
};
pub use remote_ssh::{
    parse_xcodebuild_output, CommandSpec, RemoteAppleSshRunner, VirtioFsSyncSpec,
};
pub use simulated::{SimulatedAppleRunner, SimulatedScenario};

pub fn apple_vm_ready() -> bool {
    true
}

/// Runs an Xcode / iOS Simulator build workflow using the backend specified in `config`.
pub async fn run_xcode_build(config: &AppleVmConfig) -> Result<XcodeBuildResult> {
    match config.backend {
        AppleVmBackendKind::RemoteAppleSsh => RemoteAppleSshRunner::new().execute(config).await,
        AppleVmBackendKind::LocalQemuKvm => {
            let qemu = QemuKvmRunner::new();
            let ssh_cfg = qemu.forwarded_ssh_config(config);
            let mut result = RemoteAppleSshRunner::new().execute(&ssh_cfg).await?;
            result.backend = AppleVmBackendKind::LocalQemuKvm;
            Ok(result)
        }
        AppleVmBackendKind::SimulatedPreview => {
            Ok(SimulatedAppleRunner::new().run_async(config).await)
        }
    }
}
