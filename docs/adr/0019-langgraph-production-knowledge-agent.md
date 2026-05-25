---
type: ADR
id: '0019'
title: 'Replace the hand-owned knowledge loop with a production LangGraph graph'
status: active
date: 2026-05-25
supersedes:
  - '0013'
  - '0015'
---

## Context

Squire's first LangGraph adapter proved the stream boundary, but not the agent
design. It wrapped the existing loop in a two-node graph and kept production on
the current Claude SDK path. That was useful as a measurement step, but it left
the main weaknesses in place:

- the planning, retrieval, verification, and final answer phases are still
  tangled in one large loop;
- the legacy and redesigned tools both remain available;
- eval commands still carry old runtime and tool-surface options;
- browser stream hygiene depends on local filtering rather than graph shape;
- checkpointing is not part of the production agent contract.

The May 2026 stream UX work raised the bar. The product should not merely hide
scratch text. It should model the run as distinct stages: user-safe progress,
structured artifacts, trace-only updates, and final answer tokens from one
explicit final-answer node.

## Decision

Replace the production knowledge-agent loop with a real LangGraph graph for all
Squire Q&A. Do not keep a parallel production loop and do not keep the legacy
tool surface alive as a compatibility path.

The production graph has typed state and conditional edges:

```text
START
  -> classify_question
  -> plan_retrieval
  -> execute_tools
  -> verify_sources
  -> route_next
       -> plan_retrieval  (more evidence needed)
       -> force_synthesis (loop limit or bounded fallback)
       -> final_answer
       -> fail
  -> END
```

Only the `final_answer` node may emit answer-body text. Retrieval and
verification nodes may emit progress events, tool events, structured artifacts,
updates, and debug data, but not user-visible answer prose.

Use redesigned knowledge tools only. Remove legacy public MCP tools, legacy
internal adapters, and old provenance compatibility when the migration lands.
The production database may be reset as part of the migration, so the new graph
does not need to read old provenance rows forever.

Add LangGraph checkpointing as part of the migration so node state survives
ordinary retry and restart boundaries. SSE resume and event replay are useful,
but they are a separate follow-up tracked by SQR-238 and do not block this
runtime replacement.

Deep Agents do not sit on the critical path for production Q&A. They remain a
future option for long-running research, planning, and campaign workflows after
the base LangGraph graph is simple, tested, and observable.

## Consequences

`src/agent.ts` should be split into focused modules before or during the
replacement. The old loop can donate prompt, tracing, and tool-execution code,
but `runAgentLoopInternal` and the old iteration policy should be removed from
production.

Eval comparison changes from live old-loop A/B to frozen baseline comparison:
current-loop result artifacts become the historical baseline, and new eval
commands default to the LangGraph runtime with no `claude-sdk` or `legacy`
selection for new runs.

The browser SSE contract remains Squire-owned. LangGraph event types are mapped
inside the service layer; the browser still consumes Squire events such as
`text-delta`, `tool-progress`, `answer-artifact`, `done`, and `error`.

Deployment must include an explicit production reset workflow or runbook before
removing old provenance compatibility. The reset is a conscious operational
step, not an accidental side effect of deploy.

## Implementation notes

The graph state should include the user question, game, conversation context,
retrieval plan, normalized observations, selected artifacts, consulted sources,
trajectory data, retry counters, checkpoint identifiers, and final answer.

The graph should keep model calls behind a small adapter so Squire can keep
provider choice separate from graph structure. The first production graph can
stay Anthropic-backed if that is what passes evals; the important change is the
planner/retriever/verifier/final-answer graph shape.

The old docs that described LangGraph as eval-only are historical. This ADR is
the active decision for Squire's knowledge-agent runtime.
