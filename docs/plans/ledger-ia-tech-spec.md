# Ledger IA premise review — Tech Spec

**Primary issue:** `SQR-101` — Re-evaluate current-turn ledger IA versus a standard AI chat transcript
**Consequence issue:** `SQR-95` — Revisit authenticated home-page placeholder recent-question chips (child of SQR-101)
**Produced by:** planning cycle on 2026-04-22
**Expected reviews:** `/plan-ceo-review` (done 2026-04-22), `/plan-design-review`, `/plan-eng-review`
**CEO-review outcome:** SELECTIVE EXPANSION mode. Option D selected — split authenticated home and conversation IAs. Supersedes ADR 0010.
**Companion docs (read first):** [DESIGN.md](../../DESIGN.md) §Layout, [ADR 0010 Current-turn ledger](../adr/0010-current-turn-ledger.md), [docs/ARCHITECTURE.md](../ARCHITECTURE.md)
**Expected permanent output:** a new ADR (superseding or narrowing ADR 0010) + possibly a DESIGN.md decisions-log update. This plan doc is staging; it gets deleted post-merge per [planning-artifacts.md](../agent/planning-artifacts.md).

---

## Why this spec exists

SQR-95 as filed is narrow: "delete or rework the fake `Looting` / `Element infusion` chips on the authenticated home empty state." Every concrete answer to SQR-95 is downstream of a bigger premise question:

**Is the current-turn ledger IA (ADR 0010) still the right Phase 1 bet, or should Squire present as a conventional AI chat transcript until campaign/character state creates a real reason to diverge?**

SQR-101 is that bigger question, and it explicitly claims SQR-95 as one of its downstream outputs ("which existing follow-up bugs or tickets become obsolete, absorbed, or newly required"). Planning SQR-95 in isolation inverts the dependency graph.

This spec frames the premise question first, picks a tentative direction, and walks through what each option implies for SQR-95 specifically plus the other ledger-era work already on the floor.

---

## Lived evidence motivating the revisit

From SQR-101 and manual QA on the Phase 1 UI:

1. **Pre-history home page lies.** The authenticated home empty state ships three hardcoded placeholder chips (`Looting`, `Element infusion`, `Negative scenario effects`) before any real conversation exists. Earlier work stopped them acting like live links; the fake labels remain. Also on the same empty state: a spoiler banner, a "Squire recommends" verdict block, and a `PICKED` badge — all pure-visual fixtures for Phases 5/6 features. The home page looks populated without any of it being real.
2. **One-turn conversation has no history at all.** After a user asks one question, there's nothing in the recent-questions region. After two, a conversation-local chip row suddenly appears with no prior explanation of the mental model.
3. **Chip-tap destination feels orphaned.** Tapping a chip lands on `/chat/:id/messages/:mid` — a selected-message surface that doesn't feel rooted in the conversation it came from. The `EARLIER QUESTION` eyebrow is the only cue.
4. **Desktop rail reads as scaffolding.** Phase 1 leaves the left rail holding only the wordmark + monogram. It's a Phase 4+ placeholder showing up in Phase 1 product.
5. **The model is load-bearing on ADR 0010's own triggers.** ADR 0010 lists three triggers for re-evaluation. Trigger #1 ("user repeatedly scrolls the chip row") hasn't fired, but the ticket author (the only current user) is reporting trigger-adjacent confusion rather than a clean match to trigger #1.

---

## Options considered

### Option A — Hold ADR 0010; fix symptoms only

Keep the current-turn ledger model. Address SQR-95 as a localized cleanup (delete the fake chips, decide what to do with the rest of the stub content on the empty state). Leave ADR 0010 intact.

**What changes in code:**

- `src/web-ui/layout.ts:551-559` — stop defaulting `recentQuestionsNav` to hardcoded static chips. Home page gets no chip region until there's real history.
- Optionally prune the other empty-state stubs (spoiler banner, verdict block, PICKED badge) from the pre-conversation surface. These are pinned in a hidden `<template id="squire-banner-fixtures">` already (layout.ts:534-543); the visible ones don't need to be visible.
- Home page gets a stronger "At your service" hero + scope-line moment, nothing that resembles data-backed UI.

**Pros:**

