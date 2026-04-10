<!-- Indexed from CLAUDE.md — see the routing table there. -->

# Issue Tracking

This project moved off GitHub Issues to **Linear** in early Phase 1. Linear gives
us first-class projects and initiatives (so the Phase 1 MVP work can be sliced
across Storage / Web UI / User Accounts / Deployment / Production Readiness with
visible dependencies), an MCP integration that lets agents read and edit issues
without shelling out, and pre-computed git branch names per issue. The trade-off
is that issue tracking now lives in a SaaS tool rather than next to the code in
GitHub — acceptable for a single-maintainer project with tight Linear integration
in the agent loop. GitHub Issues is still used for repo-level concerns
(Dependabot, security advisories) but **not** for work tracking. Per the
"Document Design Choices" rule below, this rationale lives here so future agents
and contributors don't re-litigate the choice.

Use **Linear** for all work tracking. The Squire team key is `SQR`. Issues are
organized into projects (Storage & Data Migration, Web UI, User Accounts,
Deployment, Production Readiness) under the
**Squire · Phase 1: MVP Rules Q&A at the Table** initiative.

Use the Linear MCP tools to interact with issues and projects:

- `mcp__claude_ai_Linear__list_issues` — filter by `project`, `assignee`, `state`, etc.
- `mcp__claude_ai_Linear__get_issue` — full description by ID (e.g., `SQR-31`)
- `mcp__claude_ai_Linear__save_issue` — create or update an issue
- `mcp__claude_ai_Linear__list_projects` — filter by `initiative`
- `mcp__claude_ai_Linear__get_project` — full description, optionally with milestones / members / resources

When discovering work that needs to be done later, create a Linear issue in the
appropriate project (don't open a GitHub issue — they're not used for tracking
any more).

**Before starting work on an issue**, assign it to yourself and move it to
"In Progress" via `save_issue`:

1. `save_issue({ id: "SQR-XX", assignee: "me", state: "In Progress" })`
2. Use the issue's `gitBranchName` field as the branch name (Linear pre-computes
   one in the format `bcm/sqr-XX-<short-description>`).

Move the issue to "In Progress" at the **start** of work (before creating a
branch), not when opening the PR.

GitHub Issues is only used for repo-level concerns (Dependabot, security
advisories) — not for work tracking.

## Pull requests: explicitly close the Linear issue in the PR body

When you open the PR for a Linear issue, include a closing line in the PR body:

```text
Fixes SQR-XX
```

Example:

```text
Fixes SQR-8
```

`Closes SQR-XX` is also acceptable. The important part is that the PR body
explicitly references the Linear issue so the PR is linked back to the ticket.

## Dependencies: capture in BOTH Linear Relations AND description text

When a ticket depends on other work, record the dependency in **both** places:

1. **Linear `blockedBy` / `blocks` relations** — set via
   `save_issue({ id, blockedBy: ["SQR-NN", ...] })`. These power the
   dependency graph views and make blocked work impossible to pick up by
   accident.
2. **A "Depends on:" line in the ticket description** — a human-readable
   pointer for reviewers skimming the description. Include the reasoning
   ("blocked by SQR-34 because Postgres must be available").

Both together — not one or the other. The description text survives view
changes and shows up in PR bodies and search results; the Linear relation
powers filtering and graph traversal.

**When querying relations,** pass `includeRelations: true` to
`mcp__claude_ai_Linear__get_issue`. The field is off by default and it's
easy to mistakenly conclude a repo doesn't use relations when it does.
