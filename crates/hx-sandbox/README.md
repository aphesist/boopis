# hx-sandbox

The OS sandbox that hypotaxis uses to run its exec kernel and the project gate commands (tests, builds). It enforces, per child process:

| Dimension | What it means |
|---|---|
| **fs** | Paths in `ro_paths` are readable and executable, paths in `rw_paths` are also writable, everything else cannot be read, written, created, removed or renamed (where the platform can enforce reads) |
| **network** | Off, loopback only, or on. A host allowlist is not enforceable by any OS mechanism here (see below) |
| **env** | The child sees an allowlist of names copied from the host plus an explicit `env_set`, never the host environment |
| **process** | A timeout, a per-stream output cap, and killing the whole process tree on timeout, cancel and drop |

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
| `SandboxPolicy` | `ro_paths`, `rw_paths`, `network: Off \| Loopback \| Allowlist(hosts) \| On`, `env_allowlist`, `env_set`, `cwd`, `timeout_ms`, `output_cap_bytes`, `kill_grace_ms`, `degraded` |
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
- CPU, memory, process-count and disk usage: a fork bomb or a full scratch disk is not stopped, only the timeout ends it.
- Anything the policy grants on purpose: the inherited channel, a granted `/proc`, `network: on`.
- A descendant that detaches from the process group (see the per-platform gaps).
- Covert channels, timing, and information the OS gives to every process (`stat` of unlisted paths, hardware details).

## Mechanisms per OS

### Linux (verified here, kernel 6.18)

No setuid helper and no bubblewrap. Every mechanism is a syscall the child makes on itself between `fork` and `exec`, from data the parent prepared, so a failure aborts the spawn and a child never reaches `exec` half-sandboxed.

| Dimension | Mechanism |
|---|---|
| fs | **Landlock** (ABI 3 or newer: earlier ABIs cannot stop `rename` out of or `truncate` in a read-only tree). Reads are handled too, so unlisted paths are unreadable. Grants are per path; read-only grants are `EXECUTE\|READ_FILE\|READ_DIR`. `/dev/null`, `zero`, `full`, `random`, `urandom` are always granted. ABI 6 adds scoping of abstract Unix sockets and signals to outside processes |
| network off | **seccomp**: `socket()` only for `AF_UNIX` stream sockets, `socketpair` likewise, `connect`/`bind`/`listen` denied (so no Unix socket can be reached by path), no datagram sockets |
| network loopback | A private **network namespace** with only `lo` up (direct `unshare(CLONE_NEWNET)` as root, or through an unprivileged user namespace), plus seccomp limiting the socket families |
| network on | Nothing, except that `AF_VSOCK` is denied |
| process | `setsid` (own session and group, `killpg` on timeout), `no_new_privs`, empty capability sets and bounding set, a seccomp deny list (`ptrace`, `process_vm_*`, `io_uring`, `bpf`, `mount`, `kexec`, keyrings, module loading, `userfaultfd`, `perf_event_open`), every descriptor above 2 marked close-on-exec before the program starts |

Landlock and seccomp are **probed at runtime**, not inferred from a version: a forked child restricts itself and has to be denied. `capabilities()` reports the result. On this container: Landlock ABI 7, seccomp, and network namespaces (root, `CAP_SYS_ADMIN`). The same tests also pass as an unprivileged user (`setpriv --reuid=65534 --regid=65534 --clear-groups <test binary>`), where loopback goes through a user namespace.

### macOS (compiles for both Apple targets; **never run**)

A **Seatbelt** profile is generated from the policy and applied with `/usr/bin/sandbox-exec -p` (absolute path, never `PATH`). The profile is deny-by-default, adapted from Codex's base and platform-default policies (see `NOTICE`). Each path is a `-D` parameter referenced as `(param "RO_0")`, so a hostile path cannot inject rules. Read-only grants allow `file-read*` and `file-map-executable`; read-write grants add `file-write*`. Network: nothing for off, `localhost:*` for loopback, `(allow network*)` for on. Process: `setsid` plus `killpg`. Profile generation is unit-tested as text on every platform.

