---
type: ADR
id: '0013'
title: 'Keep Phase 1 production on the current knowledge-agent path'
status: active
date: 2026-04-26
---

## Context

Squire is entering an agent-native retrieval redesign. The research
recommendation is to improve the retrieval surface first, then decide whether
an agent runtime migration is worth the cost. The current production path is
already working:

- Hono hosts the web channel, REST endpoints, and MCP endpoint in one server.
- Postgres + pgvector hold runtime retrieval data.
- The knowledge agent uses the current Claude SDK tool loop.
- The web conversation service owns persisted turns, ownership checks, SSE,
  and presentation while delegating domain reasoning to the knowledge agent.
- Langfuse and OpenTelemetry remain the trace and eval path.

There are good reasons to keep this stable during the redesign. Moving
production to LangChain, Deep Agents, LangGraph, or LangSmith Deployment before
the retrieval work is measured would mix two variables: retrieval quality and
runtime framework choice. It would also risk changing the web SSE contract,
MCP/REST surface, and eval path while the main unknown is still whether the
retrieval contract is good enough.

## Decision

**Phase 1 production stays on the current Hono, Postgres + pgvector, Claude SDK
tool-loop, conversation-service, SSE, Langfuse, and OpenTelemetry path while the
retrieval redesign happens. Deep Agents and LangSmith Deployment stay deferred
until after the Step 3 eval report.**

The redesign may add or reshape atomic retrieval tools and prompts, but it must
keep production traffic flowing through the existing service and conversation
boundaries unless a later ADR replaces this decision.

The current path is protected by these existing tests:

- `test/agent.test.ts` protects the Claude SDK tool loop and atomic tool use.
- `test/service.test.ts` protects service readiness and `ask()` delegation to
  the knowledge agent loop.
- `test/conversation.test.ts` protects the web conversation service, persisted
  turns, non-SSE fallback, and browser SSE route.
- `test/server-api.test.ts` protects REST search endpoints and `/api/ask` SSE.
- `test/mcp.test.ts`, `test/mcp-in-process.test.ts`, and
  `test/mcp-transport.test.ts` protect the MCP atomic-tool surface.
- `eval/run.ts` runs through `askFrosthaven()` in `src/query.ts`, which
  delegates to `src/service.ts`, so evals measure the same production
  knowledge-agent path.

## Options considered

- **Option A (chosen) — keep the current production path as the baseline.**
  Retrieval changes stay measurable because the server, data store, agent loop,
  conversation service, SSE contract, MCP/REST surfaces, and trace/eval path
  remain stable. This avoids framework churn during the highest-risk retrieval
  work.
- **Option B — migrate production to LangChain or LangGraph now.** This might
  help if the current loop were the blocker, but it is not the known blocker.
  It adds a second major variable before the Step 3 eval report can say whether
  retrieval quality improved.
- **Option C — move production to Deep Agents plus LangSmith Deployment now.**
  This could be useful later if Squire needs managed deployment workflows or a
  richer agent graph. For Phase 1 it is premature: it would couple runtime
  deployment choices to an unfinished retrieval-contract redesign.
- **Option D — run a parallel production path during the redesign.** This gives
  side-by-side flexibility, but it doubles test and operational surface while
  the product is still single-maintainer Phase 1. Side experiments can happen
  in plans or throwaway branches without becoming production.

## Consequences

- Retrieval-redesign work has a stable baseline for eval comparisons.
- Existing web, REST, MCP, SSE, and eval contracts stay meaningful during the
  redesign.
- Deep Agents and LangSmith Deployment are not rejected forever; they are gated
  on the Step 3 eval report and a later ADR.
- Any future branch that wants to add LangChain, LangGraph, Deep Agents, or
  LangSmith to production must first replace this decision with a new ADR.
- The current Claude SDK loop remains hand-owned code, so Squire keeps owning
  retry behavior, tool-call event shaping, and prompt/runtime wiring directly.
  That is acceptable until the eval report shows the next bottleneck.
