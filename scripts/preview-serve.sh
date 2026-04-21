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
export NODE_ENV=development
# Opt in to the dev-login route (SQUIRE_DEV_LOGIN gate added in SQR-106).
# preview-serve.sh is the only launcher that sets this — plain `npm run serve`
# does not, so a developer on a shared/exposed host won't accidentally open
# the route without knowing they've opted in.
export SQUIRE_DEV_LOGIN=1
exec npm run serve
