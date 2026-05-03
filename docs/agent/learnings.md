# Curated Learnings

This file is the checked-in synthesis layer for durable learnings promoted
out of `~/.gstack/projects/maz-org-squire/learnings.jsonl`.

It is intentionally curated, not a raw dump. Put non-obvious, repeated,
high-signal lessons here when they should survive tool-local runtime state.

If a learning turns into a real architecture decision, write an ADR instead
of treating this file as the permanent decision record.

## Pitfalls

- **never-textcontent-on-button-with-svg-or-span-glyph** (pitfall): Setting 'button.textContent = whatever' destroys child nodes. If the button renders a glyph via an inner '<span>' or '<svg>' (e.g. the Squire seal monogram via '<span aria-hidden="true">S</span>'), textContent assignment wipes it permanently. Use the 'disabled' attribute + 'data-\*' attributes + CSS for pending visuals instead of textContent. Files: `src/web-ui/squire.js`. Source: `observed`.
- **sse-done-close-must-be-synchronous** (pitfall): When using requestAnimationFrame to wrap an EventSource done-handler swap (e.g. for aria-busy timing), close the source synchronously BEFORE the rAF — not inside the deferred callback. Otherwise the server-initiated TCP close fires an 'error' event between done arriving and the rAF tick, which stomps the answer with the error-banner code path. Belt-and-suspenders: also guard the error handler with 'source.readyState === 2' (CLOSED). Files: `src/web-ui/squire.js`. Source: `observed`.

## Patterns

- **openai-eval-loop-limit-guards** (pattern): SQR-141 found GPT-5.5 loop-limit failures came from eval-only loop-control gaps: OpenAI runner lacked the default repeated rule-search synthesis guard and did not stop tools at trajectory maxToolCalls. The guard fixes rule-looting but GPT-5.5 still misses required resolve/open trajectory on traj-card-fuzzy-vs-exact, so OpenAI should stay out of production routing. Files: `eval/openai-runner.ts`, `test/eval-openai-runner.test.ts`, `docs/plans/sqr-141-gpt55-loop-limit-investigation.md`. Source: `observed`.
- **eval-dir-not-covered-by-default-lint-format** (operational): Squire npm run check runs typecheck over eval files, but eslint and prettier checks only cover src/, test/, and scripts/. For eval/\* changes, run npx eslint eval and npx prettier --check eval explicitly before shipping. Files: `package.json`, `eval/matrix.ts`, `eval/matrix-runtime.ts`. Source: `observed`.
- **langfuse-authoritative-for-evals** (preference): For Squire multi-provider evals, Langfuse should be the authoritative trace/debugging system. Local files may exist as convenience exports or summaries, but replay/debug/report tooling should not require a parallel local artifact store. Files: `docs/plans/sqr-multi-provider-model-evals-test-plan.md`. Source: `user-stated`.
- **qa-branch-server-must-match-current-worktree** (operational): When running browser QA in Squire, verify the localhost port belongs to the current worktree before trusting results. Another worktree can already be serving a healthy app on an allowlisted port, which makes branch QA silently inspect the wrong code. Source: `observed`.
- **browse-stop-after-server-restart** (operational): After restarting the local app during browser QA, gstack browse can keep the old page state and make a fresh fix look broken. Run browse stop or restart the browse daemon before trusting post-restart QA results. Files: `src/server.ts`, `src/web-ui/squire.js`. Source: `observed`.
- **chat-ui-qa-must-include-second-turn-submit** (pattern): When a branch touches shared chat browser code such as HTMX request wiring, SSE handling, or conversation-page form behavior, manual QA must include asking a second question in the same conversation. First-turn submit, seeded transcript rendering, and direct SSE checks are not enough, because follow-up messages use a different request path and can silently regress while the first-turn flow still looks healthy. Files: `docs/agent/qa.md`, `src/web-ui/squire.js`, `src/server.ts`. Source: `observed`.
