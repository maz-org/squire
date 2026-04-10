# Design + Engineering Plan: SQR-8 Streaming Chat Protocol

## Status

Source of truth for building and testing SQR-8 on branch
`bcm/sqr-8-streaming-chat-protocol-text-deltas-tool-indicators`.

This plan consolidates:

- the SQR-8 Linear ticket
- the branch design artifact in `~/.gstack/projects/maz-org-squire/`
- the focused design-review decisions
- the engineering seam decisions made during `/plan-eng-review`

If implementation or tests disagree with this file, update this file first.

## Context

SQR-8 upgrades the authenticated web chat flow from "submit, wait, redirect to a
finished page" to a live answer slot that:

- renders immediate feedback after submit
- streams answer prose into the current-turn ledger
- shows quiet tool activity without turning into a diagnostics console
- keeps citations inline and in the footer source line
- handles failures in a way that preserves trust

This ticket does **not** add a second reasoning engine. The reasoning path
remains the existing knowledge-agent path:

- [src/service.ts](../../src/service.ts) `ask()`
- [src/agent.ts](../../src/agent.ts) `runAgentLoop()`

The new work is transport, rendering, orchestration, and persistence around that
path.

Relevant existing code:

- [src/server.ts](../../src/server.ts)
- [src/chat/conversation-service.ts](../../src/chat/conversation-service.ts)
- [src/web-ui/layout.ts](../../src/web-ui/layout.ts)
- [src/web-ui/squire.js](../../src/web-ui/squire.js)
- [src/web-ui/styles.css](../../src/web-ui/styles.css)
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md)
- [DESIGN.md](../../DESIGN.md)
- [docs/design-preview.html](../design-preview.html)
- [docs/plans/sqr-7-eng-plan.md](./sqr-7-eng-plan.md)

## Scope

### In scope

- Add a browser-facing SSE chat stream for one pending turn at a time
- Add the current-answer loading skeleton and atomic first-delta swap
- Add quiet in-answer tool indicators during streaming
- Collapse final consulted sources into the existing footer line on `done`
- Preserve inline citation rendering in the answer prose
- Distinguish channel-level failures from tool-level recoverable failures
- Keep persistence deterministic: user first, assistant once at completion
- Add server, DOM, accessibility, and ordering tests for the streaming flow

### Out of scope

- Rewriting the broader page shell or changing the ledger metaphor
- A separate sources panel, chip row, or tool-debug console
- Streaming partial assistant text into Postgres
- Reconnect or resume semantics for dropped streams
- Browser E2E coverage beyond what is already tracked elsewhere
- Broad sanitization policy changes beyond what SQR-61 already owns

## Design Decisions

### What the user sees

1. The user submits a question.
2. The question lands immediately in the current-turn ledger.
3. The answer slot shows a drop-cap skeleton, not a spinner.
4. The first streamed answer fragment atomically replaces the skeleton.
5. Quiet sepia tool-status metadata may appear while the answer is streaming.
6. Inline citations appear inside the prose, not in a second UI region.
7. On completion, transient tool indicators collapse into the existing footer
   source line.
8. Failures render as Squire banners, not generic alerts.

### Visual hierarchy

- Prose-first, always.
- Fixed order during streaming:
  1. current question
  2. answer prose or skeleton
  3. quiet tool-status metadata
  4. footer source line only after `done`
- Tool indicators are ledger metadata, not a co-equal interface.

### Failure-state truthfulness

- Transport or session failures are channel-level failures. They replace the
  in-progress answer and use stronger labels like `TROUBLE CONNECTING` or
  `SESSION ENDED`.
- Tool-specific failures are softer. They communicate that one lookup failed
  while the answer may still continue. Working label:
  `COULDN'T CHECK ONE SOURCE`.
- These states must not share identical wording.

### Responsive and accessibility rules

- Mobile keeps the reading column stable. Tool indicators may wrap, but they
  must stay visually secondary and must not shove the input dock off-screen.
