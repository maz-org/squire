# SQR-159 Refreshed Model Comparison Report

Generated on 2026-05-03 after the post-SQR-149 prompt, eval, and data fixes.

## Decision

Keep Phase 1 production on `anthropic:claude-sonnet-4-6`.

This run improves the field materially: Sonnet and Opus both reached 29/29,
Haiku, GPT-5.5, and GPT-5.4 each reached 28/29, and the recent building,
Living Bones, exact item, and identity fixes all show up as passing evidence.

Sonnet remains the best production default because it is perfect in this run,
cheaper than Opus, already wired in production, and has no provider abstraction
risk. Opus also went 29/29, but costs more and does not buy us a visible quality
gain on this dataset. Haiku is now an excellent cheap-lane candidate, but still
missed one trajectory requirement. GPT-5.4 and GPT-5.5 are much stronger than in
SQR-149, but each still has a single important miss and would require production
multi-provider routing before they could be used live.

Do not use mini/nano for production answering.

## Source Run

Raw checked-in export:
[`docs/plans/sqr-159-full-matrix-report.json`](./sqr-159-full-matrix-report.json)

Prior SQR-149 export:
[`docs/plans/sqr-149-refreshed-full-matrix-report.json`](./sqr-149-refreshed-full-matrix-report.json)

Run label: `sqr-159-full-matrix-2026-05-03`

Langfuse project:
<https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn>

Command:

```bash
npm run eval -- --matrix --name=sqr-159-full-matrix-2026-05-03 \
  --allow-full-dataset --allow-estimated-cost --max-estimated-cost-usd=11 \
  --timeout-ms=60000 \
  --local-report=/tmp/sqr-159-full-matrix-2026-05-03.json
```

Data prep before the run:

```bash
npm run db:migrate
npm run seed:cards
```

Why those steps were needed after SQR-149:

- `#325` added `initial_build_cost`, `upgrade_cost`, and
  `campaign_start_built` to `card_buildings`, plus refreshed
  `data/extracted/buildings.json`.
- `#330` added a monster-stat FTS migration so empty immunity lists index as
  affirmative evidence.
- No `eval/dataset.json` changes landed after SQR-149, so Langfuse dataset
  reseeding was not needed.
- No scenario/section extract changes landed after SQR-149, so
  `seed:scenario-section-books` was not needed.

Sanity checks:

- Alchemist level 1 has `campaignStartBuilt: true`, zero
  `initialBuildCost`, and `upgradeCost` of 1 prosperity, 2 lumber, 2 metal,
  1 hide.
- `Living Bones immunities` retrieves the Living Bones monster-stat rows with
  empty `immunities` arrays.

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
- Provider concurrency: 1 Anthropic, 1 OpenAI.
- Guardrail estimate: $10.15 total, $1.45 per model.
- Summed provider-reported cost estimate: $3.19 total.

## Summary By Model

| Model                         |     Pass rate | Scored avg | Avg latency | P95 latency | Input tokens | Cached input | Output tokens | Total tokens | Provider cost | Avg tools | Avg loops | Failures | Delta vs SQR-149 |
| ----------------------------- | ------------: | ---------: | ----------: | ----------: | -----------: | -----------: | ------------: | -----------: | ------------: | --------: | --------: | -------: | ---------------: |
| `anthropic:claude-sonnet-4-6` |  29/29 (100%) |      1.000 |       10.5s |       18.9s |          192 |      134,652 |        13,907 |      342,019 |         $0.21 |      2.21 |      2.90 |        0 |               +2 |
| `anthropic:claude-opus-4-7`   |  29/29 (100%) |      1.000 |        9.2s |       16.5s |          341 |      154,021 |        13,100 |      374,020 |         $0.33 |      1.83 |      2.62 |        0 |               +3 |
| `anthropic:claude-haiku-4-5`  | 28/29 (96.6%) |      0.993 |        4.6s |        8.8s |      129,180 |       72,856 |         9,838 |      371,566 |         $0.16 |      2.14 |      2.97 |        1 |               +1 |
| `openai:gpt-5.5`              | 28/29 (96.6%) |      0.966 |       12.5s |       23.7s |      501,164 |      254,464 |        13,395 |      514,559 |         $1.76 |      3.21 |      4.21 |        1 |               +1 |
| `openai:gpt-5.4`              | 28/29 (96.6%) |      0.952 |        7.9s |       15.8s |      333,322 |      189,696 |         8,950 |      342,272 |         $0.54 |      2.41 |      3.41 |        1 |               +3 |
| `openai:gpt-5.4-mini`         | 25/29 (86.2%) |      0.869 |        5.3s |       10.5s |      281,165 |      163,840 |         5,671 |      286,836 |         $0.13 |      2.34 |      3.34 |        4 |               +8 |
| `openai:gpt-5.4-nano`         | 20/29 (69.0%) |      0.766 |        6.0s |        9.4s |      417,913 |      175,872 |         7,549 |      425,462 |         $0.06 |      3.24 |      4.24 |        9 |               +3 |

