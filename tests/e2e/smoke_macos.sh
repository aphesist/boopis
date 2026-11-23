#!/usr/bin/env bash
# The macOS smoke of a built dmg, on a clean Mac (release.yml's `macos-smoke` job, macos-latest): what a person gets.
#
#   tests/e2e/smoke_macos.sh <boopis_<version>_aarch64.dmg> <output dir>
#
# 1. install: scripts/install.sh --file <dmg>, as a person runs it: the app lands in ~/Applications, the `boopis` launcher in
#    a prefix's bin/;
# 2. the bundle: the app's executable and hx (arm64), the plugin, the runtime archive and runtime.json, the icon, the
#    Info.plist (identifier, version, minimum macOS, the privacy sentences), every signature valid and the hardened runtime
#    on the app and hx;
# 3. `boopis --version` through the launcher names the version and the engine release the bundle carries (runtime.json);
# 4. the app itself, started from the installed bundle with the Local API switched on (`local-api.json`, the switch
#    Settings writes): its window starts, the plugin's secret channel listens, the Local API answers `GET /v1` with the
#    token from `client-token`, a second launch hands over to the first and exits (one boopis per user), and the first-run
#    unpack of the runtime, which the window starts by itself, is reported. A screenshot is kept.
#
# The engine itself (the unpack by the host's own code, the plugin, hx, the gateway, the secret channel, a governed session)
# is tests/setup_live.rs on the same bundle, and the sandbox is the plugin's tests with this bundle's hx: the job runs both.
# Writes HX_BIN, BOOPIS_APP and BOOPIS_RUNTIME_DIR to $GITHUB_ENV when it is set. Exit 0 on success.
set -euo pipefail

DMG="${1:?usage: smoke_macos.sh <dmg> <output dir>}"
OUT="${2:?usage: smoke_macos.sh <dmg> <output dir>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/apps/desktop/src-tauri/tauri.conf.json")"
ID="dev.aphesist.boopis"
DATA="$HOME/Library/Application Support/$ID"
PREFIX="$OUT/prefix"
fail() { echo "::error title=macOS smoke::$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

step "1. install the dmg with scripts/install.sh"
case "$(basename "$DMG")" in "boopis_${VERSION}_aarch64.dmg") ;; *) fail "$(basename "$DMG") is not boopis_${VERSION}_aarch64.dmg" ;; esac
[ ! -e "$HOME/Applications/boopis.app" ] || fail "$HOME/Applications/boopis.app already exists on this runner"
CI=1 bash "$ROOT/scripts/install.sh" --file "$DMG" --yes --prefix "$PREFIX"
APP="$HOME/Applications/boopis.app"
[ -d "$APP" ] || fail "the installer did not put boopis.app in ~/Applications"
[ -x "$PREFIX/bin/boopis" ] || fail "the installer wrote no boopis launcher"
grep -q "Contents/MacOS/boopis\"" "$PREFIX/bin/boopis" || { cat "$PREFIX/bin/boopis"; fail "the launcher does not run the app's own executable"; }

step "2. the bundle"
plist="$APP/Contents/Info.plist"
key() { plutil -extract "$1" raw -o - "$plist"; }
exe="$(key CFBundleExecutable)"
[ "$exe" = boopis ] || fail "CFBundleExecutable is $exe"
[ "$(key CFBundleIdentifier)" = "$ID" ] || fail "CFBundleIdentifier is $(key CFBundleIdentifier)"
[ "$(key CFBundleShortVersionString)" = "$VERSION" ] || fail "the bundle's version is $(key CFBundleShortVersionString), not $VERSION"
[ "$(key LSMinimumSystemVersion)" = 13.0 ] || fail "LSMinimumSystemVersion is $(key LSMinimumSystemVersion)"
for k in NSMicrophoneUsageDescription NSCameraUsageDescription NSAppleEventsUsageDescription NSCalendarsUsageDescription; do
  key "$k" >/dev/null || fail "Info.plist has no $k (packaging/macos/Info.plist is not merged)"
done
icon="$(key CFBundleIconFile)"
[ -f "$APP/Contents/Resources/$icon" ] || [ -f "$APP/Contents/Resources/$icon.icns" ] || fail "no icon $icon in Contents/Resources"
RUNTIME_ARCHIVE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["archive"]["name"])' "$APP/Contents/Resources/runtime/runtime.json")"
for want in "MacOS/boopis" "MacOS/hx" "Resources/plugin/boopis/plugin.yaml" "Resources/runtime/runtime.json" "Resources/runtime/$RUNTIME_ARCHIVE"; do
  [ -e "$APP/Contents/$want" ] || fail "the bundle has no Contents/$want"
done
[ "$RUNTIME_ARCHIVE" = hermes-runtime-macos-aarch64.tar.zst ] || fail "the runtime is $RUNTIME_ARCHIVE, not macos-aarch64"
for bin in boopis hx; do
  [ "$(lipo -archs "$APP/Contents/MacOS/$bin")" = arm64 ] || fail "Contents/MacOS/$bin is $(lipo -archs "$APP/Contents/MacOS/$bin"), not arm64"
