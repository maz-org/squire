# Development Guide

## Prerequisites

- Node.js 24+ (see `.nvmrc`)
- Docker (for the Postgres + pgvector dev database)
- `.env` file with `ANTHROPIC_API_KEY`
- [gstack](https://github.com/garrytan/gstack) skills for Claude Code (see
  [AI tooling setup](#ai-tooling-setup) below)

Extracted card data (`data/extracted/*.json`) is committed to the repo.
The rulebook vector index lives in Postgres (pgvector) and is populated by
running `npm run index` against a local docker-compose Postgres — see the
[Database setup](#database-setup) and [Data management](#data-management)
sections below.

## Database setup

Squire uses Postgres + pgvector for rulebook embeddings, card data, and
OAuth state. Local dev runs it via docker-compose:

```bash
docker compose up -d      # first run: creates the squire + squire_test DBs
npm run db:migrate        # apply Drizzle migrations to the dev DB
npm run db:migrate:test   # apply Drizzle migrations to the test DB
npm run index             # populate rulebook embeddings from data/pdfs/
```

`db:migrate` and `db:migrate:test` both go through `resolveDatabaseUrl()` in
`src/db.ts`, so the test variant just sets `NODE_ENV=test` — no manual
`DATABASE_URL=...` incantation required.

The connection string defaults to
`postgres://squire:squire@localhost:5432/squire` — no `.env` edit needed.
Under vitest the default flips to `squire_test`. Override either by
setting `DATABASE_URL` / `TEST_DATABASE_URL` in `.env`.

**If `npm run db:migrate` fails with "database squire_test does not exist":**
you have a pre-existing data volume from before `scripts/init-db.sql` was
added. The Postgres image only runs init scripts on a fresh volume, so you
need to wipe and reprovision:

```bash
docker compose down -v   # destroys the data volume
docker compose up -d     # re-runs scripts/init-db.sql
npm run db:migrate
```

`npm run db:reset` drops and recreates the current `DATABASE_URL` target
(guarded to refuse anything that isn't `squire` or `squire_test`).

## Running the dev server

```bash
npm run serve
```

The server starts on port 3000 (override with `PORT` env var). It
initializes the vector index, verifies extracted card data, and warms
the embedder before accepting requests.

Health check:

```bash
curl http://localhost:3000/api/health
# {"ready":true,"index_size":2147}
```

Stop the server with Ctrl-C or `kill $(lsof -ti :3000)`.

## REST API endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/health` | Readiness check with index size |
| GET | `/api/search/rules?q=&topK=` | Vector search over rulebook passages |
| GET | `/api/search/cards?q=&topK=` | Postgres FTS over the `card_*` tables, ranked by `ts_rank` |
| GET | `/api/card-types` | List card types with record counts |
| GET | `/api/cards?type=&filter=` | List cards of a type (filter is JSON) |
| GET | `/api/cards/:type/:id` | Look up a single card |
| POST | `/api/ask` | Bundled RAG pipeline (`{ question }` → `{ answer }`) |

All errors return `{ error, status }` as JSON.

`topK` defaults to 6, must be 1–100. The `filter` parameter is a
URL-encoded JSON object with AND-logic field matching.

## MCP server

Squire exposes 5 atomic tools via MCP at `/mcp`:

| Tool | Description |
| ---- | ----------- |
| `search_rules` | Vector search over rulebook passages |
| `search_cards` | Postgres FTS over the `card_*` tables, ranked by `ts_rank` |
| `list_card_types` | List available card categories with counts |
| `list_cards` | List cards of a type with optional field filter |
| `get_card` | Look up a single card by type and identifier |

The MCP endpoint uses Streamable HTTP transport in stateless mode (no
auth in development). OAuth ships with the User Accounts work tracked
in Linear (SQR-37/38/39/40).

For broader architectural context — agent loop, atomic-tool design,
data layer, deployment, observability — see
[ARCHITECTURE.md](ARCHITECTURE.md).

### Connecting Claude Desktop (development)

Claude Desktop doesn't natively support Streamable HTTP MCP servers
yet — it requires a stdio bridge. Use
[mcp-remote](https://www.npmjs.com/package/mcp-remote):

1. Start the dev server: `npm run serve`

2. Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "squire": {
         "command": "npx",
         "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"]
       }
     }
   }
   ```

   If Claude Desktop uses an older Node version (< 20), specify the
   full path to a Node 24+ `npx` in the `command` field, and set
   `env.PATH` to include that Node's bin directory.

3. Restart Claude Desktop. The tools appear in the chat input area.

Once the User Accounts work (Linear SQR-37/38/39/40) ships, Squire can
be added as a proper Connector in Claude Desktop via the `+` button in
Settings > Connectors (no config file needed).

### Connecting Claude Code (development)

Add to your Claude Code MCP settings
(`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "squire": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Claude Code supports Streamable HTTP natively — no bridge needed.

## Testing

```bash
npm test              # Run all tests (shuffled order)
npm run test:watch    # Watch mode
npm run typecheck     # TypeScript type checking
npm run lint          # ESLint
npm run format:check  # Prettier check
npm run build:css     # Compile src/web-ui/styles.css → public/app.css (Tailwind CLI, ADR 0008)
```

Tests use randomized execution order (`sequence.shuffle` in vitest
config) to catch order-dependent tests. The full suite runs as a
pre-commit hook along with typecheck and lint.

**Prettier covers everything CI checks.** CI runs `prettier --check src/ test/`
which walks those directories and formats *every* file type Prettier knows
(`.ts`, `.js`, `.json`, `.yml`, `.md`, etc.). `lint-staged` in `package.json`
must stay in sync — if CI formats a file type, the pre-commit hook must too,
otherwise drift slips through locally and fails in CI. When adding a new file
type under `src/` or `test/`, add it to both `lint-staged` and leave
`format:check` alone (it already globs everything).

## Data management

Frosthaven rulebook PDFs live in `data/pdfs/`. `src/index-docs.ts`
(`npm run index`) chunks them, embeds each chunk with the local Xenova
model, and upserts the result into the `embeddings` pgvector table. The
flat-file `data/index.json` that used to hold this data was removed in
SQR-33 — the runtime vector store is Postgres-only now.

Extracted card data (`data/extracted/*.json`) is still checked into the
repo as regular JSON files. A [CI workflow](../.github/workflows/refresh-data.yml)
refreshes those weekly from upstream GHS and opens a PR if anything
changed.

Local bootstrap on a fresh clone:

```bash
docker compose up -d
npm ci
npm run db:migrate
npm run index              # populates the embeddings table (~2 min)
npm run seed:dev           # seeds card_* tables + the local dev user
```

`npm run seed:dev` is a convenience bundle for local development that runs
`seed:cards` (the prod-relevant step, also aliased as `npm run seed`) and
then `seed:dev-user` (inserts a single predictable dev user into the
`users` table for testing authenticated paths without the Google OAuth
round-trip). The dev-user step refuses to run with `NODE_ENV=production`.

`npm run seed:cards` is idempotent — re-run it any time the extracted
JSON refreshes. It validates each record with the matching `SCHEMAS[type]`
Zod schema and skips anything that fails (the failures are warned to
stderr so you can see what got dropped). Records are upserted on
`(game, source_id)`, so a stale card row gets overwritten in place.

As of SQR-56, `extracted-data.ts` reads exclusively from the `card_*`
tables. The JSON files in `data/extracted/` are only inputs to
`seed-cards.ts`. There is no flat-file fallback. If Postgres is
unreachable, the loader throws.

### Refreshing data

Trigger the workflow manually from the Actions tab, or wait for the
weekly schedule. The workflow shallow-clones only the needed portions
of each upstream repo.

### Working on import scripts locally

Import scripts read from the GHS upstream repo. Clone it once outside
the project and point the scripts at it via env var:

```bash
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/Lurkars/gloomhavensecretariat.git ~/data/ghs
cd ~/data/ghs && git sparse-checkout set data/fh
```

Then run any import script:

```bash
GHS_DATA_DIR=~/data/ghs npx tsx src/import-monster-stats.ts
```

The clone lives outside the repo so it doesn't interfere with git or
worktrees. Commit updated `data/extracted/*.json` files alongside your
script changes.

## AI tooling setup

This repo requires [gstack](https://github.com/garrytan/gstack) for
AI-assisted development. A pre-tool hook in `.claude/settings.json`
enforces this — Claude Code will warn if gstack is missing.

One-time setup (per developer machine):

```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

This installs gstack skills (browse, review, ship, etc.) and enables
auto-updates at the start of each Claude Code session. See the
`## gstack` section in `CLAUDE.md` for the full list of available skills.

## Project structure

```text
src/
  tools.ts          # Atomic data access primitives (search, list, get)
  service.ts        # Service initialization + bundled RAG convenience path
  server.ts         # Hono HTTP server (REST + MCP transport)
  mcp.ts            # MCP tool registration (Streamable HTTP transport)
  agent.ts          # Knowledge agent loop (Claude Sonnet 4.6 + atomic tools)
  index-docs.ts     # Rulebook PDF chunker + indexer (data/pdfs/)
  import-battle-goals.ts
  import-buildings.ts
  import-character-abilities.ts
  import-character-mats.ts
  import-events.ts
  import-items.ts
  import-monster-abilities.ts
  import-monster-stats.ts
  import-personal-quests.ts
  import-scenarios.ts
  query.ts          # Thin CLI wrapper over service.ts
  embedder.ts       # Local embedding via all-MiniLM-L6-v2
  vector-store.ts   # pgvector cosine similarity search
  extracted-data.ts # Postgres-backed card load + FTS via ts_rank
  schemas.ts        # Zod schemas for all 10 card types
  db.ts             # Drizzle client + pool factory (server / cli modes)
  db/
    schema/         # Drizzle schema (core, auth, cards) — barrel in index.ts
    migrations/     # Numbered SQL migrations (hand-written for FTS generated cols)
  seed/
    seed-cards.ts       # JSON → Zod validation → upsert into card_* tables
    seed-dev-user.ts    # Idempotent single-row dev user for local auth testing
```

## Changelog

- **2026-04-08:** SQR-36 — local bootstrap flipped to `npm run seed:dev`, which chains `seed:cards` and the new `seed:dev-user` helper. `src/seed/seed-dev-user.ts` upserts a predictable `dev@squire.local` row into `users` via `ON CONFLICT DO NOTHING` (no target, so either `email` or `google_sub` conflicts no-op). CLI wrapper refuses `NODE_ENV=production`. New `seed` alias points at `seed:cards` as the prod-relevant default.
- **2026-04-08:** SQR-56 — `extracted-data.ts` is Postgres-backed via FTS. The card tables hold the runtime data; `data/extracted/*.json` is now a seed input. The atomic tools became async and gained `opts.game`. `getCard` resolves on canonical `sourceId` (the per-type natural-key map is gone). Removed the "until SQR-56 lands" caveat from the data management section. Updated REST + MCP tables to say "Postgres FTS" instead of "keyword search". Added `src/db/`, `src/seed/` to the project structure tree and corrected the stale "Flat-file vector store" line on `vector-store.ts` (it has been pgvector since SQR-33).
- **2026-04-07:** Reconciled with SPEC v3.0 / ARCHITECTURE v1.0 split. Removed the vestigial in-process MCP client section (the two-agent split uses direct in-process function calls, not internal MCP). Updated project structure to list all 10 `src/import-*.ts` scripts plus `agent.ts` and `index-docs.ts`. Documented `data/pdfs/` as the rulebook PDF location. Replaced "Auth Module epic" references with Linear SQR-37/38/39/40 (User Accounts project). Added forward reference to `ARCHITECTURE.md` for architectural detail.
- **2026-04-07:** Renamed from `docs/development.md` to `docs/DEVELOPMENT.md` as part of the ALL_CAPS docs consolidation.
- **2026-04-06:** Retired OCR pipeline and Worldhaven dependency references (commit `34a26a1`).
- **2026-04-06:** Added gstack requirement for AI-assisted work (PR #175).
- **2026-04-06:** Documented monster abilities import from GHS structured data (PR #172).
- **2026-04-05:** Replaced git submodules with committed extracted data + weekly CI refresh workflow (PR #162).
- **2026-03-29:** Initial development guide added (PR #90).
