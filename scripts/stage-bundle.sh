#!/usr/bin/env bash
# Stage what the app image carries for first-run setup: the plugin directory, the hx binary and the Hermes runtime.
#
#   scripts/stage-bundle.sh [--hx <path to a built hx>] [--runtime <dir with runtime.json>] [--no-runtime] [--dest <src-tauri dir>]
#   cargo tauri build --bundles appimage --config src-tauri/tauri.bundle.conf.json    (from apps/desktop)
#
# The plugin is copied without its tests and caches (the same set the host's installer skips). hx goes where Tauri's
# `externalBin` looks: binaries/hx-<target triple>. The base tauri.conf.json does not list either, so `cargo build` and
# `cargo test` need no staging; only a bundle build does, through tauri.bundle.conf.json.
#
# The runtime (ADR-0023) is what scripts/build-runtime.sh made: runtime.json and hermes-runtime-<os>-<arch>.tar.zst. It is
# copied as it is, to resources/runtime/, a Tauri resource the host finds at run time and unpacks on first run; the archive
# is already compressed, so the installer carries it once. --no-runtime stages a placeholder instead, for a build that uses
# the Hermes already on the machine (HYPOTAXIS_HERMES=existing); the host then finds no runtime.json and says so in its log.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/desktop/src-tauri"
HX="${CARGO_TARGET_DIR:-$ROOT/target}/release/hx"
RUNTIME="$ROOT/dist/runtime"
NO_RUNTIME=0
while [ $# -gt 0 ]; do
  case "$1" in
    --hx) HX="$2"; shift 2 ;;
    --runtime) RUNTIME="$2"; shift 2 ;;
    --no-runtime) NO_RUNTIME=1; shift ;;
    --dest) DEST="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f "$HX" ] || { echo "no hx at $HX (cargo build --release -p hx, or pass --hx)" >&2; exit 1; }
RT_DEST="$DEST/resources/runtime"
rm -rf "$RT_DEST"; mkdir -p "$RT_DEST"
if [ "$NO_RUNTIME" = 1 ]; then
  echo "this build carries no Hermes runtime (staged with --no-runtime)" > "$RT_DEST/NOT-BUNDLED.txt"
else
  [ -f "$RUNTIME/runtime.json" ] || { echo "no runtime.json in $RUNTIME (scripts/build-runtime.sh, or pass --runtime, or --no-runtime)" >&2; exit 1; }
  ARCHIVE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["archive"]["name"])' "$RUNTIME/runtime.json")"
  [ -f "$RUNTIME/$ARCHIVE" ] || { echo "runtime.json names $ARCHIVE, which is not in $RUNTIME" >&2; exit 1; }
  cp "$RUNTIME/runtime.json" "$RUNTIME/$ARCHIVE" "$RT_DEST/"
fi
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
PLUGIN="$DEST/resources/plugin/hypotaxis"

rm -rf "$PLUGIN"
mkdir -p "$PLUGIN" "$DEST/binaries"
tar -C "$ROOT/plugins/hypotaxis" --exclude='__pycache__' --exclude='tests' --exclude='.pytest_cache' \
    --exclude='.ruff_cache' --exclude='*.pyc' -cf - . | tar -C "$PLUGIN" -xf -
cp "$HX" "$DEST/binaries/hx-$TRIPLE"
chmod 755 "$DEST/binaries/hx-$TRIPLE"
echo "staged the plugin in ${PLUGIN#"$ROOT"/}, hx as binaries/hx-$TRIPLE and the runtime in ${RT_DEST#"$ROOT"/}"
