<!-- markdownlint-disable MD013 -->

# SQR-383 Post-Groundedness Baseline Summary

Run label: `sqr-383-post-groundedness-expanded-baseline`

Generated: 2026-07-04T23:29:32.860Z

Command:

```bash
npm run eval -- --matrix --run-label=sqr-383-post-groundedness-expanded-baseline --allow-full-dataset --allow-estimated-cost --max-estimated-cost-usd=20 --local-report=docs/plans/sqr-383-post-groundedness-expanded-baseline-report.json
```

Scope:

- Runtime/model: `langgraph:anthropic:claude-sonnet-4-6` with redesigned tools.
- Cases: 195 total across Frosthaven and Gloomhaven 2e.
- Table QA: 150 cases, split 100 dev / 50 holdout.
- Other suites: 22 trajectory, 8 adversarial boundary, 5 campaign personalization, 7 campaign writes, 3 cross-game boundary.
- Row-level artifacts:
  [JSON](sqr-383-post-groundedness-expanded-baseline-report.json),
  [TSV](sqr-383-post-groundedness-expanded-baseline-report.tsv), and
  [full Markdown table](sqr-383-post-groundedness-expanded-baseline-report.md).

Estimated spend:

- Provider: $1.2668.
- Guardrail estimate: $9.7500.
- Combined estimate: $11.0168, under the project cap of $100.

## Before/After

Baseline is SQR-380, before the Gloomhaven 2e canonical-ref fix. Rerun is this
SQR-383 report.

| Slice                  | Metric              | SQR-380 baseline |   SQR-383 rerun |
| ---------------------- | ------------------- | ---------------: | --------------: |
| All                    | Pass                |  119/195 (61.0%) | 172/195 (88.2%) |
| All                    | Groundedness        |   87/148 (58.8%) | 147/149 (98.7%) |
| Table QA               | Pass                |   82/150 (54.7%) | 135/150 (90.0%) |
| Table QA               | Answer score >= 0.8 |  142/148 (95.9%) | 143/149 (96.0%) |
| Table QA               | Groundedness        |   87/148 (58.8%) | 147/149 (98.7%) |
| Table QA               | Complete P50        |           8001ms |          7169ms |
| Table QA               | Complete P95        |          23698ms |         22403ms |
| Table QA               | First-token P50     |           7780ms |          7096ms |
| Table QA               | First-token P95     |          16797ms |         15120ms |
| Frosthaven table QA    | Pass                |    67/74 (90.5%) |   68/74 (91.9%) |
| Gloomhaven 2e table QA | Pass                |    15/76 (19.7%) |   67/76 (88.2%) |
| Gloomhaven 2e table QA | Groundedness        |    15/75 (20.0%) |   74/75 (98.7%) |
| Gloomhaven 2e dev      | Pass                |    14/51 (27.5%) |   47/51 (92.2%) |
| Gloomhaven 2e holdout  | Pass                |      1/25 (4.0%) |   20/25 (80.0%) |

## Current Failure Shape

Table QA now has 15 failing rows instead of 68. The remaining primary failure
classes are:

| Failure class  | Count | Notes                                                                                                                  |
| -------------- | ----: | ---------------------------------------------------------------------------------------------------------------------- |
| Answer quality |     5 | Four Gloomhaven 2e ability rows and one Frosthaven scenario row scored below threshold.                                |
| Latency budget |     5 | Rows scored and grounded correctly but missed the explicit 2500ms first-token / 5000ms complete-answer budget.         |
| Groundedness   |     2 | One Frosthaven scenario with no recorded refs; one Gloomhaven 2e section case with a bare `67.1` ref.                  |
| Provider error |     1 | `gh2-character-mat-bladewarm` returned no scored answer.                                                               |
| Safety         |     1 | `drifter-ignore-negative-item-effects-correction`.                                                                     |
| Tool           |     1 | `gh2-monster-living-bones-elite-level-1` is semantically and groundedness-correct but still missed its latency budget. |

The broad Gloomhaven 2e wrong-game groundedness failure is fixed. One Gloomhaven
2e section-book case still records a bare section ref (`67.1`) and should be
handled as a small follow-up, but it is no longer the main limiter.

Latency remains the project blocker. Even after the ref fix, table QA first-token
P50 is 7096ms and complete-answer P50 is 7169ms. The configured explicit budget
is 2500ms first token and 5000ms complete answer on the rows that carry a
latency bar, and the median table path is still above both numbers.

