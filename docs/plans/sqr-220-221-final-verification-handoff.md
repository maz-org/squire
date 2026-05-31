# SQR-220 / SQR-221 Final Verification Handoff

Date: 2026-05-31

## Scope

- SQR-220: final local checks, GH2 eval verification, and cross-game boundary eval verification.
- SQR-221: production GH2 data refresh and deployed table-flow smoke verification.

## Local Verification

Command:

```bash
npm run check
```

Result:

- Passed.
- 107 test files passed.
- 1387 tests passed.

## LangSmith Eval Verification

### GH2 Table QA

Command:

```bash
npm run eval -- --matrix --game=gloomhaven-2e --suite=table-qa --run-label=sqr-220-gh2-table-qa-2026-05-31-rerun --timeout-ms=60000 --tool-loop-limit=6 --broad-search-synthesis-threshold=2 --max-estimated-cost-usd=1 --local-report=docs/plans/sqr-220-gh2-table-qa-matrix.json
```

Artifacts:

- [sqr-220-gh2-table-qa-matrix.json](sqr-220-gh2-table-qa-matrix.json)
- [sqr-220-gh2-table-qa-matrix.tsv](sqr-220-gh2-table-qa-matrix.tsv)
- [sqr-220-gh2-table-qa-matrix.md](sqr-220-gh2-table-qa-matrix.md)
- [LangSmith experiment](https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/c47b76b3-64be-4d6a-bda0-6c20610f52db)

Result:

- 18 rows completed.
- 8 passed.
- 10 failed with `answer_quality`.
- Structured card, scenario, and section cases passed, including the GH2 elite level 7 Living Spirit HP case.
- Rulebook, FAQ, and errata answer-quality failures are accepted for this closeout with follow-up SQR-252.

Failed cases:

- `gh2-rule-advantage`
- `gh2-rule-looting-definition`
- `gh2-faq-red-hex-aoe-targets`
- `gh2-rule-long-rest-steps`
- `gh2-rule-wound`
- `gh2-errata-campaign-sheet-section-29`
- `gh2-rule-small-items`
- `gh2-rule-scenario-level`
- `gh2-rule-poison`
- `gh2-rule-long-rest-init`

### Cross-Game Boundary

Command:

```bash
npm run eval -- --matrix --suite=cross-game-boundary --run-label=sqr-220-cross-game-boundary-2026-05-31-rerun --timeout-ms=60000 --tool-loop-limit=6 --broad-search-synthesis-threshold=2 --max-estimated-cost-usd=1 --local-report=docs/plans/sqr-220-cross-game-boundary-matrix.json
```

Artifacts:

- [sqr-220-cross-game-boundary-matrix.json](sqr-220-cross-game-boundary-matrix.json)
- [sqr-220-cross-game-boundary-matrix.tsv](sqr-220-cross-game-boundary-matrix.tsv)
- [sqr-220-cross-game-boundary-matrix.md](sqr-220-cross-game-boundary-matrix.md)
- [LangSmith experiment](https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d8056bfe-41b7-4be6-bdec-b8e54510e379)

Result:

- 3 rows completed.
- 3 passed.
- 0 failed.

### Eval Follow-Ups

- SQR-251: add OpenAI provider support to the LangGraph eval runtime, or reject unsupported provider/runtime combinations before starting a LangSmith experiment.
- SQR-252: fix the remaining GH2 rulebook, FAQ, and errata answer-quality eval failures.

## Production GH2 Data Refresh

Workflow dispatches:

- [Production seed card data](https://github.com/maz-org/squire/actions/runs/26713341325): passed.
- [Production seed scenario and section books](https://github.com/maz-org/squire/actions/runs/26713341323): passed.
- [Production reindex rule sources](https://github.com/maz-org/squire/actions/runs/26713341328): passed.

The reindex was run for `gloomhaven-2e` without truncating embeddings.

## Production Health

Commands:

```bash
node scripts/check-deploy-health.ts --base-url https://squire.maz.org
curl -fsS -D - https://squire.maz.org/api/live
curl -fsS -D - https://squire.maz.org/api/health
curl -fsS -D - https://squire.maz.org/login
```

Result:

- `/api/live`: HTTP 200, `{"status":"ok"}`.
- `/api/health`: HTTP 200, DB/vector/embedder all `ok`.
- `/login`: HTTP 200.
- `check-deploy-health.ts`: passed for `/api/live` and `/api/health`.

## Production Mobile Browser Smoke

Tooling:

- gstack browse.
- Mobile viewport: `390x844`.
- Imported existing `squire.maz.org` Chrome cookie for authenticated production QA.

Evidence:

- GH2 answer screenshot: [sqr-220-221-gh2-answer-mobile.png](../artifacts/sqr-220-221-gh2-answer-mobile.png)
- Frosthaven answer screenshot: [sqr-220-221-fh-answer-mobile.png](../artifacts/sqr-220-221-fh-answer-mobile.png)
- Browser console: no console messages for login, authenticated home, GH2 answer, or Frosthaven answer.

GH2 flow:

- Selected `Gloomhaven 2e`.
- Asked: `how many hit points does an elite level 7 living spirit have?`
- Result: answered `An elite level 7 Living Spirit has 10 hit points.`
- Answer included `Gloomhaven 2nd Edition monster stat card`.
- Consulted row: `CARD INDEX`.

Frosthaven flow:

- Switched back to `Frosthaven`.
- Asked: `what does brittle do in Frosthaven?`
- Result: answered from the Frosthaven Rulebook.
- Consulted row: `RULEBOOK · SECTION BOOK`.

## Closeout

SQR-220 is complete with accepted follow-up SQR-252 for remaining GH2 answer-quality failures and SQR-251 for the OpenAI eval-runtime gap.

SQR-221 is complete: production GH2 data refresh passed, health checks passed, GH2 mobile smoke passed, and Frosthaven mobile smoke passed.
