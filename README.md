# Squire

An AI-powered knowledge agent for [Frosthaven](https://cephalofair.com/pages/frosthaven), the tactical dungeon-crawling board game. Ask it rules, scenario, section, or card questions and get grounded answers.

## What it does

Squire answers Frosthaven questions with a mix of semantic search, deterministic scenario/section traversal, and exact card lookup. It works across:

- **Rulebook** — the complete Frosthaven rule book
- **Scenario & section books** — exact scenario records, exact section text, and explicit links between them
- **Card data** — 1,900+ structured records from Gloomhaven Secretariat (monster stats, abilities, items, events, battle goals, buildings)

When you ask a question, Claude can either follow exact scenario/section references, search the indexed book corpus, search card data, or mix those paths before answering.

## How it works

```text
Question → Claude tool loop → exact scenario/section lookup and/or semantic search → Answer
```

1. Claude decides whether the question is best served by exact scenario/section tools, semantic book search, card search, or some combination
2. Anchored scenario/section questions use `find_scenario`, `get_scenario`, `get_section`, and `follow_links`
3. Fuzzy book-corpus questions use `search_rules`, and card queries use Postgres full-text search over the `card_*` tables
4. Claude writes the final answer from the retrieved source material

All queries are traced with [Langfuse](https://langfuse.com) for observability.

## Setup

Requires Node.js 24+ (uses native TypeScript execution) and Docker (for the
local Postgres + pgvector database that holds embeddings, seeded game data, and app state).

```bash
# Clone the repo
git clone https://github.com/maz-org/squire.git
cd squire

# Install dependencies
npm install

# Add your API keys
cp .env.example .env
# Edit .env: ANTHROPIC_API_KEY (required), Google OAuth keys + SESSION_SECRET
# (required for web UI login). `GOOGLE_REDIRECT_URI` can stay on
# `http://localhost:3000/auth/google/callback`; linked worktrees reuse the
# current localhost origin at runtime, but every localhost callback port you use
# still has to be pre-registered in Google Cloud Console. The currently
# allowlisted localhost callback ports are `4450` and `5018`. See
# docs/DEVELOPMENT.md for the full auth notes.

# Start the local Postgres + pgvector database
docker compose up -d

# Apply schema migrations to the dev DB
npm run db:migrate

# Optional: migrate the test DB too if you plan to run the test suite
npm run db:migrate:test

# Index the Frosthaven books into pgvector (one-time, ~1 minute)
npm run index

# Seed card data, scenario/section-book data, and a local dev user (idempotent)
# Use `npm run seed` for the prod-relevant seed without the dev user.
npm run seed:dev
```

For the full contributor walkthrough, see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Documentation

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for local setup, env vars, MCP wiring, and data workflows
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the full macOS contributor walkthrough
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system design, auth boundaries, and runtime topology
- [docs/SSE_CONTRACT.md](docs/SSE_CONTRACT.md) for the browser-visible chat streaming contract (`text-delta`, `done`, `error`, tool events)
- [docs/SECURITY.md](docs/SECURITY.md) for the standing security review and mitigation backlog
- [docs/markdown-rendering-styleguide.md](docs/markdown-rendering-styleguide.md) for the supported markdown subset and the shared `.squire-markdown` contract

## Usage

### API server

Start the server to expose REST endpoints and MCP tools:

```bash
npm run serve
# Squire server listening on port <derived-port>
```

The server initializes the vector index and embedder on startup, then
serves:

- **Web UI** — `GET /` (companion-first layout shell, server-rendered HTML;
  `GET /app.css` compiles `src/web-ui/styles.css` in-process via
  `@tailwindcss/node` on first request and caches the result — no build
  step required on a fresh clone. Prod uses content-hashed URLs
  (`/app.<hash>.css`) with immutable caching. See
  [ADR 0011](docs/adr/0011-on-demand-asset-pipeline.md)). Authenticated chat
  runs on `/chat`, `/chat/:conversationId`, and
  `/chat/:conversationId/messages/:messageId`, with persisted per-user
  conversations in Postgres and recent-question navigation for hopping between
  completed turns. Live streaming stays plain text until completion; the final
  assistant answer and refreshed recent-question rail are then swapped in as
  server-rendered sanitized HTML under an HTML-only Content Security Policy.
  The authenticated internal markdown renderer reference page lives at
  `/styleguide/markdown`.
- **REST API** — `GET /api/health`, `/api/search/rules`, `/api/search/cards`,
  `/api/card-types`, `/api/cards`, `/api/cards/:type/:id`, `POST /api/ask`
- **MCP endpoint** — `POST/GET/DELETE /mcp` (Streamable HTTP transport)

Set `PORT` to force a specific listen port. By default, the main checkout uses
`3000`. Linked worktrees start from a checkout-local derived port and then
coordinate within the managed `4000-5999` range so parallel agents do not land
on the same default by accident. Trust the startup log for the final port. If
you need Google sign-in locally, prefer `PORT=4450` or `PORT=5018`; those are
the localhost callback ports currently allowlisted in Google Cloud Console.

### CLI

```bash
npm run query "What does the Poison condition do?"
npm run query "What are the stats of an elite Flame Demon at level 3?"
npm run query "How many small items can I bring into a scenario?"
```

### MCP (Claude Desktop, Claude Code, etc.)

Squire exposes its knowledge tools via the
[Model Context Protocol](https://modelcontextprotocol.io). Any MCP client can
connect and use the tools. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for
local setup instructions.

## Evaluation

Squire includes an evaluation framework for measuring answer quality:

```bash
# Seed the eval dataset to Langfuse (first time)
npm run eval -- --seed

# Run all 16 eval cases
npm run eval -- --name="my experiment"

# Run a subset
npm run eval -- --category=rulebook
npm run eval -- --id=rule-poison
```

Results are tracked in Langfuse with LLM-as-judge scoring (1-5 scale). Current baseline: **73% pass rate, 3.8/5 avg score**.

## Acknowledgments

Game data comes from **[Gloomhaven Secretariat](https://github.com/Lurkars/gloomhavensecretariat)** — structured JSON data for items, characters, monsters, scenarios, and more. Squire wouldn't be possible without their work.

## License

This project is for personal/educational use. Frosthaven is a trademark of Cephalofair Games. Game content belongs to its respective owners.
