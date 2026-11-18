#!/bin/sh
# Fails if any commit in RANGE (default: origin/main..HEAD) is not the owner's alone.
set -eu
RANGE="${1:-origin/main..HEAD}"
OWNER_NAME="aphesist"
OWNER_EMAIL="126630868+aphesist@users.noreply.github.com"
bad=0
for c in $(git rev-list "$RANGE"); do
  an=$(git show -s --format='%an' "$c"); ae=$(git show -s --format='%ae' "$c")
  cn=$(git show -s --format='%cn' "$c"); ce=$(git show -s --format='%ce' "$c")
  if [ "$an" != "$OWNER_NAME" ] || [ "$ae" != "$OWNER_EMAIL" ] || [ "$cn" != "$OWNER_NAME" ] || [ "$ce" != "$OWNER_EMAIL" ]; then
    echo "commit $c: author/committer is not $OWNER_NAME <$OWNER_EMAIL>"; bad=1
  fi
  msg=$(mktemp); git show -s --format='%B' "$c" > "$msg"
  if ! GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0="$OWNER_NAME" \
       GIT_CONFIG_KEY_1=user.email GIT_CONFIG_VALUE_1="$OWNER_EMAIL" \
       sh .githooks/commit-msg "$msg" >/dev/null 2>&1; then
    echo "commit $c: message carries attribution or names an agent/tool"; bad=1
  fi
  rm -f "$msg"
done
exit $bad
