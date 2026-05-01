# SQR-124 Eval Provider Config Contract

Generated on 2026-05-01 for SQR-124.

## Scope

This issue defines the eval-only provider/model selection contract and splits
`eval/run.ts` into focused modules before provider-specific runners land.
Production request paths stay unchanged.

The current runner still executes the existing default lane:

- provider: `anthropic`
- model: `claude-sonnet-4-6`
- no eval-only tuning overrides

Other parsed provider configs fail fast until `SQR-128` and `SQR-129` add the
Anthropic and OpenAI runner loops.

## Precedence

CLI flags win over environment variables. Environment variables win over the
built-in default.

| Setting           | CLI flag               | Environment variable            | Default                |
| ----------------- | ---------------------- | ------------------------------- | ---------------------- |
| Provider          | `--provider=`          | `SQUIRE_EVAL_PROVIDER`          | `anthropic`            |
| Model             | `--model=`             | `SQUIRE_EVAL_MODEL`             | provider default       |
| Run label         | `--run-label=`         | `SQUIRE_EVAL_RUN_LABEL`         | timestamped eval label |
| Run label alias   | `--name=`              | n/a                             | n/a                    |
| Reasoning effort  | `--reasoning-effort=`  | `SQUIRE_EVAL_REASONING_EFFORT`  | unset                  |
| Max output tokens | `--max-output-tokens=` | `SQUIRE_EVAL_MAX_OUTPUT_TOKENS` | unset                  |
| Timeout           | `--timeout-ms=`        | `SQUIRE_EVAL_TIMEOUT_MS`        | unset                  |
| Tool loop limit   | `--tool-loop-limit=`   | `SQUIRE_EVAL_TOOL_LOOP_LIMIT`   | unset                  |
| Tool surface      | `--tool-surface=`      | n/a                             | `redesigned`           |
| Category filter   | `--category=`          | n/a                             | unset                  |
| Case ID filter    | `--id=`                | n/a                             | unset                  |
| Local JSON report | `--local-report=`      | n/a                             | unset                  |

`--name` remains a backwards-compatible alias for `--run-label`. Passing both
CLI flags is invalid.

## Valid Provider Combos

| Provider    | Models                                 | Reasoning effort values                  |
| ----------- | -------------------------------------- | ---------------------------------------- |
| `anthropic` | `claude-sonnet-4-6`, `claude-opus-4-7` | `low`, `medium`, `high`, `max`           |
| `openai`    | `gpt-5.5`                              | `none`, `low`, `medium`, `high`, `xhigh` |

Unsupported providers, unsupported provider/model pairs, invalid reasoning
effort values, empty option values, and non-positive numeric tuning values
throw before any eval run starts.

## Module Boundaries

- `eval/run.ts`: entrypoint only; loads `.env`, parses CLI args, calls
  `runEval`, and shuts down tracing.
- `eval/cli.ts`: eval-only CLI/env parsing and validation.
- `eval/runner.ts`: top-level eval orchestration and current runner capability
  guard.
- `eval/dataset.ts`: local dataset loading, filtering, and Langfuse seeding.
- `eval/evaluators.ts`: LLM judge and trajectory/run evaluators.
- `eval/experiments.ts`: Langfuse dataset/filtered experiment execution.
- `eval/local-report.ts`: local JSON report execution path.

Downstream runner work should consume `EvalProviderConfig` from `eval/cli.ts`
without widening production `AskOptions` or changing `/api/ask`, REST, MCP, or
web behavior.
