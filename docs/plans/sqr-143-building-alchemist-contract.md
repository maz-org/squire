# SQR-143 Building Alchemist Eval Contract

Generated on 2026-05-20 for SQR-143.

## Decision

Treat `building-alchemist` as a cost-semantics eval case.

The checked-in source data is already correct after SQR-137:

- Alchemist level 1 is marked `campaignStartBuilt: true`.
- `initialBuildCost` is zero for prosperity, gold, lumber, metal, and hide.
- The level 1 card's `upgradeCost` to reach level 2 is 1 prosperity, 2 lumber,
  2 metal, and 1 hide.
- The sourced level 1 effect is `Characters cannot use potions`.

The eval should require the answer to say the level 1 Alchemist has no initial
build cost. If the answer talks about the listed card cost or upgrading, it must
separate the upgrade cost from the initial build cost. The level 1 effect is not
required for this question, and a sourced effect mention should not fail the
answer by itself. Claims that level 1 is unbuilt, ruined, not operational, or
must be upgraded before the building exists should fail because they contradict
the cost/build-state data.

## Changes

- Updated `eval/dataset.json` to make the expected answer explicitly source
  backed for both initial build cost and level 1 upgrade cost.
- Updated the grading text so effect wording is optional unless it contradicts
  the cost/build-state contract.
- Added deterministic dataset coverage that checks the fixture against
  `data/extracted/buildings.json`.

## Targeted Rerun

Command:

```bash
npm run eval -- --matrix --id=building-alchemist \
  --run-label=sqr-143-building-alchemist-contract-2026-05-20 \
  --timeout-ms=60000 \
  --local-report=docs/plans/sqr-143-building-alchemist-contract-report.json
```

Result: 7/7 pass, all score 1.0.

| Model                         | Result    | Trace                                                                                                                                                                                            |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `anthropic:claude-sonnet-4-6` | pass, 1.0 | <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-143-building-alchemist-contract-2026-05-20%3Aclaude-sdk%3Aanthropic%3Aclaude-sonnet-4-6%3Abuilding-alchemist> |
| `anthropic:claude-opus-4-7`   | pass, 1.0 | <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-143-building-alchemist-contract-2026-05-20%3Aclaude-sdk%3Aanthropic%3Aclaude-opus-4-7%3Abuilding-alchemist>   |
| `anthropic:claude-haiku-4-5`  | pass, 1.0 | <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-143-building-alchemist-contract-2026-05-20%3Aclaude-sdk%3Aanthropic%3Aclaude-haiku-4-5%3Abuilding-alchemist>  |
| `openai:gpt-5.5`              | pass, 1.0 | <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-143-building-alchemist-contract-2026-05-20%3Aclaude-sdk%3Aopenai%3Agpt-5.5%3Abuilding-alchemist>              |
| `openai:gpt-5.4`              | pass, 1.0 | <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-143-building-alchemist-contract-2026-05-20%3Aclaude-sdk%3Aopenai%3Agpt-5.4%3Abuilding-alchemist>              |
| `openai:gpt-5.4-mini`         | pass, 1.0 | <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-143-building-alchemist-contract-2026-05-20%3Aclaude-sdk%3Aopenai%3Agpt-5.4-mini%3Abuilding-alchemist>         |
| `openai:gpt-5.4-nano`         | pass, 1.0 | <https://us.cloud.langfuse.com/project/cmn1deprv071ead07hellcosn/traces/eval%3Asqr-143-building-alchemist-contract-2026-05-20%3Aclaude-sdk%3Aopenai%3Agpt-5.4-nano%3Abuilding-alchemist>         |
