# SQR-161 LangSmith Deployment Agent Runtime Report

Date: 2026-05-05

## Recommendation

Do not use LangSmith Deployment as Squire's production agent runtime for Phase 1.

Keep the current Squire-owned `/ask` path: Hono, `ask()`, conversation service,
Postgres, browser SSE, and Langfuse traces. LangSmith Deployment is worth
reconsidering later if Squire needs durable, long-running agent jobs that outgrow
the local `ask()` runner.

No implementation follow-up tickets are required before Phase 1. The required
follow-up decision is captured here: reopen this topic only when one of the
reconsideration triggers below becomes true.

## Why

SQR-160 already gave Squire a local Deep Agents eval runner behind the existing
tool and trace contract. That is the right level of adoption for now: it tests the
intelligence layer without moving Squire's app, auth, data, chat history, SSE, or
eval traces into another runtime.

LangSmith Deployment is an agent server. It provides assistants, threads, runs,
cron jobs, persistence, a task queue, Redis streaming, and worker containers. Those
are real agent-hosting features. They are not needed for the current table-side
Frosthaven Q&A path, where one request enters `/api/ask`, Squire retrieves data
from its own Postgres store, and the browser consumes Squire's SSE contract.

Adding LangSmith Deployment now would add a second deployed runtime before Squire
has a durable remote-agent problem.

## Boundary Decision

```text
Browser / REST / MCP
  -> Squire Hono app
    -> Squire auth and session checks
    -> Squire conversation service
      -> ask(question, options)
        -> current Claude SDK runner
        -> eval-only Deep Agents runner
          -> Squire tools
            -> Squire Postgres + pgvector + canonical Frosthaven data
```

LangSmith Deployment should not sit between the browser and Squire in Phase 1.
If it is tested later, it should be an outbound call from the Squire server to a
remote agent runtime. Squire should still translate the answer back into its own
internal event types and browser SSE events.

## Local Library Runner vs Remote Agent Runtime

| Topic         | Local runner behind `ask()`                                                   | LangSmith Deployment / Agent Server                                                                            |
| ------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| App ownership | Squire owns the full request path.                                            | A second runtime owns agent runs, worker execution, and persisted run state.                                   |
| State         | Squire conversation service and Postgres stay canonical.                      | Agent Server stores assistants, threads, runs, checkpoints, and long-term memory in its own persistence layer. |
| Streaming     | Squire emits its current internal events, then Hono maps them to browser SSE. | Agent Server streams run events through its own API and Redis pub/sub path. Squire would need an adapter.      |
| Auth          | Current bearer/session checks stay in Squire.                                 | Custom auth is needed for per-user scoping; otherwise LangGraph sees the API-key owner.                        |
| Ops           | One app runtime plus Squire Postgres.                                         | Adds Agent Server API, queue workers, Redis, Agent Server database state, and deployment lifecycle.            |
| Best fit      | Low-latency request/response Q&A and eval comparison.                         | Durable multi-step work, background agents, interrupts, cron jobs, remote subagents, and managed run state.    |

## Identity and Auth

Squire should keep app auth, web sessions, and API bearer checks in Squire.

If a future LangSmith remote runtime is tested, the browser should not call
LangSmith directly. The Squire server should call LangSmith using a service-level
credential, then pass a Squire user ID and campaign ID as metadata/config. It
should not forward browser cookies, Google session tokens, or Squire API bearer
tokens into LangSmith.

LangSmith custom auth can populate `langgraph_auth_user`, but that is only needed
if LangSmith itself becomes a multi-user resource boundary. That is not the Phase 1
shape. For Squire, custom auth is future work only if LangSmith threads or memory
become user-visible product state.

## Per-User Memory and Campaign Scope

Keep campaign state and per-user memory in Squire-owned storage.

Agent Server's threads, checkpoints, and store are useful primitives, but they
would create a second state owner. For Frosthaven, that is risky because campaign
state, character state, building state, and canonical game data must stay tied to
Squire's authorization and data model.

If a remote runtime is later tested, prefer stateless runs first:

```text
Squire conversation row
  -> selected recent turns
  -> userId/campaignId metadata
  -> remote run
  -> response + trace ids
  -> Squire persists final assistant turn
```

