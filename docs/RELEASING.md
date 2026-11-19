# Releasing: the workflows and the AppImage

Two workflows live in `.github/workflows/`. Neither can be run locally; `actionlint` checks their syntax and the job commands were run by hand where a machine allows (see "What is verified where" at the end).

## Getting the AppImage
- **Every push to `develop`:** open the `release` run in the Actions tab, then download the artifact `boopis-linux-x86_64-appimage` (the `.AppImage` and `SHA256SUMS`, kept 30 days). Windows (`boopis-windows-x86_64-nsis`) and macOS (`boopis-macos-aarch64-dmg`) bundles are there too when those jobs built.
- **A tag `vX.Y.Z`:** push a tag that equals `version` in `apps/desktop/src-tauri/tauri.conf.json` (the build fails when they differ). The `release` job then publishes a GitHub release with the AppImage, the other bundles that built, `install.sh` and `install.ps1`, and `SHA256SUMS` over all of them. Download from the repository's Releases page, or `gh release download vX.Y.Z -R aphesist/boopis`.
- Verify: `sha256sum -c SHA256SUMS --ignore-missing`.

## Installing from a terminal
`scripts/install.sh` (Linux and macOS) and `scripts/install.ps1` (Windows) install a release the way a person would: they download the release's file, check its sha256 against the release's `SHA256SUMS`, install it and register it. They are one file each and run from a pipe; `packaging/AGENTS.md` has the art and the rules, ADR-0026 the reason.
```sh
bash install.sh                       # the latest release
bash install.sh --version v0.1.0      # a release
bash install.sh --file ./boopis_0.1.0_amd64.AppImage [--sha256 <hex>]   # a file you already have
bash install.sh --uninstall           # removes exactly what the manifest lists
```
- **Linux:** the AppImage goes to `~/.local/share/boopis/`, a `boopis` launcher to `~/.local/bin/`, a menu entry and the hicolor icons (light, with a dark twin, and the symbolic one for panels). Without FUSE 2 the launcher makes the AppImage extract itself.
- **macOS:** the app from the dmg goes to `~/Applications` (or `/Applications` with `--system`), and a `boopis` launcher to `~/.local/bin/`.
- **Windows:** the NSIS setup runs silently, per user, with no administrator rights; `-Uninstall` runs the uninstaller it registered.
- `--prefix DIR`, `--yes`, `--quiet`, `--no-color`, `--system` (the only way sudo is asked for). `NO_COLOR`, `CI` and `BOOPIS_NO_ANIMATION` are honoured.
- Where releases come from (owner, repository, the artifact names) is one block at the top of each script. They expect the release to carry `boopis_{v}_amd64.AppImage`, `boopis_{v}_aarch64.dmg`, `boopis_{v}_x64-setup.exe` and `SHA256SUMS`, which is what the `release` job publishes today.
- Checks: `shellcheck scripts/install.sh scripts/embed-brand.sh scripts/test-brand.sh scripts/test-install.sh`, then `scripts/test-brand.sh` and `scripts/test-install.sh`. The PowerShell installer has not been run on Windows.

## Running it on Arch
**The native package (recommended, ADR-0025):** `boopis-<version>-1-x86_64.pkg.tar.zst`, built against the system's WebKitGTK, so it gets Arch's current renderer and updates through pacman. Download it from the `release` run (artifact `boopis-arch-x86_64-pkg`) or the Releases page, then:
```sh
sudo pacman -U boopis-*.pkg.tar.zst     # pulls webkit2gtk-4.1, gtk3 and the rest from the repositories
boopis
```
Details, and what is still open, in "The Arch package" below. The AppImage works too:
```sh
sudo pacman -S fuse2 webkit2gtk-4.1 gtk3 gnome-keyring   # fuse2 to mount AppImages; keyring for secret_set
chmod +x boopis_*.AppImage
./boopis_*.AppImage
# without fuse2:  ./boopis_*.AppImage --appimage-extract-and-run
```
Nothing else to install: the app carries Hermes (see "The Hermes runtime"). On first run it unpacks it into `~/.local/share/dev.aphesist.boopis/runtime/` and gives it a private home in `.../hermes-home/`; it never reads or writes `~/.hermes`. Builds are unsigned.

