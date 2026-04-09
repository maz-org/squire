# Agent baseline

This is the shared baseline for all coding agents working in Squire. Entry-point
files like `CLAUDE.md` and `AGENTS.md` should stay thin and point here rather
than duplicating project rules.

## Project

Squire is a tabletop-rules Q&A agent. Phase 1 MVP.
Stack and layout: [docs/ARCHITECTURE.md](../ARCHITECTURE.md). Product spec:
[docs/SPEC.md](../SPEC.md). Dev setup: [docs/DEVELOPMENT.md](../DEVELOPMENT.md).
Contributor guide: [docs/CONTRIBUTING.md](../CONTRIBUTING.md).

This baseline is a **map**, not a full manual. The deeper task-specific rules
live in the focused docs linked below.

## Routing table

Read these on demand:

| When you're about to...                                                   | Read                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------ |
| Start work on a Linear issue                                              | [issue-workflow.md](./issue-workflow.md)         |
| Write or modify tests                                                     | [testing.md](./testing.md)                       |
| Make a non-obvious design choice                                          | [code-quality.md](./code-quality.md)             |
| Touch anything visual — fonts, color, spacing, layout, copy tone          | [../../DESIGN.md](../../DESIGN.md)               |
| Ship a PR                                                                 | [shipping.md](./shipping.md)                     |
| Run the pre-push review and watch the PR                                  | [review.md](./review.md)                         |
| Write a tech spec or plan-review checkpoint                               | [planning-artifacts.md](./planning-artifacts.md) |
| Record a design/eng decision, or implement a feature that might touch one | [adrs.md](./adrs.md)                             |
| Check repeated pitfalls and promoted gstack learnings                     | [learnings.md](./learnings.md)                   |

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
- **Document _why_ in the codebase.** Non-obvious design choices belong in code
  comments, ADRs, or markdown docs, not just chat or PR text.
- **Conventional Commits.** `<type>(<scope>): <description>`.
- **Design system.** Always read [../../DESIGN.md](../../DESIGN.md) before
  making visual or UI decisions.

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

The repo-local MCP adapter is [../../.mcp.json](../../.mcp.json). For Squire
itself, it declares the local MCP server at `http://localhost:3000/mcp`.

Machine-level MCP servers, such as Linear, belong in user config, not in this
repo.
