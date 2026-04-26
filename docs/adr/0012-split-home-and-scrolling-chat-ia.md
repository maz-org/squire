---
type: ADR
id: '0012'
title: 'Split authenticated home + scrolling-chat IA (supersedes 0010)'
status: active
supersedes: '0010'
date: 2026-04-22
---

## Context

[ADR 0010](0010-current-turn-ledger.md) committed Phase 1 to a
current-turn ledger model: one question and answer visible at a time in
`main.squire-surface`, with prior turns collapsing into a Recent
questions chip row and tapping a chip loading a selected-message surface
at `/chat/:id/messages/:mid`. The signature DESIGN.md details (drop cap,
rule-term highlighter) stayed rare by virtue of appearing only on the
current turn.

SQR-101 surfaced lived-use problems with that model:

- The authenticated home page shipped hardcoded placeholder chips
  (`Looting`, `Element infusion`, `Negative scenario effects`) plus
  pure-visual stubs (Squire-recommends verdict block, PICKED badge,
  spoiler banner) before any real conversation existed. The home page
  looked populated with fake data.
- A conversation with one completed question had no history affordance
  at all. After two, a conversation-local chip row appeared with no
  prior explanation of the mental model.
- Tapping a chip landed on a selected-message surface that did not feel
  clearly rooted in the conversation it came from.
- The desktop left rail held only a wordmark + monogram — a Phase 4+
  scaffolding placeholder showing up in Phase 1 product.

ADR 0010's own "trigger for re-evaluation" list named user-scroll
behavior and Phase 4/5 side-by-side needs as signals. Neither fired.
What fired instead was a product-level observation: the ledger IA is not
teaching itself well, and the "peer modes in `main.squire-surface`"
payoff for Phase 4/5 was speculative from the start — those phases can
render equally well as side panels or modals over a scrolling chat.

## Decision

**Phase 1 splits the authenticated home and the conversation page into
two different information architectures.**

- **Authenticated home** (`GET /`) becomes a purpose-built landing: a
  single composed "At your service." Fraunces hero, a `ASK ABOUT A RULE,
CARD, ITEM, MONSTER, OR SCENARIO` sepia small-caps scope line, and
  the input dock. No chip row. No verdict, PICKED, or spoiler-banner
  stubs. No chat chrome beyond the header + input dock. The input dock
  still owns `POST /chat`, idempotency, HTMX swap to the first pending
  transcript, SSE kickoff, and the URL push to `/chat/:id` — "static"
  describes the rendered template, not the submit contract.
- **Conversation page** (`GET /chat/:id`) becomes a standard scrolling
  chat transcript. Past turns stack oldest-to-newest top to bottom, newest
  at the bottom. The drop cap (`::first-letter` on `.squire-answer`)
  appears on the newest completed answer only — preserving drop-cap
  rarity via position, not via IA invention. The rule-term highlighter
  stays on every answer; it marks rule references, not currency.
- **Chip row and selected-message surface are deleted.** `/chat/:id/messages/:mid`
  301-redirects to `/chat/:id`. The selected-message projection,
  rendering helpers, and OOB chip-nav patching in `squire.js` all go.
- **Desktop rail collapses entirely in Phase 1.** No `.squire-rail`
  markup rendered on desktop. Returns in Phase 4 when there is real
  character/party content to place there.
- **SSE contract changes.** The `done` event drops its
  `recentQuestionsNavHtml` field. Follow-up submits use an append-fragment
  swap: the server returns just the new pending turn, and the client
  appends it to `.squire-transcript` via `hx-swap="beforeend"` instead
  of replacing the whole surface.
- **`role="log" aria-live="polite"` on the transcript**, with a permanent
  pending-turn slot in the DOM at page load and `aria-busy` wrapping the
  final `done.html` swap to suppress the double-announce of streamed
  plaintext vs final HTML. Verified empirically against VoiceOver iOS
  Safari during PR 2 QA; if `aria-busy` is honored poorly on that engine,
  the reviewer escalates for an alternate approach (e.g. clearing the
  pending plaintext before the HTML swap).

## Options considered

- **Option A — hold ADR 0010, fix home-page symptoms only.** Delete the
  fake chips and visual stubs on the authenticated home empty state;
  leave everything else alone. Minimum diff. Leaves three of four
  SQR-101 concerns unaddressed (one-turn has no history, chip row appears
  without explanation, selected-message surface still feels orphaned,
  desktop rail still reads as scaffolding). Rejected — insufficient.
