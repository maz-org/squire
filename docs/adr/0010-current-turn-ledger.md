---
type: ADR
id: '0010'
title: 'Current-turn ledger for multi-turn chat surface'
status: superseded
superseded_by: '0012'
date: 2026-04-08
---

## Context

[DESIGN.md](../../DESIGN.md) §Layout says the main surface is "a ledger page,
not a chat column with bubbles." That rules out a scrolling message list but
doesn't say what IS on screen when Brian asks a second question in the same
session. Without a specific pattern, the Phase 1 chat tickets (SQR-6, SQR-8)
drifted toward chat-column vocabulary ("message list region," "assistant
bubble," `#msg-{id}`), creating a contradiction with DESIGN.md that surfaced
during the Web UI plan-design-review (2026-04-08).

The deeper problem: the drop cap, the rule-term highlighter, and the "this is
a treasured reference book" feeling all lose impact if they repeat on every
turn. DESIGN.md §Drop cap even warns: "do not overuse." A naive message list
multiplies the signature detail by turn count and cheapens it.

Phases 4 (character state) and 5 (card comparison) also render into the same
`main.squire-surface` region and need to know whether they inherit a
scrolling-history model or a single-mode model.

## Decision

**The main surface shows one turn at a time. Prior turns collapse into the
recent-questions chip row.** The drop cap and rule-term highlighter appear
exclusively on the current answer. A current turn is: user question rendered
as a Fraunces hero (22–28px, per DESIGN.md Typography "Hero question"), current
answer rendered below it with drop cap + rule-term highlighters + inline
citations + tool-call footer. When the user asks a new question, the prior
turn's question becomes a chip in `nav.squire-recent`; tapping the chip
re-loads that turn into the current-turn slot (and it then gets the signature
treatment because it IS the current turn).

Naming hygiene: "current-question" and "current-answer" slots; never "bubble"
or "message list."

## Options considered

- **Option A (chosen): Current-turn focus.** One turn visible at a time. Prior
  turns as chips. Drop cap stays precious. Honors DESIGN.md. Matches Brian's
  actual use (one rule at a time under time pressure, not a threaded
  conversation). Forces Phase 4/5 to think in "modes" (character sheet mode,
  card comparison mode), which is the companion-first posture DESIGN.md
  already intended.
- **Option B: Scrolling ledger.** Every turn stacks vertically as a dated
  entry. Only the most recent answer gets the drop cap; older answers render
  flat. Closer to a chat history. Works but lets the main surface grow
  unbounded, puts the user in "scroll up to find prior answer" mode, and
  makes Phase 4/5 modes awkward.
- **Option C: Chat column with Squire polish.** Accept that multi-turn IS a
  chat column. Drop the "not a chat column" rule, apply the drop cap and
  highlighter to every turn. Simplest implementation, but defeats a core
  DESIGN.md decision and dilutes the signature detail.

## Consequences

**Easier:**

- The drop cap and rule-term highlighter stay rare and load-bearing.
- Phase 4 character-state views and Phase 5 card-comparison views drop into
  `main.squire-surface` as peer modes, not "stuff bolted onto a chat
  history."
- `nav.squire-recent` (the chip row) gains a real Phase 1 job — previously it
  was an empty stub.
- Tickets gain naming hygiene: code searches for `bubble` or `message-list`
  in `src/web-ui/` should return zero results (SQR-5 AC).

**Harder:**

- "Scroll up to re-read the previous answer" is not the affordance — users
  tap a chip instead. A user coming from ChatGPT habits might initially
  expect scroll. Mitigation: the chip row is persistent and visible; the
  affordance is discoverable within one turn.
- Multi-turn context compaction (Phase 3, SQR-12) still has to send prior
  turns to the knowledge agent even though they're not visible on screen.
  This is fine — conversation history ≠ display history — but it's a
  distinction implementers must hold.

**Trigger for re-evaluation:**

- User research showing Brian repeatedly scrolls on the chip row looking for
  an older answer (suggesting the chip model is too lossy).
- Phase 4 or Phase 5 finds they genuinely need multiple turns visible
  simultaneously (e.g., comparing two prior answers side by side).
- The session history grows long enough that the chip row can't hold all
  prior turns — at which point the overflow affordance (drawer? more chips?)
  becomes a new question.

## Advice

- **Web UI plan-design-review** (2026-04-08, `docs/plans/web-ui-f4481c1cff1d-design-review-walkthrough.md`)
  surfaced the ledger-vs-bubble contradiction as Pass 1's biggest gap. User
  chose Option A over B and C.
- **Web UI plan-eng-review** (2026-04-08, same day,
  `docs/plans/web-ui-f4481c1cff1d-eng-review-walkthrough.md`) predated this
  decision and assumed a "visible message list" AC that is now obsolete
  (noted at the top of the eng walkthrough).
- **DESIGN.md Decisions Log v0.4** (2026-04-08) records this decision
  alongside the other design-review outputs. This ADR is the durable
  single-topic record; DESIGN.md is the chronological log.
