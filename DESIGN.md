# Design System — Squire

**Version:** 0.4
**Date:** 2026-04-08
**Status:** Approved via `/design-consultation`. Covers all eight phases of the
Squire initiative, not just Phase 1. Implementation in `src/web-ui/` follows
this document.
**Companion docs:** [docs/SPEC.md](docs/SPEC.md),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), ADR
[0008](docs/adr/0008-tailwind-cli-for-production-css.md).
**Visual target:** [docs/design-preview.html](docs/design-preview.html) — a
self-contained HTML mockup of the approved Phase 1 mobile surface, the Phase 5
card-comparison view, and the Phase 4 desktop layout. Open it in a browser to
see what implementations of this doc should look like.

This document is the authoritative source of truth for every visual and UI
decision in Squire. Read it before touching fonts, color, spacing, layout,
typography, components, or copy tone. If you want to deviate, update this doc
first and say why.

---

## Product Context

- **What this is:** Squire, a Frosthaven / Gloomhaven 2.0 knowledge agent. The
  name isn't decorative — a squire is a knight's attendant who carries the
  gear, tends the horse, knows the inventory, and hands over the right item at
  the right moment. That is literally the product metaphor.
- **Who it's for:** players at the table, mid-scenario, on a phone in a dim
  room, under social pressure to resolve a rule so the game can continue. Phase
  1 is Brian; Phase 3 adds multi-user.