## Failing Table Rows

| Case                                                    | Game          | Split   | Failure class  | Score | Groundedness | Complete | First token |
| ------------------------------------------------------- | ------------- | ------- | -------------- | ----: | ------------ | -------: | ----------: |
| `building-mining-camp-level-1`                          | Frosthaven    | holdout | latency_budget |     1 | pass         |   5018ms |      5016ms |
| `fh-scenario-4b-heart-of-ice-b`                         | Frosthaven    | dev     | groundedness   |   0.2 | fail         |  21002ms |     15391ms |
| `scenario-7-edge-world-unlocks`                         | Frosthaven    | holdout | latency_budget |     1 | pass         |   6356ms |      6354ms |
| `fh-scenario-4a-heart-of-ice-a`                         | Frosthaven    | holdout | answer_quality |   0.2 | pass         |  45736ms |     32921ms |
| `drifter-ignore-negative-item-effects-correction`       | Frosthaven    | dev     | safety         |     1 | pass         |   6876ms |      6874ms |
| `item-crude-helmet`                                     | Frosthaven    | dev     | latency_budget |     1 | pass         |   5327ms |      5325ms |
| `gh2-monster-living-bones-elite-level-1`                | Gloomhaven 2e | holdout | tool           |     1 | pass         |   7307ms |      7305ms |
| `gh2-monster-ability-ancient-artillery-long-shot`       | Gloomhaven 2e | dev     | answer_quality |   0.2 | pass         |  21718ms |     21716ms |
| `gh2-character-ability-cragheart-opposing-strike`       | Gloomhaven 2e | dev     | answer_quality |   0.6 | pass         |   8435ms |      8432ms |
| `gh2-scenario-4-crypt-damned`                           | Gloomhaven 2e | holdout | latency_budget |     1 | pass         |   7214ms |      7212ms |
| `gh2-item-winged-shoes`                                 | Gloomhaven 2e | dev     | latency_budget |     1 | pass         |   5145ms |      5144ms |
| `gh2-character-mat-bladewarm`                           | Gloomhaven 2e | holdout | provider_error |   n/a | n/a          |      n/a |         n/a |
| `gh2-character-ability-nightshroud-spirit-of-the-night` | Gloomhaven 2e | holdout | answer_quality |   0.6 | pass         |   7244ms |      7243ms |
| `gh2-character-ability-doomstalker-rain-of-arrows`      | Gloomhaven 2e | holdout | answer_quality |   0.4 | pass         |   6491ms |      6489ms |
| `gh2-section-67-1`                                      | Gloomhaven 2e | dev     | groundedness   |     1 | fail         |   7265ms |      7263ms |

## Decision

Keep this as the post-groundedness baseline. SQR-381 recovered the large
Gloomhaven 2e measurement failure without prompt tuning: table QA moved from
54.7% pass to 90.0% pass, and Gloomhaven 2e table groundedness moved from 20.0%
to 98.7%.

The next distinct issue should reduce table QA latency for exact structured
lookups and rule lookups. The table path still waits roughly 7 seconds for the
first answer token at P50, so users still wait too long even when the final
answer is correct and grounded.

## LangSmith Experiments

- Frosthaven table QA: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/b0193d49-e09c-447b-bd71-c1eab74f688a>
- Frosthaven trajectory: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f948f558-556f-48a2-b583-88bdc2293cc1>
- Adversarial boundary: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/ae03a05d-4256-440f-9401-47b3537759c6>
- Gloomhaven 2e campaign personalization: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f360bf4c-b109-47fd-99dd-055bbe6e62e5>
- Frosthaven campaign personalization: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/a6973c99-d5eb-425b-9b36-6f0cd6c334d6>
- Gloomhaven 2e campaign writes: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/46ffb594-e3b7-45a1-88b4-8de7cd83f046>
- Frosthaven campaign writes: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/623ec989-0596-4d4d-9332-6a11b2b68496>
- Cross-game boundary: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/e2f6ef1e-8b80-4ddf-b83d-f41cf483bd64>
- Gloomhaven 2e table QA: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/3b2f3b6a-f2d9-495c-913d-3a2e9ffe3a2e>
- Gloomhaven 2e trajectory: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/735c8d3a-3869-4067-8f92-4fb70be623c2>
