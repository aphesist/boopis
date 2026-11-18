use hypotaxis_contracts::{AppleVmBackendKind, AppleVmConfig, XcodeBuildResult};

use crate::remote_ssh::parse_xcodebuild_output;

/// Scenario selector for deterministic simulated iOS Simulator / Xcode runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SimulatedScenario {
    Pass,
    FailingAssertion { failed_test: String },
}

/// Deterministic local Apple Simulator runner for Windows/Linux development without a physical Mac.
#[derive(Debug, Clone, Default)]
pub struct SimulatedAppleRunner;

impl SimulatedAppleRunner {
    pub fn new() -> Self {
        Self
    }

    /// Executes a deterministic simulated `xcodebuild test` run for the `16:10` Bot Simulator stage.
    pub fn run(&self, config: &AppleVmConfig) -> XcodeBuildResult {
        self.run_with_scenario(config, SimulatedScenario::Pass)
    }

    /// Async wrapper yielding to the Tokio executor for Tauri command integration.
    pub async fn run_async(&self, config: &AppleVmConfig) -> XcodeBuildResult {
        tokio::task::yield_now().await;
        self.run(config)
    }

    /// Executes a deterministic simulated build under a specified `SimulatedScenario`.
    pub fn run_with_scenario(
        &self,
        config: &AppleVmConfig,
        scenario: SimulatedScenario,
    ) -> XcodeBuildResult {
        let scheme = normalize_or_default(&config.scheme, "CorePay");
        let device = normalize_or_default(&config.simulator_device, "iPhone 16 Pro");
        let duration_ms = deterministic_duration_ms(&scheme, &device);
        let duration_secs = format!("{:.3}", (duration_ms as f64) / 1000.0);

        let test_cases = [
            "testBotCanvasSixteenByTenAspect",
            "testOrbSphericalEyeForeshortening",
            "testSoftBodyFourierWobble",
            "testThreeStageEscalatingPoke",
            "testCapsuleComposerSpringAnchor",
            "testDitheredSmokeGateCard",
            "testLocalArtifactGitForkCoW",
            "testArtifactVirtualTreeRead",
            "testCheckoutRateLimitSlidingWindow",
            "testCheckoutToastDismissAnimation",
            "testFeedforwardScopeValidation",
            "testLeavingBlanksChipResolution",
            "testAccessibilityMonochromeContrast",
            "testSimulatorSnapshotRegression",
        ];

        let failed_name = match &scenario {
            SimulatedScenario::Pass => None,
            SimulatedScenario::FailingAssertion { failed_test } => Some(failed_test.as_str()),
        };

        let mut raw_lines = vec![
            format!("Build settings from command line:"),
            format!("    SCHEME = {scheme}"),
            format!("    DESTINATION = platform=iOS Simulator,name={device}"),
            format!(
                "Test Suite 'All tests' started at 2026-11-18 02:15:00.000."
            ),
            format!(
                "Test Suite '{scheme}Tests.xctest' started at 2026-11-18 02:15:00.012."
            ),
            format!(
                "Test Suite '{scheme}UITests' started at 2026-11-18 02:15:00.015."
            ),
        ];

        let mut failures = 0u32;
        for (idx, case) in test_cases.iter().enumerate() {
            let case_secs = format!("0.{:03}", 24 + ((idx * 17) % 85));
            let is_fail = failed_name == Some(*case)
                || (failed_name.is_some() && idx == test_cases.len() - 1 && failures == 0);
            if is_fail {
                failures += 1;
                raw_lines.push(format!(
                    "Test Case '-[{scheme}Tests.{scheme}UITests {case}]' failed ({case_secs} seconds)."
                ));
            } else {
                raw_lines.push(format!(
                    "Test Case '-[{scheme}Tests.{scheme}UITests {case}]' passed ({case_secs} seconds)."
                ));
            }
        }

        let total = test_cases.len() as u32;
        let outcome_word = if failures == 0 { "passed" } else { "failed" };
        let banner = if failures == 0 {
            "** TEST SUCCEEDED **"
        } else {
            "** TEST FAILED **"
        };

        raw_lines.push(format!(
            "Test Suite '{scheme}UITests' {outcome_word} at 2026-11-18 02:15:01.100."
        ));
        raw_lines.push(format!(
            "\t Executed {total} tests, with {failures} failures (0 unexpected) in {duration_secs} ({duration_secs}) seconds"
        ));
        raw_lines.push(format!(
            "Test Suite 'All tests' {outcome_word} at 2026-11-18 02:15:01.104."
        ));
        raw_lines.push(format!(
            "\t Executed {total} tests, with {failures} failures (0 unexpected) in {duration_secs} ({duration_secs}) seconds"
        ));
        raw_lines.push(banner.to_string());

        let joined = raw_lines.join("\n");
        let mut parsed = parse_xcodebuild_output(&joined, config, duration_ms);
        parsed.backend = AppleVmBackendKind::SimulatedPreview;
        parsed.duration_ms = duration_ms;
        parsed.simulator_screen_title = format!("{scheme} · {device} (Simulated 16:10)");
        parsed
    }
}

fn normalize_or_default(input: &str, default_val: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        default_val.to_string()
    } else {
        trimmed.to_string()
    }
}

fn deterministic_duration_ms(scheme: &str, device: &str) -> u64 {
    // Stable FNV-1a hash mapping to [920, 1480] ms.
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in scheme.as_bytes().iter().chain(b":").chain(device.as_bytes()) {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    920 + (hash % 561)
}