**If the window is blank or the app stutters.** The host chooses WebKitGTK's renderer itself from the machine's GPUs, session and WebKitGTK version (ADR-0024, ADR-0025); do not launch with `WEBKIT_DISABLE_DMABUF_RENDERER=1` as a habit. It forces CPU painting of every frame, which is the slowest path there is.
- `BOOPIS_RENDERER=shm` is the first thing to try for a blank window: it keeps GL compositing and copies frames through shared memory (`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`). `BOOPIS_RENDERER=cpu` is the old CPU switch, a last resort.
- `BOOPIS_GPU=dedicated` (also Settings > General) renders on a hybrid laptop's NVIDIA GPU; `auto` does so only on AC power with WebKitGTK 2.54.2 or later.
- Settings > General > Diagnostics shows what this machine really uses (renderer, GPU, WebKitGTK version and origin, refresh rate) and copies the report; attach it to a bug.

Another Hermes on the machine: `BOOPIS_HERMES=existing` makes the app use the `hermes` it finds, in your own `HERMES_HOME` (the advanced setting). More in `apps/desktop/AGENTS.md`.

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
2. Run `scripts/build-runtime.sh` and `scripts/verify-runtime.sh`, then the gate with `HX_E2E_RUNTIME_ARCHIVE=dist/runtime cargo test -p boopis-host --test setup_live bundled`, and the plugin's e2e suite with `HX_E2E_RUNTIME=<unpacked dir>`. CI does the same on the pull request; the cache key includes the scripts, so it rebuilds.
3. The archive's name does not change, its hash does, and so does the runtime's directory name: users get the new Hermes with the next app update, and the old folder is removed after the gateway runs on the new one.
4. If Hermes changed its payload builders (`scripts/bundles/native.py`, `scripts/build/agent.py`) `build_payload.py` follows them; it calls their functions rather than copying them, so a rename fails the build loudly.

**Not done yet.**
- **Updater.** It needs a signing key the owner creates (see "Updater signing slot"); none was generated. It plugs in at one place: the updater ships a new app version, which carries a new `runtime.json` and archive; the next start finds `Runtime::locate` pointing at a runtime that is not unpacked, `setup_check` answers `needed`, and the setup unpacks it, restarts the gateway and removes the old one. So the updater needs no Hermes logic: it only has to replace the app. The AppImage bundle is the only target the updater can replace in place on Linux; a native package (below) updates through the package manager instead.
- **macOS.** `build-runtime.sh` is written for it (`gtar`, Mach-O `strip -S` is not wired: only Linux strips) but has not run there; the runtime must be built on an Apple-silicon runner (`aarch64-apple-darwin`), the bundle must carry it (the macOS job has a TODO) and the whole app must be signed and notarised, including the interpreter and every `.so` in the runtime, which are unpacked into the app's data folder and must carry valid signatures to run under Gatekeeper's hardened runtime.
- **Windows.** Built and cross-built, not yet run on a Windows machine: see "Windows" below. Still open: a native `build-runtime.ps1` (not needed while the runtime is cross-built), long-path and antivirus behaviour on a 370 MB unpack (unmeasured), the secret channel's Windows transport, and a signed installer.
- **Linux aarch64** is the same script on an arm64 runner.
- **A native Arch package** is done (see "The Arch package"): it installs `runtime.json` and the archive in `/usr/lib/boopis/runtime/` and the host unpacks on first run, like the AppImage. Shipping the unpacked tree, or depending on a `hermes-agent` package with `BOOPIS_HERMES=existing`, stay options.

## Windows (the NSIS installer)
`boopis_<version>_x64-setup.exe`: NSIS, per user (no administrator rights), unsigned, so SmartScreen asks ("More info", then "Run anyway"). WebView2 is downloaded by the installer when the machine lacks it (Windows 11 and current Windows 10 have it). It is 89,755,490 bytes (85.6 MiB; the runtime archive is 77.6 MB of that), and the installer is NSIS's own 32-bit stub, as every NSIS installer is; `boopis.exe` and `hx.exe` inside are PE32+ x86-64. It carries the app, `hx.exe`, the plugin and the Hermes runtime like the AppImage does, shows the Apache-2.0 licence page, and uses the brand's own images.

