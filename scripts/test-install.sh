#!/usr/bin/env bash
# Tests scripts/install.sh without touching the machine: every run has its own HOME and prefix in a temp folder, the
# artifact is a dummy AppImage, the download path uses file:// addresses, and macOS is played by stand-ins for uname and
# hdiutil. Nothing needs the network; `script` gives the terminal runs a real tty.
set -eu
set -o pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
installer=$root/scripts/install.sh
T=$(mktemp -d)
trap 'rm -rf "${T:?}"' EXIT
failures=0

pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; failures=$((failures + 1)); }
check() { # check <name> <command...>
  local name=$1
  shift
  if "$@"; then pass "$name"; else fail "$name"; fi
}
contains() { grep -qF -- "$2" <<<"$1"; }
lacks() { ! grep -qF -- "$2" <<<"$1"; }
empty_dir() { [ -z "$(find "$1" -mindepth 1)" ]; }

NAME=boopis_0.0.0_amd64.AppImage
mkdir -p "${T:?}/art"
printf '#!/bin/sh\necho "dummy appimage $*"\n' >"$T/art/$NAME"
chmod +x "$T/art/$NAME"
SUM=$(sha256sum "$T/art/$NAME" | awk '{print $1}')

# A fresh HOME and prefix for each case.
fresh() {
  rm -rf "${T:?}/home" "${T:?}/p"
  mkdir -p "$T/home" "$T/p"
}
run() { # run <args...>: the installer on a pipe (no terminal), with the case's HOME
  env -u NO_COLOR -u CI HOME="$T/home" bash "$installer" "$@" 2>&1
}
files_of() { (cd "$1" && find . -type f -o -type l | sed 's|^\./||' | sort); }
home_listing() { (cd "$T/home" && find . | sort); }

expected=$(
  {
    echo bin/boopis
    echo share/applications/boopis.desktop
    echo share/boopis/boopis.AppImage
    echo share/boopis/manifest
    echo share/boopis/uninstall.sh
    echo share/icons/hicolor/symbolic/apps/boopis-symbolic.svg
    for s in 16 24 32 48 64 128 256; do
      echo "share/icons/hicolor/${s}x${s}/apps/boopis.png"
      echo "share/icons/hicolor/${s}x${s}/apps/boopis-dark.png"
    done
  } | sort
)

# ---- 1. install, then uninstall: exactly these files appear, and exactly these disappear
fresh
home_listing >"$T/home.before"
out=$(run --file "$T/art/$NAME" --prefix "$T/p" --yes) || fail "install exits 0"
check "install: exactly the expected files appear" test "$(files_of "$T/p")" = "$expected"
check "install: nothing is written outside the prefix" test "$(home_listing)" = "$(cat "$T/home.before")"
manifest_files=$(awk '$1 == "f" {print $2}' "$T/p/share/boopis/manifest" | sed "s|^$T/p/||" | sort)
check "the manifest lists exactly the files that appeared" test "$manifest_files" = "$expected"
check "install: the launcher runs the app" test "$("$T/p/bin/boopis" --flag)" = "dummy appimage --flag"
check "install: the app is executable" test -x "$T/p/share/boopis/boopis.AppImage"
check "install: the menu entry points at the launcher" grep -qx "Exec=$T/p/bin/boopis %U" "$T/p/share/applications/boopis.desktop"
check "install: the menu entry carries the window class of the AppImage's binary" grep -qx 'StartupWMClass=boopis' "$T/p/share/applications/boopis.desktop"
check "install: the menu entry names the light icon" grep -qx 'Icon=boopis' "$T/p/share/applications/boopis.desktop"
check "install: the icons are PNGs" test "$(head -c 8 "$T/p/share/icons/hicolor/64x64/apps/boopis.png" | od -An -tx1 | tr -d ' \n')" = 89504e470d0a1a0a
check "install: the final box says it is ready" contains "$out" "boopis is ready"
check "install: the box says how to uninstall" contains "$out" "uninstall.sh"
check "install: a pipe gets no escape codes" lacks "$out" $'\033'
run --uninstall --prefix "$T/p" >/dev/null || fail "uninstall exits 0"
check "uninstall: every file is gone" test -z "$(files_of "$T/p")"
check "uninstall: every folder the installer made is gone" empty_dir "$T/p"
check "uninstall: the home folder is as it was" test "$(home_listing)" = "$(cat "$T/home.before")"

