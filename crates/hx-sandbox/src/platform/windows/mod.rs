//! Windows: an `AppContainer` (low-box token, per-run SID) for the confinement, ACL entries for the
//! read and write paths, capability SIDs for the network, and a job object for the process tree.
//!
//! Why not Codex's design: Codex's Windows sandbox uses dedicated local users, a write-restricted
//! token, ACLs and firewall rules, which needs an elevated one-time setup and cannot stop reads.
//! An `AppContainer` needs no setup, denies reads outside the granted paths (apart from the
//! system locations that grant ALL APPLICATION PACKAGES), and has network off by default.
//!
//! **Compiled for `x86_64-pc-windows-msvc`, never run on Windows by the author.** The README
//! lists what a real machine must confirm. The pure translation (command line, environment
//! block, ACL masks, capabilities) lives in [`crate::winpolicy`] and is tested everywhere.

mod container;
mod launch;
mod loopback;
mod streams;
mod sys;

use std::io;
use std::os::windows::io::OwnedHandle;
use std::sync::{Arc, OnceLock};

use super::{BoxRead, BoxWrite, Launch, LaunchSpec, StdinMode, Streams};
use crate::capabilities::{Capabilities, Capability};
use crate::error::{Dimension, Error, Result};
use crate::normalize::ResolvedPolicy;
use crate::policy::NetworkPolicy;
use crate::report::{DimensionReport, Enforcement, ExitOutcome};
use crate::winpolicy::{self, NetworkPlan};
use container::Container;
use launch::StartError;

/// Ends a whole process tree: the job object, or the single process when no job could be used.
#[derive(Clone)]
pub(crate) struct TreeKiller {
    job: Option<Arc<OwnedHandle>>,
    process: Arc<OwnedHandle>,
}

impl TreeKiller {
    /// Windows has no polite stop for a process without a console or window, so nothing is sent
    /// and the caller kills straight away.
    #[allow(
        clippy::unused_self,
        reason = "keeps the signature the same as the other backends"
    )]
    pub(crate) fn terminate(&self) -> bool {
        false
    }

    /// Terminates every process in the job.
    pub(crate) fn kill(&self) {
        match &self.job {
            Some(job) => launch::terminate_job(job),
            None => launch::terminate_process(&self.process),
        }
    }
}

/// A running child. Dropping it revokes the ACL entries and deletes the `AppContainer` profile.
pub(crate) struct Child {
    process: Arc<OwnedHandle>,
    pid: u32,
    killer: TreeKiller,
    streams: Option<Streams>,
    exit: Option<ExitOutcome>,
    // Declared last so it is dropped after the handles above are closed.
    _container: Container,
    _loopback: Option<loopback::Exemption>,
}

impl Child {
    pub(crate) fn pid(&self) -> u32 {
        self.pid
    }

    pub(crate) fn killer(&self) -> TreeKiller {
        self.killer.clone()
    }

    pub(crate) fn take_streams(&mut self) -> Streams {
        self.streams.take().unwrap_or_else(|| Streams {
            stdin: None,
            stdout: Box::new(tokio::io::empty()),
            stderr: Box::new(tokio::io::empty()),
        })
    }

    /// Waits for the leader to exit. Windows has no signals: an exit code is all there is, and
    /// a killed tree reports code 1.
    pub(crate) async fn wait(&mut self) -> io::Result<ExitOutcome> {
        if let Some(done) = &self.exit {
            return Ok(done.clone());
        }
        let process = self.process.clone();
        let code = tokio::task::spawn_blocking(move || sys::wait_for_exit(&process))
            .await
            .map_err(io::Error::other)??;
        let outcome = ExitOutcome::Exited {
            code: i32::from_ne_bytes(code.to_ne_bytes()),
        };
        self.exit = Some(outcome.clone());
        Ok(outcome)
    }
}

/// A policy with its container built and its paths granted.
pub(crate) struct Prepared {
    enforcement: Enforcement,
    policy: ResolvedPolicy,
    container: Container,
    loopback: Option<loopback::Exemption>,
    job: Option<OwnedHandle>,
}

fn degraded_network(requested: &str, why: &str) -> DimensionReport {
    DimensionReport::degraded(
        &["appcontainer"],
        format!(
            "network: off ({requested} unavailable: {why}); the container gets no network capabilities"
        ),
    )
}

