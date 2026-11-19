#!/usr/bin/env bash
# boopis installer for Linux and macOS.
#
#   curl -fsSL <where this file is served> | bash
#   bash install.sh [--version vX.Y.Z] [--file PATH] [--prefix DIR] [--yes] [--quiet] [--no-color] [--uninstall]
#
# It installs the latest release (or the one you name, or a local file), checks its sha256, and registers it. It asks
# for no sudo unless you pass --system, and it removes exactly what it installed (from the manifest it wrote).
# The art at the bottom is generated: edit packaging/brand/ and run scripts/embed-brand.sh, not this file.
set -eu
set -o pipefail

# ----------------------------------------------------------------------------------------------------------------------
# Where releases come from. Everything that names the project lives here and nowhere else.
# ----------------------------------------------------------------------------------------------------------------------
BOOPIS_OWNER=aphesist
BOOPIS_REPO=hypotaxis
# The command, the install folder and the menu entry.
APP=boopis
APP_COMMENT='A desktop app for AI coding agents'
# The files of a release. {v} is the version without its leading v.
ARTIFACT_LINUX_X86_64='Hypotaxis_{v}_amd64.AppImage'
ARTIFACT_MACOS_AARCH64='Hypotaxis_{v}_aarch64.dmg'
CHECKSUMS_NAME=SHA256SUMS
# Where to ask. The defaults are GitHub's; BOOPIS_BASE_URL and BOOPIS_API_URL point at a mirror (or a folder, in tests).
BASE_URL=${BOOPIS_BASE_URL:-https://github.com}
API_URL=${BOOPIS_API_URL:-https://api.github.com}
# Where the app keeps its own data (it is never removed by --uninstall).
APP_DATA_DIR='.local/share/dev.aphesist.hypotaxis'
# ----------------------------------------------------------------------------------------------------------------------

# Options.
OPT_VERSION=''
OPT_FILE=''
OPT_PREFIX=''
OPT_YES=0
OPT_QUIET=0
OPT_NO_COLOR=0
OPT_UNINSTALL=0
OPT_SYSTEM=0
OPT_SHA256=''
OPT_ICON=light

# State.
WORK=''
JOB_PID=''
SUDO=''
PREFIX=''
APPS_DIR=''
OS=''
ARCH=''
MODE=mono        # colour level: truecolor, 256, 16 or mono (the names the renderer uses)
UNICODE=0
INTERACTIVE=0
ANIMATE=0
COLS=80
C_OK='' C_FAIL='' C_WARN='' C_DIM='' C_STRONG='' C_OFF=''
MARK_OK='+' MARK_FAIL='x' MARK_WARN='!'
FUSE_MISSING=0
CURSOR_HIDDEN=0
INSTALLED_AT=''
START_HINT=''
UNINSTALL_HINT=''

# ---------------------------------------------------------------------------------------------------- the terminal ----

# Decide what this terminal can show, in the same order as the host's renderer (brand.rs): NO_COLOR, a dumb terminal and
# a pipe give no colour; COLORTERM and TERM give the level; the locale gives Unicode; CI and BOOPIS_NO_ANIMATION stop
# the animation.
detect_terminal() {
  local tty=0 term=${TERM:-} colorterm locale
  [ -t 1 ] && tty=1
  INTERACTIVE=0
  [ "$tty" = 1 ] && [ "$term" != dumb ] && INTERACTIVE=1
  MODE=mono
  if [ "$INTERACTIVE" = 1 ] && [ -z "${NO_COLOR:-}" ] && [ "$OPT_NO_COLOR" = 0 ]; then
    colorterm=$(printf '%s' "${COLORTERM:-}" | tr '[:upper:]' '[:lower:]')
    case "$colorterm" in
      truecolor | 24bit) MODE=truecolor ;;
      *)
        case "$term" in
          *256color) MODE=256 ;;
          *) MODE=16 ;;
        esac
        ;;
    esac
  fi
  locale=${LC_ALL:-}
  [ -n "$locale" ] || locale=${LC_CTYPE:-}
  [ -n "$locale" ] || locale=${LANG:-}
  case "$(printf '%s' "$locale" | tr '[:upper:]' '[:lower:]')" in
    *utf-8* | *utf8*) UNICODE=1 ;;
    *) UNICODE=0 ;;
  esac
  ANIMATE=0
  if [ "$INTERACTIVE" = 1 ] && [ "$UNICODE" = 1 ] && [ -z "${CI:-}" ]; then
    case "${BOOPIS_NO_ANIMATION:-}" in '' | 0) ANIMATE=1 ;; esac
  fi
  COLS=80
  if [ "$INTERACTIVE" = 1 ]; then
    COLS=$(stty size </dev/tty 2>/dev/null | awk '{print $2}') || COLS=80
    case "$COLS" in '' | *[!0-9]*) COLS=${COLUMNS:-80} ;; esac
    case "$COLS" in '' | *[!0-9]* | 0) COLS=80 ;; esac
  fi
  if [ "$MODE" != mono ]; then
    C_OK=$'\033['$(brand_sgr moss)m
    C_FAIL=$'\033['$(brand_sgr nina)m
    C_WARN=$'\033['$(brand_sgr terra)m
    C_DIM=$'\033[2m' C_STRONG=$'\033[1m' C_OFF=$'\033[0m'
  else
    C_OK='' C_FAIL='' C_WARN='' C_DIM='' C_STRONG='' C_OFF=''
  fi
  if [ "$INTERACTIVE" = 1 ] && [ "$UNICODE" = 1 ]; then
    MARK_OK='✓' MARK_FAIL='✗' MARK_WARN='!'
  else
    MARK_OK='+' MARK_FAIL='x' MARK_WARN='!'
  fi
}

# The art renderer (render.awk, embedded below): the art file on its standard input.
brand_awk() {
  printf '%s\n' "$BRAND_ART" | awk "$@" "$BRAND_AWK"
}

# The SGR parameters of a palette colour at this level (38;2;r;g;b, 38;5;n or 30 to 97).
brand_sgr() {
  brand_awk -v mode="$MODE" -v color="$1"
}

# ---------------------------------------------------------------------------------------------------------- output ----

say() { [ "$OPT_QUIET" = 1 ] || printf '%s\n' "$*"; }

# One finished step: a mark, a label and what it found.
step_ok() {
  [ "$OPT_QUIET" = 1 ] && return 0
  if [ "$INTERACTIVE" = 1 ] && [ "$ANIMATE" = 1 ]; then printf '\r\033[K'; fi
  printf '  %s%s%s %-13s %s\n' "$C_OK" "$MARK_OK" "$C_OFF" "$1" "$2"
}

# A warning that does not stop the install: what it found and what to do.
step_warn() {
  [ "$OPT_QUIET" = 1 ] && return 0
  printf '  %s%s%s %-13s %s\n' "$C_WARN" "$MARK_WARN" "$C_OFF" "$1" "$2"
}

# Stop with a sentence that names the problem and one that names the way out. Nothing raw, never a stack.
die() {
  if [ "$ANIMATE" = 1 ]; then printf '\r\033[K' >&2; fi
  printf '  %s%s%s %s\n' "$C_FAIL" "$MARK_FAIL" "$C_OFF" "$1" >&2
  [ -z "${2:-}" ] || printf '    %s\n' "$2" >&2
  exit 1
}

