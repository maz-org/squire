# SQR-98 — Replace placeholder consulted footer with real source data

## Problem

[src/web-ui/layout.ts:570-572](../../src/web-ui/layout.ts) hardcodes
`CONSULTED · RULEBOOK P.47 · SCENARIO BOOK §14` into the
`<footer class="squire-toolcall">` slot. The string is always the same on every
page load regardless of what the assistant actually consulted. SQR-8's
Citations section explicitly spec'd this slot as a per-turn aggregate of the
real tool-source labels that fired during the stream, but the aggregation was
never wired up. The footer is currently decorative theater that implies live
provenance.

## Acceptance criteria (from SQR-98)

1. The consulted footer never shows invented source data.
2. If source/citation data is available for the current answer, the footer
   reflects the actual consulted sources.
3. If source/citation data is not yet available, the UI does not pretend
   otherwise.
4. Consistent with the intended citation/source behavior from SQR-8.
5. Historical answers show their sources too (added during plan-eng-review
   2026-04-20). Fresh turns and prior turns have symmetric provenance.

## Current state (verified by reading the code)

- Agent loop ([src/agent.ts:347-362](../../src/agent.ts)) emits `tool_call` and
  `tool_result` events with `{ name, ok }`. No citation refs, no page/section
  numbers.
- Nine tools in `AGENT_TOOLS` at [src/agent.ts:60](../../src/agent.ts):
  `search_rules`, `search_cards`, `list_card_types`, `list_cards`, `get_card`,
  `find_scenario`, `get_scenario`, `get_section`, `follow_links`.
- Server ([src/server.ts:574-596](../../src/server.ts)) maps `name` to a
  provenance label via `buildToolSourceLabel`. Today it only knows about
  `search_rules` and the card tools; scenario/section/find tools silently
  fall through to `REFERENCE`.
- Messages schema ([src/db/schema/conversations.ts:34](../../src/db/schema/conversations.ts))
  has no column for consulted sources. Assistant messages store `content`
  only, no provenance metadata.
- `done` SSE payload carries `{ html, recentQuestionsNavHtml }`.
- Client ([src/web-ui/squire.js:324-344](../../src/web-ui/squire.js)) grabs
  `.squire-toolcall`, hides it during streaming, shows it again on
  `done`. Never updates its text content.
- The footer is page chrome: rendered once in [layout.ts:570](../../src/web-ui/layout.ts),
  not re-rendered per answer.

## Approach

Four parts:

1. **Persist** the tool names consulted on each assistant message, in a new
   `messages.consulted_sources` jsonb column.
2. **Render** the footer content from persisted data, server-side, as part
   of the answer element's markup. Move the footer from page chrome into
   the swap target so HTMX nav gets the correct footer for free.
3. **Live-stream** behavior unchanged in shape: the client still aggregates
   `tool-result` events and populates the footer on `done`. The footer
   element is now inside the pending-answer element.
4. **Structural drift guard:** `AGENT_TOOLS` becomes `as const`, exposing a
   typed union that forces `TOOL_SOURCE_LABELS` to cover every tool at
   compile time.

### Architecture

```text
 live stream                       historical render
 ───────────                       ─────────────────
 agent.ts emit tool_result         DB messages.consulted_sources: ["search_rules","search_cards"]
        │                                │
        ▼                                ▼
 server.ts onEvent                 server.ts layout.ts renderAnswer()
  ├── writes SSE tool-result        ├── reads consulted_sources from message
  └── pushes tool name into          └── maps names → labels via TOOL_SOURCE_LABELS
      turnSources array                  (filtering nulls + dedup + preserving order)
        │                                │
        ▼                                ▼
 persistAssistantOutcome           HTML: <footer class="squire-toolcall">CONSULTED · RULEBOOK · CARD INDEX</footer>
  └── writes turnSources into       │
      messages.consulted_sources     ▼
        │                         inside .squire-answer (sibling of content)
        ▼                         swapped by HTMX on turn nav
 SSE done → JS aggregates labels
      from tool-result events
      → writes textContent into
      the footer inside
      .squire-answer--pending
```

### Schema change

New Drizzle migration:

```ts
// In src/db/schema/conversations.ts
import { jsonb } from 'drizzle-orm/pg-core';

export const messages = pgTable('messages', {
  // ... existing columns ...
  consultedSources: jsonb('consulted_sources').$type<string[] | null>().default(null),
});
```

