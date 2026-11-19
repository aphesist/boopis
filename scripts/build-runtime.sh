#!/usr/bin/env bash
# Build the Hermes runtime the app ships (ADR-0023): hermes-runtime-<os>-<arch>.tar.zst plus runtime.json.
#
#   scripts/build-runtime.sh [--out <dir>] [--work <dir>]
#
# Inputs (environment):
#   HERMES_TAG        the Hermes release to bundle (default v0.23.2; the pin of REQUIRES_HERMES)
#   HERMES_SRC        an existing git checkout of that tag; otherwise the tag is cloned (shallow) into the work dir
#   HERMES_REPO       where to clone from (default the official repository)
#   RUNTIME_EXTRAS    Hermes extras installed beside its core dependencies (default: anthropic,mcp,uvloop)
#
# What it makes: a payload directory in Hermes's own sealed-payload layout (the one its desktop app and its Docker
# image use), so every path Hermes needs is found RELATIVE to the payload and the directory works after being
# unpacked anywhere:
#
#   manifest.json            Hermes's sealed-payload manifest (scripts/build/agent.py)
#   hermes-agent/            the Hermes source at the tag, without tests, docs, frontends (git archive)
#   venv/lib/.../site-packages   Hermes's locked dependencies (uv.lock, hashes checked by uv)
#   tools/python-<v>-<target>/   python-build-standalone at the build Hermes pins in pm/lock.json, sha256-checked
#   tools/facts.json         pm's record of that interpreter
#   bin/hermes               Hermes's own launcher, location-independent
#
# Left out on purpose (Hermes's package manager fetches them on first use, into the private home): Chromium, Node,
# ffmpeg, cua-driver, ripgrep, uv, and every extra that is not listed in RUNTIME_EXTRAS.
#
# Needs: bash, git, curl, tar, zstd, sha256sum (or shasum), python3 (any, only to read JSON), strip (optional).
# The Windows twin (build-runtime.ps1) is not written yet: docs/RELEASING.md says what is left.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_TAG="${HERMES_TAG:-v0.23.2}"
HERMES_REPO="${HERMES_REPO:-https://github.com/NousResearch/hermes-agent.git}"
EXTRAS="${RUNTIME_EXTRAS:-anthropic,mcp,uvloop}"
OUT="$ROOT/dist/runtime"
WORK=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --work) WORK="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# This machine's names: ours for the archive (Rust's std::env::consts), Hermes's for its lock and layout.
case "$(uname -s)" in
  Linux) OS=linux; HOS=linux ;;
  Darwin) OS=macos; HOS=darwin ;;
  *) echo "unsupported OS $(uname -s); the Windows build is build-runtime.ps1 (not written yet)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x86_64; HARCH=x64 ;;
  arm64|aarch64) ARCH=aarch64; HARCH=arm64 ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac
TARGET="$HOS-$HARCH"

if [ -z "$WORK" ]; then WORK="$(mktemp -d)"; CLEAN_WORK=1; else mkdir -p "$WORK"; CLEAN_WORK=0; fi
WORK="$(cd "$WORK" && pwd)"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
cleanup() { [ "$CLEAN_WORK" = 1 ] && rm -rf "$WORK"; return 0; }
trap cleanup EXIT

# 1. the Hermes checkout: the tag, exactly
if [ -n "${HERMES_SRC:-}" ]; then
  SRC="$(cd "$HERMES_SRC" && pwd)"
  [ "$(git -C "$SRC" describe --tags --exact-match HEAD 2>/dev/null)" = "$HERMES_TAG" ] \
    || { echo "$SRC is not at $HERMES_TAG" >&2; exit 1; }
else
  SRC="$WORK/hermes-src"
  git clone --quiet --branch "$HERMES_TAG" --depth 1 "$HERMES_REPO" "$SRC"
fi
COMMIT="$(git -C "$SRC" rev-parse HEAD)"
VERSION="${HERMES_TAG#v}"