- Minimum disturbance to shipped work (ADR 0010, SQR-92 overflow drawer, SQR-93/94 selected-message machinery).
- Honors the "dissonance is the signature" DESIGN.md posture.
- Keeps Phase 4/5 modes dropping into `main.squire-surface` as peer modes, which is ADR 0010's forward-looking payoff.

**Cons:**

- Doesn't address SQR-101 items 2–4 (one-turn has no history; chip-row model appears without explanation; selected-message destination feels orphaned; empty desktop rail).
- Accepts that Squire's Phase 1 surface has a novel IA users meet without onboarding.

### Option B — Keep ledger core, remove pretense and clarify the model (selective narrowing)

Keep ADR 0010's "one turn visible at a time + drop cap rarity" as the main-surface contract. Narrow the scope of the chip row and surrounding chrome so everything on screen is either real or absent.

**What changes in code:**

- Delete all static fake chips. `recentQuestionsNav` only renders when there is real conversation history.
- Drop the verdict-block and PICKED-badge visual stubs from the authenticated empty state. They stay in `<template id="squire-banner-fixtures">` for QA/CSS tests, not in visible HTML.
- Home empty state becomes a single composed moment — hero + scope line + input dock, nothing else.
- Chip row becomes **conversation-local only** (which it already was in the data layer after SQR-93) and gets a clearer label. Consider `Earlier in this conversation` over `Recent questions` to eliminate the "is this cross-session history?" ambiguity.
- Desktop rail gets honest Phase 1 content (wordmark only; no Phase 4 scaffolding) OR collapses entirely in Phase 1 and returns in Phase 4.
- Add a minimal first-turn cue that previews the chip-row affordance (e.g. a one-line micro-hint next to the input that fades after first use). Low-cost, resolves the "model appears from nowhere on turn 2" confusion.
- Keep `/chat/:id/messages/:mid` selected-message route. Adjust chip-tap destination framing so `EARLIER QUESTION` reads as "earlier in THIS conversation," not as navigation to a separate page.

**Pros:**

- Fixes SQR-95 and all four lived-evidence items in SQR-101 without throwing away SQR-92/93/94's work.
- Preserves the signature design elements (drop cap rarity, one-turn focus, rule-term highlighter) that DESIGN.md is built around.
- Cheapest path to a home page that stops lying about its own state.

**Cons:**

- Still a novel IA. First-turn cue + clearer labeling is a mitigation, not a cure.
- Phase 4/5's "peer modes in main.squire-surface" bet still has to pay off later; this option doesn't de-risk it.

### Option C — Pivot to standard scrolling chat transcript (supersede ADR 0010)

Accept that Squire IS an AI chat product. Replace the current-turn model with a vertical scrolling transcript where every turn is visible, the newest is at the bottom, and there's no chip row. Drop cap appears only on the most recent answer (or every answer — design sub-decision). Desktop rail stays empty for Phase 1, returns in Phase 4.

**What changes in code:**

- Main surface renders the full message list, newest-last, auto-scroll.
- Delete chip row. Delete `/chat/:id/messages/:mid` selected-message route. Delete selected-message projection logic in `src/chat/` (lane A of SQR-93). Delete OOB chip-rendering in `src/web-ui/layout.ts` (lane B of SQR-94).
- Rework SQR-92 overflow drawer (already merged) — it becomes vestigial. Either scroll-up is the history, or we keep the drawer as a compacted-thread view for long sessions.
- Drop cap policy needs a new rule (only-on-last vs every-answer). DESIGN.md §Drop cap warns "do not overuse."
- Home-page empty state becomes a single "At your service" hero + input dock. No chip region. No selected-message affordance. No stubs.

**Pros:**

- Users arrive with ChatGPT-shaped mental models that already work. Zero onboarding cost.
- Obsoletes SQR-95 entirely — no chip row means no fake chips.
- Obsoletes SQR-92, SQR-93, SQR-94 as "ledger-era" work (their artifacts shipped; they just stop being load-bearing).

**Cons:**

- Supersedes ADR 0010 — wastes sunk work on SQR-92 overflow drawer, SQR-93 projection, SQR-94 rendering helpers. Net delete, which per [feedback_avoid_load_bearing] is fine if the direction is right, but it's still throwing away working code.
- Loses DESIGN.md's signature posture. The drop cap + "not a chat column" identity erodes. The ledger metaphor survives in visual tokens (parchment, wax seal, serif display) but becomes aesthetic-only.
- Forces a re-decision on Phase 4/5 rendering. Character sheet and card-comparison stop being "peer modes in the main surface" and become… sub-pages? Modal overlays? Needs a new answer.
- Medium-bet move that should be made deliberately, not to fix three symptoms on a single page.

