---
type: ADR
id: '0014'
title: 'Adopt a self-describing knowledge tool contract'
status: active
date: 2026-04-26
---

## Context

Squire's current retrieval tools work, but the public shape is too tied to the
first workflows that created them. The knowledge agent sees tools like
`find_scenario`, `get_section`, `search_rules`, and `get_card`, then relies on
the system prompt to explain when to call each one and in what order.

That approach does not scale cleanly. Scenario and section lookup already need
several prompt rules. Card lookup needs a different discovery path. Future
campaign and character records would add more routing text. The result is a
prompt that teaches tool choreography instead of answer quality.

ADR 0013 keeps Phase 1 production on the current Hono, Postgres, Claude SDK,
conversation-service, SSE, MCP, REST, Langfuse, and OpenTelemetry path while
retrieval is redesigned. This decision must improve the retrieval contract
without changing that production baseline.

## Decision

Squire will add a versioned, self-describing knowledge tool contract for the
internal knowledge-agent loop. The product entry point remains an ask-question
task through `/api/ask` and the in-process service boundary. The contract
defines the retrieval tools the agent can use while answering.

The contract is built around six intent-grouped operations:

- `inspect_sources()`
- `schema(kind)`
- `resolve_entity(query, kinds?)`
- `open_entity(ref)`
- `search_knowledge(query, scope?, filters?)`
- `neighbors(ref, relation?)`

External MCP tool names may use a `squire_` prefix
(`squire_inspect_sources`, `squire_open_entity`, and so on) so agents can
distinguish Squire tools when many MCP servers are loaded. That is a projection
detail for external direct-tool callers. The short operation names are the
canonical internal agent contract.

Every inspectable record gets a canonical ref with a formal parser contract.
Active entity kinds and relations are discovered through the contract instead
of copied into every tool schema. Reserved future kinds such as `campaign`,
`character`, and `party` can appear when their sources become active.

Result shapes will support concise and detailed response modes where payloads
can grow large. Search and resolution default to concise output; exact opens
default to detailed output. Errors include repair hints when the caller can fix
the request. Broad search must define fan-out and latency budgets before old
prompt choreography is removed.

The old tools stay available as internal adapters during migration:

- `search_rules`
- `search_cards`
- `list_card_types`
- `list_cards`
- `get_card`
- `find_scenario`
- `get_scenario`
- `get_section`
- `follow_links`

The new contract is documented in
[Self-Describing Knowledge Tool Contract](../KNOWLEDGE_TOOL_CONTRACT.md). The
Claude SDK agent loop is the primary consumer. MCP and REST projections should
reuse the same result shapes and failure semantics when they expose direct tool
access.

## Options Considered

- **Option A, chosen: self-describing contract over the existing adapters.**
  This keeps production stable, moves routing knowledge into tool affordances,
  and gives SQR-117 and SQR-118 a clear target.
- **Option B: keep the current nine public tools and keep improving prompt
  routing.** This is lowest effort now, but every new source adds more prompt
  text and more chances for the model to pick the wrong path.
- **Option C: replace the nine tools with one large `ask_knowledge` or
  `research` tool.** This hides routing from the model, but it also hides
  inspection and traversal. The agent loses the ability to reason step by step
  over exact refs.
- **Option D: migrate to a new agent runtime first.** ADR 0013 rejects this for
  Phase 1 until retrieval quality is measured. Runtime churn would mix the
  variables.

## Consequences

- The system prompt can shrink toward role, answer quality, citations, and
  honesty when data is missing.
- MCP and REST direct-tool callers can reuse the same domain contract as the
  Claude SDK agent loop without becoming the design center.
- MCP clients may get namespaced Squire tools instead of generic names that
  collide with other servers.
- Tool outputs become more token-efficient because high-volume operations can
  return concise context by default and detailed context on request.
- SQR-117 and SQR-118 can implement the new tools incrementally while old
  callers keep working.
- Ref parsing, dynamic kind/relation validation, and result shapes become
  load-bearing API surface and need direct tests.
- Eval coverage must measure realistic multi-call tasks, tool errors, runtime,
  token use, held-out prompts, and A/B parity against the current production
  prompt before old prompt choreography is removed.
- The contract reserves campaign and character refs before those sources exist,
  so future work has a place to attach state without inventing another lookup
  model.
