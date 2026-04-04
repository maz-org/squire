#!/usr/bin/env bash
# Symlink git submodule directories from the main worktree into the current
# (secondary) worktree. This avoids re-cloning large data repos, which can
# take over an hour.
#
# Usage: scripts/symlink-submodules.sh
#
# The script is a no-op when run from the main worktree. It reads submodule
# paths from .gitmodules and creates symlinks pointing to the main worktree's
# copies. It is safe to run multiple times (idempotent).

set -euo pipefail

main_worktree=$(git worktree list --porcelain | head -1 | sed 's/^worktree //')
current_worktree=$(git rev-parse --show-toplevel)

if [ "$main_worktree" = "$current_worktree" ]; then
  echo "Already in the main worktree — nothing to do."
  exit 0
fi

git config --file .gitmodules --get-regexp '^submodule\..*\.path$' | while read -r _ subpath; do
  target="$main_worktree/$subpath"
  link="$current_worktree/$subpath"

  if [ -L "$link" ]; then
    echo "Already symlinked: $subpath"
    continue
  fi

  if [ ! -d "$target" ]; then
    echo "WARNING: Main worktree missing $subpath — skipping (is the submodule initialized there?)"
    continue
  fi

  rm -rf "$link"
  ln -s "$target" "$link"
  echo "Symlinked: $subpath -> $target"
done
