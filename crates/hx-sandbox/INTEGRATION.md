# Wiring hx-sandbox into `hx`

For whoever owns `hx-proto` and the `hx` binary. `hx-sandbox` has no dependency on `hx-proto`; everything below is glue that lives in the `hx` crate (or a thin `SandboxHandler` module next to `TxnHandler`).

## 1. Dependency

```toml
# crates/hx/Cargo.toml
hx-sandbox.workspace = true   # already in [workspace.dependencies]
```

`hx-sandbox` needs a Tokio runtime with the blocking pool (it uses `spawn_blocking` for path resolution and sandbox construction) and the `process`, `time` and `io-util` features, which it enables itself.

## 2. The handler

`sandbox.run` follows `TxnHandler`'s shape. The error mapping is mechanical: `Error::code()` is a `&'static str` already in the catalog, `Error::data()` is the optional details object.

```rust
use hx_proto::method::Namespace;
use hx_proto::registry::{BoxFuture, CallContext, Handler, HandlerResult, parse_params, to_result};
use hx_proto::{AppError, codes};
use hx_sandbox::wire::{METHOD_CAPABILITIES, METHOD_RUN, SandboxRunParams};

#[derive(Debug, Default)]
pub struct SandboxHandler;

const METHODS: &[&str] = &[METHOD_RUN, METHOD_CAPABILITIES];

fn app_error(e: &hx_sandbox::Error) -> AppError {
    // `code()` is one of hx.sandbox.unavailable | denied | spawn_failed | hx.invalid_params.
    let mut err = AppError::new(e.code(), e.to_string());
    if let Some(serde_json::Value::Object(map)) = e.data() {
        for (k, v) in map { err = err.with(&k, v); }
    }
    err
}

impl Handler for SandboxHandler {
    fn namespace(&self) -> Namespace { Namespace::Sandbox }
    fn methods(&self) -> &'static [&'static str] { METHODS }

    fn capabilities(&self) -> Vec<String> {
        // Live probes; the first call forks short-lived probe children on Linux (a few ms).
        hx_sandbox::capabilities().capability_strings()
    }

    fn call<'a>(&'a self, method: &'a str, params: serde_json::Value, ctx: CallContext)
        -> BoxFuture<'a, HandlerResult>
    {
        Box::pin(async move {
            match method {
                METHOD_CAPABILITIES => to_result(&hx_sandbox::capabilities()),
                METHOD_RUN => {
                    let p: SandboxRunParams = parse_params(params)?;
                    let (argv, policy) = p.into_policy();
                    // Dropping the run future kills the whole process tree, so cancelling is
                    // safe and changes nothing in the workspace.
                    tokio::select! {
                        () = ctx.cancel.cancelled() => Err(AppError::cancelled()),
                        r = hx_sandbox::run(&argv, &policy) => match r {
                            Ok(result) => to_result(&result),
                            Err(e) => Err(app_error(&e)),
                        },
                    }
                }
                other => Err(AppError::new(codes::HX_METHOD_NOT_FOUND, format!("no handler for `{other}`"))),
            }
        })
    }
}
```

(Names are as they appear in `hx-proto` on `w2/hx-core`; adjust to whatever the merged names are. Add the three codes below to `errors.json` first, so `codes::HX_SANDBOX_*` exist and `rpc_code_for` knows them; until then `AppError::new(e.code(), ..)` still works because `Error::code()` returns the string itself.)

Register it in `build_dispatcher` next to `TxnHandler`. Warm the probes once at start-up (call `hx_sandbox::capabilities()` before serving) so the first `sandbox.run` does not pay for them.

## 3. Protocol changes (PROTOCOL.md section 4)

`sandbox.run` is richer than the one-liner in the doc. The wire types are `hx_sandbox::wire::{SandboxRunParams, SandboxRunResult}` and their JSON Schemas come from `hx_sandbox::wire::json_schemas()` (a map `method -> {params, result}`), ready for the schema builder.

| Param | Notes |
|---|---|
| `argv`, `cwd` | `argv` is a vector, never a shell string. `cwd` must lie inside `ro` or `rw` |
| `ro[]`, `rw[]` | absolute paths; canonicalised; a `ro` path inside an `rw` path is rejected |
| `net` | `false` (off, default), `true` (on), `"loopback"`, or a host list (only loopback names are enforceable; anything else is `hx.sandbox.unavailable` unless degraded) |
| `env` | variables to set. **New:** `env_allowlist` (names copied from `hx`'s environment; default `PATH`, locale, `TERM`, `TZ`) |
| `timeout_ms`, `output_cap` | defaults 120 000 ms and 1 MiB per stream; ceilings 1 h and 64 MiB. **New:** `kill_grace_ms` (default 2000) |
| **New:** `degraded` | `{fs, network, process}` booleans, all false by default |

Result: `{exit: {kind: "exited", code} | {kind: "signaled", signal} | {kind: "timed_out"} | {kind: "spawn_failed", reason}, stdout: {text, truncated, total_bytes}, stderr, duration_ms, enforcement}`, where `enforcement` is `{platform, fs, network, env, process}` and each dimension is `{status: "enforced"|"degraded"|"unrestricted", mechanisms[], detail}`. A non-zero exit, a timeout and a missing program are results, not errors.

New method `sandbox.capabilities`: no params, result `Capabilities`.

Error codes to add to `crates/hx-proto/errors.json` (all `-32000`):

```json
{"code": "hx.sandbox.unavailable", "rpc_code": -32000, "description": "The platform cannot enforce a requested sandbox dimension and the policy did not allow degrading it. Nothing ran. data.dimension and data.reason say which."},
{"code": "hx.sandbox.denied", "rpc_code": -32000, "description": "The OS refused while the sandbox was being built or applied, so the command did not run. data.step names the setup step."},
{"code": "hx.sandbox.spawn_failed", "rpc_code": -32000, "description": "A long-lived sandboxed child could not be started (spawn only; sandbox.run reports the same condition as exit.kind spawn_failed)."}
```

The first two are already listed in PROTOCOL section 6 but not in `errors.json`; `spawn_failed` is new. An invalid policy maps to the existing `hx.invalid_params`.

Capability strings advertised through `hx.describe`: `sandbox.run`, `sandbox.spawn`, `sandbox.platform.<os>`, and, only when enforceable on this host, `sandbox.fs`, `sandbox.net.off`, `sandbox.net.loopback`, `sandbox.process_tree_kill`, `sandbox.inherited_handle`. The plugin should refuse to start a governed session that needs `sandbox.fs` when it is missing, rather than discover it at the first gate.

## 4. How the callers use it

**Gate commands (`ship`).** Workspace read-only, a writable scratch and any build-output directory writable, network off:

```rust
let policy = SandboxPolicy::new(&workspace)
    .with_ro(SandboxPolicy::system_read_paths().into_iter().chain([workspace.clone(), toolchain_dir]))
    .with_rw([scratch.clone(), workspace.join("target")])   // rw inside ro is fine
    .with_env("HOME", scratch.to_string_lossy());