Token note: `Total tokens` is the provider-reported total from each eval row.
The visible `Input tokens`, `Cached input`, and `Output tokens` columns are the
normalized fields we track across providers. For OpenAI rows, `Cached input` is
a subset of `Input tokens`, so `Total tokens` generally matches
`Input tokens + Output tokens`. For Anthropic rows, `Total tokens` also includes
provider-specific cache creation / prompt-writing token classes that are not
shown as separate columns here, so it will not equal the visible column sum.

## Category Results

| Model                         | Rulebook | Monster stats | Buildings | Items | Scenarios | Tool-free | Trajectory |
| ----------------------------- | -------: | ------------: | --------: | ----: | --------: | --------: | ---------: |
| `anthropic:claude-sonnet-4-6` |      9/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |      12/12 |
| `anthropic:claude-opus-4-7`   |      9/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |      12/12 |
| `anthropic:claude-haiku-4-5`  |      9/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |      11/12 |
| `openai:gpt-5.5`              |      8/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |      12/12 |
| `openai:gpt-5.4`              |      9/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |      11/12 |
| `openai:gpt-5.4-mini`         |      8/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |       9/12 |
| `openai:gpt-5.4-nano`         |      4/9 |           3/3 |       1/1 |   2/2 |       1/1 |       1/1 |       8/12 |

## What Changed Since SQR-149

### Data fixes are visible in the eval

The cases affected by recent data prep now pass:

- `building-alchemist`: 7/7 models pass.
- `monster-living-bones-immunity`: 7/7 models pass.
- `item-spyglass`: 7/7 models pass.
- `item-crude-boots`: 7/7 models pass.

### SQR-153 identity fix is visible in the eval

`tool-free-assistant-game` passed for every model. Opus now answers the identity
question without volunteering Gloomhaven support.

### Exact item and Algox Archer trajectory fixes are visible

`traj-exact-item-open` and `traj-ambiguous-algox-archer` both passed for every
model in this run.

### Anthropic prompt caching changed the cost profile

SQR-158 prompt caching reduced Anthropic provider-cost estimates sharply. For
example, Sonnet dropped from $1.24 in SQR-149 to $0.21 in this run, and Opus
dropped from $2.22 to $0.33. That makes Opus less painful for evals, but it is
still more expensive than Sonnet and did not outperform Sonnet.

## Remaining Misses

Trace links below were fetched from the Langfuse API `htmlPath` field.

### `anthropic:claude-haiku-4-5`

- `traj-invalid-cross-game-ref`: final answer was correct, but trajectory failed
  because the model opened `section:frosthaven/67.1` directly instead of first
  calling `resolve_entity`.
  Trace:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-159-full-matrix-2026-05-03:anthropic:claude-haiku-4-5:traj-invalid-cross-game-ref>

### `openai:gpt-5.5`

- `rule-poison`: no tool calls. It said the retrieved context did not include
  the poison definition, so it failed to state the +1 attack effect and healing
  interaction.
  Trace:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-159-full-matrix-2026-05-03:openai:gpt-5.5:rule-poison>

### `openai:gpt-5.4`

- `traj-section-unlocks-scenario`: final answer was correct
  (`scenario:frosthaven/116`, Caravan Guards), but trajectory failed because
  the model did not use the required `neighbors` traversal.
  Trace:
  <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval:sqr-159-full-matrix-2026-05-03:openai:gpt-5.4:traj-section-unlocks-scenario>

### `openai:gpt-5.4-mini`

Failures:

- `rule-advantage`
- `traj-scenario-conclusion-open`
- `traj-section-unlocks-scenario`
- `traj-invalid-cross-game-ref`

Mini improved substantially from SQR-149, but it is still below the bar for
production answering.

### `openai:gpt-5.4-nano`

Failures:

- `rule-long-rest-steps`
- `rule-poison`
- `rule-advantage`
- `rule-small-items`
- `rule-looting-definition`
- `traj-scenario-conclusion-open`
- `traj-section-unlocks-scenario`
- `traj-rule-during-scenario`
- `traj-invalid-cross-game-ref`

Nano remains too unreliable for production answering.

## Recommendation

Production default: `anthropic:claude-sonnet-4-6`.

Secondary conclusions:

- `anthropic:claude-opus-4-7` is now quality-equivalent on this eval, but not
  worth switching to by default.
- `anthropic:claude-haiku-4-5` is the strongest cheap candidate. It is worth
  considering later for low-risk/background lanes, not table-facing answers yet.
- `openai:gpt-5.4` is the most improved OpenAI model and is now close enough to
  justify more eval work, but not production routing.
- `openai:gpt-5.5` is still too expensive and had a basic rule miss.
- `openai:gpt-5.4-mini` and `openai:gpt-5.4-nano` should stay out of scope for
  production answering.
