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

- **browse-stop-after-server-restart** (operational): After restarting the local app during browser QA, gstack browse can keep the old page state and make a fresh fix look broken. Run browse stop or restart the browse daemon before trusting post-restart QA results. Files: `src/server.ts`, `src/web-ui/squire.js`. Source: `observed`.
- **chat-ui-qa-must-include-second-turn-submit** (pattern): When a branch touches shared chat browser code such as HTMX request wiring, SSE handling, or conversation-page form behavior, manual QA must include asking a second question in the same conversation. First-turn submit, seeded transcript rendering, and direct SSE checks are not enough, because follow-up messages use a different request path and can silently regress while the first-turn flow still looks healthy. Files: `docs/agent/qa.md`, `src/web-ui/squire.js`, `src/server.ts`. Source: `observed`.
- **all-branch-changes-go-in-pr** (preference): If anything is changed on the branch, it belongs in the PR. Do not leave branch-local doc or cleanup changes out of the shipping commit set. Files: `docs/agent/shipping.md`, `docs/CONTRIBUTING.md`. Source: `user-stated`.
- **recent-question-overflow-needs-full-history-projection** (pattern): In the ledger UI, overflow is not just a CSS problem. If older recent questions are truncated in the server-side projection, any drawer or secondary history surface can only reveal the same truncated set. Keep the conversation projection authoritative and let the layout decide which recent questions stay visible versus move behind `More history`. Files: `src/chat/conversation-service.ts`, `src/web-ui/layout.ts`, `src/web-ui/styles.css`. Source: `observed`.
- **codex-shell-needs-explicit-node24-path** (operational): In Codex desktop shells for Squire, repo auto-switch via .nvmrc can miss because the shell starts before landing in the repo cwd, leaving commands on Homebrew Node 25. For Node-sensitive commands, prepend $HOME/.nvm/versions/node/v24.14.0/bin to PATH explicitly instead of assuming nvm auto-use fired. Files: `.nvmrc`, `package.json`. Source: `observed`.
- **vitest-clearallmocks-leaves-once-queues** (operational): In Vitest, vi.clearAllMocks() clears call history but leaves queued mockReturnValueOnce/mockResolvedValueOnce behavior intact. In files with hoisted shared mocks, that can leak one-time return values across tests and show up only under a different execution order such as CI coverage runs. Fix by mockReset() on the affected mocks before re-establishing defaults, rather than relying on clearAllMocks alone. Files: `test/server-api.test.ts`. Source: `observed`.
- **drizzle-kit-beta-breaks-current-drizzle-orm-cli** (operational): In Squire, upgrading drizzle-kit from 0.31.x to the 1.0.0-beta line removes the @esbuild-kit deprecation/audit chain, but the CLI breaks against the current drizzle-orm with ERR_PACKAGE_PATH_NOT_EXPORTED for drizzle-orm/\_relations. Treat drizzle-kit beta adoption as a paired drizzle-kit/drizzle-orm migration, not a safe audit-only bump. Files: `package.json`. Source: `observed`.
- **rebase-needs-test-db-migrate** (operational): After rebasing this repo onto a newer main, db-backed tests can all fail with relation missing errors until npm run db:migrate:test is re-run for the checkout-local test database. Source: `observed`.
