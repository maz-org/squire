# Squire

An AI-powered rules assistant for [Frosthaven](https://cephalofair.com/pages/frosthaven), the tactical dungeon-crawling board game. Ask it rules questions and get accurate, sourced answers.

## What it does

Squire uses retrieval-augmented generation (RAG) to answer Frosthaven rules questions. It searches across:

- **Rulebook** — the complete Frosthaven rule book
- **Scenario & section books** — all 166 scenarios and 197 sections
- **Card data** — 1,900+ cards from structured game data (monster stats, abilities, items, events, battle goals, buildings)

When you ask a question, Squire embeds it, searches the vector index and card database for relevant context, then sends everything to Claude for a grounded answer.

## How it works

```text
Question → Embed → Vector Search + Card Search → Claude → Answer
```

1. Your question is embedded using a local transformer model
2. The embedding is compared against ~2,100 indexed chunks from the Frosthaven PDFs
3. Extracted card data is searched in parallel via Postgres full-text search (`ts_rank` over per-table `tsvector` columns)
4. All retrieved context is sent to Claude, which produces an answer grounded in the source material

All queries are traced with [Langfuse](https://langfuse.com) for observability.

## Setup

Requires Node.js 24+ (uses native TypeScript execution) and Docker (for the
local Postgres + pgvector database that holds the rulebook embeddings).

```bash
# Clone the repo
git clone https://github.com/maz-org/squire.git
cd squire

# Install dependencies
npm install

# Add your API keys
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY (and optionally LANGFUSE_* keys)

# Start the local Postgres + pgvector database
docker compose up -d

# Apply schema migrations to the dev DB
npm run db:migrate

# Optional: migrate the test DB too if you plan to run the test suite
npm run db:migrate:test

# Index the rulebooks into pgvector (one-time, ~1 minute)
npm run index

# Seed the card tables + a local dev user (idempotent)
# Use `npm run seed:cards` (or the `seed` alias) if you don't want the dev user.
npm run seed:dev
```

For the full contributor walkthrough, see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

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
  [ADR 0011](docs/adr/0011-on-demand-asset-pipeline.md))
- **REST API** — `GET /api/health`, `/api/search/rules`, `/api/search/cards`,
  `/api/card-types`, `/api/cards`, `/api/cards/:type/:id`, `POST /api/ask`
- **MCP endpoint** — `POST/GET/DELETE /mcp` (Streamable HTTP transport)

Set `PORT` env var to change the listen port. By default, the main checkout
uses `3000` and linked worktrees get deterministic checkout-local ports.

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

# Run all 15 eval cases
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
