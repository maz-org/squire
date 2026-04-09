# Curated Learnings

This file is the checked-in synthesis layer for durable learnings promoted
out of `~/.gstack/projects/maz-org-squire/learnings.jsonl`.

It is intentionally curated, not a raw dump. Put non-obvious, repeated,
high-signal lessons here when they should survive tool-local runtime state.

If a learning turns into a real architecture decision, write an ADR instead
of treating this file as the permanent decision record.

## Pitfalls

- **drizzle-wraps-pg-errors-in-cause** (pitfall): Drizzle ORM wraps Postgres errors as DrizzleQueryError. The original PG error (with .code and .constraint fields) is on the .cause property, not the top-level error. When catching unique constraint violations (code 23505) or other PG-specific errors, unwrap: const cause = (err as any).cause ?? err; then check cause.code. Wasted debugging time on SQR-38 because the catch block checked err.code directly and got undefined. Files: `src/db/repositories/user-repository.ts`. Source: `observed`.
- **pii-endpoints-need-cache-control** (pitfall): Any endpoint that returns per-user PII (like /auth/me returning email and name) must set Cache-Control: no-store and Vary: Cookie. Without these headers, a CDN or proxy can cache one users identity and serve it to another. CodeRabbit caught this on PR #211. Always add a regression test asserting these headers on PII endpoints. Files: `src/server.ts`, `test/auth-google.test.ts`. Source: `observed`.
- **git-worktree-shares-hooks** (pitfall): Git worktrees share .git/hooks/ with the main repository. If another agent installs a different hook system (e.g. bd/beads) on main, worktrees inherit those hooks and pre-commit scripts may call scripts that do not exist in the worktree branch. Fix: set core.hooksPath to a branch-local directory (e.g. .husky/) so each worktree uses its own hooks. There is no native Git config to isolate worktree hooks. Files: `.husky/pre-commit`. Source: `observed`.

## Patterns

- **merged-pr-branch-may-still-have-unmerged-local-commits** (operational): A feature branch can have a merged PR and still fail 'git branch -d' locally if extra follow-up commits landed after the merge point or were never merged. After merge cleanup, inspect 'main..branch' before safe deletion instead of assuming PR merged means branch fully merged. Source: `observed`.
- **removing-active-worktree-invalidates-session-cwd** (operational): If the current Codex session is attached to a linked worktree and that worktree gets removed during cleanup, subsequent commands fail unless they set an explicit surviving workdir such as the main checkout. Switch tooling to a safe workdir before or immediately after worktree removal. Source: `observed`.
- **local-auth-qa-needs-test-auth-env** (operational): Local browser QA of the auth UI needs SESSION_SECRET plus Google OAuth env vars set on the dev server. Without them, /auth/google/start and session-gated routes fail with config 500s before you can test the actual UI behavior. Source: `observed`.
- **fresh-worktree-qa-needs-bootstrap** (operational): Fresh Squire worktrees need docker compose up, npm run db:migrate, npm run index, npm run seed:cards, npm run seed:dev-user, and a SESSION_SECRET in the local serve command before browser QA can hit authenticated paths. Source: `observed`.
- **port-claim-release-must-verify-token** (pattern): For file-based port claims across worktrees, release must verify an ownership token before deleting the claim file. Otherwise a late shutdown from process A can delete process B's newer claim for the same port and reintroduce collisions. Pattern: write a unique token into the claim record on acquire, read-before-delete on release, and only remove the file if the token still matches. Files: `src/worktree-runtime.ts`, `src/server.ts`, `test/worktree-runtime.test.ts`. Source: `observed`.
