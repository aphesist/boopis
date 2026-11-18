#!/bin/sh
set -e
git config user.name "aphesist"
git config user.email "126630868+aphesist@users.noreply.github.com"
git config core.hooksPath .githooks
chmod +x .githooks/commit-msg
echo "Configured aphesist authorship and .githooks/commit-msg hook."