# ---- 2. the uninstaller the installer writes does the same, with no copy of the installer around
fresh
run --file "$T/art/$NAME" --prefix "$T/p" --yes --quiet >/dev/null
env HOME="$T/home" bash "$T/p/share/boopis/uninstall.sh" >/dev/null
check "uninstall.sh: removes everything" empty_dir "$T/p"

# ---- 3. a second install replaces the first, and leaves no second set of files
fresh
run --file "$T/art/$NAME" --prefix "$T/p" --yes --quiet >/dev/null
run --file "$T/art/$NAME" --prefix "$T/p" --yes --quiet >/dev/null
check "reinstall: the same files, once" test "$(files_of "$T/p")" = "$expected"

# ---- 4. the checksum
fresh
printf '%s  %s\n' "$SUM" "$NAME" >"$T/art/SHA256SUMS"
out=$(run --file "$T/art/$NAME" --prefix "$T/p" --yes) || fail "install with a good SHA256SUMS exits 0"
check "checksum: a SHA256SUMS beside the file is used" contains "$out" "Verified"
fresh
printf '%s  %s\n' "$(printf 'wrong' | sha256sum | awk '{print $1}')" "$NAME" >"$T/art/SHA256SUMS"
rc=0
out=$(run --file "$T/art/$NAME" --prefix "$T/p" --yes) || rc=$?
check "checksum: a wrong hash stops the install" test "$rc" = 1
check "checksum: the message says what to do" contains "$out" "Download it again"
check "checksum: nothing was installed" empty_dir "$T/p"
rm -f "$T/art/SHA256SUMS"
fresh
out=$(run --file "$T/art/$NAME" --sha256 "$SUM" --prefix "$T/p" --yes) || fail "--sha256 exits 0"
check "checksum: --sha256 verifies" contains "$out" "Verified"
fresh
rc=0
out=$(run --file "$T/art/$NAME" --sha256 deadbeef --prefix "$T/p" --yes) || rc=$?
check "checksum: a wrong --sha256 stops the install" test "$rc" = 1

# ---- 5. the download path, against a folder of release files (file:// addresses)
fresh
rel=$T/rel/aphesist/boopis/releases/download/v0.0.0
mkdir -p "$rel"
cp "$T/art/$NAME" "$rel/"
(cd "$rel" && sha256sum -- "$NAME" >SHA256SUMS)
out=$(BOOPIS_BASE_URL="file://$T/rel" run --version 0.0.0 --prefix "$T/p" --yes) || fail "download install exits 0 ($out)"
check "download: installs the release's files" test "$(files_of "$T/p")" = "$expected"
check "download: shows the release and the file" contains "$out" "v0.0.0"
# no --version: the latest release, or the newest pre-release while there is no other (the API as files: a `releases`
# file is the list, newest first, and a `releases/latest` file the latest release, which GitHub never answers with a pre-release)
api=$T/api/repos/aphesist/boopis
mkdir -p "$api"
printf '[{"tag_name": "v0.0.0", "prerelease": true}, {"tag_name": "v0.0.0-older", "prerelease": true}]' >"$api/releases"
fresh
out=$(BOOPIS_BASE_URL="file://$T/rel" BOOPIS_API_URL="file://$T/api" run --prefix "$T/p" --yes) || fail "pre-release install exits 0 ($out)"
check "latest: with only pre-releases, the newest one is installed" test "$(files_of "$T/p")" = "$expected"
check "latest: and named" contains "$out" "v0.0.0"
rm -f "$api/releases"
mkdir -p "$api/releases"
printf '{"tag_name": "v0.0.0", "prerelease": false}' >"$api/releases/latest"
fresh
out=$(BOOPIS_BASE_URL="file://$T/rel" BOOPIS_API_URL="file://$T/api" run --prefix "$T/p" --yes) || fail "latest install exits 0 ($out)"
check "latest: the latest release is installed" test "$(files_of "$T/p")" = "$expected"
fresh
rc=0
out=$(BOOPIS_BASE_URL="file://$T/rel" run --version v9.9.9 --prefix "$T/p" --yes) || rc=$?
check "download: a release that does not exist is a sentence and a way out" test "$rc" = 1
check "download: the sentence names the file" contains "$out" "could not download boopis_9.9.9_amd64.AppImage"
check "download: no stack, no line numbers" lacks "$out" "line "
rm -f "$rel/SHA256SUMS"
fresh
rc=0
out=$(BOOPIS_BASE_URL="file://$T/rel" run --version v0.0.0 --prefix "$T/p" --yes) || rc=$?
check "download: a release with no checksums installs nothing" test "$rc" = 1
check "download: and says so" contains "$out" "has no SHA256SUMS"
check "download: nothing was installed" empty_dir "$T/p"

