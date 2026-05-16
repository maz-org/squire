# GBrain Memory Guide

Squire uses gbrain as the searchable memory layer for agent work. Do not mirror
`~/.gstack/projects/maz-org-squire/learnings.jsonl` into this repo. Search
gbrain directly for prior learnings, plans, transcripts, timelines, and design
artifacts.

This file explains how to use that memory. It is not a learning dump.

## Required Tools

Project developers are expected to have both gstack and gbrain installed. If
either is missing, follow the setup steps in [../DEVELOPMENT.md](../DEVELOPMENT.md)
before doing AI-assisted work.

## Worktree Sync

Each active Squire worktree must be registered as its own gbrain source. The
source id includes a hash of the absolute worktree path, and the ignored
`.gbrain-source` file pins gbrain commands under that checkout to the right
source.

Run this from every active worktree:

```bash
/sync-gbrain --code-only
```

If slash-style gstack invocation is unavailable in the current tool, run the
underlying sync command from the worktree:

```bash
GSTACK_ROOT="${GSTACK_ROOT:-$HOME/.claude/skills/gstack}"
bun run "$GSTACK_ROOT/.agents/skills/gstack/bin/gstack-gbrain-sync.ts" --code-only
```

Sync gbrain:

- when creating or switching into a linked worktree
- after meaningful code or documentation changes
- before `/review`, `/ship`, or a large refactor if the work depends on prior
  project context
- whenever gbrain search results feel stale or point at another worktree

Do not run gbrain sync in git hooks or every test command. It can be slow on a
fresh worktree and may need network access for embeddings.

## Search Rules

Use gbrain for semantic questions and historical context:

```bash
gbrain search "second turn submit QA"
gbrain search "Langfuse authoritative evals"
gbrain search "qa branch server worktree"
```

Use `rg` for exact strings, regexes, file lists, and quick local checks.

Current caveat: `gbrain code-def` can return duplicate results across indexed
Squire worktrees. Until that is fixed upstream, prefer `gbrain search` plus
local file inspection for scoped worktree code lookup.

## Durable Decisions

GBrain is memory and search. Checked-in docs are still the source of truth for
rules that must apply to every developer and agent run. If a memory becomes a
project rule, move it into the right doc. If it becomes an architecture choice,
write an ADR.
