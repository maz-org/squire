# SQR-375 Table Turnaround Iteration Log

This is the running implementation log for the first measurement slice of
Linear project "Squire · Table Turnaround: Answer Quality & Latency Bar".

## 2026-07-03 — First-token and latency-budget harness

Hypothesis: adding first-answer-token timing and per-case latency budgets to the
eval harness will make the Table Turnaround latency bar measurable before any
runtime optimization work starts.

Change:

- Added optional `latencyBudget` fields to eval cases:
  `firstAnswerTokenMs`, `completeAnswerMs`, and `notes`.
- Captured `firstAnswerTokenAt` and `firstAnswerTokenLatencyMs` from the first
  non-empty answer `text` event in agent trajectories.
- Made LangGraph eval runs attach a no-op stream callback so the eval path
  observes the same answer-text event boundary as browser streaming.
- Surfaced first-token latency and latency-budget pass/fail in matrix JSON,
  TSV, Markdown, LangSmith evaluator rows, and local report summaries.
- Made matrix rows fail with `failureClass: "latency_budget"` when a configured
  latency budget is missed and answer quality otherwise passed.

Verification:

- `npm test -- --run test/eval-dataset.test.ts test/eval-matrix.test.ts test/eval-matrix-runtime.test.ts test/eval-anthropic-runner.test.ts test/eval-cost-harness.test.ts test/eval-runner.test.ts test/eval-langsmith-eval.test.ts`
  passed: 7 files, 76 tests.
- `npm run typecheck` passed.

Eval spend: $0. This iteration only ran deterministic local tests and
typechecking.

Decision: keep. This does not improve runtime latency yet, but it turns the
first two Table Turnaround latency targets into reportable and enforceable
fields for future full matrix runs.

Next work:

- Add the expanded table-qa dev/holdout dataset and assign latency budgets to
  the relevant cases.
- Add the groundedness evaluator and judge calibration artifact.
- Run the current-production baseline once the expanded dataset and calibration
  gates are in place.

## 2026-07-03 — Table-qa split scaffold

Hypothesis: explicit `dev` and `holdout` split metadata in the checked-in
table-qa fixtures will let us iterate on answer quality without accidentally
tuning against the held-out gate.

Change:

- Added `split: "dev" | "holdout"` to eval case schema and required it for
  every `table-qa` case.
- Added `--split=dev|holdout` and `SQUIRE_EVAL_SPLIT` filtering, with split
  treated as a selected matrix run for guardrail purposes.
- Preserved split metadata in LangSmith seed/load paths.
- Marked existing table-qa cases as `dev`.
- Added six structured-data table-qa cases with latency budgets, including
  four initial holdout cases:
  `building-mining-camp-level-1`, `scenario-7-edge-world-unlocks`,
  `gh2-monster-living-bones-elite-level-1`, and
  `gh2-scenario-4-crypt-damned`.

Verification:

- `npm test -- --run test/eval-dataset.test.ts test/eval-cli.test.ts test/eval-runner.test.ts`
  passed: 3 files, 68 tests.
- `npm run typecheck` passed.
- `npx eslint eval/cli.ts eval/dataset.ts eval/matrix.ts eval/runner.ts eval/schema.ts test/eval-dataset.test.ts test/eval-cli.test.ts`
  passed.
- `npx markdownlint-cli2 eval/README.md docs/plans/sqr-375-table-turnaround-iteration-log.md`
  passed.
- `npx prettier --check eval/cli.ts eval/dataset.ts eval/matrix.ts eval/runner.ts eval/schema.ts test/eval-dataset.test.ts test/eval-cli.test.ts eval/README.md docs/plans/sqr-375-table-turnaround-iteration-log.md`
  passed.

Eval spend: $0. This slice only changed fixtures, filters, and docs.

Decision: keep. This makes the dev set explicit and creates the first holdout
scaffold without changing runtime behavior.
