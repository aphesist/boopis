#!/usr/bin/env bash
# Checks an installed boopis package (ADR-0025). Run in a clean Arch container after `pacman -U boopis-*.pkg.tar.zst`:
#
#   packaging/arch/smoke.sh [<repository checkout>]
#
# It proves what the package is for: the binary starts linking the SYSTEM's WebKitGTK from /usr/lib, no WebKitGTK is carried,
# and the files the host looks for (hx, the plugin, the Hermes runtime) are where it looks. Exits non-zero on the first failure.
# Everything that names the old internal binary is one line in the block below.
set -euo pipefail

# The old internal names this script still needs (the rename changes these lines only).
PLUGIN=boopis   # plugin directory under /usr/lib/boopis/plugin
RUNTIME_ARCHIVE=hermes-runtime-linux-x86_64.tar.zst

REPO="${1:-.}"
BIN=/usr/bin/boopis
LIB=/usr/lib/boopis
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok:   $*"; }

[ -x "$BIN" ] || fail "$BIN is not installed"
ok "$BIN is installed ($(pacman -Q boopis))"

# the files the host looks for, in the layout apps/desktop/src-tauri/src/resources.rs resolves
for f in "$LIB/hx" "$LIB/plugin/$PLUGIN/plugin.yaml" "$LIB/runtime/runtime.json" "$LIB/runtime/$RUNTIME_ARCHIVE" \
  /usr/share/applications/boopis.desktop /usr/share/icons/hicolor/256x256/apps/boopis.png \
  /usr/share/icons/hicolor/256x256/apps/boopis-dark.png /usr/share/icons/hicolor/symbolic/apps/boopis-symbolic.svg \
  /usr/share/licenses/boopis/NOTICE /usr/share/licenses/boopis/hermes-agent-LICENSE; do
  [ -f "$f" ] || fail "missing $f"
done
[ "$(stat -c %a "$LIB/hx")" = 755 ] || fail "$LIB/hx is not executable"
if [ -e /usr/bin/hx ] && [ "$(pacman -Qoq /usr/bin/hx 2>/dev/null)" = boopis ]; then fail "hx must not be in /usr/bin (Helix owns that name)"; fi
ok "binary, hx, plugin, runtime, desktop entry, icons and licences are in place"

# the runtime archive is the one runtime.json describes
want="$(sed -n 's/.*"sha256": *"\([0-9a-f]*\)".*/\1/p' "$LIB/runtime/runtime.json")"
have="$(sha256sum "$LIB/runtime/$RUNTIME_ARCHIVE" | cut -d' ' -f1)"
[ "$want" = "$have" ] || fail "the runtime archive has sha256 $have, runtime.json says $want"
ok "the Hermes runtime archive matches runtime.json ($(stat -c %s "$LIB/runtime/$RUNTIME_ARCHIVE") bytes)"

# links: every library resolves, WebKitGTK is the system's, none is carried
if ldd "$BIN" | grep 'not found'; then fail "libraries above are missing (the package's depends is incomplete)"; fi
webkit="$(ldd "$BIN" | awk '$1 ~ /^libwebkit2gtk-4\.1\.so/ {print $3}')"
[ -n "$webkit" ] || fail "$BIN does not link libwebkit2gtk-4.1"
case "$(readlink -f "$webkit")" in /usr/lib/*) ok "links the system's $webkit" ;; *) fail "libwebkit2gtk resolves to $webkit, not /usr/lib" ;; esac
if find "$LIB" \( -name 'libwebkit2gtk*' -o -name 'libjavascriptcoregtk*' -o -name 'WebKit*Process' \) | grep .; then
  fail "the package carries a WebKitGTK"
fi
ok "no WebKitGTK is carried"
if ldd "$LIB/hx" | grep 'not found'; then fail "hx has unresolved libraries"; fi
ok "hx resolves its libraries"

# the system's WebKitGTK version: ADR-0025 relies on 2.54.2 or later (a warning, not a failure: Arch decides what it ships)
wk="$(pacman -Q webkit2gtk-4.1 | cut -d' ' -f2)"
if [ "$(printf '%s\n2.54.2\n' "${wk%%-*}" | sort -V | head -1)" = 2.54.2 ]; then ok "WebKitGTK $wk (2.54.2 or later)"
else echo "::warning::WebKitGTK $wk is older than 2.54.2 (the NVIDIA explicit-sync fix)"; fi

# starts: only when the app handles --version itself (without it the app would try to open a window)
if grep -rqF '"--version"' "$REPO/apps/desktop/src-tauri/src" 2>/dev/null; then
  out="$(env -u DISPLAY -u WAYLAND_DISPLAY timeout 30 "$BIN" --version)" || fail "boopis --version failed"
  ver="$(pacman -Q boopis | cut -d' ' -f2)"
  case "$out" in *"${ver%%-*}"*) ok "boopis --version: $out" ;; *) fail "boopis --version printed '$out', not the version ${ver%%-*}" ;; esac
else
  ok "no command-line handling in this build: the links above are the start check"
fi

# the package's files are what pacman installed
pacman -Qkk boopis >/dev/null || fail "pacman -Qkk reports altered files"
ok "pacman -Qkk is clean"
