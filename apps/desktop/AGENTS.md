# AGENTS.md: apps/desktop

The desktop app is a Tauri host (`src-tauri/`, Rust) and a UI (`ui/`, TypeScript, Vite, no framework). This file has two halves: **the host half** (`src-tauri/`, next), then **the UI half** (`ui/`).

# The host half: `src-tauri/`

## Job
The host is the **machine authority** of the three-authority model (`docs/ARCHITECTURE.md` section 1). It owns the Hermes lifecycle, the gateway connection, the OS keychain, windows, notifications and folder pickers, and it serves the UI. It does not render, and it does not decide any work (sessions, tools, governance and the ledger are the backend's). Crate `hypotaxis-host`, library `hypotaxis_host`, binary `hypotaxis`, identifier `dev.aphesist.hypotaxis`.

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
    lib.rs        the registry (tauri-specta), run(), the two guard tests (capability list, bindings freshness)
    commands.rs   every UI-facing command and the typed ConnectionStateEvent; Frame (raw JSON out)
    error.rs      Error, stable codes, HostError
    config.rs     Limits (every number as data) and REQUIRES_HERMES
    state.rs      Hubs: one proxy per profile, the connection index
    endpoint.rs   Endpoint trait: Local (ensure/attach), Remote {url, token} and Cloud {control_plane, session} (typed, unavailable)
    hermes/       discover (binary, version, install-stamp.json, HERMES_HOME), cli (allowlisted env, timeout, cap),
                  attach (verdict, Ticket, Dial), control (the gateway control socket), lifecycle (Supervisor), install (stub)
    gateway/      frame (validate), link (the transport traits), ws (tokio-tungstenite), outbox (bounded queue, coalescing),
                  reconnect (the pure state machine), hub (the shared link and its API), actor (dial, handshake, serve, replay),
                  route (response, event and server-request routing), metrics, tests (a scripted gateway)
    secrets/      store (SecretStore: Keychain, MemoryStore for tests), channel (the plugin socket)
    setup/        first-run setup: mod (the engine, forms, steps), ops (HermesOps: Hermes's CLI behind a trait), install (copy the plugin, place hx, find the bundle), providers (detect, ask for keys, wire, ladder), state (setup.json)
    settings.rs   versioned AppSettings and its migration; os.rs (URL allowlist, home-relative paths, notification bounds)
  tests/live_gateway.rs   the proxy against a real Hermes gateway and the fake model (skips without HX_E2E_HERMES_ENV)
  tests/setup_live.rs     first-run setup on a fresh profile against a real Hermes (skips without HX_E2E_HERMES_ENV and an hx binary)
  examples/secret_channel_server.rs   the real secret channel over an in-memory map, for the plugin's Python tests
```

## Hermes lifecycle
1. **Discover** (`hermes::discover`): `hermes` on `PATH`, then `~/.local/bin`, then Hermes's own places; `hermes --version`; `install-stamp.json` near the install. **`HERMES_HOME` wins, else `~/.hermes`** (Windows: `%LOCALAPPDATA%\hermes`; `HERMES_DATA_DIR_SUFFIX` is honoured). A named profile lives in `<root>/profiles/<name>` (ADR-0006: attach to the active profile by default; a setting switches).
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
- **Transport**: a Unix socket `host.sock` (mode `0600`) in `$XDG_RUNTIME_DIR/hypotaxis/` (else `<data dir>/hypotaxis/run/`, mode `0700`). A live host is never replaced; a stale socket is. Windows would use a named pipe with a user-only ACL: **not implemented** (`start` says so and the plugin gets no secrets there yet).
- **Rendezvous**: `<hermes home>/hypotaxis/host-channel.json`, mode `0600`, rewritten atomically on every host launch: `{schema_version: 1, protocol, socket, token, pid}`. The plugin reads it per request, so it needs no restart when the host restarts; a missing file, a dead pid or a refused connection means "no host".
- **Authentication**: a per-launch 256-bit token (`getrandom`), compared in constant time, and the peer's uid must equal the owner of the socket directory. The token never appears in a log line (`Debug` redacts it).
- **Protocol**: one JSON line in, one out, then close; reads are capped at 8 KiB and 2 s. Request `{"v":1,"token":"...","op":"get"|"has","service":"hypotaxis.<scope>","account":"<name>"}`; reply `{"v":1,"protocol":"hx-host-secrets-v1","ok":true,"value":"..."}` or `{"ok":false,"code":"hx.secrets.not_found"|"hx.secrets.unavailable"|"hx.host.unauthorized"|"hx.invalid_params"|...}`. `has` returns `{"found": bool}`. **There is no write op and no list op**; only the `hypotaxis.` service namespace is reachable (a ref `secret://<scope>/<name>` is service `hypotaxis.<scope>`, account `<name>`).
- **The plugin side** is `plugins/hypotaxis/hostsecrets` (built): Hermes's secret source `hypotaxis_host`, configured as `secrets.hypotaxis_host.{enabled: true, env: {VAR: secret://scope/name}}` (Hermes runs a source only when its section says `enabled: true`). A ref `secret://<scope>/<name>` is service `hypotaxis.<scope>`, account `<name>`, and the variable is derived (`secrets/refs.rs`, data in `crates/hx-proto/secret-refs.json`, tested against both languages). A missing or dead host is `NETWORK` (Hermes keeps its own `.env`), a missing secret a warning, a wrong token `AUTH_FAILED`. It never logs a value or the token. In the cloud (ADR-0019) the same source would read the control plane instead.
- **Keychain**: the `keyring` crate (v4): the **Secret Service** on Linux (GNOME Keyring, or KWallet 6 with its Secret Service enabled), Keychain on macOS, Credential Manager on Windows. With no Secret Service running the error is `hx.secrets.unavailable` with a message naming the fix. Calls run in `spawn_blocking` (a D-Bus round trip). Tests use `MemoryStore` behind the `SecretStore` trait; no secret is ever written to a plaintext file.

## First-run setup
`setup_check` (read-only) and `setup_advance` drive `setup::Setup`. Every call recomputes the steps from reality, so it resumes after an interruption and running it again changes nothing that is already right; `<home>/hypotaxis/setup.json` (versioned, atomic) holds only decisions and what is pending, never a secret.
1. **Hermes** is found; if missing, the status carries the documented command and `hx.setup.hermes_missing` (the UI offers "Check again"). Nothing is installed here.
2. **The plugin** is copied to `<home>/plugins/hypotaxis/` (never edited in place: copy to `.hypotaxis.new`, swap, remove the old one; an upgrade keeps the user's settings, which live in `config.yaml`) and enabled with `hermes plugins enable`.
3. **`hx`** is copied to `<home>/hypotaxis/bin/hx` and `plugins.entries.hypotaxis.settings.hx_path` is set.
4. **One consent form** (`setup.config`, kind `setup`) shows the exact diff for `tools.tool_search.enabled: "off"`, `delegation.backend: hypotaxis` and `allow_gateway_injection: true`. Only after the user agrees are they written, with `hermes config set` (Hermes's `config.set` RPC takes only display and session keys, so the CLI is the route). A decline is respected: the step says what will not work and offers "Review again" or a dedicated profile (ADR-0006).
5. **Models and keys** (`providers.rs`): named `providers:` entries and keys by name in `.env` are detected. Claude available (an Anthropic key in `.env` or the keychain) means the plugin's default ladder stands. Otherwise a `choice` form (`setup.ladder`) picks `anthropic` or a configured `provider/model`, a missing key is a `credential` form (`setup.credential.<provider>`), the value goes to the keychain and is wired with `providers.<name>.key_env`, `secrets.hypotaxis_host.env.<VAR>` and `secrets.hypotaxis_host.enabled: true`, and a single-tier ladder is written. The claude-subscription plugin is only noted in the receipt (its provider and model names are not known here).
6. **Restart** once at the end if anything changed, then verify the plugin is enabled, then the receipt.
Answers are checked against the form the host last showed (`pending_form`), so a stale or foreign answer is `hx.setup.invalid_answer` and stores nothing. The webview's `Answer.secrets` is the only place a secret enters the host from the UI during setup.

**Bundling.** `tauri.conf.json` lists nothing to bundle, so `cargo build` and `cargo test` need no staging. For the AppImage run `scripts/stage-bundle.sh` (the plugin without tests and caches, and `hx` as `binaries/hx-<triple>`), then `cargo tauri build --bundles appimage --config src-tauri/tauri.bundle.conf.json`. At run time `Bundle::locate` finds the plugin in the resource directory and `hx` beside the executable; a debug build falls back to the repository's plugin. The AppImage is not built in CI here (disk); the staging script and the locate logic are tested, the bundle itself is not.

## Endpoints (ADR-0018 seam)
`trait Endpoint { connect() -> GatewayConn }`. `Local` is done. `Remote {url, token}` and `Cloud {control_plane, session}` are typed and return `hx.hermes.unavailable` "not yet supported". Neither the proxy nor the UI knows the kind. A remote token belongs in the keychain, never in settings (`EndpointConfig` redacts it in `Debug`).

## Typed commands and bindings
`tauri-specta` generates `ui/src/host/bindings.ts` from the registry in `lib.rs`. **Never edit it.** The test `bindings_are_fresh` (CI runs it) fails when it is stale; refresh with `HX_UPDATE_BINDINGS=1 cargo test -p hypotaxis-host bindings`. `Frame` and `Json` are typed `unknown` in TypeScript (specta cannot export `serde_json::Value`'s 64-bit numbers); the UI narrows them with Hermes's generated contract.

## How to run
```sh
# Linux prerequisites (Debian/Ubuntu names; on Arch: webkit2gtk-4.1 gtk3 librsvg libsoup3 base-devel)
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev build-essential pkg-config

export CARGO_TARGET_DIR=...   # keep builds out of the tree on a small disk; CARGO_INCREMENTAL=0
cargo fmt -p hypotaxis-host --check && cargo clippy -p hypotaxis-host --all-targets -- -D warnings
cargo test -p hypotaxis-host                          # unit tests, the capability and bindings checks
HX_E2E_HERMES_ENV=<spike install> cargo test -p hypotaxis-host --test live_gateway -- --nocapture
                                                      # real gateway + fake model; prints BUDGETS; skips without the variable
cargo install tauri-cli --locked   # or: pnpm dlx @tauri-apps/cli@2
cargo tauri dev  (from src-tauri)  # runs the UI with the live provider (`vite --mode desktop`)
NO_STRIP=true cargo tauri build --bundles appimage            # the Linux bundle; add --debug on a small disk
HX_E2E_HERMES_ENV=<spike install> python3 tests/e2e/smoke_desktop.py <the .AppImage> shot.png
                                                      # headless: Xvfb + WebKitWebDriver drive the real app
```
- **Wayland and X11**: GTK picks the backend from the session; both work. If the window is blank under Wayland with NVIDIA (a WebKitGTK DMABUF issue), run with `WEBKIT_DISABLE_DMABUF_RENDERER=1`; `GDK_BACKEND=x11` forces X11. The smoke test runs under X11 (Xvfb).
- **Arch**: running an AppImage needs `fuse2` (`pacman -S fuse2`), or run it with `--appimage-extract-and-run` (or `APPIMAGE_EXTRACT_AND_RUN=1`). For secrets install and unlock `gnome-keyring`, or enable the Secret Service in KWallet 6; without one, `secret_set` fails with `hx.secrets.unavailable`. Hermes itself: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash` (the app does not run it).
- The bundle is AppImage only (the owner runs Arch); `.deb` is not built.
- Logs go to stderr (`RUST_LOG`). Rotating files in the profile's `logs/hypotaxis/` (STANDARDS section 4) are not done yet.

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
  src/components/       the HX.ui library, one module per primitive (hold, composer, orb, layer, ...); components.css
  src/modules/          shell, session, bots, dock, cards: each module's TS and CSS
  src/styles/           tokens.css (+ tokens.json, generated), theme.ts (runtime), theme-panel.ts, fonts.ts, index.ts (the cascade order)
  src/data/             THE DATA SEAM: types, provider interfaces, mock provider, README.md
  src/host/             the bridge to the Rust host: bindings.ts (generated, never edited), bridge, gateway client, live provider, map
  src/vendor/hermes-shared/  Hermes's generated gateway contract types (MIT), pinned, with NOTICE and PIN.json
  vendor/               orb-avatar.min.js (the owner's <orb-avatar> web component, MIT) and its .d.ts
  tests/                smoke (Playwright), parity (v6 against the port), lib.mjs
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
| Continuous corners (`corner-shape: superellipse(1.8)`), larger nominal scale; round arc as the fallback | `components.css`, `components/shape.ts` | parity |
| **Every composer can talk**: a mic in each one (session, Bots tab, dock session); the bot's orb listens while you talk; alt+V talks | `components/composer.ts` | smoke: alt+V in the session and the dock |
| Graphite and Typewriter have a real accent (`#9db6cf`, `#7ea6e0`) | `tokens.css` | parity; contrast |
| **Smart and the model picker** (owner, later): **alt+M opens the model picker while Smart stays ON**; its first entry is "Smart" (automatic; the current choice while Smart is on) and then the models; choosing a model pins it and turns Smart off; choosing Smart keeps or turns it back on; Esc changes nothing; with Smart on the model chip stays hidden and the picker opens against the Smart chip; tooltips: Smart = "Picks the model for each message", off = "You pick the model" | `modules/session/composer.ts` | smoke: alt+M, pick a model, alt+M, pick Smart |
| Keyboard first: every action has a key in `KEYMAP.md`; the keymap table feeds the sheet, Settings and the palette | `modules/shell/keymap.ts` | unit: `keymap.test.ts` (the dispatcher); smoke: the whole walk-through |

Also binding: tokens, never literals, for colour, type, radius and space (the CSS is v6's, with no literal colours; do not add any); WCAG 2.2 AA (labels, roles, focus order, contrast, **label in name**: an accessible name must contain the visible text, in order); `<orb-avatar>` stays a vendored web component.

## The data seam
Modules read **only** through `DataProvider` (`src/data/provider.ts`): `Watch`/`Feed` streams plus commands. Never import `mock-data.ts` or `mock-provider.ts` from a module, never keep a second copy of data a provider owns, never fabricate a value (an unknown value is `null` and is shown as unknown). The live provider (`src/host/live-provider.ts` and `src/host/live/`: the Hermes gateway and the hypotaxis plugin through the host) implements the same interfaces and serves the whole Sessions section (sessions, the conversation, approvals, blanks, the details panels, the run, diffs, file mentions); only `bots`, `schedules` and the feedforward catalog stay the mock's (`MOCK_SOURCES`), and the UI marks them Preview. Never show mock content in a live session; a value the sender did not give is shown as unknown. Read `src/data/README.md` before touching anything under `src/data` or any module's data flow.

## How to test
```sh
cd apps/desktop/ui
pnpm install --frozen-lockfile
pnpm typecheck                # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
pnpm test                     # vitest: bus, state, settings, theme and contrast maths, hold timing, the keymap dispatcher, layout, cron, the mock provider, the feedforward reader
pnpm build                    # tokens check, typecheck, vite build
pnpm test:smoke [part]        # Playwright: boot, themes, the KEYMAP walk-through, the owner's decisions, the live provider over recorded frames, axe (zero violations); parts: boot themes keys owner live axe
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
- Do not edit `design/v6/` (the reference).
- Do not add a framework (no React). Do not add a dependency without an ADR (licences: STANDARDS section 5).
- Do not read `localStorage` directly: go through `core/settings` (wrapped, versioned). Do not use `console` directly: use `core/log`.
- Do not duplicate a primitive: look in `src/components` first (STANDARDS section 9); two places that need a helper put it in `core/` or `components/`.
- Do not hand-edit `src/styles/tokens.json`: `pnpm tokens` generates it from `tokens.css`, and the build checks it.
- Do not make the UI depend on the dock: everything it shows is reachable elsewhere.
- Do not add a global key inside a module: the shell owns global keys (`keymap.ts`); modules handle keys on their own elements and call `preventDefault()`.
- Commits are the owner's alone: `scripts/setup-hooks.sh` once, no co-author lines, nothing that names an agent, a model or a tool.
