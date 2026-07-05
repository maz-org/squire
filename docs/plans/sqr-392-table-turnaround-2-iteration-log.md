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
