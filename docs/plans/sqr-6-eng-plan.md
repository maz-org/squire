# SQR-6 Eng Plan

## Scope

Linear issue: `SQR-6`  
Target branch: `bcm/sqr-6-chat-ui-component-with-htmx`

Goal: finish the remaining Phase 1 ledger behavior for the web chat UI without
rebuilding pre-streaming scaffolding that SQR-8 and SQR-61 already shipped.

This plan intentionally narrows SQR-6 to the still-missing user outcome:

1. Recent-question chips are populated from completed prior questions.
2. Tapping a chip reloads that selected prior question + answer into the
   current ledger surface.
3. The selected prior message gets a real canonical URL.
4. Asking a follow-up from that selected-message URL still continues the same
   conversation.

Execution split agreed after review:

- `SQR-93` owns lane A, server/conversation work
- `SQR-94` owns lane B, web UI/rendering work
- `SQR-6` remains the umbrella issue for final integration and verification

## Current State

Relevant shipped codepaths today:

- [`src/server.ts`](../../src/server.ts)
  already owns:
  - `GET /chat/:conversationId`
  - `POST /chat`
  - `POST /chat/:conversationId/messages`
  - `GET /chat/:conversationId/messages/:messageId/stream`
- [`src/chat/conversation-service.ts`](../../src/chat/conversation-service.ts)
  already owns conversation loading, ownership checks, pending-turn creation,
  and message-level lookup for the SSE stream.
- [`src/web-ui/layout.ts`](../../src/web-ui/layout.ts)
  already owns the ledger surface, pending shell, transcript rendering, and the
  `nav.squire-recent` placeholder region.
- [`src/web-ui/squire.js`](../../src/web-ui/squire.js)
  already owns HTMX follow-up retargeting, pending-state handling, and SSE
  lifecycle wiring.
- [`docs/adr/0010-current-turn-ledger.md`](../adr/0010-current-turn-ledger.md)
  already locked the display model: one visible ledger turn at a time, prior
  questions collapse into chips.

What this means:

- The repo already has the real chat shell.
- The repo already has the real streaming path.
- The repo already has the real sanitization boundary.
- SQR-6 should not recreate an older "static-response-first" version of chat.

## Step 0

### What already exists

- Canonical conversation page: `GET /chat/:conversationId`
- Persisted conversation storage and ownership checks
- Pending shell rendering and SSE stream attachment
- Stable `#squire-surface` target and `nav.squire-recent` container
- HTMX submit flow for first turn and follow-ups

### Minimum change that solves the real problem

- Add a selected-message page state.
- Add a conversation-shaped projection for:
  - selected question + answer
  - prior completed questions for chips
- Update the chip row immediately on HTMX responses.
- Extend client follow-up retargeting so selected-message URLs still submit to
  the correct conversation follow-up endpoint.

### Scope reduction decision

Do **not** implement the Linear ticket literally as if SQR-8 and SQR-61 did not
already exist. SQR-6 is now the missing prior-turn navigation layer on top of
the shipped ledger + streaming architecture.

## Decisions

### Decision 1

Selected prior state gets a canonical URL:

`/chat/:conversationId/messages/:messageId`

Where `messageId` is the selected **user** message.

Reason:

- keeps refresh/back/share behavior honest
- matches the existing message-level ownership model in the repo
- uses `message` naming, not `turn`, because the stable selector in code is a
  user message id

### Decision 2

The conversation layer returns a turn-shaped view model, not raw `messages[]`
for the template to reconstruct.

Reason:

- the page wants "selected message pair + chip list", not a flat transcript
- keeps selection/chip rules in one place
- avoids duplicating pairing/filtering logic in route handlers and templates

### Decision 3

HTMX keeps `hx-target="#squire-surface"`. The chip row is updated with
out-of-band HTML in the same response.

Reason:

- smallest diff against the current page structure
- avoids widening swap targets to oversized wrappers
- keeps `main.squire-surface` as the primary update zone

### Decision 4

Use the canonical selected-message route for both full-page and HTMX requests.

- normal request: full HTML page
- HTMX request: `#squire-surface` fragment + OOB `nav.squire-recent`

Branching on `HX-Request` is acceptable and idiomatic here.

Reason:

- one URL owns one piece of state
- avoids fragment-only side routes that drift from page rendering
- keeps full-page and partial rendering in sync

### Decision 5

Keep the current light client form-retargeting approach in
[`src/web-ui/squire.js`](../../src/web-ui/squire.js), but extend it to
recognize both:

- `/chat/:conversationId`
- `/chat/:conversationId/messages/:messageId`

Reason:

- minimal diff
- fixes the regression where a follow-up from a selected-message URL would
  otherwise post back to `/chat` and start a new conversation

## Architecture Review

### Locked architecture

The selected-message experience should be built as a thin extension of the
existing architecture:

1. Add canonical selected-message page route:
   - `GET /chat/:conversationId/messages/:messageId`
2. Add a conversation projection that returns:
   - selected completed message pair
   - recent-chip list
   - any metadata needed to preserve ordering
3. Reuse the existing layout shell and ledger primitives:
   - `main.squire-surface`
   - `nav.squire-recent`