# ---- 6. quiet, help and mistakes
fresh
out=$(run --file "$T/art/$NAME" --prefix "$T/p" --yes --quiet)
check "--quiet prints nothing on success" test -z "$out"
rc=0
out=$(run --uninstall --prefix "$T/none") || rc=$?
check "uninstall with no manifest: a sentence and a way out" test "$rc" = 1
check "uninstall with no manifest: names the prefix hint" contains "$out" "--prefix"
rc=0
out=$(run --nonsense) || rc=$?
check "an unknown option exits 2" test "$rc" = 2
check "an unknown option points at --help" contains "$out" "--help"
out=$(run --help)
check "--help lists --uninstall and --file" contains "$out" "--uninstall"

# ---- 7. a terminal: colour, banner, animation switches (script gives the run a real tty)
# Every variable the installer reads to decide what the terminal shows. A run starts without them, so the cases below test
# the terminal path wherever the suite runs (GitHub's runners set CI=true; a person's shell may set NO_COLOR, COLORTERM
# or LC_ALL) and each case sets only what it is about.
TERM_VARS="-u CI -u NO_COLOR -u BOOPIS_NO_ANIMATION -u COLORTERM -u LC_ALL -u LC_CTYPE -u LANG -u COLUMNS"
termrun() { # termrun <env assignments...> -- <installer args...>
  local envs=()
  while [ "$1" != -- ]; do
    envs+=("$1")
    shift
  done
  shift
  fresh
  script -qefc "env $TERM_VARS ${envs[*]} HOME=$T/home bash $installer --file $T/art/$NAME --prefix $T/p --yes $*" /dev/null 2>&1 | tr -d '\r'
}
base=(TERM=xterm-256color LANG=C.UTF-8)
out=$(termrun "${base[@]}" COLORTERM=truecolor --)
check "terminal: truecolor uses 24-bit codes" contains "$out" $'\033[38;2;'
check "terminal: the banner is drawn" contains "$out" "██▌"
check "terminal: the animation redraws in place" contains "$out" $'\033[14A'
check "terminal: the marks are check marks" contains "$out" "✓"
check "terminal: the box is rounded" contains "$out" "╭"
out=$(termrun "${base[@]}" --)
check "terminal: 256 colours use 38;5" contains "$out" $'\033[38;5;'
out=$(termrun TERM=xterm LANG=C.UTF-8 --)
check "terminal: plain xterm falls back to 16 colours" lacks "$out" $'\033[38;5;'
out=$(termrun "${base[@]}" NO_COLOR=1 --)
check "NO_COLOR: no colour codes" lacks "$out" $'\033[3'
check "NO_COLOR: the art is still drawn" contains "$out" "██▌"
out=$(termrun "${base[@]}" BOOPIS_NO_ANIMATION=1 --)
check "BOOPIS_NO_ANIMATION: no redraws" lacks "$out" $'\033[14A'
check "BOOPIS_NO_ANIMATION: the banner is still there" contains "$out" "██▌"
out=$(termrun "${base[@]}" CI=true --)
check "CI: no animation" lacks "$out" $'\033[14A'
out=$(termrun TERM=dumb LANG=C.UTF-8 --)
check "TERM=dumb: no escape codes" lacks "$out" $'\033'
check "TERM=dumb: no block art" lacks "$out" "██▌"
out=$(termrun TERM=xterm-256color LANG=C --)
check "a locale that is not UTF-8: no block art" lacks "$out" "██▌"
check "a locale that is not UTF-8: ASCII marks" lacks "$out" "✓"
out=$(termrun "${base[@]}" -- --no-color)
check "--no-color: no colour codes" lacks "$out" $'\033[3'
out=$(termrun "${base[@]}" -- --quiet)
check "--quiet on a terminal prints nothing" test -z "$out"

