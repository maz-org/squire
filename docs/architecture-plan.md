# Squire: Agent-Native Architecture Plan

## Context

Squire is a Frosthaven/Gloomhaven knowledge platform. It currently runs as a
CLI tool with a bundled RAG pipeline (`askFrosthaven()`). The goal is to evolve
it into an **agent-native knowledge platform** — a set of atomic tools that
agents compose to achieve outcomes, exposed via MCP, REST API, web UI, CLI,
and agent skill.

This follows [agent-native architecture principles](https://every.to/guides/agent-native):
features are outcomes described in prompts, pursued by agents with tools in
iterative loops. Squire provides the knowledge tools; agents provide the
reasoning.

Discord integration will move to a separate project that consumes Squire's
tools.

## Design Principles

### Atomic tools, not bundled pipelines

The current `askFrosthaven()` bundles embedding, vector search, card search,
context assembly, and LLM generation into one function. This is the anti-pattern
of "agent executes your workflow." Instead, Squire exposes **atomic data access
primitives** that agents compose with judgment.

### Dynamic capability discovery

Agents shouldn't need hardcoded knowledge of what data Squire has. They
discover it at runtime via `list_card_types()` and `list_cards()`. New card
types added to the data → agents discover and use them automatically.

### Graduated optimization

The bundled RAG pipeline doesn't disappear — it becomes an **optimized path**
for simple Q&A. Atomic tools are the foundation; the pipeline is a convenience
shortcut for the common case.

### Accumulated context

Squire maintains state about the user's campaign (characters, completed
scenarios, prosperity level). Agents read this at session start for contextual
answers.

## Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                    src/server.ts                          │  Hono + @hono/node-server
│                                                          │
│  Web UI:  / (agent loop — Hono JSX + HTMX, Tailwind)    │
│  REST:    /api/* (atomic endpoints + convenience /ask)   │
│  MCP:     /mcp (Streamable HTTP + OAuth 2.1)             │
│  Health:  /api/health                                    │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                   Atomic Tools                           │
│                                                          │
│  Discovery:                                              │
│    list_card_types()         → available data categories │
│    list_cards(type, filter?) → browse/filter cards       │
│                                                          │
│  Data access:                                            │
│    get_card(type, id)        → specific card by type+id  │
│    search_rules(query, topK) → vector search rulebook    │
│    search_cards(query, topK) → keyword search all cards  │
│                                                          │
│  Campaign state:                                         │
│    get_campaign()            → current campaign context  │
│    update_campaign(k, v)     → remember campaign state   │
│                                                          │
│  Optimized path (graduated to code):                     │
│    ask(question)             → bundled RAG for simple Q&A│
└──────────────────────────┬──────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    embedder.ts      vector-store      extracted-data
                        .ts               .ts
```

### Why atomic tools matter

With `askFrosthaven()` alone, an agent can only ask a question and get an
answer. With atomic tools, an agent can:

- "Compare the stats of all flying monsters at level 3"
- "Find all items that grant advantage, cross-reference with Blinkblade abilities"
- "What scenarios chain from scenario 61, and what monsters appear in them?"
- "We're fighting Earth Demons tonight — what are they immune to, and which of
  our items counter that?"

These are **emergent capabilities** — we never built features for them, but
agents compose the tools to accomplish them.

### Web UI as agent loop

The web UI is not a form that calls `POST /api/ask`. It's an **agent loop** —
an LLM with Squire's tools that converses with the user, making multiple tool
calls as needed. The chat session persists. The agent uses campaign context to
give personalized answers.

This is where the Frosthaven-themed chat (dark palette, icy blues, medieval
typography) with HTMX streaming and inline citations lives. But the agent
behind it can do multi-step reasoning, not just single-shot Q&A.

## Implementation

Work is tracked in the [Squire Service Architecture](https://github.com/orgs/maz-org/projects/1)
GitHub project.

## Key Decisions

- **Architecture:** Agent-native — tools as primitives, features as prompts, emergent capability
- **Tool design:** Atomic + discovery — agents compose tools creatively; discover available data at runtime
- **RAG pipeline:** Optimized convenience — graduated-to-code hot path, not the foundation
- **HTTP framework:** Hono — lightweight, web-standard Request/Response, TypeScript-first, built-in JSX
- **MCP transport:** Streamable HTTP (remote) — network service, not local subprocess
- **MCP auth:** Built-in OAuth 2.1 — SDK auth handlers + minimal consent UI, no external auth server
- **Web UI rendering:** Hono JSX + HTMX — server-rendered, no build step, no client framework
- **Web UI architecture:** Agent loop — LLM with Squire's tools, not a form calling a fixed endpoint
- **Web UI styling:** Tailwind CSS — Frosthaven dark/icy theme
- **Campaign state:** File-based context — agents read/update; persists across sessions
- **Deployment:** Clone, configure, run — no Docker/packaging yet
- **Discord:** Separate project — Squire stays focused as a knowledge platform