- **Option B — keep the ledger core, clean chrome, add a first-turn cue
  and clearer labeling.** Hide the chip row until real history exists;
  relabel it `Earlier in this conversation`; add a micro-hint next to the
  input introducing the affordance; decide desktop rail independently.
  Preserves ADR 0010's signature posture while addressing the observable
  issues. Rejected — still leaves users meeting a novel IA that has to
  be learned.
- **Option C — pivot to a single standard scrolling chat transcript
  everywhere**, including the authenticated home as the zero-message
  state. Drop cap policy needs a new rule (position-based). Simplest
  code, one surface. Rejected — makes the home page the empty state of
  a conversation, which loses the composed "At your service" landing
  moment.
- **Option D (chosen) — split home and conversation IAs.** Home gets a
  purpose-built landing; conversation becomes scrolling chat; drop cap
  rarity preserved via position rather than via IA invention. Accepts
  the Phase 4/5 re-decision cost (those phases now render as side panels
  / modals / their own routes, not as peer modes in the main surface).

## Consequences

**Easier:**

- Users meet a standard ChatGPT-shaped conversation surface. Zero
  onboarding for the conversation IA.
- The authenticated home page stops lying about its own state. No fake
  chips, no fake verdict, no fake PICKED badge.
- The drop cap stays rare (newest answer only, enforced by CSS selector
  position instead of "only one turn is ever visible").
- The SSE contract simplifies: no more OOB chip-nav patching on the
  `done` event.
- `src/web-ui/layout.ts` loses six helpers and all the
  `WithRecentQuestions` variants. `src/chat/conversation-service.ts`
  loses the selected-message projection path.

**Harder:**

- Phase 4 character state and Phase 5 card comparison need a new
  rendering home. Options include a desktop side panel, a mobile modal,
  or their own routes. ADR 0010's "peer modes in `main.squire-surface`"
  bet is off the table.
- Deep-link-to-a-specific-turn goes away. `/chat/:id/messages/:mid`
  301-redirects forever; Phase 6 cross-device sync would have to design
  a fresh URL shape if this ever comes back.
- Accessibility on a streaming scrolling transcript is harder than on a
  one-turn surface. The `role="log"` + permanent pending slot +
  `aria-busy` pattern mitigates; empirical VoiceOver iOS QA is required.

**Trigger for re-evaluation:**

- Phase 4 or Phase 5 design work concludes that in-surface peer modes
  are genuinely the best shape — in which case Option D is wrong and we
  need yet another revisit.
- VoiceOver iOS empirical QA reveals the `aria-busy` pattern is
  unworkable on Squire's target phone-at-the-table use case.
- User research (multi-user, Phase 3+) shows the scrolling-chat
  transcript overwhelms new users on long sessions.

## Advice

- **CEO review** (2026-04-22, former staging plan doc deleted after SQR-109)
  surfaced Option D as a fourth option the original spec missed. User
  selected via AskUserQuestion with ASCII preview.
- **Design review** (2026-04-22, same staging plan) walked each downstream
  design decision with the user one at a time: drop cap placement,
  highlighter scope, scroll behavior, drop-cap transition, aria-live
  pattern, desktop rail fate, no-card-shell enforcement, home visual
  weight. All 8 decisions locked via AskUserQuestion.
- **Eng review** (2026-04-22, same staging plan) walked the remaining
  architectural decisions: redirect status code, PR split, swap
  contract. All 3 locked via AskUserQuestion.
- **Codex outside-voice challenge** (gpt-5.4, high reasoning, 2026-04-22)
  produced 7 findings. Finding #1 argued Option D was an aesthetic split
  and Option C was simpler; user rejected and kept D. Findings #2–#7
  folded into the plan (corrected "home is static" claim, added
  swap-contract and SSE_CONTRACT.md update to scope, corrected
  sequencing so ledger-era Linear tickets close after the replacement PR
  ships rather than now, reframed redirect as HTTP semantics rather than
  taste).
- **First revision of design + eng review output was over-auto-decided
  by Claude.** User pulled 13 decisions back as taste / product calls
  and walked each via AskUserQuestion one at a time. The current
  decision set reflects that explicit walk, not Claude's first pass.
