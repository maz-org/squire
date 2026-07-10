# Table Turnaround II — Closing Report (SQR-392)

Project: **Squire · Table Turnaround II: Two-Lane Agent on a Knowledge
Graph** (Linear `c1fd7bd2-0ef8-4ef4-bd4a-06f03516228f`).

Outcome: **SUCCESS** — two consecutive clean full holdout gates (gate-2,
gate-3) per Brian's rulings, with one documented tradeoff (gate-3 cP95,
below). Closed 2026-07-09.

## Final metrics

Correctness is reported against the 59 counted holdout rows (two FH WIP
data-gap rows set aside by ruling: `fh-character-ability-boneshaper-life-in-death`,
`fh-character-ability-astral-boon-of-the-tempest` — card text not yet
imported). Cost baseline is the epoch-2 mean of $0.0047/answer
(provider); the target was ≤125%.

| Run                 | Correctness                    | Groundedness | ft P50 | cP50  | cP95    | Cost (provider) | Cost (incl. judge) | Safety                 |
| ------------------- | ------------------------------ | ------------ | ------ | ----- | ------- | --------------- | ------------------ | ---------------------- |
| Dev (sqr-411-dev-2) | 112/119 as-run = 115/119-equiv | 119/119      | 1,464  | 2,588 | 7,865   | 84%             | 117%               | n/a (dev split)        |
| Gate-1              | 57/59 = 96.6%                  | 61/61        | 1,373  | 2,437 | 9,041   | 107.9%          | 140%               | 22/23 → fixed same day |
| Gate-2              | 57/59 = 96.6%                  | 61/61        | 1,157  | 2,232 | 9,388   | 125.9%¹         | 158%               | 23/23                  |
| Gate-3              | 57/59 = 96.6%                  | 61/61        | 1,353  | 2,471 | 10,484² | 124.7%          | 157%               | 23/23                  |

Bars: correctness ≥95%, groundedness ≥98%, ft P50 ≤2,500ms, cP50
≤5,000ms, cP95 ≤10,000ms, cost ≤125% of baseline, safety 100%.

¹ Accepted by ruling: the three-gate provider average is 119.5%, and the
gate-2 uptick traces to the deliberately approved deep-routing safety and
correctness fixes.

² Accepted by ruling: the breach (4.8%) is the direct cost of the
SQR-413 correctness fix — the monster decision-simulation question now
routes to the deep lane, answers correctly, and takes ~31s, shifting the
tail. Gates 1–2 were under the bar; P95 lands on a passing 10.5s deep
row.

Safety detail: adversarial-boundary 8/8, cross-game-boundary 3/3,
campaign-personalization 5/5, campaign-writes 7/7 — all four suites
clean on gate-2 and gate-3; the single gate-1 cross-game failure was
fixed and verified the same day (SQR-412).

## What was built (iteration summary)

**Phase 2 — knowledge substrate (SQR-401..404, PRs 666-669).**
`knowledge_edges` graph over both games: book references, concept nodes
(565 FH + 649 GH2e), corrections with supersedes/clarifies semantics (63
GH2e), cross-surface links (818 FH + 576 GH2e). Context bundles attach
linked excerpts on scenario/section opens; the fast lane gained a
deterministic traversal chain (open → relation-filtered neighbors → open
top targets → single streaming synthesis).

**Phase 3 — deep-lane judgment (SQR-407..409, PRs 672-674).**
Read-only tool rounds execute in parallel; all tool results compact
JSON. The evidence-sufficiency judge (Haiku, reads actual round content)
replaced three deterministic guards — judgment moved into the model.
Main prompt trimmed 61→52 bullets with routing rules deleted rather than
tuned.

**Phase 4 — measurement honesty + optimization (SQR-410..414, PRs 675-679).**

- SQR-410: lookup resolver fixes (level-variant ties, scenario letter
  indices) collapsed the deep-lane exact-lookup tail (21s → 5.7s);
  character `level` accepted as a convenience encoding that the server
  converts to printed XP thresholds — the chronic campaign-writes flake
  went 6/6.
- SQR-411: three compounding cost causes fixed — eval pricing billed
  every row at the config model's Sonnet rates (fast-lane Haiku rows
  overstated 3×; now per-model-call pricing), prompt caching had never
  worked (`cache_control` was a silently dropped top-level request
  param; real breakpoints cut deep rows $0.0395 → $0.0084), and
  fast-lane evidence projection replaced raw tool JSON (~13.4k
  chars/search) with ref/source/snippet/structured-data. Plus lookup
  disambiguation for shared-name cards (title-phrase + parent-slug
  context + level-variant collapse).
- SQR-412: questions naming both games route deep (gate-1 safety fix).
- SQR-413: monster decision-simulation questions route deep (gate-1
  correctness fix; the accepted cP95 tradeoff).
- SQR-414: monster-stat level tables render as prose lines in the
  projection ("elite L1: Hp 6, Move 4, Attack 2") — a deterministic
  nested-JSON misread, fixed and verified passing on holdout at gate-3.

## Known risks and open items

1. **SQR-406** — `conversation.test.ts` stream-replay race
   (`message_stream_events` max(sequence)+1 CTE) remains a known CI
   flake; filed with full diagnosis, Backlog/High.
2. **FH WIP data gaps** — 4 accepted dev rows + the 2 set-aside holdout
   rows answer "ability text not yet available" until the FH character
   ability import completes. These convert to real passes with data
   work, no agent changes.
3. **Judge-inclusive cost asymmetry** — the ≤125% target is met on
   provider (answer-production) cost; including the eval answer-judge
   reads ~157%. The judge is eval infrastructure, but any future
   cost-target discussion should name which view it means.
4. **Judge grading noise** — `fh-scenario-2-algox-scouting` was
   under-scored on two gates for listing the record's complete monster
   roster against a two-monster "include" expected (accepted as judge
   noise by ruling). Under-specified expecteds punish faithful
   completeness; worth a grading-guideline pass in a future epoch.
5. **Marginal latency-budget row** — `gh2-multihop-section-101-2-parent`
   first token oscillates around its 2,500ms budget (scored 1 on every
   attempt). The budget, not the answer, is the flake.
6. **cP95 tradeoff** — see footnote 2; if the ~31s trap-path trajectory
   matters for production, the remaining lever is deep-lane loop-count
   work, deliberately not spent here.
7. **Backlog** — SQR-397 (monster deck composition), SQR-400 (items
   consumed flag).

## Spend

Console readings (ledger of record): $102.88 at the Phase-3 checkpoint
audit, $113.47 at the Phase-4 go, $119.31 at the gate-1 checkpoint.
Estimated at close: ~$126 of the $150 cap. Final reading requested from
Brian at sign-off.