- Desktop keeps the same hierarchy inside the existing 640px reading column.
- The live region is for answer prose, not decorative status noise.
- The skeleton is decorative and remains `aria-hidden="true"`.
- `prefers-reduced-motion: reduce` disables the skeleton pulse.
- The skeleton-to-first-delta transition must remain atomic from a DOM observer
  perspective.

### Existing primitives to reuse

- `.squire-question`
- `.squire-answer`
- `.squire-toolcall`
- `.squire-banner`
- `.cite`
- existing drop-cap styling
- existing reduced-motion handling in [src/web-ui/styles.css](../../src/web-ui/styles.css)

## Engineering Decisions

These are locked unless implementation reveals a concrete problem.

1. **Full feature, lean implementation.**
   Build the complete user-visible streaming flow now, but do not introduce a
   large new abstraction stack.
2. **Keep the existing synchronous path.**
   Add a parallel streaming path beside the current SQR-7 synchronous flow.
   Do not refactor the whole conversation service into streaming-first yet.
3. **Persist user immediately, persist assistant once.**
   User message is written before streaming starts. Assistant message is written
   once on completion. No partial assistant fragments in Postgres.
4. **HTMX for submit shell, small custom JS for SSE.**
   HTMX owns form submission and shell swap. A small controller in
   [src/web-ui/squire.js](../../src/web-ui/squire.js) owns `EventSource`.
5. **Conversation/web layer owns the browser contract.**
   Internal knowledge-agent events may evolve. The browser-facing SSE contract
   must stay stable and boring.
6. **POST mutates, GET streams.**
   Form POST creates the pending turn and returns the pending shell. A separate
   GET endpoint streams exactly one assistant response.
7. **Scope the stream to one pending turn.**
   The stream is tied to one specific user message, not "latest pending work in
   the conversation."
8. **Server owns rendered streamed content.**
   The browser appends trusted fragments into fixed DOM targets. It does not
   become a rich-text or sanitization engine.

## Existing Code Reuse

### Reuse as-is

- Existing persisted conversation and message schema from SQR-7
- Existing ownership checks and `404` policy in
  [src/chat/conversation-service.ts](../../src/chat/conversation-service.ts)
- Existing `streamSSE` pattern in [src/server.ts](../../src/server.ts) `/api/ask`
- Existing banner, answer, citation, and footer primitives in
  [src/web-ui/styles.css](../../src/web-ui/styles.css)
- Existing CSRF token propagation via inherited `hx-headers`

### Reuse with widening

- `ask()` already supports `emit`. SQR-8 widens the internal streaming payload
  shape so the conversation layer can translate it into the browser contract.
- [src/web-ui/squire.js](../../src/web-ui/squire.js) already owns small web UI
  behavior and is the right home for the stream controller.

### New dependency note

The repo currently carries HTMX headers in HTML but does **not** actually ship
 the HTMX runtime yet. SQR-8 must add HTMX as a locally served asset, not a CDN
 script, so SQR-61 can keep CSP sane.

## Route Model

### Existing routes kept for non-HTMX fallback

- `POST /chat`
- `POST /chat/:conversationId/messages`

If the request is **not** an HTMX request, keep the current redirect-based
behavior as a fallback path. That gives us progressive degradation and keeps the
working SQR-7 flow intact.

### HTMX submit routes

- `POST /chat`
- `POST /chat/:conversationId/messages`

For HTMX requests, these routes:

1. validate CSRF and auth
2. persist the user turn
3. create a pending answer shell for that turn
4. return HTML for the current-turn surface, not a redirect

For the first-turn route, the response must also push the browser URL to the new
conversation URL using `HX-Push-Url: /chat/:conversationId`.

### New SSE route

- `GET /chat/:conversationId/messages/:messageId/stream`

Where `messageId` is the newly-created **user** message being answered.

This route:

1. validates auth ownership for the conversation
2. verifies that `messageId` belongs to the conversation and user
3. streams exactly one assistant response for that user turn
4. persists the final assistant outcome once the stream completes or fails

This route never multiplexes multiple turns.

## Browser-Facing SSE Contract

The browser-facing event vocabulary remains the SQR-8 contract:

