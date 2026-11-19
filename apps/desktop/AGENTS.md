# AGENTS.md: apps/desktop

The desktop app is a Tauri host (`src-tauri/`, Rust) and a UI (`ui/`, TypeScript, Vite, no framework). This file has two halves: **the host half** (`src-tauri/`, next), then **the UI half** (`ui/`).

# The host half: `src-tauri/`

## Job
The host is the **machine authority** of the three-authority model (`docs/ARCHITECTURE.md` section 1). It owns the Hermes lifecycle, the gateway connection, the OS keychain, windows, notifications and folder pickers, and it serves the UI. It does not render, and it does not decide any work (sessions, tools, governance and the ledger are the backend's). Crate `boopis-host`, library `boopis_host`, binary `boopis`, identifier `dev.aphesist.boopis`.

## Authority boundaries (each one is a rule)
- **The webview never receives a ticket, a token or a secret.** It holds a connection id. Tickets are single-use, minted per connect, and live inside `hermes::attach` types that are not `Serialize` and print `<redacted>`. There is **no command that returns a secret**: `secret_set`, `secret_delete` and `secret_exists` only.
- **The UI never opens a socket.** A browser WebSocket always sends `Origin`, which the gateway refuses; the host dials with **no `Origin`** and the ticket subprotocols (`hermes-gateway-v1`, `hermes-gateway-ticket.<ticket>`), on loopback only (`require_loopback`).
- **Frames are validated, never altered.** Shape (JSON-RPC 2.0) and size (`Limits`: 32 MiB in, 8 MiB out) are checked on the envelope only. The one rewrite is the top-level `id` of a UI request, so windows cannot collide; `params` and `result` are forwarded byte for byte (`rewrite_id` copies raw members).
- **Every command validates its input as untrusted** and fails with `{code, message}` (`error.rs`; `hx.hermes.unavailable`, `hx.hermes.incompatible`, `hx.config.invalid`, `hx.invalid_params`, and the host's own `hx.host.*` and `hx.secrets.*`). Nothing is fabricated: an unknown version stays unknown.
- **Capabilities list exactly the commands used**: `build.rs` declares them, `capabilities/main.json` allows them, `lib.rs` registers them, and the test `commands_match_the_capability` keeps the three lists equal. Plugins (store, notification, dialog, opener) are called from Rust only; none of their JS permissions are granted.
- **CSP** (`tauri.conf.json`): `default-src 'none'`, scripts `'self'`, `connect-src ipc: http://ipc.localhost` (Tauri IPC only), fonts bundled (`@fontsource`), no `unsafe-eval`, no remote anything. Styles allow `'unsafe-inline'` because the v6 markup sets `style=` attributes.
- **Fail closed**: a server request nobody can answer is declined (`hx.host.no_ui`), an approval the UI cannot deliver stays pending, `hermes_install` without `consent: true` is refused and with it still runs nothing (it reports the documented installer command). Never run an installer in tests.

## Layout
```
src-tauri/
  build.rs  tauri.conf.json  capabilities/main.json  permissions/ (generated)  icons/
  src/
    lib.rs        the registry (tauri-specta), `startup` (probe the machine and decide the GPU and renderer), run(), the two guard tests (capability list, bindings freshness)
    brand.rs      the terminal art from `packaging/brand/boopis.art` (ADR-0026): parse, draw at truecolor, 256, 16 and no colour, the terminal rules (`NO_COLOR`, `TERM`, `COLORTERM`, locale, `CI`)
    cli.rs        `boopis --version`, `boopis doctor`, and the branded line printed when started from a terminal
    commands.rs   every UI-facing command and the typed ConnectionStateEvent; Frame (raw JSON out)
    error.rs      Error, stable codes, HostError
    config.rs     Limits (every number as data) and REQUIRES_HERMES
    state.rs      Hubs: one proxy per profile, the connection index
    endpoint.rs   Endpoint trait: Local (ensure/attach), Remote {url, token} and Cloud {control_plane, session} (typed, unavailable)
    migrate.rs    the one-time move of what a build under the former name left (ADR-0028): app folders, the private Hermes home, keychain entries; logged, tested, nothing read afterwards
    runtime.rs    the bundled Hermes runtime (ADR-0023): runtime.json, hash-first unpack (the archive is hashed before it is opened, and again as it extracts) into <app data>/runtime/<version>-<sha8> (temporary directory, one rename, marker file, idempotent), bounded by the manifest's size and entry count, no device nodes or FIFOs, no setuid, setgid or sticky bits; `runtime/unpack.rs` holds the caps, remove_old, Plan (data dir, private home), Source (BOOPIS_HERMES)
    hermes/       discover (binary, version, install-stamp.json, HERMES_HOME; `Bundled` makes the runtime the only Hermes), cli (allowlisted env, timeout, cap; `isolated` for the bundle),
                  attach (verdict, Ticket, Dial), control (the gateway control socket), lifecycle (Supervisor), install (stub)
    gateway/      call (one request on an unserved link), oneshot (a short link for setup, may declare `desktop_local`), frame (validate), link (the transport traits), ws (tokio-tungstenite), outbox (bounded queue, coalescing),
                  reconnect (the pure state machine), hub (the shared link and its API), actor (dial, handshake, serve, replay),
                  route (response, event and server-request routing), metrics, tests (a scripted gateway)
    secrets/      store (SecretStore: Keychain, MemoryStore for tests), channel (the plugin socket, its token), peer (which process may use it)
    setup/        first-run setup: mod (the engine, forms, steps), ops (HermesOps: Hermes's CLI and a one-shot gateway link behind a trait), install (copy the plugin, place hx, find the bundle), providers (detect, ask for keys, wire, ladder; the free choices: Nous's free tier and OpenRouter's free models), state (setup.json)
    free_tier/    Nous's free tier (ADR-0027, `docs/research/free-tier.md`): `FreeTier` (what Hermes reports), challenge (the browser challenge: fragment phases, reveal/close, behind the `WindowHost` trait), serve (the event loop on a hub), windows (the Tauri hidden window: no capability, ephemeral, pinned to the portal)
    settings.rs   versioned AppSettings and its migration; os.rs (URL allowlist, home-relative paths, notification bounds)
    renderer.rs   which WebKitGTK renderer the webview gets (ADR-0024): probe GPUs and session, a pure decision table (by runtime WebKitGTK version too), the one set_var, the diagnostics report
    gpu.rs        which GPU the webview renders on (ADR-0025, BOOPIS_GPU): power source, switcheroo-control's environment (parsed, filtered), a pure decision table, the second set_var
    webkit.rs     the runtime WebKitGTK: version, bundled or system, and the feature API (dlsym, behind a trait; the one unsafe block)
    frame_rate.rs WebKit's 60 fps preference (ADR-0025, BOOPIS_FPS): the decision, GDK's refresh rate for the window's monitor, the power profile
  tests/live_gateway.rs   the proxy against a real Hermes gateway and the fake model (skips without HX_E2E_HERMES_ENV)
  tests/setup_live.rs     first-run setup on a fresh profile against a real Hermes (skips without HX_E2E_HERMES_ENV and an hx binary); its `bundled` twin unpacks the real runtime archive (HX_E2E_RUNTIME_ARCHIVE) and runs the same flow on it
  examples/secret_channel_server.rs   the real secret channel over an in-memory map, with one pid as the gateway, for the plugin's Python tests
```

## The command line
`run()` reads the arguments before it does anything else (`cli::dispatch`): no argument starts the app as always; `--version` and `doctor` print and exit, with no window, no thread, no logger and none of the renderer's environment changes. A path or link the system hands the app starts it; an option that does not exist is an error (exit 2), not a silent launch.
- `boopis --version` prints the compact logo, the version, the Hermes this build carries (from `runtime.json`) and the loaded WebKitGTK with its origin.
- `boopis doctor` is Settings > General > Diagnostics in a terminal: session type, GPUs, the renderer and GPU decisions with their rules, the frame-rate setting, WebKitGTK, the runtime's status and the data folders. It calls `startup(false)` (the same decisions `run()` applies), `frame_rate::decide`, `webkit::probe`, `runtime::plan_for` and `Source::resolve`; it never applies a variable. The frame rate shows the setting, not the display's rate (that needs the window).
- Started from a terminal with no argument, the app prints one line (logo, version, the renderer and GPU decisions) to standard output, and nothing to a pipe.
- Colour and marks follow `brand::Caps` (`NO_COLOR`, `TERM=dumb`, a pipe, `COLORTERM`, the locale); a pipe gets plain text with no logo glyphs.
- On Windows the release binary is a GUI program and has no console of its own, so these commands print nothing there yet (it needs `AttachConsole`).

## Hermes lifecycle
1. **Discover** (`hermes::discover`): the bundled runtime's launcher when the build carries one (the only Hermes then, in the private home), else `hermes` on `PATH`, then `~/.local/bin`, then Hermes's own places; `hermes --version`; `install-stamp.json` near the install. **`HERMES_HOME` wins, else `~/.hermes`** (Windows: `%LOCALAPPDATA%\hermes`; `HERMES_DATA_DIR_SUFFIX` is honoured). A named profile lives in `<root>/profiles/<name>` (ADR-0006: attach to the active profile by default; a setting switches).
2. **`requires_hermes`** (`>=0.23.2`, from the plugin manifest): an older Hermes is refused (`hx.hermes.incompatible`). A Hermes that names no version (a source checkout with no stamp) passes with a warning; the gateway's `runtime.describe` is the real gate.
3. **Ensure once per run** (`hermes gateway ensure --json`). The `code_sha` check: `client_code_sha` against `endpoint.code_sha`; when both exist and differ the gateway outlived an update, so the host runs `hermes gateway stop --yes` and ensures once more. When the running gateway names no code identity (or the identity the install stamp names), the CLI is skipped: a control-socket round trip decides instead.
4. **Attach per connect**: the gateway's control socket (`$HERMES_HOME/gateway.sock`: `identify`, then `session-ticket`, about 2 ms; the home must belong to the socket's peer and not be group- or world-writable), falling back to `hermes gateway attach --json --start` (about 500 ms: a Python start; it also restarts a gateway that idle-exited). Windows uses the CLI route (the control channel is a named pipe).
5. **Link states** (`gateway::reconnect`): `connecting`, `ready`, `degraded`, `incompatible`, as `connection.state` event frames to every window and as the typed `ConnectionStateEvent`. The first retry after a loss is immediate (an idle-exited gateway is restarted by the attach), then 0.4 s doubling to 15 s. `incompatible` parks until the user retries (`hermes_retry`, or connecting again). After a reconnect the host asks `session.events.since {session_id, last_seen, replay_epoch}` for every session it saw events of (the 64 most recent), delivers the missed events, drops live duplicates, and sends `connection.replay_gap` when the buffer was truncated (the UI reloads that transcript).
6. **Handshake** is the host's, once per link: `gateway.ready`, `client.capabilities {server_requests: true}`, `runtime.describe`. A window's own `client.capabilities` and `runtime.describe` are answered from that cache and never reach the gateway.

## The proxy
One link per profile, shared by every window and multiplexed by request id (`gateway::hub`). Events go to every window; a **server request** goes to the window that attached last and is declined when none is attached. A bounded queue per window (`Outbox`): responses and every non-delta frame are never dropped; past 2048 queued frames adjacent `message.delta` frames of one session are merged (text concatenated, order kept) and counted, reported as a `connection.backpressure` frame and in `gateway_stats`; past 16384 the window is closed as too slow and reconnects (the replay path). Requests unanswered for 120 s are answered with a timeout error. Pings every 20 s; 75 s of silence is a lost link.

**Measured budgets** (debug build, real gateway from the spike install, `tests/live_gateway.rs`, three runs): attach (control-socket ticket plus WebSocket handshake) 8 to 16 ms (one outlier of 188 ms); first connect of a run about 1 s, which is discovery (`hermes --version`) plus `ensure`; the app warms discovery while the UI loads; proxy overhead per frame, p95: gateway to queue about 0.09 ms, UI to link about 0.08 to 0.4 ms (budget 1 ms); queue to the UI's sink about 0.02 to 0.07 ms in the test (the Tauri Channel's own cost is outside the test).

