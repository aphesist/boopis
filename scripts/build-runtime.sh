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
#   BOOT_PYTHON       the interpreter that runs Hermes's build code (default python3; it must be 3.11 or newer)
#
# What it makes: a payload directory in Hermes's own sealed-payload layout (the one its desktop app and its Docker image
# use, written by Hermes's own build code: scripts/runtime/build_payload.py), so every path Hermes needs is found RELATIVE
# to the payload and the directory works after being unpacked anywhere:
#
#   manifest.json            Hermes's sealed-payload manifest
#   hermes-agent/            the Hermes source at the tag, without tests, docs, frontends; its install stamp
#   venv/                    Hermes's locked dependencies (uv.lock, hashes checked by uv) for the extras above
#   pm-runtime/              the package manager's own locked environment (`hermes plugins enable` needs it)
#   tools/                   python-build-standalone and uv at the builds Hermes pins in pm/lock.json, hash-checked
#   enabled-features.json    the extras the venv carries
#   bin/hermes               Hermes's own launcher, location-independent
#
# Left out on purpose (Hermes's package manager fetches them on first use, into the private home): Chromium, Node and npm,
# ffmpeg, cua-driver, ripgrep, and every extra that is not listed in RUNTIME_EXTRAS. Left out against Hermes's own build too:
# the uv cache it ships for offline rebuilds, and baked bytecode.
#
# Needs: bash, git, curl, GNU tar (gtar on macOS), zstd, sha256sum (or shasum), python3 3.11+, network (PyPI, GitHub), and
# llvm-strip (optional: it takes the interpreter's debug symbols out, 46 MB; binutils' strip corrupts that file).
# The Windows twin (build-runtime.ps1) is not written yet: docs/RELEASING.md says what is left.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_TAG="${HERMES_TAG:-v0.23.2}"
HERMES_REPO="${HERMES_REPO:-https://github.com/NousResearch/hermes-agent.git}"
EXTRAS="${RUNTIME_EXTRAS:-anthropic,mcp,uvloop}"
BOOT_PYTHON="${BOOT_PYTHON:-python3}"
OUT="$ROOT/dist/runtime"
WORK=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --work) WORK="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if tar --version 2>/dev/null | grep -q 'GNU tar'; then TAR=tar; elif command -v gtar >/dev/null; then TAR=gtar; else
  echo "GNU tar is needed (on macOS: brew install gnu-tar)" >&2; exit 1; fi
"$BOOT_PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' \
  || { echo "$BOOT_PYTHON is older than 3.11: set BOOT_PYTHON" >&2; exit 1; }
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# This machine's names: ours for the archive (Rust's std::env::consts).
case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=macos ;;
  *) echo "unsupported OS $(uname -s); the Windows build is build-runtime.ps1 (not written yet)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x86_64 ;;
  arm64|aarch64) ARCH=aarch64 ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac

if [ -z "$WORK" ]; then WORK="$(mktemp -d)"; CLEAN_WORK=1; else mkdir -p "$WORK"; CLEAN_WORK=0; fi
WORK="$(cd "$WORK" && pwd)"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
cleanup() { [ "$CLEAN_WORK" = 1 ] && rm -rf "$WORK"; return 0; }
trap cleanup EXIT

# 1. the Hermes checkout: the tag, exactly (it is also the builder: its pm/ and scripts/ do the work)
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

