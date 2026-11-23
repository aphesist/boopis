#!/usr/bin/env bash
# Stage what the app image carries for first-run setup: the plugin directory, the hx binary and the Hermes runtime.
#
#   scripts/stage-bundle.sh [--target <triple>] [--hx <path to a built hx>] [--runtime <dir with runtime.json>] [--no-runtime] [--dest <src-tauri dir>]
#   cargo tauri build --bundles appimage --config src-tauri/tauri.bundle.conf.json    (from apps/desktop)
#
# --target is the Rust target triple the bundle is for (default: this machine's; aarch64-apple-darwin in release.yml's macos
# job, where hx goes to binaries/hx-aarch64-apple-darwin and Tauri puts it in Contents/MacOS). For x86_64-pc-windows-msvc, hx is
# `<target dir>/<triple>/release/hx.exe` and goes to `binaries/hx-<triple>.exe`; the Windows installer is built by
# scripts/build-windows.sh (cross-built on Linux) or by the `windows` job in release.yml (on a Windows runner), which both stage
# through this script. It runs under Git Bash on Windows too.
#
# The plugin is copied without its tests and caches (the same set the host's installer skips). hx goes where Tauri's
# `externalBin` looks: binaries/hx-<target triple>. The base tauri.conf.json does not list either, so `cargo build` and
# `cargo test` need no staging; only a bundle build does, through tauri.bundle.conf.json.
#
# The runtime (ADR-0023) is what scripts/build-runtime.sh made: runtime.json and hermes-runtime-<os>-<arch>.tar.zst. It is
# copied as it is, to resources/runtime/, a Tauri resource the host finds at run time and unpacks on first run; the archive
# is already compressed, so the installer carries it once. --no-runtime stages a placeholder instead, for a build that uses
# the Hermes already on the machine (BOOPIS_HERMES=existing); the host then finds no runtime.json and says so in its log.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/desktop/src-tauri"
HX=""
RUNTIME="$ROOT/dist/runtime"
NO_RUNTIME=0
TRIPLE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TRIPLE="$2"; shift 2 ;;
    --hx) HX="$2"; shift 2 ;;
    --runtime) RUNTIME="$2"; shift 2 ;;
    --no-runtime) NO_RUNTIME=1; shift ;;
    --dest) DEST="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$TRIPLE" ] || TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
case "$TRIPLE" in *-windows-*) EXE=.exe ;; *) EXE= ;; esac
# the target directory has a triple in its path only when cargo was told a target
if [ -z "$HX" ]; then
  TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
  if [ -f "$TARGET_DIR/$TRIPLE/release/hx$EXE" ]; then HX="$TARGET_DIR/$TRIPLE/release/hx$EXE"; else HX="$TARGET_DIR/release/hx$EXE"; fi
fi
PY=python3; command -v python3 >/dev/null 2>&1 && python3 -c 'import sys' 2>/dev/null || PY=python
[ -f "$HX" ] || { echo "no hx at $HX (cargo build --release -p hx, or pass --hx)" >&2; exit 1; }
RT_DEST="$DEST/resources/runtime"
rm -rf "$RT_DEST"; mkdir -p "$RT_DEST"
if [ "$NO_RUNTIME" = 1 ]; then
  echo "this build carries no Hermes runtime (staged with --no-runtime)" > "$RT_DEST/NOT-BUNDLED.txt"
else
  [ -f "$RUNTIME/runtime.json" ] || { echo "no runtime.json in $RUNTIME (scripts/build-runtime.sh, or pass --runtime, or --no-runtime)" >&2; exit 1; }
  ARCHIVE="$($PY -c 'import json,sys; print(json.load(open(sys.argv[1]))["archive"]["name"])' "$RUNTIME/runtime.json")"
  [ -f "$RUNTIME/$ARCHIVE" ] || { echo "runtime.json names $ARCHIVE, which is not in $RUNTIME" >&2; exit 1; }
  cp "$RUNTIME/runtime.json" "$RUNTIME/$ARCHIVE" "$RT_DEST/"
fi
PLUGIN="$DEST/resources/plugin/boopis"

rm -rf "$PLUGIN"
mkdir -p "$PLUGIN" "$DEST/binaries"
tar -C "$ROOT/plugins/boopis" --exclude='__pycache__' --exclude='tests' --exclude='.pytest_cache' \
    --exclude='.ruff_cache' --exclude='*.pyc' -cf - . | tar -C "$PLUGIN" -xf -
rm -f "$DEST"/binaries/hx-*
cp "$HX" "$DEST/binaries/hx-$TRIPLE$EXE"
chmod 755 "$DEST/binaries/hx-$TRIPLE$EXE"
echo "staged the plugin in ${PLUGIN#"$ROOT"/}, hx as binaries/hx-$TRIPLE$EXE and the runtime in ${RT_DEST#"$ROOT"/}"
