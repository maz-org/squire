# SQR-61 Eng Plan

## Scope

Linear issue: `SQR-61`  
Branch: `bcm/sqr-61-csp-headers-llm-output-sanitization-adversarial-test-pass`

Goal: add a real XSS boundary for the web chat UI.

This ticket has three linked deliverables:

1. CSP headers on every HTML response.
2. Sanitized rendering for assistant output.
3. Adversarial tests that prove hostile LLM output does not become executable HTML.

## Current State

Relevant codepaths today:

- [`src/web-ui/layout.ts`](/Users/bcm/.codex/worktrees/e628/squire/src/web-ui/layout.ts)
  renders persisted assistant messages as plain `<p>${message.content}</p>`.
- [`src/web-ui/squire.js`](/Users/bcm/.codex/worktrees/e628/squire/src/web-ui/squire.js)
  appends live stream deltas with `paragraph.textContent += payload.delta`.
- [`src/server.ts`](/Users/bcm/.codex/worktrees/e628/squire/src/server.ts)
  serves the HTML shell and all web routes, but does not yet apply a CSP header policy.

What this means:

- The live stream path is safe by accident right now because it uses `textContent`.
- The persisted transcript path is also safe by accident because Hono escapes interpolated strings.
- The product still lacks an intentional rendering boundary, so the first rich-text upgrade can easily punch a hole in both paths.

## Step 0

### Existing code already solving part of the problem

- Hono HTML templates already escape interpolated strings.
- The streaming client already treats live deltas as plain text.
- The asset pipeline already moved JS out of inline scripts, which keeps a strict `script-src 'self'` CSP realistic.

### Minimum change that actually closes the boundary

- Add one shared server-side assistant rendering function.
- Add one shared HTML-response security-header middleware.
- Add sanitizer-focused unit tests plus HTML-route header coverage.

### Complexity check

This should stay under 8 touched files if done cleanly:

- `src/server.ts`
- `src/web-ui/layout.ts`
- one new renderer/sanitizer module
- targeted tests
- adversarial fixture file

If the plan starts inventing a client-side markdown pipeline, new browser deps, or per-delta HTML sanitization, it is getting too big.

## Architecture Review

### Code Quality Finding 1

`[P1] (confidence: 9/10) src/web-ui/layout.ts:139-147, src/web-ui/squire.js:143-157`
The plan needs one trust boundary for assistant rendering. Right now live answers are plain text appended in the browser, while persisted answers are server-rendered HTML. If SQR-61 upgrades only one path, users will see inconsistent rendering and the unsafe path will become the future XSS hole.

### Code Quality Finding 2

`[P1] (confidence: 8/10) src/server.ts:96-221`
CSP has to be applied by shared middleware to all HTML responses, not hand-set route by route. The repo already has many HTML handlers (`/`, `/login`, `/not-invited`, conversation routes, error fallback). A per-route approach is brittle and almost guaranteed to miss the next HTML page.

### Finding 3

`[P2] (confidence: 8/10) issue scope vs current stream contract`
The issue says citations and text deltas both need to route through the sanitizer, but the current SSE contract emits plain text deltas, not HTML fragments. That needs an explicit decision before implementation starts.

## Recommendation

Recommended architecture:

1. Keep live SSE output as plain text during streaming.
2. Add a server-side `renderAssistantContent()` pipeline that turns full assistant text into sanitized HTML for persisted transcript rendering.
3. On stream completion, replace the pending answer body with one server-rendered sanitized fragment, not incremental HTML deltas.

Why this is the right cut:

- one sanitizer implementation, server-owned
- no client-side HTML trust boundary
- strict CSP stays simple
- minimal diff against the current SSE model

## Decisions

### Decision 1

Keep live streaming as plain text, then on `done` swap the pending answer to one
sanitized server-rendered fragment.

Reason:

- keeps the browser trust boundary tiny
- avoids inventing HTML-delta SSE semantics
- gives SQR-61 one renderer to harden instead of two

### Decision 2

Apply CSP through shared middleware for every `text/html` response.

Reason:

- covers `/`, `/login`, `/not-invited`, conversation pages, and HTML fallback paths
- removes route-by-route drift
- avoids the easy failure mode where the next HTML page ships without CSP

