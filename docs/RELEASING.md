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
Nothing else to install: the app carries Hermes (see "The Hermes runtime"). On first run it unpacks it into `~/.local/share/dev.aphesist.hypotaxis/runtime/` and gives it a private home in `.../hermes-home/`; it never reads or writes `~/.hermes`. Builds are unsigned.

**If the window is blank or the app stutters.** The host chooses WebKitGTK's renderer itself from the machine's GPUs, session and WebKitGTK version (ADR-0024, ADR-0025); do not launch with `WEBKIT_DISABLE_DMABUF_RENDERER=1` as a habit. It forces CPU painting of every frame, which is the slowest path there is.
- `HYPOTAXIS_RENDERER=shm` is the first thing to try for a blank window: it keeps GL compositing and copies frames through shared memory (`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`). `HYPOTAXIS_RENDERER=cpu` is the old CPU switch, a last resort.
- `HYPOTAXIS_GPU=dedicated` (also Settings > General) renders on a hybrid laptop's NVIDIA GPU; `auto` does so only on AC power with WebKitGTK 2.54.2 or later.
- Settings > General > Diagnostics shows what this machine really uses (renderer, GPU, WebKitGTK version and origin, refresh rate) and copies the report; attach it to a bug.

Another Hermes on the machine: `HYPOTAXIS_HERMES=existing` makes the app use the `hermes` it finds, in your own `HERMES_HOME` (the advanced setting). More in `apps/desktop/AGENTS.md`.

## The Hermes runtime (ADR-0023)
The installer carries `hermes-runtime-<os>-<arch>.tar.zst` and its `runtime.json` (`resources/runtime/`, a Tauri resource): python-build-standalone, `uv` and Hermes v0.23.2 with its locked, hash-checked dependencies, unmodified.

