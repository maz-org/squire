# Web UI Design Review — Interactive Walkthrough

**Status:** ✅ APPLIED 2026-04-08 — all 4 decisions and ~30 obvious-fix annotations
landed in Linear (SQR-5, 6, 8, 13, 64, 65, 66, 67) + DESIGN.md decisions log v0.4.

**Started:** 2026-04-08
**Branch:** `claude/laughing-brattain`
**Reviewer:** plan-design-review skill, Claude Opus 4.6
**Scope:** Squire · Web UI Linear project (Phase 1 initiative)
**Project:** [Squire · Web UI](https://linear.app/maz-org/project/squire-web-ui-f4481c1cff1d)
**Initiative:** [Squire · Phase 1: MVP Rules Q&A at the Table](https://linear.app/maz-org/initiative/squire-phase-1-mvp-rules-qanda-at-the-table-7e1f0057e448)
**Companion review:** [`web-ui-f4481c1cff1d-eng-review-walkthrough.md`](web-ui-f4481c1cff1d-eng-review-walkthrough.md) — eng review pass that landed yesterday.

This file is the durable record of the design concerns surfaced, the decisions
taken, and the Linear/DESIGN.md updates applied. Source of truth for "why does
SQR-6 say X."

---

## Context loaded

**Docs read in full:**

- `DESIGN.md` v0.3 (2026-04-08, approved via `/design-consultation`)
- `docs/SPEC.md` v3.0.1 (2026-04-07)
- `docs/ARCHITECTURE.md` v1.0.1 (2026-04-07, partial)
- `docs/agent/code-quality.md`, `docs/agent/testing.md`
- `docs/plans/web-ui-f4481c1cff1d-eng-review-walkthrough.md` (the eng review that landed yesterday)
- `~/.gstack/projects/maz-org-squire/designs/design-system-20260408-1125/squire-design-preview.html` (the visual reference HTML approved during /design-consultation)

**Linear tickets read in full:**

- SQR-5 (parent), SQR-64 (5a tokens), SQR-65 (5b layout), SQR-66 (5c signatures), SQR-67 (5d stubs)
- SQR-6 (chat UI), SQR-7 (conversation agent), SQR-8 (streaming protocol)
- SQR-13 (sign-in UI), SQR-38 (OAuth backend), SQR-61 (CSP + sanitization)

**Design system asset summary:** DESIGN.md is a 519-line, 8-phase, fully-tokenized
design system with hex tokens, font-variation-settings, motion durations, every
signature component (monogram, drop cap, rule-term highlighter, verdict block,
spoiler banner, citation, picked-card badge), responsive scale, and per-channel
identity rules. The accompanying `design-preview.html` is the rendered visual
target. This is an exceptional foundation; the gaps below are integration gaps
between the design system and the implementation tickets, not design-system gaps.

---

## Initial rating: 7/10

What was already strong:

- DESIGN.md alignment requirement is in every ticket
- SQR-5 parent has QA-verifiable visual ACs
- SQR-5a/5b/5c/5d sub-issue split isolates concerns
- SQR-6 has empty + error states (mentioned, not specced)
- SQR-8 has the error event taxonomy

What was missing or contradictory (the 7-not-10 list):

1. **Ledger vs bubbles collision** — DESIGN.md says "not a chat column with bubbles"; SQR-6 says "Message list region... assistant bubble"; SQR-8 says "`#msg-{id}` pending assistant bubble." Contradiction unresolved.
2. **Hero question never wired** — DESIGN.md Typography defines "Hero question 22–28px Fraunces" but no ticket renders it.
3. **Loading state gap** — submit → first SSE token (200–1200ms) had no visible treatment.
4. **Citations inline vs chip** — DESIGN.md says inline sepia-underlined links in answer prose; SQR-8 says collapsible chip under the answer. Contradictory.
5. **Tool indicator emoji** — SQR-8 had `🔎 Searching rulebook…`; DESIGN.md aesthetic forbids decorative glyphs.
6. **First-run empty state generic** — "Ask Squire a Frosthaven rules question" is a 5/10 placeholder.
7. **Error bubble styling unspecified** — SQR-6 said "render an error bubble inline" with no DESIGN.md mapping.
8. **iOS safe-area-inset-bottom missing** — sticky input dock would be covered by the home indicator.
9. **`focus-visible` rings unspecified** across all interactive elements.
10. **`aria-live` on streaming answer region unspecified** — screen reader experience would be unbearable.

---

## Step 0 user response

- **Focus:** Full 7-pass review, update tickets inline.
- **Mockups:** Skip — `design-preview.html` is enough.

---

## Pass-by-pass results

### Pass 1 — Information Architecture (6 → 9)

**Decision #1: Current-turn focus ledger.** Main surface shows ONE turn at a
time: current question (Fraunces hero) + current answer (drop cap). Prior turns
collapse into the recent-questions chip row; tapping a chip re-loads that turn
into the current-turn slot. The drop cap and rule-term highlighter NEVER appear
on more than one answer at a time.

Honors "ledger not chat column" and keeps the drop cap precious. Matches
Brian's actual use (one rule at a time under time pressure).

Rejected: scrolling ledger (B), chat column (C, defeats DESIGN.md core decision).

**Inline fixes:** SQR-65 context strip typography spec (Geist 10–11px sepia
small-caps); SQR-66 gets `.squire-question` styling; SQR-6 renames
"message list / bubble" to "current-question / current-answer slots."

### Pass 2 — Interaction State Coverage (5 → 9)

State matrix audit found 8 missing/under-specced states. All resolved either by
inline fixes or by Decision #2.

**Decision #2: First-run empty state voice.** "At your service." in Fraunces hero, then `ASK ABOUT A RULE, CARD, ITEM, MONSTER, OR SCENARIO` in Geist sepia small-caps. Owned by SQR-67.

Rejected: italic placeholder only (B, dead main surface), tutorial chip row (C, too onboarding-card).

**Inline fixes:**

- **Loading state:** SQR-8 ships a skeleton drop cap (68px wax square pulsing 800ms) + 3 sepia placeholder lines. Replaced on first `text-delta`. Reduced-motion-aware.
- **Error states:** SQR-6 + SQR-8 use the `.squire-banner` primitive (see Decision #5 below) with `--error` modifier. Two variants: `TROUBLE CONNECTING` (recoverable, retry) and `SESSION ENDED` (non-recoverable, redirect).
- **OAuth failure:** SQR-13 renders the same banner on `/login?error=...` with `COULDN'T SIGN YOU IN` label.
- **Server-side error fallback:** SQR-65 renders the same banner in `main.squire-surface` when the SSR handler throws (db down, agent down).

### Pass 3 — User Journey & Emotional Arc (7 → 9)

**Inline fixes:**

- SQR-13 `/login` page composition fully specced (centered masthead monogram + wordmark + tagline + Google sign-in button).
- Time-horizon check passed: 5-sec visceral (drop cap + monogram + warm palette), 5-min behavioral (streaming + citations + tool footer), 5-year reflective (cross-channel monogram for Phase 8).
- "Welcome back" treatment for returning users — flagged but not blocking; persistence is in SQR-7, visual treatment can be Phase 7 polish.

No decisions needed.

### Pass 4 — AI Slop Risk (9 → 10)

Single hit on the slop blacklist: SQR-8's `🔎 Searching rulebook…` emoji. **Inline
fix:** replaced with `--sepia` Geist 10–11px small-caps `CONSULTING · RULEBOOK`
→ `CONSULTED · RULEBOOK P.47`. Same vocabulary as the tool-call footer; no
emoji anywhere in the system.

App UI hard rules pass clean. Universal rules pass clean. The deliberate
wax-red left border on the "Squire recommends" verdict block is justified
(not slop) — DESIGN.md explicitly earned that pattern.

### Pass 5 — Design System Alignment (6 → 9)

**Decision #3: Citations inline AND tool-call footer.** Inline `<span class="cite">`
woven into answer prose (sepia underlined, hover wax) AND the tool-call footer
line below the answer doubles as the "sources consulted" index
(`CONSULTED · RULEBOOK P.47 · SCENARIO BOOK §14`). No separate chip row.

Confirmed against `design-preview.html` which renders exactly this pattern
(inline `.cite` spans + `.squire-footer-line`). The footer is the source index;
no new region introduced.

Rejected: inline only (B, loses scannable source list), chip only (C,
contradicts DESIGN.md).

**Inline fixes:**

- "Bubble" / "message list" terminology stripped from SQR-6 and SQR-8 in favor of "current-answer slot." SQR-5 parent gets a code-search AC: zero hits for "bubble" or "message-list" in `src/web-ui/`.
- Hero question (`.squire-question`) styled in SQR-66, populated by SQR-6.

### Pass 6 — Responsive & Accessibility (6 → 9)

11 a11y/responsive items missing. All resolved as inline fixes (no decisions):

- iOS `env(safe-area-inset-bottom)` on input dock → SQR-65
- Tablet breakpoint (≥768 / <1024) → SQR-65
- `focus-visible` 2px wax outline on all interactive elements → SQR-66
- `aria-live="polite"` on `main.squire-surface`, `aria-live="off"` on `footer.squire-toolcall` → SQR-65
- Skip-link from header to input dock → SQR-65
- Keyboard tab order AC → SQR-65
- Color contrast ratio comment block in `styles.css` → SQR-64
- `prefers-reduced-motion: reduce` disables pulse, hover transitions, submit slide → SQR-66
- `prefers-color-scheme` NOT honored in Phase 1 (dark-mode unconditional) → SQR-64
- VoiceOver test note for drop cap + rule-term highlighter → SQR-66
- Missing tokens added to SQR-64 list (`--surface-2`, `--parchment-dim`, `--sepia-dim`, `--wax-dim`)

### Pass 7 — Unresolved Design Decisions

**Decision #4: Mobile cite tap toggles wax highlight.** Tap a `.cite` span on
mobile → adds `.is-active` → spans wax-red. Tap elsewhere clears. ~5 lines of
vanilla JS, owned by SQR-66.

Rejected: bottom-sheet modal (B, scope creep), no-op (C, degrades mobile).

---

## Applied changes — Linear ticket updates

| Ticket | What changed |
| --- | --- |
| **SQR-5** | Added a11y AC bundle, tablet AC, hero question + first-run empty state + banner primitive ACs, "no bubble" code-search AC, link to this walkthrough. |
| **SQR-6** | Replaced "message list / bubbles" with current-turn ledger pattern (Decision #1). Added hero question slot, recent-questions chip row population, error banner pattern, first-run empty state hand-off to SQR-67. Added integration tests for re-load-from-chip and error banner variants. |
| **SQR-8** | Removed emoji tool indicators (Pass 4). Added skeleton drop cap loading state (Pass 2). Resolved citations to inline + tool-call footer aggregate (Decision #3). Mapped error events to `.squire-banner` primitive. Renamed "bubble" to "current-answer slot." Added `time_to_first_byte_ms` OTel span attribute. Added reduced-motion test. |
| **SQR-13** | Specified centered `/login` composition (was just "single Sign in with Google button"). Added OAuth-failure error banner. Defined header signed-in layout, `/not-invited` page composition, reuse of `.squire-banner` primitive. Added visual diff test. |
| **SQR-64 (5a)** | Added missing tokens (`--surface-2`, `--parchment-dim`, `--sepia-dim`, `--wax-dim`). Added contrast-ratio doc requirement. Clarified dark-mode default + `prefers-color-scheme` NOT honored. |
| **SQR-65 (5b)** | Context strip typography spec, `aria-live` on main surface, `aria-live="off"` on footer, iOS `safe-area-inset-bottom` on input dock, skip-link, tablet breakpoint, server-side error fallback rendering, keyboard tab order AC. |
| **SQR-66 (5c)** | Added `.squire-question` hero spec, `.cite` tap-toggle on mobile, focus-visible global rule, reduced-motion media query, VoiceOver test note. |
| **SQR-67 (5d)** | Added `.squire-empty` first-run empty state, promoted spoiler banner to reusable `.squire-banner` primitive with `--spoiler` / `--error` / `--sync` modifiers, noted that tool-call footer doubles as citation aggregate. |

## Applied changes — DESIGN.md

Added 9 entries to the Decisions Log (v0.4 changelog entry):

1. Multi-turn ledger: current-turn focus
2. Citations: inline `<span class="cite">` AND tool-call footer aggregate
3. First-run empty state voice
4. No emoji in tool indicators (or anywhere)
5. Mobile cite tap toggles wax highlight
6. `.squire-banner` is a reusable primitive
7. A11y bundle for SQR-5
8. Dark mode is unconditional in Phase 1
9. (Bumped changelog from v0.3 to v0.4)

No tokens, fonts, or component visuals changed — only the Decisions Log was
extended to record gaps that the implementation tickets had introduced.

---

## Completion Summary

```text
+====================================================================+
|         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | DESIGN.md v0.3 strong; web UI scope clear   |
| Step 0               | 7/10 initial; full 7-pass focus chosen      |
| Pass 1  (Info Arch)  | 6/10 → 9/10                                 |
| Pass 2  (States)     | 5/10 → 9/10                                 |
| Pass 3  (Journey)    | 7/10 → 9/10                                 |
| Pass 4  (AI Slop)    | 9/10 → 10/10                                |
| Pass 5  (Design Sys) | 6/10 → 9/10                                 |
| Pass 6  (Responsive) | 6/10 → 9/10                                 |
| Pass 7  (Decisions)  | 4 resolved, 0 deferred                      |
+--------------------------------------------------------------------+
| NOT in scope         | written below                               |
| What already exists  | DESIGN.md v0.3 + design-preview.html        |
| Decisions made       | 4 (Linear + DESIGN.md updated)              |
| Decisions deferred   | 0                                           |
| Linear tickets edited| SQR-5, 6, 8, 13, 64, 65, 66, 67             |
| DESIGN.md log entries| 9 added (v0.3 → v0.4)                       |
| Overall design score | 7/10 → 9/10                                 |
+====================================================================+
```

## NOT in scope (deferred)

- **Welcome-back treatment for returning users.** Persistence is specced (SQR-7); visual treatment can land in Phase 7 polish. Not blocking for MVP.
- **Citation bottom-sheet modal on mobile.** Decision #4 went with the lightweight tap-toggle. If user research later shows Brian wants to jump to the source, the modal is a Phase 7 enhancement.
- **Theme toggle UI.** Light-mode CSS ships in SQR-64 but the toggle is Phase 7.
- **Logout confirmation dialog.** Single-user MVP doesn't justify it.
- **Persistent left rail content (Phase 4 character state).** Phase 1 ships the rail empty.

## What already exists

- **DESIGN.md v0.3** — 519 lines, 8-phase coverage, every token + signature component specified.
- **`docs/design-preview.html`** — self-contained visual target, every component rendered with real fonts/colors.
- **`docs/adr/0008-tailwind-cli-for-production-css.md`** — CSS build approach.
- **`docs/adr/0009-google-oauth-with-hardcoded-allowlist.md`** — auth decision.
- **`docs/plans/web-ui-f4481c1cff1d-eng-review-walkthrough.md`** — yesterday's plan-eng-review walkthrough that defined the dependency order and ticket split.

## Unresolved Decisions

None. All 4 decisions answered by user; all inline fixes applied.

---

## Next steps

1. **Run `/plan-eng-review` again on the updated tickets** (recommended within 7 days). The eng review walked yesterday is now slightly stale because the tickets gained a11y ACs, the banner primitive, the loading skeleton, and SQR-66 grew significantly. The architecture didn't change, but the test surface did. Eng review is the required shipping gate.
2. **Start implementation in dependency order:** SQR-64 → SQR-65 → SQR-66 → SQR-67 → SQR-38 → SQR-7 → SQR-13 → SQR-6 → SQR-8 → SQR-61.
3. **Run `/design-review` (visual QA) once SQR-5 sub-issues merge** — that's the live-site visual audit that this plan-stage review can't do.