/// Creates the job object and the process-dimension report.
fn job_and_report(policy: &ResolvedPolicy) -> Result<(Option<OwnedHandle>, DimensionReport)> {
    Ok(match launch::create_job(&policy.resources) {
        Ok(job) => (
            Some(job),
            DimensionReport::enforced(
                &["job-object", "job-limits", "timeout", "output-cap"],
                format!(
                    "kill-on-close job object: ending the job (timeout, cancel, drop) ends every process in the tree, and a child cannot leave it; UI restrictions block clipboard, desktop and display changes; the AppContainer token is already low-integrity with no privileges. No polite stop exists, so the grace period is skipped; job limits: {}",
                    job_limits_text(&policy.resources)
                ),
            ),
        ),
        Err(e) if policy.degraded.process => (
            None,
            DimensionReport::degraded(
                &["timeout", "output-cap"],
                format!("no job object ({e}); only the leader process is terminated on timeout"),
            ),
        ),
        Err(e) => {
            return Err(Error::unavailable(
                Dimension::Process,
                format!("job object cannot be created: {e}"),
            ));
        }
    })
}

/// Builds the container and grants the paths, or fails with `Unavailable`.
pub(crate) fn prepare(policy: &ResolvedPolicy) -> Result<Prepared> {
    let mut effective = policy.clone();
    let mut network_report: Option<DimensionReport> = None;

    let mut plan: NetworkPlan = match winpolicy::network_plan(&policy.network) {
        Ok(plan) => plan,
        Err(why) if policy.degraded.network => {
            effective.network = NetworkPolicy::Off;
            network_report = Some(degraded_network("allowlist", why));
            winpolicy::network_plan(&NetworkPolicy::Off)
                .map_err(|e| Error::unavailable(Dimension::Network, e))?
        }
        Err(why) => return Err(Error::unavailable(Dimension::Network, why)),
    };
    if plan.loopback_exempt && !loopback::is_elevated() {
        let why = "the loopback exemption list can only be edited by an elevated process";
        if !policy.degraded.network {
            return Err(Error::unavailable(Dimension::Network, why));
        }
        effective.network = NetworkPolicy::Off;
        network_report = Some(degraded_network("loopback", why));
        plan = winpolicy::network_plan(&NetworkPolicy::Off)
            .map_err(|e| Error::unavailable(Dimension::Network, e))?;
    }

    let mut random = [0u8; 16];
    getrandom(&mut random);
    let mut container =
        Container::create(&winpolicy::container_name(random), &plan).map_err(|e| {
            Error::unavailable(
                Dimension::Fs,
                format!("AppContainer cannot be created: {e}"),
            )
        })?;
    for grant in winpolicy::acl_grants(&effective) {
        container.grant(&grant).map_err(|source| Error::Setup {
            step: "grant path access".to_owned(),
            source,
        })?;
    }
    let loopback = if plan.loopback_exempt {
        Some(
            container
                .with_sid(loopback::Exemption::add)
                .map_err(|source| Error::Setup {
                    step: "loopback exemption".to_owned(),
                    source,
                })?,
        )
    } else {
        None
    };

    let (job, process_report) = job_and_report(policy)?;

    let enforcement = Enforcement {
        platform: "windows".to_owned(),
        fs: DimensionReport::enforced(
            &["appcontainer", "acl"],
            format!(
                "a per-run AppContainer SID holds {} read-execute and {} modify entries; access checks must pass for it as well as for the user, so other paths are unreadable except the system locations that grant ALL APPLICATION PACKAGES (the Windows directory, Program Files). The entry never includes WRITE_DAC, so the child cannot widen it",
                policy.ro.len(),
                policy.rw.len()
            ),
        ),
        network: network_report.unwrap_or_else(|| match effective.network {
            NetworkPolicy::Off => DimensionReport::enforced(&["appcontainer"], "no network capability SIDs: the container has no outbound, inbound or loopback network"),
            NetworkPolicy::Loopback => DimensionReport::enforced(&["appcontainer", "loopback-exemption"], "no network capabilities, plus a loopback exemption for this container's SID"),
            _ => DimensionReport::unrestricted("network unrestricted by request: internetClient, internetClientServer and privateNetworkClientServer capabilities"),
        }),
        env: DimensionReport::enforced(
            &["env-block"],
            format!("the child gets an explicit environment block of exactly {} variable(s)", policy.env.len()),
        ),
        process: process_report,
    };
    Ok(Prepared {
        enforcement,
        policy: effective,
        container,
        loopback,
        job,
    })
}

/// The job limits as the report states them. Windows has no file-size limit, and the process
/// limit counts active processes, not threads.
fn job_limits_text(r: &crate::normalize::ResolvedLimits) -> String {
    let show =
        |v: Option<u64>, unit: &str| v.map_or_else(|| "none".to_owned(), |n| format!("{n}{unit}"));
    format!(
        "memory={} (job total), processes={} (active processes), cpu={} (job user time, then the job is terminated), file size NOT limited (Windows has no equivalent)",
        show(r.memory_bytes, " bytes"),
        show(r.max_processes, ""),
        show(r.cpu_seconds, "s"),
    )
}