# 2. the payload, by Hermes's own build code, in an isolated HOME and HERMES_HOME the way its stage_native runs
PAYLOAD="$WORK/payload"
rm -rf "$PAYLOAD" "$WORK/home"; mkdir -p "$PAYLOAD" "$WORK/home"
(
  cd "$SRC"
  env -i PATH="$PATH" LANG=C.UTF-8 TMPDIR="${TMPDIR:-/tmp}" \
    ${HTTPS_PROXY:+HTTPS_PROXY="$HTTPS_PROXY"} ${https_proxy:+https_proxy="$https_proxy"} ${NO_PROXY:+NO_PROXY="$NO_PROXY"} \
    ${SSL_CERT_FILE:+SSL_CERT_FILE="$SSL_CERT_FILE"} ${REQUESTS_CA_BUNDLE:+REQUESTS_CA_BUNDLE="$REQUESTS_CA_BUNDLE"} \
    HOME="$WORK/home" USERPROFILE="$WORK/home" HERMES_HOME="$WORK/home/.hermes" HERMES_RUNTIME_DIR="$PAYLOAD/tools" \
    HERMES_PYTHON_SRC_ROOT="$SRC" XDG_CACHE_HOME="$WORK/home/cache" XDG_CONFIG_HOME="$WORK/home/config" \
    UV_CACHE_DIR="$WORK/uv-cache" PYTHONPATH="$SRC" \
    "$BOOT_PYTHON" -B "$ROOT/scripts/runtime/build_payload.py" --source "$SRC" --payload "$PAYLOAD" --cache "$WORK/uv-cache" \
      --tag "$HERMES_TAG" --extras "$EXTRAS"
)
rm -rf "$WORK/uv-cache" "$WORK/home"

# 3. what the manifest says: the launcher and interpreter paths inside the archive, the interpreter's build
read -r HERMES_CMD PY_REL PY_VERSION TARGET < <("$BOOT_PYTHON" - "$PAYLOAD/manifest.json" <<'PY'
import json, re, sys
m = json.load(open(sys.argv[1]))
py = m["runtime"]["storePython"]                      # tools/python-3.14.9+20261021-linux-x64/bin/python3
version = re.match(r"tools/python-(.+)-(?:linux|darwin|win32)-", py).group(1)
print(m["runtime"]["commands"]["hermes"], py, version, m["target"])
PY
)

# 4. no bytecode caches (Python writes them at first run, into the app's own cache), no build-machine paths anywhere
find "$PAYLOAD" -name __pycache__ -type d -prune -exec rm -rf {} +
if grep -rl --binary-files=text -e "$WORK" "$PAYLOAD" | head -5 | grep .; then
  echo "the payload still names the build directory: it would not be relocatable" >&2; exit 1
fi

# 5. the archive: deterministic order, owner and times, so the same inputs give the same bytes
ARCHIVE="hermes-runtime-$OS-$ARCH.tar.zst"
UNPACKED_BYTES="$(du -sk "$PAYLOAD" | cut -f1)"; UNPACKED_BYTES=$((UNPACKED_BYTES * 1024))
"$TAR" --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -C "$PAYLOAD" -cf - . \
  | zstd -19 -T0 -q -f -o "$OUT/$ARCHIVE"
SHA="$(sha256 "$OUT/$ARCHIVE")"
SIZE="$(wc -c <"$OUT/$ARCHIVE" | tr -d ' ')"

# 6. the manifest the host reads: what this is, where the launcher and the interpreter are inside the archive (so the host
#    knows the path before it unpacks), and the hash it checks before it unpacks
"$BOOT_PYTHON" - "$OUT/runtime.json" <<PY
import json, sys
json.dump({
    "schema": 1,
    "hermes_version": "$VERSION",
    "hermes_tag": "$HERMES_TAG",
    "hermes_commit": "$COMMIT",
    "python_version": "$PY_VERSION",
    "target": "$TARGET",
    "hermes": "$HERMES_CMD",
    "python": "$PY_REL",
    "os": "$OS",
    "arch": "$ARCH",
    "extras": "$EXTRAS".split(",") if "$EXTRAS" else [],
    "archive": {"name": "$ARCHIVE", "sha256": "$SHA", "size": $SIZE},
    "unpacked_size": $UNPACKED_BYTES,
}, open(sys.argv[1], "w"), indent=2)
open(sys.argv[1], "a").write("\n")
PY
echo "built $OUT/$ARCHIVE ($SIZE bytes, sha256 $SHA, unpacked about $UNPACKED_BYTES bytes)"
