# SQR-144 Haiku 4.5 Cheap Eval Lane Investigation

Generated on 2026-05-03 for SQR-144.

## Recommendation

Keep `anthropic:claude-haiku-4-5` eval-only for Phase 1. Do not route
production answers to Haiku yet.

Haiku should not be rejected. The three SQR-134 failure rows do not show a clean
"model cannot do this" pattern:

- `building-alchemist` now passes on replay, and the old failure was mostly a
  judge/rubric mismatch.
- `traj-scenario-conclusion-open` now passes on replay after Haiku opened the
  required section.
- `item-crude-boots` still fails, but the retrieved structured item data says
  the item cost is `null`, while the eval expects 2 gold.

The safe use for now is a cheap comparison lane in evals. A future cheap helper
is plausible for narrow, non-final tasks such as intent/source classification or
checking whether a query has an exact entity match, but only after the item data
issue is fixed and repeated Haiku runs stay stable.

## Replay Runs

Source failed run:
`sqr-134-expanded-full-matrix-2026-05-02`

Fresh replay run:
`sqr-144-haiku-replay-2026-05-03`

Fresh replay commands:

```bash
npm run eval -- --provider=anthropic --model=claude-haiku-4-5 \
  --id=building-alchemist --run-label=sqr-144-haiku-replay-2026-05-03 \
  --timeout-ms=60000
npm run eval -- --provider=anthropic --model=claude-haiku-4-5 \
  --id=item-crude-boots --run-label=sqr-144-haiku-replay-2026-05-03 \
  --timeout-ms=60000
npm run eval -- --provider=anthropic --model=claude-haiku-4-5 \
  --id=traj-scenario-conclusion-open \
  --run-label=sqr-144-haiku-replay-2026-05-03 --timeout-ms=60000
```

Fresh results:

| Case                            | Old result       | Fresh result     | Classification                              |
| ------------------------------- | ---------------- | ---------------- | ------------------------------------------- |
| `building-alchemist`            | Fail, quality    | Pass, 4/5        | Rubric/judge mismatch                       |
| `item-crude-boots`              | Fail, quality    | Fail, 2/5        | Fixture/data mismatch                       |
| `traj-scenario-conclusion-open` | Fail, trajectory | Pass, trajectory | Tool-loop instability, not a hard model gap |

## Case Analysis

### `building-alchemist`

Old trace:
<https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aanthropic%3Aclaude-haiku-4-5%3Abuilding-alchemist>

Fresh trace:
<https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-144-haiku-replay-2026-05-03%3Aanthropic%3Aclaude-haiku-4-5%3Abuilding-alchemist>

Old run:

- Tools: `open_entity` then `resolve_entity`.
- Canonical ref: `card:frosthaven/buildings/gloomhavensecretariat:building/35/L1`.
- Answer: level 1 Alchemist costs nothing to build, then says the effect is
  "Characters cannot use potions."
- Judge failed it because it treated the effect line as incorrect and wanted
  level 1 upgrade-cost context.

Fresh run:

- Tools: `resolve_entity` then `open_entity`.
- Same canonical ref.
- Answer again says the level 1 Alchemist costs nothing to build and repeats
  the same effect line.
- Judge passed it because the core grading criterion was satisfied.

This is not a Haiku retrieval failure. The checked-in building data contains:

```json
{
  "buildingNumber": "35",
  "name": "Alchemist",
  "level": 1,
  "buildCost": {
    "prosperity": 0,
    "gold": 0,
    "lumber": 0,
    "metal": 0,
    "hide": 0
  },
  "effect": "Characters cannot use potions"
}
```

The old judge marked Haiku down for an effect string that came from the retrieved
source. The fixture only requires saying level 1 has no initial build cost and
not mistaking the level 2 upgrade cost for the level 1 build cost. The fresh
pass is the more faithful grading outcome.

Classification: rubric/judge mismatch.

### `item-crude-boots`

Old trace:
<https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aanthropic%3Aclaude-haiku-4-5%3Aitem-crude-boots>

Fresh trace:
<https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-144-haiku-replay-2026-05-03%3Aanthropic%3Aclaude-haiku-4-5%3Aitem-crude-boots>

Old run:

- Tools: `open_entity` then `resolve_entity`.
- Canonical ref: `card:frosthaven/items/gloomhavensecretariat:item/5`.
- Answer correctly states the +1 Move effect.
- Answer says the item has no cost.
- Judge failed it for missing the expected 2 gold cost and adding wrong use
  framing.

Fresh run:

- Tools: `resolve_entity` then `open_entity`.
- Same canonical ref.
- Answer again correctly states the +1 Move effect.
- Answer again says the item has no cost.
- Judge again failed it for the cost/use details.

The checked-in item extraction currently says:

```json
{
  "number": "005",
  "name": "Crude Boots",
  "slot": "legs",
  "cost": null,
  "effect": "During your move ability, add +1 Move",
  "uses": null,
  "spent": true,
  "lost": false
}
```

The eval fixture expects "Legs slot, costs 2 gold. During your move ability, add
+1 movement." Haiku is following the retrieved structured data, so this row
cannot be used as evidence that Haiku is weak until the data/fixture mismatch is
resolved.

Classification: fixture/data mismatch.

### `traj-scenario-conclusion-open`

Old trace:
<https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-134-expanded-full-matrix-2026-05-02%3Aanthropic%3Aclaude-haiku-4-5%3Atraj-scenario-conclusion-open>

Fresh trace:
<https://us.cloud.langfuse.com/project/default/traces/eval%3Asqr-144-haiku-replay-2026-05-03%3Aanthropic%3Aclaude-haiku-4-5%3Atraj-scenario-conclusion-open>

Old run:

- Tools: `neighbors` then `resolve_entity`.
- Canonical refs included `scenario:frosthaven/061` and
  `section:frosthaven/67.1`.
- Final answer correctly named Section 67.1.
- Trajectory failed because the run did not call `open_entity`.

Fresh run:

- Tools: `open_entity`, `resolve_entity`, then `neighbors`.
- Canonical refs included `section:frosthaven/67.1` and
  `scenario:frosthaven/061`.
- Final answer named Section 67.1 and summarized the section.
- Trajectory passed because the required open step happened.

This is not a hard model gap. Haiku can satisfy the route, but the old run shows
it may choose a shortcut when a question can be answered from neighbor metadata.
The case remains useful for testing whether smaller models actually open the
source rather than stopping after finding the right link.

Classification: tool-loop instability.

## Narrow Safe Query Classes

Haiku is plausible for these future helper roles:

- Cheap eval canary for rulebook, monster-stat, and tool-free cases where the
  full matrix would be wasteful.
- Intent/source classification: decide whether a user query is about rules,
  items, monsters, buildings, scenarios, or source inspection.
- Exact-entity preflight: identify whether a query has one high-confidence
  canonical entity candidate before a stronger answer model runs.

Haiku is not yet safe for:

- Production final answers.
- Questions where a missing citation or skipped `open_entity` call matters.
- Item/building answers that depend on extracted structured data until the
  `Crude Boots` mismatch is fixed and the building/item rubrics are tightened.

## Follow-Up

Filed SQR-145 for the `Crude Boots` data/fixture mismatch. Fix that before using
this row to compare models again.
