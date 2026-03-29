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

## Issues (in dependency order)

### 1. `refactor: extract service layer from query pipeline`

Separate core business logic from the CLI entry point so multiple transports
can consume it.

- Create `src/service.ts` exporting:
  - `initialize()` — loads vector index, warms embedder model, loads extracted data
  - `isReady(): boolean`
  - `askFrosthaven(question)` — full RAG pipeline (embed → search → generate)
  - `searchRules(query, topK?)` — vector search only
  - `searchCards(query, topK?)` — keyword search over extracted card data
- Refactor `src/query.ts` to be a thin CLI wrapper importing from service
- Move Anthropic client instantiation and system prompt into service
- Expose explicit initialization for index, embedder, and extracted data
- Tests: adapt existing query tests to test service layer

### 2. `feat: add HTTP/REST API with Hono`

Expose Squire as an HTTP service.

- Add `hono` + `@hono/node-server` dependencies
- Create `src/server.ts` with routes:
  - `POST /api/query` — `{ question }` → `{ answer, sources }`
  - `GET /api/search?q=&topK=` → `{ results }` (vector search)
  - `GET /api/cards?q=&topK=` → `{ results }` (card data search)
  - `GET /api/health` → `{ ready, index_size }`
- Zod request validation
- Error handling middleware (structured JSON errors)
- Langfuse tracing per request
- Add `"serve": "node src/server.ts"` to package.json
- `PORT` env var (default 3000)
- Tests: Hono test client (`app.request()`, no real HTTP)

### 3. `feat: add remote MCP server with built-in OAuth`

MCP clients (Claude Desktop, Claude.ai, other agents) can connect to Squire
over the network.

- Add `@modelcontextprotocol/sdk` dependency
- Create `src/mcp.ts` defining MCP tools:
  - `ask_frosthaven` — params `{ question }`, full RAG pipeline
  - `search_rules` — params `{ query, topK? }`, vector search
  - `lookup_cards` — params `{ query, topK? }`, card data search
- Mount on Hono server at `/mcp` using `StreamableHTTPServerTransport`
- Implement OAuth 2.1 using SDK auth handlers:
  - `/.well-known/oauth-authorization-server` metadata endpoint
  - `/.well-known/oauth-protected-resource` metadata endpoint
  - `/authorize`, `/token`, `/register` endpoints
  - `requireBearerAuth()` middleware on MCP routes
  - Minimal HTML consent page (built-in, Frosthaven-themed)
  - PKCE required for all clients
  - Dynamic Client Registration supported
- Tests: tool registration, handler logic, OAuth flow

### 4. `feat: web UI for Squire`

A browser-based chat interface for asking Frosthaven rules questions.

- **Rendering:** Hono JSX (server-rendered) + HTMX (streaming, no page reloads)
- **Styling:** Tailwind CSS with Frosthaven/Gloomhaven theme
  - Dark palette, icy blues, medieval typography
  - Thematic to the game world
- **Layout:** Full chat session
  - Message history (user questions + assistant answers)
  - Streaming responses via HTMX + SSE
  - Citations/sources shown inline or collapsible under each answer
- **No build step** — Tailwind via CDN or standalone CLI
- Served from the same Hono server at `/`

### 5. `feat: Squire CLI client`

A standalone CLI command that calls the HTTP API.

- `squire ask "question"` — calls POST /api/query, prints answer
- `squire search "query"` — calls GET /api/search, prints results
- `squire cards "query"` — calls GET /api/cards, prints results
- Reads `SQUIRE_URL` env var (default `http://localhost:3000`)
- Replaces current `npm run query` (which calls the function directly)
- Useful for scripts, automation, and agent skills

### 6. `feat: Claude Code agent skill for Squire`

An agent skill that uses the CLI to query Squire, making it available as a
tool for Claude Code and other agents without MCP setup.

- Skill invocation: `/squire "question"`
- Calls CLI under the hood
- Returns formatted answer with sources

### 7. `chore: remove Discord references from Squire`

Squire is now a standalone service; Discord becomes a separate consumer.

- Remove Discord section from CLAUDE.md
- Update README to describe Squire as a standalone service
- Document how external consumers (Discord bot, web app, etc.) call the API

### 8. `docs: deployment and configuration guide`

- Document all env vars (`ANTHROPIC_API_KEY`, `PORT`, `LANGFUSE_*`)
- Document startup sequence and initialization time
- Document API endpoints with request/response examples
- Document MCP connection URL and Claude Desktop configuration
- Update `.env.example`

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
