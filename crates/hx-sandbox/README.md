# hx-sandbox

The OS sandbox that hypotaxis uses to run its exec kernel and the project gate commands (tests, builds). It enforces, per child process:

| Dimension | What it means |
|---|---|
| **fs** | Paths in `ro_paths` are readable and executable, paths in `rw_paths` are also writable, everything else cannot be read, written, created, removed or renamed (where the platform can enforce reads) |
| **network** | Off, loopback only, or on. A host allowlist is not enforceable by any OS mechanism here; it fails closed, or with `degraded.network` becomes network off (see below) |
| **env** | The child sees an allowlist of names copied from the host plus an explicit `env_set`, never the host environment |
| **process** | A timeout, a per-stream output cap, resource limits (memory, process count, file size, CPU time, no core dumps), and killing the whole process tree on timeout, cancel and drop |

**It never silently runs unsandboxed.** If the platform cannot enforce a dimension that the policy asks for, the call fails with `hx.sandbox.unavailable`, unless the policy sets `degraded.<dimension>` explicitly. Then the run goes ahead and the report says `degraded`.

## Public API

```rust
use hx_sandbox::{run, spawn, capabilities, SandboxPolicy, NetworkPolicy, SpawnOptions};

let policy = SandboxPolicy::new("/work")
    .with_ro(SandboxPolicy::system_read_paths().into_iter().chain(["/work".into()]))
    .with_rw(["/scratch"])
    .with_network(NetworkPolicy::Off);

let result = run(&["pytest".into(), "-q".into()], &policy).await?; // RunResult
let kernel = spawn(&argv, &policy, SpawnOptions::new().with_inherit(socket_fd)).await?; // Handle
let caps = capabilities(); // what this host can enforce, for hx.describe
```

| Item | What |
|---|---|
| `SandboxPolicy` | `ro_paths`, `rw_paths`, `network: Off \| Loopback \| Allowlist(hosts) \| On`, `env_allowlist`, `env_set`, `cwd`, `timeout_ms`, `output_cap_bytes`, `kill_grace_ms`, `resources`, `degraded` |
| `run(argv, &policy) -> Result<RunResult>` | `RunResult { exit: Exited{code} \| Signaled{signal} \| TimedOut \| SpawnFailed{reason}, stdout, stderr (text, truncated, total_bytes), duration_ms, enforcement }` |
| `spawn(argv, &policy, SpawnOptions) -> Result<Handle>` | A long-lived child: `take_stdin/stdout/stderr`, `kill()`, `wait()`, `pid()`, `enforcement()`, capped streams, a lifetime watchdog, kill-on-drop. `SpawnOptions::with_inherit` passes one socket, pipe or handle under its own number |
| `capabilities() -> Capabilities` | Live probes: per dimension and mode, available or not, mechanism, versions, reason |
| `Enforcement` | Per dimension (`fs`, `network`, `env`, `process`): `status: enforced \| degraded \| unrestricted`, `mechanisms[]`, `detail` |
| `SandboxPolicy::resolve()` | Canonicalises and validates; `ResolvedPolicy::ensure_rw_within(roots)` proves that writable grants cannot resolve outside given roots |
| `wire::{SandboxRunParams, SandboxRunResult, json_schemas()}` | The `sandbox.run` method types (serde + schemars) |
| `Error` | `Unavailable` (`hx.sandbox.unavailable`), `InvalidPolicy`, `Setup` and `Io` (`hx.sandbox.denied`), `Spawn` (`hx.sandbox.spawn_failed`). `Error::code()` and `Error::data()` feed the dispatcher |

A tool outcome (the command failed, timed out, was not found, was killed) is a successful `run`. An infrastructure failure (the sandbox cannot be built or held) is an `Err`. `docs/STANDARDS.md` section 3 draws the same line.

## Threat model

**Defended.** Code that runs inside the sandbox is untrusted: agent-written kernel cells, and project test and build commands that a prompt-injected agent may have shaped. The sandbox keeps that code from