fn getrandom(buf: &mut [u8; 16]) {
    // The name only has to be unique, not secret; a v4-style mix of time and a counter would do,
    // but the OS generator is the simplest correct source.
    use std::hash::{BuildHasher, Hasher};
    let state = std::collections::hash_map::RandomState::new();
    for chunk in buf.chunks_mut(8) {
        let mut hasher = state.build_hasher();
        hasher.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos()),
        );
        let bytes = hasher.finish().to_le_bytes();
        chunk.copy_from_slice(&bytes[..chunk.len()]);
    }
}

impl Prepared {
    /// The report for the child this will start.
    pub(crate) fn enforcement(&self) -> &Enforcement {
        &self.enforcement
    }

    /// Starts the program inside the container and job.
    pub(crate) fn spawn(mut self, spec: LaunchSpec<'_>) -> Result<Launch> {
        let program = spec.program.to_string_lossy().into_owned();
        let line = winpolicy::command_line(&program, spec.args)
            .map_err(|e| Error::invalid(format!("invalid argument: {e}")))?;
        let mut command_line: Vec<u16> = line.encode_utf16().collect();
        command_line.push(0);
        let program_w = sys::wide(spec.program.as_os_str());
        let cwd_w = sys::wide(self.policy.cwd.as_os_str());
        let env_block = winpolicy::env_block(&self.policy.env);
        let capabilities = self.container.security_capabilities();

        let request = launch::Request {
            program: &program_w,
            command_line,
            cwd: &cwd_w,
            env_block: &env_block,
            capabilities,
            job: self.job.as_ref(),
            piped_stdin: spec.stdin == StdinMode::Piped,
            inherit: spec.inherit,
        };
        match launch::start(request) {
            Ok(started) => {
                let process = Arc::new(started.process);
                let job = if started.in_job {
                    self.job.take().map(Arc::new)
                } else {
                    None
                };
                let killer = TreeKiller {
                    job,
                    process: process.clone(),
                };
                let stdin: Option<BoxWrite> = started.pipes.stdin.map(streams::writer);
                let stdout: BoxRead = streams::reader(started.pipes.stdout);
                let stderr: BoxRead = streams::reader(started.pipes.stderr);
                Ok(Launch::Started(Child {
                    process,
                    pid: started.pid,
                    killer,
                    streams: Some(Streams {
                        stdin,
                        stdout,
                        stderr,
                    }),
                    exit: None,
                    _container: self.container,
                    _loopback: self.loopback,
                }))
            }
            Err(StartError::Program(e)) => Ok(Launch::Failed(e.to_string())),
            Err(StartError::Setup { step, source }) => Err(Error::Setup {
                step: step.to_owned(),
                source,
            }),
        }
    }
}

/// Whether an `AppContainer` can be created here (Windows 8 or newer), probed once.
fn container_works() -> &'static std::result::Result<(), String> {
    static WORKS: OnceLock<std::result::Result<(), String>> = OnceLock::new();
    WORKS.get_or_init(|| {
        let mut random = [0u8; 16];
        getrandom(&mut random);
        let plan = NetworkPlan {
            capabilities: vec![],
            loopback_exempt: false,
        };
        Container::create(&winpolicy::container_name(random), &plan)
            .map(drop)
            .map_err(|e| e.to_string())
    })
}

/// What this host can enforce.
pub(crate) fn capabilities() -> Capabilities {
    let works = container_works();
    let (fs, off) = match works {
        Ok(()) => (
            Capability::yes(
                "appcontainer",
                "an AppContainer profile was created and deleted; paths are granted by ACL",
            ),
            Capability::yes(
                "appcontainer",
                "an AppContainer without network capabilities has no network",
            ),
        ),
        Err(why) => (
            Capability::no(Some("appcontainer"), why.clone()),
            Capability::no(Some("appcontainer"), why.clone()),
        ),
    };
    let loopback = if works.is_ok() && loopback::is_elevated() {
        Capability::yes(
            "appcontainer",
            "elevated: the loopback exemption list can be edited",
        )
    } else {
        Capability::no(
            Some("appcontainer"),
            "needs an elevated process to edit the machine-wide loopback exemption list",
        )
    };
    Capabilities {
        platform: "windows".to_owned(),
        os_version: None,
        fs,
        network_off: off,
        network_loopback: loopback,
        network_allowlist: Capability::no(
            None,
            "no per-host filter for an AppContainer; needs an egress proxy",
        ),
        process_tree_kill: Capability::yes(
            "job-object",
            "kill-on-close job; no polite stop is available",
        ),
        inherited_handle: Capability::yes(
            "handle-list",
            "one handle keeps its value in the child through PROC_THREAD_ATTRIBUTE_HANDLE_LIST",
        ),
    }
}
