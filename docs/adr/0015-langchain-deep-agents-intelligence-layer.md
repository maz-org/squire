---
type: ADR
id: '0015'
title: 'Evaluate LangChain and Deep Agents at the intelligence boundary'
status: active
date: 2026-05-03
---

## Context

SQR-91 asks whether LangChain Deep Agents and LangSmith Deployment should change
Squire's deployment path. The useful question is narrower than "should
LangChain host the app?" Squire already has a Hono web app, REST API, MCP
endpoint, Postgres + pgvector data store, conversation service, SSE contract,
Langfuse trace/eval path, and a stable `ask()` service boundary. The
intelligence layer behind `/api/ask` is the place where LangChain, LangGraph,
Deep Agents, or LangSmith could matter.

This decision comes after the Step 3 retrieval eval work referenced by
[ADR 0013](0013-phase-1-production-agent-baseline.md). The later full-model eval
matrix found the current Claude Sonnet path can pass the checked-in dataset, so
there is no current quality failure that requires replacing the production loop
before Phase 1 hosting is chosen.

LangChain's 2026 direction is still relevant. Their TypeScript docs describe
Deep Agents as a LangGraph-based agent harness with planning, durable execution,
streaming, interrupts, subagents, filesystem-style context, pluggable memory
backends, and LangSmith deployment support. LangSmith Agent Server also provides
assistants, threads, runs, a task queue, persistence, cron jobs, MCP/A2A
exposure, and managed or self-hosted deployment options. Those are not necessary
for today's table-side rules Q&A, but they line up with future Squire phases:
campaign state, long-running build planning, guide research, recommendations,
multi-channel clients, and external agent access.

The SQR-91 Linear issue linked X/Twitter threads about the launch, but the
headless browser could not read their post text. This ADR uses the issue summary
plus primary LangChain/LangSmith docs and the LangChain Deep Agents launch blog
as sources:

- [LangChain Deep Agents TypeScript overview][deep-agents-ts]
- [Deep Agents production guide][deep-agents-production]
- [Deep Agents backend guide][deep-agents-backends]
- [Deep Agents memory guide][deep-agents-memory]
- [LangSmith Agent Server][langsmith-agent-server]
- [LangSmith deployment options][langsmith-deployment]
- [LangSmith evaluation docs][langsmith-evaluation]
- [LangChain Deep Agents launch blog][deep-agents-blog]

## Decision

**Keep Phase 1 app hosting on the Docker/Hono/Postgres path, but treat
LangChain, Deep Agents, and LangSmith as candidates for Squire's intelligence
and eval layers behind `/api/ask`. Do not reject them because they require
adapter work, and do not let them block SQR-59's hosting decision.**

The next work should be a parallel, eval-only runner behind the current service
boundary. It should reuse Squire-owned tools, Squire-owned Postgres + pgvector
data, the self-describing knowledge tool contract, and the current eval dataset.
Production traffic should stay on the current Claude SDK runner until a later
ADR sees measured value from the alternate runner.

LangSmith Deployment should be evaluated as an agent-only remote runtime, not as
the web app host. If it is tested later, Squire must keep app auth, web sessions,
campaign state, and canonical Frosthaven data in Squire-owned systems unless a
new ADR explicitly changes those ownership boundaries.

## Options considered

- **Option A (chosen) — evaluate LangChain and Deep Agents behind `/api/ask`.**
  This keeps Squire's app and data architecture stable while testing whether a
  real agent runtime improves planning, tool choreography, model portability,
  memory, or eval ergonomics. It preserves upside without turning framework
  adoption into the deployment decision.
- **Option B — move the whole app to LangSmith Deployment.** LangSmith Agent
  Server has useful primitives for agents, but Squire's web UI, auth, REST, MCP,
  SSE, and Postgres data model are already owned locally. Moving the whole app
  would blur state ownership and make SQR-59 harder without proving the
  intelligence layer is better.
