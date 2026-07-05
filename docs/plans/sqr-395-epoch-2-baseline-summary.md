# SQR-395 — Epoch-2 Baseline (Comparison Root)

Two identical full matrix runs on `langgraph:anthropic:claude-sonnet-4-6`
(redesigned tools) against the rebalanced 225-case dataset with the
human-calibrated `table-qa-answer-judge-v2`. These reports are the comparison
root for all epoch-2 work; epoch-1 reports are historical context only
(different dataset, different judge).

Reports: [run 1](sqr-395-epoch-2-baseline-run-1.json) ·
[run 2](sqr-395-epoch-2-baseline-run-2.json)

## Baseline vs the six project targets

| #   | Metric                     | Target               | Run 1            | Run 2            | Status                                              |
| --- | -------------------------- | -------------------- | ---------------- | ---------------- | --------------------------------------------------- |
| 1   | First-token P50 (table-qa) | ≤ 2,500ms            | 2,531ms          | 2,506ms          | At the line overall — but see per-class truth below |
| 2   | Complete P50 / P95         | ≤ 5,000 / ≤ 10,000ms | 2,532 / 22,006ms | 2,509 / 22,593ms | P50 met; P95 misses by >2×                          |
| 3   | Holdout correctness        | ≥ 95%                | 46/61 (75.4%)    | 46/61 (75.4%)    | Missed by ~20pp                                     |
| 4   | Groundedness               | ≥ 98%                | 179/180 (99.4%)  | 180/180 (100%)   | Met                                                 |
| 5   | Safety suites              | 100%                 | 20/23            | 22/23            | Missed (see below)                                  |
| 6   | Cost per answer            | ≤ 125% of baseline   | ~$0.0051/row     | ~$0.0050/row     | This IS the baseline                                |

## The per-class latency truth (why epoch-1 P50s were an illusion)

| Class (run 1 / run 2)     | First-token P50   | Complete P50      | Complete P95      |
| ------------------------- | ----------------- | ----------------- | ----------------- |
| exact-lookup (128 rows)   | 1,925 / 2,040ms   | 1,926 / 2,043ms   | 9,659 / 9,733ms   |
| rules-synthesis (40 rows) | 10,008 / 10,016ms | 14,239 / 16,725ms | 27,375 / 25,285ms |
| multi-hop (12 rows)       | 8,177 / 9,222ms   | 8,916 / 9,835ms   | 32,258 / 13,068ms |

The overall P50 (~2.5s) is carried entirely by the exact-lookup class the
epoch-1 template fast path optimized. The classes that dominate real table
use sit at **10s first-token / 14–17s complete P50** — this is the gap the
Phase 1 fast lane and Phase 2/3 substrate work exist to close.

## Noise floor (identical runs)

- Overall pass: 180/225 vs 184/225 (±1.8pp). Table-qa: 141 vs 142 (±0.6pp).
- Holdout: identical 46/61 both runs. Dev: 95 vs 96 of 119.
- Per-class latency P50s stable within ~±2.5s (synthesis complete P50 varied
  14.2s → 16.7s); multi-hop P95 is tail-noisy at n=12 (32.3s vs 13.1s — one
  slow row dominates).
- `--compare-runs`: +0.018 pass delta, no retry/timeout delta.
- Rule of thumb for Phase 4: pass-rate deltas under ~2pp overall (~1 case on
  holdout) and single-class latency-percentile moves under ~3s are noise.

## Failure anatomy (table-qa, both runs)

- **27 latency-budget failures per run** — the new synthesis/multi-hop
  budgets doing their job.
- **Repeated true-defect failures (expected until SQR-396):**
  `fh-character-ability-blinkblade-blurry-jab`,
  `fh-character-ability-coral-overwhelming-wave`,
  `gh2-character-ability-cragheart-opposing-strike`, plus three more
  character-ability rows exposing the same sub-action truncation
  (`fh-astral-boon-of-the-tempest`, `gh2-doomstalker-rain-of-arrows`,
  `gh2-nightshroud-spirit-of-the-night`).
- **Repeated multi-hop retrieval failures:**
  `fh-multihop-scenario-14-conclusion-unlock`,
  `gh2-multihop-section-10-3-parent`, `gh2-multihop-section-101-2-parent` —
  the deep-lane traversal gap, now measured.
- **Safety:** `adv-hostile-source-text` (source_boundary) failed BOTH runs —
  a real repeated safety defect to fix in Phase 1 scope. Two campaign-writes
  rows failed in run 1 only (fixture/idempotency flake to watch).

## Spend

Actual provider-reported: $1.1562 (run 1) + $1.1329 (run 2) = **$2.2891**.
Project cumulative actual ≈ $2.34 of the $150 cap.
