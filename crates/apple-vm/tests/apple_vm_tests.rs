use std::path::PathBuf;

use apple_vm::{
    detect_apple_vm, detect_with_capabilities, parse_xcodebuild_output, probe_all_with_capabilities,
    probe_host_capabilities, run_xcode_build, AppleVmBackendKind, AppleVmConfig, HostCapabilities,
    QemuKvmRunner, QemuVmOptions, RemoteAppleSshRunner, SimulatedAppleRunner, SimulatedScenario,
    APPLE_EULA_NOTICE, METAL_CAPABILITY_NOTICE,
};

fn sample_ssh_config() -> AppleVmConfig {
    AppleVmConfig {
        backend: AppleVmBackendKind::RemoteAppleSsh,
        ssh_host: "mac-mini.local".to_string(),
        ssh_user: "aphesist".to_string(),
        ssh_port: 2222,
        repo_mount_path: "/Users/aphesist/src/CorePay".to_string(),
        scheme: "CorePay".to_string(),
        simulator_device: "iPhone 16 Pro".to_string(),
    }
}

#[test]
fn detector_probes_host_and_selects_expected_backends() {
    let real_caps = probe_host_capabilities();
    assert!(!real_caps.os.is_empty());
    assert!(!real_caps.arch.is_empty());

    let linux_kvm_caps = HostCapabilities {
        os: "linux".to_string(),
        arch: "x86_64".to_string(),
        ssh_available: true,
        qemu_x86_64_available: true,
        docker_available: true,
        wsl_available: false,
        kvm_available: true,
    };

    // Remote SSH configured + ssh available -> connected true.
    let remote_cfg = sample_ssh_config();
    let status = detect_with_capabilities(Some(&remote_cfg), &linux_kvm_caps);
    assert_eq!(status.backend, AppleVmBackendKind::RemoteAppleSsh);
    assert!(status.connected);
    assert!(status.host_os_supported);
    assert!(status.stream_hint.contains("aphesist@mac-mini.local:2222"));

    // Missing ssh -> connected false.
    let no_ssh_caps = HostCapabilities {
        ssh_available: false,
        ..linux_kvm_caps.clone()
    };
    let missing_ssh = detect_with_capabilities(Some(&remote_cfg), &no_ssh_caps);
    assert_eq!(missing_ssh.backend, AppleVmBackendKind::RemoteAppleSsh);
    assert!(!missing_ssh.connected);
    assert!(missing_ssh.detail.contains("ssh"));

    // Local QEMU/KVM on Linux with KVM -> connected true and includes EULA/Metal notices.
    let qemu_cfg = AppleVmConfig {
        backend: AppleVmBackendKind::LocalQemuKvm,
        ..remote_cfg.clone()
    };
    let qemu_status = detect_with_capabilities(Some(&qemu_cfg), &linux_kvm_caps);
    assert_eq!(qemu_status.backend, AppleVmBackendKind::LocalQemuKvm);
    assert!(qemu_status.connected);
    assert!(qemu_status.detail.contains("EULA"));
    assert!(qemu_status.detail.contains("Metal"));

    // Probe all returns all 3 backends.
    let all = probe_all_with_capabilities(&remote_cfg, &linux_kvm_caps);
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].backend, AppleVmBackendKind::RemoteAppleSsh);
    assert_eq!(all[1].backend, AppleVmBackendKind::LocalQemuKvm);
    assert_eq!(all[2].backend, AppleVmBackendKind::SimulatedPreview);

    // Default detect_apple_vm does not panic on the host.
    let host_status = detect_apple_vm(Some(&AppleVmConfig {
        backend: AppleVmBackendKind::SimulatedPreview,
        ..remote_cfg
    }));
    assert_eq!(host_status.backend, AppleVmBackendKind::SimulatedPreview);
    assert!(host_status.connected);
}