**Building it.**
- **On Linux (cross-build), from a clean checkout:** `XWIN_ACCEPT_LICENSE=1 scripts/build-windows.sh`. Needs `cargo-xwin` (`cargo install cargo-xwin --locked`), the `x86_64-pc-windows-msvc` Rust target, `clang-cl`, `lld-link` and `llvm-rc` on PATH, `makensis` (apt `nsis`), `uv`, `zstd`, `7z`, `file`, node and pnpm. `xwin` downloads Microsoft's C runtime and Windows SDK (about 0.6 GB for x86_64, `XWIN_CACHE_DIR`): its licence is Microsoft's, and the script makes you set `XWIN_ACCEPT_LICENSE=1` yourself. The result and `SHA256SUMS` land in `dist/windows/` (git-ignored). The script's header lists every step.
- **In CI:** `runtime-windows` (Linux) builds the runtime with `scripts/build-runtime.sh --target windows-x86_64`, then `windows` (a Windows runner) builds `hx.exe`, stages with `scripts/stage-bundle.sh --target x86_64-pc-windows-msvc` (the same script, the same resources) and runs Tauri with `tauri.bundle.conf.json` and `tauri.bundle.windows.conf.json`. Keep the two in step with `scripts/build-windows.sh`.

**The runtime for Windows (cross-built, ADR-0023).** `scripts/build-runtime.sh --target windows-x86_64` (Linux only) runs `scripts/runtime/build_payload.py --target win32-x64`. Hermes's own functions do what can be done without running Windows code: `prepare_tools` stages python-build-standalone (`x86_64-pc-windows-msvc`, `install_only`) and uv at the pins and hashes of `pm/lock.json`, `record_tools` records their digests, `assemble` writes the manifest. What Hermes does by running the target's interpreter is done with the same inputs from Linux:
- the dependencies: `uv export --frozen` writes the lock's pins with hashes, `uv pip install --python-platform x86_64-pc-windows-msvc --require-hashes --no-deps --only-binary :all:` puts them in `venv/Lib/site-packages` (and the manager's four in `pm-runtime/Lib/site-packages`). **Every locked dependency has a `win_amd64` (or pure) wheel; none is missing** (86 distributions for the extras `anthropic,mcp,uvloop`; `uvloop` is not installed because its marker excludes Windows, and Hermes does not need it there). `pywin32` and `winrt-*` come in, as Hermes's own Windows build has them.
- the extras the venv carries: Hermes's own probe, over a temporary POSIX-shaped link to the Windows `site-packages`; the venv stamp from Hermes's `expected_stamp` with the target switched to `win32-x64`;
- the launchers (`bin/hermes.exe` and its two twins): Hermes's `mint_launchers.py`, run in-process with distlib's Windows stub taken from the payload interpreter's own pip, so they are the files a Windows build writes (stub, `<launcher_dir>` shebang, zipped wrapper);
- the interpreter is trimmed of tests, IDE, Tk, headers, import libraries and `.pdb` files.
Archive: 77,588,366 bytes (74 MiB), about 368 MB unpacked, 19,954 entries (`windows-x86_64`, Hermes v0.23.2, Python 3.14.9+20261021). The host's unit test `the_windows_runtime_archive_verifies_with_the_hosts_own_unpack` (`HX_WINDOWS_RUNTIME=<dir with runtime.json>`) feeds it to the host's own unpack: hash, size and entry caps, `hermes.exe` and `python.exe` where the manifest says and PE files, the layout, idempotence.