Nullable. Defaults null. Existing rows migrate with no data. Decision:
store tool _names_, not labels. Labels are a UI concept — if we ever
rename `RULEBOOK` to `RULE BOOK`, no data migration needed.

Migration is safe for production: additive column, nullable default, no
locks on reads. A rolling deploy sees mixed rows (old null, new populated)
during the transition; render path handles null as "footer hidden."

### Agent / server changes

1. At [src/agent.ts:60](../../src/agent.ts):

   ```ts
   export const AGENT_TOOLS = [ ... ] as const satisfies readonly Tool[];
   export type AgentToolName = (typeof AGENT_TOOLS)[number]['name'];
   ```

2. In [src/server.ts](../../src/server.ts), replace `buildToolSourceLabel`:

   ```ts
   type ToolSourceLabel = 'RULEBOOK' | 'CARD INDEX' | 'SCENARIO BOOK' | 'SECTION BOOK';

   // null = traversal/utility tool that isn't itself a source.
   // Adding a tool to AGENT_TOOLS without a record entry fails typecheck.
   const TOOL_SOURCE_LABELS: Record<AgentToolName, ToolSourceLabel | null> = {
     search_rules: 'RULEBOOK',
     search_cards: 'CARD INDEX',
     list_card_types: 'CARD INDEX',
     list_cards: 'CARD INDEX',
     get_card: 'CARD INDEX',
     find_scenario: 'SCENARIO BOOK',
     get_scenario: 'SCENARIO BOOK',
     get_section: 'SECTION BOOK',
     follow_links: null,
   };

   export function toolSourceLabel(name: string): ToolSourceLabel | null {
     if (!(name in TOOL_SOURCE_LABELS)) return null;
     return TOOL_SOURCE_LABELS[name as AgentToolName];
   }

   export function aggregateSourceLabels(toolNames: readonly string[]): ToolSourceLabel[] {
     const seen = new Set<ToolSourceLabel>();
     const ordered: ToolSourceLabel[] = [];
     for (const name of toolNames) {
       const label = toolSourceLabel(name);
       if (label === null) continue;
       if (seen.has(label)) continue;
       seen.add(label);
       ordered.push(label);
     }
     return ordered;
   }

   export function formatConsultedFooter(labels: readonly ToolSourceLabel[]): string {
     return labels.length === 0 ? '' : ['CONSULTED', ...labels].join(' · ');
   }
   ```

3. In the stream handler at [src/server.ts:839-913](../../src/server.ts):

   ```ts
   const turnSources: string[] = [];
   // ...
   onEvent: async (event, data) => {
     // ... existing routing ...
     if (event === 'tool_result') {
       const payload = data as { name?: string; ok?: boolean };
       const name = payload.name ?? 'tool';
       if (payload.ok !== false) turnSources.push(name); // dedup happens server-side at persist
       // ... existing SSE write ...
     }
   };
   ```

   Then pass `turnSources` through to `streamAssistantTurn` → persistence.

4. In [src/chat/conversation-service.ts](../../src/chat/conversation-service.ts),
   `streamAssistantTurn` signature gains `consultedSources: string[]` (or the
   internal accumulator is owned by the service). `persistAssistantOutcome`
   writes it to the new column via `MessageRepository.createResponse`.

### Layout / render changes

1. **Move the footer DOM** from page chrome into the answer element. In
   [layout.ts:570-572](../../src/web-ui/layout.ts), remove the hardcoded
   footer from its current position between `<main>` and the input dock.

2. Render the footer inside each answer element (pending or completed),
   as a sibling of `.squire-answer__content` and `.squire-answer__tools`:

   ```jsx
   <article class="squire-answer" data-stream-state={state}>
     <div class="squire-answer__content">…</div>
     <div class="squire-answer__tools">…</div>
     <footer class="squire-toolcall" hidden={labels.length === 0}>
       {formatConsultedFooter(labels)}
     </footer>
   </article>
   ```

   For completed answers from the DB, `labels` comes from
   `aggregateSourceLabels(message.consultedSources ?? [])`.
   For pending answers during streaming, start hidden and empty; the JS
   populates it on `done`.

3. For cases where no answer is shown (new conversation, empty state),
   no footer exists — nothing to hide, nothing to show.

