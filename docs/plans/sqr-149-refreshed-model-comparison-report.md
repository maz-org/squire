# SQR-149 Refreshed Model Comparison Report

Generated on 2026-05-03 for SQR-149, as a fresh SQR-134 comparison after the
SQR-141, SQR-142, SQR-144, SQR-145, and SQR-140 follow-ups.

## Decision

Keep Phase 1 production on `anthropic:claude-sonnet-4-6`.

Do not add production multi-provider routing now. The refreshed run shows real
improvement in the eval-only OpenAI lane, especially after the loop-limit fixes,
but the production risk/reward still does not justify routing live user traffic
through multiple providers.

The top four models are now close on raw pass count:

- `anthropic:claude-sonnet-4-6`: 27/29
- `anthropic:claude-haiku-4-5`: 27/29
- `openai:gpt-5.5`: 27/29
- `anthropic:claude-opus-4-7`: 26/29

Sonnet remains the conservative default because it still has perfect trajectory
coverage, lower cost than Opus, no provider instability, and no need for a
production provider abstraction. Opus also passed every trajectory case, but it
costs more and failed more final-answer cases. Haiku and GPT-5.5 are both better
than before, but each still missed `traj-exact-item-open`.

## Source Run

Raw checked-in export:
[`docs/plans/sqr-149-refreshed-full-matrix-report.json`](./sqr-149-refreshed-full-matrix-report.json)

Prior SQR-134 expanded export:
[`docs/plans/sqr-134-expanded-full-matrix-report.json`](./sqr-134-expanded-full-matrix-report.json)

Run label: `sqr-149-refreshed-full-matrix-2026-05-03`

Langfuse project:
<https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn>

Command:

```bash
npm run eval -- --matrix --allow-full-dataset --allow-estimated-cost \
  --max-estimated-cost-usd=15 --retry-count=1 --timeout-ms=60000 \
  --anthropic-concurrency=2 --openai-concurrency=2 \
  --run-label=sqr-149-refreshed-full-matrix-2026-05-03 \
  --local-report=docs/plans/sqr-149-refreshed-full-matrix-report.json
```

Before the run, card data was migrated and reseeded:

```bash
npm run db:migrate && npm run seed:cards
```

Seed result included `items: upserted 264`, so the Crude Boots craft-cost fix
from SQR-145 was present in Postgres for the eval tools.

Run settings:

- Dataset: 29 eval cases, 203 model-case rows.
- Tool surface: `redesigned`.
- Models:
  - `anthropic:claude-sonnet-4-6`
  - `anthropic:claude-opus-4-7`
  - `anthropic:claude-haiku-4-5`
  - `openai:gpt-5.5`
  - `openai:gpt-5.4`
  - `openai:gpt-5.4-mini`
  - `openai:gpt-5.4-nano`
- Provider timeout: 60 seconds.
- Retry count: 1.
- Provider concurrency: 2 Anthropic, 2 OpenAI.
- Guardrail estimate: $10.15 total, $1.45 per model.

The refreshed report includes `tokenCachedInput`, so OpenAI provider cost now
reflects cached-input discounts where the runner reported cached input. The
prior SQR-134 report did not have that field, so provider-cost deltas are not
apples to apples.

## Summary By Model

| Model                         |     Pass rate | Scored avg | Avg latency | P95 latency | Input tokens | Cached input | Output tokens | Total tokens | Provider cost | Avg tools | Avg loops | Failures | Delta vs SQR-134 |
| ----------------------------- | ------------: | ---------: | ----------: | ----------: | -----------: | -----------: | ------------: | -----------: | ------------: | --------: | --------: | -------: | ---------------: |
| `anthropic:claude-sonnet-4-6` | 27/29 (93.1%) |      0.959 |       10.8s |       19.3s |      343,838 |            0 |        13,922 |      357,760 |         $1.24 |      2.31 |      3.03 |        2 |               -1 |
| `anthropic:claude-opus-4-7`   | 26/29 (89.7%) |      0.945 |       10.4s |       18.4s |      372,954 |            0 |        14,331 |      387,285 |         $2.22 |      2.00 |      2.76 |        3 |               -1 |
| `anthropic:claude-haiku-4-5`  | 27/29 (93.1%) |      0.931 |        5.0s |        9.8s |      361,912 |            0 |        10,597 |      372,509 |         $0.41 |      2.48 |      3.24 |        2 |               +1 |
| `openai:gpt-5.5`              | 27/29 (93.1%) |      0.945 |       15.0s |       26.1s |    1,160,011 |      850,176 |        15,514 |    1,175,525 |         $2.44 |      3.38 |      4.38 |        2 |               +1 |
| `openai:gpt-5.4`              | 25/29 (86.2%) |      0.841 |        9.5s |       16.4s |      854,969 |      688,896 |        10,148 |      865,117 |         $0.74 |      2.52 |      3.52 |        4 |               +1 |
| `openai:gpt-5.4-mini`         | 17/29 (58.6%) |      0.586 |        6.3s |       10.7s |      857,331 |      723,200 |         5,828 |      863,159 |         $0.18 |      2.66 |      3.66 |       12 |               -2 |
| `openai:gpt-5.4-nano`         | 17/29 (58.6%) |      0.614 |        6.8s |       12.1s |      778,495 |      609,024 |         6,622 |      785,117 |         $0.05 |      2.34 |      3.34 |       12 |               +2 |