# ---- 8. macOS, played by stand-ins for uname and hdiutil
mkdir -p "$T/shim"
cat >"$T/shim/uname" <<'SH'
#!/bin/sh
case "$1" in
  -s) echo "${FAKE_KERNEL:-Darwin}" ;;
  -m) echo "${FAKE_MACHINE:-arm64}" ;;
  *) /usr/bin/uname "$@" ;;
esac
SH
cat >"$T/shim/hdiutil" <<'SH'
#!/bin/sh
# attach ... -mountpoint DIR image: make DIR hold an app; detach: nothing to do
if [ "$1" = attach ]; then
  while [ "$#" -gt 0 ]; do
    [ "$1" = -mountpoint ] && mp=$2
    shift
  done
  mkdir -p "$mp/boopis.app/Contents/MacOS"
  printf '#!/bin/sh\necho "dummy app $*"\n' >"$mp/boopis.app/Contents/MacOS/boopis"
  chmod +x "$mp/boopis.app/Contents/MacOS/boopis"
fi
exit 0
SH
chmod +x "$T/shim/uname" "$T/shim/hdiutil"
printf 'not really a disk image\n' >"$T/art/boopis_0.0.0_aarch64.dmg"
fresh
out=$(env PATH="$T/shim:$PATH" HOME="$T/home" bash "$installer" --file "$T/art/boopis_0.0.0_aarch64.dmg" --prefix "$T/p" --yes 2>&1) || fail "macOS install exits 0 ($out)"
check "macOS: the app lands in ~/Applications" test -x "$T/home/Applications/boopis.app/Contents/MacOS/boopis"
check "macOS: the launcher runs the app's binary with arguments" test "$("$T/p/bin/boopis" doctor)" = "dummy app doctor"
check "macOS: the manifest records the app bundle" grep -qx "a $T/home/Applications/boopis.app" "$T/p/share/boopis/manifest"
check "macOS: the box says Launchpad" contains "$out" "Launchpad"
env PATH="$T/shim:$PATH" HOME="$T/home" bash "$installer" --uninstall --prefix "$T/p" >/dev/null
check "macOS uninstall: the app is gone" test ! -e "$T/home/Applications/boopis.app"
check "macOS uninstall: the prefix is empty" empty_dir "$T/p"
check "macOS uninstall: ~/Applications, which the installer made, is gone" test ! -e "$T/home/Applications"
fresh
rc=0
out=$(env PATH="$T/shim:$PATH" FAKE_KERNEL=Linux FAKE_MACHINE=aarch64 HOME="$T/home" bash "$installer" --file "$T/art/$NAME" --prefix "$T/p" --yes 2>&1) || rc=$?
check "an unsupported processor is a failure" test "$rc" = 1
check "an unsupported processor names what releases carry" contains "$out" "Releases carry"

if [ "$failures" -gt 0 ]; then
  printf '%d check(s) failed\n' "$failures" >&2
  exit 1
fi
echo "all install checks passed"