4. CSS in [src/web-ui/styles.css:379](../../src/web-ui/styles.css) may need
   minor scoping if the existing `.squire-toolcall` rule assumed page-chrome
   positioning. Likely just re-scope to `.squire-answer .squire-toolcall`
   if conflicts appear.

### Client changes

In [src/web-ui/squire.js](../../src/web-ui/squire.js), inside
`handlePendingTranscript`:

1. Replace `document.querySelector('.squire-toolcall')` with
   `answerEl.querySelector('.squire-toolcall')` — the footer now lives
   inside the pending answer.
2. Track an ordered, deduped `Map<string, true>` of **labels** observed
   from `tool-result` events (Map preserves insertion order).
3. Skip `tool-result` events with `ok === false` (failed call — not a
   consulted source).
4. Skip `label` values that aren't a known `ToolSourceLabel` (defensive —
   if a server change ever sends an unknown label, we stay silent rather
   than leak noise into the UI).
5. On `done`, if the map is non-empty, write
   `CONSULTED · LABEL_1 · LABEL_2 · …` into the footer's `textContent`
   and remove the `hidden` attribute. If empty, leave it hidden.
6. On `error`, leave the footer hidden.
7. No reset needed across turns (each turn's answer element has its own
   footer, discarded by the next HTMX swap).

### Migration safety and backward compatibility

- Old assistant messages (null `consulted_sources`) render with footer
  hidden. Matches AC #3 for pre-SQR-98 answers. No backfill.
- New answers written by post-SQR-98 code populate the column. They
  always render with a visible footer (or hidden if the agent used no
  source tools).
- Deploy ordering: run the migration first, then deploy server code.
  Old code writing to a table with the new column still works (the
  column is nullable).

## Test plan

### Coverage diagram

```text
CODE PATHS                                          USER FLOWS
[+] src/agent.ts (as const + type export)
  └── typecheck: adding a tool to AGENT_TOOLS      [+] Ask a rulebook-only question
      without TOOL_SOURCE_LABELS entry fails         └── [→E2E] footer shows "CONSULTED · RULEBOOK" live
                                                   [+] Ask multi-source question
[+] src/server.ts (new helpers)                      └── [→E2E] "CONSULTED · RULEBOOK · CARD INDEX" in order
  ├── toolSourceLabel(name)                        [+] Reload page with a selected prior turn
  │   ├── search_rules → RULEBOOK                    └── [→E2E] footer hydrated from DB, same labels
  │   ├── search_cards / list_cards /              [+] HTMX nav to a different prior turn
  │   │   list_card_types / get_card → CARD INDEX    └── [→E2E] footer updates to that turn's sources
  │   ├── find_scenario / get_scenario → SCENARIO BOOK
  │   ├── get_section → SECTION BOOK               [+] Mid-stream failure
  │   ├── follow_links → null                        └── footer stays hidden on error
  │   └── unknown string → null                    [+] Navigate to a pre-SQR-98 answer (null sources)
  ├── aggregateSourceLabels()                        └── footer hidden (no invention)
  │   ├── dedupes repeat labels                    [+] Ask a question, agent uses only follow_links
  │   ├── preserves insertion order                  └── footer hidden (no source tool fired)
  │   └── skips null labels                        [+] New conversation / empty state
  └── formatConsultedFooter()                         └── no footer element at all
      ├── empty → ''
      └── non-empty → "CONSULTED · …"

[+] src/chat/conversation-service.ts
  ├── streamAssistantTurn collects turnSources
  ├── persistAssistantOutcome writes consultedSources to DB
  └── ok:false tool results excluded from collection

[+] src/web-ui/layout.ts renderAnswer()
  ├── completed message with sources → footer populated + visible
  ├── completed message null sources → footer hidden
  ├── pending message → footer hidden, empty
  └── no answer selected → no footer

[+] src/web-ui/squire.js handlePendingTranscript
  ├── stream start finds per-answer footer, hides it
  ├── tool-result ok:true known label → added to map
  ├── tool-result ok:false → NOT added (critical)
  ├── tool-result unknown label → skipped
  ├── duplicate label → deduped
  ├── insertion order preserved
  ├── done, non-empty → writes text, unhides
  ├── done, empty → stays hidden
  └── error → stays hidden
```

### Unit / integration tests