---

## Chosen direction — Option D (added by CEO review)

CEO review surfaced a fourth option the original framing missed: **split home and conversation IAs**.

SQR-101's observed issues split cleanly into two piles. Pile 1 is home-page-specific (fake chips, verdict / PICKED stubs, visual pretense before any real history). Pile 2 is conversation-page-specific (one-turn has no history, chip row appears from nowhere on turn 2, `/messages/:mid` feels orphaned). The home page is a landing; the conversation page is a chat. They don't need the same IA.

**Option D — Authenticated home becomes a purpose-built landing** (no chip row, no stubs, no chat chrome — just hero + scope line + input dock). Home is **not static**: the input dock still owns `POST /chat`, idempotency, HTMX swap, pending-shell rendering, SSE kickoff, and the push into `/chat/:id`. "Purpose-built" describes the rendered template, not the submit contract. **Conversation page becomes standard scrolling chat transcript** (newest at bottom, drop cap only on newest answer, no chip row, `/messages/:mid` handled per E-1, ADR 0010 superseded).

The **landing → first pending transcript** transition is the non-trivial piece. Current behavior (home POST /chat → returns HTML fragment swapped into `#squire-surface` → pushes URL to `/chat/:id` via HTMX) mostly carries over, but the swapped-in fragment goes from a "current turn replaces surface" shape to a "pending transcript with one Q/A" shape. See E-3 for the swap-contract decision.

**Why D over B:** Option B fixes the chrome dishonesty but leaves the novel IA users have to learn. Option D preserves drop cap rarity via _position_ (only the newest answer gets it) rather than via IA invention, which is a cheaper mechanism for the same payoff. It also stops reasoning forward from undecided Phase 4/5 state — peer-mode main surface was ADR 0010's speculative payoff, and Phase 4/5 rendering works equally well as side panels or modals over a scrolling chat.

**Why D over C:** C treats home and conversation as the same surface. The home page benefits from its own "At your service" composition; making it just the empty state of a chat loses that moment.

### Consequences of Option D

|                                           | Outcome                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| SQR-95 chip-row stubs                     | Absorbed. Chip row deleted entirely.                                                   |
| Empty-state verdict + PICKED stubs        | Absorbed. Deleted from visible HTML; stay in `<template id="squire-banner-fixtures">`. |
| Desktop rail (Phase 1)                    | Collapsed entirely. Returns in Phase 4.                                                |
| `/chat/:id/messages/:mid` route           | 301 redirect → `/chat/:id`. Route deletion lives in PR 3.                              |
| ADR 0010                                  | Superseded by new ADR.                                                                 |
| SQR-92 overflow drawer                    | Obsolete; close with explanation.                                                      |
| SQR-93 selected-message projection        | Obsolete; close with explanation.                                                      |
| SQR-94 selected-message rendering helpers | Obsolete; close with explanation.                                                      |
| `src/web-ui/layout.ts` helpers            | ~6 helpers deleted, "WithRecentQuestions" variants collapsed.                          |
| DESIGN.md §Layout                         | Rewrite mobile region list; decisions-log supersession note.                           |

### Locked by user (explicitly selected via AskUserQuestion)

- **Overall IA shape:** Option D — split home + scrolling-chat. (CEO review, approved via preview.)
- **Drop cap:** newest completed answer only. (Encoded in the approved preview.)
- **Chip row:** deleted entirely.
- **Authenticated home:** purpose-built landing with hero + scope line + input dock (approved preview).
- **Conversation page:** scrolling transcript, newest at bottom (approved preview).
- **ADR 0010:** superseded by a new ADR.
- **SQR-92 / SQR-93 / SQR-94:** obsolete under Option D.

### Interaction state coverage (descriptive only)