**What does not work on Windows in this build** (also listed in the first-run receipt, from `windows_gaps` in `src/setup/mod.rs`):
- **API keys from the keychain do not reach Hermes.** The host's secret channel is a Unix socket; the Windows transport (a named pipe with a user-only ACL, and the plugin's end) is not written, and `start` answers `hx.secrets.unavailable`. The free Nous models and the Claude subscription need no key.
- **The command sandbox is unproven.** `hx-sandbox` has a Windows backend (an `AppContainer`, ACLs, a job object), compiled for `x86_64-pc-windows-msvc` and clippy-clean, never run on Windows. If it cannot start, `sandbox.*` answers `hx.sandbox.unavailable` with the reason and the plugin's gate refuses the governed ship with it (`gate.allow_unsandboxed` stays off); no command runs unsandboxed. Whether it works is the first thing the owner's test shows.
- **Mods are off:** `hx.mods.unavailable` (`docs/MODS.md`, the worker has no private channel on Windows).
- **Unmeasured:** a 370 MB unpack on a machine with antivirus, and paths past 260 characters (`%APPDATA%\dev.aphesist.boopis\runtime\...\site-packages\...`): the host's unpack uses long paths, Python does not unless the machine has long paths on.
- The installer's first-run needs the network only for the free tier's sign-in challenge and the model calls; nothing else is downloaded (WebView2 aside).

## The Arch package (ADR-0025)
`packaging/arch/PKGBUILD` builds `boopis`, the app against the system's `webkit2gtk-4.1` (2.54.2 or later on Arch, which has the NVIDIA explicit-sync fix and compositor-driven `linear()` animation). It does not carry WebKitGTK.

**Layout.** `/usr/bin/boopis` (Cargo's `boopis` binary), and in `/usr/lib/boopis/`: `hx`, `plugin/boopis/` and `runtime/` (`runtime.json` and the Hermes archive), the same relative paths as `tauri.bundle.conf.json`, staged by the same `scripts/stage-bundle.sh` the AppImage uses. `hx` stays out of `/usr/bin` because Helix owns that name on Arch. Plus the desktop entry (`StartupWMClass=boopis`, which is the Wayland app id: GTK takes it from the binary's name), the light icon as `boopis` and the dark one as `boopis-dark` in hicolor sizes 16 to 512, the symbolic SVG, and licences (`NOTICE`, Hermes's MIT text read out of the runtime archive, the embedded fonts' licences). `install=boopis.install` is the installer branch's file; here it is a placeholder it overwrites.

**How the host finds them.** Tauri looks in `<exe dir>/../lib/<productName>`, which is `boopis` (`productName`), and a package should not depend on that: a display name is not a path. `src/resources.rs` therefore falls back to `<exe dir>/../lib/<binary name>` when Tauri's directory carries neither `plugin/` nor `runtime/`; the AppImage still takes Tauri's. `Bundle::locate` also looks for `hx` in that directory. Both have tests.

**Why it builds from source inside `makepkg`** and does not repackage the CI binaries:
- the binary is linked and tested against the libraries it will run with (a repackaged Ubuntu 22.04 build links Ubuntu's `libssl`, `libsoup` and glibc baseline, which only happen to match);
- `makepkg`'s dependency check, `namcap` and an AUR submission all work on it unchanged;
- the cost is a cold build of about 20 to 30 minutes on a runner, cut by caching the cargo registry and the build output.

The one input it does not build is the Hermes runtime, which stays what CI's `runtime` job built and proved relocatable: it is the same archive the AppImage carries, so the end-to-end tests cover the bytes that ship. `prepare()` checks the archive against `runtime.json`; the host checks it again on first run.

**Building it by hand.** On Arch, as a normal user, from a checkout:
```sh
scripts/build-runtime.sh --out dist/runtime            # or download the CI artifact hermes-runtime-linux-x86_64
cp dist/runtime/runtime.json dist/runtime/hermes-runtime-linux-x86_64.tar.zst packaging/arch/
cd packaging/arch && makepkg -s                        # needs network in prepare() for cargo and pnpm; build() is offline
sudo pacman -U boopis-*.pkg.tar.zst
```
`BOOPIS_TARGET_DIR` keeps cargo's output outside the build directory. `packaging/arch/smoke.sh` checks an installed package.

**The `arch` job in `release.yml`.** It runs in an `archlinux:latest` container, installs the PKGBUILD's own `makedepends` and `depends` (read from the file), checks that the PKGBUILD's `pkgver` equals the app's version (and the tag does on a tag), runs `makepkg` as a non-root user, prints `namcap` to the job summary (informational: it reports the plugin's Python imports as a missing `python` dependency, which is wrong, because the plugin runs on Hermes's own interpreter) and uploads `boopis-arch-x86_64-pkg`. `arch-smoke` installs it with `pacman -U` in a clean Arch container and runs `smoke.sh`: the files are where the host looks, the runtime archive matches `runtime.json`, `ldd` shows `libwebkit2gtk-4.1` from `/usr/lib` and no carried WebKitGTK, nothing is unresolved, `pacman -Qkk` is clean, and `boopis --version` prints the version when the binary handles that flag (the installer branch's command line; until it lands the links are the start check). Neither job is needed by the AppImage, so a failure there does not block it. On a tag, `release` attaches the package only when `arch-smoke` passed.

