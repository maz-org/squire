<!-- markdownlint-disable MD013 -->

# SQR-384 Exact Lookup Fast Path Summary

Run label: `sqr-384-exact-lookup-fast-path`

Generated: 2026-07-05T00:16:35.112Z

Commands:

```bash
npm run eval -- --matrix --id=item-crude-helmet --run-label=sqr-384-exact-lookup-fast-path --max-estimated-cost-usd=2 --local-report=docs/plans/sqr-384-exact-lookup-fast-path-report.json
npm run eval -- --matrix --id=<remaining-target-id> --run-label=sqr-384-exact-lookup-fast-path-<remaining-target-id> --max-estimated-cost-usd=2 --local-report=/tmp/sqr-384-<remaining-target-id>.json
npm run eval -- --matrix --id=gh2-monster-living-bones-elite-level-1 --run-label=sqr-384-exact-lookup-fast-path-gh2-monster-living-bones-elite-level-1-v2 --max-estimated-cost-usd=2 --local-report=/tmp/sqr-384-gh2-monster-living-bones-elite-level-1-v2.json
```

Scope:

- Runtime/model: `langgraph:anthropic:claude-sonnet-4-6` with redesigned tools.
- Cases: six SQR-384 exact structured lookup targets from the SQR-383 post-groundedness baseline.
- Row-level artifact: [JSON](sqr-384-exact-lookup-fast-path-report.json).

Estimated spend:

- Provider: $0.0089.
- Guardrail estimate: $0.3000.
- Combined estimate: $0.3089, under the project cap of $100.

## Result

The fast path removes the final no-tools synthesis model call for direct `lookup_entity` / `open_entity` results when the opened record is an item, building, scenario, or monster stat row that can be safely formatted from structured fields.

For the six target rows, latency-budget pass rate moved from 0/6 to 5/6. All six kept semantic score >= 0.8 and groundedness pass.

| Case                                     | Game          | Before first/complete | After first/complete | Score | Groundedness | Latency budget | Tools | LangSmith                                                                                                                                                                    |
| ---------------------------------------- | ------------- | --------------------: | -------------------: | ----: | ------------ | -------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item-crude-helmet`                      | frosthaven    |       5325ms / 5327ms |      2171ms / 2173ms |     1 | pass         | pass           |     1 | [trace](https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d39af706-67df-4dc0-8ebb-5eeaffbb0629/r/019f2f98-1115-7000-8000-015b4754096b?poll=true) |
| `building-mining-camp-level-1`           | frosthaven    |       5016ms / 5018ms |      2188ms / 2191ms |     1 | pass         | pass           |     1 | [trace](https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/4470be9c-8abb-4fb2-8890-279371e03eb4/r/019f2f98-e8a1-7000-8000-01083fb0f0e6?poll=true) |
| `scenario-7-edge-world-unlocks`          | frosthaven    |       6354ms / 6356ms |      1869ms / 1872ms |     1 | pass         | pass           |     1 | [trace](https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/70ee69bb-b560-4949-b3c2-bdf0900083bf/r/019f2f99-705c-7000-8000-03dcc82fb34d?poll=true) |
| `gh2-item-winged-shoes`                  | gloomhaven-2e |       5144ms / 5145ms |      2241ms / 2245ms |     1 | pass         | pass           |     1 | [trace](https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/1980783f-47f4-4537-8993-2b4fd98863f5/r/019f2f99-f66a-7000-8000-0392438a3526?poll=true) |
| `gh2-scenario-4-crypt-damned`            | gloomhaven-2e |       7212ms / 7214ms |      2105ms / 2108ms |     1 | pass         | pass           |     1 | [trace](https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/17449fe6-ea89-4f8b-9ffa-4c8534c647cf/r/019f2f9a-7db2-7000-8000-03fe6e96f21a?poll=true) |
| `gh2-monster-living-bones-elite-level-1` | gloomhaven-2e |       7305ms / 7307ms |      2693ms / 2694ms |     1 | pass         | fail           |     1 | [trace](https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c37e7867-fa37-4835-9a47-7ff9211b9387/r/019f2fa1-4c3b-7000-8000-01610ca7ce30?poll=true) |

## Remaining Miss

`gh2-monster-living-bones-elite-level-1` now uses one tool and one planner loop instead of two tools, two planner loops, and a final synthesis call. It improved from 7305ms / 7307ms to 2693ms / 2694ms. It still misses the 2500ms first-token budget by 193ms in the judged run. The remaining wait is the provider planning call before the tool result exists, not local tool execution or final synthesis.

## Verification

- `npm test -- --run test/agent-langgraph.test.ts` passed: 1 file, 16 tests.
- `npm test -- --run test/tools.test.ts` passed: 1 file, 90 tests.
- `npm run check` passed: 158 files, 1947 tests.
- Targeted LangSmith rows covered all six SQR-384 cases with combined estimated eval spend $0.3089.

## Decision

Keep. This is a narrow latency fix for exact structured lookups. It does not change broad rule search behavior, answer judging, or deterministic groundedness scoring.