#[test]
fn remote_ssh_builds_safe_xcodebuild_rsync_and_virtiofs_specs() {
    let runner = RemoteAppleSshRunner::new();
    let cfg = sample_ssh_config();

    let ssh_cmd = runner.build_ssh_command(&cfg).expect("build ssh command");
    assert_eq!(ssh_cmd.program, "ssh");
    assert_eq!(&ssh_cmd.args[0..2], &["-p", "2222"]);
    assert!(ssh_cmd.args.contains(&"aphesist@mac-mini.local".to_string()));
    let remote = ssh_cmd.args.last().expect("remote cmd");
    assert!(remote.contains("xcodebuild test -scheme 'CorePay'"));
    assert!(remote.contains("-destination 'platform=iOS Simulator,name=iPhone 16 Pro'"));

    // Escaping single quotes safely without allowing command breakout.
    let quoted_cfg = AppleVmConfig {
        simulator_device: "O'Brien's iPhone 16".to_string(),
        ..cfg.clone()
    };
    let quoted_cmd = runner
        .build_ssh_command(&quoted_cfg)
        .expect("quoted device");
    let quoted_remote = quoted_cmd.args.last().unwrap();
    assert!(quoted_remote.contains("O'\\''Brien'\\''s iPhone 16"));

    // Reject option/shell injection attempts.
    let bad_host = AppleVmConfig {
        ssh_host: "-oProxyCommand=calc.exe".to_string(),
        ..cfg.clone()
    };
    assert!(runner.build_ssh_command(&bad_host).is_err());

    let bad_scheme = AppleVmConfig {
        scheme: "CorePay; rm -rf /".to_string(),
        ..cfg.clone()
    };
    assert!(runner.build_ssh_command(&bad_scheme).is_err());

    // Rsync + VirtioFS specs.
    let local_repo = PathBuf::from("/tmp/corepay-repo");
    let rsync = runner
        .build_rsync_command(&cfg, &local_repo)
        .expect("rsync spec");
    assert_eq!(rsync.program, "rsync");
    assert!(rsync.args.contains(&"ssh -p 2222 -o BatchMode=yes".to_string()));
    assert!(rsync
        .args
        .contains(&"aphesist@mac-mini.local:/Users/aphesist/src/CorePay/".to_string()));

    let virtio = runner
        .build_virtiofs_sync_spec(&cfg, &local_repo)
        .expect("virtiofs spec");
    assert_eq!(virtio.tag, "hypotaxis-repo");
    assert_eq!(virtio.guest_mount_path, "/Users/aphesist/src/CorePay");
    assert_eq!(virtio.guest_mount_command.program, "mount_virtiofs");
}

#[test]
fn xcodebuild_output_parser_handles_pass_fail_and_case_fallback() {
    let cfg = sample_ssh_config();

    let passing_log = r#"
Test Suite 'All tests' started at 2026-11-18 02:15:00.000.
Test Suite 'CorePayTests.xctest' started at 2026-11-18 02:15:00.012.
Test Case '-[CorePayTests.CheckoutTests testRateLimit]' passed (0.012 seconds).
Test Case '-[CorePayTests.CheckoutTests testToastDismiss]' passed (0.018 seconds).
Test Suite 'CorePayTests.xctest' passed at 2026-11-18 02:15:01.000.
	 Executed 14 tests, with 0 failures (0 unexpected) in 1.104 (1.120) seconds
Test Suite 'All tests' passed at 2026-11-18 02:15:01.104.
	 Executed 14 tests, with 0 failures (0 unexpected) in 1.104 (1.120) seconds
** TEST SUCCEEDED **
"#;
    let pass_res = parse_xcodebuild_output(passing_log, &cfg, 500);
    assert!(pass_res.succeeded);
    assert_eq!(pass_res.tests_total, 14);
    assert_eq!(pass_res.tests_passed, 14);
    assert_eq!(pass_res.duration_ms, 1104);
    assert_eq!(pass_res.simulator_screen_title, "CorePay · iPhone 16 Pro");

    let failing_log = r#"
Test Suite 'All tests' started at 2026-11-18 02:16:00.000.
Test Case '-[CorePayTests.CheckoutTests testRateLimit]' passed (0.012 seconds).
Test Case '-[CorePayTests.CheckoutTests testNegativeTotal]' failed (0.045 seconds).
Test Suite 'All tests' failed at 2026-11-18 02:16:02.500.
	 Executed 14 tests, with 2 failures (1 unexpected) in 2.500 (2.510) seconds
** TEST FAILED **
"#;
    let fail_res = parse_xcodebuild_output(failing_log, &cfg, 500);
    assert!(!fail_res.succeeded);
    assert_eq!(fail_res.tests_total, 14);
    assert_eq!(fail_res.tests_passed, 12);
    assert_eq!(fail_res.duration_ms, 2500);

    // Fallback when no "Executed ..." summary is printed.
    let cases_only = r#"
Test Case '-[CorePayTests.CheckoutTests testA]' passed (0.010 seconds).
Test Case '-[CorePayTests.CheckoutTests testB]' failed (0.020 seconds).
"#;
    let fallback_res = parse_xcodebuild_output(cases_only, &cfg, 777);
    assert!(!fallback_res.succeeded);
    assert_eq!(fallback_res.tests_total, 2);
    assert_eq!(fallback_res.tests_passed, 1);
    assert_eq!(fallback_res.duration_ms, 777);

    // Explicit xcodebuild error.
    let error_log = "xcodebuild: error: The project named \"CorePay\" does not contain a scheme named \"Bad\".\n";
    let err_res = parse_xcodebuild_output(error_log, &cfg, 12);
    assert!(!err_res.succeeded);
    assert_eq!(err_res.tests_total, 0);
}

