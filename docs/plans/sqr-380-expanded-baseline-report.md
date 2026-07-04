<!-- markdownlint-disable MD013 -->

# SQR-380 Expanded Baseline Report

Run label: `sqr-380-expanded-baseline-production-config`

Generated: 2026-07-04T21:42:03.270Z

Command:

```bash
npm run eval -- --matrix --run-label=sqr-380-expanded-baseline-production-config --allow-full-dataset --allow-estimated-cost --max-estimated-cost-usd=20 --local-report=docs/plans/sqr-380-expanded-baseline-report.json
```

Scope:

- Runtime/model: `langgraph:anthropic:claude-sonnet-4-6` with redesigned tools.
- Cases: 195 total across Frosthaven and Gloomhaven 2e.
- Table QA: 150 cases, split 100 dev / 50 holdout.
- Other suites: 22 trajectory, 8 adversarial boundary, 5 campaign personalization, 7 campaign writes, 3 cross-game boundary.
- Complete row-level data: [sqr-380-expanded-baseline-report.json](sqr-380-expanded-baseline-report.json).

Estimated spend:

- Provider: $1.2653.
- Guardrail estimate: $9.7500.
- Combined estimate: $11.0153, under the project cap of $100.

## Headline Metrics

| Slice                    | Cases |            Pass | Answer score >= 0.8 |   Groundedness | Complete P50 | Complete P95 | First token P50 | First token P95 |
| ------------------------ | ----: | --------------: | ------------------: | -------------: | -----------: | -----------: | --------------: | --------------: |
| All                      |   195 | 119/195 (61.0%) |     183/193 (94.8%) | 87/148 (58.8%) |       8755ms |      27600ms |          8093ms |         17992ms |
| Table QA                 |   150 |  82/150 (54.7%) |     142/148 (95.9%) | 87/148 (58.8%) |       8001ms |      23698ms |          7780ms |         16797ms |
| Trajectory               |    22 |   19/22 (86.4%) |       19/22 (86.4%) |            n/a |      16324ms |      29411ms |         11488ms |         29367ms |
| Adversarial boundary     |     8 |     5/8 (62.5%) |        8/8 (100.0%) |            n/a |      23017ms |      28007ms |         14579ms |         19060ms |
| Campaign personalization |     5 |     4/5 (80.0%) |         4/5 (80.0%) |            n/a |       3652ms |      38425ms |          3565ms |         32680ms |
| Campaign writes          |     7 |    7/7 (100.0%) |        7/7 (100.0%) |            n/a |      15777ms |      21501ms |          9479ms |         13836ms |
| Cross-game boundary      |     3 |     2/3 (66.7%) |        3/3 (100.0%) |            n/a |      17503ms |      19218ms |         17075ms |         19148ms |

## Table QA Split

| Slice                 | Cases |          Pass | Answer score >= 0.8 |   Groundedness | Complete P50 | Complete P95 | First token P50 | First token P95 |
| --------------------- | ----: | ------------: | ------------------: | -------------: | -----------: | -----------: | --------------: | --------------: |
| Frosthaven dev        |    49 | 45/49 (91.8%) |       47/49 (95.9%) |  48/49 (98.0%) |       7461ms |      23937ms |          7263ms |         16549ms |
| Frosthaven holdout    |    25 | 22/25 (88.0%) |      24/24 (100.0%) | 24/24 (100.0%) |       7688ms |      13236ms |          7336ms |         13232ms |
| Gloomhaven 2e dev     |    51 | 14/51 (27.5%) |       49/51 (96.1%) |  14/51 (27.5%) |       8825ms |      24962ms |          8745ms |         17628ms |
| Gloomhaven 2e holdout |    25 |   1/25 (4.0%) |       22/24 (91.7%) |    1/24 (4.2%) |       7931ms |      10708ms |          7508ms |         10538ms |

## Failure Clusters

