#!/usr/bin/env bash
# Copy the shared data files into the plugin package, so the plugin installs standalone (ADR-0016).
#
#   scripts/sync-shared-data.sh           copy every source that exists
#   scripts/sync-shared-data.sh --check   fail if a copy differs from its source (or a source is gone)
#
# Each file has one source of truth. Edit the source, never the copy. Optional files are copied once
# their source lands (hx-pack's data files) and are not an error while it is absent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/plugins/boopis/data"
# source (repo-relative)                        optional?
FILES=(
  "crates/hx-proto/errors.json:required"
  "crates/hx-txn/protected.default.json:required"
  "crates/hx-proto/secret-refs.json:required"
  "apps/shared/data/model-names.json:required"  # the aliases of delegate_task's `target` (governance/roster.py)
  "crates/hx-pack/never_pack.json:required"  # the ship gate leaves these files out of its copy (ship/secrets.py)
  "apps/shared/data/frontier-models.json:required"  # which models may do governed work (governance/frontier.py)
  # hx-pack's redact.rules.json joins this list when plugin code reads it. Not yet: `hermes plugins validate`'s
  # security scan flags it (its examples contain a private-key header and os.environ text), and hx redacts
  # everything the plugin sends through `redact.apply`.
)

mode="copy"
[ "${1:-}" = "--check" ] && mode="check"
bad=0
mkdir -p "$DEST"
for entry in "${FILES[@]}"; do
  src="${entry%%:*}"; kind="${entry##*:}"
  name="$(basename "$src")"
  if [ ! -f "$ROOT/$src" ]; then
    if [ "$kind" = "optional" ] && [ ! -f "$DEST/$name" ]; then continue; fi
    echo "source missing: $src" >&2; bad=1; continue
  fi
  if [ "$mode" = "copy" ]; then
    cp "$ROOT/$src" "$DEST/$name"
    echo "copied $src"
  elif ! cmp -s "$ROOT/$src" "$DEST/$name"; then
    echo "DIFFERS: ${DEST#"$ROOT"/}/$name is not a copy of $src (run scripts/sync-shared-data.sh)" >&2; bad=1
  fi
done
[ "$mode" = "check" ] && [ "$bad" = 0 ] && echo "shared data copies match their sources"
exit "$bad"
