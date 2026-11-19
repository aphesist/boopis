# hx-sandbox in `hx`

`hx-sandbox` is wired into the dispatcher. This file says what is registered, what the plugin calls, and how a spawned kernel's streams reach the plugin.

## What is registered

`hx::build_dispatcher` registers `hx_sandbox::SandboxHandler` (namespace `sandbox`). `hx.describe` lists `sandbox.run`, `sandbox.capabilities`, `sandbox.spawn`, `sandbox.wait`, `sandbox.kill` and these capability strings, only for what is enforceable on the host: `sandbox.fs`, `sandbox.net.off`, `sandbox.net.loopback`, `sandbox.process_tree_kill`, `sandbox.inherited_handle`, `sandbox.channel.unix_socket`, plus `sandbox.platform.<os>`. The plugin should refuse a governed session that needs `sandbox.fs` when it is missing, rather than find out at the first gate.

`hx sandbox run --json <file|->` and `hx sandbox capabilities` are one-shots through the same dispatcher. `hx schema` prints the schema including these methods; `hx-proto/schema/hx-v1.schema.json` is regenerated with `cargo test -p hx -- --ignored bless_schema`. The schema builder lives in `hx::schema` (`hx_sandbox::add_schema` adds this crate's methods and the `error.data` types of `hx.sandbox.unavailable` and `hx.sandbox.denied`).

Error codes (in `crates/hx-proto/errors.json`, all `-32000`): `hx.sandbox.unavailable` (`data.dimension`, `data.reason`), `hx.sandbox.denied` (`data.step`, `data.os_error`), `hx.sandbox.spawn_failed`, `hx.sandbox.unknown_handle`, `hx.sandbox.too_many`. An invalid policy is the existing `hx.invalid_params`. A cancelled `sandbox.run` kills the process tree and answers `hx.cancelled`.

## Methods

**`sandbox.run`**: `{argv, cwd, ro[], rw[], net, env, env_allowlist?, timeout_ms?, output_cap?, kill_grace_ms?, degraded?, memory_bytes?, max_processes?, max_file_bytes?, cpu_seconds?}`.

| Param | Notes |
|---|---|
| `argv`, `cwd` | `argv` is a vector, never a shell string. `cwd` must lie inside `ro` or `rw` |
| `ro[]`, `rw[]` | absolute paths; canonicalised; a `ro` path inside an `rw` path is rejected |
| `system_read` | `true` adds the platform's own system read paths (`SandboxPolicy::system_read_paths`: libraries and a few small files under `/etc`) to `ro`, so a caller does not copy that list. Default `false` |
| `net` | `false` (off, default), `true` (on), `"loopback"`, or a host list. Only loopback names are enforceable; any other list is `hx.sandbox.unavailable` unless `degraded.network`, which means network **off** |
| `env`, `env_allowlist` | `env` is set in the child. `env_allowlist` names are copied from `hx`'s environment (default `PATH`, locale, `TERM`, `TZ`) |
| `timeout_ms`, `output_cap` | defaults 120 000 ms and 1 MiB per stream; ceilings 1 h and 64 MiB. `kill_grace_ms` default 2000 |
| `memory_bytes`, `max_processes`, `max_file_bytes`, `cpu_seconds` | resource limits, default 4 GiB, 512, 1 GiB, as many seconds as the timeout; `0` turns a limit off |
| `degraded` | `{fs, network, process}`, all false by default |

Result: `{exit: {kind: "exited", code} | {kind: "signaled", signal} | {kind: "timed_out"} | {kind: "spawn_failed", reason}, stdout: {text, truncated, total_bytes}, stderr, duration_ms, enforcement}`. `enforcement` is `{platform, fs, network, env, process}`, each `{status: "enforced"|"degraded"|"unrestricted", mechanisms[], detail}`. A non-zero exit, a timeout and a missing program are results, not errors.

**`sandbox.spawn`**: the same params plus `channel?: {env?, dir?, accept_timeout_ms?}`. `timeout_ms` is the child's maximum lifetime. Returns `{handle, pid, enforcement, channel?: {kind: "unix_socket", path, env, fd}}`.

**`sandbox.wait`** `{handle, timeout_ms = 0}`: `0` polls. Returns `{running, exit?, stdout, stderr, duration_ms}`; once the exit is returned the handle is gone. **`sandbox.kill`** `{handle}` kills the whole tree; call `sandbox.wait` to collect the exit. **`sandbox.capabilities`** returns what the host can enforce.

At most 32 spawned children live at once (`hx.sandbox.too_many`). Dropping `hx` kills them all (each is a kill-on-drop tree).

## How the plugin gets a spawned child's streams

Chosen: **a socket path returned to the caller** for the child's private channel, and **captured output returned by `sandbox.wait`** for stdout and stderr. Not notifications over `hx`'s stdio. Why:

- The kernel speaks its own JSON-RPC (`hx-kernel-v1`) to the plugin, with `cell.output` streaming, `tool.call` round trips and large cell results. Carrying that inside `hx`'s JSON-RPC would wrap every byte twice, queue it behind unrelated requests on one stdio pipe, and make `hx` parse and re-serialise payloads it has no business reading (and that the redactor would then have to consider).
- A byte bridge is binary-safe and unframed. `hx` copies bytes between the plugin's connection and the child's inherited end of a socket pair, without looking at them.
- It works with the network off. The child has no path access to a socket and its `connect` is denied; it only needs the descriptor it inherited, whose number it reads from the environment variable named in `channel.env` (default `HX_CHANNEL_FD`).
- `hx` has no unsolicited-notification path today (the dispatcher answers requests), and the kernel's stdout and stderr are diagnostics, not data the plugin must react to as it arrives. `sandbox.wait` with `timeout_ms: 0` is the poll; the capture is capped like every output.

The channel: `hx` creates a connected socket pair, binds `<dir>/channel.sock` (the directory is mode 0700, the socket 0600; the default directory is a fresh one under the temporary directory, removed afterwards) and bridges the **first** connection to the child's end. The listener closes after one accept or after `accept_timeout_ms` (default 60 s), and the connecting peer's uid must equal `hx`'s. Nobody connecting in time closes the child's end, so the kernel sees EOF and exits.

Plugin side, in order: `sandbox.spawn` with `channel` set, connect to `channel.path`, speak `hx-kernel-v1` on that stream, `sandbox.wait` for the exit (or `sandbox.kill` for an interrupt-hard-timeout). The kernel reads `os.environ[channel.env]` and wraps that descriptor (`socket.socket(fileno=int(...))`).

On Windows the channel is not implemented yet: `sandbox.spawn` with `channel` returns `hx.invalid_params`. The library can already pass one handle (`SpawnOptions::with_inherit`); a named-pipe bridge is the missing piece and needs a real Windows machine to test.

## Calling the library directly

```rust
let policy = SandboxPolicy::new(&workspace)
    .with_ro(SandboxPolicy::system_read_paths().into_iter().chain([workspace.clone(), toolchain_dir]))
    .with_rw([scratch.clone(), workspace.join("target")])   // rw inside ro is fine
    .with_env("HOME", scratch.to_string_lossy());
let result = hx_sandbox::run(&argv, &policy).await?;
```

Call `policy.resolve()?.ensure_rw_within(&[scratch_root, workspace])` first when any writable path comes from a project or an agent: it proves no symlink makes a writable grant resolve elsewhere. Call `hx_sandbox::capabilities()` once at start-up so the first run does not pay for the Linux probes.

`hx-pack`'s `proc.rs` is a stand-in for the process spawn this crate provides. When it is replaced, use `hx_sandbox::run` with a read-only policy for the repository and `network: off`.

## Decisions still open

- **Windows channel** (above).
- **Real allowlist**: the host-side CONNECT proxy in the README's design note.
- **`rw` inside `ro` only**: a read-only subtree inside a writable tree (for example `.git` inside a writable checkout) cannot be expressed; grant the writable subdirectories instead.
- **Windows elevation**: `loopback` needs an elevated `hx`; the kernel channel does not.
