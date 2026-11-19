#!/usr/bin/env bash
# The art renderer inside install.sh (awk) must draw exactly what the host's renderer draws. The goldens in
# packaging/brand/golden/ are written by the host's test (`UPDATE_GOLDEN=1 cargo test -p hypotaxis-host brand`); this
# script draws the same scenes with packaging/brand/render.awk and compares the bytes. It also checks that the copies of
# the art in the installers are current.
set -eu
set -o pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
brand=$root/packaging/brand
fail=0

for golden in "$brand"/golden/*.txt; do
  name=$(basename "$golden" .txt)
  # <scene>.<level>  or  <scene>.f<N>.<level>
  IFS=. read -r scene second third <<<"$name"
  if [ -n "${third:-}" ]; then frame=${second#f} level=$third; else frame=-1 level=$second; fi
  if awk -v mode="$level" -v scene="$scene" -v frame="$frame" -f "$brand/render.awk" <"$brand/boopis.art" | cmp -s - "$golden"; then
    echo "ok   $name"
  else
    echo "FAIL $name: awk draws something else than the host" >&2
    fail=1
  fi
done

# The one-line logo and a palette colour, the other two things install.sh asks the renderer for.
[ "$(awk -v text=compact -f "$brand/render.awk" <"$brand/boopis.art")" = "b●●pis" ] || { echo "FAIL compact text" >&2; fail=1; }
[ "$(awk -v mode=truecolor -v color=moss -f "$brand/render.awk" <"$brand/boopis.art")" = "38;2;47;210;106" ] || { echo "FAIL moss" >&2; fail=1; }
[ "$(awk -v mode=16 -v color=nina -f "$brand/render.awk" <"$brand/boopis.art")" = "91" ] || { echo "FAIL nina at 16 colours" >&2; fail=1; }

"$root/scripts/embed-brand.sh" --check || fail=1
exit "$fail"
