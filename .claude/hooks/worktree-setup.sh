#!/usr/bin/env bash
# Bootstrap a Claude Code git worktree: node version, .env symlink, deps,
# docker services, db migrations. Fires on SessionStart(startup) — steps are
# idempotent so re-running on later sessions is near-instant.

set -euo pipefail

# Anchor to the project root before doing anything with relative paths. Claude
# Code hooks inherit the cwd at the time the event fires, which can be any
# subdirectory of the checkout. CLAUDE_PROJECT_DIR is the absolute repo-root
# path Claude Code sets for project hooks; fall back to two levels up from
# this script if the hook is invoked outside Claude Code (e.g., manual run).
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="${CLAUDE_PROJECT_DIR:-$(cd "$script_dir/../.." && pwd)}"
cd "$project_root"

git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
git_common_dir="$(git rev-parse --git-common-dir 2>/dev/null || true)"

# Not a git repo, or this is the main checkout — nothing to bootstrap.
[[ -n "$git_dir" && -n "$git_common_dir" ]] || exit 0
[[ "$(cd "$git_dir" && pwd)" != "$(cd "$git_common_dir" && pwd)" ]] || exit 0

source_tree="$(cd "$git_common_dir/.." && pwd)"
worktree="$project_root"

log() { printf '[worktree-setup] %s\n' "$*" >&2; }

log "worktree: $worktree"
log "source:   $source_tree"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null
fi

if [[ ! -e .env && -e "$source_tree/.env" ]]; then
  log "symlinking .env from source tree"
  ln -sfn "$source_tree/.env" .env
fi

if [[ ! -d node_modules ]]; then
  log "installing npm deps"
  npm install --ignore-scripts
fi

log "ensuring docker services are up"
# Pin COMPOSE_PROJECT_NAME so every worktree shares the one squire-postgres
# container. (Codex worktrees all bottom-out in a dir named "squire", so
# compose auto-picks the same project name; Claude Code worktrees live at
# .claude/worktrees/<name>, so without this pin compose would try to spin
# up a per-worktree stack and collide on container_name/host port.)
# Per-worktree DB and port isolation happens at app startup via
# src/worktree-runtime.ts, not here.
COMPOSE_PROJECT_NAME=squire docker compose up -d >/dev/null

log "running migrations"
npm run --silent db:migrate
npm run --silent db:migrate:test

# seed:cards + seed:scenario-section-books are upsert-idempotent, index is
# hash-keyed per source PDF ("Skipping (already indexed): ..."). First-run in
# a fresh worktree populates the card/scenario tables and vector store so
# /chat actually works; subsequent startups are a fast no-op.
log "seeding card + scenario data (best-effort)"
if ! npm run --silent seed:dev; then
  log "WARN: seeding failed — /chat may error until 'npm run seed:dev' succeeds"
fi
# Indexing is best-effort: the first run downloads Xenova/all-MiniLM-L6-v2
# (~40MB) to embed the Frosthaven PDFs. Offline, sandboxed, or slow
# networks would otherwise block the whole bootstrap. /chat won't work
# until indexing succeeds, but the dev server still comes up — the user
# gets a clear error message from the chat route, and can rerun `npm run
# index` manually once network is available.
log "indexing Frosthaven books (best-effort)"
if ! npm run --silent index; then
  log "WARN: indexing failed — /chat will error until 'npm run index' succeeds"
fi

log "done"
