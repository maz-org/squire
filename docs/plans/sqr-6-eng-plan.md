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

## Design Review Checkpoints

### Checkpoint 1

Selected prior-question state gets an explicit context label near the hero
question.

- show the label only when viewing an earlier question
- hide it on the latest/current turn
- do not use mechanism language like "reload"
- preferred copy: `EARLIER QUESTION`

Reason:

- tells the user they are looking at history without making the chip row carry
  all the meaning
- keeps the explanation where the eye already is, near the main question

### Checkpoint 2

The chip row is an explicit secondary region, not a loose strip of pills.

- render a heading: `Recent questions`
- render chips beneath that heading

Reason:

- makes the ledger hierarchy scannable
- preserves the chip row as lightweight history, not random controls

### Checkpoint 3

The currently viewed question is excluded from the chip row.

- if the user is viewing an earlier question, that question does not also
  appear as a chip
- the `EARLIER QUESTION` label near the hero question carries the state cue

Reason:

- avoids dead or redundant chip interactions
- keeps the secondary history row focused on other places the user can go next

### Checkpoint 4

Recent-question chips are ordered newest-to-oldest, left to right.

Reason:

- matches the meaning of `Recent questions`
- makes the most likely next destination the easiest one to reach

### Checkpoint 5

Finished answers must use one shared visual contract across all answer states.

- streamed-final answer
- persisted current conversation answer
- persisted selected prior-question answer

All three must render with the same answer presentation, not degraded variants.

Reason:

- prevents the SQR-89 class of bug where persisted answers feel rougher than
  the streamed result
- preserves trust by making the answer feel like the same artifact everywhere

### Checkpoint 6

Tool-status UI is a quiet transient status area, not an event log.

- at most one row per tool id
- rows deduplicate in place instead of accumulating
- each row stays legible as a distinct line item, never concatenated text noise
- streaming may show transient status, but the area should stay visually quiet
- when streaming ends, the tool-status area collapses to the final clean state

Reason:

- matches the intended feel that the user notices reassurance, not mechanics
- prevents the SQR-90 class of bug where duplicate rows become noisy enough to
  feel like a separate interface

### Checkpoint 7

Earlier selected answers remain first-class answers.

- selected prior-question answers use the same answer presentation as current
  answers
- the only historical cue is the subtle `EARLIER QUESTION` label near the hero
  question
- do not add dimming, stale-state badges, or reduced-emphasis chrome

Reason:

- keeps historical answers trustworthy and readable
- avoids making an earlier answer feel like a degraded or archival mode

### Checkpoint 8

Hide the entire `Recent questions` region when there are no eligible prior
questions.

Reason:

- avoids empty-section chrome
- keeps the screen focused on the current ledger surface when history does not
  yet exist

### Checkpoint 9

Chip taps are framed as revisiting an earlier ruling.

- copy and motion should support recall, not "reload" mechanics
- the interaction should feel like quickly returning to something already asked
- avoid language that suggests a broken refresh, hard navigation, or technical
  restore flow

Reason:

- matches the user mental model at the table
- keeps the ledger experience focused on finding the ruling again, not on how
  the page transport works

### Checkpoint 10

Asking a new question from an earlier-question view should feel like continuing
the same conversation naturally from the revisited context.

Reason:

- avoids the feeling of branching into a separate timeline
- aligns the product feel with the technical requirement that follow-ups remain
  in the same conversation

### Checkpoint 11

Future overflow history must extend the ledger model, not replace it with a
transcript-manager experience.

Reason:

- preserves the calm "revisit an earlier ruling" feel as history grows
- prevents the eventual SQR-92 overflow solution from accidentally turning
  Squire into a general chat workspace

### Checkpoint 12

Support copy on the ledger surface stays minimal, but never cryptic.

- prefer short labels over helper sentences
- avoid instructional prose unless the user is actually blocked
- optimize for immediate comprehension by a new user, not just for repeat use

Reason:

- protects the surface from generic AI-app explanatory clutter
- keeps the page fast to scan without making it harder for a first-time user
  to understand

### Checkpoint 13

User-facing ledger copy must avoid mechanism language.

- ban labels and helper copy like `reload`, `restore`, `thread`, `message view`
  and similar implementation-oriented wording
- prefer plain user language that describes the outcome instead of the transport

Reason:

- keeps the product from sounding like developer tooling
- reinforces the ledger metaphor instead of exposing internal mechanics

### Checkpoint 14

The selected-state cue remains one small text label near the hero question.

- no additional badge cluster
- no extra pills near the hero
- no dashboard-style selected-state chrome

Reason:

- preserves the quiet ledger feel of the surface
- prevents clarity fixes from turning into generic app chrome

### Checkpoint 15

The `DESIGN.md` guidance of two to three recent-question chips describes the
intended visual rhythm for Phase 1, not a hard maximum history count.

Reason:

- keeps the implementation aligned with the approved visual target
- avoids accidentally turning a design cue into a product limitation before
  SQR-92 handles overflow explicitly

### Checkpoint 16

The wax-seal treatment is the actual submit button and must be explicitly
labeled `Ask`.

- do not make the seal a decorative icon users must interpret
- the button should read as the primary ask action immediately

Reason:

- preserves the approved visual character without sacrificing first-use
  comprehension
- turns a strong visual motif into a clear control instead of ambiguous chrome

### Checkpoint 17

`Recent questions` is a normal labeled navigation region with standard
interactive elements.

- use natural tab order
- use standard button or link semantics
- do not invent a custom keyboard interaction model for the chip row

Reason:

- keeps the history affordance accessible without adding unnecessary widget
  complexity
- makes future overflow work easier to extend cleanly

### Checkpoint 18

The input field may stay visually minimal, but it still needs explicit
accessibility and gentle first-use guidance.

- a blank visible field is acceptable if the control remains clearly related to
  the `Ask` action and has an explicit accessible label
- if a visible placeholder or other guidance is needed, it should stay simple
  and in-mood, for example `Ask a question...`
- avoid guidance text that breaks the mood or sounds like technical/manual
  tooling, for example references to rulebooks, engines, or lookup mechanics

Reason:

- preserves the quiet visual direction without sacrificing clarity
- protects the input from drifting into awkward explanatory product copy

### Checkpoint 19

Final selected-state label copy: `EARLIER QUESTION`.

Reason:

- shortest and clearest wording for fast phone scanning
- preserves the subtle cue without adding extra explanation

### Checkpoint 20

Input guidance defaults to no visible placeholder, but a minimal fallback is
allowed if implementation testing shows first-use clarity needs it.

- acceptable fallback copy: `Ask a question...`
- do not require a visible placeholder unless the blank field proves too opaque

Reason:

- preserves the cleaner visual direction you preferred
- keeps room for a small usability correction without reopening the whole input
  design

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

## Existing UI Assets

- [`DESIGN.md`](../DESIGN.md) already defines the ledger metaphor, type system,
  color tokens, chip vocabulary, and input-dock character.
- [`docs/adr/0010-current-turn-ledger.md`](../adr/0010-current-turn-ledger.md)
  already locks the one-current-turn surface model.
- [`src/web-ui/layout.ts`](../../src/web-ui/layout.ts) already provides the
  ledger shell, `#squire-surface`, `nav.squire-recent`, input dock, and error
  banner primitives.
- [`src/web-ui/squire.js`](../../src/web-ui/squire.js) already owns the
  follow-up retargeting and streaming-state client behavior.
- [`src/web-ui/styles.css`](../../src/web-ui/styles.css) already contains the
  established answer, chip, footer, and input styling primitives that the
  reviewed plan should extend rather than replace.

## Approved Mockups

Approved direction notes:

- use variant B as the base
- keep the wax-seal submit treatment, but make it the explicit `Ask` button
- remove `tap to reload` style wording from the UI
- keep the chip region visually separate from the current answer
- default to no visible placeholder, but allow `Ask a question...` if
  implementation testing shows first-use clarity needs it

Note:

- the mockup artifacts used during review live in repo-local `.gstack/`, which
  is intentionally gitignored and not a durable cross-clone reference
- the durable source of truth is the approved direction summarized here plus the
  checkpointed decisions above

## Design Review Summary

+====================================================================+
| DESIGN PLAN REVIEW — COMPLETION SUMMARY |
+====================================================================+
| System Audit | DESIGN.md present, real UI scope, parent |
| | ticket was stale vs refreshed plan |
| Step 0 | 6/10 initial score, full 7-pass review |
| Pass 1 (Info Arch) | 6/10 -> 9/10 |
| Pass 2 (States) | 5/10 -> 10/10 |
| Pass 3 (Journey) | 6/10 -> 10/10 |
| Pass 4 (AI Slop) | 7/10 -> 10/10 |
| Pass 5 (Design Sys) | 8/10 -> 10/10 |
| Pass 6 (Responsive) | 7/10 -> 10/10 |
| Pass 7 (Decisions) | 2 unresolved -> 0 unresolved |
+--------------------------------------------------------------------+
| NOT in scope | written |
| What already exists | written |
| Approved Mockups | generated, reviewed, direction approved |
| Decisions made | 20 checkpoints added to plan |
| Decisions deferred | overflow UX remains in SQR-92 |
| Overall design score | 6/10 -> 9.5/10 |
+====================================================================+

Design review verdict: PLAN IS DESIGN-COMPLETE FOR SQR-6 EXECUTION.

The remaining work is implementation and QA, not more design discovery. The
main follow-on risk is ticket drift, which was addressed by updating `SQR-6`,
`SQR-89`, `SQR-90`, `SQR-92`, `SQR-93`, and `SQR-94` to match this plan.
