#!/usr/bin/env bash
# Cross-build the Windows x64 installer of boopis on Linux, from a clean checkout:
#
#   XWIN_ACCEPT_LICENSE=1 scripts/build-windows.sh [--out <dir>] [--runtime <dir>] [--skip-runtime] [--xwin-cache <dir>]
#
# Makes `boopis_<version>_x64-setup.exe` (NSIS, unsigned; the one the `windows` job in release.yml makes on a Windows runner,
# staged the same way) and `SHA256SUMS` beside it, in `dist/windows/` (git-ignored: never commit it). In order:
#
#   1. the Hermes runtime for Windows (ADR-0023), by `scripts/build-runtime.sh --target windows-x86_64` (python-build-standalone
#      and uv at Hermes's pins, the locked win_amd64 wheels, Hermes v0.23.2; no Windows needed), unless `--runtime` gives one;
#   2. `hx.exe`, with `cargo xwin build --release -p hx --target x86_64-pc-windows-msvc`;
#   3. `scripts/stage-bundle.sh --target x86_64-pc-windows-msvc`: the plugin, `hx.exe` as the sidecar and the runtime, as Tauri
#      resources (`tauri.bundle.conf.json`);
#   4. the app and the installer: Tauri's CLI with `--runner cargo-xwin --bundles nsis`, `tauri.bundle.windows.conf.json` on top
#      (the licence page, the installer's icon and images from `packaging/brand/make-installer-images.py`);
#   5. checks: `boopis.exe` and `hx.exe` are PE32+ x86-64 (the installer is NSIS's 32-bit stub, as every NSIS one is), and the installer holds the app, `hx.exe`, the plugin and the runtime.
#
# It needs, on the build machine: a Rust toolchain with the `x86_64-pc-windows-msvc` target, `cargo-xwin` (cargo install
# cargo-xwin), clang-cl, lld-link and llvm-rc (LLVM; Debian has `clang-cl-<N>`: put it on PATH as `clang-cl`), `makensis`
# (apt-get install nsis), node and pnpm, uv, git, curl, GNU tar, zstd, `7z` and `file` for the checks, and python3 with
# Pillow if you want the installer's bitmaps checked against the brand files.
#
# Microsoft's licence. `xwin` downloads Microsoft's C runtime and the Windows SDK, which the Visual Studio licence covers: the
# build does not accept it for you. Read it (https://go.microsoft.com/fwlink/?LinkId=2086102), then set XWIN_ACCEPT_LICENSE=1.
#
# Disk: about 0.6 GB for the xwin cache (`XWIN_CACHE_DIR`, x86_64 only), 1 to 2 GB of cargo output (`CARGO_TARGET_DIR`), about
# 0.5 GB for the runtime while it is built, and the installer (about 0.15 GB). `CARGO_INCREMENTAL=0` and no debug info in the
# release profile are set here for that reason. Nothing is deleted by this script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE=x86_64-pc-windows-msvc
OUT="$ROOT/dist/windows"
RUNTIME="$ROOT/dist/runtime-windows"
SKIP_RUNTIME=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --runtime) RUNTIME="$2"; SKIP_RUNTIME=1; shift 2 ;;
    --skip-runtime) SKIP_RUNTIME=1; shift ;;
    --xwin-cache) export XWIN_CACHE_DIR="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ "$(uname -s)" = Linux ] || { echo "this cross-builds on Linux; on Windows use the release.yml job" >&2; exit 1; }
[ "${XWIN_ACCEPT_LICENSE:-}" = 1 ] || {
  echo "Set XWIN_ACCEPT_LICENSE=1 once you have read Microsoft's licence for the C runtime and Windows SDK (see this script's header)." >&2
  exit 1; }