| Feature                 | Loading                                                       | Empty                                                            | Error                                                                                                      | Success                                                   | Partial                                                                                            |
| ----------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Home page               | n/a (static)                                                  | "At your service." + scope line + input dock                     | login banner via `renderAuthBanner`                                                                        | input ready                                               | n/a                                                                                                |
| Conversation transcript | `.squire-answer--pending` skeleton on newest turn             | `"Conversation is empty."` hero (`layout.ts:855-858`, unchanged) | inline `squire-banner--error` for SSE failure; persisted error messages render with `squire-answer--error` | full scrolling transcript, newest at bottom with drop cap | SSE disconnect mid-stream reuses existing reconnect UX; persisted partial lands as `isError: true` |
| Input dock              | submit button live; form idempotency key prevents double-post | always rendered; placeholder "Ask a question..."                 | `squire-banner--error` above dock if submit HTTP fails                                                     | form clears after SSE start                               | n/a                                                                                                |

### Decisions locked (walked through one at a time with user)

**From CEO review:**

- **CEO-1. Outside-voice challenge:** ran codex. Seven findings surfaced; #1 (reconsider D vs C) rejected by user; #2–#7 folded into this plan.
- **CEO-2. TODOs.md candidates:** skipped. Squire tracks work in Linear; implementation + follow-ups go there.

**From design review:**

- **D-1. Highlighter on past answers:** keep on all answers (past + current). Zero CSS change; `.squire-answer em` rule already scopes regardless of position.
- **D-2. Conversation-page load scroll:** preserve last scroll position (browser native). No JS needed.
- **D-3. Submit scroll behavior:** auto-scroll on submit, pin-to-bottom while streaming unless user scrolls away, resume pinning if they return to near-bottom. ~15 lines of JS.
- **D-4. Drop-cap transition:** instant class swap. No fade.
- **D-5. aria-live strategy (composite pattern):**
  - `role="log" aria-live="polite"` on `.squire-transcript`.
  - Permanent pending-turn slot lives in the DOM at page load (not dynamically created) so the live-region registration fires reliably.
  - `aria-busy="true"` on the pending answer element during the `done.html` swap, `aria-busy="false"` after. Suppresses the double-announce of streamed text + final HTML.
  - `aria-live="off"` on chip-row slot (not applicable post-Option-D), tool-rows slot, CONSULTED footer.
  - Caveat in plan: VoiceOver on iOS Safari has historical bugs with `aria-busy`; requires empirical verification during QA.
- **D-6. Desktop rail in Phase 1:** collapse entirely. No rail markup rendered on desktop. Returns in Phase 4 with real content.
- **D-7. No-card-shell rule:** explicit eng-enforcement item + CSS-assertion test. Plan names the rule (no outer `box-shadow`, no outer `border-radius`, no background deviation on `.squire-turn` / `.squire-answer`; hairline separator via `border-top: 1px solid var(--rule)`). Add a computed-style assertion test so drift fails CI.
- **D-8. Home-page visual weight:** bare hero + scope line + input dock. No filler where the deleted verdict/PICKED stubs sat. Composed moment carries it.

**From eng review:**

- **E-1. `/chat/:id/messages/:mid` fate:** 301 Moved Permanently → `/chat/:id`. Browsers cache the redirect aggressively, so committing to this means giving up deep-link-to-turn for the foreseeable future. That's an accepted trade — Phase 6 multi-device sync would require a fresh URL design anyway.
- **E-2. PR split:** 3 PRs, in order.
  - **PR 1 — Home stops lying (~150 LOC).** Delete fake chips default. Delete visible verdict + PICKED badge stubs (keep in fixture `<template>`). Home renders as standalone template. Rail collapses on desktop (D-6). Does not touch `/chat/:id` / selected-message route / SSE. Close SQR-95.
  - **PR 2 — Conversations are scrolling transcripts (~500 LOC).** New swap contract per E-3, scrolling transcript rendering, drop-cap CSS targeting newest, D-1 highlighter kept everywhere, D-3 scroll behavior, D-4 instant drop-cap swap, D-5 aria-live composite, D-7 no-card CSS + test. Updates ARCHITECTURE.md, SSE_CONTRACT.md, DESIGN.md, writes ADR 0012.
  - **PR 3 — Old bookmarks redirect (~150 LOC).** 301 redirect on `/chat/:id/messages/:mid`. Delete selected-message projection (`loadSelectedConversation`, `SelectedConversationProjection`, related types), route handler, rendering helpers (`renderSelectedMessageSurface*`), and tests. Close SQR-93 / SQR-94.