- **Space / category:** AI chat interfaces for domain-specific knowledge. The
  category is converging on a single visual formula (white background, gray
  bubbles, purple/blue accent, Inter/Geist sans, 720px centered column). Squire
  deliberately departs from it — see [Risks](#risks-and-rationale).
- **Project types the system must serve:** mobile web chat (Phase 1), card /
  item comparison views with images and stat tables (Phase 5), character sheet
  and party / campaign state surfaces (Phase 4), inventory grids (Phase 5),
  sync-status UX (Phase 6), shareable recommendation exports (Phase 7), and
  cross-channel identity for Discord / iMessage avatars (Phase 8).

---

## Core Metaphor — A Squire's Ledger

**Squire is an attendant at your elbow, not an oracle from the high seat.** The
design language is a squire's personal ledger: warm ink, cream parchment, one
wax-seal red, literary serifs for signature moments, a clean sans for
everything scannable, and one small illuminated capital on every answer.
Modern restraint in the vocabulary of a treasured reference book.

**The dissonance is the signature:** the DESIGN carries the manuscript /
reference-book vibe. The VOICE stays a terse modern assistant
([SPEC.md §Agent Persona](docs/SPEC.md): "clear, concise, professional. Focus
on data and actionable answers. No roleplay, no fluff."). Looks like a
treasured reference book, reads like a competent modern helper. Do NOT write
agent copy in medieval-cosplay voice — that breaks the whole thing.

---

## Aesthetic Direction

- **Direction:** Modern Codex / Ledger. Medieval reference-book feel, executed
  with modern restraint.
- **Decoration level:** intentional, not minimal. One illuminated drop cap on
  every agent answer (Fraunces, wax-seal red, ~3-line tall, sharp optical
  setting). Thin 1px sepia rules separating answers from citations (like
  footnote rules in a printed book). Monogram "S" on wax-seal red square as
  the brand mark. Nothing else.
- **Mood:** treasured reference book, at your elbow, confidently opinionated,
  restrained.
- **What to never do:** fake parchment textures, embossed-leather drop
  shadows, swords-and-dragons clipart, fake wax seals rendered with CSS
  gradients, medieval-cosplay voice, purple/blue accent gradients, 3-column
  icon grids, uniform bubbly rounded corners, centered-everything layouts, any
  of the AI-chat slop vocabulary.

---

## Typography

Two fonts, two jobs. Both on Google Fonts, neither in the blacklist, zero
Inter.

### Display — Fraunces

- **Role:** wordmark, monogram glyph, hero question text, section headings,
  card names, ledger headings, drop caps, any "signature moment."
- **Axes:** Fraunces is a variable font. Squire uses these axes:
  - `opsz` (optical size): `144` for all display uses — maximum contrast and
    presence at large sizes
  - `SOFT` (softness): `50` default for display, `80` for the monogram (extra
    rounding at small sizes), `30` for the drop cap (sharper contrast at the
    flourish moment)
  - weight: `500` for display headings, `700` for the monogram, `600` for the
    drop cap
- **Tracking:** `-0.01em` to `-0.015em` at display sizes. Fraunces at opsz 144
  has generous default spacing; tighten for hero feel.
- **Rationale:** an earlier pick (Instrument Serif) felt too tall and thin —
  high-contrast display serifs have compressed caps and delicate horizontals
  by design. Fraunces has wider shoulders, a more open capital S (which
  matters for the monogram), and a softness axis that lets us tune between
  scholarly and warm without swapping families. Literary feel, confident
  presence, not delicate.
- **Never use Fraunces italic for the wordmark or monogram.** Italic Fraunces
  is available for emphasis elsewhere but the brand mark stays upright.
  Italic reads as precious at the wordmark scale.

### Body + UI — Geist

- **Role:** answer text, citation labels, input placeholders, button labels,
  metadata, tool-call footers, chip labels, stat tables, everything that is
  not a signature serif moment.
- **Size:** 16px mobile / 18px desktop, line-height 1.55, max reading column
  640px. `font-variant-numeric: tabular-nums` enabled on stat tables.
- **Rationale:** an earlier pick (Newsreader) was designed for long-form
  reading — slow scanning, essay flow. Squire's user is at a table, under time
  pressure, scanning for a ruling in 10–15 seconds. Geist is a humanist sans
  optimized for scanning, has tabular numerals (needed for Phase 5 stat
  tables), and is the same face already in use for UI chrome — promoting it
  to body drops a font from the payload, which matters per
  [ADR 0008](docs/adr/0008-tailwind-cli-for-production-css.md) for first paint
  on spotty cellular at the table.

### Scale (mobile-first)

<!-- markdownlint-disable MD060 -->

| Role                   | Size     | Line-height | Font      |
| ---------------------- | -------- | ----------- | --------- |
| Display hero           | 40–48px  | 1.15        | Fraunces  |
| Hero question          | 22–28px  | 1.25        | Fraunces  |
| Section title          | 24px     | 1.2         | Fraunces  |
| Body answer (mobile)   | 16px     | 1.55        | Geist 400 |
| Body answer (desktop)  | 18px     | 1.6         | Geist 400 |
| UI chrome / buttons    | 14px     | 1.4         | Geist 500 |
| Small caps / metadata  | 10–11px  | 1.4         | Geist 500 `text-transform: uppercase; letter-spacing: 0.14–0.18em` |
| Drop cap               | 68–72px  | 0.85        | Fraunces 600 `opsz 144 SOFT 30` |

<!-- markdownlint-enable MD060 -->

---

## Color — Rubrication

Medieval manuscripts used red ink (rubrication) for initial capitals and
important marks, sparingly, against warm vellum. That is the whole color story.
Five roles, one accent, zero gradients, dark mode default.

### Tokens

| Token            | Hex        | Role                                                            |
| ---------------- | ---------- | --------------------------------------------------------------- |
| `--ink`          | `#14100c`  | Page background. Warm near-black, NOT pure `#000` (too cold).   |
| `--surface`      | `#1c1814`  | Elevated surfaces (answer panels, cards, input field).          |
| `--surface-2`    | `#241e17`  | Double-elevated (desktop chrome, left rail).                    |
| `--parchment`    | `#f5ebd9`  | Primary text. Warm ivory, NOT pure white.                       |
| `--parchment-dim`| `#e8dcc4`  | Dimmed text (secondary prose, lede copy).                       |
| `--sepia`        | `#9a8d74`  | Muted text: metadata, timestamps, page numbers, labels.         |
| `--sepia-dim`    | `#6b6254`  | Citation underline color (subdued version of sepia).            |
| `--rule`         | `#3a3227`  | Hairline rules, card borders, footnote separators.              |
| `--wax`          | `#c73e1d`  | **The** accent. Drop caps, submit button, citation hover,       |
|                  |            | "Squire recommends" left rail, monogram background, streaming   |
|                  |            | indicator. When you see red, it means something.                |
| `--wax-dim`      | `#a82f13`  | Wax-seal red, hover state.                                      |
| `--sage`         | `#7a8c5c`  | Success / verified. Used rarely.                                |
| `--amber`        | `#d4a147`  | Warning (spoiler banners) AND rule-term highlighter (see below).|
| `--error`        | `#8b2919`  | Error. Distinct from `--wax` so error and accent never confuse. |

### Rules

- The wax-seal red (`--wax`) is the **only** saturated accent. It appears on
  exactly the moments that deserve it: the submit button, citation hover
  state, drop caps, the "Squire recommends" border rail, the monogram
  background, the "Picked" badge on comparison cards, and the streaming
  indicator. Never use `--wax` for decoration, borders, or dividers.
- **Citations** (source links in answers) use `--sepia` text with a
  `--sepia-dim` underline at `text-underline-offset: 3px`. Hover flips to
  `--wax`. Do not underline anything else in body text.
- **Emphasized rule terms** (`<em>` inside agent answers) render as
  small-caps, weight 600, with a translucent amber highlighter stripe — see
  [Rule-term highlighter](#rule-term-highlighter) below.
- **Dark mode is the default.** A light mode variant exists for
  desktop/daylight use (token values flip via `[data-theme="light"]` on
  `<html>`) but Phase 1 ships dark-mode-first. The phone-at-the-table context
  is the primary surface.

---

## Spacing

Generous by default. The user is reading on a phone in a dim room — whitespace
is readability, not luxury.

- **Base unit:** 4px
- **Density:** spacious
- **Scale:** `2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64) 4xl(96)`
- **Max reading column:** 640px (prevents long lines that kill reading speed
  on phones held at weird angles)
- **Line-height:** 1.55 body, 1.15–1.25 display

---

## Layout

Companion-first, not chat-first. The main surface is flexible — it hosts
streaming answers (Phase 1), card comparisons (Phase 5), character sheets
(Phase 4), inventory grids (Phase 5), and sync-status surfaces (Phase 6) as
equal first-class modes, not "the chat view with attachments bolted on."

### Mobile

Top to bottom:

1. **Thin header bar** — small "S" monogram (28px square, `--wax` background)
   - "Squire" wordmark on the left; context strip on the right showing
   `FROSTHAVEN · RULES` in Phase 1, expanding to `DRIFTER L4 / PARTY OF 4 /
   SCEN 14` once Phase 4 character state lands. Always visible. One line,
   scannable in half a second. This is the "Squire knows you" signal.
2. **Flexible main surface** — occupies the bulk of the viewport. In Phase 1
   hosts the streaming answer (with drop cap + inline citations + tool-call
   footer). In Phase 5 hosts two card mockups side-by-side with a "Squire
   recommends" verdict below. Not a chat column with bubbles — a ledger page
   that renders whatever mode is active.
3. **Tool-call footer** — single line in `--sepia` small caps, below a 1px
   `--rule` separator, reading "CONSULTED · RULEBOOK P.47 · SCENARIO BOOK §14"
   or similar. Reassurance that Squire is doing its work, not a technical
   log.
4. **Recent questions chip row** — two to three pill-shaped chips outlined in
   `--rule`, label in `--sepia` Geist 12px. Quick re-consult affordance.
5. **Input dock (bottom)** — slim rounded-rectangle input field in `--surface`
   with italic placeholder "Ask the Squire…" in Geist (italic is OK for
   placeholder ephemera; not OK for brand moments). A 44×44 square submit
   button in `--wax` with a cream arrow glyph. Input is always reachable — we
   do NOT collapse it after submit. (Earlier "oracle" proposal had the input
   collapse; rejected because the companion posture needs the attendant
   always reachable.)

### Desktop

Same tokens, different arrangement. A narrow left rail (`--surface`,
`--rule` border) hosts the persistent ledger view: character stats (class,
level, XP, gold, hand size, items), campaign state (prosperity, outpost,
last-synced), and party composition. Phase 1 leaves this rail empty or shows
just the wordmark; Phase 4 populates it; Phase 5 lives in it. Main content
column stays 640px wide, centered within the remaining viewport.

### Global

- **Border radius scale:** `4px` for small elements (chips, the monogram,
  buttons), `8px` for cards and panels, `12px` for the outer desktop frame.
  Never uniformly bubbly.
- **Hairline rules:** 1px `--rule`. Used as footnote rules separating answer
  from citations / tool-call footer. Used as bottom-border on the header bar.
  Never as decorative borders on surfaces.

---

## Signature Components

### Monogram "S"

A 28px square (mobile header), 56px (masthead), scales up proportionally. Filled
`--wax` background, 4px border-radius. Fraunces weight 700, `opsz 144
SOFT 80`, cream glyph filling ~85% of the square (font-size ≈ 85% of square
height, with 3–8px `padding-bottom` because Fraunces has a small baseline gap).
Used as favicon, sign-in page mark, mobile header, desktop header, and Phase 8
channel avatar (Discord, iMessage). This is Squire's face — keep it consistent
across all surfaces.

### Drop cap

Opening character of every agent answer (`.squire-answer::first-letter`).
Fraunces weight 600, `opsz 144 SOFT 30` (sharper than the default display
setting — drop caps want more contrast for the flourish moment). Color
`--wax`. Size 68–72px, line-height 0.85, float left with
`padding: 6px 10px 0 0`. Six lines of CSS, gives Squire its signature detail.
Do not overuse — drop cap appears only on the agent answer's opening, never
on section headings, card names, or anywhere else.

### Rule-term highlighter

Emphasized `<em>` inside agent answers renders as a small-caps semi-bold term
with a translucent amber highlighter stripe. The stripe simulates a physical
highlighter pass on a printed rulebook — literal expression of the ledger
metaphor.

```css
.squire-answer em,
.compare-verdict-text em,
.desktop-content .squire-answer em,
.type-sample-body em {
  font-style: normal;
  font-weight: 600;
  font-variant-caps: all-small-caps;
  letter-spacing: 0.04em;
  color: var(--parchment);
  background-image: linear-gradient(
    to top,
    rgba(212, 161, 71, 0.60) 0,
    rgba(212, 161, 71, 0.60) 75%,
    transparent 75%,
    transparent 100%
  );
  padding: 0 2px;
  white-space: nowrap;
}
```

**Dials:**

- **Alpha** (intensity): `0.60` default. Below `0.45` the stripe becomes
  indistinguishable from the sepia citation underlines. Above `0.80` it stops
  reading as a stripe and becomes a solid box.
- **Coverage** (stripe height as % of line box): `75%` default. Below `50%`
  it reads as a thick underline, not a highlight. At `100%` it's a full box.
- These two dials are **independent**. Adjust one without the other.

**Why amber and not wax-seal red:** red is reserved for citations and the
accent role. Amber is already in the palette as the warning color, and real
physical highlighters are yellow/amber, which makes the metaphor literal.

**Never put rule-term highlighters on:**

- The hero question (that's the user's own words, not a rule term)
- Citation links (those have their own sepia-underline treatment)
- Card names, button labels, metadata
- Anywhere outside an `.squire-answer`, `.compare-verdict-text`, or similar
  agent-generated narrative block

### "Squire recommends" verdict block

The recommendation engine (Phase 5) surfaces its verdicts in a left-border
rail treatment. 3px `--wax` solid left border, `--surface` background,
`--radius-sm` border-radius on the right side only (`0 var(--radius-sm)
var(--radius-sm) 0`), 16-18px padding. Label "Squire recommends" in
`--wax` Geist 10px small caps. Body text in Geist 15px, `--parchment`. Rule
terms inside get the amber highlighter treatment. This block is one of the
few places `--wax` appears at block scale — justified because the verdict
earns the full accent attention.

### Picked-card badge

Phase 5 card comparison uses a subtle but unmistakable "picked" treatment on
the recommended card: `--wax` 1px border (vs `--rule` on unpicked), `0 0 0
1px var(--wax)` outer box-shadow to thicken the border without layout shift,
and a small "PICKED" badge positioned at `top: -8px; right: 12px` as a
pill-shaped chip in `--wax` with cream uppercase Geist 9px text. The red
border and the red badge reinforce each other.

### Citations

Inline source links in agent answers. `color: var(--sepia)`, `text-decoration:
underline`, `text-decoration-color: var(--sepia-dim)`, `text-underline-offset:
3px`, `cursor: pointer`. Hover flips both color and underline color to
`--wax`. Never bold, never italic, never colored anything other than sepia.

### Spoiler warning banner (Phase 1)

Required by [SPEC.md §Spoiler Protection](docs/SPEC.md). Amber left-border
treatment (`border-left: 3px solid var(--amber)`), amber-tinted background
(`background: rgba(212,161,71,0.08)`), `--parchment-dim` body text, label in
`--amber` Geist small caps ("SPOILER WARNING"). Appears above the main surface
on first session, dismissable.

### Sync status banner (Phase 6)

Same pattern as spoiler warning but with `--sage` instead of `--amber`.
"SYNCED · 2H AGO" label + short body describing what was pulled.

### Buttons

- **Primary** — `--wax` background, `--parchment` text, 4px radius, Geist 500
  14px, 10px 18px padding. Hover → `--wax-dim`.
- **Ghost** — transparent background, `--parchment` text, 1px `--rule`
  border, 4px radius. Hover → `--wax` text and `--wax` border.
- **Never** — gradient buttons, shadow buttons, pill-shaped buttons with
  outrageous radius. The 4px radius is the whole vocabulary.

### Input

Single rounded rectangle (8px radius), `--surface` background, 1px `--rule`
border, Geist italic placeholder in `--sepia`, 12–14px padding. The italic
placeholder is the only place italic Geist appears in the whole system.

---

## Motion

- **Easing:** `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint) for almost
  everything. Gentle, literary.
- **Duration:** micro `80ms`, short `200ms`, medium `320ms`. Never longer.
- **Streaming text:** appears token-by-token as it arrives from SSE. No
  cursor blink — just the text materializing. This is the magic moment of
  Phase 1.
- **Tool-call badges:** fade in when the agent calls a tool (`opacity 0 → 1`,
  `200ms`), fade to collapsed single-line footer when done.
- **Submit:** the input field does not collapse. Submit slides the new
  question to the top of the main surface (`transform: translateY`), `320ms`.
- **Hover states:** 160ms color/border transitions. Nothing fancier.
- **No page transitions.** HTMX swaps should be imperceptible (< 100ms).

---

## Cross-channel Identity (Phase 8)

When Squire expands to Discord and iMessage channels, the identity travels
with it:

- **Avatar:** the monogram "S" — `--wax` square, cream Fraunces italic-off,
  weight 700, `opsz 144 SOFT 80`. Render at 32×32 (Discord), 64×64 (iMessage
  sticker), and any other channel-specific size by scaling the square and the
  glyph proportionally. Keep the 4px radius.
- **Wordmark:** "Squire" in Fraunces regular 500, `opsz 144 SOFT 50`, never
  italic.
- **Tagline:** "A Frosthaven Companion" in Geist uppercase small caps where
  space allows; drop it where space is tight.
- **Voice in channels:** the same terse modern-assistant voice as the web UI.
  Do not lean into channel vernacular — Squire stays Squire whether it's on
  the web, in Discord, or over iMessage.

---

## Frosthaven theme class

The entire design system **is** the Frosthaven theme referenced in ticket
SQR-5's acceptance criteria. It's token-driven via CSS custom properties on
`:root`, so adding a Gloomhaven 2.0 theme in Phase 2 is a token swap file,
not a rewrite. Conceptually: keep the role structure (ink / surface /
parchment / sepia / wax / sage / amber / error), shift the specific hex
values to a GH2-appropriate palette, live the swap via a `data-game="gh2"`
attribute on `<html>`. That's the extent of the per-game theming.

---

## Safe Choices and Risks

### Safe

- Mobile-first, dark-mode default, streaming SSE responses, inline tappable
  citations, tool-call visibility — all 2025 AI-chat table stakes.
- Hamburger drawer for history, bottom input dock — phone conventions.
- One wordmark + monogram for Phase 8 channel inheritance.

### Risks and Rationale

1. **Fraunces display + Geist body is serif-led.** Every other AI chat in
   2025 is sans-only on a cool-gray palette. Cost: marginally slower rapid
   skimming vs. Geist-only. Benefit: Squire looks like a rulebook, not a
   chatbot. Board game players who respect printed rulebooks will feel the
   match.
2. **Oracle-layout decision was rejected.** An earlier proposal had the
   answer take 85% of the viewport with the input collapsing after submit.
   Dropped because it only served Phase 1 rules-Q&A and broke for Phase 4+
   companion use cases. The current flexible-main-surface layout is less
   dramatic but serves all eight phases.
3. **Warm brown-black + cream + wax-seal red is a deliberate break from the
   AI-chat standard palette.** Warmer tones marginally harder on eyes for
   very long sessions — at Phase 1 usage (10–15 second glances) the cost is
   effectively zero.
4. **Illuminated drop cap on every agent answer.** One decorative flourish.
   Six lines of CSS. Risk: feels precious if overdone. Benefit: unmistakable
   signature detail.
5. **Rule-term highlighter stripes.** Literal highlighter-on-rulebook
   metaphor. Costs a small amount of ambient "visual noise" in dense answers;
   benefit is instant scannability of the important rule terms. Use the dials
   in [Rule-term highlighter](#rule-term-highlighter) to tune.
6. **The Squire name is taken literally.** The product concept maps every
   phase onto the squire/attendant metaphor. Voice should stay modern and
   terse — do NOT write agent copy in medieval-cosplay voice. The dissonance
   between visual (manuscript) and voice (professional) is the signature.

---

## Implementation Notes

- **Source of truth for tokens:** CSS custom properties on `:root` in the
  Tailwind CSS entry file (`src/web-ui/styles.css`, built via the Tailwind
  CLI per ADR 0008). Tailwind utilities should reference tokens via
  `theme.extend.colors` so class names like `bg-ink text-parchment` work.
- **Font loading:** Google Fonts `<link>` tags in the base Hono JSX layout.
  Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`. One
  stylesheet URL with both `Fraunces` (axes `opsz,wght,SOFT`) and
  `Geist` (weight range). Subset to Latin. `display=swap`.
- **`font-variation-settings`:** Fraunces is driven via
  `font-variation-settings: "opsz" 144, "SOFT" 50` on display elements.
  Tailwind v4 supports arbitrary properties — use
  `[font-variation-settings:_"opsz"_144,_"SOFT"_50]`.
- **CSP compatibility:** all the above is CSP-clean (no inline scripts, no
  `unsafe-inline`, no third-party script sources). Google Fonts
  `style-src` / `font-src` entries are the only carve-outs.
- **Approved visual reference:** the preview HTML at
  `~/.gstack/projects/maz-org-squire/designs/design-system-20260408-1125/squire-design-preview.html`
  is the visual source of truth. It's not checked into the repo (it's a
  gstack artifact) but implementers should open it to see every token and
  component rendered with real fonts, colors, and layout.

---

## Decisions Log

<!-- markdownlint-disable MD060 -->

| Date       | Decision                                                                 | Rationale                                                                                   |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 2026-04-08 | Design system created via `/design-consultation`                         | Covers all eight phases, not just Phase 1 rules Q&A.                                         |
| 2026-04-08 | **Metaphor: attendant/ledger, not oracle**                               | Name "Squire" is literal. Serves phases 4–8 (character state, recs, sync, channels). |
| 2026-04-08 | Display font: Fraunces (rejected Instrument Serif)                       | Instrument Serif felt tall/thin and had a compressed capital S that made the monogram look squished. Fraunces has wider shoulders, variable softness axis, more confident presence. |
| 2026-04-08 | Body font: Geist (rejected Newsreader)                                   | Newsreader is a long-form reading font; Squire's use case is 10-15s scanning. Geist is already in the system for UI chrome; promoting it drops a font from the payload. |
| 2026-04-08 | Wordmark and monogram are NOT italic                                     | Italic Fraunces at wordmark scale read as precious.                                          |
| 2026-04-08 | Oracle-first layout rejected in favor of companion-first flexible surface | Oracle layout only served Phase 1 and broke for Phase 4+ uses.                              |
| 2026-04-08 | Rule-term treatment: small-caps + highlighter stripe (rejected pill, italic) | Pills ate line spacing. Plain italic didn't stand out from surrounding body text. Highlighter stripe matches the "marked-up rulebook" metaphor and uses the palette's amber without stealing from the wax-seal red accent. |
| 2026-04-08 | Rule-term highlighter: amber 0.60 alpha, 75% height coverage             | Alpha and coverage are independent dials. 0.60 is visible without becoming a solid box; 75% reads as a marker stripe, not an underline. |
| 2026-04-08 | Voice stays modern / professional, NOT medieval cosplay                  | Per SPEC.md agent persona. The dissonance between manuscript visuals and terse modern voice is the signature. |
| 2026-04-08 | **Multi-turn ledger: current-turn focus** (rejected scrolling chat column, rejected per-turn drop caps) | The main surface shows ONE turn at a time: current question (Fraunces hero) + current answer (drop cap). Prior turns collapse into the recent-questions chip row; tapping a chip re-loads that turn into the current-turn slot. The drop cap and rule-term highlighter NEVER appear on more than one answer at a time. Honors "ledger not chat column" (DESIGN.md §Layout) and keeps the drop cap precious. From plan-design-review Decision #1. |
| 2026-04-08 | **Citations: inline `<span class="cite">` AND tool-call footer aggregate** (rejected chip-row-only, rejected inline-only) | Sources appear inline as sepia-underlined spans within the answer prose AND the tool-call footer line below the answer doubles as the "sources consulted" index. No separate chip row. Matches the existing `docs/design-preview.html` reference and the printed-book footnotes metaphor. From plan-design-review Decision #3. |
| 2026-04-08 | **First-run empty state**: "At your service." Fraunces hero + "ASK ABOUT A RULE, CARD, ITEM, MONSTER, OR SCENARIO" Geist sepia small-caps | Empty states are features. The placeholder gives Squire a professional, terse voice on first contact and uses the Fraunces hero-question scale that would otherwise be dead typography on first load. Rejected: italic placeholder only, tutorial chip row (too onboarding-card). From plan-design-review Decision #2. |
| 2026-04-08 | **No emoji in tool indicators or anywhere else.** Tool-start renders as `--sepia` Geist 10–11px small-caps `CONSULTING · RULEBOOK` (during) → `CONSULTED · RULEBOOK P.47` (after). | The Modern Codex aesthetic does not allow magnifying-glass glyphs. The sepia small-caps treatment is the same vocabulary as the tool-call footer line, so the streaming indicators collapse into the footer naturally. Earlier SQR-8 draft used 🔎 — flagged in plan-design-review Pass 4. |
| 2026-04-08 | **Mobile cite tap behavior**: tap toggles `.is-active` wax highlight on the cite span; tap elsewhere clears | Desktop has hover; mobile has nothing. Rather than build a modal or scroll, the cite gets a wax highlight on tap. The user can see "this phrase came from this source" without leaving the answer. Rejected: bottom-sheet modal (scope creep), no-op (degrades mobile). From plan-design-review Decision #4. |
| 2026-04-08 | **`.squire-banner` is a reusable primitive** with `--spoiler` (amber), `--error` (#8b2919), `--sync` (sage) modifiers | Spoiler banner, error banners (recoverable + non-recoverable), and Phase 6 sync banner all share one CSS component with different accent colors. SQR-67 ships the primitive; SQR-6 / SQR-8 / SQR-13 / SQR-65 reuse it. From plan-design-review Pass 2. |
| 2026-04-08 | **A11y bundle for SQR-5**: `aria-live="polite"` on `main.squire-surface`, `aria-live="off"` on `footer.squire-toolcall`, skip-link to input dock, `:focus-visible` 2px wax outline, `prefers-reduced-motion` disables pulse/transitions, `env(safe-area-inset-bottom)` on input dock, contrast ratio doc comment in styles.css | Phase 1 ships with WCAG-AA-passing dark-mode contrast, keyboard-navigable, screen-reader-friendly streaming, and iOS home-indicator-aware input dock. From plan-design-review Pass 6. |
| 2026-04-08 | **Dark mode is unconditional in Phase 1.** `prefers-color-scheme` is NOT honored. Light mode tokens exist via `[data-theme="light"]` for the Phase 7 user toggle | Per SPEC's phone-at-the-table primary surface and DESIGN.md §Color "Dark mode is the default." A user-controlled toggle in Phase 7 is the right path; auto-flipping in Phase 1 would surprise users in dim rooms. From plan-design-review Pass 6. |

<!-- markdownlint-enable MD060 -->

---

## Changelog

- **2026-04-08 (v0.3):** Finalized via `/design-consultation`. Approved
  system covers all eight phases, not just Phase 1.
- **2026-04-08 (v0.4):** Plan-design-review pass on the Squire · Web UI Linear
  project added 9 decisions to the log: current-turn ledger layout, citations
  inline + footer, "At your service" empty state, no-emoji tool indicators,
  mobile cite tap-toggle, `.squire-banner` reusable primitive, Phase 1 a11y
  bundle, and dark-mode-unconditional gating. No token or component changes —
  these decisions resolve open ambiguities between DESIGN.md and the
  implementation tickets (SQR-5, 6, 8, 13, 64, 65, 66, 67). See
  `docs/plans/web-ui-f4481c1cff1d-design-review-walkthrough.md`.