## Category Results

| Model                         | Rulebook | Monster stats | Buildings | Items | Scenarios | Tool-free | Trajectory |
| ----------------------------- | -------: | ------------: | --------: | ----: | --------: | --------: | ---------: |
| `anthropic:claude-sonnet-4-6` |      9/9 |           2/3 |       1/1 |   1/2 |       1/1 |       1/1 |      12/12 |
| `anthropic:claude-opus-4-7`   |      9/9 |           3/3 |       0/1 |   1/2 |       1/1 |       0/1 |      12/12 |
| `anthropic:claude-haiku-4-5`  |      9/9 |           3/3 |       1/1 |   1/2 |       1/1 |       1/1 |      11/12 |
| `openai:gpt-5.5`              |      9/9 |           3/3 |       1/1 |   1/2 |       1/1 |       1/1 |      11/12 |
| `openai:gpt-5.4`              |      9/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |       8/12 |
| `openai:gpt-5.4-mini`         |      9/9 |           2/3 |       1/1 |   2/2 |       0/1 |       1/1 |       2/12 |
| `openai:gpt-5.4-nano`         |      6/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |       3/12 |

## What Changed Since SQR-134

### Crude Boots is fixed as eval evidence

`item-crude-boots` now passed for every model. Representative traces:

- Haiku:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aanthropic%3Aclaude-haiku-4-5%3Aitem-crude-boots>
- GPT-5.5:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aopenai%3Agpt-5.5%3Aitem-crude-boots>

Both answers used the current source data: legs slot, +1 Move during a move
ability, and craft cost 2 hide.

### GPT-5.5 loop-limit failure is gone in this run

`openai:gpt-5.5` passed `traj-card-fuzzy-vs-exact`, the prior loop-limit case:

<https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aopenai%3Agpt-5.5%3Atraj-card-fuzzy-vs-exact>

It still used 119,327 tokens, 8 tool calls, 9 loops, and 52.2s latency. That is
no longer a correctness blocker, but it remains a production-risk signal.

### No provider errors, timeouts, or loop-limit rows

All 203 rows completed. The only non-`none` failure class was `quality`, and
those six rows were judge-quality failures rather than provider/runtime errors.

### Spyglass is now the suspicious fixture

`item-spyglass` failed for Sonnet, Opus, Haiku, and GPT-5.5. The models mostly
answered from current checked-in data, but the fixture expects a different item
shape:

- Current `data/extracted/items.json`: item #001, head slot, craft cost 1 metal,
  spent, no printed use count.
- Current `eval/dataset.json`: item #001, costs 40 gold, small item slot, 2
  uses.

That mismatch is not clean model-failure evidence. Follow-up filed: SQR-150.
Post-report note: SQR-150 has since landed on `main`, so future runs should use
the corrected Spyglass fixture. This report still describes the 2026-05-03 run
as executed.

Adjusted view if `item-spyglass` is excluded as bad evidence:

| Model                         | Pass rate without `item-spyglass` | Remaining failures                               |
| ----------------------------- | --------------------------------: | ------------------------------------------------ |
| `anthropic:claude-sonnet-4-6` |                             27/28 | `monster-living-bones-immunity`                  |
| `anthropic:claude-opus-4-7`   |                             26/28 | `building-alchemist`, `tool-free-assistant-game` |
| `anthropic:claude-haiku-4-5`  |                             27/28 | `traj-exact-item-open`                           |
| `openai:gpt-5.5`              |                             27/28 | `traj-exact-item-open`                           |
| `openai:gpt-5.4`              |                             24/28 | 4 trajectory cases                               |
| `openai:gpt-5.4-mini`         |                             16/28 | 12 cases                                         |
| `openai:gpt-5.4-nano`         |                             16/28 | 12 cases                                         |

