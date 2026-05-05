# SQR-162 LangSmith / Langfuse Trace Comparison Report

## Scope

This report compares LangSmith and Langfuse for Squire eval observation after
bringing the LangSmith trace path to row-link parity with Langfuse.

The comparison is trace-only. It does not compare LangSmith datasets,
experiments, or annotation queues against Langfuse equivalents because SQR-162
does not upload eval datasets or eval results to LangSmith.

## Parity Work Implemented

- Matrix rows now carry both `traceUrl` and `langsmithTraceUrl`.
- The CLI resolves the LangSmith project URL when `--langsmith-tracing` is
  enabled, then writes deterministic row-level LangSmith run links.
- LangSmith root runs now include filterable tags for case, category, failure
  class, and pass state.
- LangSmith metadata now includes Squire pass/fail, primary score, trajectory
  score, failure class, model, provider, case, and the redacted Squire trace.
- Trajectory-only eval rows now map `trajectory_pass` into LangSmith `pass`
  metadata/tags, instead of showing `pass:unknown`.

## Live Proof

Command:

```bash
npm run eval -- --matrix --category=trajectory --allow-estimated-cost --max-estimated-cost-usd=5 --retry-count=1 --timeout-ms=60000 --anthropic-concurrency=1 --openai-concurrency=1 --run-label=sqr-162-langsmith-parity-trajectory-v2-2026-05-05 --local-report=docs/plans/sqr-162-langsmith-parity-report.json --langsmith-tracing
```

Result:

- Report: `docs/plans/sqr-162-langsmith-parity-report.json`
- Run label: `sqr-162-langsmith-parity-trajectory-v2-2026-05-05`
- Rows: 84
- Pass: 78
- Fail: 6
- Estimated guardrail cost: `$4.20`
- Rows with Langfuse links: 84
- Rows with LangSmith links: 84
- Langfuse API check: fetched a failed row trace with input, output, and Squire
  metadata present.
- LangSmith SDK check: 84 root `eval.case` runs and 339 child runs found.
- LangSmith failed-row check: failed sample had `pass:false`, `score:0`,
  `trajectoryScore:0`, `failure:none`, and the same row-level URL.

Provider summary:

| Provider  | Rows | Pass | Fail |
| --------- | ---: | ---: | ---: |
| Anthropic |   36 |   34 |    2 |
| OpenAI    |   48 |   44 |    4 |

Model summary:

| Runtime / Provider / Model               | Rows | Pass | Fail |
| ---------------------------------------- | ---: | ---: | ---: |
| `claude-sdk:anthropic:claude-sonnet-4-6` |   12 |   12 |    0 |
| `claude-sdk:anthropic:claude-opus-4-7`   |   12 |   11 |    1 |
| `claude-sdk:anthropic:claude-haiku-4-5`  |   12 |   11 |    1 |
| `claude-sdk:openai:gpt-5.5`              |   12 |   12 |    0 |
| `claude-sdk:openai:gpt-5.4`              |   12 |   12 |    0 |
| `claude-sdk:openai:gpt-5.4-mini`         |   12 |   11 |    1 |
| `claude-sdk:openai:gpt-5.4-nano`         |   12 |    9 |    3 |

Failed examples:

| Case                            | Model                        | Score | Tools | Loops |
| ------------------------------- | ---------------------------- | ----: | ----: | ----: |
| `traj-scenario-conclusion-open` | `anthropic:claude-opus-4-7`  |     0 |     2 |     3 |
| `traj-scenario-conclusion-open` | `openai:gpt-5.4-nano`        |     0 |     2 |     3 |
| `traj-section-unlocks-scenario` | `openai:gpt-5.4-nano`        |     0 |     4 |     5 |
| `traj-invalid-cross-game-ref`   | `anthropic:claude-haiku-4-5` |     1 |     2 |     2 |
| `traj-invalid-cross-game-ref`   | `openai:gpt-5.4-mini`        |   0.8 |     4 |     5 |
| `traj-invalid-cross-game-ref`   | `openai:gpt-5.4-nano`        |     1 |     4 |     5 |

The `score=1` failed rows are not contradictions. They passed the answer judge
but failed trajectory checks, which is why the LangSmith mapper now records both
primary score and trajectory score/pass.

## Single-Row Triage

At row-link parity, both systems are good enough for opening a failed matrix row
directly from the local report.

Langfuse opens the Squire trace by trace ID. It shows the same case, provider,
model, input, output, and trace metadata that Squire replay/debug code already
expects.

LangSmith opens the deterministic root run for the same row. It gives a run tree
with one root `eval.case`, one model child, tool children, feedback records, and
the redacted Squire trace in metadata.

For a single failure, LangSmith is easier to scan as a span tree. Langfuse is
easier to connect back to Squire's existing replay path.

## Failure Slicing

After the parity fix, LangSmith can slice the run set by:

- run label
- provider/model
- `case:<id>`
- `category:trajectory`
- `failure:<class>`
- `pass:true` / `pass:false`
- metadata fields such as `caseId`, `provider`, `model`, `score`, and
  `trajectoryScore`

That is enough to answer questions like "show failed trajectory rows for
gpt-5.4-nano" or "show every failure for `traj-invalid-cross-game-ref`" inside
LangSmith without starting from local files.

Langfuse can also inspect the same row set, and the matrix JSON already carries
the row-level result fields. Its main advantage is that Squire already has replay
code that fetches Langfuse traces and reconstructs a debugging transcript.

## Prompt And Eval Improvement

For learning from eval usage, LangSmith is now at least competitive at trace
parity. Its tags, run tree, and feedback records are a strong shape for reviewing
many failures and grouping them by case/model/pass state.

Langfuse remains strong for seeing the exact Squire trace contract, model IO,
tool calls, scores, and costs in the same trace shape Squire already writes and
replays.

The comparison does not justify saying Langfuse is better just because Squire
already built around it. The more accurate read is:

- For trace-only error analysis, both systems now expose the needed facts.
- LangSmith has the cleaner failure-review surface once rows link directly to
  runs and pass/fail tags are correct.
- Langfuse has the lower-friction Squire debug loop today because replay tooling
  already reads it.
- A real LangSmith-vs-Langfuse eval-platform decision needs dataset,
  experiment, annotation, and cross-run comparison parity as a separate scope.

## Product Troubleshooting

Both systems can troubleshoot product issues when the trace includes the Squire
contract, provider request/response, tool calls, errors, retries, scores, and
timings.

Langfuse is currently better for "replay this Squire failure" because the replay
code is already implemented against Langfuse traces.

LangSmith is better for "walk the execution tree and compare similar failures"
because the root/model/tool run tree, tags, and feedback records are natural to
that workflow.

## Recommendation

Keep LangSmith tracing opt-in, but do not treat it as a weak sidecar anymore.
After row-link and pass/fail parity, it is a credible trace review surface for
Squire evals.

Do not choose a permanent winner from this trace-only prototype. The next
decision-grade comparison should add parity for dataset/experiment review and
human annotation workflows. If that scope matters more than replay, LangSmith may
stack up better. If Squire's primary workflow stays replay/debug from local matrix
rows, Langfuse still has less integration work today.