# 2. the pins Hermes itself tests with (pm/lock.json): the interpreter build and the uv that installs the locked deps
pin() { python3 - "$SRC/pm/lock.json" "$1" "$TARGET" "$2" <<'PY'
import json, sys
lock, name, target, field = sys.argv[1:5]
pkg = json.load(open(lock))["packages"][name]
print(pkg["version"] if field == "version" else pkg["artifacts"][target][field])
PY
}
PY_VERSION="$(pin python version)"      # 3.14.9+20261021
PY_URL="$(pin python url)"; PY_SHA="$(pin python sha256)"
UV_URL="$(pin uv url)";     UV_SHA="$(pin uv sha256)"
PY_ENTRY="python-$PY_VERSION-$TARGET"   # pm's own store entry name

fetch() { # url sha256 dest
  curl -fsSL --retry 3 -o "$3" "$1"
  [ "$(sha256 "$3")" = "$2" ] || { echo "sha256 mismatch for $1" >&2; exit 1; }
}

PAYLOAD="$WORK/payload"
rm -rf "$PAYLOAD"; mkdir -p "$PAYLOAD/tools" "$WORK/dl" "$WORK/uv"

# 3. the interpreter: the pinned python-build-standalone, checked, then stripped of debug symbols
fetch "$PY_URL" "$PY_SHA" "$WORK/dl/python.tar.gz"
mkdir -p "$WORK/dl/py"; tar -xzf "$WORK/dl/python.tar.gz" -C "$WORK/dl/py"
mv "$WORK/dl/py/python" "$PAYLOAD/tools/$PY_ENTRY"
rm -rf "$WORK/dl/py" "$WORK/dl/python.tar.gz"
PYDIR="$PAYLOAD/tools/$PY_ENTRY"
# Never needed by Hermes, and 4 MB of the 250: tests, the IDE, Tk, the static-linking config.
rm -rf "$PYDIR"/lib/python3.*/{test,idlelib,tkinter,turtledemo,config-*} "$PYDIR"/lib/{tcl*,tk*,itcl*,thread*} "$PYDIR"/include "$PYDIR"/share
if command -v strip >/dev/null && [ "$HOS" = linux ]; then
  # Debug symbols of the shared libraries only: libpython is 137 MB with them and 34 without. The interpreter
  # executable itself is left alone: python-build-standalone links it so that binutils' strip corrupts it.
  find "$PYDIR/lib" -type f \( -name 'libpython3*.so*' -o -path '*/lib-dynload/*.so' \) -exec strip -S {} + 2>/dev/null || true
fi
PY="$PYDIR/bin/python3"
"$PY" -c 'import sys, ssl, sqlite3, ctypes, zlib, bz2, lzma, hashlib; print("interpreter", sys.version.split()[0])'

# 4. the code: a git archive of the tag, without what a sealed payload never reads (Hermes's own list,
#    scripts/bundles/payload.py INERT_SNAPSHOT_DIRS)
mkdir -p "$PAYLOAD/hermes-agent"
git -C "$SRC" archive --format=tar HEAD -- \
  ':(exclude)tests' ':(exclude)tests-js' ':(exclude)website' ':(exclude)evals' ':(exclude).github' ':(exclude)nix' \
  ':(exclude)docker' ':(exclude)apps' ':(exclude)ui-tui' ':(exclude)web' ':(exclude)scripts' \
  | tar -x -C "$PAYLOAD/hermes-agent"