- writing to the workspace (only `ship` writes it) or anywhere outside the scratch directory;
- reading files outside the granted paths (home directory, `~/.ssh`, other projects, Hermes's `.env`);
- reading the host's environment (API keys), because the child gets an allowlist;
- using the network to exfiltrate or fetch, unless the policy turns it on;
- outliving its timeout or flooding memory with output;
- leaving a process tree behind after the run, and from inheriting descriptors the host forgot to close.

**Not defended.**

- Kernel, driver, Landlock, Seatbelt or AppContainer vulnerabilities.
- Disk usage beyond the per-file size limit (a scratch directory can be filled with many files), and anything the resource limits cannot express (see the table below).
- Anything the policy grants on purpose: the inherited channel, a granted `/proc`, `network: on`.
- A descendant that detaches from the process group (see the per-platform gaps).
- Covert channels, timing, and information the OS gives to every process (`stat` of unlisted paths, hardware details).

## Mechanisms per OS

### Linux (verified here, kernel 6.18)

No setuid helper and no bubblewrap. Every mechanism is a syscall the child makes on itself between `fork` and `exec`, from data the parent prepared, so a failure aborts the spawn and a child never reaches `exec` half-sandboxed.

| Dimension | Mechanism |
|---|---|
| fs | **Landlock** (ABI 3 or newer: earlier ABIs cannot stop `rename` out of or `truncate` in a read-only tree). Reads are handled too, so unlisted paths are unreadable. Grants are per path; read-only grants are `EXECUTE\|READ_FILE\|READ_DIR`. `/dev/null`, `zero`, `full`, `random`, `urandom` are always granted. ABI 6 adds scoping of abstract Unix sockets and signals to outside processes |
| network off | **seccomp**: `socket()` only for `AF_UNIX` with `SOCK_STREAM`, `socketpair()` for `AF_UNIX` with `SOCK_STREAM` or `SOCK_SEQPACKET` (`SOCK_NONBLOCK` and `SOCK_CLOEXEC` ignored); every other type is denied, `SOCK_DGRAM` and `SOCK_RAW` (which the kernel makes a datagram socket) included, because a datagram socket can `sendto` a host socket by path even when connected. A seqpacket pair is safe because `unix_seqpacket_sendmsg` zeroes the destination address, and it is needed because Rust's `Command::spawn` (so cargo, for every rustc) reports a child's exec status through one; `connect`/`bind`/`listen` denied (so no Unix socket can be reached by path) |
| network loopback | A private **network namespace** with only `lo` up (direct `unshare(CLONE_NEWNET)` as root, or through an unprivileged user namespace), plus seccomp limiting the socket families |
| network on | Nothing, except that `AF_VSOCK` is denied |
| process | one of three ways to end the whole tree, `setsid` escapees included, in this order: a **PID namespace** when one can be entered (directly as root, or through an unprivileged user namespace): the program is its init and a supervisor mirrors its exit status, so when the program exits or the tree is killed the kernel kills every descendant; else a **cgroup v2 subtree per run** where this user can create one (a systemd user manager's delegated cgroup, or the cgroup the process is in): the program moves itself in first, every descendant inherits it and the kill writes `cgroup.kill`; else a **child subreaper** supervisor: it becomes `PR_SET_CHILD_SUBREAPER`, forks the program, and when the program exits or the kill is requested it kills every process it parents, repeatedly, until none is left. The report names the one in use (`pid-namespace`, `cgroup-kill`, `subreaper`), and a host with none of them does not claim `sandbox.process_tree_kill` and refuses to run unless the policy allows `degraded.process`; `setsid` (own session and group, `killpg` for the polite stop), **rlimits** (`RLIMIT_AS` 4 GiB, `RLIMIT_NPROC` 512 more than the user already has, `RLIMIT_FSIZE` 1 GiB, `RLIMIT_CPU` tied to the timeout, `RLIMIT_CORE` 0), `no_new_privs`, empty capability sets and bounding set, a seccomp deny list (`ptrace`, `process_vm_*`, `pidfd_getfd`, `kcmp`, `open_by_handle_at`, `io_uring`, `bpf`, `mount` and the new mount API, `kexec`, keyrings, module loading, `userfaultfd`, `perf_event_open`; every x32 syscall; `unshare`, `setns` and `clone` with any `CLONE_NEW*` flag, so the program cannot create a namespace of its own; `clone3` answers `ENOSYS` so libc falls back to `clone`, whose flags the filter can read), every descriptor above 2 marked close-on-exec before the program starts |

Landlock and seccomp are **probed at runtime**, not inferred from a version: a forked child restricts itself and has to be denied. `capabilities()` reports the result. On this container: Landlock ABI 7, seccomp, and network namespaces (root, `CAP_SYS_ADMIN`). The same tests also pass as an unprivileged user (`setpriv --reuid=65534 --regid=65534 --clear-groups <test binary>`), where loopback goes through a user namespace.

### macOS (compiles for both Apple targets; **never run**)

A **Seatbelt** profile is generated from the policy and applied with `/usr/bin/sandbox-exec -p` (absolute path, never `PATH`). The profile is deny-by-default, adapted from Codex's base and platform-default policies (see `NOTICE`). Each path is a `-D` parameter referenced as `(param "RO_0")`, so a hostile path cannot inject rules. Read-only grants allow `file-read*` and `file-map-executable`; read-write grants add `file-write*`. Network: nothing for off, `localhost:*` for loopback, `(allow network*)` for on. Process: `setsid` plus `killpg`, and rlimits (`RLIMIT_NPROC`, `RLIMIT_FSIZE`, `RLIMIT_CPU`, `RLIMIT_CORE`; macOS ignores `RLIMIT_AS`, so the memory limit is reported as not enforced). Profile generation is unit-tested as text on every platform.

### Windows (compiles for `x86_64-pc-windows-msvc`; **never run**)

An **AppContainer** per run. A fresh random profile name gives a SID, and the child is created with that SID through `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`.

| Dimension | Mechanism |
|---|---|
| fs | The container SID is the confinement: access checks must pass for it as well as for the user. Each `ro` path gets a read-execute ACE and each `rw` path a modify ACE (never `WRITE_DAC` or `WRITE_OWNER`), inheritable for directories, revoked and the profile deleted when the run ends |
| network | No capability SIDs means no network, and no loopback. `on` grants `internetClient`, `internetClientServer`, `privateNetworkClientServer`. `loopback` adds the container to the machine-wide loopback exemption list, which needs an **elevated** process, so it is `unavailable` otherwise |
| process | A **job object** with `KILL_ON_JOB_CLOSE`, job limits (total memory, active-process count, job user-mode CPU time; there is no file-size limit) and UI restrictions (clipboard, desktop, display settings, global atoms, handles). The process is created suspended and resumed only after it is inside the job. Dropping the handle closes the job, which kills the tree |
| env | An explicit environment block |
| args | `CommandLineToArgvW`-safe quoting, property-tested against a reference parser. `.bat` and `.cmd` are not run (cmd.exe quoting is an injection hazard) |

**Why AppContainer and not Codex's design.** Codex's Windows sandbox runs commands as dedicated local users with a write-restricted token, ACLs and firewall rules, behind an elevated one-time setup. That design stops writes, not reads, and needs administrator rights to install. An AppContainer needs no setup, denies reads outside the granted paths by construction, and has network off by default, which is the dimension the brief asks for. The cost is that AppContainer is less forgiving: tools that expect a user profile, named pipes or COM may not work inside it.

**Restricted token.** The AppContainer token is itself a restricted low-box token (low integrity, no privileges beyond bypass-traverse). It is not layered with a `CreateRestrictedToken` token: that combination needs `CreateProcessAsUser` plus an undocumented low-box token path, and cannot be tested here. Where an AppContainer is not usable, Codex's write-restricted token is the fallback to build.

## What is and is not enforced

| | Linux | macOS | Windows |
|---|---|---|---|
| read outside grants | denied | denied | denied, **except** system locations that grant ALL APPLICATION PACKAGES (Windows directory, Program Files) |
| write in a read-only path | denied | denied | denied |
| `stat`/`readlink` of unlisted paths | allowed (Landlock does not hide it) | allowed (`file-read-metadata`) | denied, apart from the system locations |
| network off | seccomp, verified | profile, untested | capability-less container, untested |
| loopback | namespace, verified | profile, untested | needs elevation, untested |
| host allowlist | **unavailable** | **unavailable** | **unavailable** |
| kill the tree | PID namespace, cgroup or subreaper (whichever the host has), verified | group | job object |
| a descendant that escapes the kill | not possible with a PID namespace or a cgroup; with the subreaper only if the program kills its supervisor first (Landlock ABI 6 scopes that signal out); possible (`setsid`, `setpgid`) on a host with none of the three, which says so and refuses unless `degraded.process` | possible | not possible (job) |
| polite stop before the kill | `SIGTERM` | `SIGTERM` | none (grace period skipped) |
| memory limit | `RLIMIT_AS`, verified | not enforced by the OS | job memory, untested |
| process-count limit | `RLIMIT_NPROC`, verified as an ordinary user; **uid 0 is exempt** (the report says so) | `RLIMIT_NPROC`, same exemption | job active-process limit, untested |
| file-size limit | `RLIMIT_FSIZE`, verified | `RLIMIT_FSIZE`, untested | none |
| CPU limit | `RLIMIT_CPU` (SIGXCPU), verified | `RLIMIT_CPU`, untested | job user time, untested |

### Policy semantics worth knowing

- Paths must be absolute and exist. They are **canonicalised once** (symlinks resolved), and the grant lands on the resolved target. `ResolvedPolicy` keeps both spellings. A symlink *inside* a granted tree never widens the grant: Landlock, Seatbelt and ACLs all follow the real hierarchy (tested: writing through a link in scratch that points at the workspace fails).
- A path in both lists is writable. A `ro` path **inside** an `rw` tree is rejected: no backend can subtract a grant (Landlock and Seatbelt allow rules are additive). A `rw` path inside a `ro` tree is fine, which is the usual layout (workspace read-only, `target/` writable).
- `rw` cannot be the file system root. `cwd` must lie inside a grant.
- `ro_paths` has to include what the program itself needs. `SandboxPolicy::system_read_paths()` gives a conservative list of system directories (it never includes `/etc` as a whole or `/proc`). `/proc` is deliberately not granted: it exposes the environment of every same-user process, including `hx`.
- `network: allowlist` with only loopback names becomes `loopback`. Any other host list is `unavailable`. With `degraded.network` the run goes ahead with **network off**, and the report says `status: degraded` with the detail `network: off (allowlist of N host(s) unavailable: ...)`. Loopback that the host cannot provide (no namespace, no elevation) degrades the same way. Only if even network off cannot be held (no seccomp) does a degraded run get an unrestricted network, and the report says that too.
- Resource limits are policy defaults and all overridable: `resources.memory_bytes` 4 GiB, `max_processes` 512, `max_file_bytes` 1 GiB, `cpu` tied to the timeout (`CpuLimit::Seconds(n)` or `Unlimited` to change it), core dumps always off. `None` means no limit. On Linux the process allowance is counted **on top of** the tasks the user already has, because `RLIMIT_NPROC` is a per-user total; inside a fresh user namespace it counts from zero. Sending `0` over the wire turns a limit off.
- The program is found in the child's own `PATH` (absolute entries only), never the host's. Missing or not executable is `SpawnFailed`, with a hint when the program lies outside the grants.
- The inherited socket, pipe or handle bypasses the file system and network confinement by design. The child sees it under the same number it has in the host.
- Output over the cap is read and dropped so the child never blocks on a full pipe. The text is decoded as UTF-8 with replacement characters, so a cut in the middle of a character shows as one.

## Known gaps

1. **Process escape from the kill.** Without a PID namespace the kill goes through a per-run cgroup or a subreaper supervisor, and the report names which (`pid-namespace`, `cgroup-kill` or `subreaper` in `process.mechanisms`). Two limits remain. A subreaper supervisor is an ordinary process of the same user: a program that kills it before it forks its escapees leaves them to `init`; Landlock ABI 6 scopes signals to the sandbox, which closes that, and the report says whether it is in force. A cgroup run without Landlock (a degraded filesystem) could move itself out by writing another `cgroup.procs`. A host with none of the three (no PID namespace, no writable delegated cgroup, no subreaper) kills only the process group, so a descendant that calls `setsid` or `setpgid` outlives a kill: `sandbox.process_tree_kill` is not advertised, the run is `unavailable` for the process dimension, and with `degraded.process` it goes ahead with `status: degraded` and `NOT ENFORCED` in the detail. macOS has the process-group kill only: it does not advertise `sandbox.process_tree_kill`, and its report says a descendant can outlive a kill (the macOS run is not refused for this; that is a known gap there, untested on a Mac). With a PID namespace the program is init and the kernel reaps everything when it ends (tested with a `setsid` grandchild). One side effect: init ignores `SIGTERM` unless it installs a handler, so the polite stop is effectively cut short.
2. **Pathname Unix sockets with the network on.** Landlock before ABI 9 does not mediate `connect` to a Unix socket path, so `network: on` or `loopback` on Linux can reach `docker.sock`-style sockets that file permissions allow. With the network off, `connect` is denied by seccomp.
3. **Resource limits are rlimits, not cgroups.** `RLIMIT_AS` limits address space, not resident memory, and some runtimes (Go, a JVM, Node) reserve a lot of address space, so 4 GiB can be too small for them: raise it per call. uid 0 is exempt from `RLIMIT_NPROC`; run `hx` as an ordinary user to get the process cap (the test for it skips under root and the report says why). macOS does not enforce `RLIMIT_AS`. Windows has no file-size limit and counts active processes, not threads.
4. **PID reuse window.** After the leader is reaped, the group is signalled once. A recycled pid that is also a group leader within microseconds would be hit. Linux allocates pids sequentially, so this is theoretical.
5. **Canonicalise-then-open race.** A grant is made on a path that was canonicalised a few milliseconds earlier. The last component is opened with `O_NOFOLLOW` and its kind is re-checked; swapping a parent directory in between is not prevented. The host owns the paths it grants.
6. **Windows ACL cost and leftovers.** Granting an inheritable ACE on a large tree makes Windows rewrite every child's ACL. After a crash, entries for a dead random SID stay behind (harmless, nothing can be that SID) and so does the profile directory.
7. **Seatbelt is deprecated** by Apple but works, and it does not nest: inside another sandbox `capabilities()` reports it unavailable.

## Design note: a real host allowlist

No OS here filters by host name, so a real allowlist is a host-side service, not a sandbox flag. The plan is a CONNECT proxy that `hx` runs on the host, reachable from a loopback-only namespace:

1. The child runs with `network: loopback` (Linux: a private network namespace with only `lo`; the proxy's listener is bridged in through an inherited socket or a Unix socket path that the sandbox grants).
2. The child's environment gets `HTTPS_PROXY`/`HTTP_PROXY` (and `ALL_PROXY`) pointing at that loopback endpoint.
3. The proxy accepts `CONNECT host:port`, checks the host against the policy's allowlist (after resolving it itself, so DNS tricks and IP literals cannot skip the check), and relays bytes. Everything else is refused and logged.
4. A new host is an approval (STANDARDS section 5), decided by the plugin's policy, not by the child.

Programs that ignore proxy variables fail closed, because the namespace has no route out. Until this exists, `Allowlist` is `unavailable`, or network off when degraded.

## Mechanism summaries (for ADR-0017)

**Linux.** The child confines itself, between `fork` and `exec`, from data the parent prepared, so a failing step aborts the spawn and a child never runs half-sandboxed. Landlock (ABI 3 or newer, verified by a forked probe, not by version) denies every filesystem access outside the `ro`/`rw` grants, reads included. A seccomp program closes the network (inet sockets, Unix socket paths, datagram sockets) and denies a list of escape syscalls; loopback instead puts the child in a private network namespace with only `lo`. The tree is ended by a PID namespace when one can be entered (the program is init, with a supervisor that mirrors its exit status), else by a cgroup v2 subtree per run and `cgroup.kill`, else by a child-subreaper supervisor, so no descendant outlives it, and the report says which. `setsid`/`killpg`, `no_new_privs`, empty capabilities and bounding set, rlimits, and close-on-exec for every inherited descriptor complete it. There is no setuid helper and no bubblewrap.

**macOS.** A Seatbelt profile (deny by default, adapted from Codex's base, platform and network policies) is generated as pure text from the resolved policy and applied by `/usr/bin/sandbox-exec -p`. Every path is a `-D` parameter, never profile text, so a hostile path cannot add rules. Read-only grants allow read and map-executable, read-write grants add write, and the network is nothing, `localhost:*`, or everything. Process control is `setsid`/`killpg` plus rlimits. Seatbelt is deprecated by Apple but works, and it does not nest, which `capabilities()` detects.

**Windows.** Each run creates a throwaway AppContainer profile with a random name; its SID is the confinement. The policy's paths become ACL entries for that SID (read-execute or modify, never `WRITE_DAC`), the network is the absence of capability SIDs (loopback needs an elevated process to edit the exemption list), and the child is created suspended through `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` with an explicit environment block and an exact handle list, then resumed only after it is inside a kill-on-close job object that carries memory, process-count and CPU-time limits. Entries and profile are removed when the run ends. This replaces Codex's dedicated-user design: no elevated setup, and reads are actually blocked.

## Deviations from the architecture document

`docs/ARCHITECTURE.md` section 7 lists "bubblewrap, Landlock and seccomp" for Linux. This crate uses Landlock and seccomp only: bubblewrap needs unprivileged user namespaces or a setuid binary, the brief forbids setuid helpers, and Landlock gives the read-only and read-denied semantics without a mount namespace. A bubblewrap path could be added later for hosts with an old Landlock ABI; it would be one more backend behind `prepare`. This is worth an ADR.

## Tests

```sh
cargo test -p hx-sandbox                       # builds the probe example too
cargo test --workspace                         # includes the hx integration (sandbox.* over the dispatcher and the binary)
cargo test -p hx-sandbox --test macos          # on a Mac
cargo test -p hx-sandbox --test windows        # on Windows; add -- --ignored from an elevated shell
setpriv --reuid=65534 --regid=65534 --clear-groups target/debug/deps/linux-<hash>   # unprivileged Linux run
cargo check --target aarch64-apple-darwin --all-targets
cargo check --target x86_64-pc-windows-msvc --all-targets
```

- **Unit tests** next to the code: policy and normalisation (with property tests that every resolved path is canonical, absolute and symlink-free, that resolving is idempotent, and that a symlink never widens a grant), the Linux plan with synthetic probes, Landlock access masks, seccomp compilation and behaviour (the compiled programs are run through a small BPF interpreter for every socket type and flag, every `CLONE_NEW*` flag, every x32 number and each denied syscall), the cgroup and subreaper mechanisms forced one by one on a copy of the probe (a `setsid` grandchild killed, orphans swept, the polite stop sparing the supervisor, the cgroup removed afterwards), the channel directory checks and peer vetting, runtime-root vetting, Seatbelt profile text, Windows translation (including the argument-quoting round trip).
- **Linux integration tests** (`tests/linux.rs`) run real processes. The `probe` example runs *inside* the sandbox and reports what it could do, so each assertion is made by the child. They cover: ro write denied and rw allowed, rename, remove and truncate denied in a read-only tree, reads outside the grants denied, symlinks not widening grants, network off blocking TCP, UDP and Unix socket paths (with a control showing `on` connects), the loopback namespace being private, environment filtering, timeout killing a three-level process tree (judged by heartbeat files, since pids mean nothing across a PID namespace), a grandchild that calls `setsid` dying on timeout, on the leader's exit and on `kill` (whichever tree mechanism the host has, which the report and the capabilities must name), a `SIGTERM`-ignoring process, background processes, cancellation by drop, resource limits (a fork bomb capped and a control not, an oversized write failing, a memory limit stopping a large allocation, a CPU limit ending a spinner, the report matching `/proc/self/limits` from inside), a degraded allowlist being network off, output cap, `SpawnFailed`, the report matching `/proc/self/status` from inside, denied syscalls, only `AF_UNIX` stream sockets with the network off (every other type denied for `socket` and `socketpair`, with a control showing they exist with the network on, and the datagram proof of concept unable to reach a host socket, a seqpacket pair dropping a `sendto` path, and a sandboxed Rust program spawning a child), namespaces (`unshare`, `setns`, `clone` with `CLONE_NEW*`, `clone3` as `ENOSYS`, threads still starting), the rest of the denied syscalls and x32, descriptor hygiene, and `spawn` with streams, an inherited socket and a watchdog. Mutating the implementation (dropping Landlock, dropping seccomp, skipping the close-on-exec step, turning the PID namespace off) makes the matching tests fail. `tests/handler.rs` drives `sandbox.run`, `sandbox.spawn`, `sandbox.wait` and `sandbox.kill` through the real `hx-proto` dispatcher, including the private channel working with the network off.
- The process-count test skips, loudly, under uid 0 (exempt from `RLIMIT_NPROC`); run the test binary as an ordinary user to exercise it.
- Tests that need Landlock skip, loudly, when the host lacks it. Nothing needs more privilege than this container has; `loopback` falls back to a user namespace when `CAP_SYS_ADMIN` is missing. The Windows elevated test is `#[ignore]`.

## Status of verification

| | Verified by running | Compile-checked only |
|---|---|---|
| Linux x86_64, root and unprivileged | everything above | |
| Linux aarch64 | | the whole crate (`aarch64-unknown-linux-gnu`, clippy clean); the seccomp tables are built from `libc::SYS_*` constants that exist on both architectures |
| macOS | profile text | the backend and its tests (`aarch64-apple-darwin`, `x86_64-apple-darwin`) |
| Windows | argument quoting, environment block, ACL masks, capability SIDs | the whole backend and its tests (`x86_64-pc-windows-msvc`) |

A real Mac and a real Windows machine must confirm at least: that the generated profile lets a stock Python and a stock `cargo` start; that ACL propagation and revocation behave on a real tree; that `CreateProcessW` accepts the attribute combination; that an AppContainer can run the interpreters the kernel needs; the loopback exemption path; and the time cost of granting a large workspace.
