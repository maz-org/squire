#!/usr/bin/env bash
# Launcher used by Claude Code's preview mode via .claude/launch.json.
#
# Claude Preview spawns commands directly (no shell), so nvm activation
# and PATH resolution have to happen in a script we control. This wrapper
# activates the project's Node version (via nvm + .nvmrc), sets PORT from
# the first arg, then execs `npm run serve`. The port list is fixed by
# Google's OAuth authorized-redirect allowlist, so each launch.json entry
# passes the port it wants as $1.
set -euo pipefail

port="${1:-3000}"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null
fi

export PORT="$port"
exec npm run serve
