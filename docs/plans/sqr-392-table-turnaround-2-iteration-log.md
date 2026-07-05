# Table Turnaround II — Epoch-2 Iteration Log

Running implementation log for Linear project
"Squire · Table Turnaround II: Two-Lane Agent on a Knowledge Graph".
Epoch-1 history lives in
[sqr-375-table-turnaround-iteration-log.md](sqr-375-table-turnaround-iteration-log.md);
epoch-1 reports are historical context only once the epoch-2 dataset and judge
calibration land.

Actual-spend ledger (provider-reported, counts toward the $150 project cap):

| Date       | Slice                                       | Actual provider spend |
| ---------- | ------------------------------------------- | --------------------- |
| 2026-07-05 | SQR-393 stratification (deterministic only) | $0.00                 |

## 2026-07-05 — SQR-393: question-class stratification and per-class latency

Hypothesis: tagging every table-qa case with a `questionClass` and reporting
latency percentiles per class will stop a lookup-heavy dataset from masking
rules-synthesis and multi-hop latency, before any rebalancing or runtime work.

Change:

- Added required `questionClass` (`exact-lookup | rules-synthesis | multi-hop |
campaign`) to table-qa eval cases, with the tagging rubric in eval/README.md.
- Tagged all 150 existing table-qa cases. Resulting distribution:
  128 exact-lookup, 20 rules-synthesis, 2 multi-hop, 0 campaign — which
  quantifies the epoch-1 imbalance SQR-394 will rebalance.
- Manual review corrections over the mechanical first pass:
  `fh-item-012-crude-chain-armor` back to exact-lookup (regex false positive on
  "Chain"); `scenario-61-unlock` and `gh2-section-67-1` to multi-hop (both
  require traversing a link to a second record).
- Matrix rows now carry `questionClass`; TSV and Markdown tables print it.
- Matrix local reports now include a deterministic `latencySummary`: overall
  and per-class first-token and complete P50/P95 (nearest-rank), with
  `rowCount` vs `measuredCount` so errored rows cannot silently shrink the
  tail. The Markdown report renders it as a "Table-QA Latency Percentiles"
  section.
- `questionClass` rides LangSmith example metadata on `--seed` and is restored
  on remote load; remote datasets must be reseeded before the next remote run
  (the loader intentionally fails on untagged remote table-qa examples).

Verification:

- New failing-first tests: dataset requires a valid `questionClass` on
  table-qa (30 → 31 tests in `test/eval-dataset.test.ts`); percentile math,
  untagged bucketing, empty-input handling, markdown section, and row
  propagation in `test/eval-matrix.test.ts` (24 tests).
- `npm run typecheck` passed.
- Affected eval test files passed together (6 files).

Eval spend: $0. Deterministic changes only.

Decision: keep. Measurement-shape change only; no runtime behavior touched.

## 2026-07-05 — SQR-393 merged; calibration batches 1–3; import bugs found

SQR-393 merged as PR #659 after CodeRabbit approval. The one review nitpick
was valid and fixed in-series: `EvalLatencyPercentiles` now reports
`firstAnswerTokenMeasuredCount` separately from the complete-latency
`measuredCount` so both percentile pairs carry their own sample size.

Judge-calibration labeling (SQR-392) is 30/33 complete via Brian's chat
batches. Findings routed out of the label stream:

- **SQR-396**: the character-ability import drops GHS `subActions` (verified
  against upstream `data/gh2e/character/deck/cragheart.json` — Opposing
  Strike's bottom action carries heal 2 → range 3 upstream, empty in our
  extract). Also FH ability text absent entirely (Blinkblade/Coral) and raw
  two-speed initiative encoding (2050 = 20 fast / 50 slow, per Brian).
- **SQR-397**: monster-ability import collapses duplicate physical cards
  (GHS FH Ancient Artillery: 8 cards with Exploding Ammunition ×2; our table:
  7 rows), losing deck composition.
- The repeated "missing monsters" scenario-answer failures in Brian's labels
  (batch-2 #18/#20, batch-3 #22/#24/#27/#28/#29) trace to the epoch-1
  template fast path: its scenario formatter had no monsters field even when
  the question asked for monsters. Direct evidence for the Phase 1 plan of
  record (replace templates with the fast model lane).
- Label reconciliations: #7 flipped to pass after Brian confirmed the
  checked-in 7-demon scenario-9 data is correct; #15-vs-#30 consistency
  question pending with Brian; #11 excluded (no ground-truth access).
- Two label contingencies verified against data before recording: Abael
  Herder "elite L5: muddle" note (present) and the Alchemist L1
  "characters cannot use potions" effect (present — the answer was grounded).

## 2026-07-05 — SQR-394: dataset rebalance toward synthesis and multi-hop

Hypothesis: adding Brian-approved rules-synthesis and multi-hop cases with
sourced ground truth will make per-class latency and correctness reporting
meaningful before any runtime tuning.

Change:

- Added 30 table-qa cases (all 30 candidates approved by Brian with no
  vetoes): 14 GH2e rules-synthesis from the official checked-in FAQ
  (`gh2-faq.html`), 6 FH rules-synthesis verified against rulebook chunk text,
  8 FH multi-hop conclusion/read-now chains and 2 GH2e section-parent
  traversals verified against `book_references`.
- Two FH candidates rephrased to stay corpus-answerable (flagged to Brian):
  retaliate timing (was "does retaliate trigger if the attacker kills me") and
  spent-item recovery (was "can I use items while long resting").
- Multi-hop cases carry trajectory expectations (traversal tool kind +
  required target ref) alongside judged answers.
- New totals: 180 table-qa (119 dev / 61 holdout); classes: 128 exact-lookup,
  40 rules-synthesis, 12 multi-hop. Distribution-floor tests added:
  ≥35 rules-synthesis and ≥10 multi-hop overall; ≥7 and ≥3 in holdout.
- All new cases carry epoch-2 latency budgets: 2500ms first-token,
  10000ms complete (the P95 bar as a per-case ceiling for synthesis and
  multi-hop).

Eval spend: $0 (deterministic authoring; ground truth from checked-in data,
upstream GHS files, and the local link graph).

Decision: keep, pending `npm run check` and LangSmith reseed in this slice's
PR. Epoch-2 baseline (SQR-395) remains blocked on calibration batch 4 and on
the item #15 / item #30 label reconciliation.