export XWIN_ACCEPT_LICENSE XWIN_ARCH=x86_64
export CARGO_INCREMENTAL=0 CARGO_PROFILE_RELEASE_DEBUG=0

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing on PATH: $1 ($2)" >&2; missing=1; }; }
missing=0
need cargo "rustup"; need cargo-xwin "cargo install cargo-xwin --locked"; need makensis "apt-get install nsis"
need clang-cl "LLVM's clang-cl; Debian: ln -s /usr/bin/clang-cl-18 somewhere-on-PATH/clang-cl"; need lld-link "apt-get install lld"
need llvm-rc "apt-get install llvm"; need uv "https://docs.astral.sh/uv/"; need pnpm "corepack enable, or npm i -g pnpm@10"
need zstd "apt-get install zstd"; need file "apt-get install file"; need 7z "apt-get install p7zip-full"; need git "git"
# dictation (ADR-0052): whisper.cpp is compiled from source for the target by whisper-rs-sys, which cargo-xwin drives through CMake
need cmake "apt-get install cmake"; need ninja "apt-get install ninja-build"
[ "$missing" = 0 ] || exit 1
rustup target list --installed 2>/dev/null | grep -qx "$TRIPLE" || { echo "rustup target add $TRIPLE" >&2; exit 1; }

VERSION="$(sed -n 's/^ *"version": *"\(.*\)",/\1/p' "$ROOT/apps/desktop/src-tauri/tauri.conf.json" | head -1)"
INSTALLER="boopis_${VERSION}_x64-setup.exe"
TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
mkdir -p "$OUT"
df -h "$ROOT" "$TARGET_DIR" 2>/dev/null | sed -n '1,3p' || true

# 0. the brand bitmaps are what the script makes from the logo's files (skipped when Pillow is not there)
if python3 -c 'import PIL' 2>/dev/null; then
  python3 "$ROOT/packaging/brand/make-installer-images.py" --check
fi

# 1. the Windows runtime
if [ "$SKIP_RUNTIME" = 0 ]; then
  "$ROOT/scripts/build-runtime.sh" --target windows-x86_64 --out "$RUNTIME"
fi
[ -f "$RUNTIME/runtime.json" ] || { echo "no runtime.json in $RUNTIME" >&2; exit 1; }

# 2. hx.exe
(cd "$ROOT" && cargo xwin build --release -p hx --target "$TRIPLE")

# 3. the bundle's resources
"$ROOT/scripts/stage-bundle.sh" --target "$TRIPLE" --runtime "$RUNTIME"

# 4. the app and the installer. The UI is built by tauri.conf.json's beforeBuildCommand.
(cd "$ROOT/apps/desktop/ui" && pnpm install --frozen-lockfile)
# From src-tauri, where release.yml runs it (from elsewhere the CLI picks another directory for `pnpm --dir ui`).
(cd "$ROOT/apps/desktop/src-tauri" && pnpm dlx @tauri-apps/cli@2 build --runner cargo-xwin --target "$TRIPLE" --bundles nsis \
  --config tauri.bundle.conf.json --config tauri.bundle.windows.conf.json)
BUILT="$TARGET_DIR/$TRIPLE/release/bundle/nsis/$INSTALLER"
[ -f "$BUILT" ] || { echo "the bundler did not make $BUILT" >&2; ls "$TARGET_DIR/$TRIPLE/release/bundle/nsis" >&2 || true; exit 1; }

# 5. checks, on the files that ship
APP="$TARGET_DIR/$TRIPLE/release/boopis.exe"
HX="$TARGET_DIR/$TRIPLE/release/hx.exe"
for f in "$APP" "$HX"; do
  file "$f" | grep -q 'PE32+ executable.*x86-64' || { echo "not a PE32+ x86-64 file: $f ($(file -b "$f"))" >&2; exit 1; }
done
# the installer itself is NSIS's own stub, which is always a 32-bit x86 PE (it runs on every Windows and installs the x64 app)
file "$BUILT" | grep -q 'PE32 executable.*80386' || { echo "not an NSIS installer: $BUILT ($(file -b "$BUILT"))" >&2; exit 1; }
LIST="$(7z l -ba "$BUILT")"
for want in 'boopis.exe' 'hx.exe' 'plugin/boopis/plugin.yaml' 'runtime/runtime.json' 'runtime/hermes-runtime-windows-x86_64.tar.zst'; do
  # 7z lists NSIS paths with the installer's separators; both spellings are accepted
  printf '%s\n' "$LIST" | tr '\\' '/' | grep -q "$want\$" || { echo "the installer does not hold $want" >&2; exit 1; }
done

cp "$BUILT" "$OUT/$INSTALLER"
(cd "$OUT" && sha256sum "$INSTALLER" > SHA256SUMS)
echo "built $OUT/$INSTALLER ($(wc -c <"$OUT/$INSTALLER") bytes)"
cat "$OUT/SHA256SUMS"