### Decision 3

Keep `messages.content` as canonical raw assistant text. Sanitize at display time
through one shared server-side renderer.

Reason:

- keeps persistence independent from one renderer implementation
- preserves future re-render flexibility
- avoids storing a derived artifact as the source of truth

## Code Quality Review

### Finding 1

`[P1] (confidence: 9/10) src/web-ui/layout.ts:145-147, src/web-ui/squire.js:143-157`
The plan should introduce one dedicated assistant-content renderer module, not
spread sanitization between `layout.ts`, `squire.js`, and `server.ts`. If the
escaping, markdown conversion, safelist, and final fragment generation live in
multiple places, this ticket will look finished while still being fragile.

Recommendation:

- add one server-owned renderer module
- make both persisted transcript rendering and final post-stream fragment use it
- keep browser JS unaware of sanitization rules

### Finding 2

`[P2] (confidence: 8/10) repo test/layout conventions`
The Linear issue text says `tests/adversarial/xss-prompts.json`, but this repo's
convention is `test/`, not `tests/`. SQR-61 should follow existing repo layout
instead of creating a second test-root shape for one fixture file.

Recommendation:

- place the fixture under `test/fixtures/` or `test/adversarial/`
- keep the adversarial harness in Vitest with the rest of the repo

## Test Review

Required coverage for SQR-61:

1. Sanitizer strips hostile payloads:
   - `<script>`
   - inline event handlers
   - `javascript:` links
   - `data:text/html` payloads
   - raw forms / iframe / meta refresh / SVG onload
2. Allowed formatting survives:
   - paragraph breaks
   - emphasis / strong
   - lists
   - blockquote
   - code / pre
   - `https:` links only
3. Streaming boundary stays safe:
   - live SSE path still appends plain text only
   - final `done` swap uses the server-rendered sanitized fragment
4. HTML route coverage:
   - `/`
   - `/login`
   - `/not-invited`
   - `/chat/:conversationId`
   - HTML error/fallback path
5. Negative header coverage:
   - JSON routes should not accidentally gain the HTML CSP behavior
   - SSE route should not be mislabeled as HTML

Regression tests that should be mandatory:

- stored hostile assistant content in the DB does not execute on transcript reload
- hostile content emitted during streaming does not execute before `done`
- hostile tool-result text does not become executable markup

## Performance Review

No major performance blocker found.

Expected cost profile:

- CSP middleware is negligible
- sanitizing one final assistant answer on `done` is cheap at Phase 1 scale
- sanitizing persisted transcript render on page load is also cheap for the
  current small-turn conversations

The only performance guardrail worth writing down:

- do not sanitize every individual text delta during live streaming

That would spend CPU on the hottest path for no product gain, because we already
decided the live stream remains plain text until completion.

## Implementation Shape

Minimal-change implementation plan:

1. Add an HTML-response security middleware in [`src/server.ts`](/Users/bcm/.codex/worktrees/e628/squire/src/server.ts) that attaches the SQR-61 CSP to `text/html` responses.
2. Add a server-side assistant renderer module that:
   - accepts raw assistant text
   - converts allowed markdown to HTML
   - sanitizes to a strict safelist
   - returns an escaped/safe fragment for Hono templates
3. Update [`src/web-ui/layout.ts`](/Users/bcm/.codex/worktrees/e628/squire/src/web-ui/layout.ts) persisted assistant rendering to use that renderer.
4. Add one HTML fragment endpoint or reuse an existing server path so the browser can replace the pending answer with the sanitized final fragment after stream completion.
5. Keep [`src/web-ui/squire.js`](/Users/bcm/.codex/worktrees/e628/squire/src/web-ui/squire.js) on plain-text deltas during streaming.
6. Add adversarial fixtures and route/header regression tests.

## Verdict

Eng review verdict: CLEAR WITH REQUIRED SHAPE

The ticket is well-scoped if it stays boring:

- one server-owned renderer
- one HTML-response CSP middleware
- raw text stored, sanitized HTML derived on display
- plain-text streaming preserved until completion

Do not turn SQR-61 into a browser-side rich-text system. That is how a simple
security ticket mutates into a month of edge cases.
