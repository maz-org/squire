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
