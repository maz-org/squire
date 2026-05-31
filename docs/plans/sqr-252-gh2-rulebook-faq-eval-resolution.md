# SQR-252 GH2 Rulebook and FAQ Eval Resolution

## Summary

The SQR-220 GH2 table QA run reported 10 answer-quality failures, clustered in
rulebook, FAQ, and errata cases. SQR-252 found that the primary failure mode was
not answer synthesis: the eval runner allowed a missing local rule-source vector
index to surface as ordinary tool errors, then the model converted those tool
errors into final answers that the judge scored as answer-quality failures.

After running `npm run db:migrate && npm run index`, the same GH2 table QA matrix
passed 18/18.

## Fix

Rule-source eval cases now run a retrieval bootstrap preflight before model
execution. The guard applies to `rulebook`, `faq`, and `errata` source
authorities across the Anthropic LangGraph runner, the OpenAI Responses runner,
and the Deep Agents runner.

If `rule_source_embeddings` is missing or empty, the eval fails before any model
call with a tool/setup failure that points at the missing index step. Structured
data cases are not gated by this preflight, so card, monster, scenario, and
tool-free successes keep running without requiring the rule-source index.

## Verification

Baseline from SQR-220:

- Run label: `sqr-220-gh2-table-qa-2026-05-31-rerun`
- Result: 8/18 pass, 10/18 fail
- Failed source authorities: `rulebook`, `faq`, `errata`
- Report: [sqr-220-gh2-table-qa-matrix.md](sqr-220-gh2-table-qa-matrix.md)

SQR-252 rerun after local rule-source indexing:

- Command:

  ```sh
  npm run eval -- --matrix --game=gloomhaven-2e --suite=table-qa --run-label=sqr-252-gh2-table-qa-preflight-2026-05-31 --timeout-ms=60000 --tool-loop-limit=6 --broad-search-synthesis-threshold=2 --max-estimated-cost-usd=1 --local-report=docs/plans/sqr-252-gh2-table-qa-after-index.json
  ```

- Result: 18/18 pass, 0/18 fail
- LangSmith experiment:
  <https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/4e324539-067a-4620-9657-472a528b403a>
- Checked-in report:
  [sqr-252-gh2-table-qa-after-index.md](sqr-252-gh2-table-qa-after-index.md)

Focused regression tests:

```sh
npm test -- test/eval-openai-runner.test.ts test/eval-deep-agents-runner.test.ts test/eval-anthropic-runner.test.ts
```
