# Curated Learnings

This file is the checked-in synthesis layer for durable learnings promoted
out of `~/.gstack/projects/maz-org-squire/learnings.jsonl`.

Promotion workflow: review the machine-local learnings with gstack `/learn`,
then run `npm run agent:export-learnings` to regenerate this checked-in summary.

It is intentionally curated, not a raw dump. Put non-obvious, repeated,
high-signal lessons here when they should survive tool-local runtime state.

If a learning turns into a real architecture decision, write an ADR instead
of treating this file as the permanent decision record.

## Patterns

- **coderabbit-outside-diff-comments-may-not-be-replyable-threads** (operational): Some CodeRabbit outside-diff findings only exist inside the review body and do not surface as replyable PR review comments via the GitHub API. When that happens, reply on any real inline threads normally, but use a top-level PR comment referencing the review id and fix commit for the outside-diff note. Source: `observed`.
- **env-example-should-follow-code-not-doc-snippets** (pattern): When syncing local setup docs, treat process.env usage in src/ and scripts/ as the source of truth for supported configuration, then backfill .env.example and docs from that inventory. In this repo, .env.example had drifted far behind the actual runtime env surface for Google OAuth, Langfuse, and worktree/runtime overrides. Files: `.env.example`, `src/server.ts`, `src/auth/google.ts`. Source: `observed`.
- **local-auth-qa-needs-test-auth-env** (operational): Local browser QA of the auth UI needs SESSION_SECRET plus Google OAuth env vars set on the dev server. Without them, /auth/google/start and session-gated routes fail with config 500s before you can test the actual UI behavior. Source: `observed`.
- **fresh-worktree-qa-needs-bootstrap** (operational): Fresh Squire worktrees need docker compose up, npm run db:migrate, npm run index, npm run seed:cards, npm run seed:dev-user, and a SESSION_SECRET in the local serve command before browser QA can hit authenticated paths. Source: `observed`.
- **git-worktree-shares-hooks** (pitfall): Git worktrees share .git/hooks/ with the main repository. If another agent installs a different hook system on main, worktrees inherit those hooks and pre-commit scripts may call scripts that do not exist in the worktree branch. Fix: set core.hooksPath to a branch-local directory such as `.husky/` so each worktree uses its own hooks. Files: `.husky/pre-commit`, `scripts/setup-git-hooks.ts`. Source: `observed`.
- **pii-endpoints-need-cache-control** (pitfall): Any endpoint that returns per-user PII, like `/auth/me` returning email and name, must set `Cache-Control: no-store` and `Vary: Cookie`. Without these headers, a CDN or proxy can cache one user's identity and serve it to another. Always add a regression test asserting these headers on PII endpoints. Files: `src/server.ts`, `test/auth-google.test.ts`. Source: `observed`.
- **port-claim-release-must-verify-token** (pattern): For file-based port claims across worktrees, release must verify an ownership token before deleting the claim file. Otherwise a late shutdown from process A can delete process B's newer claim for the same port and reintroduce collisions. Pattern: write a unique token into the claim record on acquire, read-before-delete on release, and only remove the file if the token still matches. Files: `src/worktree-runtime.ts`, `src/server.ts`, `test/worktree-runtime.test.ts`. Source: `observed`.
