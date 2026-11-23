//! Turning resource limits into `setrlimit` calls. Pure computation, tested on every Unix.

use std::fmt::Write as _;
use std::time::Duration;

use super::unix_sys::RlimitResource;
use crate::normalize::ResolvedLimits;

/// One `setrlimit` call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RlimitSpec {
    /// The resource id (`RLIMIT_*`).
    pub resource: RlimitResource,
    /// Soft limit.
    pub soft: u64,
    /// Hard limit.
    pub hard: u64,
    /// Short name for the report.
    pub name: &'static str,
}

/// How the limits differ by platform and namespace.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RlimitContext {
    /// Tasks already counted against the user, added to `max_processes` because `RLIMIT_NPROC`
    /// is a per-user total. Zero inside a fresh user namespace, which counts from scratch.
    pub baseline_tasks: u64,
    /// Whether the kernel enforces `RLIMIT_AS` (macOS does not).
    pub enforces_address_space: bool,
    /// Whether `RLIMIT_NPROC` binds this user: uid 0 is exempt from it, on Linux and macOS alike.
    pub enforces_process_count: bool,
}

/// The `setrlimit` calls for `limits`. Core dumps are always disabled.
pub(crate) fn plan(
    limits: &ResolvedLimits,
    kill_grace: Duration,
    ctx: RlimitContext,
) -> Vec<RlimitSpec> {
    let mut out = vec![RlimitSpec {
        resource: libc::RLIMIT_CORE,
        soft: 0,
        hard: 0,
        name: "core",
    }];
    if let (Some(bytes), true) = (limits.memory_bytes, ctx.enforces_address_space) {
        out.push(RlimitSpec {
            resource: libc::RLIMIT_AS,
            soft: bytes,
            hard: bytes,
            name: "as",
        });
    }
    if let Some(n) = limits.max_processes {
        let cap = ctx.baseline_tasks.saturating_add(n);
        out.push(RlimitSpec {
            resource: libc::RLIMIT_NPROC,
            soft: cap,
            hard: cap,
            name: "nproc",
        });
    }
    if let Some(bytes) = limits.max_file_bytes {
        out.push(RlimitSpec {
            resource: libc::RLIMIT_FSIZE,
            soft: bytes,
            hard: bytes,
            name: "fsize",
        });
    }
    if let Some(secs) = limits.cpu_seconds {
        // The soft limit sends SIGXCPU; the hard limit, a little later, SIGKILL.
        let hard = secs
            .saturating_add(grace_seconds(kill_grace))
            .saturating_add(1);
        out.push(RlimitSpec {
            resource: libc::RLIMIT_CPU,
            soft: secs,
            hard,
            name: "cpu",
        });
    }
    out
}

fn grace_seconds(grace: Duration) -> u64 {
    grace
        .as_millis()
        .div_ceil(1000)
        .try_into()
        .unwrap_or(u64::MAX)
}

/// A one-line description for the enforcement report.
pub(crate) fn describe(
    specs: &[RlimitSpec],
    limits: &ResolvedLimits,
    ctx: RlimitContext,
) -> String {
    let mut text = String::new();
    for spec in specs {
        if !text.is_empty() {
            text.push_str(", ");
        }
        match spec.name {
            "nproc" if ctx.baseline_tasks > 0 => {
                let _ = write!(
                    text,
                    "nproc={} ({} existing tasks + {})",
                    spec.soft,
                    ctx.baseline_tasks,
                    spec.soft.saturating_sub(ctx.baseline_tasks)
                );
            }
            "core" => text.push_str("core=0"),
            "cpu" => {
                let _ = write!(text, "cpu={}s", spec.soft);
            }
            name => {
                let _ = write!(text, "{name}={}", spec.soft);
            }
        }
    }
    if limits.memory_bytes.is_some() && !ctx.enforces_address_space {
        text.push_str(", memory NOT limited (RLIMIT_AS is not enforced on this OS)");
    }
    if limits.max_processes.is_some() && !ctx.enforces_process_count {
        text.push_str(", process count NOT limited (uid 0 is exempt from RLIMIT_NPROC; run hx as an ordinary user to get it)");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(baseline: u64) -> RlimitContext {
        RlimitContext {
            baseline_tasks: baseline,
            enforces_address_space: true,
            enforces_process_count: true,
        }
    }

    fn find(specs: &[RlimitSpec], name: &str) -> Option<RlimitSpec> {
        specs.iter().copied().find(|s| s.name == name)
    }

    #[test]
    fn defaults_set_every_limit_and_disable_core() {
        let limits = ResolvedLimits {
            memory_bytes: Some(4 << 30),
            max_processes: Some(512),
            max_file_bytes: Some(1 << 30),
            cpu_seconds: Some(120),
        };
        let specs = plan(&limits, Duration::from_secs(2), ctx(1000));
        assert_eq!(find(&specs, "core").unwrap().soft, 0);
        assert_eq!(find(&specs, "as").unwrap().soft, 4 << 30);
        assert_eq!(
            find(&specs, "nproc").unwrap().soft,
            1512,
            "baseline plus the allowance"
        );
        assert_eq!(find(&specs, "fsize").unwrap().hard, 1 << 30);
        let cpu = find(&specs, "cpu").unwrap();
        assert_eq!(
            (cpu.soft, cpu.hard),
            (120, 123),
            "hard limit is soft + grace + 1"
        );
    }

    #[test]
    fn unlimited_still_disables_core_dumps() {
        let specs = plan(&ResolvedLimits::default(), Duration::ZERO, ctx(0));
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].name, "core");
    }

    #[test]
    fn macos_style_contexts_skip_the_address_space_and_say_so() {
        let limits = ResolvedLimits {
            memory_bytes: Some(1 << 30),
            ..ResolvedLimits::default()
        };
        let c = RlimitContext {
            baseline_tasks: 0,
            enforces_address_space: false,
            enforces_process_count: true,
        };
        let specs = plan(&limits, Duration::ZERO, c);
        assert!(find(&specs, "as").is_none());
        assert!(describe(&specs, &limits, c).contains("memory NOT limited"));
    }

    #[test]
    fn root_is_told_its_process_limit_does_not_bind() {
        let limits = ResolvedLimits {
            max_processes: Some(10),
            ..ResolvedLimits::default()
        };
        let c = RlimitContext {
            baseline_tasks: 0,
            enforces_address_space: true,
            enforces_process_count: false,
        };
        let text = describe(&plan(&limits, Duration::ZERO, c), &limits, c);
        assert!(
            text.contains("process count NOT limited (uid 0 is exempt"),
            "{text}"
        );
    }

    #[test]
    fn the_description_names_what_was_set() {
        let limits = ResolvedLimits {
            max_processes: Some(10),
            cpu_seconds: Some(5),
            ..ResolvedLimits::default()
        };
        let specs = plan(&limits, Duration::ZERO, ctx(100));
        let text = describe(&specs, &limits, ctx(100));
        assert!(
            text.contains("core=0")
                && text.contains("cpu=5s")
                && text.contains("nproc=110 (100 existing tasks + 10)"),
            "{text}"
        );
    }
}
