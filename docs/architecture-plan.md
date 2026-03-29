# Squire Service Architecture Plan

## Context

Squire is a Frosthaven/Gloomhaven rules assistant powered by RAG. It currently
runs as a CLI tool invoked by Claude Code. The goal is to evolve it into a
standalone service exposable via multiple interfaces — HTTP/REST API, remote MCP,
web UI, CLI client, and agent skill — so any client can consume it.

Discord integration will move to a separate project that calls Squire's API.

## Architecture

```text
┌─────────────────────────────────────────────────────┐
│                   src/server.ts                      │  Hono + @hono/node-server
│                                                      │
│  Web UI:  / (Hono JSX + HTMX, Tailwind)             │
│  REST:    /api/query, /api/search, /api/cards        │
│  MCP:     /mcp (Streamable HTTP + OAuth 2.1)         │
│  Health:  /api/health                                │
│  Auth:    /authorize, /token, /register, consent UI  │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                   src/service.ts                     │  Core business logic
│                                                      │
│  initialize()        — load index, warm embedder     │
│  askFrosthaven()     — full RAG pipeline             │
│  searchRules()       — vector search only            │
│  searchCards()       — keyword search over cards     │
└──────────────────────┬──────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    embedder.ts   vector-store   extracted-data
                     .ts            .ts
```

External clients:

```text
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Web browser │  │ Claude Code  │  │ Discord bot  │
│  (HTMX chat) │  │ (agent skill)│  │ (separate    │
│              │  │              │  │  project)    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └─────── HTTP/REST API ─────────────┘
                         │
              ┌──────────┴──────────┐
              │  MCP (remote, OAuth) │ ← Claude Desktop, other agents
              └─────────────────────┘
```

## Implementation

Work is tracked in the [Squire Service Architecture](https://github.com/orgs/maz-org/projects/1)
GitHub project. Issues #27–#34 cover the implementation in dependency order.

## Key Decisions

| Decision            | Choice                   | Rationale                                                                   |
| ------------------- | ------------------------ | --------------------------------------------------------------------------- |
| HTTP framework      | Hono                     | Lightweight, web-standard Request/Response, TypeScript-first, built-in JSX  |
| MCP transport       | Streamable HTTP (remote) | Squire runs as a network service, not a local subprocess                    |
| MCP auth            | Built-in OAuth 2.1       | No external auth server; uses SDK auth handlers + minimal consent UI        |
| Web UI rendering    | Hono JSX + HTMX          | Server-rendered, no build step, no client framework                         |
| Web UI styling      | Tailwind CSS             | Rapid prototyping, Frosthaven dark/icy theme                                |
| Web UI interaction  | HTMX + SSE               | Streaming chat responses without a JS framework                             |
| Deployment          | Clone, configure, run    | No Docker/packaging yet; just a runnable repo                               |
| Discord             | Separate project         | Squire stays focused as a service; Discord bot consumes the API             |
