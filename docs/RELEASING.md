# Releasing: the workflows and the AppImage

Two workflows live in `.github/workflows/`. Neither can be run locally; `actionlint` checks their syntax and the job commands were run by hand where a machine allows (see "What is verified where" at the end).

## Getting the AppImage
- **Every push to `develop`:** open the `release` run in the Actions tab, then download the artifact `hypotaxis-linux-x86_64-appimage` (the `.AppImage` and `SHA256SUMS`, kept 30 days). Windows (`hypotaxis-windows-x86_64-nsis`) and macOS (`hypotaxis-macos-aarch64-dmg`) bundles are there too when those jobs built.
- **A tag `vX.Y.Z`:** push a tag that equals `version` in `apps/desktop/src-tauri/tauri.conf.json` (the build fails when they differ). The `release` job then publishes a GitHub release with the AppImage, the other bundles that built, and `SHA256SUMS`. Download from the repository's Releases page, or `gh release download vX.Y.Z -R aphesist/hypotaxis`.
- Verify: `sha256sum -c SHA256SUMS --ignore-missing`.

## Running it on Arch
```sh
sudo pacman -S fuse2 webkit2gtk-4.1 gtk3 gnome-keyring   # fuse2 to mount AppImages; keyring for secret_set
chmod +x Hypotaxis_*.AppImage
./Hypotaxis_*.AppImage
# without fuse2:  ./Hypotaxis_*.AppImage --appimage-extract-and-run
```
Install Hermes v0.23.2 or newer first (`curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`; the app does not run it). A blank window under Wayland with NVIDIA: `WEBKIT_DISABLE_DMABUF_RENDERER=1`. More in `apps/desktop/AGENTS.md`. Builds are unsigned.

## `ci.yml` (every push and pull request)
All jobs run in parallel on `ubuntu-22.04` and are cached (cargo through `Swatinem/rust-cache`, uv, pnpm, Playwright's Chromium, the Hermes install). Runs on a ref are cancelled by the next push to it.

| Job | What it checks |
|---|---|
| `identity` | every commit new on the branch is authored and committed by `aphesist`, with no attribution lines (`scripts/check-commit-identity.sh`) |
| `checks` | `sync-shared-data.sh --check`, `gen-hx-types.py --check`, `vendor-contraprova.sh --check` |
| `rust` | `cargo fmt --check`, `clippy --workspace --all-targets -D warnings`, `cargo test --workspace`, the Tauri host included (WebKitGTK apt packages); the bindings test is the staleness check for `bindings.ts` |
| `hx` | builds the `hx` binary once and shares it with `plugin` and `e2e` |
| `plugin` | ruff (check and format), pyright and pytest on Python 3.11 and 3.14, no Hermes needed |
| `ui` | `pnpm typecheck`, `pnpm test` (vitest), Playwright smoke with Chromium |
| `e2e` | **non-blocking for now** (`continue-on-error`): real Hermes v0.23.2 plus the fake model, `tests/e2e`, and the two sandbox tests that import Hermes's modules |

`e2e` is non-blocking because it has not yet run on a hosted runner (cold install of about 2.4 GB, a gateway, a sandbox). Remove `continue-on-error: true` once it has been green for a few runs.

The Hermes install (`scripts/install-hermes-e2e.sh`, the S0 spike's steps: a source copy of the tag, then Hermes's own `setup-hermes.sh --runtime-only`) is cached under `/home/runner/hermes-e2e`, keyed on Hermes's version and that script. `tests/e2e/stack.py` gives each run a fresh temp `HERMES_HOME` and a single fake provider, so there is no egress. To bump Hermes, change `HERMES_TAG` in the script and the cache key in both workflows.

Why 22.04: `hx-sandbox` needs unprivileged user namespaces, which 24.04 restricts through AppArmor. Each sandbox job also runs `sysctl kernel.apparmor_restrict_unprivileged_userns=0` (ignored on 22.04), so moving the image to 24.04 later should keep working.

**Secrets.** `CONTRAPROVA_TOKEN` (optional, a read-only fine-grained token for `aphesist/contraprova`): the vendor check and the plugin job's contraprova install clone it, and need the token when it is private.

## `release.yml` (push to `develop`, tags `v*`, manual)
- `linux`: Tauri release build for `x86_64-unknown-linux-gnu`, AppImage only (`NO_STRIP=true`); uploads the AppImage and its checksum.
- `smoke`: runs the built AppImage under `xvfb-run` through `tests/e2e/smoke_desktop.py` (WebKitWebDriver) against the cached Hermes and the fake model: the UI loads, the host connects, a prompt streams a reply; first a cheap check that the AppImage extracts and every library resolves. Non-blocking, screenshot kept as `smoke-screenshot`.
- `windows` (NSIS) and `macos` (dmg, Apple silicon): non-blocking, unsigned.
- `release` (tags only): GitHub release from the artifacts plus `SHA256SUMS`.

**Bundle.** The Linux job builds `hx` in release mode, runs `scripts/stage-bundle.sh` and builds with `tauri.bundle.conf.json`, so the AppImage carries the `hx` sidecar and the plugin. Windows and macOS builds still lack both (marked TODO in the workflow). The smoke job first runs first-run setup against the e2e Hermes (`cargo test -p hypotaxis-host --test setup_live`), then the session check.

**Updater signing slot.** The workflow passes `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from repository secrets. They are empty and unused while `bundle.createUpdaterArtifacts` is off. To turn the updater on: `pnpm dlx @tauri-apps/cli@2 signer generate`, store the private key and password as those two secrets, put the public key in `tauri.conf.json` under `plugins.updater.pubkey` and set `createUpdaterArtifacts`. Never commit a key.

## The Rust toolchain pin
CI builds with Rust **1.97.0** (`dtolnay/rust-toolchain@1.97.0`, and `RUSTUP_TOOLCHAIN: "1.97.0"` in both workflows' `env`, which overrides `rust-toolchain.toml`'s floating `stable`). New stable releases add clippy lints, so an unpinned runner can turn a green tree red overnight. To bump: change the version in every `dtolnay/rust-toolchain@` line and in `RUSTUP_TOOLCHAIN`, run `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` on that version, fix what it reports, and commit the lot together. `rust-version` in `Cargo.toml` is the minimum, not the pin.

## What is verified where
- **Locally:** `actionlint` on both workflows (clean); `identity`, `checks` (all three `--check`s), `rust` (fmt, clippy `-D warnings`, `cargo test --workspace`: 496 passed), `plugin` (ruff, pyright and pytest, 3.11 and 3.14, with the same deselects), `e2e` (25 passed against the spike's Hermes install), `ui` typecheck, vitest (174 passed) and the Playwright smoke (156/156, with the pre-installed Chromium).
- **Only in CI:** the Hermes install script and its cache, the apt installs, the `smoke` job, the whole `release` build (disk), the Windows and macOS builds, the release creation, and the `CONTRAPROVA_TOKEN` path.