| Failure class            | Count | Notes                                                                                                                                                                                                |
| ------------------------ | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Groundedness             |    61 | 60 are Gloomhaven 2e table-qa cases where canonical refs point at `gloomhavensecretariat:*`, which the scorer treats as wrong-game refs. One Frosthaven case lacked source labels or canonical refs. |
| Tool                     |    29 | Passing rows with tool-use classification. Not a failure.                                                                                                                                            |
| Latency budget           |     3 | Frosthaven table-qa rows where answer quality and groundedness passed, but configured 2500ms first-token / 5000ms complete budgets failed.                                                           |
| Retrieval                |     3 | Two Gloomhaven 2e trajectory failures and one Frosthaven trajectory failure.                                                                                                                         |
| Source boundary          |     3 | Adversarial boundary cases accepted or used hostile source content.                                                                                                                                  |
| Provider error           |     2 | LangGraph recursion limit hit for `fh-scenario-4a-heart-of-ice-a` and `gh2-character-mat-bladewarm`.                                                                                                 |
| Safety                   |     2 | One Frosthaven table-qa correction case and one Gloomhaven 2e campaign-personalization private-extraction case.                                                                                      |
| Answer quality           |     1 | `fh-monster-ability-ancient-artillery-long-shot`.                                                                                                                                                    |
| Cross-game contamination |     1 | `boundary-scenario-61-fh-then-gh2`.                                                                                                                                                                  |

## Latency Budget Misses

Six table-qa rows missed the explicit 2500ms first-token / 5000ms complete-answer budget. Three are shown as primary `latency_budget` failures; the three Gloomhaven 2e rows also failed groundedness, so their primary failure class is groundedness.

| Case                                     | Game          | Complete | First token |
| ---------------------------------------- | ------------- | -------: | ----------: |
| `item-crude-helmet`                      | Frosthaven    |   5615ms |      5612ms |
| `building-mining-camp-level-1`           | Frosthaven    |   7181ms |      7178ms |
| `scenario-7-edge-world-unlocks`          | Frosthaven    |   5309ms |      5306ms |
| `gh2-monster-living-bones-elite-level-1` | Gloomhaven 2e |   9570ms |      9478ms |
| `gh2-scenario-4-crypt-damned`            | Gloomhaven 2e |   8060ms |      8053ms |
| `gh2-item-winged-shoes`                  | Gloomhaven 2e |  12413ms |     12089ms |

## Readout

The answer judge is not the limiting factor in this baseline: table-qa answer scores clear 95.9% overall, and both games are above 91% on score-only pass rate. The main answer-quality blocker is deterministic groundedness for Gloomhaven 2e. The runtime is returning answers that score well semantically, but the recorded canonical refs are classified as wrong-game refs, collapsing Gloomhaven 2e table-qa pass rate to 15/76.

Latency is still above the project bar. Even excluding provider-error rows, table-qa first-token P50 is 7780ms and complete-answer P50 is 8001ms. The current path is not close to the 2.5s / 5s explicit budget on the cases where that budget is configured.

The next distinct issue should fix the Gloomhaven 2e canonical-ref game mapping before tuning answer prompts. After that, latency work can be measured without the groundedness scorer hiding otherwise-correct Gloomhaven 2e answers.

## LangSmith Experiments

- Frosthaven table-qa: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/8d9b8396-c005-4e0e-998d-e9720b099b3e>
- Frosthaven trajectory: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d437eadf-58c7-4565-903f-37253432bde0>
- Adversarial boundary: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/8ba307fc-183f-4354-af93-d3bf14d57d09>
- Gloomhaven 2e campaign personalization: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/26d33ca7-2833-44c3-bb92-3cd9bb84e953>
- Frosthaven campaign personalization: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/f3e72e6a-661f-49e1-a3dc-dc1c2aa9d0be>
- Gloomhaven 2e campaign writes: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/23b5f20d-adbe-4159-a88b-0213e3b422de>
- Frosthaven campaign writes: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d423ecde-eea8-4e28-b35c-e2f50643760f>
- Cross-game boundary: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/ba693439-c02b-40d4-8cad-232f71709e42>
- Gloomhaven 2e table-qa: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/9fa3f910-d274-455d-8d2e-3771cb3528fe>
- Gloomhaven 2e trajectory: <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/2b15c402-af0e-4f77-ad3c-f61b7e9460cc>