- **Option C — reject LangChain for Phase 1.** That would keep the code simple,
  but it would ignore where LangChain is headed: durable agent runs, remote
  graphs, subagents, memory, MCP/A2A, and integrated eval/deploy workflows. For
  a hobby project, learning value and future option value matter.
- **Option D — adopt only the base LangChain `createAgent` API.** This may be
  enough for model abstraction, but it does not test the Deep Agents features
  that could matter later: planning, subagents, memory, and durable execution.

## Consequences

SQR-59 remains a normal app-hosting decision: Fly.io, Railway, Render, or a VPS
can be compared against Docker, Node 24, Postgres + pgvector, SSE, logs, TLS,
and cost without making LangSmith Deployment a required host.

The runtime seam is now explicit:

```text
Web UI / REST / MCP
  -> Squire ask service
    -> current Claude SDK runner
    -> future LangChain / Deep Agents runner
      -> self-describing knowledge tools
        -> Squire Postgres + pgvector data
```

The eval seam is also explicit. The future runner must plug into the matrix eval
harness, preserve trace links, and be compared against the current Sonnet
baseline before it can receive production traffic.

Langfuse remains the authoritative LLM trace and eval path. LangSmith evals may
be prototyped as a parallel export or comparison path, but replacing Langfuse
requires a later decision with trace-link, dataset, judge, and report parity.
Trace-link parity means the eval report can map each row back to the same
logical run across systems: provider/model, run label, dataset item or case ID,
Squire trace ID, request ID when present, judge run ID, report ID, timestamps,
and parent-child relationships between the agent run, model calls, tool calls,
and scores. Any LangSmith export must define that mapping in one schema or
export spec before tests can treat it as equivalent to Langfuse.

Any Deep Agents production experiment must use safe backends. The in-memory
state backend is acceptable for eval-only runs only when each eval gets a fresh
agent instance, no mutable state is shared across requests or tasks, and teardown
or reset is explicit after the run. A store-backed memory namespace may be tested
for user-scoped memory; local filesystem and local shell backends must not be
used in the production web server. Shared writable memory becomes a
prompt-injection surface when isolation fails, so it must be scoped by user,
campaign, and agent purpose before it can affect answers.

This decision should be re-opened if the LangChain runner beats the current
runner on quality, traceability, latency, cost, or implementation clarity in the
full eval matrix, or if a future Squire phase needs durable multi-step work that
the current hand-owned loop cannot reasonably provide.

## Advice

Office-hours lens: Squire is a hobby project, not a revenue product under
near-term delivery pressure. It is worth paying some adapter cost if the result
teaches the project about a better long-term intelligence layer.

CEO-review lens: the high-value move is to preserve option value. Do not confuse
"LangSmith hosts agents" with "LangSmith must host the app." Squire can keep its
web product and data store while borrowing a stronger agent runtime if it earns
the slot.

Engineering-review lens: the next branch should be narrow and measurable. Add a
runner interface or equivalent adapter point, wire a LangChain/Deep Agents runner
only for evals, and compare it to the current Claude SDK loop on the same
dataset and tool contract. Do not route production traffic through it until the
evals and trace story are boring.

[deep-agents-ts]: https://docs.langchain.com/oss/javascript/deepagents/overview
[deep-agents-production]: https://docs.langchain.com/oss/javascript/deepagents/going-to-production
[deep-agents-backends]: https://docs.langchain.com/oss/javascript/deepagents/backends
[deep-agents-memory]: https://docs.langchain.com/oss/javascript/deepagents/memory
[langsmith-agent-server]: https://docs.langchain.com/langsmith/agent-server
[langsmith-deployment]: https://docs.langchain.com/langsmith/deployment
[langsmith-evaluation]: https://docs.langchain.com/langsmith/evaluation
[deep-agents-blog]: https://www.langchain.com/blog/deep-agents