# Shorten the home folder for display.
tilde() {
  # shellcheck disable=SC2088 # the tilde is the text to show, not a path to expand
  case "$1" in
    "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# A hash shortened for display: 12 characters, an ellipsis, 6.
short_hash() {
  local dots=...
  [ "$UNICODE" = 0 ] || dots='…'
  printf '%s%s%s' "${1:0:12}" "$dots" "${1: -6}"
}

human_size() {
  local b=$1 tenths
  tenths=$((b * 10 / 1048576))
  printf '%d.%d MB' $((tenths / 10)) $((tenths % 10))
}

# The banner: the wordmark and the bots, with a short animation when the terminal allows it. Never on a pipe, a dumb
# terminal, a narrow one or with --quiet; then the one-line logo.
show_banner() {
  [ "$OPT_QUIET" = 1 ] && return 0
  if [ "$INTERACTIVE" = 1 ] && [ "$UNICODE" = 1 ] && [ "$COLS" -ge 66 ]; then
    printf '\n'
    if [ "$ANIMATE" = 1 ]; then
      CURSOR_HIDDEN=1
      printf '\033[?25l'
      brand_awk -v mode="$MODE" -v scene=banner -v indent=2 -v play=1
      printf '\033[?25h'
      CURSOR_HIDDEN=0
    else
      brand_awk -v mode="$MODE" -v scene=banner -v indent=2
    fi
    printf '\n'
  else
    local name=boopis
    if [ "$INTERACTIVE" = 1 ] && [ "$UNICODE" = 1 ]; then name=$(brand_awk -v text=compact); fi
    printf '\n  %s%s%s installer\n\n' "$C_STRONG" "$name" "$C_OFF"
  fi
}

# The progress bar: 28 cells, filled in the terminal's own ink, the rest dim.
bar() {
  local pct=$1 width=28 fill rest
  fill=$((pct * width / 100))
  rest=$((width - fill))
  printf '%s' "$C_STRONG"
  [ "$fill" -le 0 ] || printf '%*s' "$fill" '' | sed 's/ /█/g'
  printf '%s%s' "$C_OFF" "$C_DIM"
  [ "$rest" -le 0 ] || printf '%*s' "$rest" '' | sed 's/ /░/g'
  printf '%s' "$C_OFF"
}

# ------------------------------------------------------------------------------------------------------ small tools ----

have() { command -v "$1" >/dev/null 2>&1; }

sha256_of() {
  if have sha256sum; then
    sha256sum -- "$1" | awk '{print $1}'
  elif have shasum; then
    shasum -a 256 -- "$1" | awk '{print $1}'
  elif have openssl; then
    openssl dgst -sha256 -- "$1" | awk '{print $NF}'
  else
    die 'boopis could not check the download, because this machine has no sha256sum, shasum or openssl.' \
      'Install one of them (coreutils has sha256sum), then run the installer again.'
  fi
}

file_size() { wc -c <"$1" | tr -d ' '; }

# Run a command with the privileges the target needs: none, unless --system chose a place only root can write.
priv() {
  if [ -n "$SUDO" ]; then "$SUDO" "$@"; else "$@"; fi
}

# ---------------------------------------------------------------------------------------------------- the manifest ----

MANIFEST=''
MANIFEST_NEW=''

# Everything the installer creates is recorded as it is created: `f` a file or link, `d` a folder it made, `a` an app
# bundle. Uninstall reads this list and nothing else.
record() {
  printf '%s %s\n' "$1" "$2" >>"$MANIFEST_NEW"
}

make_dir() {
  local dir=$1 parent
  [ -d "$dir" ] && return 0
  parent=$(dirname "$dir")
  make_dir "$parent"
  priv mkdir "$dir"
  record d "$dir"
}

put_file() { # put_file <mode> <source> <destination>
  make_dir "$(dirname "$3")"
  priv install -m "$1" "$2" "$3"
  record f "$3"
}

put_text() { # put_text <mode> <destination>, the text on standard input
  local tmp="$WORK/text.$$"
  cat >"$tmp"
  put_file "$1" "$tmp" "$2"
  rm -f "$tmp"
}

# Remove what a manifest lists, files first and then the folders the installer made (if they are empty by now).
do_uninstall() {
  local manifest=$1 kind path dirs='' shown
  shown=$(tilde "$manifest")
  [ -f "$manifest" ] || die "boopis is not installed here: there is no manifest at $shown." \
    'If you installed it somewhere else, pass the same --prefix you installed with.'
  while IFS=' ' read -r kind path; do
    case "$path" in /* | '') ;; *) die "The manifest at $shown holds a path that is not absolute." 'It was not written by this installer, so nothing was removed.' ;; esac
    case "$path" in *..*) die "The manifest at $shown holds a path with '..' in it." 'It was not written by this installer, so nothing was removed.' ;; esac
    case "$kind" in
      f) priv rm -f -- "$path" ;;
      a) case "$path" in *.app) priv rm -rf -- "$path" ;; esac ;;
      d) dirs="$path
$dirs" ;;
    esac
  done <"$manifest"
  # Longest paths first, so a folder is empty by the time its turn comes.
  printf '%s' "$dirs" | awk 'NF {print length($0) " " $0}' | sort -rn | cut -d' ' -f2- |
    while IFS= read -r path; do priv rmdir -- "$path" 2>/dev/null || true; done
  priv rm -f -- "$manifest"
}

# --------------------------------------------------------------------------------------------------------- platform ----

detect_platform() {
  local kernel machine
  kernel=$(uname -s)
  machine=$(uname -m)
  case "$kernel" in
    Linux) OS=linux ;;
    Darwin) OS=macos ;;
    *) die "boopis has no installer for $kernel yet." 'On Windows, use install.ps1. Linux and macOS are covered here.' ;;
  esac
  case "$machine" in
    x86_64 | amd64) ARCH=x86_64 ;;
    arm64 | aarch64) ARCH=aarch64 ;;
    *) die "boopis has no build for the $machine processor." 'Releases carry Linux x86_64 and macOS on Apple silicon.' ;;
  esac
  case "$OS-$ARCH" in
    linux-x86_64 | macos-aarch64) ;;
    *) die "boopis has no build for $OS $ARCH yet." 'Releases carry Linux x86_64 and macOS on Apple silicon.' ;;
  esac
}

artifact_template() {
  case "$OS-$ARCH" in
    linux-x86_64) printf '%s' "$ARTIFACT_LINUX_X86_64" ;;
    macos-aarch64) printf '%s' "$ARTIFACT_MACOS_AARCH64" ;;
  esac
}

# ------------------------------------------------------------------------------------------------------ the release ----

# The download runs in the background while the banner plays: it resolves the release, then fetches the artifact and the
# checksums into $WORK. The foreground only reads what the job has written, so the animation never holds it up.
#   $WORK/tag, $WORK/name   the release and the file, as soon as they are known
#   $WORK/total             the size in bytes, when the server said
#   $WORK/artifact          the finished download (renamed from artifact.part)
#   $WORK/sums              the checksums file
#   $WORK/fail              two lines: the problem and the way out
fetch_job() {
  local tag name url code total
  fail() { printf '%s\n%s\n' "$1" "$2" >"$WORK/fail"; exit 0; }
  if [ -n "$OPT_VERSION" ]; then
    tag=$OPT_VERSION
    case "$tag" in v*) ;; *) tag=v$tag ;; esac
  else
    have curl || have wget || fail 'boopis needs curl or wget to download itself, and this machine has neither.' \
      'Install curl, or download a release by hand and run: bash install.sh --file <the file>.'
    local api="$API_URL/repos/$BOOPIS_OWNER/$BOOPIS_REPO/releases/latest" body
    if have curl; then
      body=$(curl -fsSL -H 'Accept: application/vnd.github+json' "$api" 2>/dev/null) || body=''
    else
      body=$(wget -qO- "$api" 2>/dev/null) || body=''
    fi
    tag=$(printf '%s' "$body" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
    [ -n "$tag" ] || fail "boopis could not find the latest release of $BOOPIS_OWNER/$BOOPIS_REPO." \
      'Check your connection, or name a release with --version vX.Y.Z. If the repository is private, download the file with gh and use --file.'
  fi
  name=$(artifact_template | sed "s/{v}/${tag#v}/g")
  printf '%s' "$tag" >"$WORK/tag"
  printf '%s' "$name" >"$WORK/name"
  url="$BASE_URL/$BOOPIS_OWNER/$BOOPIS_REPO/releases/download/$tag"
  # The size, for the progress bar: the last Content-Length of the redirects.
  if have curl; then
    total=$(curl -fsSIL "$url/$name" 2>/dev/null | tr -d '\r' | awk 'tolower($1) == "content-length:" {n = $2} END {print n + 0}') || total=0
  else
    total=0
  fi
  printf '%s' "${total:-0}" >"$WORK/total"
  code=0
  if have curl; then
    curl -fsSL --retry 2 -o "$WORK/artifact.part" "$url/$name" 2>/dev/null || code=$?
  else
    wget -q -O "$WORK/artifact.part" "$url/$name" 2>/dev/null || code=$?
  fi
  if [ "$code" != 0 ]; then
    rm -f "$WORK/artifact.part"
    fail "boopis could not download $name from release $tag." \
      "Check that the release exists and has that file, or name another with --version. Address: $url/$name"
  fi
  mv "$WORK/artifact.part" "$WORK/artifact"
  if have curl; then
    curl -fsSL --retry 2 -o "$WORK/sums" "$url/$CHECKSUMS_NAME" 2>/dev/null || code=$?
  else
    wget -q -O "$WORK/sums" "$url/$CHECKSUMS_NAME" 2>/dev/null || code=$?
  fi
  if [ "$code" != 0 ]; then
    rm -f "$WORK/sums"
    fail "The release $tag has no $CHECKSUMS_NAME, so the download cannot be checked." \
      'Nothing was installed. Ask the maintainers to attach the checksums to the release.'
  fi
  : >"$WORK/done"
}

# Wait for a file the job writes, or for its failure; show the failure as the step's own.
wait_for() { # wait_for <file>
  while [ ! -e "$1" ] && [ ! -e "$WORK/fail" ]; do
    sleep 0.05 2>/dev/null || sleep 1
  done
  if [ -e "$WORK/fail" ] && [ ! -e "$1" ]; then
    local problem next
    { read -r problem; read -r next; } <"$WORK/fail"
    die "$problem" "$next"
  fi
}

# Show the download: a bar on a terminal that may redraw, one line otherwise.
show_download() {
  local name total have_bytes pct size tick=0 spin='|/-'$'\\'
  wait_for "$WORK/total"
  name=$(cat "$WORK/name")
  total=$(cat "$WORK/total")
  if [ "$OPT_QUIET" = 1 ]; then
    wait_for "$WORK/done"
    return 0
  fi
  if [ "$ANIMATE" = 0 ]; then
    size=''
    [ "$total" -le 0 ] || size=" ($(human_size "$total"))"
    printf '  %s·%s %-13s %s%s\n' "$C_DIM" "$C_OFF" Downloading "$name" "$size"
  fi
  while [ ! -e "$WORK/done" ] && [ ! -e "$WORK/fail" ]; do
    if [ "$ANIMATE" = 1 ]; then
      have_bytes=0
      [ -f "$WORK/artifact.part" ] && have_bytes=$(file_size "$WORK/artifact.part")
      if [ "$total" -gt 0 ]; then
        pct=$((have_bytes * 100 / total))
        [ "$pct" -le 100 ] || pct=100
        printf '\r\033[K  %s·%s %-13s %s %3d%%  %s of %s' "$C_DIM" "$C_OFF" Downloading "$(bar "$pct")" "$pct" \
          "$(human_size "$have_bytes")" "$(human_size "$total")"
      else
        tick=$(((tick + 1) % 4))
        printf '\r\033[K  %s·%s %-13s %s  %s' "$C_DIM" "$C_OFF" Downloading "${spin:$tick:1}" "$(human_size "$have_bytes")"
      fi
    fi
    sleep 0.1 2>/dev/null || sleep 1
  done
  wait_for "$WORK/done"
  step_ok Downloaded "$name ($(human_size "$(file_size "$WORK/artifact")"))"
}

# ------------------------------------------------------------------------------------------------------------ steps ----

# Check the artifact against the release's checksums, or against --sha256, or just report it for a local file.
verify() { # verify <file> <name>
  local file=$1 name=$2 actual want='' sums
  actual=$(sha256_of "$file")
  sums=''
  if [ -n "$OPT_SHA256" ]; then
    want=$OPT_SHA256
  elif [ -e "$WORK/sums" ]; then
    sums=$WORK/sums
  elif [ -n "$OPT_FILE" ] && [ -f "$(dirname "$OPT_FILE")/$CHECKSUMS_NAME" ]; then
    sums=$(dirname "$OPT_FILE")/$CHECKSUMS_NAME
  fi
  if [ -n "$sums" ]; then
    want=$(awk -v n="$name" '{f = $2; sub(/^\*/, "", f)} f == n {print $1; exit}' "$sums")
    [ -n "$want" ] || die "$CHECKSUMS_NAME has no line for $name, so the file cannot be checked." \
      'Nothing was installed. Download the release again, or pass the hash yourself with --sha256.'
  fi
  if [ -n "$want" ]; then
    [ "$(printf '%s' "$want" | tr '[:upper:]' '[:lower:]')" = "$actual" ] ||
      die "The sha256 of $name is not the one the release lists, so it was not installed." \
        "Expected $want and got $actual. Download it again; if it happens twice, the file was changed on the way."
    step_ok Verified "sha256 $(short_hash "$actual")"
  else
    step_warn Unchecked "sha256 $(short_hash "$actual") (a local file, with no checksums beside it)"
  fi
}