#[test]
fn qemu_kvm_runner_generates_opencore_virtiofs_and_notices() {
    let runner = QemuKvmRunner::new();
    let cfg = AppleVmConfig {
        backend: AppleVmBackendKind::LocalQemuKvm,
        ..sample_ssh_config()
    };

    let linux_caps = HostCapabilities {
        os: "linux".to_string(),
        arch: "x86_64".to_string(),
        ssh_available: true,
        qemu_x86_64_available: true,
        docker_available: false,
        wsl_available: false,
        kvm_available: true,
    };
    let linux_opts = QemuVmOptions::from_config(&cfg, &linux_caps);
    let linux_spec = runner
        .build_launch_spec(&cfg, &linux_opts)
        .expect("linux qemu spec");

    assert_eq!(linux_spec.binary, "qemu-system-x86_64");
    assert_eq!(linux_spec.accelerator, "kvm");
    assert!(linux_spec.args.contains(&"q35,accel=kvm".to_string()));
    assert!(linux_spec
        .args
        .iter()
        .any(|a| a.contains("virtio-fs-pci") && a.contains("hypotaxis-repo")));
    assert!(linux_spec
        .args
        .iter()
        .any(|a| a.contains("id=OpenCore")));
    assert!(linux_spec
        .args
        .iter()
        .any(|a| a.contains("hostfwd=tcp:127.0.0.1:2222-:10022")));
    assert_eq!(linux_spec.eula_notice, APPLE_EULA_NOTICE);
    assert_eq!(linux_spec.metal_notice, METAL_CAPABILITY_NOTICE);

    // Default port forward is 50922:10022 when ssh_port is 22 or 0.
    let default_port_cfg = AppleVmConfig {
        ssh_port: 22,
        ..cfg.clone()
    };
    let win_caps = HostCapabilities {
        os: "windows".to_string(),
        arch: "x86_64".to_string(),
        ssh_available: true,
        qemu_x86_64_available: true,
        docker_available: true,
        wsl_available: true,
        kvm_available: false,
    };
    let win_opts = QemuVmOptions::from_config(&default_port_cfg, &win_caps);
    let win_spec = runner
        .build_launch_spec(&default_port_cfg, &win_opts)
        .expect("windows whpx spec");
    assert_eq!(win_spec.accelerator, "whpx");
    assert_eq!(win_spec.ssh_forward_flag, "-p 50922:10022");
    assert!(win_spec
        .args
        .contains(&"q35,accel=whpx,kernel-irqchip=off".to_string()));
    assert!(win_spec
        .notices
        .iter()
        .any(|n| n.contains("Windows WHPX notice")));

    let forwarded = runner.forwarded_ssh_config(&default_port_cfg);
    assert_eq!(forwarded.ssh_host, "127.0.0.1");
    assert_eq!(forwarded.ssh_port, 50922);
}

#[tokio::test]
async fn simulated_runner_is_deterministic_and_supports_16_by_10_workflow() {
    let runner = SimulatedAppleRunner::new();
    let cfg = AppleVmConfig {
        backend: AppleVmBackendKind::SimulatedPreview,
        ssh_host: String::new(),
        ssh_user: String::new(),
        ssh_port: 0,
        repo_mount_path: ".".to_string(),
        scheme: "HypotaxisBotPreview".to_string(),
        simulator_device: "iPhone 16 Pro".to_string(),
    };

    let run1 = runner.run(&cfg);
    let run2 = run_xcode_build(&cfg).await.expect("run_xcode_build");
    assert_eq!(run1, run2);
    assert_eq!(run1.backend, AppleVmBackendKind::SimulatedPreview);
    assert!(run1.succeeded);
    assert_eq!(run1.tests_total, 14);
    assert_eq!(run1.tests_passed, 14);
    assert!((920..=1480).contains(&run1.duration_ms));
    assert!(run1
        .simulator_screen_title
        .contains("HypotaxisBotPreview · iPhone 16 Pro"));
    assert!(run1.log_lines.iter().any(|l| l.contains("** TEST SUCCEEDED **")));

    let fail_run = runner.run_with_scenario(
        &cfg,
        SimulatedScenario::FailingAssertion {
            failed_test: "testOrbSphericalEyeForeshortening".to_string(),
        },
    );
    assert!(!fail_run.succeeded);
    assert_eq!(fail_run.tests_total, 14);
    assert_eq!(fail_run.tests_passed, 13);
    assert!(fail_run
        .log_lines
        .iter()
        .any(|l| l.contains("** TEST FAILED **")));
}
