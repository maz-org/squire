# SQR-162 LangSmith Trace Comparison Report

## Scope

This report compares the SQR eval trace experience after adding optional
LangSmith tracing alongside the existing Langfuse trace writer. Langfuse remains
the authoritative eval trace/debug system.

## Live Proof

Command:

```bash
npm run eval -- --matrix --allow-full-dataset --allow-estimated-cost --max-estimated-cost-usd=15 --retry-count=1 --timeout-ms=60000 --anthropic-concurrency=1 --openai-concurrency=1 --name=sqr-162-langsmith-full-matrix-2026-05-05 --local-report=docs/plans/sqr-162-langsmith-full-matrix-report.json --langsmith-tracing
```

Result:

- Report: `docs/plans/sqr-162-langsmith-full-matrix-report.json`
- Rows: 203
- Pass: 184
- Fail: 19
- Estimated cost: `$10.15`
- LangSmith project: `squire`
- LangSmith project URL:
  `https://smith.langchain.com/o/44be4d80-ba50-4833-ae22-6e176be2dbf2/projects/p/d2a644ae-c64f-49ab-8b4a-fdf09e00f65a`
- LangSmith SDK verification: 203 root `eval.case` runs and 727 child runs found
  for run label `sqr-162-langsmith-full-matrix-2026-05-05`

Provider summary:

| Provider  | Rows | Pass | Fail |
| --------- | ---: | ---: | ---: |
| Anthropic |   87 |   83 |    4 |
| OpenAI    |  116 |  101 |   15 |

Model summary:

| Runtime / Provider / Model               | Rows | Pass | Fail |
| ---------------------------------------- | ---: | ---: | ---: |
| `claude-sdk:anthropic:claude-haiku-4-5`  |   29 |   26 |    3 |
| `claude-sdk:anthropic:claude-opus-4-7`   |   29 |   29 |    0 |
| `claude-sdk:anthropic:claude-sonnet-4-6` |   29 |   28 |    1 |
| `claude-sdk:openai:gpt-5.4`              |   29 |   28 |    1 |
| `claude-sdk:openai:gpt-5.4-mini`         |   29 |   23 |    6 |
| `claude-sdk:openai:gpt-5.4-nano`         |   29 |   22 |    7 |
| `claude-sdk:openai:gpt-5.5`              |   29 |   28 |    1 |

Failure class summary:

| Failure class | Count | Notes                                      |
| ------------- | ----: | ------------------------------------------ |
| `api_status`  |     1 | One OpenAI GPT-5.5 provider status failure |
| `quality`     |     2 | Judge-scored quality failures              |
| `none`        |    16 | Eval score/trajectory misses, not API bugs |

No full-matrix row failed because LangSmith or Langfuse trace writing failed.

Post-mapper-normalization smoke:

- Run label: `sqr-162-langsmith-post-normalizer-smoke-2026-05-05`
- Case/model: `rule-long-rest-init` on `openai:gpt-5.4-nano`
- Result: pass, score `1`
- LangSmith SDK verification: 1 root run and 3 child runs found

## Dataset And Run Shape

Langfuse already matches Squire's eval report shape closely: one Squire trace ID,
one generation, tool spans, scores, metadata, and trace URLs written back into the
matrix report. This remains the best fit for the current eval flow.

LangSmith can represent the same facts without local files. The prototype maps
each eval case to:

- root `eval.case` chain run
- child `eval.model_call` LLM run
- child `eval.tool_call.<name>` tool runs
- feedback records on the root run for judge scores

This shape works for trace browsing and keeps the redacted Squire trace payload
available in root metadata.

## Trace Links And Navigation

Langfuse still has the better first-hop link because the eval matrix report
already stores `traceUrl` per row. A failing matrix row can be opened directly.

LangSmith navigation is usable once filtered by run label, provider, model, or
case metadata. The SDK verification found all 203 root runs under the run label.
The missing piece is report-level deep links per row. LangSmith run URLs were not
added to the local matrix report in this prototype, so users must start from the
project page and filter by tags or metadata.

## Judge Score Visibility

Langfuse keeps scores close to the existing eval artifact and trace contract.

LangSmith feedback works for numeric and string scores. Numeric score values are
written as feedback scores, and string values are written as feedback values. This
is enough to inspect pass/fail and correctness per root run.

One tradeoff: Squire's matrix report currently treats `pass=false` with
`failureClass=none` as a normal scoring or trajectory miss. LangSmith shows the
feedback, but it does not by itself explain Squire's pass/fail policy. The root
metadata includes the full redacted Squire trace so the policy can still be
reconstructed.

## Report Ergonomics

Langfuse remains the better reporting backend for the current Squire matrix
workflow because the JSON report already includes Langfuse trace URLs and uses
the same trace IDs that Squire prints while running.

LangSmith is strong as a second trace browser, especially for span trees and
feedback filtering. It is not yet wired into the matrix report as a first-class
destination.

## Replay And Debug Workflow

Langfuse is still the source of truth for replay/debug workflows because the
existing reports, trace contract, and project docs point there.

LangSmith is good for inspecting a single case run after a failure, but it does
not replace the Squire replay path. The prototype intentionally does not upload
external LangSmith eval datasets or results. It writes traces only.

## Migration Risks

Keep Langfuse authoritative unless a later ADR changes that decision.

Risks to handle before making LangSmith more than optional:

- Row-level LangSmith links are missing from the matrix report.
- LangSmith trace writes are currently synchronous and explicit failures abort the
  eval when tracing is enabled.
- The run tree depends on deterministic run IDs and dotted order fields; SDK/API
  behavior should be watched during LangSmith upgrades.
- Squire's pass/fail policy lives outside LangSmith and must stay visible in
  metadata or report links.

## Recommendation

Keep the prototype as an opt-in sidecar trace writer. It proves LangSmith can
receive the full redacted Squire eval trace shape, but Langfuse should remain the
main eval debugging system until LangSmith row links and Squire-specific
pass/fail affordances are added.