## The secret channel (host to plugin)
Secrets travel UI to host to keychain (ADR-0020, `docs/FORMS.md` section 3). Hermes reads credentials through a **secret source** (`ctx.register_secret_source`, `agent/secret_sources/base.py`: read-only, startup-time, synchronous, env-var-shaped), and a plugin cannot call Tauri, so the host listens on a local socket (`secrets::channel`, protocol `hx-host-secrets-v1`):
- **Transport**: a Unix socket `host.sock` (mode `0600`) in `$XDG_RUNTIME_DIR/boopis/` (else `<data dir>/boopis/run/`, mode `0700`). A live host is never replaced; a stale socket is. Windows would use a named pipe with a user-only ACL: **not implemented** (`start` says so and the plugin gets no secrets there yet).
- **Who may connect** (`secrets::peer`): the gateway the host started, and nothing else. The kernel's `SO_PEERCRED` names the connecting process and the host admits it only if it is (A) the recorded gateway (same pid, start time and executable; recorded from the pid the kernel reports on the gateway's control socket, and only if the process was started with this run's token in its environment) or (B) the daemon a `gateway ensure|attach --start` call is starting right now (a process started with the token below the `hermes` process the host spawned for that call, while it runs: the gateway reads its secrets as it starts, before the host has seen it; the command line is deliberately not used, as Hermes may retitle its process). **A child of the gateway is refused**, which is what a tool the agent runs is. A refused process gets the same answer as a wrong token, and the store is never asked. Linux reads `/proc`; other Unix systems compare the pid only and never meet rule B (so a gateway there is not served at start-up). A gateway the host did not start in this run (an earlier run left it, a systemd unit, the user's own) holds no token and is not served; Hermes then keeps its own `.env`.
- **The token and where it goes**: a per-run 256-bit token (`getrandom`), compared in constant time. It is **written to no file**. The host puts it, with the socket's path, in the environment of the `hermes gateway ensure|attach --start` call that starts the gateway (`BOOPIS_HOST_SECRETS_TOKEN`, `BOOPIS_HOST_SECRETS_SOCKET`, through `Cli::run_launching`; no other `hermes` call gets them), and Hermes builds the daemon's environment from that call's. Hermes passes every variable of the gateway's environment to the children it builds unless its own policy strips it, so the plugin takes both values at load and **removes the token from the process environment** (`hostsecrets.channel.capture_environment`), and its secret source names the token as a bootstrap credential (`default_token_env`), which Hermes's environment policy strips from every child it builds when the source is registered before that policy is imported (checked on 0.23.2: a late registration is not seen, which is why the plugin removes the variable itself). The token can still be read from `/proc/<gateway>/environ` by a same-user process; the peer check is what stops it being used. The token never appears in a log line (`Debug` redacts it). The old `<hermes home>/boopis/host-channel.json` is gone; the plugin's policy still denies reading it.
- **Protocol**: one JSON line in, one out, then close; reads are capped at 8 KiB and 2 s. Request `{"v":1,"token":"...","op":"get"|"has","service":"boopis.<scope>","account":"<name>"}`; reply `{"v":1,"protocol":"hx-host-secrets-v1","ok":true,"value":"..."}` or `{"ok":false,"code":"hx.secrets.not_found"|"hx.secrets.unavailable"|"hx.host.unauthorized"|"hx.invalid_params"|...}`. `has` returns `{"found": bool}`. **There is no write op and no list op**; only the `boopis.` service namespace is reachable (a ref `secret://<scope>/<name>` is service `boopis.<scope>`, account `<name>`).
- **The plugin side** is `plugins/boopis/hostsecrets` (built): Hermes's secret source `boopis_host`, configured as `secrets.boopis_host.{enabled: true, env: {VAR: secret://scope/name}}` (Hermes runs a source only when its section says `enabled: true`). A ref `secret://<scope>/<name>` is service `boopis.<scope>`, account `<name>`, and the variable is derived (`secrets/refs.rs`, data in `crates/hx-proto/secret-refs.json`, tested against both languages). A missing or dead host is `NETWORK` (Hermes keeps its own `.env`), a missing secret a warning, a wrong token `AUTH_FAILED`. It never logs a value or the token. In the cloud (ADR-0019) the same source would read the control plane instead.
- **Keychain**: the `keyring` crate (v4): the **Secret Service** on Linux (GNOME Keyring, or KWallet 6 with its Secret Service enabled), Keychain on macOS, Credential Manager on Windows. With no Secret Service running the error is `hx.secrets.unavailable` with a message naming the fix. Calls run in `spawn_blocking` (a D-Bus round trip). Tests use `MemoryStore` behind the `SecretStore` trait; no secret is ever written to a plaintext file.

