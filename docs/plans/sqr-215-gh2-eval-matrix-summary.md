# SQR-215 Gloomhaven 2e Eval Matrix Summary

Captured on May 27, 2026 from the PR branch.

## Environment

Required env came from `.env` through `dotenv/config`:

- `ANTHROPIC_API_KEY`
- `LANGSMITH_API_KEY`
- `LANGSMITH_PROJECT`

## Commands

```bash
npm run eval -- --matrix --game=gloomhaven-2e --suite=table-qa --run-label=sqr-215-gh2-table-qa-v3-2026-05-27 --timeout-ms=60000 --tool-loop-limit=6 --broad-search-synthesis-threshold=2 --max-estimated-cost-usd=1 --local-report=docs/plans/sqr-215-gh2-table-qa-matrix.json
npm run eval -- --matrix --suite=cross-game-boundary --run-label=sqr-215-cross-game-boundary-v2-2026-05-27 --timeout-ms=60000 --tool-loop-limit=6 --broad-search-synthesis-threshold=2 --max-estimated-cost-usd=1 --local-report=docs/plans/sqr-215-cross-game-boundary-matrix.json
```

## Outputs

- `docs/plans/sqr-215-gh2-table-qa-matrix.json`
- `docs/plans/sqr-215-gh2-table-qa-matrix.tsv`
- `docs/plans/sqr-215-gh2-table-qa-matrix.md`
- `docs/plans/sqr-215-cross-game-boundary-matrix.json`
- `docs/plans/sqr-215-cross-game-boundary-matrix.tsv`
- `docs/plans/sqr-215-cross-game-boundary-matrix.md`

## Results

Gloomhaven 2e table QA completed 17 LangGraph rows: 9 passed and 8 failed.
The failures are `answer_quality` failures, not matrix/runtime crashes.

Cross-game boundary completed 3 LangGraph rows: 0 passed and 3 failed. One row
had a correct final answer but missed a trajectory requirement; the other two
had final-answer misses. All three are classified as `cross_game_contamination`
so they are filterable separately from ordinary retrieval and answer quality.

## Triage

The Gloomhaven 2e failures cluster in two areas:

- Rule retrieval misses: Poison did not reach the expected Gloomhaven 2e source
  passage.
- Structured data misses: item, monster, scenario, and section rows reported
  missing GH2 card/scenario data even though the checked-in fixture data exists
  under `data/extracted/gh2`.

The boundary failures point at the same runtime data gap: GH2 scenario and
section refs were not resolved from the live LangGraph tool surface, so the
agent could distinguish games in prose but could not satisfy both required
game-qualified refs.
