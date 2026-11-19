#!/usr/bin/env bash
# Copy contraprova's engine modules, byte for byte, into the plugin (ADR-0015).
#
#   scripts/vendor-contraprova.sh <40-hex sha>     write plugins/boopis/_vendor/contraprova at that commit
#   scripts/vendor-contraprova.sh --check          re-fetch the pinned commit and compare every byte
#
# The source is a branch of aphesist/contraprova (CONTRAPROVA_BRANCH, recorded in VENDOR.json; the commit is what
# counts). Override the repository with CONTRAPROVA_REPO (a URL or a local path), e.g. to test against a checkout. Changes are made
# upstream and re-vendored, never edited here.
set -euo pipefail

REPO="${CONTRAPROVA_REPO:-https://github.com/aphesist/contraprova.git}"
BRANCH="${CONTRAPROVA_BRANCH:-hx/cascade-support}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/plugins/boopis/_vendor/contraprova"
# The engine and its stdlib-only dependencies. Not the harness, analysis, ope, router, llm or cli.
MODULES=(__init__ events log locking projections contracts gates forks pricing usage interfaces sandbox)
EXTRA=(LICENSE)

fetch() { # fetch <sha> <dir>: a checkout of exactly that commit
  local sha="$1" dir="$2"
  git init -q "$dir"
  git -C "$dir" remote add origin "$REPO"
  git -C "$dir" fetch -q --depth 1 origin "$sha"
}

file_list() {
  for m in "${MODULES[@]}"; do echo "src/contraprova/$m.py"; done
  for e in "${EXTRA[@]}"; do echo "$e"; done
}

licence() { # the SPDX id named by the upstream pyproject
  git -C "$1" show FETCH_HEAD:pyproject.toml | sed -n 's/^license = "\(.*\)"/\1/p' | head -1
}

case "${1:-}" in
  --check)
    [ -f "$DEST/VENDOR.json" ] || { echo "no $DEST/VENDOR.json: nothing is vendored" >&2; exit 1; }
    sha="$(sed -n 's/.*"sha": "\([0-9a-f]\{40\}\)".*/\1/p' "$DEST/VENDOR.json")"
    [ -n "$sha" ] || { echo "VENDOR.json has no sha" >&2; exit 1; }
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    fetch "$sha" "$tmp"
    bad=0
    while read -r f; do
      name="$(basename "$f")"
      if ! git -C "$tmp" show "FETCH_HEAD:$f" | cmp -s - "$DEST/$name"; then
        echo "DIFFERS from $sha: $name" >&2; bad=1
      fi
    done < <(file_list)
    # nothing extra may sit in the vendored directory
    expected="$(file_list | xargs -n1 basename | sort)"
    present="$(ls -1 "$DEST" | grep -v -e '^VENDOR.json$' -e '^__pycache__$' | sort)"
    if [ "$expected" != "$present" ]; then echo "unexpected files in $DEST:" >&2; diff <(echo "$expected") <(echo "$present") >&2 || true; bad=1; fi
    [ "$bad" = 0 ] && echo "vendored contraprova matches $sha"
    exit "$bad"
    ;;
  [0-9a-f]*)
    sha="$1"
    [ "${#sha}" = 40 ] || { echo "give the full 40-hex commit sha" >&2; exit 2; }
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    fetch "$sha" "$tmp"
    rm -rf "$DEST"; mkdir -p "$DEST"
    while read -r f; do git -C "$tmp" show "FETCH_HEAD:$f" > "$DEST/$(basename "$f")"; done < <(file_list)
    lic="$(licence "$tmp")"
    {
      echo '{'
      echo '  "name": "contraprova",'
      echo "  \"repo\": \"https://github.com/aphesist/contraprova\","
      echo "  \"branch\": \"$BRANCH\","
      echo "  \"sha\": \"$sha\","
      echo "  \"licence\": \"${lic:-unknown}\","
      echo '  "note": "Exact copy. Edit upstream and re-vendor with scripts/vendor-contraprova.sh; CI runs --check."'
      echo '}'
    } > "$DEST/VENDOR.json"
    echo "vendored contraprova $sha into ${DEST#"$ROOT"/}"
    ;;
  *)
    echo "usage: $0 <sha> | --check" >&2; exit 2 ;;
esac