done
want_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["archive"]["sha256"])' "$APP/Contents/Resources/runtime/runtime.json")"
[ "$(shasum -a 256 "$APP/Contents/Resources/runtime/$RUNTIME_ARCHIVE" | cut -d' ' -f1)" = "$want_sha" ] || fail "the runtime archive is not what runtime.json says"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -2
signer="$(codesign --display --verbose=2 "$APP" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
echo "signed by: ${signer:-ad hoc (no Developer ID)}"
# the hardened runtime is what notarisation requires; an ad hoc build reports what it has
for bin in "$APP" "$APP/Contents/MacOS/hx"; do
  if codesign --display --verbose=2 "$bin" 2>&1 | grep -q 'flags=.*runtime'; then
    echo "hardened runtime: $bin"
  elif [ -n "$signer" ]; then
    fail "no hardened runtime on $bin"
  else
    echo "no hardened runtime on $bin (ad hoc build)"
  fi
done
codesign --display --entitlements - --xml "$APP" 2>/dev/null | plutil -p - 2>/dev/null || true
spctl --assess --type execute --verbose=2 "$APP" 2>&1 | tee "$OUT/gatekeeper.txt" || true

step "3. boopis --version through the launcher"
engine="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["hermes_version"])' "$APP/Contents/Resources/runtime/runtime.json")"
v="$(NO_COLOR=1 "$PREFIX/bin/boopis" --version)"
echo "$v"
grep -q "$VERSION" <<<"$v" || fail "--version does not print $VERSION"
grep -q "$engine, bundled" <<<"$v" || fail "--version does not name the bundled engine $engine (the resources were not found)"
NO_COLOR=1 "$PREFIX/bin/boopis" doctor >"$OUT/doctor.txt" 2>&1 || true

if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "BOOPIS_APP=$APP"
    echo "HX_BIN=$APP/Contents/MacOS/hx"
    echo "BOOPIS_RUNTIME_DIR=$APP/Contents/Resources/runtime"
  } >>"$GITHUB_ENV"
fi

step "4. the app, with the Local API on"
mkdir -p "$DATA"
printf '{"enabled": true}\n' >"$DATA/local-api.json"
LOG="$OUT/app.log"
NO_COLOR=1 "$APP/Contents/MacOS/$exe" >"$LOG" 2>&1 &
pid=$!
stop() { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }
trap stop EXIT
for _ in $(seq 1 120); do
  [ -s "$DATA/client-endpoint" ] && [ -s "$DATA/client-token" ] && break
  kill -0 "$pid" 2>/dev/null || { tail -40 "$LOG"; fail "the app exited at start"; }
  sleep 0.5
done
[ -s "$DATA/client-endpoint" ] || { tail -40 "$LOG"; fail "the Local API wrote no client-endpoint in 60 s"; }
[ "$(stat -f %Lp "$DATA/client-token")" = 600 ] || fail "client-token is not mode 0600"
url="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$DATA/client-endpoint")"
case "$url" in http://127.0.0.1:*) ;; *) fail "the Local API is at $url, not on the loopback" ;; esac
api() { curl -sS --max-time 10 -H "Authorization: Bearer $(cat "$DATA/client-token")" -o "$OUT/api-$2.json" -w '%{http_code}' "$url$1"; }
code="$(api /v1 root)"
[ "$code" = 200 ] || { cat "$OUT/api-root.json"; fail "GET /v1 answered $code"; }
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d.get("name"), d; print("GET /v1:", d)' "$OUT/api-root.json"
code="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$url/v1")"
[ "$code" = 401 ] || fail "GET /v1 without the token answered $code, not 401"
grep -q "plugin secret channel is up" "$LOG" || { tail -40 "$LOG"; fail "the plugin's secret channel did not start"; }

# one boopis per user: a second launch hands over to the running app and exits; the first keeps its endpoint
"$APP/Contents/MacOS/$exe" >"$OUT/second.log" 2>&1 &
second=$!
for _ in $(seq 1 40); do kill -0 "$second" 2>/dev/null || break; sleep 0.5; done
if kill -0 "$second" 2>/dev/null; then kill "$second"; fail "a second launch kept running beside the first"; fi
kill -0 "$pid" 2>/dev/null || fail "the first app ended when a second was launched"
[ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$DATA/client-endpoint")" = "$url" ] || fail "a second launch replaced the Local API endpoint"
code="$(api /v1 again)"
[ "$code" = 200 ] || fail "after a second launch GET /v1 answered $code"

# the window starts first-run setup by itself: report the unpack it does (the full flow is tests/setup_live.rs)
unpacked=""
for _ in $(seq 1 120); do
  # the folder appears only once the unpack starts: a missing one is "not yet", not a failure
  unpacked="$(find "$DATA/runtime" -maxdepth 2 -name .hx-runtime.json 2>/dev/null | head -1 || true)"
  [ -n "$unpacked" ] && break
  sleep 1
done
echo "first-run unpack by the app: ${unpacked:-not seen within 120 s (the window may be waiting for a choice first)}"
screencapture -x "$OUT/macos-smoke.png" 2>/dev/null || true
if grep -n "panicked" "$LOG"; then fail "the host panicked"; fi
echo "macOS smoke: installed, bundle sound, app started, Local API answered at $url"
