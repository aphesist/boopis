#!/usr/bin/env bash
# Stage what the app image carries for first-run setup: the plugin directory and the hx binary.
#
#   scripts/stage-bundle.sh [--hx <path to a built hx>] [--dest <src-tauri dir>]
#   cargo tauri build --bundles appimage --config src-tauri/tauri.bundle.conf.json    (from apps/desktop)
#
# The plugin is copied without its tests and caches (the same set the host's installer skips). hx goes where Tauri's
# `externalBin` looks: binaries/hx-<target triple>. The base tauri.conf.json does not list either, so `cargo build` and
# `cargo test` need no staging; only a bundle build does, through tauri.bundle.conf.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/desktop/src-tauri"
HX="${CARGO_TARGET_DIR:-$ROOT/target}/release/hx"
while [ $# -gt 0 ]; do
  case "$1" in
    --hx) HX="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f "$HX" ] || { echo "no hx at $HX (cargo build --release -p hx, or pass --hx)" >&2; exit 1; }
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
PLUGIN="$DEST/resources/plugin/hypotaxis"

rm -rf "$PLUGIN"
mkdir -p "$PLUGIN" "$DEST/binaries"
tar -C "$ROOT/plugins/hypotaxis" --exclude='__pycache__' --exclude='tests' --exclude='.pytest_cache' \
    --exclude='.ruff_cache' --exclude='*.pyc' -cf - . | tar -C "$PLUGIN" -xf -
cp "$HX" "$DEST/binaries/hx-$TRIPLE"
chmod 755 "$DEST/binaries/hx-$TRIPLE"
echo "staged the plugin in ${PLUGIN#"$ROOT"/} and hx as binaries/hx-$TRIPLE"
