#!/usr/bin/env bash
# Copy the owner's <orb-avatar> (aphesist/orb2: orb3), byte for byte, into the desktop UI (ADR-0051, as ADR-0015 for contraprova).
#
#   scripts/vendor-orb.sh <40-hex sha>     write apps/desktop/ui/vendor/orb-avatar.* at that commit and record it in orb-avatar.VENDOR.json
#   scripts/vendor-orb.sh --check          re-fetch the pinned commit and compare every byte
#
# Override the repository with ORB_REPO (a URL or a local path), e.g. to test against a checkout. Changes are made upstream
# and re-vendored, never edited here.
set -euo pipefail

REPO="${ORB_REPO:-https://github.com/aphesist/orb2.git}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/desktop/ui/vendor"
RECORD="$DEST/orb-avatar.VENDOR.json"
# upstream path -> vendored name
FILES=("orb-avatar.min.js:orb-avatar.min.js" "orb-avatar.d.ts:orb-avatar.d.ts" "LICENSE:orb-avatar.LICENSE")

fetch() { # fetch <sha> <dir>: exactly that commit
  git init -q "$2"
  git -C "$2" remote add origin "$REPO"
  git -C "$2" fetch -q --depth 1 origin "$1"
}
sha256() { sha256sum "$1" | cut -d' ' -f1; }

case "${1:-}" in
  --check)
    [ -f "$RECORD" ] || { echo "no $RECORD: nothing is vendored" >&2; exit 1; }
    sha="$(sed -n 's/.*"sha": "\([0-9a-f]\{40\}\)".*/\1/p' "$RECORD")"
    [ -n "$sha" ] || { echo "orb-avatar.VENDOR.json has no sha" >&2; exit 1; }
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    fetch "$sha" "$tmp"
    bad=0
    for pair in "${FILES[@]}"; do
      from="${pair%%:*}" to="${pair##*:}"
      if ! git -C "$tmp" show "FETCH_HEAD:$from" | cmp -s - "$DEST/$to"; then echo "DIFFERS from $sha: $to" >&2; bad=1; fi
    done
    [ "$bad" = 0 ] && echo "vendored orb-avatar matches $sha"
    exit "$bad"
    ;;
  [0-9a-f]*)
    sha="$1"
    [ "${#sha}" = 40 ] || { echo "give the full 40-hex commit sha" >&2; exit 2; }
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    fetch "$sha" "$tmp"
    version="$(git -C "$tmp" show FETCH_HEAD:package.json | sed -n 's/.*"version": "\([^"]*\)".*/\1/p' | head -1)"
    entries=""
    for pair in "${FILES[@]}"; do
      from="${pair%%:*}" to="${pair##*:}"
      git -C "$tmp" show "FETCH_HEAD:$from" > "$DEST/$to"
      entries="$entries    \"$to\": { \"from\": \"$from\", \"sha256\": \"$(sha256 "$DEST/$to")\" },"$'\n'
    done
    entries="${entries%,$'\n'}"
    cat > "$RECORD" <<JSON
{
  "schema_version": 1,
  "source": "https://github.com/aphesist/orb2",
  "sha": "$sha",
  "version": "$version",
  "licence": "MIT",
  "files": {
$entries
  }
}
JSON
    echo "vendored orb-avatar $version at $sha"
    ;;
  *) echo "usage: $0 <sha> | --check" >&2; exit 2 ;;
esac
