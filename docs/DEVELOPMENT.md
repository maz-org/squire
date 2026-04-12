# Development Guide

## Prerequisites

- Node.js 24+ (see `.nvmrc`)
- Docker (for the Postgres + pgvector dev database)
- `.env` file with required environment variables (see below)
- [gstack](https://github.com/garrytan/gstack) skills for Claude Code (see
  [AI tooling setup](#ai-tooling-setup) below)

### Environment variables

Create a `.env` file in the project root:

```bash
# Required
ANTHROPIC_API_KEY=...

# Google OAuth (required for web UI login)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
# Fallback callback for non-local hosts. For localhost sign-in, run on an
# allowlisted port and the app derives the callback URI from request origin.
GOOGLE_REDIRECT_URI=http://localhost:4450/auth/google/callback
SESSION_SECRET=<random 32+ character string>

# Email allowlist (comma-separated, controls who can log in)
SQUIRE_ALLOWED_EMAILS=your-email@example.com

# Optional (Langfuse observability)
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
```

Generate `SESSION_SECRET` with:

```bash
openssl rand -base64 48
```

`GOOGLE_REDIRECT_URI` is still the configured fallback callback for production
and non-local hosts. In local development, `/auth/google/start` and
`/auth/google/callback` reuse the current `localhost` origin so linked
worktrees can log in on their own ports. Google still requires exact
redirect-URI matches. The localhost callback ports currently allowlisted for
sign-in are:

- `http://localhost:4450/auth/google/callback`
- `http://localhost:5018/auth/google/callback`

If you run the app on another port, Google sign-in will fail until that
callback URI is added to the OAuth client in Google Cloud Console.

For local dev without Google OAuth, the app still starts and serves the
homepage. Auth routes still need a valid `SESSION_SECRET`, and Google-backed
login still needs working OAuth credentials. Run `npm run seed:dev` to create a
test user for authenticated code paths without doing the Google round-trip, but
note that the browser sign-in UI still follows the real Google OAuth flow.

Extracted card data (`data/extracted/*.json`) is committed to the repo.
The rulebook vector index lives in Postgres (pgvector) and is populated by
running `npm run index` against a local docker-compose Postgres — see the
[Database setup](#database-setup) and [Data management](#data-management)
sections below.

## Database setup

Squire uses Postgres + pgvector for rulebook embeddings, card data, and
OAuth state. Local dev runs it via docker-compose:

```bash
docker compose up -d      # first run: creates the main-checkout DBs
npm run db:migrate        # apply Drizzle migrations to the dev DB
npm run db:migrate:test   # apply Drizzle migrations to the test DB
npm run index             # populate rulebook embeddings from data/pdfs/
```

`db:migrate` and `db:migrate:test` both go through `resolveDatabaseUrl()` in
`src/db.ts`, so the test variant just sets `NODE_ENV=test` — no manual
`DATABASE_URL=...` incantation required.

Local defaults are now **checkout-local**:

- main checkout: dev DB `squire`, test DB `squire_test`, preferred port `3000`
- linked worktree: derived defaults based on the checkout path, for example
  `squire_<slug>`, `squire_<slug>_test`, and a preferred non-3000 local port

This lets two worktrees run migrations, tests, and dev servers concurrently
without sharing the same local runtime resources by accident.

Environment variables still win:

- `DATABASE_URL` overrides the derived dev DB
- `TEST_DATABASE_URL` overrides the derived test DB
- `PORT` overrides the derived default or claimed port

For a fresh linked worktree, `npm run db:migrate` / `npm run db:migrate:test`
will create the managed local database automatically if it does not exist yet.

Fresh linked worktree checklist before authenticated browser testing or QA:

```bash
npm install
docker compose up -d
npm run db:migrate
npm run db:migrate:test   # if you will run tests in this checkout
npm run index
npm run seed:dev
```

That bootstrap is enough to make the worktree self-contained: checkout-local
DBs exist, embeddings are indexed, card tables are seeded, and the predictable
`dev@squire.local` user exists. Make sure the worktree's `.env` also includes
`SESSION_SECRET`. Without it, the homepage can still render, but session-backed
routes and authenticated QA will fail once cookies or CSRF checks are involved.

**If `npm run db:migrate` fails because a managed local database is missing or
the Docker volume is stale:** the Postgres image only runs init scripts on a
fresh volume, so you may need to wipe and reprovision:

```bash
docker compose down -v   # destroys the data volume
docker compose up -d     # re-runs scripts/init-db.sql
npm run db:migrate
```

`npm run db:reset` drops and recreates the current checkout's managed local
database target. It refuses unrelated database names.

## Running the dev server

```bash
npm run serve
```

The server chooses a checkout-local port in two steps:

- main checkout: `3000`
- linked worktree: start from the checkout-derived preferred port, then claim
  the first available port in the managed `4000-5999` range

Override with `PORT` if you want a specific port. On startup, the server logs
the final port it selected. It binds the port immediately, then warms the
retrieval stack in the background. If embeddings or card data are missing,
startup no longer crashes; `/api/health` returns a coarse lifecycle snapshot
immediately and query endpoints return `503` JSON errors until `npm run index`
and/or `npm run seed:cards` has been run. Detailed bootstrap and dependency
reasons are logged server-side.

If you need Google sign-in locally, use `PORT=4450` or `PORT=5018`. Those are
the only localhost ports currently allowlisted in Google Cloud Console.

After signing in, `/styleguide/markdown` renders the in-app markdown contract
through the real server renderer. Use it to QA headings, tables, links, and
allowlisted images without depending on a live conversation.

To discover the current worktree's runtime settings, use startup logs or ask
the app directly by checking:

- `git rev-parse --show-toplevel`
- `git worktree list --porcelain`
- `npm run serve` startup output

Example health check for the main checkout:

```bash
curl http://localhost:3000/api/health
# {"lifecycle":"ready","ready":true,"warming_up":false}
```

For linked worktrees, replace `3000` with that worktree's logged port. Do not
assume the derived preferred port won the race if another worktree or local
process was already using it.

Stop the server with Ctrl-C or `kill $(lsof -ti :<port>)`.

## REST API endpoints

| Method | Path                         | Description                                                        |
| ------ | ---------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/health`                | Snapshot-only readiness check (`lifecycle`, `ready`, `warming_up`) |
| GET    | `/api/search/rules?q=&topK=` | Vector search over rulebook passages                               |
| GET    | `/api/search/cards?q=&topK=` | Postgres FTS over the `card_*` tables, ranked by `ts_rank`         |
| GET    | `/api/card-types`            | List card types with record counts                                 |
| GET    | `/api/cards?type=&filter=`   | List cards of a type (filter is JSON)                              |
| GET    | `/api/cards/:type/:id`       | Look up a single card                                              |
| POST   | `/api/ask`                   | Bundled RAG pipeline (`{ question }` → `{ answer }`)               |

All errors return `{ error, status }` as JSON. Bootstrap and dependency details
are logged server-side rather than returned from public endpoints.

`topK` defaults to 6, must be 1–100. The `filter` parameter is a
URL-encoded JSON object with AND-logic field matching.

### Bootstrap design guardrails

Startup and readiness are modeled as an explicit lifecycle in
[`src/service.ts`](../src/service.ts), not as route-local booleans. If you are
adding a new endpoint or capability:

- keep `/api/health` snapshot-only; do not add live DB probes or warmup waits
  to the health path
- map the endpoint to a capability based on the dependencies it actually uses
  on the request path, not just on nearby data being present
- preserve request validation order: malformed requests should still return
  their normal `400` responses before bootstrap gating when validation is
  independent of readiness
- add lifecycle tests for any new partial-availability claim

Examples:

- rule search depends on both the embeddings table and the embedder, because it
  calls `embed(query)` on every request
- card lookup depends on seeded card tables, but not on embedder warmup
- ask depends on successful warmup as well as bootstrap data

For the full state-machine rationale and endpoint policy table, see
[docs/plans/sqr-84-startup-lifecycle-state-machine.md](plans/sqr-84-startup-lifecycle-state-machine.md).

## MCP server

Squire exposes 5 atomic tools via MCP at `/mcp`:

| Tool              | Description                                                |
| ----------------- | ---------------------------------------------------------- |
| `search_rules`    | Vector search over rulebook passages                       |
| `search_cards`    | Postgres FTS over the `card_*` tables, ranked by `ts_rank` |
| `list_card_types` | List available card categories with counts                 |
| `list_cards`      | List cards of a type with optional field filter            |
| `get_card`        | Look up a single card by type and identifier               |

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

### Agent tooling state model

Squire has three different categories of agent/tooling state:

1. **Checked-in project guidance** in the repo:
   - `CLAUDE.md`
   - `AGENTS.md`
   - `docs/agent/*`
   - `docs/ARCHITECTURE.md`
   - `docs/DEVELOPMENT.md`
   - `DESIGN.md`
2. **Canonical gstack runtime state** on the developer machine:
   - `~/.gstack/projects/maz-org-squire/`
   - typically includes files like `learnings.jsonl`, `timeline.jsonl`, and
     `repo-mode.json`
3. **Repo-local `.gstack/` artifact output**:
   - QA reports
   - browser logs
   - temporary local outputs that are useful during work

Do not treat repo `.gstack/` as canonical project memory. If a learning should
survive a single machine or tool session, promote it into checked-in docs, and
into an ADR when it becomes a non-obvious architectural decision.

### Codex and Claude configuration split

- **Machine-level MCP** like Linear belongs in user config:
  - Claude: user-level Claude config
  - Codex: `~/.codex/config.toml`
- **Repo-local MCP** for Squire itself stays in [`.mcp.json`](../.mcp.json)
- **Repo-local operating guidance** lives in:
  - [`CLAUDE.md`](../CLAUDE.md) for Claude
  - [`AGENTS.md`](../AGENTS.md) for Codex

The goal is shared project intent with tool-specific entrypoints, not identical
vendor config files.

### Agent parity automation

The repo uses a **conditional pre-commit check** for agent parity.

If your staged changes touch any of these files:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/agent/agent-baseline.md`
- `docs/agent/learnings.md`
- `docs/DEVELOPMENT.md`
- `.mcp.json`
- `scripts/check-agent-parity.ts`
- `scripts/export-gstack-learnings.ts`

then `.husky/pre-commit` automatically runs:

```bash
npm run agent:check
```

This is meant to package parity fixes into the same branch and PR as the
primary change, instead of discovering drift later in CI or a follow-up pass.

Git hooks are installed by `npm install` via the `prepare` script. Squire now
pins `core.hooksPath` to the checked-in `.husky` directory instead of Husky's
generated `._` shim path, so linked worktrees do not depend on generated hook
files from another checkout. If a fresh worktree warns that hooks are missing,
repair them with:

```bash
npm run hooks:install
```

`npm run agent:export-learnings` is **not** automated in git hooks. It reads
machine-local `~/.gstack/projects/maz-org-squire/learnings.jsonl`, generates
`docs/agent/learnings.md`, and should be run deliberately when the local
learnings have accumulated enough signal to be worth curating into the repo.
Normal flow: use gstack `/learn` to inspect or search the local learnings, then
run `npm run agent:export-learnings` to promote the durable ones into the
checked-in summary.

### Weekly learnings export via launchd

On macOS, local setup now also installs a **LaunchAgent** for the current clone
when you run `npm install` (via the `prepare` script).

The installer script is:

```bash
npm run agent:install-launchagent
```

What it does:

- writes `~/Library/LaunchAgents/org.maz.squire.agent-learnings.plist`
- loads it with `launchctl`
- runs `npm run agent:export-learnings` at load time and then every 7 days
- logs output to `~/.gstack/analytics/squire-agent-learnings.log`

Important behavior:

- the job **does not auto-commit or auto-push**
- it no-ops if `~/.gstack/projects/maz-org-squire/learnings.jsonl` does not exist
- if you install the repo in a different path on another machine, running
  `npm install` there rewrites the LaunchAgent to point at that clone
- if a machine is asleep or closed at the exact scheduled time, the run is not
  guaranteed to happen at that moment; `RunAtLoad` ensures it runs again the
  next time the LaunchAgent is loaded (for example after login or reinstall)

## Testing

```bash
npm test              # Run all tests (shuffled order)
npm run test:watch    # Watch mode
npm run typecheck     # TypeScript type checking
npm run lint          # ESLint
npm run lint:css      # stylelint (CSS, Tailwind v4 aware — SQR-70)
npm run lint:md       # markdownlint
npm run format:check  # Prettier check
npm run check         # local CI gate: typecheck + lint + format + tests
# No CSS build step — `/app.css` is compiled in-process on request
# via @tailwindcss/node. SQR-71 / ADR 0011 replaced the former
# `npm run build:css` pipeline.
```

Tests use randomized execution order (`sequence.shuffle` in vitest
config) to catch order-dependent tests. The pre-commit hook is intentionally
cheap: it runs the conditional agent parity check above plus `lint-staged` on
staged files. There is no pre-push hook. Use `npm run check` as the canonical
local gate before `/ship` or any manual push you expect to survive CI.

**Prettier covers everything CI checks.** CI runs `prettier --check src/ test/`
which walks those directories and formats _every_ file type Prettier knows
(`.ts`, `.js`, `.json`, `.yml`, `.md`, etc.). `lint-staged` in `package.json`
must stay in sync with the staged-file auto-fix workflow, and `npm run check`
is the single full-repo local entry point used before shipping. When adding a
new file type under `src/` or `test/`, add it to `lint-staged` and leave
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

Fresh linked worktrees need the same bootstrap sequence. The subtle part is
`SESSION_SECRET`: the server can still boot and serve the anonymous homepage
without it, which makes the checkout look healthy at first glance, but
authenticated routes and browser QA will break as soon as session cookies or
CSRF validation enter the path.

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
- **2026-04-09:** Clarified fresh linked-worktree bootstrap. Authenticated QA needs local dependencies installed plus the full local bootstrap (`npm install`, `docker compose up -d`, migrations, `npm run index`, `npm run seed:dev`) and `SESSION_SECRET`; otherwise the homepage can load while session-backed routes still fail.
- **2026-04-08:** SQR-56 — `extracted-data.ts` is Postgres-backed via FTS. The card tables hold the runtime data; `data/extracted/*.json` is now a seed input. The atomic tools became async and gained `opts.game`. `getCard` resolves on canonical `sourceId` (the per-type natural-key map is gone). Removed the "until SQR-56 lands" caveat from the data management section. Updated REST + MCP tables to say "Postgres FTS" instead of "keyword search". Added `src/db/`, `src/seed/` to the project structure tree and corrected the stale "Flat-file vector store" line on `vector-store.ts` (it has been pgvector since SQR-33).
- **2026-04-07:** Reconciled with SPEC v3.0 / ARCHITECTURE v1.0 split. Removed the vestigial in-process MCP client section (the two-agent split uses direct in-process function calls, not internal MCP). Updated project structure to list all 10 `src/import-*.ts` scripts plus `agent.ts` and `index-docs.ts`. Documented `data/pdfs/` as the rulebook PDF location. Replaced "Auth Module epic" references with Linear SQR-37/38/39/40 (User Accounts project). Added forward reference to `ARCHITECTURE.md` for architectural detail.
- **2026-04-07:** Renamed from `docs/development.md` to `docs/DEVELOPMENT.md` as part of the ALL_CAPS docs consolidation.
- **2026-04-06:** Retired OCR pipeline and Worldhaven dependency references (commit `34a26a1`).
- **2026-04-06:** Added gstack requirement for AI-assisted work (PR #175).
- **2026-04-06:** Documented monster abilities import from GHS structured data (PR #172).
- **2026-04-05:** Replaced git submodules with committed extracted data + weekly CI refresh workflow (PR #162).
- **2026-03-29:** Initial development guide added (PR #90).