# 5. the dependencies: uv at its pinned version, from uv.lock (versions and hashes), onto the bundled interpreter
fetch "$UV_URL" "$UV_SHA" "$WORK/dl/uv.tar.gz"
tar -xzf "$WORK/dl/uv.tar.gz" -C "$WORK/uv"
UV="$(find "$WORK/uv" -name uv -type f | head -1)"
EXTRA_FLAGS=()
IFS=',' read -r -a EXTRA_LIST <<<"$EXTRAS"
for e in "${EXTRA_LIST[@]}"; do [ -n "$e" ] && EXTRA_FLAGS+=(--extra "$e"); done
UV_NO_CONFIG=1 UV_PYTHON_PREFERENCE=only-system UV_LINK_MODE=copy UV_CACHE_DIR="$WORK/uv-cache" \
UV_PROJECT_ENVIRONMENT="$PAYLOAD/venv" \
  "$UV" sync --project "$PAYLOAD/hermes-agent" --frozen --no-dev --no-install-project \
    ${EXTRA_FLAGS[@]+"${EXTRA_FLAGS[@]}"} --python "$PY"
rm -rf "$WORK/uv-cache"
# A venv's launchers and interpreter links embed the build machine's absolute paths. Hermes runs this payload
# through its own interpreter and the site directory (the launcher), so none of them is used: drop them.
rm -rf "$PAYLOAD/venv/bin" "$PAYLOAD/venv/Scripts" "$PAYLOAD/venv/lib64" "$PAYLOAD/venv/CACHEDIR.TAG"
SITE_REL="$(cd "$PAYLOAD" && echo venv/lib/python3.*/site-packages)"
PYMM="$("$PY" -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])')"
# pyvenv.cfg is only metadata here (Hermes reads the version from it); it must not name a build path.
printf 'implementation = CPython\nversion_info = %s\ninclude-system-site-packages = false\n' "$PYMM" > "$PAYLOAD/venv/pyvenv.cfg"

# 6. seal: stamp, launchers, pm's facts and the manifest, by Hermes's own build code
"$PY" -I "$ROOT/scripts/runtime/assemble.py" --hermes-src "$SRC" --payload "$PAYLOAD" --target "$TARGET" \
  --python "tools/$PY_ENTRY" --site "$SITE_REL" --commit "$COMMIT" --version "$VERSION" --tag "$HERMES_TAG"

# 7. no bytecode caches (they are rewritten at first run, into the user's cache), no build-machine paths
find "$PAYLOAD" -name __pycache__ -type d -prune -exec rm -rf {} +
if grep -rIl --exclude-dir=.git -e "$WORK" "$PAYLOAD" | head -3 | grep .; then
  echo "the payload still names the build directory: it would not be relocatable" >&2; exit 1
fi

# 8. the archive: deterministic order, owner and times, so the same inputs give the same bytes
ARCHIVE="hermes-runtime-$OS-$ARCH.tar.zst"
UNPACKED_BYTES="$(du -sk "$PAYLOAD" | cut -f1)"; UNPACKED_BYTES=$((UNPACKED_BYTES * 1024))
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -C "$PAYLOAD" -cf - . \
  | zstd -19 -T0 -q -f -o "$OUT/$ARCHIVE"
SHA="$(sha256 "$OUT/$ARCHIVE")"
SIZE="$(wc -c <"$OUT/$ARCHIVE" | tr -d ' ')"

# 9. the manifest the host reads: what this is, and the hash it checks before unpacking
python3 - "$OUT/runtime.json" <<PY
import json, sys
json.dump({
    "schema": 1,
    "hermes_version": "$VERSION",
    "hermes_tag": "$HERMES_TAG",
    "hermes_commit": "$COMMIT",
    "python_version": "$PY_VERSION",
    "target": "$TARGET",
    "os": "$OS",
    "arch": "$ARCH",
    "extras": "$EXTRAS".split(",") if "$EXTRAS" else [],
    "archive": {"name": "$ARCHIVE", "sha256": "$SHA", "size": $SIZE},
    "unpacked_size": $UNPACKED_BYTES,
}, open(sys.argv[1], "w"), indent=2)
open(sys.argv[1], "a").write("\n")
PY
echo "built $OUT/$ARCHIVE ($SIZE bytes, sha256 $SHA, unpacked about $UNPACKED_BYTES bytes)"
