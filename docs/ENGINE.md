# The engine boopis runs on

boopis runs on **Hermes Agent**, unmodified (ADR-0001, ADR-0023). The app carries its own copy and never names it (ADR-0031, `docs/BRANDING.md`); this page is where the repository says how to choose another one.

## Which engine a run uses

| Choice | How | What it means |
|---|---|---|
| bundled (default) | nothing | The engine this build carries, unpacked on first run into `<app data>/runtime/<version>-<sha8>/`, with a private home `<app data>/engine/` (`~/.local/share/dev.aphesist.boopis/engine` on Linux). It never reads `~/.hermes` or any `HERMES_*` variable. |
| existing | `boopis --engine existing`, or `BOOPIS_HERMES=existing` | The `hermes` already on this machine (`PATH`, `~/.local/bin`, Hermes's own places), in its own home (`HERMES_HOME`, else `~/.hermes`). Setup installs the boopis plugin into that home and asks before it changes any setting. |

- `--engine <bundled|existing>` (also `--engine=<word>`) comes first on the command line, before any command: `boopis --engine existing`, `boopis --engine existing doctor`. Any other word is an error (exit 2).
- The flag wins over `BOOPIS_HERMES`; with neither, the bundled engine runs. A build that carries no engine (`cargo run`, a source build) always uses the machine's.
- The choice is read once, at start. The app has no setting for it, and the `hermes_source` key an older build saved in `settings.json` is no longer read.
- With `existing` and no `hermes` installed, setup stops at the engine step (`hx.setup.engine_missing`). Install Hermes with its own installer (`curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`, or `iex (irm https://hermes-agent.nousresearch.com/install.ps1)` on Windows), then choose Check again. boopis never runs the installer.
- `boopis doctor` shows which engine the next start uses and its home ("engine home").

## Where the engine keeps things

| Path | What |
|---|---|
| `<app data>/runtime/<version>-<sha8>/` | the unpacked engine (launcher, Python, its packages); older ones are removed after a successful setup |
| `<app data>/engine/` | the engine's home: `config.yaml`, `.env`, sessions, the boopis plugin (`plugins/boopis/`), boopis's own files (`boopis/`: ledger, journals, `hx`, `setup.json`) |
| `<app data>/engine/profiles/<bot>/` | a bot's own folder (the engine calls it a profile): instructions (`SOUL.md`), memory, skills, schedule |

Builds before ADR-0031 called the home `hermes-home/`. The first start of a newer build moves it once (`apps/desktop/src-tauri/src/migrate.rs`, `engine_home`): it stops a gateway an earlier run left serving from it, renames the folder and rewrites the paths its `config.yaml` files hold. The log says what moved.