### Windows (compiles for `x86_64-pc-windows-msvc`; **never run**)

An **AppContainer** per run. A fresh random profile name gives a SID, and the child is created with that SID through `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`.

| Dimension | Mechanism |
|---|---|
| fs | The container SID is the confinement: access checks must pass for it as well as for the user. Each `ro` path gets a read-execute ACE and each `rw` path a modify ACE (never `WRITE_DAC` or `WRITE_OWNER`), inheritable for directories, revoked and the profile deleted when the run ends |
| network | No capability SIDs means no network, and no loopback. `on` grants `internetClient`, `internetClientServer`, `privateNetworkClientServer`. `loopback` adds the container to the machine-wide loopback exemption list, which needs an **elevated** process, so it is `unavailable` otherwise |
| process | A **job object** with `KILL_ON_JOB_CLOSE` and UI restrictions (clipboard, desktop, display settings, global atoms, handles). The process is created suspended and resumed only after it is inside the job. Dropping the handle closes the job, which kills the tree |
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
| kill the tree | group, verified | group | job object |
| a descendant that escapes the kill | possible (`setsid`, `setpgid`) | possible | not possible (job) |
| polite stop before the kill | `SIGTERM` | `SIGTERM` | none (grace period skipped) |
| CPU, memory, pids, disk limits | none | none | none (the job could carry them; not wired) |

### Policy semantics worth knowing

- Paths must be absolute and exist. They are **canonicalised once** (symlinks resolved), and the grant lands on the resolved target. `ResolvedPolicy` keeps both spellings. A symlink *inside* a granted tree never widens the grant: Landlock, Seatbelt and ACLs all follow the real hierarchy (tested: writing through a link in scratch that points at the workspace fails).
- A path in both lists is writable. A `ro` path **inside** an `rw` tree is rejected: no backend can subtract a grant (Landlock and Seatbelt allow rules are additive). A `rw` path inside a `ro` tree is fine, which is the usual layout (workspace read-only, `target/` writable).
- `rw` cannot be the file system root. `cwd` must lie inside a grant.
- `ro_paths` has to include what the program itself needs. `SandboxPolicy::system_read_paths()` gives a conservative list of system directories (it never includes `/etc` as a whole or `/proc`). `/proc` is deliberately not granted: it exposes the environment of every same-user process, including `hx`.
- `network: allowlist` with only loopback names becomes `loopback`. Any other host list is `unavailable` and, with `degraded.network`, runs with the network **on** (reported as degraded). That is the one degrade that loosens a lot, which is why it is opt-in.
- The program is found in the child's own `PATH` (absolute entries only), never the host's. Missing or not executable is `SpawnFailed`, with a hint when the program lies outside the grants.
- The inherited socket, pipe or handle bypasses the file system and network confinement by design. The child sees it under the same number it has in the host.
- Output over the cap is read and dropped so the child never blocks on a full pipe. The text is decoded as UTF-8 with replacement characters, so a cut in the middle of a character shows as one.

## Known gaps

1. **Process escape from the kill.** On Unix, `kill` reaches the process group. A descendant that calls `setsid` or `setpgid` leaves it. A PID namespace or cgroup would close this and needs more privilege than we can assume.
2. **Pathname Unix sockets with the network on.** Landlock before ABI 9 does not mediate `connect` to a Unix socket path, so `network: on` or `loopback` on Linux can reach `docker.sock`-style sockets that file permissions allow. With the network off, `connect` is denied by seccomp.
3. **No resource limits** (CPU, memory, pids, disk). Add them as rlimits, cgroups or a job limit once there is a number to put in them.
4. **PID reuse window.** After the leader is reaped, the group is signalled once. A recycled pid that is also a group leader within microseconds would be hit. Linux allocates pids sequentially, so this is theoretical.
5. **Canonicalise-then-open race.** A grant is made on a path that was canonicalised a few milliseconds earlier. The last component is opened with `O_NOFOLLOW` and its kind is re-checked; swapping a parent directory in between is not prevented. The host owns the paths it grants.
6. **Windows ACL cost and leftovers.** Granting an inheritable ACE on a large tree makes Windows rewrite every child's ACL. After a crash, entries for a dead random SID stay behind (harmless, nothing can be that SID) and so does the profile directory.
7. **Seatbelt is deprecated** by Apple but works, and it does not nest: inside another sandbox `capabilities()` reports it unavailable.