All required before merge:

1. **Regression guard (CRITICAL):** the existing
   `renders the tool-call footer with the CONSULTED placeholder line` test
   at [test/web-ui-layout.test.ts:1058](../../test/web-ui-layout.test.ts)
   is replaced with an assertion that the rendered HTML does not contain
   the placeholder string anywhere.

2. **Server helpers** (`test/server-tool-source-label.test.ts` or extend
   an existing server test):
   - each of the 9 tool names maps correctly
   - `follow_links` and unknown strings return `null`
   - `aggregateSourceLabels(['search_rules', 'search_cards', 'search_rules'])`
     returns `['RULEBOOK', 'CARD INDEX']` (order + dedup)
   - `formatConsultedFooter([])` returns `''`
   - `formatConsultedFooter(['RULEBOOK', 'CARD INDEX'])` returns
     `'CONSULTED · RULEBOOK · CARD INDEX'`

3. **Persistence round-trip**
   ([test/conversation.test.ts](../../test/conversation.test.ts) or similar):
   run a turn with a fake agent that calls `search_rules` once and
   `search_cards` twice, assert the persisted message row has
   `consulted_sources = ['search_rules', 'search_cards', 'search_cards']`
   (raw names, dedup happens at render). Assert a failed tool (`ok:false`)
   is NOT persisted.

4. **Layout render for historical messages** (extend
   [test/web-ui-layout.test.ts](../../test/web-ui-layout.test.ts)):
   - message with `consulted_sources = ['search_rules']` renders footer
     with text `CONSULTED · RULEBOOK`, not hidden
   - message with `consulted_sources = null` renders footer hidden or
     absent
   - message with `consulted_sources = ['follow_links']` renders footer
     hidden (traversal-only tool)

5. **Client behavior**
   ([test/web-ui-htmx.regression-1.test.ts](../../test/web-ui-htmx.regression-1.test.ts)):
   - tool-result ok:true with known label populates footer on `done`
   - tool-result ok:false is skipped (critical)
   - duplicate labels dedupe; insertion order preserved
   - unknown label skipped
   - `done` with empty set keeps footer hidden
   - error keeps footer hidden

6. **SSE stream integration**
   ([test/web-ui-squire.regression-1.test.ts](../../test/web-ui-squire.regression-1.test.ts)):
   existing regression extended with a full flow: rulebook-result →
   cards-result → done, assert
   `CONSULTED · RULEBOOK · CARD INDEX` in the pending answer's footer.

### Manual verification

- `bun run dev`, fresh login.
- Ask a rules question — during stream tool indicators show; on `done`,
  footer below the answer reads `CONSULTED · RULEBOOK`.
- Ask a card question — footer reads `CONSULTED · CARD INDEX`.
- Ask a question triggering both — footer reads
  `CONSULTED · RULEBOOK · CARD INDEX`.
- Reload the page — footer still correct for the displayed turn.
- Click a prior question in the recent-questions nav — footer updates
  to that turn's sources.
- Back-button to an even earlier turn — footer updates again.
- Navigate to a pre-SQR-98 conversation (if any seeded in local DB) —
  footer hidden, no placeholder visible.
- Trigger an error mid-stream (kill backend) — footer stays hidden.

## NOT in scope

- **Per-citation page/section refs** (e.g. `P.47`, `§14`). The agent
  doesn't surface this, and the SSE protocol doesn't carry it. Separate
  feature: SQR ticket for spec'd page-level provenance.
- **Inline `<span class="cite">` rendering** — already handled upstream
  by SQR-8 / SQR-61.
