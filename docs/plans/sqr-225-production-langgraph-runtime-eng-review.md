# SQR-225 Production LangGraph Runtime Eng Review

Date: 2026-05-25

Status: accepted plan after `/plan-eng-review` discussion.

Related:

- [ADR 0019](../adr/0019-langgraph-production-knowledge-agent.md)
- [SQR-225 comparison](./sqr-225-langgraph-runner-comparison.md)
- [SQR-238 SSE resume follow-up](https://linear.app/maz-org/issue/SQR-238/add-sse-resume-and-replay-for-langgraph-streamed-chat-runs)

## Decision

Build the real production LangGraph agent now. Scope it to all Squire Q&A, not
only the scenario-61 example. Remove the hand-owned production loop rather than
keeping it as a long-lived fallback.

The plan is "burn the ships":

- LangGraph becomes the only production knowledge-agent runtime.
- The graph is staged and typed, not a wrapper around the old loop.
- The final answer node is the only source of answer-body text.
- Redesigned knowledge tools are the only agent tools.
- Legacy MCP tools and legacy provenance compatibility are removed.
- Production data can be reset during rollout.
- Eval comparison uses frozen old-loop baseline artifacts, not a live old-loop
  runtime.
- LangGraph checkpointing ships in this migration.
- SSE resume/replay is tracked separately in SQR-238.

## Graph Shape

```text
POST /chat message
  -> conversation service ask()
    -> LangGraph knowledge graph
       START
         -> classify_question
         -> plan_retrieval
         -> execute_tools
         -> verify_sources
         -> route_next
              -> plan_retrieval  (more evidence needed)
              -> force_synthesis (bounded fallback)
              -> final_answer
              -> fail
       END
    -> conversation service persists final assistant row
    -> browser SSE receives Squire-owned events
```

Node responsibilities:

| Node                | Responsibility                                                        | Emits to browser                                                 |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `classify_question` | Classify rule, card, scenario, section, mixed, or tool-free question. | Nothing; trace/update only.                                      |
| `plan_retrieval`    | Decide which redesigned tools are needed and why.                     | Optional `tool-progress`; no answer text.                        |
| `execute_tools`     | Execute Squire tools, normalize observations, capture provenance.     | `tool-start`, `tool-result`, `tool-progress`, `answer-artifact`. |
| `verify_sources`    | Decide whether observations are sufficient and source-backed.         | Optional `tool-progress`; no answer text.                        |
| `route_next`        | Conditional edge: gather more, synthesize, fail, or answer.           | Nothing; trace/update only.                                      |
| `force_synthesis`   | Bounded fallback when loop budget is exhausted but evidence exists.   | Optional `tool-progress`; no answer text.                        |
| `final_answer`      | Produce the user-facing answer from verified state.                   | `text-delta`, `done`, consulted sources.                         |
| `fail`              | Produce terminal failure with a clear user-facing error.              | `error` only.                                                    |

Only `final_answer` can map LangGraph `messages` to Squire `text`. All other
node messages are trace data, progress, artifacts, or debug.

## State Contract

The graph state should be explicit and serializable:

```text
AgentGraphState
  request: requestId, conversationId, messageId, userId, game
  question: raw text, normalized text, history excerpt
  classification: answer kind, confidence, routing hints
  plan: retrieval objective, required evidence, pending tool calls
  observations: normalized tool results, source ids, canonical refs
  artifacts: section quotes, card snippets, structured answer-adjacent blocks
  consultedSources: footer-ready source provenance
  trajectory: model calls, tool calls, token/cost usage, graph node timings
  retry: iteration count, loop budget, last failure reason
  checkpoint: thread id, run id, checkpoint namespace
  final: markdown, html, status
```

The state reducer should reject duplicate tool results, preserve deterministic
ordering for consulted sources, and make missing source provenance visible as a
verification failure.

## Stream Mapping

| LangGraph event class          | Squire internal event       | Browser behavior                                  |
| ------------------------------ | --------------------------- | ------------------------------------------------- |
| `messages` from `final_answer` | `text`                      | Append answer text.                               |
| `messages` from any other node | `debug` or trace update     | Never render as answer prose.                     |
| tool start/result              | `tool-start`, `tool-result` | Show compact progress rows.                       |
| custom progress                | `tool-progress`             | Show user-safe progress rows.                     |
| custom artifact                | `answer-artifact`           | Render quote/snippet block outside answer prose.  |
| updates/state                  | trajectory/update           | Store for observability only.                     |
| debug                          | debug                       | LangSmith/logs only.                              |
| terminal success               | `done`                      | Replace pending answer with sanitized final HTML. |
| terminal failure               | `error`                     | Show recoverable error UI; no `done` after error. |

This is the concrete version of the screenshot target: progress rows first,
structured artifacts when retrieval finishes, and final answer text only when
the final-answer node starts.

## Module Plan

Split the current large agent file into focused modules:

| Module                           | Purpose                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| `src/agent/types.ts`             | Shared graph state, events, trajectory, and tool types.           |
| `src/agent/prompts.ts`           | Classifier, planner, verifier, and final-answer prompts.          |
| `src/agent/tool-definitions.ts`  | Redesigned tool schemas only.                                     |
| `src/agent/tool-executor.ts`     | Squire-owned tool execution and normalization.                    |
| `src/agent/artifacts.ts`         | Section/card artifact builders and sanitization inputs.           |
| `src/agent/tracing.ts`           | LangSmith/OpenTelemetry trajectory helpers.                       |
| `src/agent/langgraph-runtime.ts` | Graph construction, nodes, conditional edges, checkpointing.      |
| `src/service.ts`                 | Single production `ask()` path to LangGraph.                      |
| `src/mcp.ts`                     | Public MCP surface with redesigned tools only.                    |
| `eval/*`                         | LangGraph-only new eval commands plus frozen baseline comparison. |

Delete or retire `runAgentLoopInternal`, live `claude-sdk` runtime selection,
`AgentToolSurface = 'legacy'`, `LEGACY_AGENT_TOOLS`, `ALL_AGENT_TOOLS`, and old
MCP registrations once replacement tests pass.

## Checkpointing And Durability

This migration includes LangGraph checkpointing for graph/node state. Every run
must have a stable thread id derived from the conversation/message identity or a
stored run id. Checkpointing protects graph state and lets the server resume
from committed node boundaries.

Checkpointing is not the same as SSE replay. Buffered in-process text can still
be lost if the process crashes before events are durably stored. SQR-238 owns
durable stream-event storage, `Last-Event-ID` replay, and reconnect semantics.

## Production Reset

Because old provenance compatibility is being removed, rollout needs an
explicit reset path:

- document the production reset command or workflow;
- require a database backup or export step before reset;
- run schema migrations and seed/reindex commands after reset;
- verify `/api/live`, `/api/health`, `/login`, MCP auth boundary, and one chat
  stream after deploy;
- keep reset instructions out of normal local development commands.

## Test Coverage Diagram

```text
CODE PATHS                                             USER FLOWS
[+] src/agent/langgraph-runtime.ts                     [+] Browser Q&A stream
  ├── [GAP] [->EVAL] classify_question routes            ├── [GAP] [->E2E] progress rows render outside answer
  ├── [GAP] [->EVAL] plan_retrieval chooses tools        ├── [GAP] [->E2E] artifact renders before final answer
  ├── [GAP] execute_tools success + tool error           ├── [GAP] final answer text starts only at final node
  ├── [GAP] verify_sources enough/missing evidence       ├── [GAP] terminal error shows no done event
  ├── [GAP] route_next gather/answer/fail/limit          └── [GAP] checkpointed retry does not duplicate text
  ├── [GAP] final_answer emits only answer text
  └── [GAP] fail emits one terminal error

[+] src/service.ts                                     [+] Eval and deployment
  ├── [GAP] ask() always uses LangGraph                  ├── [GAP] [->EVAL] frozen baseline comparison
  └── [GAP] no current-runner fallback                   ├── [GAP] eval CLI rejects legacy/runtime switches
                                                         └── [GAP] production reset runbook is verified

[+] src/mcp.ts
  ├── [GAP] redesigned public tools remain
  └── [GAP] old public tools are absent

COVERAGE: 0/19 planned paths tested yet.
QUALITY: no implementation exists yet; every path above is a required test or eval.
```

## Required Tests

- Unit: state reducer ordering, duplicate suppression, checkpoint id creation,
  source verification failure, route selection, artifact builder output.
- Unit: tool executor maps redesigned tools to normalized observations and
  clear errors.
- Unit: graph stream mapper emits `text` only for `final_answer`.
- Integration: scenario/section traversal uses planner -> tools -> verifier ->
  final answer without old loop code.
- Integration: browser stream shows progress and artifact events outside answer
  prose.
- Integration: terminal graph error emits exactly one `error` and no `done`.
- Integration: checkpointed retry resumes from node state without duplicate
  consulted sources or answer artifacts.
- MCP: legacy public tools are gone and redesigned tools still work.
- Eval: all current answer and trajectory suites run against LangGraph.
- Eval: frozen old-loop baseline comparison report is generated.
- Contract: eval CLI defaults to LangGraph and rejects new `claude-sdk` or
  `legacy` selections.
- Deployment: production reset runbook/workflow order is covered by a contract
  test or script dry-run check.

## Failure Modes

| Failure                                             | Handling requirement                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Planner chooses no tool for source-backed question. | Verification must block unsupported final answer and route back or fail clearly.         |
| Tool returns no results.                            | Progress may show the lookup, but final answer must say evidence was not found.          |
| Source provenance is missing.                       | Verification fails; no consulted footer row is fabricated.                               |
| Loop budget is exhausted.                           | `force_synthesis` may answer only from existing verified observations; otherwise `fail`. |
| Provider stream emits non-final text.               | Mapped to debug/trace only; answer body remains unchanged.                               |
| Process restarts mid-run.                           | Checkpointed graph state can resume at node boundary; SSE replay waits for SQR-238.      |
| Production reset misses seed/reindex.               | Deploy verification must catch empty retrieval before closing the issue.                 |

## NOT In Scope

- SSE resume and durable event replay: tracked in SQR-238.
- Deep Agents for production Q&A: wait until the base graph is working.
- Remote LangSmith Agent Server hosting: not needed for this migration.
- Campaign state, spoiler approvals, or long-running game planning: future
  feature work.
- Keeping legacy tools for external clients: explicitly removed in this plan.

## What Already Exists

- Hono, auth, conversation persistence, and browser SSE stay in place.
- `tool-progress` and `answer-artifact` events already prove the desired browser
  routing shape.
- LangSmith/OpenTelemetry tracing remains the trace system.
- Existing redesigned tool implementation and eval datasets are reused.
- The old loop contributes reusable prompt/toollangsmith pieces, but not runtime
  control flow.

## Worktree Parallelization

| Step                             | Modules touched                       | Depends on                 |
| -------------------------------- | ------------------------------------- | -------------------------- |
| Agent module split               | `src/agent*`, `test/agent*`           | -                          |
| Graph runtime and checkpointing  | `src/agent/`, `src/service.ts`, tests | Agent module split         |
| MCP and legacy tool removal      | `src/mcp.ts`, docs, tests             | Agent module split         |
| Eval CLI and baseline comparison | `eval/`, `docs/plans/`, tests         | Agent module split         |
| Production reset workflow        | `scripts/`, `.github/`, docs, tests   | Legacy provenance decision |
| Browser stream verification      | `src/web-ui/`, conversation tests     | Graph runtime              |

Parallel lanes:

- Lane A: Agent module split -> graph runtime and checkpointing -> browser
  stream verification.
- Lane B: MCP and legacy tool removal after the shared tool definitions settle.
- Lane C: Eval CLI/baseline work after the shared types settle.
- Lane D: Production reset workflow can proceed in parallel with B/C.

The first split step is the merge bottleneck. After that, B, C, and D can run in
parallel if they avoid touching the same type definitions.

## Implementation Tasks

- [ ] **T1 (P1, human: ~3h / CC: ~35min)** — agent runtime — Split `src/agent.ts`
      into prompt, type, tool, tracing, artifact, and runtime modules.
  - Surfaced by: Code quality review — current agent file owns too much to
    replace safely.
  - Verify: `npm run check`.
- [ ] **T2 (P1, human: ~5h / CC: ~55min)** — graph runtime — Build typed
      planner/retriever/verifier/final-answer LangGraph runtime with checkpointing.
  - Surfaced by: Architecture review — wrapper graph is not a real runtime.
  - Verify: graph unit/integration tests plus targeted evals.
- [ ] **T3 (P1, human: ~2h / CC: ~25min)** — streaming — Enforce final-answer
      node as the only source of answer text.
  - Surfaced by: Stream UX review — screenshot target requires event separation.
  - Verify: browser/conversation stream tests.
- [ ] **T4 (P1, human: ~2h / CC: ~25min)** — tools/MCP — Remove legacy tools
      from internal agent use and public MCP.
  - Surfaced by: Scope decision — redesigned tools only.
  - Verify: MCP tests and tool contract tests.
- [ ] **T5 (P1, human: ~2h / CC: ~25min)** — evals — Make new eval commands
      LangGraph-only and compare against frozen old-loop artifacts.
  - Surfaced by: Eval review — live old-loop fallback should not survive.
  - Verify: eval CLI contract tests and local comparison report.
- [ ] **T6 (P1, human: ~2h / CC: ~25min)** — operations — Add production reset
      runbook/workflow and deploy verification.
  - Surfaced by: Data review — old provenance compatibility is removed.
  - Verify: reset contract/dry-run test and deploy health script.
- [ ] **T7 (P2, human: ~1h / CC: ~15min)** — docs — Update architecture,
      SSE, eval, and MCP docs after implementation lands.
  - Surfaced by: Documentation review — active docs currently describe the
    old production path.
  - Verify: docs references point to ADR 0019 and no longer promise legacy
    runtime support.

## Completion Summary

- Step 0: Scope Challenge — scope accepted as complete production replacement.
- Architecture Review: 5 issues found and decided.
- Code Quality Review: 3 issues found and decided.
- Test Review: diagram produced, 19 gaps identified.
- Performance/Reliability Review: 2 issues found and decided.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: skipped because this repo has no `TODOS.md`; SSE resume is
  tracked in Linear as SQR-238 instead.
- Failure modes: no silent unhandled failure may ship; each listed mode needs a
  test or explicit handling.
- Outside voice: skipped; user asked to build the right version now and the
  repo evidence was sufficient.
- Parallelization: 4 lanes after the initial module split.
- Lake Score: 10/10 recommendations chose the complete option.