## First-run setup
`setup_check` (read-only) and `setup_advance` drive `setup::Setup`. Every call recomputes the steps from reality, so it resumes after an interruption and running it again changes nothing that is already right; `<home>/boopis/setup.json` (versioned, atomic) holds only decisions and what is pending, never a secret.
0. **The runtime** (a build that carries one, ADR-0023; `BOOPIS_HERMES=existing` skips it): `runtime.json` is read, the archive hashed before anything is extracted (a mismatch extracts nothing) and again while it extracts into `<app data>/runtime/.unpack-*` (bounded by `unpacked_size` and `entries` of `runtime.json` plus a margin; a device node, a FIFO or a setuid bit never reaches the disk), moved into `runtime/<version>-<sha8>/` with one rename; the private `HERMES_HOME` is `<app data>/hermes-home`, and Hermes's own update check is switched off (`updates.check: false` through `hermes config set`). A failure is a blocked step with a stable code (`hx.setup.runtime_*`) and the reason; setup resumes on the next call. `setup_check` is `needed` while the runtime is not unpacked, so an app update that carries a new Hermes runs this step again. Older runtimes are removed (`runtime::remove_old`) only at the end, after the gateway restarted on the new one, and only directories with the host's marker file. The bundled Hermes is run with no `HERMES_*` or `UV_*` variable from the user's environment and never reads `~/.hermes`.
1. **Hermes** is found; if missing (only without a bundled runtime), the status carries the documented command and `hx.setup.hermes_missing` (the UI offers "Check again"). Nothing is installed here.
2. **The plugin** is copied to `<home>/plugins/boopis/` (never edited in place: copy to `.boopis.new`, swap, remove the old one; an upgrade keeps the user's settings, which live in `config.yaml`) and enabled with `hermes plugins enable`.
3. **`hx`** is copied to `<home>/boopis/bin/hx` and `plugins.entries.boopis.settings.hx_path` is set.
4. **One consent form** (`setup.config`, kind `setup`) shows the exact diff for `tools.tool_search.enabled: "off"`, `delegation.backend: boopis` and `allow_gateway_injection: true`. Only after the user agrees are they written, with `hermes config set` (Hermes's `config.set` RPC takes only display and session keys, so the CLI is the route). A decline is respected: the step says what will not work and offers "Review again" or a dedicated profile (ADR-0006).
5. **Models and keys** (`providers.rs`): named `providers:` entries and keys by name in `.env` are detected. Claude available (an Anthropic key in `.env` or the keychain) means the plugin's default ladder stands. Otherwise a `choice` form (`setup.ladder`) picks `anthropic` or a configured `provider/model`, a missing key is a `credential` form (`setup.credential.<provider>`), the value goes to the keychain and is wired with `providers.<name>.key_env`, `secrets.boopis_host.env.<VAR>` and `secrets.boopis_host.enabled: true`, and a single-tier ladder is written. The claude-subscription plugin is only noted in the receipt (its provider and model names are not known here).
6. **Restart** once at the end if anything changed, then verify the plugin is enabled, then the receipt.
Answers are checked against the form the host last showed (`pending_form`), so a stale or foreign answer is `hx.setup.invalid_answer` and stores nothing. The webview's `Answer.secrets` is the only place a secret enters the host from the UI during setup.

**Bundling.** `tauri.conf.json` lists nothing to bundle, so `cargo build` and `cargo test` need no staging. For the AppImage run `scripts/build-runtime.sh` (once; `docs/RELEASING.md`), then `scripts/stage-bundle.sh` (the plugin without tests and caches, `hx` as `binaries/hx-<triple>`, and the runtime's `runtime.json` and archive in `resources/runtime/`; `--no-runtime` stages a placeholder), then `cargo tauri build --bundles appimage --config src-tauri/tauri.bundle.conf.json`. At run time `Bundle::locate` finds the plugin in the resource directory and `hx` beside the executable; a debug build falls back to the repository's plugin; `Runtime::locate` finds `resources/runtime/runtime.json` (a build without it, such as `cargo run`, uses the Hermes on the machine, and a broken manifest is a setup error, never a quiet fallback). `BOOPIS_HERMES=existing|bundled` (or `hermes_source` in `settings.json`) is the advanced choice; there is no UI for it yet. The AppImage is not built in CI here (disk); the staging script and the locate logic are tested, the bundle itself is not.

## The renderer (ADR-0024)
WebKitGTK reads its renderer switches when the web view is created, so `run()` decides first, before any thread (`renderer::probe`, `decide`, `apply`). In WebKitGTK 2.44 to 2.52, `WEBKIT_DISABLE_DMABUF_RENDERER=1` means acceleration policy `never` (no GL, the CPU paints every frame; `webkit://gpu` shows it), `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` keeps GL and copies frames through shared memory. The automatic rule touches only NVIDIA proprietary as the display GPU on X11 (`FORCE_SHM`); everything else is `BOOPIS_RENDERER=auto|default|shm|cpu|nosync|software`, and a switch already in the environment wins. The decision table is unit-tested; the choice is logged at startup. Settings > General > Diagnostics (desktop only) copies `renderer_report` and opens `webkit://gpu` (`renderer_open_gpu_page`, a window with no IPC). The report also carries the runtime WebKitGTK version and origin (bundled or system), the display's refresh rate, whether WebKit's 60 fps preference is off, the power profile, the GPU choice and its rule, and the page's WebGL renderer; Measure frames reports the measured rate against the display's (`118 of 120 fps, p99 9.1 ms`). `app_restart` applies a GPU choice (it is read at start).

**Frame rate and GPU (ADR-0025).** Both are decided from the environment before any thread: `gpu::probe/plan/apply` runs first in `run()`, then `renderer`. The host's `unsafe` is three small blocks, each with a SAFETY note: `renderer::apply` and `gpu::apply` (`set_var`, before any thread) and the `dlsym` call in `webkit::native`. `BOOPIS_FPS=auto|60|max` lifts `PreferPageRenderingUpdatesNear60FPS` through `webkit::native::Live` (the single `unsafe` block resolves the symbols with `dlsym` and calls them; `webkit::set_feature` checks version >= 2.42, the symbols and the feature's existence first, and reads the value back). `BOOPIS_GPU=auto|integrated|dedicated` (and the saved setting) offloads to the NVIDIA GPU with PRIME render offload; `auto` needs AC power, a bound NVIDIA proprietary driver and WebKitGTK >= 2.54.2. Only variables on the allowlists are taken from switcheroo-control (never an EGL vendor file: ADR-0025), and `busctl` is run by absolute path from a fixed list (`/usr/bin/busctl`, `/bin/busctl`) with an empty environment, never through `PATH`. Test the logic through the traits and pure tables, never with a display. Do not add a blanket workaround: Tauri's own guide says it slows every machine that did not need it.

## Endpoints (ADR-0018 seam)
`trait Endpoint { connect() -> GatewayConn }`. `Local` is done. `Remote {url, token}` and `Cloud {control_plane, session}` are typed and return `hx.hermes.unavailable` "not yet supported". Neither the proxy nor the UI knows the kind. A remote token belongs in the keychain, never in settings (`EndpointConfig` redacts it in `Debug`).

## Typed commands and bindings
`tauri-specta` generates `ui/src/host/bindings.ts` from the registry in `lib.rs`. **Never edit it.** The test `bindings_are_fresh` (CI runs it) fails when it is stale; refresh with `HX_UPDATE_BINDINGS=1 cargo test -p boopis-host bindings`. `Frame` and `Json` are typed `unknown` in TypeScript (specta cannot export `serde_json::Value`'s 64-bit numbers); the UI narrows them with Hermes's generated contract.

## How to run
```sh
# Linux prerequisites (Debian/Ubuntu names; on Arch: webkit2gtk-4.1 gtk3 librsvg libsoup3 base-devel)
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev build-essential pkg-config

export CARGO_TARGET_DIR=...   # keep builds out of the tree on a small disk; CARGO_INCREMENTAL=0
cargo fmt -p boopis-host --check && cargo clippy -p boopis-host --all-targets -- -D warnings
cargo test -p boopis-host                          # unit tests, the capability and bindings checks
HX_E2E_HERMES_ENV=<spike install> cargo test -p boopis-host --test live_gateway -- --nocapture
                                                      # real gateway + fake model; prints BUDGETS; skips without the variable
cargo install tauri-cli --locked   # or: pnpm dlx @tauri-apps/cli@2
cargo tauri dev  (from src-tauri)  # runs the UI with the live provider (`vite --mode desktop`)
NO_STRIP=true cargo tauri build --bundles appimage            # the Linux bundle; add --debug on a small disk
HX_E2E_HERMES_ENV=<spike install> python3 tests/e2e/smoke_desktop.py <the .AppImage> shot.png
                                                      # headless: Xvfb + WebKitWebDriver drive the real app
```
- **Wayland and X11**: GTK picks the backend from the session; both work. The host chooses the renderer itself (ADR-0024, ADR-0025, "The renderer" above); for a blank window try `BOOPIS_RENDERER=shm` first, never a blanket `WEBKIT_DISABLE_DMABUF_RENDERER=1` (it forces CPU painting); `GDK_BACKEND=x11` forces X11. The smoke test runs under X11 (Xvfb).
- **Arch**: running an AppImage needs `fuse2` (`pacman -S fuse2`), or run it with `--appimage-extract-and-run` (or `APPIMAGE_EXTRACT_AND_RUN=1`). For secrets install and unlock `gnome-keyring`, or enable the Secret Service in KWallet 6; without one, `secret_set` fails with `hx.secrets.unavailable`. Hermes itself ships inside the app and is unpacked on first run (no installer, no terminal).
- The bundle is AppImage only (the owner runs Arch); `.deb` is not built.
- Logs go to stderr (`RUST_LOG`). Rotating files in the profile's `logs/boopis/` (STANDARDS section 4) are not done yet.

## What not to do (host)
- Do not add a command that returns a secret, a ticket or a token. Do not log them, in any level.
- Do not send an `Origin` header, dial a non-loopback address from `Local`, or let the UI dial anything.
- Do not alter a frame's `params` or `result`; do not drop a response; do not queue without a bound.
- Do not hold a `std` mutex across an `.await`, block an async worker (use `spawn_blocking`), or `unwrap` outside tests.
- Do not inherit the whole environment into a child: the allowlist is in `hermes::cli`.
- Do not hand-edit `bindings.ts` or `permissions/autogenerated`. Do not put a number in code that belongs in `config::Limits`.
- Commits are the owner's alone (`scripts/setup-hooks.sh`), no co-author lines, nothing that names an agent, a model or a tool.

---

# The UI half: `ui/`

## Job
`apps/desktop/ui` is the **owner's approved v6 design system**, ported to typed ES modules. It draws sessions, bots, the dock and the cards from a data provider and sends the user's actions back to it. It does not design anything: **implement the approved design exactly and never reinterpret it** (root `AGENTS.md` invariant 8, ADR-0009). The source is `design/v6/` (the reference; never edit it) and the system's own docs: `design/v6/design-system/DESIGN-SYSTEM.md`, `KEYMAP.md`, `LAYOUT.md`, `DESIGN.md`, `PRODUCT.md`.

## Layout
```
ui/
  index.html            the app's markup (the shell's chrome), as v6's index.html
  src/main.ts           entry: styles, the web component, the provider, the modules, boot
  src/core/             bus (typed events), state (typed HX.state + setState), registry (slots, provide), settings, log, keys, dom
  src/components/       the HX.ui library, one module per primitive (hold, composer, orb, layer, squircle, model-mark, ...); components.css, model-mark.css
  src/modules/          shell, session, bots, dock, cards: each module's TS and CSS
  src/styles/           tokens.css (+ tokens.json, generated), theme.ts (runtime), theme-panel.ts, fonts.ts, index.ts (the cascade order)
  src/data/             THE DATA SEAM: types, provider interfaces, mock provider, README.md
  src/host/             the bridge to the Rust host: bindings.ts (generated, never edited), bridge, gateway client, live provider, map
  src/vendor/hermes-shared/  Hermes's generated gateway contract types (MIT), pinned, with NOTICE and PIN.json
  src/vendor/model-icons/  the provider logos (LobeHub, MIT) and which family a model id gets, with NOTICE
  vendor/               orb-avatar.min.js (the owner's <orb-avatar> web component, MIT) and its .d.ts
  tests/                smoke (Playwright), parity (v6 against the port), perf (WebKitGTK and Chromium frame times; README.md), lib.mjs
  scripts/              build-tokens.mjs
```
Unit tests sit next to the code (`*.test.ts`).

## Invariants: the owner's decisions (each one must still hold)
Every row of "Owner decisions" in `DESIGN-SYSTEM.md`, and one newer rule. A change that breaks one is a bug, not a trade-off.

| Decision | Where it lives | Checked by |
|---|---|---|
| The dock is pitch black `#000` in every theme, never themeable | `--dock-bg`, `dock.css`, `[data-ground="dock"]` | smoke: "the dock is #000" in 4 presets x 3 modes |
| Cards animate their height when their state changes (the one height animation); reduced motion snaps | `modules/cards/card.ts` `flipHeight` | smoke: card height |
| **Hold to approve takes 1 second**, everywhere | `components/hold.ts`, `--dur-hold` | unit: `hold.test.ts`; smoke: commits at 1 s, in the thread and in the dock |
| Dock orbs: one click (or Enter) opens the bot's session in the dock; the same orb again, Esc or the close button returns to the row; another orb switches; **double-click or mod+Enter** opens the full chat in the Bots tab; no short press | `modules/dock/input.ts`, `controller.ts` | smoke: owner gestures, keys section 8 |
| A click outside returns the dock to rest (the pill stays a pill, an off dock stays off) | `modules/dock/input.ts` `onDocDown`/`onDocUp` | smoke |
| Dock pages: a quiet nub of page dots in the slab's foot; no tab, no side lanes | `engine.ts`, `dock.css` | parity |
| Dock motion: it stays centred on the centre line; content travels inside the slab; reduced motion: size changes are instant, entrances fade, nothing slides or overshoots | `modules/dock/engine.ts` | smoke: reduced motion |
| Reduced motion **reduces and never freezes** the orbs: blinks, eye morphs, small glances stay; large travel, bounce and spin go; `static` only off-screen or tiny | `components/orb.ts` (`glance`, `liven`), `dock/orbs.ts` | smoke: reduced motion |
| Inactive marks reach 3:1 in every preset and on the dock (`--mark-off`) | `tokens.css`, `styles/theme.ts` `PAIRS` | smoke: contrast of all pairs in all presets; unit |
| Nested corners fit their container (concentric radii, `--r-outer`, `--pad`, `--r-in`) | `components.css`, `tokens.css` | parity (pixels) |
| **Apple continuous corners in every engine** (WebKitGTK has no `corner-shape`): every corner is a path, figma-squircle at smoothing 0.6, drawn by `components/squircle.ts` (math in `squircle-path.ts`); the scale is 30 (sheets, dock), 20 (cards), 12 (rows, fields, buttons), capsule (chips), floor 8; **only leaf controls are clipped, a container never is** (orbs and popovers stay whole: its corner is a background and outline layer); no `corner-shape` anywhere | `components/squircle*.ts`, `tokens.css` (`--r-*`, `--corner-smoothing`), `components.css` | unit: golden paths from the v6 reference; smoke `corners`: no `corner-shape`, no clipped container, <= 2 ms a frame for 200 bound elements, six viewports; parity |
| **A provider's logo beside every model name** (mono in the theme everywhere, brand colour only in the model menu; an unknown family gets the neutral mark, never the phi) | `components/model-mark.ts`, `vendor/model-icons/` | unit: `model-mark.test.ts` |
| **Forms are one card family**: one renderer from the schema, every kind a template, every state, the origin slot on every card, answered in one place and resolved everywhere; a secret never leaves the field except to the keychain | `modules/cards/form*.ts`, `parts.ts`, `host/forms.ts`, `host/live/forms.ts` | unit: `form*.test.ts`, `live-forms.test.ts`; smoke `forms` |
| **Every composer can talk**: a mic in each one (session, Bots tab, dock session); the bot's orb listens while you talk; alt+V talks | `components/composer.ts` | smoke: alt+V in the session and the dock |
| Graphite and Typewriter have a real accent (`#9db6cf`, `#7ea6e0`) | `tokens.css` | parity; contrast |
| **Smart and the model picker** (owner, later): **alt+M opens the model picker while Smart stays ON**; its first entry is "Smart" (automatic; the current choice while Smart is on) and then the models; choosing a model pins it and turns Smart off; choosing Smart keeps or turns it back on; Esc changes nothing; with Smart on the model chip stays hidden and the picker opens against the Smart chip; tooltips: Smart = "Picks the model for each message", off = "You pick the model" | `modules/session/composer.ts` | smoke: alt+M, pick a model, alt+M, pick Smart |
| Keyboard first: every action has a key in `KEYMAP.md`; the keymap table feeds the sheet, Settings and the palette | `modules/shell/keymap.ts` | unit: `keymap.test.ts` (the dispatcher); smoke: the whole walk-through |

Also binding: tokens, never literals, for colour, type, radius and space (the CSS is v6's, with no literal colours; do not add any); WCAG 2.2 AA (labels, roles, focus order, contrast, **label in name**: an accessible name must contain the visible text, in order); `<orb-avatar>` stays a vendored web component.

## Frame cost (WebKitGTK is the target, not Chromium)
The desktop app draws with WebKitGTK; the owner's machine paints on the CPU at 3600x2250 buffer pixels (GTK3 renders a 1.6 scale at 2x). `tests/perf/README.md` has the harness (`pnpm perf:webkit`); the findings that became rules:
- **No `getComputedStyle`, `getBoundingClientRect`, `offset*`, `getClientRects` or `scrollWidth` inside a frame or a layout handler unless the value is needed in that frame, and never between writes.** Read everything, then write. A read after a write forces a style and layout pass over the whole page; the dock's slab path, the clips check and the dock's layout handlers each did it and cost a quarter of a morph. Cache a token you read per frame (`components/shape.ts`), and re-read it on `hx:theme`.
- **No `mask-image`, `filter` or `backdrop-filter` over a large moving or scrolling area.** The conversation's fade above the composer is a strip of the ground fading in (`.ss-view::after`), not a mask on the scroller.
- **Orbs** (`components/orb-runtime.ts`): a resized canvas repaints in the same task (a cleared canvas painted empty is the flicker), ambient orbs update on alternate frames by group (the dock's, and the rest), and the ones outside the dock wait while the dock moves. When the CPU paints, a frame repaints the bounding box of everything that changed once more than ten rectangles did: scattered animating orbs repaint the window between them. Do not add another always-animating thing in a second corner of the window.
- A dock handler that needs the new layout takes it from `hx:layout` (`d.resized` says a window resize), not from `window`'s `resize`.

## Motion (ADR-0025, STANDARDS section 6)
Motion runs at the display's full rate, so what moves must not wait for the main thread. The rules, then where every animation stands.
- **Compositor first.** Animate `transform`, `translate`, `opacity` (and `filter` only where the design needs it). A spring that has a known end is a Web Animation sampled from its closed form with `core/spring.ts` (`springKeyframes`; `springLinear` for a CSS `linear()` easing). Use keyframes, not `linear()`, for anything that must composite on WebKitGTK before 2.54, where `linear()` with points forces main-thread animation. An interrupted spring hands its velocity on from `springAt` (the exact state), never from a layout read.
- **Per-frame JavaScript is only for what follows live input**: the dock's slab outline (a path whose corners depend on its size), magnification under the pointer, a page dragged by touch. It writes transforms and one path, in one rAF, and reads nothing from layout or style.
- **Animated custom properties never inherit.** The shell publishes layout targets as `--hx-*-to`; an element that uses one declares its own `--hx-*: var(--hx-*-to)` and transitions it (`shell.css`). An inherited property animated on a root restyles the whole page every frame.
- **Orbs draw in a worker where the engine has OffscreenCanvas in workers** (`components/orb-worker/`; `setupOrbs()` in `main.ts` decides once). The page's `<orb-avatar>` is a thin element (attributes, size, visibility, resolved colours); the worker runs the vendored orb2 file as it is against `shim.ts` and applies `orb-runtime`'s frame policy. Anywhere else, or when the worker fails to start, the vendored element draws on the main thread as before; `?orbs=main` forces that. `orb-worker.test.ts` runs the vendored file against the shim and checks the shadow template the page copies.
- Measure with `tests/perf` (its README): frame times at the owner's geometry, the `-load` scenarios (a 30 ms task every 200 ms), `--probe` for main-thread work per frame.

| Motion | Driven by | Properties | Now |
|---|---|---|---|
| Dock morph (lift, expand, collapse, session, minimise): keyed elements | Web Animation from the spring (was per-frame JS) | `transform` | compositor |
| Dock slab outline, stage clip while moving, foot width, sink | per-frame JS, one rAF | SVG `d`, `clip-path`, `width`, `transform` | main thread (geometry; follows the sprung size) |
| Dock magnification, key-focus grow (arrow keys along the row) | per-frame JS | `transform` | main thread (follows input); layers only while the pointer is on the row |
| Dock page switch: sections, dots | Web Animation from the spring (was per-frame JS); the fades were already WAAPI | `translate`, `transform`, `opacity` | compositor |
| Dock page drag (touch, trackpad) | per-frame JS spring | `translate`, `opacity` | main thread (follows input) |
| Dock entrances and exits, popovers, menus, tooltips, toast, palette, dialogs | CSS transitions and keyframes | `opacity`, `translate`, `transform` | compositor |
| Shell layout travel (sidebars, column, composer, centre line, dock space, right panel) | CSS transitions of non-inherited registered lengths (were inherited on the root) | `width`, `left`, `bottom`, padding | main thread (it reflows text); restyles only its users |
| View cross-fade, tab switch | CSS | `opacity`, `--hx-shift` (`left`, `right`) | opacity on the compositor; the 12 px shift is layout |
| Card height on a state change (owner decision), queue height | WAAPI | `height` | main thread, by decision |
| Hold to approve | rAF canvas draw and `clip-path` | canvas, `clip-path` | main thread, while held |
| Hover, press, focus colours | CSS | colour, background, `box-shadow` | main thread, small areas |
| Running dot | CSS | `opacity` | compositor |
| Orbs | orb2's own loop | canvas 2D | worker where supported, else main thread |

## Names and long names
- **Autoname** (`modules/bots/names.ts`): the curated list is shared data, `apps/shared/data/bot-names.json`, imported by the UI (bundled by Vite, so there is one copy; `scripts/sync-shared-data.sh` copies files into the plugin package and the plugin does not read this one). Availability is derived on every call from the bots the module holds (which the provider keeps current: the Hermes profiles once `bots` is live), never stored. "Surprise me" is the dice button and alt+R in the name field; an empty name is auto-named on create.
- **Long names** are cut with an ellipsis and shown whole as the tooltip while cut (`modules/bots/clips.ts`, `modules/cards/fit.ts`, the dock's `tipOf`); the accessible name always carries the whole name. Tests use the `long` fixture (`BOT_FIXTURES` in `mock-data.ts`): `createMockProvider({ fixtures: ['long'] })`, or `?fixture=long` in the e2e build only.

## The data seam
Modules read **only** through `DataProvider` (`src/data/provider.ts`): `Watch`/`Feed` streams plus commands. Never import `mock-data.ts` or `mock-provider.ts` from a module, never keep a second copy of data a provider owns, never fabricate a value (an unknown value is `null` and is shown as unknown). The live provider (`src/host/live-provider.ts` and `src/host/live/`: the Hermes gateway and the boopis plugin through the host) implements the same interfaces and serves the whole Sessions section (sessions, the conversation, approvals, blanks, the details panels, the run, diffs, file mentions); only `bots`, `schedules` and the feedforward catalog stay the mock's (`MOCK_SOURCES`), and the UI marks them Preview. Never show mock content in a live session; a value the sender did not give is shown as unknown. **A governed session is created with `toolsets: ["boopis"]`** (also when its mode is the plugin's default, and when that default could not be read), and a `plugin.boopis.mode.set` that fails is **fatal for that session**: it is closed, never bound, nothing is sent to it, and the error is shown in the conversation (`ensureLive` in `live-provider.ts`). Read `src/data/README.md` before touching anything under `src/data` or any module's data flow.

## How to test
```sh
cd apps/desktop/ui
pnpm install --frozen-lockfile
pnpm typecheck                # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
pnpm test                     # vitest: bus, state, settings, theme and contrast maths, hold timing, the keymap dispatcher, layout, cron, the mock provider, the feedforward reader
pnpm build                    # tokens check, typecheck, vite build
pnpm test:smoke [part]        # Playwright: boot, themes, the KEYMAP walk-through, the owner's decisions, the live provider over recorded frames, forms (every kind and state, the keyboard, the secret, plugin forms inline and in the dock), corners (no clipped container, the frame budget, six viewports), axe (zero violations); parts: boot themes keys owner live forms corners axe
pnpm test:parity              # LOCAL ONLY (not in CI): needs Chromium (`pnpm exec playwright install chromium` once, or the pre-installed one) and the v6 reference in design/v6; the v6 mock-up against the port at 1440x900 and 1920x1080, in every preset, session and bots; diffs in test-results/parity/ (gitignored)
```
CI runs `typecheck`, `test` and `test:smoke` (it installs Chromium with `pnpm exec playwright install --with-deps chromium`). `playwright` is pinned in `package.json`; on a machine with a pre-installed Chromium keep that pin equal to the installed version and do not run `playwright install`. The tests run at deviceScaleFactor 1 and serve a `vite build --mode e2e` (it exposes `window.__hx` for the tests; the production build has no global). Parity compares pixels with the orbs hidden (their idle motion is random by design) and again with every orb frozen to a still frame, plus the rects of every orb. **Any visible difference from v6 is a bug** unless you can name an intentional fix and list it below.

Intentional differences from v6, all invisible:
- accessible names contain their visible text (WCAG 2.5.3): the session rows say when they ran, the command field and the account button name their words; the avatar's initial is drawn by CSS; a space separates the row's parts and a key's chips in the markup;
- the dock hears the same approval, answer, state and message the Bots and Session tabs do (v6 passed events between modules and the dock missed some);
- a module that fails to mount shows a plain notice instead of v6's placeholder content (which was invented);
- fonts are bundled (`@fontsource`, latin) instead of fetched from Google, because the app runs under a strict CSP;
- the mock's streams persist what v6 lost (a turn typed in a non-first session survives switching away).

## What not to do
- Do not redesign, "improve", re-space or re-colour anything. If the design looks wrong, tell the owner; do not change it.
- Do not edit `design/v6/` (the reference). A change that only moves where motion runs (compositor, worker) does not touch it: the look is the same.
- Do not add a framework (no React). Do not add a dependency without an ADR (licences: STANDARDS section 5).
- Do not read `localStorage` directly: go through `core/settings` (wrapped, versioned). Do not use `console` directly: use `core/log`.
- Do not duplicate a primitive: look in `src/components` first (STANDARDS section 9); two places that need a helper put it in `core/` or `components/`.
- Do not hand-edit `src/styles/tokens.json`: `pnpm tokens` generates it from `tokens.css`, and the build checks it.
- Do not make the UI depend on the dock: everything it shows is reachable elsewhere.
- Do not add a global key inside a module: the shell owns global keys (`keymap.ts`); modules handle keys on their own elements and call `preventDefault()`.
- Commits are the owner's alone: `scripts/setup-hooks.sh` once, no co-author lines, nothing that names an agent, a model or a tool.