| Event | Payload | Purpose |
| --- | --- | --- |
| `text-delta` | rendered fragment payload | append trusted answer content |
| `tool-start` | `{ id, label }` | add quiet tool metadata |
| `tool-result` | `{ id, label, ok }` | update tool metadata in place |
| `citation` | citation/footer payload | update final consulted-source accumulator |
| `done` | `{}` | finalize answer, collapse footer, close stream |
| `error` | `{ kind, message, recoverable }` | render correct failure state |

### Internal translation boundary

The knowledge layer does **not** need to emit this contract directly.

Internal emit events can stay knowledge-oriented and may widen in SQR-8, for
example:

- `text`
- `tool_call`
- `tool_result`
- `done`

with richer payloads than today, including ids, summaries, and optional citation
metadata.

The conversation/web layer translates those internal events into the stable
browser contract above.

## Pending Turn Shell

The HTMX POST response should render the current-turn surface in its pending
state.

### Required DOM pieces

- current question block
- current answer block with:
  - `.squire-answer`
  - `.squire-answer .content`
  - `.squire-answer .skeleton`
  - `.squire-answer .tools`
- footer source line target
- `data-stream-url` for the specific pending turn

### DOM ownership

- HTMX POST response owns initial shell replacement
- `squire.js` stream controller owns:
  - opening `EventSource`
  - atomic first-delta swap
  - appending trusted content fragments
  - mutating tool-status nodes
  - collapsing footer content on `done`
  - rendering failure states for this turn

The controller should not do layout decisions. It only mutates the named
targets.

## Persistence and Write Order

### First turn

1. Validate question and idempotency key
2. Create or resume the conversation for that idempotency key
3. Persist the user message
4. Return pending shell
5. Stream assistant reply for that user message
6. Persist final assistant message on success
7. Persist final assistant error turn on failure

### Existing conversation turn

1. Validate question
2. Verify conversation ownership
3. Persist the user message
4. Return pending shell
5. Stream assistant reply for that user message
6. Persist final assistant message on success
7. Persist final assistant error turn on failure

### Failure persistence rule

Persist a final assistant-visible failure outcome, not partial fragments.

That preserves:

- clean history replay
- stable ownership semantics
- deterministic tests
- simpler future retry logic

## Rendering Boundary

Server owns formatting and sanitization of streamed answer fragments.

### Implications

- The browser appends trusted HTML fragments into `.squire-answer .content`
- Citation markup arrives already rendered in a safe form
- Footer source labels arrive in display-ready form
- The browser never turns raw tool metadata into arbitrary HTML

This is required so SQR-61 can enforce one trust boundary instead of splitting
sanitization logic between server and browser.

## HTMX Integration Plan

### Why HTMX here

The plan decision was explicit: HTMX should own the form submission and shell
swap, but not the streaming lifecycle.

### Required additions

- Add HTMX runtime as a locally served asset through the existing asset
  pipeline, not a CDN include
- Add `hx-post` and `hx-target` wiring to the chat form
- Add `hx-swap` behavior that replaces the current-turn surface with the
  pending shell returned by the POST
- On first-turn POST, also push the browser URL to the new conversation URL

### JS stream controller responsibilities

In [src/web-ui/squire.js](../../src/web-ui/squire.js):

- detect a newly swapped pending answer shell
- read `data-stream-url`
- open `EventSource`
- perform the atomic skeleton replacement on first content event
- append trusted answer fragments
- update tool-status labels in place
- update footer accumulation state
- close on `done`
- render the correct banner on `error`
- clean up the stream when the page or slot is replaced

## Failure Modes

| Failure | Server behavior | UI behavior | Persistence |
| --- | --- | --- | --- |
| Transport failure before first delta | emit `error { kind: "transport", recoverable: true }` | replace pending answer with `TROUBLE CONNECTING` banner + retry affordance | persist final assistant error turn |
| Session expires mid-stream | emit `error { kind: "session", recoverable: false }` | `SESSION ENDED` banner, redirect after delay | persist final assistant error turn |
| Tool call fails but answer can continue | emit tool-scoped recoverable error | softer `COULDN'T CHECK ONE SOURCE` treatment, answer may continue | final assistant answer persists; tool failure not as partial message |
| Empty final answer | emit fallback final content, then `done` | no blank answer slot | persist fallback assistant message |
| Client disconnect | stop work and clean up stream | no further UI updates | no partial assistant fragments |

