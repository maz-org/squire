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

- **rebase-needs-test-db-migrate** (operational): After rebasing this repo onto a newer main, db-backed tests can all fail with relation missing errors until npm run db:migrate:test is re-run for the checkout-local test database. Source: `observed`.
- **use-node24-for-local-qa** (operational): In Codex desktop, the default shell may resolve to Node 25 even when `.nvmrc` pins 24.14.0. Prepend `$HOME/.nvm/versions/node/v24.14.0/bin` to PATH before `npm run serve` or `npm test`, otherwise sharp can fail to load and block local QA startup. Files: `.nvmrc`, `package.json`. Source: `observed`.
- **coderabbit-outside-diff-comments-may-not-be-replyable-threads** (operational): Some CodeRabbit outside-diff findings only exist inside the review body and do not surface as replyable PR review comments via the GitHub API. When that happens, reply on any real inline threads normally, but use a top-level PR comment referencing the review id and fix commit for the outside-diff note. Source: `observed`.
- **env-example-should-follow-code-not-doc-snippets** (pattern): When syncing local setup docs, treat process.env usage in src/ and scripts/ as the source of truth for supported configuration, then backfill .env.example and docs from that inventory. In this repo, .env.example had drifted far behind the actual runtime env surface for Google OAuth, Langfuse, and worktree/runtime overrides. Files: `.env.example`, `src/server.ts`, `src/auth/google.ts`. Source: `observed`.
- **merged-pr-branch-may-still-have-unmerged-local-commits** (operational): A feature branch can have a merged PR and still fail 'git branch -d' locally if extra follow-up commits landed after the merge point or were never merged. After merge cleanup, inspect 'main..branch' before safe deletion instead of assuming PR merged means branch fully merged. Source: `observed`.
- **removing-active-worktree-invalidates-session-cwd** (operational): If the current Codex session is attached to a linked worktree and that worktree gets removed during cleanup, subsequent commands fail unless they set an explicit surviving workdir such as the main checkout. Switch tooling to a safe workdir before or immediately after worktree removal. Source: `observed`.
- **local-auth-qa-needs-test-auth-env** (operational): Local browser QA of the auth UI needs SESSION_SECRET plus Google OAuth env vars set on the dev server. Without them, /auth/google/start and session-gated routes fail with config 500s before you can test the actual UI behavior. Source: `observed`.
