# SQR-137 Final-Answer Eval Triage Report

**Date:** 2026-04-29

## Outcome

The SQR-137 triage found two fixture errors, one traversal gap, and one
building-source-data gap:

| Case                            | Root cause                                                                                                                                                          | Fix                                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `monster-living-bones-immunity` | Fixture expected Poison/Wound immunity, but both checked-in Living Bones monster-stat records have empty `immunities` arrays.                                       | Updated expected answer and grading to require no condition immunities.                                                                                                                                          |
| `building-alchemist`            | The fixture conflated the Alchemist level 1 upgrade cost with its initial build cost, and the importer converted known zero costs into null.                        | Updated the fixture to require no initial build cost, preserved zero-valued building costs, added prosperity to building cost data, and kept the level 1 upgrade cost grounded on the level 2 build-cost record. |
| `scenario-61-unlock`            | Fixture expected section 67.1, which is the scenario conclusion link. The checked-in unlock link for scenario 61 is incoming from section 79.4.                     | Updated expected answer and grading to section 79.4, added incoming scenario unlock traversal, and nudged the agent to open traversal targets instead of searching after `neighbors` succeeds.                   |
| `rule-looting-definition`       | This case was already green after SQR-122/SQR-136, but full runs could still spend the whole loop on repeated redesigned rule searches after opening rule passages. | Extended the repeated-rule-search synthesis guard to redesigned `search_knowledge` and rule-passage `open_entity` calls.                                                                                         |

I also adjusted `traj-section-read-now-chain`: the question asks where the chain ends, so `neighbors` is the required traversal behavior; requiring `open_entity` was overstrict and caused tool-path variance.

## Verification

Commands:

```bash
GHS_DATA_DIR=$HOME/data/ghs npm exec tsx -- src/import-buildings.ts
npm run seed:cards
npm test -- test/agent.test.ts test/eval-dataset.test.ts test/tools.test.ts
npm test -- test/import-buildings.test.ts test/extracted-data.test.ts test/eval-dataset.test.ts test/tools.test.ts
npm run eval -- --tool-surface=redesigned --id=monster-living-bones-immunity --name=sqr-137-living-bones-final --local-report=/tmp/sqr-137-living-bones-final.json
npm run eval -- --tool-surface=redesigned --id=building-alchemist --name=sqr-137-building-zero-cost-manual-guard --local-report=/tmp/sqr-137-building-zero-cost-manual-guard.json
npm run eval -- --tool-surface=redesigned --id=scenario-61-unlock --name=sqr-137-scenario-61-final --local-report=/tmp/sqr-137-scenario-61-final.json
npm run eval -- --tool-surface=redesigned --id=rule-looting-definition --name=sqr-137-looting-final --local-report=/tmp/sqr-137-looting-final.json
npm run eval -- --tool-surface=redesigned --category=trajectory --name=sqr-137-trajectory-final --local-report=/tmp/sqr-137-trajectory-final.json
```

Final targeted summaries:

```json
{
  "livingBones": { "finalAnswerPasses": 1, "avgCorrectnessScore": 5 },
  "buildingAlchemist": { "finalAnswerPasses": 1, "avgCorrectnessScore": 4 },
  "scenario61Unlock": { "finalAnswerPasses": 1, "avgCorrectnessScore": 5 },
  "lootingDefinition": { "finalAnswerPasses": 1, "avgCorrectnessScore": 5 },
  "trajectory": { "trajectoryPasses": 12, "trajectoryCases": 12 }
}
```

## Data Operations

The checked-in building extract was regenerated from local GHS data. Existing
Postgres databases need `npm run seed:cards` after this change is deployed so
the `card_buildings` rows pick up the regenerated `buildCost` JSON. This is not
a schema migration; `build_cost` is already `jsonb`.