## Deviations from the architecture document

`docs/ARCHITECTURE.md` section 7 lists "bubblewrap, Landlock and seccomp" for Linux. This crate uses Landlock and seccomp only: bubblewrap needs unprivileged user namespaces or a setuid binary, the brief forbids setuid helpers, and Landlock gives the read-only and read-denied semantics without a mount namespace. A bubblewrap path could be added later for hosts with an old Landlock ABI; it would be one more backend behind `prepare`. This is worth an ADR.

## Tests

```sh
cargo test -p hx-sandbox                       # builds the probe example too
cargo test -p hx-sandbox --test macos          # on a Mac
cargo test -p hx-sandbox --test windows        # on Windows; add -- --ignored from an elevated shell
setpriv --reuid=65534 --regid=65534 --clear-groups target/debug/deps/linux-<hash>   # unprivileged Linux run
cargo check --target aarch64-apple-darwin --all-targets
cargo check --target x86_64-pc-windows-msvc --all-targets
```

- **Unit tests** next to the code: policy and normalisation (with property tests that every resolved path is canonical, absolute and symlink-free, that resolving is idempotent, and that a symlink never widens a grant), the Linux plan with synthetic probes, Landlock access masks, seccomp compilation, Seatbelt profile text, Windows translation (including the argument-quoting round trip).
- **Linux integration tests** (`tests/linux.rs`) run real processes. The `probe` example runs *inside* the sandbox and reports what it could do, so each assertion is made by the child. They cover: ro write denied and rw allowed, rename, remove and truncate denied in a read-only tree, reads outside the grants denied, symlinks not widening grants, network off blocking TCP, UDP and Unix socket paths (with a control showing `on` connects), the loopback namespace being private, environment filtering, timeout killing a three-level process tree, a `SIGTERM`-ignoring process, background processes, cancellation by drop, output cap, `SpawnFailed`, the report matching `/proc/self/status` from inside, denied syscalls, descriptor hygiene, and `spawn` with streams, an inherited socket and a watchdog. Mutating the implementation (dropping Landlock, dropping seccomp, skipping the close-on-exec step) makes the matching tests fail.
- Tests that need Landlock skip, loudly, when the host lacks it. Nothing needs more privilege than this container has; `loopback` falls back to a user namespace when `CAP_SYS_ADMIN` is missing. The Windows elevated test is `#[ignore]`.

## Status of verification

| | Verified by running | Compile-checked only |
|---|---|---|
| Linux x86_64, root and unprivileged | everything above | |
| Linux aarch64 | | the whole crate (`aarch64-unknown-linux-gnu`, clippy clean); the seccomp tables are built from `libc::SYS_*` constants that exist on both architectures |
| macOS | profile text | the backend and its tests (`aarch64-apple-darwin`, `x86_64-apple-darwin`) |
| Windows | argument quoting, environment block, ACL masks, capability SIDs | the whole backend and its tests (`x86_64-pc-windows-msvc`) |

A real Mac and a real Windows machine must confirm at least: that the generated profile lets a stock Python and a stock `cargo` start; that ACL propagation and revocation behave on a real tree; that `CreateProcessW` accepts the attribute combination; that an AppContainer can run the interpreters the kernel needs; the loopback exemption path; and the time cost of granting a large workspace.
