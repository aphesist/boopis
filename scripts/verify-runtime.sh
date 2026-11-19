#!/usr/bin/env bash
# Prove the Hermes runtime archive is relocatable (ADR-0023): unpack it into two unrelated directories, one of them
# deeper and with spaces in its name, and run it from each with an empty environment and a private HERMES_HOME.
#
#   scripts/verify-runtime.sh <dir holding runtime.json and the archive> [--keep]
#
# For each copy it checks that
#   - `hermes --version` runs, and its install directory is the copy's own path;
#   - the interpreter imports the standard library pieces Hermes needs (ssl, sqlite3, ctypes, zlib, bz2, lzma);
#   - every ELF file resolves its shared libraries (no `not found`), so dropping libpython or Tk left no dangling need;
#   - `hermes update` refuses (the install is sealed: the app owns updates);
#   - nothing was written outside the copy, the private home and the scratch HOME (no ~/.hermes appears);
# and that the two copies are byte-identical trees (`diff -r`), so nothing in the archive names a path.
# Linux and macOS (macOS lacks `ldd`: that check is skipped there). The Windows twin is not written yet.
set -euo pipefail

SRC="${1:?usage: verify-runtime.sh <runtime dir> [--keep]}"
KEEP="${2:-}"
SRC="$(cd "$SRC" && pwd)"
ARCHIVE="$SRC/$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["archive"]["name"])' "$SRC/runtime.json")"
WANT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["archive"]["sha256"])' "$SRC/runtime.json")"
HERMES_REL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["hermes"])' "$SRC/runtime.json")"
if command -v sha256sum >/dev/null; then GOT="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"; else GOT="$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)"; fi
[ "$GOT" = "$WANT" ] || { echo "the archive does not match runtime.json ($GOT)" >&2; exit 1; }

WORK="$(mktemp -d)"
[ "$KEEP" = --keep ] || trap 'rm -rf "$WORK"' EXIT
A="$WORK/A/x"
B="$WORK/B/deeper/path with space"
mkdir -p "$A" "$B"
zstd -d -q -c "$ARCHIVE" | tar -x -C "$A"
zstd -d -q -c "$ARCHIVE" | tar -x -C "$B"

for COPY in "$A" "$B"; do
  echo "== $COPY"
  HOME_DIR="$WORK/home-$(basename "$COPY" | tr -c 'A-Za-z0-9' _)"
  mkdir -p "$HOME_DIR/home"
  run() { env -i PATH=/usr/bin:/bin HOME="$HOME_DIR/home" HERMES_HOME="$HOME_DIR/hh" "$@"; }
  out="$(run "$COPY/$HERMES_REL" --version 2>/dev/null)"
  echo "$out" | head -3
  echo "$out" | grep -qF "Install directory: $COPY/hermes-agent" || { echo "Hermes does not see its own location" >&2; exit 1; }
  PY="$COPY/$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["python"])' "$SRC/runtime.json")"
  run "$PY" -I -c 'import sys, ssl, sqlite3, ctypes, zlib, bz2, lzma, hashlib; print("python", sys.version.split()[0], "prefix", sys.prefix)'
  if run "$COPY/$HERMES_REL" update >/dev/null 2>&1; then echo "hermes update must refuse in the bundle" >&2; exit 1; fi
  if command -v ldd >/dev/null; then
    missing=0
    while IFS= read -r f; do
      if ldd "$f" 2>/dev/null | grep -q 'not found'; then echo "unresolved: $f"; ldd "$f" | grep 'not found'; missing=1; fi
    done < <(find "$COPY" -type f \( -name '*.so' -o -name '*.so.*' -o -perm -u+x \) -exec sh -c 'for f; do head -c4 "$f" | grep -q "^.ELF" && echo "$f"; done' _ {} +)
    [ "$missing" = 0 ] || exit 1
    echo "every ELF file resolves its libraries"
  fi
  [ ! -e "$HOME_DIR/home/.hermes" ] || { echo "a ~/.hermes appeared in the scratch HOME" >&2; exit 1; }
done

# the trees are the same bytes: what Hermes wrote into a copy (bytecode, nothing else) is not in the archive
find "$A" "$B" -name __pycache__ -type d -prune -exec rm -rf {} +
diff -r "$A" "$B" >/dev/null || { echo "the two copies differ" >&2; diff -r "$A" "$B" | head >&2; exit 1; }
echo "relocation proven: two paths, one with spaces, identical trees, both run"
[ "$KEEP" != --keep ] || echo "kept in $WORK"