**pnpm.** Arch's `pnpm` (12.x when this was written) is newer than CI's 10 and refuses a lockfile entry published less than a day earlier (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, seen on `source-map-js` and `tinybench` the day they were bumped). The PKGBUILD leaves that supply-chain check on: it is the owner's call whether to pin pnpm 10 as CI does, to relax the check for a frozen lockfile CI already installed, or to accept that a build the day of a dependency bump waits a day.

**Bumping the version:** `pkgver` in the PKGBUILD, `version` in `tauri.conf.json` and the workspace version move together; the job fails when the first two differ.

**The names.** The names the package depends on are in one block at the top of the PKGBUILD (`_cargo_bin`, `_host_crate`, `_hx_crate`, `_plugin`, `_runtime_archive`, `_repo_url`), two lines of `smoke.sh` (`PLUGIN`, `RUNTIME_ARCHIVE`), `ARCH_ARTIFACT` and the `boopis-*` release pattern in `release.yml`, and the `BOOPIS_GPU` hint in `optdepends`. The package, binary, desktop entry, directories and the Cargo bin all say `boopis` (ADR-0028); the installers' name blocks are `scripts/install.sh` and `install.ps1`.

**Follow-up: an AUR package (`boopis`).** It needs:
- the licence is Apache-2.0 (`LICENSE`, with third-party notices in `NOTICE`), so the AUR has a statement to point to;
- the source as the release tarball (`source=("$url/archive/v$pkgver.tar.gz")`) with a real checksum, and the in-tree `$startdir/../..` copy dropped;
- the Hermes runtime as a release asset with a checksum (today it is a workflow artifact, kept 30 days and not published) or built in a clean chroot, which needs network in `build()` and so is not allowed on the AUR, hence the asset;
- `.SRCINFO` (`makepkg --printsrcinfo`), and a maintainer who bumps it per release (or a `-git` twin);
- pnpm: Arch's `pnpm` is current and its default release-age policy rejects a lockfile entry published less than a day ago, so a build the same day a dependency is bumped can fail until the day passes (see "pnpm" above).

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
- `runtime`: the Hermes runtime for linux-x86_64 (same script and cache key as `ci.yml`), proved relocatable, uploaded as `hermes-runtime-linux-x86_64` (not `boopis-*`, so a release does not publish it).
- `linux` (needs `runtime`): Tauri release build for `x86_64-unknown-linux-gnu`, AppImage only (`NO_STRIP=true`); uploads the AppImage and its checksum.
- `smoke`: runs the built AppImage under `xvfb-run` through `tests/e2e/smoke_desktop.py` (WebKitWebDriver) against the cached Hermes and the fake model: the UI loads, the host connects, a prompt streams a reply (the app runs with `BOOPIS_HERMES=existing`, because the AppImage carries a runtime, and the stack's home holds `tests/e2e/setup-done.json`, because the UI shows first-run setup instead of a session until setup has finished); first a cheap check that the AppImage extracts and every library resolves. Non-blocking, screenshot kept as `smoke-screenshot`.
- `runtime-windows` (Linux, cross-built, see "Windows") then `windows` (NSIS, on a Windows runner: `hx.exe`, the plugin and the runtime staged like the Linux job's) and `macos` (dmg, Apple silicon): non-blocking, unsigned.
- `arch` and `arch-smoke`: the native Arch package, built and smoke-tested in `archlinux:latest` containers (see "The Arch package"). Independent of the AppImage.
- `release` (tags only): GitHub release from the artifacts plus `SHA256SUMS`. The Arch package is attached when `arch-smoke` passed.

**Bundle.** The Linux job builds `hx` in release mode, downloads the runtime artifact, runs `scripts/stage-bundle.sh --runtime <it>` and builds with `tauri.bundle.conf.json`, so the AppImage carries the `hx` sidecar, the plugin and the Hermes runtime (`resources/runtime/`), and prints the AppImage's size in the job summary. The macOS build still lacks all three (marked TODO in the workflow); Windows has them (see "Windows"). The smoke job first runs first-run setup against the spike Hermes (`cargo test -p boopis-host --test setup_live`, whose `bundled` twin runs in `ci.yml` on the real archive), then the session check, which starts from a home that is already set up (that test's home is its own).

**Updater signing slot.** The workflow passes `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from repository secrets. They are empty and unused while `bundle.createUpdaterArtifacts` is off. To turn the updater on: `pnpm dlx @tauri-apps/cli@2 signer generate`, store the private key and password as those two secrets, put the public key in `tauri.conf.json` under `plugins.updater.pubkey` and set `createUpdaterArtifacts`. Never commit a key.

## The Rust toolchain pin
CI builds with Rust **1.97.0** (`dtolnay/rust-toolchain@1.97.0`, and `RUSTUP_TOOLCHAIN: "1.97.0"` in both workflows' `env`, which overrides `rust-toolchain.toml`'s floating `stable`). New stable releases add clippy lints, so an unpinned runner can turn a green tree red overnight. To bump: change the version in every `dtolnay/rust-toolchain@` line and in `RUSTUP_TOOLCHAIN`, run `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` on that version, fix what it reports, and commit the lot together. `rust-version` in `Cargo.toml` is the minimum, not the pin.

## What is verified where
- **Locally:** `actionlint` on both workflows (clean); `identity`, `checks` (all three `--check`s), `rust` (fmt, clippy `-D warnings`, `cargo test --workspace`: 496 passed), `plugin` (ruff, pyright and pytest, 3.11 and 3.14, with the same deselects), `e2e` (25 passed against the spike's Hermes install), `ui` typecheck, vitest (174 passed) and the Playwright smoke (156/156, with the pre-installed Chromium).
- **Locally, for the runtime (v0.23.2, linux-x86_64):** `build-runtime.sh`, `verify-runtime.sh`, `setup_live bundled` on the real archive (unpack, plugin enabled, gateway on the bundled interpreter, fake model, `~/.hermes` untouched), `tests/e2e` and the sandbox tests on the unpacked runtime (all passed, contraprova installed from its checkout).
- **Locally, for the Arch package:** `cargo fmt --check`, `clippy -D warnings` and `cargo test -p boopis-host` (172 passed, with the new `resources` and `Bundle::locate` tests); `actionlint` on the workflow (the one finding, SC2211 in the `smoke` job, was there before); in an `archlinux:latest` container, `makepkg --printsrcinfo`, the dependency list resolving in the repositories, `package()` with stand-in binaries (the layout, the licences, the hash check, `namcap`, `pacman -U`, `desktop-file-validate`) and `smoke.sh` up to the link check. Not run locally: a full `makepkg`, because its `pnpm install` stopped at that release-age check (see "pnpm" above) and the machine had about 6 GB free.
- **Only in CI:** the `arch` and `arch-smoke` jobs (the real build, the links to the system's WebKitGTK, `--version`), the apt installs, the `runtime` job's cache, the `smoke` job, the whole `release` build (disk, including the AppImage size), the Windows and macOS builds, the release creation, and the `CONTRAPROVA_TOKEN` path.
