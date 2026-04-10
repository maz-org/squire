# Curated Learnings

This file is the checked-in synthesis layer for durable learnings promoted
out of `~/.gstack/projects/maz-org-squire/learnings.jsonl`.

It is intentionally curated, not a raw dump. Put non-obvious, repeated,
high-signal lessons here when they should survive tool-local runtime state.

If a learning turns into a real architecture decision, write an ADR instead
of treating this file as the permanent decision record.

## Pitfalls

- **ship-pr-body-needs-template-and-linear-close** (pitfall): In Squire, /ship output is not done when the PR merely exists. The PR body must be regenerated to the full ship template, and it must include a Linear closing line like Fixes SQR-84 or Closes SQR-84. Do not accept gh pr create defaults, commit-list bodies, or terse hand-written summaries as the final PR metadata. Files: `docs/agent/shipping.md`, `docs/agent/issue-workflow.md`, `docs/CONTRIBUTING.md`. Source: `observed`.

## Patterns

- **vitest-clearallmocks-leaves-once-queues** (operational): In Vitest, vi.clearAllMocks() clears call history but leaves queued mockReturnValueOnce/mockResolvedValueOnce behavior intact. In files with hoisted shared mocks, that can leak one-time return values across tests and show up only under a different execution order such as CI coverage runs. Fix by mockReset() on the affected mocks before re-establishing defaults, rather than relying on clearAllMocks alone. Files: `test/server-api.test.ts`. Source: `observed`.
- **drizzle-kit-beta-breaks-current-drizzle-orm-cli** (operational): In Squire, upgrading drizzle-kit from 0.31.x to the 1.0.0-beta line removes the @esbuild-kit deprecation/audit chain, but the CLI breaks against the current drizzle-orm with ERR_PACKAGE_PATH_NOT_EXPORTED for drizzle-orm/\_relations. Treat drizzle-kit beta adoption as a paired drizzle-kit/drizzle-orm migration, not a safe audit-only bump. Files: `package.json`. Source: `observed`.
- **rebase-needs-test-db-migrate** (operational): After rebasing this repo onto a newer main, db-backed tests can all fail with relation missing errors until npm run db:migrate:test is re-run for the checkout-local test database. Source: `observed`.
- **use-node24-for-local-qa** (operational): In Codex desktop, the default shell may resolve to Node 25 even when .nvmrc pins 24.14.0. Prepend $HOME/.nvm/versions/node/v24.14.0/bin to PATH before npm run serve or npm test, otherwise sharp can fail to load and block local QA startup. Files: `/Users/bcm/.codex/worktrees/e628/squire/.nvmrc`, `/Users/bcm/.codex/worktrees/e628/squire/package.json`. Source: `observed`.
- **coderabbit-outside-diff-comments-may-not-be-replyable-threads** (operational): Some CodeRabbit outside-diff findings only exist inside the review body and do not surface as replyable PR review comments via the GitHub API. When that happens, reply on any real inline threads normally, but use a top-level PR comment referencing the review id and fix commit for the outside-diff note. Source: `observed`.
- **env-example-should-follow-code-not-doc-snippets** (pattern): When syncing local setup docs, treat process.env usage in src/ and scripts/ as the source of truth for supported configuration, then backfill .env.example and docs from that inventory. In this repo, .env.example had drifted far behind the actual runtime env surface for Google OAuth, Langfuse, and worktree/runtime overrides. Files: `.env.example`, `src/server.ts`, `src/auth/google.ts`. Source: `observed`.
- **merged-pr-branch-may-still-have-unmerged-local-commits** (operational): A feature branch can have a merged PR and still fail 'git branch -d' locally if extra follow-up commits landed after the merge point or were never merged. After merge cleanup, inspect 'main..branch' before safe deletion instead of assuming PR merged means branch fully merged. Source: `observed`.