Only let LangSmith own threads or long-term memory after a new ADR explains how
user isolation, campaign isolation, retention, deletion, and trace/debug access
work.

## Queue and Checkpointer State

LangSmith Deployment's checkpointer and queue are the strongest reason to use it
later. Agent Server persists checkpoints so interrupted runs can resume, and queue
workers execute runs outside the API server.

Squire does not currently need that for `/ask`. A normal rules question should not
require background queue ownership or durable checkpoint replay. If future work
adds long-running build planning, campaign audits, or scheduled recommendations,
then the queue/checkpointer story becomes more valuable.

## SSE and Cloudflare

Do not expose LangSmith stream events directly to the browser.

Squire already documents the browser SSE contract in `docs/SSE_CONTRACT.md`. The
route owns event names, final ordering, fallback behavior, and the browser's error
path. A future remote runtime should stream into a Squire adapter, not into the UI:

```text
LangSmith stream chunks
  -> Squire runtime adapter
    -> internal ask events
      -> Hono route
        -> browser SSE contract
```

Cloudflare should continue to front the Squire Hono app. If LangSmith is used
later, it should be an outbound server-to-server dependency from Squire, not a
public browser dependency.

## Trace Links

Langfuse remains authoritative for Squire evals and report links.

Prior project learning is explicit: eval replay, debugging, and report tooling
should read from Langfuse traces, and UI trace links must come from the Langfuse
API `htmlPath`, not guessed URLs.

LangSmith traces can be secondary if a remote runtime is tested, but replacing
Langfuse needs a later ADR with parity for datasets, scores, trace URLs, replay,
and report generation.

## Cost and Plan Notes

Current LangSmith pricing says:

- Developer is $0/seat/month, but Deployment is not included.
- Plus is $39/seat/month and includes one dev-sized deployment.
- Additional deployments are charged per deployment run.
- Deployment uptime is charged per minute: dev-sized and production-sized have
  different rates.
- Production-sized deployments are the recommended shape for customer-facing
  agents.
- Hybrid and self-hosted platform options are Enterprise.
- Model provider costs are separate.

At the current listed production uptime rate of $0.0036/minute, a production
deployment left live for 30 days costs about $155.52 before seats, traces, runs,
and model calls. That is not large for a company, but it is meaningful for a hobby
project whose current Phase 1 runtime can run in one app container.

Standalone Agent Server is lighter than full hosted LangSmith, but still adds
Redis, Postgres, a LangSmith API key, a LangGraph Cloud license key, license
verification egress, and worker/runtime operations.

## Reconsideration Triggers

Reopen this decision if one of these becomes true:

1. Squire adds durable multi-step work that should survive process restarts, such
   as long build-planning jobs, campaign audits, or scheduled recommendations.
2. The local Deep Agents runner beats the current production runner on eval
   quality or implementation clarity and needs production-style durability.
3. Squire needs remote agent composition through RemoteGraph, MCP, A2A, or hosted
   subagents.
4. Squire needs human-in-the-loop interrupt/resume behavior.
5. Maintaining Squire's local tool loop becomes more expensive than adapting to
   LangGraph/LangSmith run semantics.

## Future Tickets When Triggered

Do not file these now. File them only when a reconsideration trigger is true:

- Prototype a stateless LangSmith Agent Server adapter behind `ask()`.
- Map LangSmith stream chunks to Squire internal events and browser SSE.
- Define user/campaign metadata, auth, and redaction rules for remote agent runs.
- Compare LangSmith trace links against Langfuse report/replay requirements.
- Run a live latency and cost smoke test against the same eval cases used by the
  local Deep Agents runner.

## Sources

- `docs/adr/0015-langchain-deep-agents-intelligence-layer.md`
- `docs/SSE_CONTRACT.md`
- [LangSmith Deployment docs](https://docs.langchain.com/langsmith/deployment)
- [LangSmith Agent Server docs](https://docs.langchain.com/langsmith/agent-server)
- [LangSmith custom auth docs](https://docs.langchain.com/langsmith/custom-auth)
- [Standalone Agent Server docs](https://docs.langchain.com/langsmith/deploy-standalone-server)
- [LangSmith pricing](https://www.langchain.com/pricing-langsmith)
