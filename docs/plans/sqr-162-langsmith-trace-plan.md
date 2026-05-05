# SQR-162 LangSmith Trace Prototype Plan

## Goal

Prototype LangSmith tracing alongside the existing Langfuse eval trace path.
Langfuse remains the authoritative eval trace/debug system unless a later ADR
shows that LangSmith has parity or a clear improvement.

## Linear

- Issue: SQR-162
- Title: Prototype LangSmith eval export alongside Langfuse
- Branch: `bcm/sqr-162-prototype-langsmith-eval-export-alongside-langfuse`

## Approved Decisions

1. Add a LangSmith trace writer fed by the existing `EvalTraceInput`.
2. Keep Langfuse and LangSmith based on the same trace facts.
3. Enable LangSmith only with explicit CLI/env opt-in.
4. Require `LANGSMITH_API_KEY` and `LANGSMITH_PROJECT`.
5. Support optional `LANGSMITH_ENDPOINT` and `LANGSMITH_WORKSPACE_ID`.
6. Send full redacted trace detail mapped into LangSmith runs/spans/scores.
7. Fail the eval command if explicitly enabled LangSmith trace writing fails.
8. Cover mapper, CLI/env parsing, matrix wiring, config validation, and failure paths.
9. Use the LangSmith TypeScript SDK behind a small Squire adapter.
10. Finish with a full matrix run traced to LangSmith and Langfuse, then write a
    comparison report.

## What Already Exists

- `eval/trace.ts` defines `EvalTraceInput`, redaction, and Langfuse ingestion.
- `eval/matrix-runtime.ts` passes the Langfuse trace client into Anthropic,
  OpenAI, and Deep Agents eval runners.
- `eval/matrix.ts` derives matrix rows and Langfuse trace URLs from the same run
  facts.
- `docs/plans/sqr-125-trace-artifact-contract.md` states that Langfuse is the
  source of truth for eval traces.

## Implementation Plan

1. Add the LangSmith SDK dependency.
2. Add `.env.example` entries for:
   - `LANGSMITH_API_KEY`
   - `LANGSMITH_PROJECT`
   - optional `LANGSMITH_ENDPOINT`
   - optional `LANGSMITH_WORKSPACE_ID`
   - `SQUIRE_EVAL_LANGSMITH_TRACING`
3. Extend eval CLI/env parsing with explicit LangSmith opt-in.
4. Add `eval/langsmith-trace.ts`:
   - validate config
   - build a LangSmith client
   - map redacted `EvalTraceInput` into a top-level run, model child run, tool
     child runs, and feedback scores
   - flush/await writes before returning
5. Wire the LangSmith writer alongside the existing Langfuse trace writer for
   matrix eval paths.
6. Add tests for:
   - opt-in parsing
   - missing config
   - redaction before mapping
   - model/tool/score mapping
   - writer failure causing an explicit eval failure
   - default eval behavior not writing LangSmith traces
7. Run focused tests and eval-specific lint/format checks.
8. Run a full matrix with LangSmith tracing enabled and Langfuse tracing still on.
9. Write `docs/plans/sqr-162-langsmith-trace-comparison-report.md` comparing:
   - dataset/run shape
   - trace links and navigation
   - judge score visibility
   - report ergonomics
   - replay/debug workflow
   - migration risks

## Not In Scope

- Replacing Langfuse.
- LangSmith external experiment upload.
- A LangSmith-native eval runner.
- Production `/api/ask` provider routing.
- Retry queue for failed trace writes.

## Parallelization

This implementation is mostly sequential because `eval/cli.ts`,
`eval/matrix-runtime.ts`, and trace wiring are shared. A limited split is
possible:

- Lane A: `eval/langsmith-trace.ts` and mapper tests.
- Lane B: docs, `.env.example`, and report shell.
- Final lane: CLI and matrix-runtime wiring after Lane A lands.