## Observability

Add a chat-stream span around the streaming route covering:

- session lookup
- user turn persistence
- stream start
- first SSE byte
- final SSE byte
- final assistant persistence

Required attribute:

- `time_to_first_byte_ms`

This is the user-perceptible latency that matters most.

## Files

### Likely modified

- [src/server.ts](../../src/server.ts)
- [src/chat/conversation-service.ts](../../src/chat/conversation-service.ts)
- [src/service.ts](../../src/service.ts)
- [src/agent.ts](../../src/agent.ts)
- [src/web-ui/layout.ts](../../src/web-ui/layout.ts)
- [src/web-ui/squire.js](../../src/web-ui/squire.js)
- [src/web-ui/styles.css](../../src/web-ui/styles.css)
- [src/web-ui/assets.ts](../../src/web-ui/assets.ts)
- chat and layout test files

### Avoid unless proven necessary

- a new stream-manager class
- a second browser controller file
- a client-side HTML or markdown renderer
- a second conversation service module

Prefer widening existing modules first.

## Testing

This plan is only done when server ordering, DOM behavior, and accessibility are
all covered.

### Required server tests

1. HTMX first-turn POST returns pending shell and pushes `/chat/:conversationId`
2. HTMX existing-conversation POST returns pending shell without redirect
3. SSE stream is scoped to one `(conversationId, messageId)` pair
4. Non-owned conversation or message ids still return indistinguishable `404`
5. User message persists before stream begins
6. Assistant message persists once on final success
7. Failure persists one final assistant error turn, not partial text
8. Client disconnect triggers cleanup and no partial assistant persistence
9. Browser-facing event translation preserves ordering constraints:
   no answer text leaks between `tool-start` and its matching `tool-result`
10. OTel span emits `time_to_first_byte_ms`

### Required DOM and controller tests

1. Skeleton is rendered immediately in the pending shell
2. Skeleton remains `aria-hidden="true"`
3. First answer content and skeleton removal happen atomically from an observer
   perspective
4. Tool indicator rendering stays in the quiet metadata region
5. Footer source line collapses correctly on `done`
6. Transport error replaces the pending answer with the stronger banner
7. Tool-level recoverable failure uses the softer treatment
8. Reduced-motion mode disables skeleton animation
9. Stream controller closes old `EventSource` when the slot is replaced

### Required layout tests

1. Chat form ships HTMX wiring and CSRF headers together
2. Pending answer shell exposes the required stream target nodes
3. First-turn shell carries the pushed conversation URL

### Existing SQR-7 regression coverage to keep green

- ownership checks
- idempotent first-turn create semantics
- generic failure handling for non-streaming fallback path

## Implementation Order

1. Add this plan doc and keep it authoritative
2. Add locally served HTMX asset through the asset pipeline
3. Add pending-shell render path to the layout layer
4. Add HTMX submit behavior to the chat form
5. Add streaming entrypoints to the conversation layer while keeping the
   synchronous path intact
6. Widen internal emit payloads in `ask()` / `runAgentLoop()` as needed for
   conversation-layer translation
7. Add the turn-scoped SSE route
8. Add the `squire.js` stream controller
9. Add styling for skeleton and tool-status metadata
10. Add server and DOM tests
11. Verify non-HTMX fallback still works

## Not In Scope But Worth Tracking

- reconnect semantics for dropped streams
- richer structured citation metadata if the first pass only has display-ready
  payloads
- browser E2E coverage once the DOM contract stabilizes

## Review Outcome Captured Here

This file intentionally consolidates the design and engineering decisions that
were previously split across:

- the branch design artifact under `~/.gstack/projects/maz-org-squire/`
- the SQR-8 Linear ticket
- planning checkpoints under `~/.gstack/projects/maz-org-squire/checkpoints/`

Those artifacts remain useful as provenance. This file is the checked-in build
and test contract.