- **Backfill of `consulted_sources` for pre-SQR-98 rows.** Historical
  answers without data render with footer hidden (AC #3 compliant).
  Backfill would require re-running the agent against saved questions,
  which is expensive and not obviously beneficial.
- **Showing source for streaming-error answers.** If the stream errored
  before `done`, the partial source list is discarded (not persisted).
  Honest behavior — the answer didn't complete.

## What already exists

- **SSE `tool-result` events with tool name + label** — the wire already
  carries everything needed. No protocol extension.
- **`.squire-toolcall` footer + CSS** from SQR-65 / SQR-66.
- **`tool-start` / `tool-result` client handlers** in `squire.js` — the
  aggregator reuses these events.
- **Drizzle migration tooling** and test-db bootstrap already wired —
  adding a column is mechanical.
- **Per-turn render path** (`loadSelectedConversation`,
  `renderAnswer`-equivalent functions in layout.ts) — the render already
  handles per-turn content; we add one more field.

## Failure modes

| Codepath                        | Failure mode                    | Test covers?                     | Error handling?       | User impact                                   |
| ------------------------------- | ------------------------------- | -------------------------------- | --------------------- | --------------------------------------------- |
| `tool-result` ok:false          | Failed source leaks into footer | Yes (client + persistence tests) | Filter at both sides  | No lie shown                                  |
| New tool added without label    | Silent drop                     | Yes (typecheck + unit)           | Typecheck fails build | Build break, not shipped                      |
| Old row with null sources       | Footer shows stale or invented  | Yes (layout test for null)       | Render hidden         | Footer stays hidden; honest                   |
| `done` with empty turnSources   | Footer flashes empty            | N/A (stays hidden)               | Hidden throughout     | None                                          |
| Out-of-order tool events        | Wrong label order in footer     | Yes (insertion-order test)       | Map keyed by label    | Minor cosmetic                                |
| Rolling deploy mid-request      | Column write to old code        | N/A                              | Column is nullable    | Old code ignores new column                   |
| Agent uses only traversal tools | All labels null → empty         | Yes (follow_links layout test)   | Filter null           | Footer hidden (correct — no source consulted) |

No critical gaps.

## Risk / rollback

- **Blast radius:** moderate. 5 source files (`agent.ts`, `server.ts`,
  `chat/conversation-service.ts`, `db/schema/conversations.ts`,
  `web-ui/layout.ts`, `web-ui/squire.js`) plus migration and tests.
- **Rollback:** revert commit. Migration leaves the `consulted_sources`
  column in place; that's inert if the code doesn't read/write it. A
  follow-up drop migration can clean it up if we decide not to retry.
  No data corruption.
- **Forward compatibility:** the nullable column means pre- and
  post-SQR-98 rows coexist without any conversion logic.

## Worktree parallelization

Sequential. The schema change is a prerequisite for the persistence
change, which is a prerequisite for the render change. Splitting adds
merge overhead for no wall-clock gain.

## Depends on / relates to

- SQR-8 (Done) — streaming protocol + citation aggregation spec.
- SQR-256 (Merged 2026) — added scenario/section book tooling.

---

## Completion summary

- **Step 0: Scope Challenge** — scope expanded from live-stream-only to
  include historical hydration (plan-eng-review 2026-04-20, recorded in
  Linear verification checklist).
- **Architecture Review:** 4 issues found, all resolved (failed-result
  exclusion, insertion-order preservation, typed-union drift guard,
  historical-hydration asymmetric UX).
- **Code Quality Review:** 0 new issues (existing placeholder test
  already flagged).
- **Test Review:** coverage diagram produced. 6 test suites defined,
  ~20 concrete assertions. 1 critical regression guard.
- **Performance Review:** 0 issues. `consulted_sources` array is ≤9
  elements per row; jsonb column is cheap to read.
- **NOT in scope:** 4 deferred items.
- **What already exists:** 5 reused primitives.
- **Failure modes:** 0 critical gaps.
- **Outside voice:** skipped (small, well-understood bug fix; tradeoffs
  resolved via direct user sovereignty calls, not independent review).
- **Parallelization:** sequential, no opportunity.

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                             | Runs | Status | Findings                                                                           |
| ------------- | --------------------- | ------------------------------- | ---- | ------ | ---------------------------------------------------------------------------------- |
| CEO Review    | `/plan-ceo-review`    | Scope & strategy                | 0    | —      | —                                                                                  |
| Codex Review  | `/codex review`       | Independent 2nd opinion         | 0    | —      | —                                                                                  |
| Eng Review    | `/plan-eng-review`    | Architecture & tests (required) | 1    | CLEAR  | 4 issues, 0 critical gaps, 6 test suites mapped, scope expanded with user approval |
| Design Review | `/plan-design-review` | UI/UX gaps                      | 0    | —      | —                                                                                  |
| DX Review     | `/plan-devex-review`  | Developer experience gaps       | 0    | —      | —                                                                                  |

**UNRESOLVED:** 0
**VERDICT:** ENG CLEARED — ready to implement
