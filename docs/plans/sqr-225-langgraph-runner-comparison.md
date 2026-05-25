# SQR-225 LangGraph Runner Comparison

Date: 2026-05-24

## Decision

Superseded on 2026-05-25 by
[SQR-225 Production LangGraph Runtime Eng Review](./sqr-225-production-langgraph-runtime-eng-review.md)
and [ADR 0019](../adr/0019-langgraph-production-knowledge-agent.md).

The original result below is still valid as a measurement of the first adapter:
it wrapped the current loop and did not improve answer quality. It is no longer
the project direction.

The active decision is to build a real production LangGraph graph for all
Squire Q&A and remove the hand-owned production loop.

## Original Decision

Do not move production traffic. Do not advance to hidden browser QA until the
underlying scenario/section traversal quality issue is fixed or a real graph
implementation changes the agent loop, not just the stream boundary.

## What Changed

SQR-225 added an eval-matrix runtime option:

- `--agent-runtime=langgraph`
- `--agent-runtime=claude-sdk,langgraph`

The LangGraph eval runtime is intentionally Anthropic-only. Matrix runs that
include any non-`claude-sdk` runtime now use the explicitly selected provider
config instead of expanding to the full Anthropic plus OpenAI model matrix.

The LangGraph eval adapter wraps the existing Claude agent loop in the local
LangGraph adapter and records traces with:

- `agentRuntime: "langgraph"`
- `resolvedModel: "langgraph:claude-sonnet-4-6"`

## Eval Commands

Final-answer case matching the original screenshot class:

```bash
npm run eval -- --matrix --id=scenario-61-unlock --agent-runtime=claude-sdk,langgraph --provider=anthropic --model=claude-sonnet-4-6 --tool-surface=legacy --run-label=sqr-225-scenario-61-unlock-2026-05-24 --timeout-ms=60000 --tool-loop-limit=6 --broad-search-synthesis-threshold=2 --allow-estimated-cost --max-estimated-cost-usd=1 --local-report=docs/plans/sqr-225-scenario-61-unlock-matrix.json
```

Scenario/section traversal case:

```bash
npm run eval -- --matrix --id=traj-scenario-conclusion-next-links --agent-runtime=claude-sdk,langgraph --provider=anthropic --model=claude-sonnet-4-6 --tool-surface=legacy --run-label=sqr-225-scenario-61-traversal-2026-05-24 --timeout-ms=60000 --tool-loop-limit=6 --broad-search-synthesis-threshold=2 --allow-estimated-cost --max-estimated-cost-usd=1 --local-report=docs/plans/sqr-225-scenario-61-traversal-matrix.json
```

Datasets:

- `scenario-61-unlock`: asks which section text unlocks scenario 61.
- `traj-scenario-conclusion-next-links`: starts from scenario 61, opens the
  conclusion section, and lists linked scenarios or sections.

## Results

| Case                                  | Runtime      | Pass | Score | Failure |  Latency | Tokens | Tools | Loops | Provider cost |
| ------------------------------------- | ------------ | ---- | ----: | ------- | -------: | -----: | ----: | ----: | ------------: |
| `scenario-61-unlock`                  | `claude-sdk` | fail |   0.2 | quality | 26166 ms |  51144 |    10 |     6 |     $0.016622 |
| `scenario-61-unlock`                  | `langgraph`  | fail |   0.2 | quality | 24509 ms |  50892 |    12 |     6 |     $0.017927 |
| `traj-scenario-conclusion-next-links` | `claude-sdk` | fail |     0 | none    | 14635 ms |  18062 |     3 |     4 |     $0.008582 |
| `traj-scenario-conclusion-next-links` | `langgraph`  | fail |     0 | none    | 15715 ms |  18133 |     3 |     4 |     $0.009272 |

Raw local reports:

- `docs/plans/sqr-225-scenario-61-unlock-matrix.json`
- `docs/plans/sqr-225-scenario-61-traversal-matrix.json`

Trace ids:

- `eval:sqr-225-scenario-61-unlock-2026-05-24:claude-sdk:anthropic:claude-sonnet-4-6:scenario-61-unlock`
- `eval:sqr-225-scenario-61-unlock-2026-05-24:langgraph:anthropic:claude-sonnet-4-6:scenario-61-unlock`
- `eval:sqr-225-scenario-61-traversal-2026-05-24:claude-sdk:anthropic:claude-sonnet-4-6:traj-scenario-conclusion-next-links`
- `eval:sqr-225-scenario-61-traversal-2026-05-24:langgraph:anthropic:claude-sonnet-4-6:traj-scenario-conclusion-next-links`

## Stream Hygiene

LangGraph adds a better boundary for streaming:

- The `agent_loop` node runs the current Squire agent loop.
- The `agent_loop` emitter filters `text` and `done`, so scratch text from
  non-final work cannot enter the browser answer body through the LangGraph
  adapter.
- The `final_answer` node emits the answer text and `done`.

This is verified by `test/agent-langgraph.test.ts`, which confirms text is
emitted only after the explicit `final_answer` node runs.

The current runner has improved stream hygiene too, but it does not have a graph
node boundary. It depends on:

- suppressing text from Anthropic turns that end in `tool_use`;
- `tool-progress` events for user-safe progress rows;
- `artifact` events for section quote blocks;
- browser-side routing that keeps progress and artifacts outside
  `.squire-answer__content`.

## UX Bar

SQR-236 and SQR-237 meet the UX bar from the screenshot plan for the web stream
contract:

- User-facing progress rows: met. Browser SSE maps `tool-progress` to small
  status rows, and tests cover "Found Locked Down" staying outside answer
  prose.
- Structured artifact events: met. Server emits `answer-artifact` for
  `section_quote`, and browser tests verify the quote is rendered as text
  outside the answer body before final answer text starts.
- `updates` and `debug` as non-prose: partially met. LangGraph filters `debug`
  from the answer body. Current production streaming still does not expose
  arbitrary graph `updates` because production traffic has not moved to
  LangGraph.
- `final_answer` node: met for the LangGraph adapter. Not met for the default
  current runner, which is not graph-shaped.

So SQR-236 and SQR-237 are not blockers for the browser UX anymore. The
remaining blocker is answer quality on scenario/section traversal, not event
routing.

## Quality Read

LangGraph did not improve the failing cases in this adapter:

- In `scenario-61-unlock`, both runtimes hit the tool-loop limit and returned
  "I was unable to produce an answer within the allowed number of steps."
- In `traj-scenario-conclusion-next-links`, both runtimes used the expected
  number of tools and loops but still failed the trajectory score.

That is expected for this implementation. The LangGraph adapter wraps the same
Claude tool loop, so it changes the streaming boundary and trace identity, not
the planning policy, retrieval policy, or stopping behavior.

## Recommendation

Superseded recommendation: do not keep iterating on the wrapper adapter.

The active recommendation is to build the real graph-shaped
planner/retriever/verifier/final-answer flow from
[SQR-225 Production LangGraph Runtime Eng Review](./sqr-225-production-langgraph-runtime-eng-review.md)
and remove the old production loop. Deep Agents stays out of the critical path
for normal Q&A and remains a later option for longer research and planning
tasks.