install_linux() { # install_linux <appimage>
  local src=$1 share="$PREFIX/share" bin="$PREFIX/bin" exe
  exe="$share/$APP/$APP.AppImage"
  put_file 755 "$src" "$exe"
  # The launcher: a plain script, so the command works from any shell. Without FUSE 2 an AppImage cannot mount itself,
  # so it is told to extract.
  FUSE_MISSING=0
  if ! { have fusermount || have fusermount3; } || ! { ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2' || [ -e /usr/lib/libfuse.so.2 ] || [ -e /usr/lib64/libfuse.so.2 ] || [ -e /usr/lib/x86_64-linux-gnu/libfuse.so.2 ]; }; then
    FUSE_MISSING=1
  fi
  {
    printf '#!/bin/sh\n# %s launcher, written by the installer\n' "$APP"
    [ "$FUSE_MISSING" = 0 ] || printf 'APPIMAGE_EXTRACT_AND_RUN=1\nexport APPIMAGE_EXTRACT_AND_RUN\n'
    printf 'exec "%s" "$@"\n' "$exe"
  } | put_text 755 "$bin/$APP"
  # The menu entry, with the icon by name, so the theme picks the size.
  {
    printf '[Desktop Entry]\nType=Application\nName=%s\nComment=%s\n' "$APP" "$APP_COMMENT"
    printf 'Exec=%s %%U\nIcon=%s\nTerminal=false\nCategories=Development;\n' "$bin/$APP" "$([ "$OPT_ICON" = dark ] && printf '%s-dark' "$APP" || printf '%s' "$APP")"
  } | put_text 644 "$share/applications/$APP.desktop"
  # The icons: the light one is the default, the dark one sits beside it; the symbolic one is for panels and trays.
  local variant size file suffix
  printf '%s\n' "$BRAND_ICONS" | while IFS=' ' read -r variant size file; do
    [ -n "$variant" ] || continue
    suffix=''
    [ "$variant" = dark ] && suffix=-dark
    printf '%s' "$file" | base64 -d >"$WORK/icon.png"
    put_file 644 "$WORK/icon.png" "$share/icons/hicolor/${size}x${size}/apps/$APP$suffix.png"
  done
  printf '%s\n' "$BRAND_SYMBOLIC" | put_text 644 "$share/icons/hicolor/symbolic/apps/$APP-symbolic.svg"
  INSTALLED_AT=$(tilde "$share/$APP")
  START_HINT=$APP
}

install_macos() { # install_macos <dmg>
  local src=$1 mount app dest exe
  mount=$WORK/mount
  mkdir -p "$mount"
  hdiutil attach -nobrowse -readonly -noverify -mountpoint "$mount" "$src" >/dev/null 2>&1 ||
    die 'macOS could not open the disk image.' 'Download it again; if it fails twice, the file is damaged.'
  app=$(find "$mount" -maxdepth 1 -name '*.app' | head -n 1)
  if [ -z "$app" ]; then
    hdiutil detach "$mount" >/dev/null 2>&1 || true
    die 'The disk image has no app in it.' 'Download the release again.'
  fi
  dest="$APPS_DIR/$(basename "$app")"
  if [ -e "$dest" ]; then
    hdiutil detach "$mount" >/dev/null 2>&1 || true
    die "$(tilde "$dest") already exists and was not put there by this installer, so it was left alone." \
      'Move it away or delete it, then run the installer again.'
  fi
  make_dir "$APPS_DIR"
  priv cp -R "$app" "$dest"
  record a "$dest"
  exe=$(find "$dest/Contents/MacOS" -type f | head -n 1)
  hdiutil detach "$mount" >/dev/null 2>&1 || true
  # A command for the terminal: no arguments opens the app, `boopis doctor` and the like run its binary.
  {
    printf '#!/bin/sh\n# %s launcher, written by the installer\n' "$APP"
    printf 'if [ "$#" -eq 0 ]; then exec open "%s"; fi\nexec "%s" "$@"\n' "$dest" "$exe"
  } | put_text 755 "$PREFIX/bin/$APP"
  INSTALLED_AT=$(tilde "$dest")
  START_HINT="$APP"
}

# The box at the end. Rounded when the terminal can draw it, plain otherwise.
final_box() {
  [ "$OPT_QUIET" = 1 ] && return 0
  local lines=() width=0 line tl='╭' tr='╮' bl='╰' br='╯' h='─' v='│' pad rule
  if [ "$INTERACTIVE" = 0 ] || [ "$UNICODE" = 0 ]; then tl='+' tr='+' bl='+' br='+' h='-' v='|'; fi
  lines+=("" "$APP is ready" "")
  lines+=("Start it    $START_HINT")
  case "$OS" in
    linux) lines+=("            or open $APP from your app menu") ;;
    macos) lines+=("            or open it from Launchpad") ;;
  esac
  lines+=("Remove it   $UNINSTALL_HINT")
  lines+=("")
  for line in "${lines[@]}"; do [ "${#line}" -le "$width" ] || width=${#line}; done
  width=$((width + 2))
  rule=$(printf '%*s' "$width" '' | sed "s/ /$h/g")
  printf '\n  %s%s%s\n' "$C_DIM" "$tl$rule$tr" "$C_OFF"
  local i=0
  for line in "${lines[@]}"; do
    pad=$(printf '%*s' $((width - 1 - ${#line})) '')
    if [ "$i" = 1 ]; then
      printf '  %s%s%s %s%s%s%s%s%s%s\n' "$C_DIM" "$v" "$C_OFF" "$C_STRONG" "$line" "$C_OFF" "$pad" "$C_DIM" "$v" "$C_OFF"
    else
      printf '  %s%s%s %s%s%s%s%s\n' "$C_DIM" "$v" "$C_OFF" "$line" "$pad" "$C_DIM" "$v" "$C_OFF"
    fi
    i=$((i + 1))
  done
  printf '  %s%s%s\n' "$C_DIM" "$bl$rule$br" "$C_OFF"
  case ":$PATH:" in
    *":$PREFIX/bin:"*) ;;
    *)
      printf '\n  %s%s%s %s is not on your PATH, so a terminal will not find %s yet.\n' "$C_WARN" "$MARK_WARN" "$C_OFF" "$(tilde "$PREFIX/bin")" "$APP"
      # shellcheck disable=SC2016 # $PATH is text for the person to paste
      printf '    Add it in your shell profile:  export PATH="%s:$PATH"\n' "$PREFIX/bin"
      ;;
  esac
  if [ "${FUSE_MISSING:-0}" = 1 ]; then
    printf '\n  %s%s%s FUSE 2 is missing, so %s unpacks itself on each start (slower).\n' "$C_WARN" "$MARK_WARN" "$C_OFF" "$APP"
    printf '    On Arch:  sudo pacman -S fuse2\n'
  fi
  printf '\n'
}

# ---------------------------------------------------------------------------------------------------------- the run ----

cleanup() {
  [ -z "$JOB_PID" ] || kill "$JOB_PID" 2>/dev/null || true
  [ -z "$WORK" ] || rm -rf "$WORK"
  if [ "$CURSOR_HIDDEN" = 1 ]; then printf '\033[?25h'; fi
}

usage() {
  cat <<EOF
boopis installer for Linux and macOS

Usage: bash install.sh [options]

  --version vX.Y.Z   install that release instead of the latest
  --file PATH        install a local file (an .AppImage on Linux, a .dmg on macOS) instead of downloading
  --sha256 HEX       the hash the local file must have (without it, a $CHECKSUMS_NAME beside the file is used if present)
  --prefix DIR       where to install on Linux (default: ~/.local); the launcher goes to DIR/bin
  --system           install for every user (/usr/local on Linux, /Applications on macOS); asks sudo only for that
  --icon light|dark  which icon the menu entry uses (default: light; both are installed)
  --uninstall        remove what this installer installed, from its manifest
  --yes, -y          do not ask anything
  --quiet, -q        print nothing unless something goes wrong
  --no-color         no colour (NO_COLOR works too)
  --help, -h         this text

BOOPIS_NO_ANIMATION=1 turns the animation off; it also stops on a pipe, a dumb terminal and CI.
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version) [ "$#" -ge 2 ] || die '--version needs a release, like --version v0.1.0.' ''; OPT_VERSION=$2; shift ;;
      --file) [ "$#" -ge 2 ] || die '--file needs the path of a file.' ''; OPT_FILE=$2; shift ;;
      --sha256) [ "$#" -ge 2 ] || die '--sha256 needs a hash.' ''; OPT_SHA256=$2; shift ;;
      --prefix) [ "$#" -ge 2 ] || die '--prefix needs a folder.' ''; OPT_PREFIX=$2; shift ;;
      --icon) [ "$#" -ge 2 ] || die '--icon needs light or dark.' ''; OPT_ICON=$2; shift ;;
      --system) OPT_SYSTEM=1 ;;
      --uninstall) OPT_UNINSTALL=1 ;;
      --yes | -y) OPT_YES=1 ;;
      --quiet | -q) OPT_QUIET=1 ;;
      --no-color) OPT_NO_COLOR=1 ;;
      --help | -h) usage; exit 0 ;;
      *) printf 'The installer does not know %s. Run it with --help to see the options.\n' "$1" >&2; exit 2 ;;
    esac
    shift
  done
  case "$OPT_ICON" in light | dark) ;; *) die "--icon takes light or dark, not $OPT_ICON." '' ;; esac
}

