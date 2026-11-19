#!/usr/bin/env bash
# Copy the terminal art into the files that must carry it: the installers are single files that run from a pipe, so
# they cannot read packaging/brand/ at run time. The art stays in one place (packaging/brand/boopis.art, render.awk,
# render.ps1, icons/); this script writes it between the `>>> brand` and `<<< brand` markers of
#   scripts/install.sh         the art, the awk renderer, the icons (base64) and the symbolic icon
#   scripts/install.ps1        the art (ASCII-escaped) and the PowerShell renderer
#   packaging/arch/boopis.install   the static banner (drawn by the awk renderer, without colour)
#
#   scripts/embed-brand.sh          rewrite the blocks
#   scripts/embed-brand.sh --check  exit 1 if any block is stale (CI runs this, like the other generators)
set -eu
set -o pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
brand=$root/packaging/brand
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
check=0
[ "${1:-}" != --check ] || check=1

# Put the text of $2 between the markers of $1 ($3 names them: brand or banner).
splice() {
  local file=$1 block=$2 name=$3
  awk -v blockfile="$block" -v name="$name" '
    $0 ~ "^# >>> " name { print; while ((getline line < blockfile) > 0) print line; skip = 1; next }
    $0 ~ "^# <<< " name { skip = 0 }
    !skip { print }
  ' "$file" >"$tmp/spliced"
  if [ "$check" = 1 ]; then
    cmp -s "$tmp/spliced" "$file" || { echo "stale: ${file#"$root"/} (run scripts/embed-brand.sh)" >&2; stale=1; }
  else
    cat "$tmp/spliced" >"$file"
  fi
}
stale=0

# A here-document variable: name, then the file whose text it holds.
heredoc() {
  printf "%s=\$(cat <<'BOOPIS_%s'\n" "$1" "$1"
  cat "$2"
  printf 'BOOPIS_%s\n)\n' "$1"
}

# ---- install.sh
{
  heredoc BRAND_ART "$brand/boopis.art"
  heredoc BRAND_AWK "$brand/render.awk"
  : >"$tmp/icons"
  for variant in light dark; do
    for size in 16 24 32 48 64 128 256; do
      printf '%s %s %s\n' "$variant" "$size" "$(base64 <"$brand/icons/$variant/boopis-icon-$variant-$size.png" | tr -d '\n')" >>"$tmp/icons"
    done
  done
  heredoc BRAND_ICONS "$tmp/icons"
  heredoc BRAND_SYMBOLIC "$brand/icons/boopis-symbolic.svg"
} >"$tmp/sh-block"
splice "$root/scripts/install.sh" "$tmp/sh-block" brand

# ---- install.ps1 (a script that may be read without a byte-order mark: ASCII only, the one non-ASCII character spelled)
if [ -f "$root/scripts/install.ps1" ]; then
  sed 's/●/{U+25CF}/g' "$brand/boopis.art" >"$tmp/art.ascii"
  if LC_ALL=C grep -q '[^ -~]' "$tmp/art.ascii"; then
    echo "boopis.art has a non-ASCII character that embed-brand.sh does not spell for PowerShell" >&2
    exit 1
  fi
  {
    printf "\$BoopisArtText = @'\n"
    cat "$tmp/art.ascii"
    printf "'@\n"
    cat "$brand/render.ps1"
  } >"$tmp/ps-block"
  splice "$root/scripts/install.ps1" "$tmp/ps-block" brand
fi

# ---- the Arch install script: a static banner, drawn without colour (pacman prints it as it is)
if [ -f "$root/packaging/arch/boopis.install" ]; then
  {
    echo 'boopis_banner() {'
    echo "  cat <<'BANNER'"
    awk -v mode=mono -v scene=bots -v indent=2 -f "$brand/render.awk" <"$brand/boopis.art"
    echo 'BANNER'
    echo '}'
  } >"$tmp/arch-block"
  splice "$root/packaging/arch/boopis.install" "$tmp/arch-block" banner
fi

[ "$stale" = 0 ] || exit 1
[ "$check" = 1 ] && echo "brand blocks are current" || echo "brand blocks written"
