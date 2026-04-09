# Squire Project

Squire is a tabletop-rules Q&A agent. Phase 1 MVP.
Stack and layout: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Product spec:
[docs/SPEC.md](docs/SPEC.md). Dev setup: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
Contributor guide: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

This file is the Codex entrypoint for repo-local instructions. It is a **map**,
not a full manual. The load-bearing project rules live in focused docs under
`docs/agent/`. Read the relevant one before doing the matching kind of work.

## Routing table

Read these on demand:

| When you're about to... | Read |
| --- | --- |
| Start work on a Linear issue | [docs/agent/issue-workflow.md](docs/agent/issue-workflow.md) |
| Write or modify tests | [docs/agent/testing.md](docs/agent/testing.md) |
| Make a non-obvious design choice | [docs/agent/code-quality.md](docs/agent/code-quality.md) |
| Touch anything visual — fonts, color, spacing, layout, copy tone | [DESIGN.md](DESIGN.md) |
| Ship a PR | [docs/agent/shipping.md](docs/agent/shipping.md) |
| Run the pre-push review and watch the PR | [docs/agent/review.md](docs/agent/review.md) |
| Write a tech spec or plan-review checkpoint | [docs/agent/planning-artifacts.md](docs/agent/planning-artifacts.md) |
| Record a design/eng decision, or implement a feature that might touch one | [docs/agent/adrs.md](docs/agent/adrs.md) |
| Check repeated pitfalls and promoted gstack learnings | [docs/agent/learnings.md](docs/agent/learnings.md) |

## Always-on rules

- **Linear is the tracker.** Team key `SQR`. Never open GitHub issues for work.
  Before starting work on an issue, assign it to yourself and move it to
  "In Progress".
- **Always use PRs.** Never push directly to `main`. Never force-push. Keep PRs
  small and focused.
- **Stay on the current branch during a dialogue.** If the user is already
  working on an active feature branch, keep related follow-up changes on that
  branch unless the user explicitly says otherwise.
- **TDD.** Write a failing test first when changing behavior.
- **Document *why* in the codebase.** Non-obvious design choices belong in code
  comments, ADRs, or markdown docs, not just chat or PR text.
- **Conventional Commits.** `<type>(<scope>): <description>`.
- **Design system.** Always read [DESIGN.md](DESIGN.md) before making visual or
  UI decisions.

## State model

There are three different kinds of state in this repo. Do not conflate them.

1. **Checked-in project guidance** lives in repo files:
   - `CLAUDE.md`
   - `AGENTS.md`
   - `docs/agent/*`
   - `docs/ARCHITECTURE.md`
   - `docs/DEVELOPMENT.md`
   - `DESIGN.md`
2. **Canonical gstack runtime state** is machine-local under:
   - `~/.gstack/projects/maz-org-squire/`
   - in practice this includes files like `learnings.jsonl`,
     `timeline.jsonl`, and `repo-mode.json`
3. **Repo-local `.gstack/`** is artifact output only:
   - QA reports
   - browser logs
   - other temporary project-local outputs

Repo `.gstack/` is **not** canonical project memory. If a learning is durable
enough to matter to future work, promote it into checked-in docs or an ADR.

## MCP

The repo-local MCP adapter is [`.mcp.json`](.mcp.json). For Squire itself, it
declares the local MCP server at `http://localhost:3000/mcp`.

Machine-level MCP servers, such as Linear, belong in user config like
`~/.codex/config.toml`, not in this repo.

## gstack

This repo's operating assumptions were developed around `gstack`, even though
Codex uses `AGENTS.md` rather than `CLAUDE.md` as its main entrypoint.

What carries over cleanly into Codex:

- use the same repo docs
- respect the same Linear / ADR / review / shipping workflow
- treat `~/.gstack/projects/maz-org-squire/` as the canonical mutable state
- write durable learnings back into the repo when they should survive tool- or
  machine-local state

What does **not** carry over automatically:

- Claude-specific skill invocation syntax
- Claude-specific hooks and permissions config

When a repo rule references a `gstack` skill, interpret that as the canonical
workflow intent, then use the nearest Codex-native equivalent if the exact skill
invocation is unavailable.