let result = hx_sandbox::run(&argv, &policy).await?;
```

Call `policy.resolve()?.ensure_rw_within(&[scratch_root, workspace])` first when any writable path comes from a project or an agent: it proves no symlink makes a writable grant resolve elsewhere.

**Exec kernel (long-lived, with a private channel).** The kernel must not talk over stdout, and with `network: off` it cannot connect to anything by path. So `hx` owns the channel:

1. `hx` creates a connected pair (a `UnixStream::pair()`, or an anonymous pipe pair on Windows), keeps one end for the plugin side, and passes the other to the kernel: `read the fd number first`, put it in `argv` or `env_set` (for example `HX_KERNEL_FD=7`), then `spawn(&argv, &policy, SpawnOptions::new().with_inherit(fd.into()))`. The child sees the descriptor under the same number.
2. How the plugin reaches its end is a design decision for the protocol, not for this crate. The natural shape is a `sandbox.spawn` method that returns `{handle, pid, enforcement}` and streams `sandbox.stdout`/`sandbox.stderr` events, plus `sandbox.kill` and `sandbox.wait`, with `hx` bridging the kernel's channel to the plugin's private socket. `hx-sandbox` exposes everything that needs: `Handle::take_stdout/stderr/stdin`, `kill()`, `wait()`, `pid()`, and the lifetime watchdog from `timeout_ms`.
3. Set `timeout_ms` to the kernel's maximum lifetime (it is enforced by a watchdog); the interrupt-without-kill behaviour of ADR-0005 is a kernel-protocol matter, not a sandbox one.

## 5. Things to decide

- **Allowlist degrade.** A non-loopback host list is `unavailable`; with `degraded.network` it runs with the network fully **on**. If you would rather it degrade to *off*, that is a one-line change in each backend's `plan`/`prepare`. Which is right depends on whether a failing build is worse than an unfiltered one. A real allowlist needs an egress proxy: `hx` would start it, give the child `network: loopback` plus `HTTPS_PROXY`, and enforce the host list there.
- **ADR.** Landlock and seccomp instead of bubblewrap on Linux (README, "Deviations"), AppContainer instead of Codex's user-based design on Windows.
- **`rw` inside `ro` and not the reverse.** If the gate needs a read-only subtree inside a writable one (for example `.git` inside a writable checkout), the backends cannot express it today. The workaround is to grant the writable subdirectories instead of the parent.
- **Windows elevation.** `loopback` is unavailable without an elevated `hx`. The kernel channel does not need it (inherited handle), but any test that binds a local server does.
