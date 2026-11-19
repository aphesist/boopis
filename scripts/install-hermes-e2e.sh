#!/usr/bin/env bash
# Install the pinned Hermes Agent for the end-to-end tests and the desktop smoke, with Hermes's own installer.
#
#   SP=/some/dir scripts/install-hermes-e2e.sh
#
# Everything lands under $SP and nothing touches ~ or ~/.hermes, so $SP can be cached by CI and is exactly what
# `HX_E2E_HERMES_ENV` names (tests/e2e/stack.py). The steps are the spike's (docs/research/spike-s0.md, S0 `install.sh`):
# a source copy of the tag without .git, then Hermes's `setup-hermes.sh --runtime-only`, which stages its pinned uv,
# Python 3.14, node, ripgrep and the venv from the lock files. It takes about a minute on a runner with a warm proxy.
# Never run it on a machine whose Hermes you care about: it is for CI and scratch directories.
set -euo pipefail

SP="${SP:?set SP to the install directory (HX_E2E_HERMES_ENV)}"
HERMES_TAG="${HERMES_TAG:-v0.23.2}"   # the pin: REQUIRES_HERMES (>=0.23.2) and every "verified on v0.23.2" note
HERMES_REPO="${HERMES_REPO:-https://github.com/NousResearch/hermes-agent.git}"

# Already installed (a cache hit): nothing to do.
if compgen -G "$SP/hermes-home/installs/*/environments/*/venv/bin/hermes" >/dev/null; then
  echo "Hermes already installed under $SP"
  exit 0
fi

SP="$(mkdir -p "$SP" && cd "$SP" && pwd)"
mkdir -p "$SP/home" "$SP/runtime" "$SP/hermes-home" "$SP/src"
checkout="$(mktemp -d)"
trap 'rm -rf "$checkout"' EXIT
git clone --quiet --branch "$HERMES_TAG" --depth 1 "$HERMES_REPO" "$checkout/hermes-agent"
tar -C "$checkout/hermes-agent" --exclude=.git --exclude=./tests --exclude=./tests-js -cf - . | tar -C "$SP/src" -xf -

export HOME="$SP/home" HERMES_HOME="$SP/hermes-home" HERMES_RUNTIME_DIR="$SP/runtime" \
       UV_PYTHON_INSTALL_DIR="$SP/uv-python" UV_CACHE_DIR="$SP/uv-cache"
cd "$SP/src"
bash ./setup-hermes.sh --runtime-only

hermes="$(compgen -G "$HERMES_HOME/installs/*/environments/*/venv/bin/hermes" | head -1)"
test -x "$hermes"
echo "installed: $hermes"