- **E-3. Swap contract:** append-fragment approach. POST /chat/:id/messages returns an HTML fragment for just the new pending turn; client appends it to `.squire-transcript` via `hx-swap="beforeend"` targeting the transcript container. SSE `done.html` continues to replace the pending answer's plaintext (same scoped replacement as today, narrower target). Drop `recentQuestionsNavHtml` from the `done` event payload. Error events replace the pending answer's content with an inline `squire-banner--error`. First-submit-from-home: POST /chat creates conversation, returns a full transcript fragment (one pending turn) that swaps into the home page's container; HTMX pushes URL to `/chat/:id`.

---

## Options considered (historical)

Original spec framed three options (A/B/C). CEO review added Option D and selected it. A/B/C preserved here for decision context:

|                             | Option A           | Option B                   | Option C          | **Option D (chosen)**                                |
| --------------------------- | ------------------ | -------------------------- | ----------------- | ---------------------------------------------------- |
| Home chip row               | hide on empty      | hide on empty, relabel     | delete            | **delete**                                           |
| Home verdict + PICKED stubs | decide locally     | move to fixture template   | remove            | **move to fixture template**                         |
| Desktop rail (Phase 1)      | unchanged          | keep wordmark only         | collapse          | **collapse**                                         |
| Conversation IA             | unchanged          | unchanged + first-turn cue | scrolling chat    | **scrolling chat**                                   |
| `/messages/:mid` route      | unchanged          | unchanged                  | delete            | **301 redirect → /chat/:id, delete handler in PR 3** |
| Drop cap policy             | unchanged          | unchanged                  | needs new rule    | **newest answer only**                               |
| Home IA                     | ledger empty state | ledger empty state         | zero-message chat | **purpose-built landing**                            |
| ADR 0010                    | unchanged          | narrow                     | supersede         | **supersede**                                        |
| SQR-92                      | unchanged          | unchanged                  | obsolete          | **obsolete**                                         |
| SQR-93/94                   | unchanged          | unchanged                  | obsolete          | **obsolete**                                         |

---

## Deliverables

Post-review (after /plan-design-review and /plan-eng-review complete):

1. Write ADR `docs/adr/0012-split-home-and-scrolling-chat-ia.md` recording the decision. Mark ADR 0010 `status: superseded, superseded_by: "0012"`.
2. Update DESIGN.md §Layout (mobile region list, desktop rail per D-6, drop cap "newest only" note) and append a Decisions Log entry superseding the 2026-04-08 "current-turn ledger" row.
3. Update `docs/ARCHITECTURE.md`: chat-model section (currently describes the current-turn ledger) and route inventory (currently lists `/chat/:conversationId/messages/:messageId`). Changes keyed to E-1 outcome.
4. Update `docs/SSE_CONTRACT.md`: the `done` event payload currently carries `recentQuestionsNavHtml` as a required field (lines 31, 57 — "refresh the recent-question rail immediately after streaming completes"). Under Option D that field goes away. Revise the contract per E-3 outcome.
5. File a Linear issue for the **implementation** of Option D: supersede the chip row, delete selected-message projection + route + helpers, add scrolling transcript, standalone home page, apply E-1 outcome to bookmark URLs, apply E-3 outcome to swap contract. Probably an epic with lanes per E-2.
6. File Linear issue(s) for any follow-up design-review findings that aren't captured in the implementation issue (e.g. per-transcript aria-live scoping, safe-area + keyboard overlap QA, visual rhythm verification across session lengths).
7. **After the implementation PR lands** (not before): close SQR-95 as absorbed, SQR-92 / SQR-93 / SQR-94 as obsolete. Per codex outside-voice finding #4: those tickets still define live routes, projections, and tests today; closing them before replacement ships makes the backlog lie. The implementation PR is what makes them actually obsolete.

---

## Out of scope for this cycle

- Phase 4 character-state IA (comes back in play under Option C; deferred under A/B).
- Phase 5 card-comparison IA.
- Implementation of the chosen option — this cycle ends at the ADR. Implementation is a separate issue (or rescoped SQR-95).
- Revisiting the visual design tokens. Whatever IA wins, fonts/colors/spacing stay as DESIGN.md has them.

---

## Open questions deferred

No questions remain open at plan time. The implementer of PR 2 should empirically verify VoiceOver on iOS Safari against the D-5 aria-live composite pattern; if the `aria-busy` wrap doesn't suppress the double-announce cleanly on that specific engine, escalate to the PR reviewer for an alternate approach (e.g. removing the pending plaintext before the HTML swap instead of relying on aria-busy).