4. Reuse the existing follow-up POST route:
   - `POST /chat/:conversationId/messages`
5. Leave the existing SSE route as-is:
   - `GET /chat/:conversationId/messages/:messageId/stream`

### Failure scenarios to account for

- selected message belongs to another user → 404
- selected message is an assistant message → 404
- selected message belongs to a different conversation → 404
- HTMX selected-message response updates the surface but not the chip row →
  stale UI until reload
- follow-up submit from selected-message URL posts to `/chat` → accidental new
  conversation

## Code Quality Review

No broad structural issue found. The good plan here is the boring one:

- extend the existing route tree
- extend the existing conversation service
- extend the existing layout rendering helpers
- extend the existing small JS island

Avoid:

- fragment-only duplicate endpoints
- raw transcript re-pairing in the template
- extra client-side state containers
- route-sprawl for one selected-state variant

## Test Review

### Required coverage

#### Route coverage

- `GET /chat/:conversationId/messages/:messageId`
  - owner gets 200 full page
  - HTMX request gets fragment response
  - foreign user gets 404
  - assistant message id gets 404
  - mismatched conversation/message ids get 404

#### Rendering coverage

- selected question + answer render as the current ledger surface
- recent-chip row excludes the currently selected message
- recent-chip ordering is stable and matches the intended chronology
- HTMX fragment includes OOB update for `nav.squire-recent`

#### Client regression coverage

- when browser URL is `/chat/:conversationId/messages/:messageId`, follow-up
  submit still posts to `/chat/:conversationId/messages`

This is a **mandatory regression test**.

#### Boundary coverage

- single completed turn yields no prior chip
- selecting the oldest completed question works
- selecting the newest completed question works
- pending current turn does not appear as a prior chip prematurely

## Performance Review

No major performance blocker found.

Expected cost profile:

- selected-message page is one extra conversation-scoped read path
- chip-row projection is cheap at Phase 1 conversation sizes
- OOB chip updates add tiny HTML overhead, not meaningful compute cost

Guardrail:

- do not introduce per-chip or per-message follow-up queries from the template
- the conversation projection should gather the selected state and chip state in
  one server-side pass

## Worktree Parallelization Strategy

### Dependency table

| Step                                                | Modules touched                       | Depends on                                         |
| --------------------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| Add selected-message projection                     | `src/chat/`, `src/db/repositories/`   | —                                                  |
| Add selected-message page + HTMX route behavior     | `src/server.ts`                       | selected-message projection                        |
| Add selected-surface + OOB chip rendering helpers   | `src/web-ui/`                         | selected-message projection                        |
| Add follow-up retargeting for selected-message URLs | `src/web-ui/`                         | selected-message page shape                        |
| Add route/integration coverage                      | `test/`, `src/server.ts`, `src/chat/` | selected-message projection, selected-message page |
| Add layout/JS regression coverage                   | `test/`, `src/web-ui/`                | selected rendering helpers, retargeting change     |

### Parallel lanes

- Lane A: selected-message projection → selected-message page route → route/integration tests
  sequential, shared `src/chat/` and `src/server.ts`
- Lane B: selected-surface rendering helpers → JS retargeting update → layout/JS tests
  sequential, shared `src/web-ui/`

Linear mapping:

- Lane A → `SQR-93`
- Lane B → `SQR-94`
- integration + full verification → `SQR-6`

### Execution order

- Launch Lane A and Lane B in parallel worktrees after the route and URL shape are already locked.
- Merge Lane A first, because Lane B’s client behavior depends on the selected-message URL shape staying stable.
- Rebase or merge Lane B onto the result locally before final verification.
- Run the full route + layout + browser-JS regression set only after both lanes land together.

### Conflict flags

- Lane A and Lane B both depend on the selected-message URL contract, but only Lane A should edit route ownership in `src/server.ts`.
- Lane B must avoid opportunistic edits to `src/server.ts` or `src/chat/`; keep it constrained to `src/web-ui/` and its tests.
- Tests can conflict if both lanes edit `test/conversation.test.ts`. Best split:
  - Lane A owns `test/conversation.test.ts`
  - Lane B owns `test/web-ui-layout.test.ts` plus any JS-focused regression test file

## NOT in Scope

- Rebuilding the original non-streaming chat shell
- Changing the ledger metaphor back into a scrolling transcript
- Touching the SSE event contract
- Reworking sanitization or CSP behavior from SQR-61
- Adding overflow management for very long chip histories
- Introducing a drawer, modal, or second navigation surface for prior turns

## Implementation Shape

1. Add a selected-message projection in
   [`src/chat/conversation-service.ts`](../../src/chat/conversation-service.ts).
2. Add canonical selected-message route handling in
   [`src/server.ts`](../../src/server.ts).
3. Add layout helpers in [`src/web-ui/layout.ts`](../../src/web-ui/layout.ts)
   for:
   - selected surface render
   - OOB chip row render
4. Extend [`src/web-ui/squire.js`](../../src/web-ui/squire.js) follow-up action
   sync for selected-message URLs.
5. Add route, layout, and JS regression tests.

## Verdict

Eng review verdict: CLEAR WITH REQUIRED TEST SHAPE

This should land as a lean extension to the shipped ledger chat architecture,
not as a second chat system.