Even under that adjusted view, Sonnet remains the safer default because its only
remaining failure is a final-answer miss, while Haiku and GPT-5.5 still miss the
same exact-open trajectory case.

## Failure Modes

### `anthropic:claude-sonnet-4-6`

Failures:

- `monster-living-bones-immunity`: answered as if the monster stat record was
  not indexed, even though the checked-in monster-stat rows have empty
  `immunities` arrays.
- `item-spyglass`: likely fixture mismatch, tracked as SQR-150.

Representative failure:

<https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aanthropic%3Aclaude-sonnet-4-6%3Amonster-living-bones-immunity>

### `anthropic:claude-opus-4-7`

Failures:

- `building-alchemist`
- `item-spyglass`, likely fixture mismatch
- `tool-free-assistant-game`, because it hedged with Gloomhaven support instead
  of the required one-sentence Frosthaven-only answer

Opus passed every trajectory case, but it does not beat Sonnet on pass count or
cost.

### `anthropic:claude-haiku-4-5`

Failures:

- `item-spyglass`, likely fixture mismatch
- `traj-exact-item-open`

Haiku improved from 26/29 to 27/29, fixed its old
`traj-scenario-conclusion-open` miss, and remains the strongest cheap candidate.
It is still not safe as the default answer model because it failed an exact-open
trajectory case.

Representative trajectory miss:

<https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aanthropic%3Aclaude-haiku-4-5%3Atraj-exact-item-open>

### `openai:gpt-5.5`

Failures:

- `item-spyglass`, likely fixture mismatch
- `traj-exact-item-open`

GPT-5.5 improved from 26/29 to 27/29 and no longer showed the prior loop-limit
failure mode. It still has higher average latency than Sonnet and needs a
production provider abstraction before it could be considered for live routing.

Representative trajectory miss:

<https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aopenai%3Agpt-5.5%3Atraj-exact-item-open>

### `openai:gpt-5.4`

Failures:

- `traj-exact-item-open`
- `traj-ambiguous-algox-archer`
- `traj-rule-during-scenario`
- `traj-card-fuzzy-vs-exact`

GPT-5.4 improved one pass over SQR-134 but is still not viable for the answer
path because it missed 4 of 12 trajectory cases.

### `openai:gpt-5.4-mini` and `openai:gpt-5.4-nano`

Both remain too weak for the answer path. Their costs are low, but trajectory
performance is not close enough:

- GPT-5.4-mini: 2/12 trajectory.
- GPT-5.4-nano: 3/12 trajectory.

## Representative Langfuse Traces

Wins:

- Sonnet `traj-card-fuzzy-vs-exact`:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aanthropic%3Aclaude-sonnet-4-6%3Atraj-card-fuzzy-vs-exact>
- Opus `traj-card-fuzzy-vs-exact`:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aanthropic%3Aclaude-opus-4-7%3Atraj-card-fuzzy-vs-exact>
- GPT-5.5 `traj-card-fuzzy-vs-exact`:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aopenai%3Agpt-5.5%3Atraj-card-fuzzy-vs-exact>
- Haiku `item-crude-boots`:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aanthropic%3Aclaude-haiku-4-5%3Aitem-crude-boots>

Losses:

- Sonnet `monster-living-bones-immunity`:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aanthropic%3Aclaude-sonnet-4-6%3Amonster-living-bones-immunity>
- Haiku `traj-exact-item-open`:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aanthropic%3Aclaude-haiku-4-5%3Atraj-exact-item-open>
- GPT-5.5 `traj-exact-item-open`:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aopenai%3Agpt-5.5%3Atraj-exact-item-open>
- GPT-5.4 `traj-card-fuzzy-vs-exact`:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aopenai%3Agpt-5.4%3Atraj-card-fuzzy-vs-exact>

Confusing/stale-evidence cases:

- Sonnet `item-spyglass`:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aanthropic%3Aclaude-sonnet-4-6%3Aitem-spyglass>
- GPT-5.5 `item-spyglass`:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-149-refreshed-full-matrix-2026-05-03%3Aopenai%3Agpt-5.5%3Aitem-spyglass>

## Follow-Ups

- SQR-150: fix the stale `item-spyglass` eval fixture. Landed after this run.
- Existing SQR-146: harden `resourcesAny` craft-cost handling and tests.

No production multi-provider refactor is justified by this run.
