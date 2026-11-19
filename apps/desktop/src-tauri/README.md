# hypotaxis-host

The desktop app's Rust host: the **machine authority**. It finds and starts Hermes, proxies `hermes-gateway-v1` between the UI windows and one shared gateway link per profile, keeps secrets in the OS keychain (and hands them to the Hermes plugin over a private local socket), and provides notifications, a folder picker and a link opener. It serves the UI and never renders it.

**Public API** (the library `hypotaxis_host`): `gateway::Hub` (the proxy), `endpoint::{Endpoint, EndpointConfig}`, `hermes::{Supervisor, Environment}`, `secrets::{SecretStore, Keychain, channel}`, `settings::AppSettings`, and the typed commands in `commands`. The UI-facing contract is generated into `../ui/src/host/bindings.ts`.

**Invariants**: no ticket, token or secret reaches the webview or a log; no `Origin` header on the gateway socket and loopback only for the local endpoint; frames are validated and never altered (only a request's top-level `id`); a response is never dropped; every queue is bounded; every child process gets an allowlisted environment, a timeout and an output cap; failures carry stable codes.

Read `../AGENTS.md` (the host half) before editing. Tests: `cargo test -p hypotaxis-host`; the real-gateway test is `tests/live_gateway.rs` (set `HX_E2E_HERMES_ENV`).