**Build.** `scripts/build-runtime.sh [--out dist/runtime]` (Linux and macOS shell; needs `git`, `curl`, GNU `tar`, `zstd`, Python 3.11 or newer to run Hermes's build code, and `llvm-strip`; about two minutes with a warm cache). It clones the tag (or uses `HERMES_SRC`) and runs `scripts/runtime/build_payload.py`, which calls Hermes's own payload builders in the order of its `scripts/bundles/native.py`: the pinned interpreter and uv (hashes from `pm/lock.json`), the package manager's own runtime (`pm-runtime/`, without which `hermes plugins enable` refuses), the locked `venv/` for the extras in `RUNTIME_EXTRAS` (default `anthropic,mcp,uvloop`, beside the core ones Hermes resolves) with `enabled-features.json`, the install stamp, the dist-info, the launchers and `manifest.json`. Nothing is patched.
- **Left out:** Chromium, Node, npm, pnpm, ffmpeg, ripgrep, cua-driver, the uv cache, baked bytecode and every extra not listed. Hermes's package manager fetches what a feature needs on first use, into the private home's `tools/` (a sealed payload's writable store), with consent.
- **Trimmed:** the interpreter loses its tests, IDE, Tk, headers, the shared `libpython` (nothing loads it: the executable carries its own) and, with `llvm-strip`, its debug symbols (binutils' `strip` corrupts that file). Hermes's tools digests are recorded over the trimmed bytes.
- **Sizes (linux-x86_64, v0.23.2):** archive 88,572,422 bytes (84.5 MiB), 401,653,760 bytes unpacked (383 MiB): `venv` 181 MB, `hermes-agent` 112 MB, `tools` 90 MB (interpreter and uv), `pm-runtime` 1.4 MB. The archive is already compressed, so the AppImage grows by the archive's size, not the unpacked size. The first working version (no `pm-runtime`, no uv, fewer extras) was 96 MB because it kept the shared `libpython` and debug symbols; trimming took 20 MB off.
- **AppImage size, before and after:** the AppImage was not built where this was written (a release build and its bundle need more disk than the machine had), so there is no measured pair. The embedded archive is incompressible, so after = before + 88.6 MB (squashfs overhead is a few KB). Every `release` run prints the real figure (`AppImage:` and `of which the Hermes runtime archive:`) in its job summary; copy the first one here when it exists.
- **Relocation proof.** `scripts/verify-runtime.sh <dir>` unpacks the archive into `A/x` and `B/deeper/path with space`, runs `hermes --version` and the interpreter from each with an empty environment and a scratch `HOME`, checks that Hermes reports each copy's own path, that `hermes update` refuses, that every ELF file resolves its libraries, that no `~/.hermes` appeared, and that the two trees are byte-identical (`diff -r`). The build itself fails if any file names the build directory. Both CI workflows run it.

**First run (the host).** `src-tauri/src/runtime.rs`: the setup's first step reads `runtime.json`, hashes the archive while it extracts it into `<app data>/runtime/.unpack-<id>-<pid>/`, refuses on a mismatch, writes a marker file last and moves the tree to `runtime/<hermes version>-<sha8>/` with one `rename`. A re-run is a no-op (the marker names the hash). Older runtimes are removed by `remove_old` only after the gateway restarted on the new one, and only directories carrying the marker. The private home is `<app data>/hermes-home/`; the Hermes children get no `HERMES_*` or `UV_*` variable from the user's environment, and `PYTHONPYCACHEPREFIX` points into the app's cache. Hermes's own update check is switched off through its config (`updates.check: false`, set with `hermes config set`; `hermes update` also refuses, because the install stamp names the app as steward). A failure is a blocked step in the setup form with a stable code (`hx.setup.runtime_missing`, `_hash_mismatch`, `_corrupt`, `_unpack_failed`, `_manifest_invalid`) and a sentence saying what to do (reinstall; free disk space).

**Bumping Hermes.**
1. Change `HERMES_TAG` in `scripts/build-runtime.sh`, `REQUIRES_HERMES` in `src-tauri/src/config.rs` and `requires_hermes` in the plugin if the floor moves, and the `vendor/hermes-agent` submodule pin.
2. Run `scripts/build-runtime.sh` and `scripts/verify-runtime.sh`, then the gate with `HX_E2E_RUNTIME_ARCHIVE=dist/runtime cargo test -p hypotaxis-host --test setup_live bundled`, and the plugin's e2e suite with `HX_E2E_RUNTIME=<unpacked dir>`. CI does the same on the pull request; the cache key includes the scripts, so it rebuilds.
3. The archive's name does not change, its hash does, and so does the runtime's directory name: users get the new Hermes with the next app update, and the old folder is removed after the gateway runs on the new one.
4. If Hermes changed its payload builders (`scripts/bundles/native.py`, `scripts/build/agent.py`) `build_payload.py` follows them; it calls their functions rather than copying them, so a rename fails the build loudly.

**Not done yet.**
- **Updater.** It needs a signing key the owner creates (see "Updater signing slot"); none was generated. It plugs in at one place: the updater ships a new app version, which carries a new `runtime.json` and archive; the next start finds `Runtime::locate` pointing at a runtime that is not unpacked, `setup_check` answers `needed`, and the setup unpacks it, restarts the gateway and removes the old one. So the updater needs no Hermes logic: it only has to replace the app. The AppImage bundle is the only target the updater can replace in place on Linux; a native package (below) updates through the package manager instead.
- **macOS.** `build-runtime.sh` is written for it (`gtar`, Mach-O `strip -S` is not wired: only Linux strips) but has not run there; the runtime must be built on an Apple-silicon runner (`aarch64-apple-darwin`), the bundle must carry it (the macOS job has a TODO) and the whole app must be signed and notarised, including the interpreter and every `.so` in the runtime, which are unpacked into the app's data folder and must carry valid signatures to run under Gatekeeper's hardened runtime.
- **Windows.** `build-runtime.ps1` is not written (`assemble` needs Hermes's distlib launcher mint for `Scripts\*.exe`), the host's `Bundled` path uses `bin/hermes` (`hermes.cmd` or `.exe` on Windows: `runtime.json` already carries the launcher's path, so only the script changes), long-path and antivirus behaviour on a 400 MB unpack are unmeasured, and the secret channel has no Windows transport yet.
- **Linux aarch64** is the same script on an arm64 runner.
- **A native Arch package** is a separate step. What it depends on from this layout: `runtime.json` and the archive are plain files that can be installed to `/usr/lib/hypotaxis/runtime/` (the host looks in the resource directory; the package would point it there), or the package can ship the unpacked tree and the host would skip the unpack when `runtime/<id>/` is already present (the marker file is the check); the host takes the system's WebKitGTK; `HYPOTAXIS_HERMES=existing` is the fallback for a package that depends on `hermes-agent` instead.

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
| `runtime` | builds the Hermes runtime the installer ships (`scripts/build-runtime.sh`, cached on the scripts) and proves it relocatable (`scripts/verify-runtime.sh`); uploads `hermes-runtime-linux-x86_64` |
| `e2e` | **non-blocking for now** (`continue-on-error`): the `runtime` artifact unpacked (what ships), plus the fake model: `tests/e2e`, the sandbox tests (also on the bundled interpreter), and the host's first-run test, which unpacks the archive itself (`setup_live bundled`) |

`e2e` is non-blocking because it has not yet run on a hosted runner (cold install of about 2.4 GB, a gateway, a sandbox). Remove `continue-on-error: true` once it has been green for a few runs.

`e2e` runs on the runtime the installer ships (`HX_E2E_RUNTIME`, an unpacked archive), not on a separate Hermes install. `tests/e2e/stack.py` gives each run a fresh temp `HERMES_HOME` and a single fake provider, so there is no egress. `scripts/install-hermes-e2e.sh` (Hermes's own `setup-hermes.sh --runtime-only`, cached under `/home/runner/hermes-e2e`) remains only for `release.yml`'s `smoke` job, which drives the AppImage through `smoke_desktop.py`; moving it to the runtime is left. To bump Hermes, see "The Hermes runtime".

Why 22.04: `hx-sandbox` needs unprivileged user namespaces, which 24.04 restricts through AppArmor. Each sandbox job also runs `sysctl kernel.apparmor_restrict_unprivileged_userns=0` (ignored on 22.04), so moving the image to 24.04 later should keep working.

**Secrets.** `CONTRAPROVA_TOKEN` (optional, a read-only fine-grained token for `aphesist/contraprova`): the vendor check and the plugin job's contraprova install clone it, and need the token when it is private.

## `release.yml` (push to `develop`, tags `v*`, manual)
- `runtime`: the Hermes runtime for linux-x86_64 (same script and cache key as `ci.yml`), proved relocatable, uploaded as `hermes-runtime-linux-x86_64` (not `hypotaxis-*`, so a release does not publish it).
- `linux` (needs `runtime`): Tauri release build for `x86_64-unknown-linux-gnu`, AppImage only (`NO_STRIP=true`); uploads the AppImage and its checksum.
- `smoke`: runs the built AppImage under `xvfb-run` through `tests/e2e/smoke_desktop.py` (WebKitWebDriver) against the cached Hermes and the fake model: the UI loads, the host connects, a prompt streams a reply; first a cheap check that the AppImage extracts and every library resolves. Non-blocking, screenshot kept as `smoke-screenshot`.
- `windows` (NSIS) and `macos` (dmg, Apple silicon): non-blocking, unsigned.
- `release` (tags only): GitHub release from the artifacts plus `SHA256SUMS`.

**Bundle.** The Linux job builds `hx` in release mode, downloads the runtime artifact, runs `scripts/stage-bundle.sh --runtime <it>` and builds with `tauri.bundle.conf.json`, so the AppImage carries the `hx` sidecar, the plugin and the Hermes runtime (`resources/runtime/`), and prints the AppImage's size in the job summary. Windows and macOS builds still lack all three (marked TODO in the workflow). The smoke job first runs first-run setup against the spike Hermes (`cargo test -p hypotaxis-host --test setup_live`, whose `bundled` twin runs in `ci.yml` on the real archive), then the session check.

**Updater signing slot.** The workflow passes `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from repository secrets. They are empty and unused while `bundle.createUpdaterArtifacts` is off. To turn the updater on: `pnpm dlx @tauri-apps/cli@2 signer generate`, store the private key and password as those two secrets, put the public key in `tauri.conf.json` under `plugins.updater.pubkey` and set `createUpdaterArtifacts`. Never commit a key.

## The Rust toolchain pin
CI builds with Rust **1.97.0** (`dtolnay/rust-toolchain@1.97.0`, and `RUSTUP_TOOLCHAIN: "1.97.0"` in both workflows' `env`, which overrides `rust-toolchain.toml`'s floating `stable`). New stable releases add clippy lints, so an unpinned runner can turn a green tree red overnight. To bump: change the version in every `dtolnay/rust-toolchain@` line and in `RUSTUP_TOOLCHAIN`, run `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` on that version, fix what it reports, and commit the lot together. `rust-version` in `Cargo.toml` is the minimum, not the pin.

## What is verified where
- **Locally:** `actionlint` on both workflows (clean); `identity`, `checks` (all three `--check`s), `rust` (fmt, clippy `-D warnings`, `cargo test --workspace`: 496 passed), `plugin` (ruff, pyright and pytest, 3.11 and 3.14, with the same deselects), `e2e` (25 passed against the spike's Hermes install), `ui` typecheck, vitest (174 passed) and the Playwright smoke (156/156, with the pre-installed Chromium).
- **Locally, for the runtime (v0.23.2, linux-x86_64):** `build-runtime.sh`, `verify-runtime.sh`, `setup_live bundled` on the real archive (unpack, plugin enabled, gateway on the bundled interpreter, fake model, `~/.hermes` untouched), `tests/e2e` and the sandbox tests on the unpacked runtime (all passed, contraprova installed from its checkout).
- **Only in CI:** the apt installs, the `runtime` job's cache, the `smoke` job, the whole `release` build (disk, including the AppImage size), the Windows and macOS builds, the release creation, and the `CONTRAPROVA_TOKEN` path.
