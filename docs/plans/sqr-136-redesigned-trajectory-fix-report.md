# SQR-136 Redesigned Trajectory Fix Report

**Date:** 2026-04-29

## Outcome

The redesigned tool surface now passes the checked-in trajectory suite:

| Run                          | Final-answer pass rate | Average final-answer score | Trajectory pass rate |
| ---------------------------- | ---------------------: | -------------------------: | -------------------: |
| SQR-122 redesigned baseline  |                  13/18 |                     3.83/5 |                 8/12 |
| SQR-136 final redesigned run |                  15/18 |                     4.33/5 |                12/12 |

Final-answer failures that remain after this work are:

- `monster-living-bones-immunity`
- `building-alchemist`
- `scenario-61-unlock`

Those are tracked by SQR-137 rather than SQR-136.

## Root Causes

The previously observed trajectory failures had three causes:

- `resolve_entity` returned legacy card source IDs and full record payloads. The
  model could answer from the resolution output or try to open an
  underspecified legacy source ID instead of opening a canonical card ref.
- `open_entity` accepted `section:gloomhaven2/67.1` but stripped the game
  qualifier before lookup, so a foreign-game ref could accidentally open
  Frosthaven data.
- The redesigned prompt did not strongly distinguish traversal from opening.
  For relationship questions, the model sometimes used links embedded in
  `open_entity` output instead of calling `neighbors`, and it sometimes opened a
  known canonical ref without first resolving when the user explicitly asked it
  to resolve.

## Fixes

- `resolve_entity` now returns canonical card refs such as
  `card:frosthaven/items/gloomhavensecretariat:item/1`.
- `resolve_entity` now stays concise: candidates provide refs, titles, source
  labels, confidence, and match reason, but not full record data. Exact record
  payloads come from `open_entity`.
- `open_entity` now respects explicit game-qualified scenario and section refs
  during lookup.
- The redesigned agent prompt now preserves explicit game qualifiers in
  canonical refs and routes scenario/section relationship questions through
  `neighbors`.

## Verification

Commands:

```bash
npm test -- test/tools.test.ts
npm run eval -- --tool-surface=redesigned --category=trajectory --name=sqr-136-redesigned-trajectory-after --local-report=/tmp/sqr-136-redesigned-trajectory-after.json
npm run eval -- --tool-surface=redesigned --name=sqr-136-redesigned-final --local-report=/tmp/sqr-136-redesigned-final.json
```

Final local report summary:

```json
{
  "totalCases": 29,
  "erroredCases": 0,
  "finalAnswerCases": 18,
  "finalAnswerPasses": 15,
  "avgCorrectnessScore": 4.333333333333333,
  "trajectoryCases": 12,
  "trajectoryPasses": 12,
  "avgToolCalls": 3.103448275862069,
  "avgLatencyMs": 12938.862068965518,
  "totalLatencyMs": 375227,
  "tokenUsage": {
    "inputTokens": 439947,
    "outputTokens": 16522,
    "totalTokens": 456469
  }
}
```