resolve_prefix() {
  if [ -n "$OPT_PREFIX" ]; then
    case "$OPT_PREFIX" in /*) PREFIX=$OPT_PREFIX ;; *) PREFIX=$PWD/$OPT_PREFIX ;; esac
  elif [ "$OPT_SYSTEM" = 1 ] && [ "$OS" = linux ]; then
    PREFIX=/usr/local
  else
    PREFIX=$HOME/.local
  fi
  PREFIX=${PREFIX%/}
  APPS_DIR=$HOME/Applications
  # macOS: ~/Applications unless the person agrees to /Applications.
  if [ "$OS" = macos ]; then
    if [ "$OPT_SYSTEM" = 1 ]; then
      APPS_DIR=/Applications
    elif [ "$OPT_YES" = 0 ] && [ "$INTERACTIVE" = 1 ] && [ "$OPT_UNINSTALL" = 0 ] && [ -r /dev/tty ]; then
      local answer=''
      printf '  Install for every user, in /Applications? It asks for your password. [y/N] ' >/dev/tty
      read -r answer </dev/tty || answer=''
      case "$answer" in y | Y | yes) APPS_DIR=/Applications ;; esac
    fi
  fi
  SUDO=''
  if [ "$OPT_SYSTEM" = 1 ] || [ "$APPS_DIR" = /Applications ]; then
    if [ "$(id -u)" != 0 ]; then
      have sudo || die 'Installing for every user needs administrator rights, and sudo is not available.' 'Run the installer as root, or leave out --system.'
      SUDO=sudo
    fi
  fi
}

main() {
  parse_args "$@"
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/boopis-install.XXXXXX") || die 'The installer could not make a temporary folder.' 'Check that TMPDIR is writable.'
  trap cleanup EXIT
  trap 'exit 130' INT TERM
  detect_terminal
  detect_platform
  resolve_prefix
  MANIFEST="$PREFIX/share/$APP/manifest"
  MANIFEST_NEW="$WORK/manifest"
  : >"$MANIFEST_NEW"

  if [ "$OPT_UNINSTALL" = 1 ]; then
    show_banner
    do_uninstall "$MANIFEST"
    step_ok Removed "boopis, from $(tilde "$PREFIX")"
    say ''
    say "  Your data in ~/$APP_DATA_DIR was kept. Delete that folder to remove the runtime and the settings."
    say ''
    return 0
  fi

  # Start the download first, so it runs under the banner.
  if [ -z "$OPT_FILE" ]; then
    fetch_job &
    JOB_PID=$!
  fi
  show_banner

  step_ok Platform "$OS $ARCH"
  local artifact name
  if [ -n "$OPT_FILE" ]; then
    [ -f "$OPT_FILE" ] || die "There is no file at $OPT_FILE." 'Check the path, or leave out --file to download the latest release.'
    artifact=$OPT_FILE
    name=$(basename "$OPT_FILE")
    case "$OS:$name" in
      linux:*.AppImage | macos:*.dmg) ;;
      linux:*) die "$name is not an AppImage." 'On Linux, --file takes the .AppImage from a release.' ;;
      macos:*) die "$name is not a disk image." 'On macOS, --file takes the .dmg from a release.' ;;
    esac
    step_ok Source "$(tilde "$OPT_FILE")"
  else
    wait_for "$WORK/name"
    step_ok Release "$(cat "$WORK/tag")"
    show_download
    artifact=$WORK/artifact
    name=$(cat "$WORK/name")
  fi
  verify "$artifact" "$name"

  # An older install of this installer is replaced; anything else in the way is an error (macOS says so itself).
  if [ -f "$MANIFEST" ]; then
    do_uninstall "$MANIFEST"
  fi
  case "$OS" in
    linux) install_linux "$artifact" ;;
    macos) install_macos "$artifact" ;;
  esac
  step_ok Installed "$INSTALLED_AT"
  UNINSTALL_HINT="bash $(tilde "$PREFIX/share/$APP/uninstall.sh")"
  write_uninstaller
  record f "$MANIFEST"
  priv install -m 644 "$MANIFEST_NEW" "$MANIFEST"
  step_ok Registered "$([ "$OS" = linux ] && printf 'launcher, menu entry and icons' || printf 'launcher in %s' "$(tilde "$PREFIX/bin")")"
  final_box
}

# A script that removes what was installed, for a person who ran the installer from a pipe and has no copy of it. It is
# made from this installer's own functions, so there is one uninstaller and not two.
write_uninstaller() {
  {
    printf '#!/usr/bin/env bash\n# Removes boopis, exactly as the installer recorded it in %s.\nset -eu\nset -o pipefail\n' "$MANIFEST"
    printf 'APP=%q APP_DATA_DIR=%q PREFIX=%q SUDO=%q OPT_QUIET=0 OPT_YES=0 OPT_NO_COLOR=0 OPT_SYSTEM=%q OPT_UNINSTALL=1 OPT_SHA256= OPT_FILE= OPT_VERSION= OPT_ICON=light\n' \
      "$APP" "$APP_DATA_DIR" "$PREFIX" "$SUDO" "$OPT_SYSTEM"
    printf 'OS=%q ARCH=%q APPS_DIR=%q WORK=\n' "$OS" "$ARCH" "$APPS_DIR"
    printf 'C_OK= C_FAIL= C_WARN= C_DIM= C_STRONG= C_OFF= MARK_OK=+ MARK_FAIL=x MARK_WARN=! ANIMATE=0 INTERACTIVE=0 UNICODE=0\n'
    declare -f say step_ok die tilde priv do_uninstall
    # shellcheck disable=SC2016 # the text of the uninstaller: its variables expand when it runs
    printf 'if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then C_OK=$(printf "\\033[32m") C_FAIL=$(printf "\\033[31m") C_OFF=$(printf "\\033[0m"); fi\n'
    printf 'do_uninstall %q\n' "$MANIFEST"
    # shellcheck disable=SC2016
    printf 'step_ok Removed "boopis, from $(tilde %q)"\n' "$PREFIX"
    printf 'say "  Your data in ~/%s was kept. Delete that folder to remove the runtime and the settings."\n' "$APP_DATA_DIR"
  } | put_text 755 "$PREFIX/share/$APP/uninstall.sh"
}

# >>> brand (generated by scripts/embed-brand.sh from packaging/brand; edit those files, not this block)
BRAND_ART=$(cat <<'BOOPIS_BRAND_ART'
# boopis terminal art. One file: every renderer reads it (packaging/AGENTS.md).
# Pixels are half a cell wide and half a cell tall (a cell is 2x2 pixels, drawn with quadrant blocks).
#   color <name> <#rrggbb | -> [hole]   '-' is the terminal's own foreground; a hole is not drawn without colour
#   sprite <name> <color> ... end        '#' is the sprite's colour, 'o' the eye colour, '.' nothing
#   text <name> <string>                 a one-line form
#   scene <name> ... end                 slot <slot> <x> <y> <sprite>, in pixels
#   anim <scene> ... end                 frame <ms> <slot>=<sprite>[@dy] ..., dy in pixels (up is negative)
format 1

color ink -
color eye #0f0e0c hole
color kai #4fc9a8
color nina #f23b5a
color iris #3b82f6
color hex #a6a6ab
color nimbus #9b5cf6
color moss #2fd26a
color terra #c4834a

text compact b●●pis
text compact.ascii boopis

sprite logo ink
#####............................................................................................#####......................
#####............................................................................................#####......................
#####............................................................................................#####......................
#####.......................................................................................................................
#####...########.........................................................####...########.........#####........##########....
##################......................................................##################.......#####.....################.
######.......######.....................................................######........######.....#####....#####........###..
#####.........######....................................................######.........#####.....#####....#####.............
#####..........#####....................................................######.........#####.....#####.....##########.......
#####..........#####....................................................######.........######....#####......##############..
#####..........#####....................................................######.........#####.....#####............#########.
#####.........######....................................................######.........#####.....#####.................#####
######.......######.....................................................######.......######......#####....####.........#####
####.#############......................................................##################.......#####.....################.
####...########.........................................................######..########.........#####........##########....
........................................................................######..............................................
........................................................................######..............................................
........................................................................######..............................................
end

sprite eyes.idle ink
........###########.............###########.......
......################........################....
....###################.....###################...
....####################....####################..
...#####################...#####################..
...#####################...#####################..
...#####################...#####################..
....####################....####################..
....###################.....###################...
......################........################....
.........##########..............##########.......
..................................................
end

sprite eyes.blink ink
..................................................
..................................................
..................................................
..................................................
........############............############......
...#####################...#####################..
..........########................########........
..................................................
..................................................
..................................................
..................................................
..................................................
end

sprite eyes.left ink
.......###########.............###########........
.....################........################.....
...###################.....###################....
...####################....####################...
..#####################...#####################...
..#####################...#####################...
..#####################...#####################...
...####################....####################...
...###################.....###################....
.....################........################.....
........##########..............##########........
..................................................
end

sprite eyes.right ink
.........###########.............###########......
.......################........################...
.....###################.....###################..
.....####################....####################.
....#####################...#####################.
....#####################...#####################.
....#####################...#####################.
.....####################....####################.
.....###################.....###################..
.......################........################...
..........##########..............##########......
..................................................
end

sprite bot.kai.idle kai
...######...
.##########.
###oo##oo###
###oo##oo###
.##########.
...######...
end

sprite bot.kai.blink kai
...######...
.##########.
############
###oo##oo###
.##########.
...######...
end

sprite bot.kai.left kai
...######...
.##########.
##oo##oo####
##oo##oo####
.##########.
...######...
end

sprite bot.kai.right kai
...######...
.##########.
####oo##oo##
####oo##oo##
.##########.
...######...
end

sprite bot.nina.idle nina
.....##.....
....####....
...######...
..#oo##oo#..
.##oo##oo##.
############
end

sprite bot.nina.blink nina
.....##.....
....####....
...######...
..########..
.##oo##oo##.
############
end

sprite bot.nina.left nina
.....##.....
....####....
...######...
..oo##oo##..
.#oo##oo###.
############
end

sprite bot.nina.right nina
.....##.....
....####....
...######...
..##oo##oo..
.###oo##oo#.
############
end

sprite bot.iris.idle iris
.....##.....
....####....
...######...
.##oo##oo##.
###oo##oo###
..########..
end

sprite bot.iris.blink iris
.....##.....
....####....
...######...
.##########.
###oo##oo###
..########..
end

sprite bot.iris.left iris
.....##.....
....####....
...######...
.#oo##oo###.
##oo##oo####
..########..
end

sprite bot.iris.right iris
.....##.....
....####....
...######...
.###oo##oo#.
####oo##oo##
..########..
end

sprite bot.hex.idle hex
....####....
..########..
###oo##oo###
###oo##oo###
..########..
....####....
end

sprite bot.hex.blink hex
....####....
..########..
############
###oo##oo###
..########..
....####....
end

sprite bot.hex.left hex
....####....
..########..
##oo##oo####
##oo##oo####
..########..
....####....
end

sprite bot.hex.right hex
....####....
..########..
####oo##oo##
####oo##oo##
..########..
....####....
end

sprite bot.nimbus.idle nimbus
..###..###..
.##########.
############
#oooo##oooo#
############
.##########.
end

sprite bot.nimbus.blink nimbus
..###..###..
.##########.
############
#oooo##oooo#
############
.##########.
end

sprite bot.nimbus.left nimbus
..###..###..
.##########.
############
oooo##oooo##
############
.##########.
end

sprite bot.nimbus.right nimbus
..###..###..
.##########.
############
##oooo##oooo
############
.##########.
end

sprite bot.moss.idle moss
.##########.
############
####o##o####
####o##o####
############
.##########.
end

sprite bot.moss.blink moss
.##########.
############
############
####o##o####
############
.##########.
end

sprite bot.moss.left moss
.##########.
############
###o##o#####
###o##o#####
############
.##########.
end

sprite bot.moss.right moss
.##########.
############
#####o##o###
#####o##o###
############
.##########.
end

scene banner
slot logo 0 0 logo
slot eyes 20 4 eyes.idle
slot kai 0 22 bot.kai.idle
slot nina 22 22 bot.nina.idle
slot iris 44 22 bot.iris.idle
slot hex 66 22 bot.hex.idle
slot nimbus 88 22 bot.nimbus.idle
slot moss 110 22 bot.moss.idle
end

scene bots
slot kai 0 2 bot.kai.idle
slot nina 22 2 bot.nina.idle
slot iris 44 2 bot.iris.idle
slot hex 66 2 bot.hex.idle
slot nimbus 88 2 bot.nimbus.idle
slot moss 110 2 bot.moss.idle
end

anim banner
frame 90 eyes=eyes.blink kai=bot.kai.blink nina=bot.nina.blink iris=bot.iris.blink hex=bot.hex.blink nimbus=bot.nimbus.blink moss=bot.moss.blink
frame 130 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 170 eyes=eyes.left kai=bot.kai.left nina=bot.nina.left iris=bot.iris.left hex=bot.hex.left nimbus=bot.nimbus.left moss=bot.moss.left
frame 170 eyes=eyes.right kai=bot.kai.right nina=bot.nina.right iris=bot.iris.right hex=bot.hex.right nimbus=bot.nimbus.right moss=bot.moss.right
frame 90 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle@-1 nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle@-2 nina=bot.nina.idle@-1 iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle@-1 nina=bot.nina.idle@-2 iris=bot.iris.idle@-1 hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle@-1 iris=bot.iris.idle@-2 hex=bot.hex.idle@-1 nimbus=bot.nimbus.idle moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle@-1 hex=bot.hex.idle@-2 nimbus=bot.nimbus.idle@-1 moss=bot.moss.idle
frame 55 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle@-1 nimbus=bot.nimbus.idle@-2 moss=bot.moss.idle@-1
frame 55 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle@-1 moss=bot.moss.idle@-2
frame 55 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle@-1
frame 1 eyes=eyes.idle kai=bot.kai.idle nina=bot.nina.idle iris=bot.iris.idle hex=bot.hex.idle nimbus=bot.nimbus.idle moss=bot.moss.idle
end
BOOPIS_BRAND_ART
)
BRAND_AWK=$(cat <<'BOOPIS_BRAND_AWK'
# The boopis terminal art renderer for POSIX awk (Linux and macOS). It reads packaging/brand/boopis.art on standard
# input and draws a scene exactly as the host's renderer does (apps/desktop/src-tauri/src/brand.rs): the goldens in
# packaging/brand/golden/ are what both must print. scripts/embed-brand.sh copies this file into scripts/install.sh.
#
#   -v mode=truecolor|256|16|mono   the colour level (mono: no escape codes, the eyes are holes)
#   -v scene=banner                 the scene to draw
#   -v frame=-1                     -1: the scene as written, N: animation frame N (counted from 0)
#   -v play=1                       draw the scene, then play its animation in place (about a second)
#   -v indent=2                     spaces in front of every line
#   -v text=compact                 print a text entry instead (the one-line logo)
#   -v color=moss                   print the SGR parameters of a palette colour as a foreground (the check marks)
#
# A cell is 2x2 pixels, drawn with the quadrant blocks. Only POSIX awk is used (no gensub, no length of an array).

function hexval(h,   i, v, c) {
    v = 0
    for (i = 1; i <= length(h); i++) {
        c = index("0123456789abcdef", tolower(substr(h, i, 1))) - 1
        v = v * 16 + c
    }
    return v
}
function abs(v) { return v < 0 ? -v : v }
function sq(v) { return v * v }

# the nearest of the xterm 256 palette: the colour cube or the grey ramp, the cube on a tie
function level(v,   i, best) {
    best = 0
    for (i = 1; i < 6; i++) if (abs(v - cube[i]) < abs(v - cube[best])) best = i
    return best
}
function nearest256(r, g, b,   ri, gi, bi, cd, i, v, d, gd, gi2) {
    ri = level(r); gi = level(g); bi = level(b)
    cd = sq(r - cube[ri]) + sq(g - cube[gi]) + sq(b - cube[bi])
    gd = 2147483647; gi2 = 0
    for (i = 0; i < 24; i++) {
        v = 8 + 10 * i
        d = sq(r - v) + sq(g - v) + sq(b - v)
        if (d < gd) { gd = d; gi2 = i }
    }
    if (cd <= gd) return 16 + 36 * ri + 6 * gi + bi
    return 232 + gi2
}
function nearest16(r, g, b,   i, d, best, bd) {
    bd = 2147483647; best = 0
    for (i = 0; i < 16; i++) {
        d = sq(r - a16r[i]) + sq(g - a16g[i]) + sq(b - a16b[i])
        if (d < bd) { bd = d; best = i }
    }
    return best
}
# the SGR parameters that set the colour "r,g,b" as foreground (fg=1) or background
function sgr(rgb, fg,   p, plane, i, base) {
    split(rgb, p, ",")
    plane = fg ? 38 : 48
    if (mode == "truecolor") return sprintf("%d;2;%d;%d;%d", plane, p[1], p[2], p[3])
    if (mode == "256") return sprintf("%d;5;%d", plane, nearest256(p[1] + 0, p[2] + 0, p[3] + 0))
    i = nearest16(p[1] + 0, p[2] + 0, p[3] + 0)
    base = fg ? 30 : 40
    return sprintf("%d", i < 8 ? base + i : base + 60 + i - 8)
}
function rgbof(ci) {          # "r,g,b", or "" for the terminal's own foreground
    if (ci < 0 || !hasrgb[ci]) return ""
    return cr[ci] "," cg[ci] "," cb[ci]
}

function compose(f,   k, name, sp, dy, j, y, x, c, py, W, H, px) {
    W = 0; H = 0
    for (k = 1; k <= nslot[scene]; k++) {
        sp = slsp[scene, k]
        if (slx[scene, k] + spw[sp] > W) W = slx[scene, k] + spw[sp]
        if (sly[scene, k] + sph[sp] > H) H = sly[scene, k] + sph[sp]
    }
    cw = W + W % 2; ch = H + H % 2
    for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) cv[y, x] = 0
    for (k = 1; k <= nslot[scene]; k++) {
        name = slsp[scene, k]; dy = 0
        if (f >= 0) for (j = 1; j <= frn[scene, f]; j++)
            if (frslot[scene, f, j] == slname[scene, k]) { name = frsp[scene, f, j]; dy = frdy[scene, f, j] }
        for (y = 0; y < sph[name]; y++) {
            py = sly[scene, k] + y + dy
            if (py < 0 || py >= ch) continue
            for (x = 0; x < spw[name]; x++) {
                c = substr(spr[name, y], x + 1, 1)
                if (slx[scene, k] + x >= cw) continue
                if (c == "#") cv[py, slx[scene, k] + x] = spcol[name] + 1
                else if (c == "o") cv[py, slx[scene, k] + x] = eyec + 1
            }
        }
    }
}

# draw the composed canvas into lines[1..nl]
function draw(   r, c, i, v, em, bm, body, n, ncell, ch1, fg, bg, row, st_fg, st_bg, blank, want_fg, want_bg, need, codes, last) {
    nl = ch / 2
    for (r = 0; r < ch / 2; r++) {
        ncell = cw / 2
        for (c = 0; c < ncell; c++) {
            em = 0; bm = 0; body = 0
            for (i = 0; i < 4; i++) {
                v = cv[r * 2 + int(i / 2), c * 2 + i % 2]
                if (v == 0) continue
                if (eyec >= 0 && v == eyec + 1) em += pw[i]
                else { bm += pw[i]; if (body == 0) body = v }
            }
            cch[c] = ""; cfg[c] = ""; cbg[c] = ""
            if (mode == "mono") { cch[c] = q[bm]; continue }
            if (em == 0)      { cch[c] = q[bm]; cfg[c] = rgbof(body - 1) }
            else if (bm == 0) { cch[c] = q[em]; cfg[c] = rgbof(eyec) }
            else              { cch[c] = q[em]; cfg[c] = rgbof(eyec); cbg[c] = rgbof(body - 1) }
        }
        last = ncell
        while (last > 0 && cch[last - 1] == " " && cbg[last - 1] == "") last--
        row = ""; st_fg = ""; st_bg = ""
        for (c = 0; c < last; c++) {
            if (mode != "mono") {
                blank = (cch[c] == " " && cbg[c] == "")
                want_fg = blank ? "" : cfg[c]; want_bg = blank ? "" : cbg[c]
                need = blank ? (st_bg != "") : (st_fg != want_fg || st_bg != want_bg)
                if (need) {
                    codes = "0"
                    if (want_fg != "") codes = codes ";" sgr(want_fg, 1)
                    if (want_bg != "") codes = codes ";" sgr(want_bg, 0)
                    row = row ESC "[" codes "m"
                    st_fg = want_fg; st_bg = want_bg
                }
            }
            row = row cch[c]
        }
        if (st_fg != "" || st_bg != "") row = row ESC "[0m"
        lines[r + 1] = row
    }
}

function show(clear,   i) {
    for (i = 1; i <= nl; i++) {
        if (lines[i] != "") printf "%s%s", sp2, lines[i]
        if (clear) printf "%s[K", ESC
        printf "\n"
    }
}

BEGIN {
    ESC = sprintf("%c", 27)
    if (mode == "") mode = "mono"
    if (scene == "") scene = "banner"
    if (frame == "") frame = -1
    frame += 0
    sp2 = sprintf("%*s", indent + 0, "")
    q[0] = " "; q[1] = "▘"; q[2] = "▝"; q[3] = "▀"; q[4] = "▖"; q[5] = "▌"; q[6] = "▞"; q[7] = "▛"
    q[8] = "▗"; q[9] = "▚"; q[10] = "▐"; q[11] = "▜"; q[12] = "▄"; q[13] = "▙"; q[14] = "▟"; q[15] = "█"
    pw[0] = 1; pw[1] = 2; pw[2] = 4; pw[3] = 8
    cube[0] = 0; cube[1] = 95; cube[2] = 135; cube[3] = 175; cube[4] = 215; cube[5] = 255
    split("0 205 0 205 0 205 0 229 127 255 0 255 92 255 0 255", t16r, " ")
    split("0 0 205 205 0 0 205 229 127 0 255 255 92 0 255 255", t16g, " ")
    split("0 0 0 0 238 205 205 229 127 0 0 0 255 255 255 255", t16b, " ")
    for (i = 0; i < 16; i++) { a16r[i] = t16r[i + 1]; a16g[i] = t16g[i + 1]; a16b[i] = t16b[i + 1] }
    ncol = 0; eyec = -1; st = ""
}
{
    sub(/\r$/, "")
    if (st == "sprite") {
        if ($0 == "end") { st = ""; next }
        spr[cur, sph[cur]++] = $0; spw[cur] = length($0)
        next
    }
    if (st == "scene") {
        if ($1 == "end") { st = ""; next }
        n = ++nslot[cur]
        slname[cur, n] = $2; slx[cur, n] = $3 + 0; sly[cur, n] = $4 + 0; slsp[cur, n] = $5
        next
    }
    if (st == "anim") {
        if ($1 == "end") { st = ""; next }
        f = nfr[cur]++
        frn[cur, f] = 0
        for (i = 3; i <= NF; i++) {
            eq = index($i, "=")
            rest = substr($i, eq + 1)
            at = index(rest, "@")
            j = ++frn[cur, f]
            frslot[cur, f, j] = substr($i, 1, eq - 1)
            frsp[cur, f, j] = at ? substr(rest, 1, at - 1) : rest
            frdy[cur, f, j] = at ? substr(rest, at + 1) + 0 : 0
        }
        frms[cur, f] = $2 + 0
        next
    }
    if ($0 == "" || substr($0, 1, 1) == "#") next
    if ($1 == "color") {
        i = ncol++
        cname[i] = $2
        if ($3 == "-") hasrgb[i] = 0
        else { hasrgb[i] = 1; cr[i] = hexval(substr($3, 2, 2)); cg[i] = hexval(substr($3, 4, 2)); cb[i] = hexval(substr($3, 6, 2)) }
        if ($4 == "hole") eyec = i
        cidx[$2] = i
    } else if ($1 == "text") {
        texts[$2] = substr($0, index($0, $3))
    } else if ($1 == "sprite") {
        cur = $2; spcol[cur] = cidx[$3]; sph[cur] = 0; st = "sprite"
    } else if ($1 == "scene") {
        cur = $2; nslot[cur] = 0; st = "scene"
    } else if ($1 == "anim") {
        cur = $2; nfr[cur] = 0; st = "anim"
    }
}
END {
    if (text != "") { print texts[text]; exit }
    if (color != "") { print sgr(rgbof(cidx[color]), 1); exit }
    compose(frame)
    draw()
    show(0)
    if (play) {
        for (f = 0; f < nfr[scene]; f++) {
            fflush()
            system("sleep " sprintf("%.3f", frms[scene, f] / 1000) " 2>/dev/null")
            compose(f)
            draw()
            printf "%s[%dA", ESC, nl
            show(1)
        }
        fflush()
    }
}
BOOPIS_BRAND_AWK
)
BRAND_ICONS=$(cat <<'BOOPIS_BRAND_ICONS'
light 16 iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA/0lEQVR4nJxQ3UoCQRg940YXRWj2FkHgbLVBEGLW25X5MhHYD9Fdq/sA+gLihSKC3ujOeD7BQcXfOXB2Dnu+7zBzMiCstVfkBzmxuzEm38lL2VUUEc8f8hSHYUAWJeCP4gF++JaAIcUJ/NCRAAt/DDNzFcf/CHUBuewZbm+uUa/H2MM7djcoP5aQJA23FEV3qH1+YYdnXMBFPoc0Td1QEATo9voznT/PwhizzjNH85+LA6vYVpProKD1kqF1iH08CZjFv1WqblCHIV5eK25omycdpIs3ORBjWRzBHwMJaMEfTXnCM0UNfnhS8mVIiUeRLJP32NyJ9JWQbbKqlPqdAgAA//9ZDHyBAAAABklEQVQDAHh0npK60nZtAAAAAElFTkSuQmCC
light 24 iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAABhklEQVR4nLSVzUrDQBSFT1I3LaSKO3/AvSC2NhRrW+JaF+oL6EPY1iewfQq3ItXiD7ps3Vm07ly4r9qFuNCkIGJpvDekYowBp2Q+OGQynHtuMskkKlxs29ZJF6QrUs8ejjbpgLMGuYobvkmHPdIIwqFH2lIUZV+h8Bk6uSdFES7vpFm+4qKEcLiZJW5gQB7LvEQmDTTI4ZUb9OE+bAn01d/hjXodifk5jI1qjhaSCVw2Gr7Kf/pUvgN7cNZq3WBjfQ3dbtfj0jQNJ6dnSKV0IZ/T4aehXN71FTGWZaFSKQv7GM8dTE9N/FnIxONxtB+ehHyMZ+cGFTGmaQr7GM8SRaPB+y0Wiwn7fA10XQ8sTKfTwj5fg0JxB5FIxFfEc9uFkrDP18AwDFSrR8hklr7nstkcarVj5PN5YR/jeYskYIf1/Q+ix0v0AXlY3OAF8uhwgybk0eSHPEmDO9I4wuWZlFTpx9yhwQrpDeHB34tVznb2AQ2u6ZAjHZIeMTyfpHPSImXe8sQXAAAA//9+Vjm3AAAABklEQVQDADv54uoHysaZAAAAAElFTkSuQmCC
light 32 iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAB2UlEQVR4nMyXz0oCURjFz0igE1RWM7VsU1K4jCKjZX8WGvQA0Ru0ClMheoeEfIIybRUuqk2rIEls0aqgoGVSUFGoqIvp+9RKudpQjd5+cLwzd/zmHObO3Mu1oQbDMHpJm6QLUs6wjiwpTdpgj1pPpcZ8lpod0iBaS4a0rCjKyWcAMp+h5hTtwyBNUYiUQuYqnVyRhtBebknuDvpZkWDODLM3B1iEPLwcYBTycHEADfLo5ZfQgDyeOyAXu61Rb7FYhN+/hv4+J5w9XWUN6P0IBQPla834RV2nMAR8ujA/h1TqvKGJxzONw6Nj0CQCK+qEJxAObzW9CZNMniES2YZVdUKA/XgMZsRje7CqThiCwQENhUIB36GqKu4zD3V9utaHUqn04zrhKzAzZ/L5vNBnZt6sThgCu90OMxwOB6yqEwK4XC6YMTo2BqvqhABen/na5PP6YFXd/5sH+A+xeBzrgSA07Wud0nUdgWAIu9GocJM/1UlejAzZi5H0ADZ+B7KQxxMHeIM8HjnAHeRxzQESkEeCP0OeoNMkN9rLJXh3xEcUYqQaohvt4YU0SRPTTXkm5ANqxlHZLrUa9pioeqJubqQn4aRmlbRE4qVLhTXkUNl/HpDCZP76ceEdAAD//7qdVsAAAAAGSURBVAMAzOsnL15aiq0AAAAASUVORK5CYII=
light 48 iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAC2klEQVR4nNSay2sTURjFT9JWFOyLqujC9JXUhUS6kDaIkCwi+NjUheAfYLq2UIOPpogKLlrdurCpuHAl6E5dxY1NUTDSxoJSTKpBhOqisYpYxXi+tBMmkk6nQybO/cHJndzcfPnOPO7cOzf1WIdCodDJYoA6TLVRrdQB1IZX1FfqM/WMeuByuXKVGroqVTL5GIsrcBajNHH138oyA0x8N4v7WN3rTuQpdZpGFrWKkgEm38XiObUDzkaS76OJ9/KmaIDJb8Nq8n6oQZo6SBMr7rWKW1AneUFylZzh4t7vYJmFmnjq+XIS6nJCDDi1xzFDQAz4oC7dYmAX1KVNDDRDXbaLga1Qly31UJs61Q24VTfQ4DbbMpfLITZyCT5vF1qaG0vq8XVjNDZS/Pw/xGqUoURho1ZDQ2dxZzK+UTOciUQwPn6zZrGEusvEqEE0Ooz4xG2YIZVKIZ/PIxw+YnssDcMjsJDNord387PI2fQcPB6PbbH0GF4D8fgErDBZ4RSpZiw9hr1QMpmEFZJTU7bG0mNoIJPJwAqZzDtbY+kxvAaka7PKUn7Ztlh6TN8HnIqhgaamJlihpbXV1lh6DA14fdbmOj6vz9ZYegwNBIMhWCEYCtkaS48tN7KZ2ddob2+3LZYewyPQ0dmJ4XNRbIbzFy5W/MFqxtJT1cFcZHAQY2M3ahZLMGVAmJ5OIpFI4MnjR0in06V6v9+Po8eOc9AVRn9/wEyoasYqmDbgVOQaUNnAioyFXFCX4tPpn1CXX2LgB9TluxhYhrosiYFFqMsnMaDq4oYwLwZeQl1eyI1sHzfeQE12urnS95Yb96Aed5n7F22ZVSasc9ReqMEC5aeBb8XhNDekKz1F/YHz+U0NSPLypjQfYIUsdB+i5uFcJLcAc53RKsomNGKC6uHmdTiPa5IbVdZrrjuQW1sAlzVkbQ2tgeqj9lN7YA8fKXkCpp3K2t9tHjLxD5W+8BcAAP//BA0zSwAAAAZJREFUAwBR9RI+z0nf6gAAAABJRU5ErkJggg==
light 64 iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAD2UlEQVR4nOyb20sUURzHv7OppGFJiGKG3UjBXPGugZaX1M3ACB8C+w+6IAT20EMS9KCFJhLVa+qbRHSRdPNSGZSVqF0UrcgMQiiksDQ03X6/dTd215mcvescP/DdMztn9sf+vnPmzDlzCYAKTCZTNBV6i+JIu0m7SNFYGXwmvbdohPSKNCBJ0tflfij9r5ISL6SijpSA1clT0jkyokNpA1kDKPFAKi6SKrCMSasAE6mWdJaMmHOsXJIcJc/N+yYWm7uWGCSVkQkfbFfaGWA51t+QwqBNvpH0ZMKEdYXOukDJ8/ItaDd5JpzUYsnVjM6m8gIpHdonm1Rl/WI+BMiRPCq6IBb76VB4bG0BVRCP8/wh0d6PovILxCQ6gD4OQlwK2IBkiIueDdgJcdnOBmyBuESyAeEQl81swEaISygbsB7iEsQGBEFcAgMgNpLoBuhEN2CdDm7Q1nYfZWVHEBkRjrBNoXbidVxnNLbDVbwdnwjkyZDJyR+hr+8lzlRWmks1ZGZmobq6BskpKaq293Z8W5w2oLm5CSdPHIcrXL12HeXlx+DP+I44ZcDg4CAMxYWYmZmBK4SEhKDd2AG9Xu+X+HI4ZUBu7j4M9PfDHbi5thsf+CW+HKo7Qd477v45prf3GYaGhnweXwnVBrS23oOnuHvnts/jK6HagM6ODniKzs5On8dXQvVAaHz8EzyFXCxvx1dCdSfIgw9P8v3HlE/jK+HWSFALrBmgdsOIiAh4iqioKJ/HV0K1ATEx2+Ap5GJ5O74Sqg3ILyiAp8jLz/d5fCVUG1BScgieorT0sM/jK6HagKSkJKSkpsJdeKweHx/v8/hKOHUWqK9vQHBwMFyFZ2u1dZf9Fl8OpwxITEzEjcYmuEpjYzMSEhL8Fl8Op8cBRUXF6Op6iLQ09Q+TZGRkorv7EQ4UFvo9viMuXRKzwtfsjEYjnvT0YHR0xK4uNjYO2Tk5MBgM5qRWYnzGLQM0wMLafQGIzSx3ggsQl3luASLPCOc4edeuQWsD8yEwC3GZZgN+Qlym2IBJiMskGzABcRnns8AYxGWYDXgNcenjuQBfPXgL8eA5UKhOkiS+kzgA8Wij3H9ZR4GnIR7V/GE2gJzopuISxKGG3xbhhX9vjVFfwB3ic2j/8Xk+3NPJgD/8xfG1uR1YPCtsgDaZJu2h5MesK+xmglTxkYq9pHfQHsOkLNvkmSVTYdqAW0Ai6Qq0AZ/uGkhJltzskL0WQBv+Jp2iRQPpBVYv3KcVUS4VJNlZr6oXo6lv4OfOjpK44+DbuDx44tfnt2JlMG7RPImfjOCnrVrk9rgjfwEAAP//zhqQIQAAAAZJREFUAwDWmFutt3U/qQAAAABJRU5ErkJggg==
light 128 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
light 256 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
dark 16 iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABO0lEQVR4nJyTPU7DQBCF3+w6TsDBCEFJCSVdkpYqcAoKSjoU4BJchDsgCBIVgdimQoICaJEIhGAjIf8M4yAsRciG+Gt2V2/fzjyN1oBgWdaa1jgEo01EGgUwcyTLccJ04Pv+Ddn2TIugugBZmI5RFPO6rpq1I6m6gumpKoVVmretQKrPogQS58koa04hQl39HJrNFhzXw/DtHZdXfTQaTfylMcOUCHVODyen3QlTr3eBzY02ijSJkGQPPA9eYRhGdimKIiwtLoz3g5chtNa/tPSBzKGUKshKuVrmuva8CcHzXPxHU9LGOEKnswvP/RZcx8H+Xie7VKSRPWfF0mJ+/wVI7VCJ+QOloZFU5juU51bXDPMBirZQgjjhbf0ZhveVinkuk3qU7yxj5WXKmZtkjkHog6mfMHaCIDj7AgAA//9l4xamAAAABklEQVQDAI5Xjg/nqDoHAAAAAElFTkSuQmCC
dark 24 iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAB10lEQVR4nLSWPW/TUBSG33PtfGAaWyAxgEizsyEFBhaajiChbmzwCxCsDQsMDKj5C6ysgITEHkVUKk6pysActc1Qdagd2W0Up6fnRq2UyE3VW9mPdG356H3P8f3UtXGG5zh1tugjQLcAfkxEFozhHQZ+U8KtII59HSH9cN2br8D4IkltZAAzJzjB6zCKvlK5XK6VCtZ/EN1AljAfDUfjB5bjFD8RqSfIGqKCZamSIqanyAvGki2VasgJItxVMiELyAnJ7SpZOTQdbCwvY2trG4fBYNK6m3+x1GikzFfRSWpFnrvA54F6/RG+ff+BSqUyIwzDECsrL7DZ7RrpNGpa0Gy+T5k0rutidbVprJv0YroHO7v9C42aIAhQW7xvpNPM7Nx5Jo3necY6zcwQxXE81xhFkbEuVcD3/bnGPxsbxrpUgdbaZyRJkjLpWKu1ZqzTWOVS8cP5R6/Xg9/1Ua1WpS1OYp1OB+/evkG73YapTjOzirJGdjJncv5fQqLPoiHygmig5CA6QE4Qc19WEa0jN2idHMe5Z9vqn/TkNjJEhn4/GfNDJbuyD4yfSSxAdoQ05uc69+RqMhwme4VC8adMyB0p7cnkuLgG8tcjef064dHLQXS8rWOnAAAA//9tNsPrAAAABklEQVQDAAUF39+Xu08iAAAAAElFTkSuQmCC
dark 32 iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACSklEQVR4nMyXv2/TUBDHv+/FcVw7aShCQiCVkRYxItQMjAz8EEIM0CK1LJ0pc5mYAFVMVIg/gLKjKhkAMSE6EBZYUgUkJBbapL/iYCeGNsfZUqqCHaxGrs1HSmzf+fQ9373n56dgD3lgiLL6bSHFVRBOQYgBRALZ/FehDr0QP+wnDWCz6xG74oZxniQWhBBHcYAQ0cpOB5OWZb3ZTSCX085JobxFTHASBNEpmGbrveTrASlSC4gRrjI/eOo5n6qpfFafhpCTiBnO4LCqKt8kCXEFCSEhLytcj1EkBAEnFS7FESQGDSnwpn8y8FjUFCQKZWSQOZ1OY27uEdbWN7HVaHq/1doa7j946Pl6sf84oYv8YJb+Nr989RpjY4VAkaWld7h08UKgr5+4lJZR7+01zMzcwdTULfRiePgETNNEuVxGFHG+FtwYn0AY4xM3EVWcrwUrq3VomoZ/Yds2jh/7c82q1dehquq+43yzIEzcRdd1ny1MvFecrwXtdhthtFotRBXnS6BarSKM5UoFUcX5EiiVigijGHBPv3H/33vApVQsweGejoyMwjAMz1ar1TA//xh3Z2e5361AkX7iAisQF+6nWcKLEZJNgJdjybOALCQE935D8gdyE0lBqHMFxFckx7IUoEUkBKGz6O6MtMGc8YEHxGnECdHHRtMquK/iNsT2NT6aiI8tEtvXXW1vLTBN5zPh1xkelV9wwLgarHXW1XSvU12H4+xsOM7PZ5m0YvPOLc93HuKJmkYkeNvzT7w9f2o2rWnW+t71/AYAAP//tCFbIQAAAAZJREFUAwCatgv49d5L6QAAAABJRU5ErkJggg==
dark 48 iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAADcklEQVR4nNSay2sTQRzHv7/dZBNNkyhqVKxSIyKoLWhBaqqXHsTHRQXBs69/QDz6akVRQQ+erF48eBJUlFYPLVbrpQXRVgTb1FdLKVSxeZpXk5+zbVNXSbcxdNvMB7KZmZ398vtl5/GbmdgwA06nc72mqQeJaZfILgN4KYhqMC/wWzBFROI7E7/OZHIPE4nEUKGaVKjQU7H4LClKI8oIzuXORWK/mv4t/8sBl8u1SlXoARF2oRxhfpFlOhqLxUbzRdMOeJ1OP9ttXcL45ShjmHk0ncnuSCaT3/S8MlW+CHb1cbkbr0NEPoddfSqSmp5X9YvH7borbuyBLBCtdGr2Nal05gmJ0abKodm+QEJEU1pnE0PlIUiKptIBZWqclxImqhOdmDdCWmiDwoAP8rLMJi5eSAoRV9jE8OmEpDBDs0FqSJXbAYIitQMikLMrxVaurKxEY9Ml9Ac/IRSOTn/6+gdwsbFp4v4CaLnJ66ng2WrduHETx46fmK0a7jQ348yZ0/OmpaM6HdoFswpXr13HyZOnUAy1tbXweL1ob2+zXCuP6RuoqqrCu573+F+qt27G0NCQZVpGTPtAMa+64HPHjluqZcR0FAoEAiiFQH29pVpGTB3w+/0oBb9/g6VaRkz7gD60lcoSr9syLSNFzwPliqkD4XAYpTA29tNSLSOmDgwMBFEKwWDQUi0jpg687OhAKRR6bi61jFgykdVUb8Hg4KBlWkZMQ4lQKARVVVFfX/y6/8qVy2htabFUy8issVBn5yv4fD5s274ds9F8+zYunD83L1p5iopGderqdqKhoQF79+1HTc2fXfbe3l48f9aKtrY2dHd3FSM1Z1pin5SLdqBcUXQvICnC9LS+K0GQFGF6Wn8DKchLRhFeJCArzHF9b7T0MHHhCemhxCgkhQkjirhKebgxCQX1JvQGkiIGoG5yux2bFLJ/hITkOLZCiUZTfQy+D8kQv/69aBQ/8pOY2+txfRBtai2kgL+GI/FqkYjlFzRRRu6I8CqHMkfYOD6exUGRjOn56RVZJJLoAuUCIjIqbe03D+i2UZbr4vF4T75MNVZIpcaHU+n0LU2zO8QMvRtlhIg4L0WiscOpTGbEWD5jIKcfgE+eIdPEGZrw3i7OZHeI7y3CudWwxEoeZtBnYVS+KU/83Sadzj5KJpMF15W/AQAA//9PhPiIAAAABklEQVQDAEhrgtbKRbJVAAAAAElFTkSuQmCC
dark 64 iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAEoklEQVR4nOybXUwcVRTH/2d2dheYZSGmsVEUjaZBjJCUVkOjtSV8aepHDA8+tMX4pL74UR/sk8YHE622SVOtD8ZX+9D6mVhRoDRiUtpKAAGRWCNigmBNI7BD2dmduZ67ac1Cd+zssuzCXn/JfsydO//MOXvm3nPv3avDA8XFxRV+TasRGmo0oAqgTYC4E0QVWBOI3yFwge/rggMxrjn4wSYajEQiF693Jf3XyTLDaIaGQ2zoPViHCIEz5IhXZ02zy62Oz6XcHw4ZB9n4d4loI9YpRLhVEPYWBQOhqBU7zUXONXWWF4TDwU0k9I/56hoUEkIMwYq3zUajvyQXL3GAfNYDft8Ify1HAcKPxF+2I2pM05y+WqYlndf8fu1TFKjxEn4kNvg0Oo4ku/9tA0pLjTc0oidR4LATKoPBAEWj1unEsXwLhUINPg2noBC2E98RiSx+mwgFH+E1KIaP9NflJ5WUlNzk17UpKEgs7lToPh8ehqLoOjXq3ChshqKQkKm9oDugKkS3ywi4GaoisJEjABugLOIGncMgDFUhlGpCiCIoCo8NAtwGUADKQn4dakNKO4B7QE31CPBpWAGtrQ/hxIlPMD1zEX/Pzi95yTJ5rrm5BZmy2vrcCvqpLBwSSJO6LVtw4MDb2Lr1Xk/1+/rOYP/+VzA4MOCp/mrrJ5O2A3bv3oP3jr6PTHju2Wdw7NhHyKf+ctJyQG1tLTq+7gQPoZEJPBeH1pYmjIyM5EU/FWm1AYcPH8n45iSGYeCdg4fypp8Kzw6Qv87mujqslPr6baiurs65vhueHbBr1yPIFo8+9njO9d3w7IDGpiZki8bGxpzru+E5EaqsvA3ZIpXWauu74bkXkMlHNikvK82pvhsrygQLgf8d4LXizMwMssXU1FTO9d3w7IDJyd+QLVJprba+G54dcKq7G9mip6cn5/pueHbAyZNfIlt88flnOdd3w7MDhoaG0N//PVaKHLqOjY3lXN+NtHqBF194HgsLC8gUOVp7ed9LedNPRVoOGB4exlPte5Ep7e17MDo6mjf9VKSdB3R2foOGhh04f/6c52vOnu3Dzp0PorurK+/6y8loSuwqcs6upaUFD2zfjqqqu5acGx//Cd/19qKjoyNh1FrUl6zIAesdXhVzFF8XILXXBTgCLLk46kBRCLDl4qi6I0KimMZxcBmKwsvjlsZesKAoRGJBRkAEisIRMC+f/0tQFrqkCcI0VIXEpEaCJqAo5IgxGQHDUBQhqF9zHGRvLmodwQmgmDPNXi0SifzIh4NQDUIHv5uJLNB2aB8Uw3HsN+VnYsuMZVkTRQG/wZnB/VABId6aj1z+UH5N3jWml4UNnoahAv/7vBicnTPln4/i8ih5IBSPWnYbVzBRsIgFtvEJXDFesmQkuLi4+GvcxjZOEX9GgcE2jbFt9WzjRHL5NVtnY7HYn1HL+iAY1MsJdB/WObK7g8CRuYjZxrb9sfy8297heDQa+yqo+/s4RqrYEWtkl3h6sOXnyMHT3N8f5UM7VR3yImQYRo3Pl9hUKZ+dG0ng7ivb52/BmkBMclY3KWd42Oh5vq8B2xbHeaHkulnuPwAAAP//HVTQAQAAAAZJREFUAwAO2wo+7O8zrQAAAABJRU5ErkJggg==
dark 128 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
dark 256 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g+uVbz77fDWosfZcHrx4Q0lstWFq7JiBR2PLFud2lzq6BLB582Z8/vnnoMaKitrvyr1s2TJQY5988omjg19z/JQvc+bMBjU29/XX0V7emDcP1Njs2S/C6RxdBdC6d++OL9asS2jmG7fRdwD2KejdbnMm5ObmqmpAKbKzORV7Az0JSL++fWJdpU7m+BLA1q1bMW/eXNA+/3z66XadMEWPJXj6qSdB+8yd+7rjg19zxayPM2c+BNrn/vvvQ3t74IEHQPs89KA7jocrEsDCBQvwyX/+AwJeemlOUsamr1u3Fq+99ioIsXNtyZIlcAPXzPv8xz/+AQT835/vRLLc+af/BQG33/F7uIVrEsAbb8zDO++8A5M9/9xzSe0W1d1es190fst3InSX6Fvz58MtHN8LsL/Bgwfj7eVmDl3VMySNPPnEpN+8owdfvff+h7GeARONPPkkrFnzBdzCVUu/6Kvf7267FSa6/voZHXLnnh58deMN18NEN//2N64Kfs2TnZX5O7jIu+++i+EjRqB///4wxSOzHsZf77kHHUXf/tqrVy8MHToMppg//0384uf/A7dxVRWgQSAQwJKipejbtx/cTrdGn3fu2UiFufPewCmnjILbrV27BqePHePKtShcmQC0fv36Y/GSolgycKsvv1yPcaePTWjq70R06tQJCxctdnWiDYVCGDum0NHTfjXHtcu/6uA4f+oUVFU5GchRywAACKtJREFUd9GG5mzbtk1d+c9JWfBru3btin2HsrIyuJE+d75//lTXBr/m6vWf33tvBS76wQWorKyEm+g70HSxXzfIpdqmTZti38Xpd8UdLBwOx4Jfn0Nu5voF4BcvXoxJZ0yI3TPgBnouxFNHn4LVq9NnHgTdKDh2zGn4+OOP4Qb6XDlz0kTV578Ubuf6BKDpASyjR30Hy5e/DSd79tlnMEmdmOm4EIUuAeigmTPb2bdn63NEnytOnuizNYxIAJoOmu+edSau+9lPY7PlOImen//CC76Pa348PaHlvpNN15kvv/xS/NePLnbcmgJlZdvx4+lXx84Rk5ZEc904gHg++eQ/ePzxx2K9AyNGnIB0prud/nrP3bjs0mmxriin0GsRPPrILEDK2JiMjIwMpLNZD8/ExRf/0MhJZl3bDdgSXbsehunTp+PyK65Et27dkC50w5q+3fSxxx51/CKowWBQlQquwFVX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
BOOPIS_BRAND_ICONS
)
BRAND_SYMBOLIC=$(cat <<'BOOPIS_BRAND_SYMBOLIC'
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="boopis"><defs><style id="current-color-scheme" type="text/css">.ColorScheme-Text{color:#0f0e0c}</style></defs><path class="ColorScheme-Text" fill="currentColor" d="M4 4C4.1 4 4.2 4 4.3 4C4.4 4 4.5 4 4.6 4C4.7 4.1 4.8 4.1 4.9 4.1C5 4.1 5.1 4.1 5.2 4.2C5.3 4.2 5.4 4.3 5.5 4.3C5.6 4.4 5.7 4.4 5.8 4.5C5.9 4.5 6 4.6 6 4.7C6.1 4.7 6.2 4.8 6.3 4.9C6.3 5 6.4 5.1 6.5 5.2C6.5 5.3 6.6 5.4 6.6 5.5C6.7 5.6 6.7 5.7 6.8 5.8C6.8 5.9 6.8 6 6.9 6.1C6.9 6.2 6.9 6.3 6.9 6.5C6.9 6.6 7 6.7 7 6.8C7 6.9 7 7 7 7.2C7 7.3 7 7.4 7 7.5C7 7.6 7 7.7 7 7.8C7 8 7 8.1 7 8.2C7 8.3 6.9 8.4 6.9 8.5C6.9 8.7 6.9 8.8 6.9 8.9C6.8 9 6.8 9.1 6.8 9.2C6.7 9.3 6.7 9.4 6.6 9.5C6.6 9.6 6.5 9.7 6.5 9.8C6.4 9.9 6.3 10 6.3 10.1C6.2 10.2 6.1 10.3 6 10.3C6 10.4 5.9 10.5 5.8 10.5C5.7 10.6 5.6 10.6 5.5 10.7C5.4 10.7 5.3 10.8 5.2 10.8C5.1 10.9 5 10.9 4.9 10.9C4.8 10.9 4.7 10.9 4.6 11C4.5 11 4.4 11 4.3 11C4.2 11 4.1 11 4 11C3.9 11 3.8 11 3.7 11C3.6 11 3.5 11 3.4 11C3.3 10.9 3.2 10.9 3.1 10.9C3 10.9 2.9 10.9 2.8 10.8C2.7 10.8 2.6 10.7 2.5 10.7C2.4 10.6 2.3 10.6 2.2 10.5C2.1 10.5 2 10.4 2 10.3C1.9 10.3 1.8 10.2 1.7 10.1C1.7 10 1.6 9.9 1.5 9.8C1.5 9.7 1.4 9.6 1.4 9.5C1.3 9.4 1.3 9.3 1.2 9.2C1.2 9.1 1.2 9 1.1 8.9C1.1 8.8 1.1 8.7 1.1 8.5C1.1 8.4 1 8.3 1 8.2C1 8.1 1 8 1 7.8C1 7.7 1 7.6 1 7.5C1 7.4 1 7.3 1 7.2C1 7 1 6.9 1 6.8C1 6.7 1.1 6.6 1.1 6.5C1.1 6.3 1.1 6.2 1.1 6.1C1.2 6 1.2 5.9 1.2 5.8C1.3 5.7 1.3 5.6 1.4 5.5C1.4 5.4 1.5 5.3 1.5 5.2C1.6 5.1 1.7 5 1.7 4.9C1.8 4.8 1.9 4.7 2 4.7C2 4.6 2.1 4.5 2.2 4.5C2.3 4.4 2.4 4.4 2.5 4.3C2.6 4.3 2.7 4.2 2.8 4.2C2.9 4.1 3 4.1 3.1 4.1C3.2 4.1 3.3 4.1 3.4 4C3.5 4 3.6 4 3.7 4C3.8 4 3.9 4 4 4ZM12 4C12.1 4 12.2 4 12.3 4C12.4 4 12.5 4 12.6 4C12.7 4.1 12.8 4.1 12.9 4.1C13 4.1 13.1 4.1 13.2 4.2C13.3 4.2 13.4 4.3 13.5 4.3C13.6 4.4 13.7 4.4 13.8 4.5C13.9 4.5 14 4.6 14 4.7C14.1 4.7 14.2 4.8 14.3 4.9C14.3 5 14.4 5.1 14.5 5.2C14.5 5.3 14.6 5.4 14.6 5.5C14.7 5.6 14.7 5.7 14.8 5.8C14.8 5.9 14.8 6 14.9 6.1C14.9 6.2 14.9 6.3 14.9 6.5C14.9 6.6 15 6.7 15 6.8C15 6.9 15 7 15 7.2C15 7.3 15 7.4 15 7.5C15 7.6 15 7.7 15 7.8C15 8 15 8.1 15 8.2C15 8.3 14.9 8.4 14.9 8.5C14.9 8.7 14.9 8.8 14.9 8.9C14.8 9 14.8 9.1 14.8 9.2C14.7 9.3 14.7 9.4 14.6 9.5C14.6 9.6 14.5 9.7 14.5 9.8C14.4 9.9 14.3 10 14.3 10.1C14.2 10.2 14.1 10.3 14 10.3C14 10.4 13.9 10.5 13.8 10.5C13.7 10.6 13.6 10.6 13.5 10.7C13.4 10.7 13.3 10.8 13.2 10.8C13.1 10.9 13 10.9 12.9 10.9C12.8 10.9 12.7 10.9 12.6 11C12.5 11 12.4 11 12.3 11C12.2 11 12.1 11 12 11C11.9 11 11.8 11 11.7 11C11.6 11 11.5 11 11.4 11C11.3 10.9 11.2 10.9 11.1 10.9C11 10.9 10.9 10.9 10.8 10.8C10.7 10.8 10.6 10.7 10.5 10.7C10.4 10.6 10.3 10.6 10.2 10.5C10.1 10.5 10 10.4 10 10.3C9.9 10.3 9.8 10.2 9.7 10.1C9.7 10 9.6 9.9 9.5 9.8C9.5 9.7 9.4 9.6 9.4 9.5C9.3 9.4 9.3 9.3 9.2 9.2C9.2 9.1 9.2 9 9.1 8.9C9.1 8.8 9.1 8.7 9.1 8.5C9.1 8.4 9 8.3 9 8.2C9 8.1 9 8 9 7.8C9 7.7 9 7.6 9 7.5C9 7.4 9 7.3 9 7.2C9 7 9 6.9 9 6.8C9 6.7 9.1 6.6 9.1 6.5C9.1 6.3 9.1 6.2 9.1 6.1C9.2 6 9.2 5.9 9.2 5.8C9.3 5.7 9.3 5.6 9.4 5.5C9.4 5.4 9.5 5.3 9.5 5.2C9.6 5.1 9.7 5 9.7 4.9C9.8 4.8 9.9 4.7 10 4.7C10 4.6 10.1 4.5 10.2 4.5C10.3 4.4 10.4 4.4 10.5 4.3C10.6 4.3 10.7 4.2 10.8 4.2C10.9 4.1 11 4.1 11.1 4.1C11.2 4.1 11.3 4.1 11.4 4C11.5 4 11.6 4 11.7 4C11.8 4 11.9 4 12 4Z"/></svg>
BOOPIS_BRAND_SYMBOLIC
)
# <<< brand

main "$@"
