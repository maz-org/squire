# Development Guide

## Prerequisites

- Node.js 26.1+ (see `.nvmrc`)
- Docker (for the Postgres + pgvector dev database)
- actionlint (`brew install actionlint`) for local GitHub Actions workflow linting
- `.env` file with required environment variables (see below)
- [gstack](https://github.com/garrytan/gstack) and gbrain for AI-assisted
  development (see [AI tooling setup](#ai-tooling-setup) below)

### Environment variables

Create a `.env` file in the project root:

```bash
# Required
ANTHROPIC_API_KEY=...
# Required for rule indexing and retrieval
VOYAGE_API_KEY=...
# Required when running OpenAI-backed evals
OPENAI_API_KEY=...

# Google OAuth (required for web UI login)
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
# Fallback callback for non-local hosts. For localhost sign-in, run on an
# allowlisted port and the app derives the callback URI from request origin.
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:4450/auth/google/callback
SESSION_SECRET=<random 32+ character string>

# Email allowlist (comma-separated, controls who can log in)
SQUIRE_ALLOWED_EMAILS=your-email@example.com

# LangSmith observability
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=squire-evals
LANGSMITH_TRACING=true
# LANGSMITH_ENDPOINT=https://api.smith.langchain.com
# LANGSMITH_WORKSPACE_ID=...

# Optional Sentry app observability. Leave unset for normal local dev/tests.
# SENTRY_DSN=...
# SENTRY_RELEASE=local-dev

# Trace environment label for LangSmith; defaults to NODE_ENV.
SQUIRE_ENV=development

# Daily LLM spend circuit breaker. Defaults shown here match the app defaults.
# Budget accounting is local Postgres state; LangSmith is observability only.
# SQUIRE_LLM_DAILY_BUDGET_USD=10
# SQUIRE_LLM_BUDGET_WARNING_THRESHOLD=0.8
# SQUIRE_LLM_INPUT_USD_PER_MILLION_TOKENS=3
# SQUIRE_LLM_OUTPUT_USD_PER_MILLION_TOKENS=15
# SQUIRE_LLM_CACHE_CREATION_INPUT_USD_PER_MILLION_TOKENS=6
# SQUIRE_LLM_CACHE_READ_INPUT_USD_PER_MILLION_TOKENS=0.3

# Redis/Valkey-compatible app rate-limit backend. Required in production;
# local development falls back to in-process limits when unset.
# REDIS_URL=redis://localhost:6379

# Production origin lock only. CloudFront sends this value as X-Origin-Secret.
# ORIGIN_SHARED_SECRET=...
```

Generate `SESSION_SECRET` with:

```bash
openssl rand -base64 48
```

`SQUIRE_ENV=development` is the local environment label that feeds LangSmith tracing.

Missing `SENTRY_DSN` is a local no-op: dev servers and tests should still boot
without sending Sentry events. When `SENTRY_DSN` is set locally for a focused
observability test, use a non-production project or environment and do not put
raw prompts, model output, cookies, bearer tokens, OAuth tokens, provider
payloads, retrieved passages, or full user answers into Sentry. LangSmith stays
the trace and eval surface for LLM behavior; Sentry is only for app errors,
browser/runtime diagnostics, release health, and links back to LangSmith.

Production and staging Sentry values are environment-managed, not committed.
Production stores `SENTRY_DSN` as a Fly secret through the Fly Sentry extension,
sets `SQUIRE_ENV=production`, and stamps `SENTRY_RELEASE` from the deployed Git
SHA. A future staging app should use its own Sentry project or environment,
`SQUIRE_ENV=staging`, and its own DSN secret so test events cannot mix with
production alerts.

`SENTRY_TRACES_SAMPLE_RATE` controls Sentry app-span export only. Leave it unset
or set it to `0` to disable Sentry app spans; set a decimal from `0` to `1` to
sample app spans. In production, set it as a Fly secret so it can be tuned
without a code deploy:

```bash
fly secrets set SENTRY_TRACES_SAMPLE_RATE=0.10 -a maz-squire
```

Keep broad logs and traces governed by sanitization, not cost-based log
allowlists. Usage checks and spend controls live in
[docs/runbooks/sentry-usage-guardrails.md](runbooks/sentry-usage-guardrails.md).

Safe Sentry test events are documented in
[docs/runbooks/observability.md](runbooks/observability.md) and
[docs/runbooks/sentry-alerts.md](runbooks/sentry-alerts.md). Local dry runs
must not send events:

```bash
npm run sentry:test-event -- --kind chat --dry-run
```

Production checks should run inside the Fly app so they use the deployed
`SENTRY_DSN`, `SQUIRE_ENV`, and `SENTRY_RELEASE`:

```bash
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind backend'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind chat'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind browser'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind cron'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind uptime'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind deploy-regression'
```

### Adding telemetry for new features

Sentry owns app logs, app traces, app errors, browser diagnostics, release
health, alerting, and uptime. LangSmith owns AI traces, evals, prompts, model
output, tool calls, and retrieval debugging. A Sentry event may link to a
LangSmith run, thread, or trace, but it must not copy AI payloads from
LangSmith. Keep raw prompts, model output, retrieved passages, full
transcripts, cookies, tokens, emails, structured names, request bodies, and
provider payloads out of Sentry.

Do not call `@sentry/node` directly for app event or log capture outside
`src/telemetry.ts`. `src/instrumentation.ts` may wire Sentry's OpenTelemetry
integration, and `scripts/send-sentry-safe-test-event.ts` may emit documented
safe test events. New server and script telemetry should use the helpers in
`src/telemetry.ts` or `src/script-telemetry.ts`. New browser telemetry should
post sanitized payloads through the existing `/api/browser-telemetry` path so
server-side redaction and Sentry configuration remain centralized.

For a new server route or domain operation, emit a stable log label and safe
attributes:

```ts
captureTelemetryLog('info', 'feature.lifecycle', {
  route: '/api/example',
  requestId,
  conversationId,
  userMessageId,
  langsmithRunUrl,
  context: {
    surface: 'api_example',
    status: 'ok',
  },
  attributes: {
    event_type: 'feature.lifecycle',
    surface: 'api_example',
    status: 'ok',
    duration_ms: durationMs,
  },
});
```

Use stable labels and low-cardinality fields for alerts. Put operational facts
in `attributes`; put only the diagnostic IDs needed by a bug ticket in the
top-level helper input. Do not put raw request bodies, user text, prompt text,
model output, provider payloads, retrieved source text, cookies, auth headers,
emails, or names into either place. The telemetry boundary redacts known
protected keys as a backstop, but callers should still pass safe data.

For a new app span, use OpenTelemetry and Squire-prefixed attributes that match
the alert and evidence fields:

```ts
await trace
  .getTracer('squire.feature')
  .startActiveSpan('squire.feature.operation', async (span) => {
    span.setAttributes({
      'http.route': '/api/example',
      'squire.surface': 'api_example',
      'squire.request_id': requestId,
      'squire.conversation_id': conversationId,
      'squire.user_message_id': userMessageId,
    });

    try {
      return await runOperation();
    } finally {
      span.end();
    }
  });
```

For a cron, migration, release command, or one-off script, wrap the main
operation instead of hand-writing Sentry calls:

```ts
await runScriptWithTelemetry(
  async () => {
    await main();
  },
  {
    scriptName: 'example-job',
    scriptKind: 'cron',
    requestId: 'example-job-' + Date.now(),
  },
);
```

For a new alert or dashboard query, update
`scripts/sentry-app-health-config.ts` first. Add a new area to
`SENTRY_APP_HEALTH_AREAS` when the area is new, add a widget when operators need
a dashboard entry, and add a monitor to `SENTRY_APP_HEALTH_MONITORS` when it
should page or email. Update [docs/runbooks/sentry-alerts.md](runbooks/sentry-alerts.md)
in the same PR, then run:

```bash
npm run sentry:app-health -- --dry-run
```

For a new bug-evidence field, update `src/diagnostic-bundle.ts` and
`src/linear-bug-report-template.ts` together. The field must have a
`DiagnosticBundleSchema` entry, a safe value sanitizer, an unavailable reason,
and rendering through `createLinearBugReportBody()`. When an agent already has
safe links, it can assemble evidence with:

```ts
const bundle = buildDiagnosticBundle({
  requestId,
  conversationId,
  userMessageId,
  sentryEventUrl,
  sentryLogsUrl,
  sentryTraceUrl,
  langsmithRunUrl,
});

const body = createLinearBugReportBody({
  kind: 'app_runtime',
  bundle,
  observed,
  expected,
  likelyFailingArea,
  firstFilesToInspect,
  reproSteps,
  acceptanceCriteria,
});
```

Tests should cover the contract that matters: no-DSN local behavior, redaction,
stable field names, alert filters, dry-run output, and generated Linear evidence
with explicit unavailable reasons.

`GOOGLE_OAUTH_REDIRECT_URI` is still the configured fallback callback for
production and non-local hosts. In local development, `/auth/google/start` and
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
test user for authenticated code paths without doing the Google round-trip.

In non-production checkouts running against a managed-local dev DB, `/login`
also renders a **"Sign in as Dev User (local only)"** button that posts to
`POST /dev/login` and mints a session for that seeded user directly — no
Google round-trip. The route is only registered when `NODE_ENV` is
`development` or `test` AND the resolved `DATABASE_URL` points at a
managed-local database (both checked in `src/auth/dev-login.ts`); it
literally does not exist in production. This is the auth bypass Claude
Code's preview tab relies on, since that sandbox blocks off-localhost
navigation. See [docs/agent/preview-testing.md](agent/preview-testing.md)
for the full preview-tab runbook.

The checked-in extracts under `data/extracted/` are committed seed inputs and
inspection artifacts, not the runtime store. At runtime, Postgres holds three
separate retrieval layers:

- `rule_source_embeddings` for semantic book search (`npm run index`)
- `card_*` tables for GHS card data (`npm run seed:cards`)
- `scenario_book_scenarios`, `section_book_sections`, and `book_references`
  for exact scenario/section lookup (`npm run seed:scenario-section-books`)

See [Database setup](#database-setup) and [Data management](#data-management)
below.

## Database setup

Squire uses Postgres + pgvector for indexed rule-source embeddings, card data,
scenario/section-book data, and OAuth state. Local dev runs it via
docker-compose:

```bash
docker compose up -d      # first run: creates the main-checkout DBs
npm run db:migrate        # apply Drizzle migrations to the dev DB
npm run db:migrate:test   # apply Drizzle migrations to the test DB
npm run index             # populate rule-source embeddings from data/pdfs/ and data/rule-sources/
npm run seed:dev          # seed cards + scenario/section books + dev user
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
retrieval stack in the background. If embeddings, card data, or
scenario/section-book data are missing, startup no longer crashes;
`/api/live` returns immediately and query endpoints return `503` JSON errors
until `npm run index` and the relevant seed step has been run (`npm run seed`,
`npm run seed:cards`, or
`npm run seed:scenario-section-books`). Detailed bootstrap and dependency
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
# {"status":"ok","db":{"status":"ok"},"vector":{"status":"ok"},"embedder":{"status":"ok"}}
```

For linked worktrees, replace `3000` with that worktree's logged port. Do not
assume the derived preferred port won the race if another worktree or local
process was already using it.

Stop the server with Ctrl-C or `kill $(lsof -ti :<port>)`.

## REST API endpoints

| Method | Path                         | Description                                                |
| ------ | ---------------------------- | ---------------------------------------------------------- |
| GET    | `/api/live`                  | Liveness probe; no dependency checks                       |
| GET    | `/api/health`                | Readiness check (`status`, `db`, `vector`, `embedder`)     |
| GET    | `/api/search/rules?q=&topK=` | Vector search over indexed rule-source passages            |
| GET    | `/api/search/cards?q=&topK=` | Postgres FTS over the `card_*` tables, ranked by `ts_rank` |
| GET    | `/api/card-types`            | List card types with record counts                         |
| GET    | `/api/cards?type=&filter=`   | List cards of a type (filter is JSON)                      |
| GET    | `/api/cards/:type/:id`       | Look up a single card                                      |
| POST   | `/api/ask`                   | Bundled RAG pipeline (`{ question }` → `{ answer }`)       |

All errors return `{ error, status }` as JSON. Bootstrap and dependency details
are logged server-side rather than returned from public endpoints.

`topK` defaults to 6, must be 1–100. The `filter` parameter is a
URL-encoded JSON object with AND-logic field matching.

### Bootstrap design guardrails

Startup and readiness are modeled as an explicit lifecycle in
[`src/service.ts`](../src/service.ts), not as route-local booleans. If you are
adding a new endpoint or capability:

- keep request admission paths snapshot-only; do not add live DB probes or
  warmup waits to `getBootstrapStatus()` or route gating. `/api/health` is the
  production readiness probe and intentionally runs bounded
  DB/vector/embedder checks.
- map the endpoint to a capability based on the dependencies it actually uses
  on the request path, not just on nearby data being present
- preserve request validation order: malformed requests should still return
  their normal `400` responses before bootstrap gating when validation is
  independent of readiness
- add lifecycle tests for any new partial-availability claim

Examples:

- rule search depends on both the rule_source_embeddings table and the embedder, because it
  calls `embed(query)` on every request
- card lookup depends on seeded card tables, but not on embedder warmup
- ask depends on successful warmup as well as bootstrap data

For the full state-machine rationale and endpoint policy table, see
[docs/plans/sqr-84-startup-lifecycle-state-machine.md](plans/sqr-84-startup-lifecycle-state-machine.md).

## MCP server

Squire exposes the redesigned knowledge tools via MCP at `/mcp`:

- `inspect_sources` — discover available games, sources, kinds, relations, and counts
- `schema` — inspect fields, ref patterns, filters, examples, and relations for a kind
- `resolve_entity` — resolve natural references to ranked opener-ready refs
- `open_entity` — open one exact canonical ref
- `search_knowledge` — search rules passages, scenarios, sections, and cards
- `neighbors` — traverse known scenario/section relationships

The old atomic MCP tools (`search_rules`, `search_cards`, `list_card_types`,
`list_cards`, `get_card`, `find_scenario`, `get_scenario`, `get_section`, and
`follow_links`) are no longer public. Use the redesigned tools above.

The MCP endpoint uses Streamable HTTP transport in stateless mode and requires
OAuth bearer auth. Local integration tests may stub token verification, but the
server route itself uses the same bearer middleware in development and
production.

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

   If Claude Desktop uses an older Node version (< 26.1.0), specify the
   full path to a Node 26.1+ `npx` in the `command` field, and set
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

Squire has four different categories of agent/tooling state:

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
3. **GBrain indexed memory and code search** on the developer machine:
   - searchable learnings, timelines, plans, transcripts, and code pages
   - one code source per linked worktree
   - worktree-local `.gbrain-source` pins gbrain commands to the right source
4. **Repo-local `.gstack/` artifact output**:
   - QA reports
   - browser logs
   - temporary local outputs that are useful during work

Do not treat repo `.gstack/` as canonical project memory. If a learning should
survive as a rule for every developer and agent run, promote it into checked-in
docs, and into an ADR when it becomes a non-obvious architectural decision.
Use gbrain to search the long tail of prior learnings and session history.

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

### GBrain sync workflow

Squire does not export gstack learnings into a checked-in mirror. Use gbrain
directly for prior learnings, plans, transcripts, timelines, and design
artifacts.

Run gbrain sync from every active linked worktree:

```bash
/sync-gbrain --code-only
```

If slash-style gstack invocation is unavailable in the current tool, run:

```bash
GSTACK_ROOT="${GSTACK_ROOT:-$HOME/.claude/skills/gstack}"
bun run "$GSTACK_ROOT/.agents/skills/gstack/bin/gstack-gbrain-sync.ts" --code-only
```

Sync gbrain:

- when creating or switching into a linked worktree
- after meaningful code or documentation changes
- before `/review`, `/ship`, or a large refactor if the work depends on prior
  project context
- whenever gbrain search results feel stale or point at another worktree

Do not run gbrain sync in git hooks, CI, or every test command. A fresh
worktree sync can be slow and may need network access for embeddings.

## Testing

```bash
npm test              # Fast split suite: parallel unit slice plus serial DB slice
npm run test:unit     # Isolated tests with Vitest file parallelism enabled
npm run test:db       # DB-backed tests serially against the checkout test DB
npm run test:split    # Unit slice plus DB slice via Vitest projects
npm run test:coverage # Fast coverage suite used by normal PR CI
npm run test:coverage:serial # Previous serial coverage path, useful for comparison
npm run test:slow:pdf # Real scenario/section PDF extraction check
npm run test:full     # Fast suite plus real scenario/section PDF extraction
npm run test:watch    # Watch mode
npm run e2e:api-agent # Scheduled/manual authenticated API + agent smoke
npm run e2e:browser   # Scheduled/manual browser UI smoke
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
config) to catch order-dependent tests. Normal PR CI runs the fast coverage
suite and does not reparse the full scenario/section PDF set. The checked-in
scenario/section extract has fast regression coverage; `npm run test:slow:pdf`
and the scheduled/manual CI path run the real PDF parser when that parser or
source PDFs need verification.

`npm run e2e:api-agent` is the scheduled/manual authenticated API and agent
smoke from SQR-23. By default it starts `npm run serve`, waits for `/api/live`
and `/api/health`, mints a real OAuth bearer token, checks `/api/search/rules`
for Frosthaven and Gloomhaven 2e, makes two live `/api/ask` calls, then inserts
an over-budget ledger row and verifies `/api/ask` returns the JSON
`llm_budget_exceeded` 429 before opening an SSE stream. CI runs it only on the
daily schedule and manual dispatch with `SQUIRE_LLM_DAILY_BUDGET_USD=0.25` so
provider spend is capped. For an already-running server, set
`SQUIRE_E2E_START_SERVER=0` and `SQUIRE_E2E_BASE_URL=http://localhost:<port>`.

`npm run e2e:browser` is the scheduled/manual browser smoke from SQR-24. It
starts the real Hono app in test mode with the dev-login route enabled, signs in
as the seeded local dev user, drives the chat UI in Playwright on desktop and a
tablet-sized viewport, and checks active-game payloads, browser SSE rendering,
citations, follow-up game context, and logged-out redirects. It stubs only the
browser `/chat/:conversationId/messages/:messageId/stream` response, so it does
not make live provider calls or require indexed rule-source embeddings.

SQR-148 added an explicit test split for measuring safe parallelism:
`test/helpers/test-slices.ts` lists the DB-backed test files that use the
checkout-local test database. `npm run test:unit` excludes those files and can
use Vitest file parallelism; `npm run test:db` keeps them serial against that
database. `npm run test:coverage` runs both slices as Vitest projects so
coverage can still be measured from one command.

The pre-commit hook is intentionally cheap: it runs the conditional agent
parity check above plus `lint-staged` on staged files. There is no pre-push
hook. Use `npm run check` as the canonical local gate before `/ship` or any
manual push you expect to survive CI.

**Prettier covers everything CI checks.** CI runs `prettier --check src/ test/`
which walks those directories and formats _every_ file type Prettier knows
(`.ts`, `.js`, `.json`, `.yml`, `.md`, etc.). `lint-staged` in `package.json`
must stay in sync with the staged-file auto-fix workflow, and `npm run check`
is the single full-repo local entry point used before shipping. When adding a
new file type under `src/` or `test/`, add it to `lint-staged` and leave
`format:check` alone (it already globs everything).

## Data management

Indexed rule sources live in `data/pdfs/` and `data/rule-sources/`.
`src/index-docs.ts` (`npm run index`) chunks them, embeds each chunk with
Voyage, and upserts the result into the `rule_source_embeddings` pgvector table.
PDFs stay in `data/pdfs/`; HTML, Markdown, and plain-text rule snapshots stay
in `data/rule-sources/`. Filenames must start with a supported game prefix
(`fh-` or `gh2-`) so indexing can derive the `game` value. The
`data/rule-sources/metadata.json` manifest records each non-GHS source's stable
id, file path, game, source type, official URL, capture date, and refresh notes.
FAQ and errata snapshots should also include the official source's
`sourceLastUpdated` date when the upstream page publishes one. Runtime rule
search and citation results derive their game, source type, source label,
locator, URL, and freshness fields from this manifest without changing the
embedding row keys. When an official PDF is image-based, the metadata can also
point at the normalized OCR snapshot used for indexing. To refresh an official
source, replace the stable file in place, update the matching metadata record,
refresh any normalized snapshot, and rerun `npm run index`; unchanged sources
are skipped and changed sources are re-indexed by content hash. Set
`SQUIRE_INDEX_GAME=frosthaven`, `SQUIRE_INDEX_GAME=gloomhaven-2e`, or
`SQUIRE_INDEX_GAME=all` when you need to scope a local or production reindex to
one game or both games. `npm run index` needs Postgres and `VOYAGE_API_KEY`.
After indexing production data, `npm run production-data:smoke -- --game gh2`
performs a real GH2 rules search, a GH2 item lookup, and a Frosthaven
preservation check; it needs the production DB proxy plus `VOYAGE_API_KEY`.

The current Gloomhaven (2nd Edition) rulebook snapshot is the Marker/Datalab
production refresh output selected by
[SQR-234](plans/sqr-234-pdf-extraction-vendor-decision-report.md). Refresh the
stable normalized source with:

```bash
npm run rulebook:refresh:gh2 -- \
  --run-label=marker-datalab-full-rulebook \
  --max-estimated-cost-usd=0.50 \
  --timeout-ms=1800000
```

The command runs the full Gloomhaven (2nd Edition) PDF through the shared
Marker/Datalab eval runner, writes the normalized artifact, manifest, and report
under `eval/results/pdf-extraction/`, promotes the generated Markdown into
`data/rule-sources/gh2-rule-book.md`, and updates
`data/rule-sources/metadata.json` with provider, provider version/config,
source hash, normalized artifact hash, normalized file hash, capture date, run
id, and report paths. The full-rulebook cost guard estimates spend from the
source PDF page count before making the provider request. After a refresh,
review the table of contents and page 30 manually, then reindex and smoke test:

```bash
SQUIRE_INDEX_GAME=gloomhaven-2e npm run index
NODE_ENV=production SQUIRE_ENV=production npm run production-data:smoke -- --game gh2
```

Apple Vision remains the local fallback. Regenerate the fallback snapshot on
macOS with:

```bash
swift scripts/ocr-pdf-apple-vision.swift \
  data/pdfs/gh2-rule-book.pdf \
  data/rule-sources/gh2-rule-book.md \
  https://drive.google.com/file/d/16TmmCKa6zVVObj2qM-vIj9RcEAC3nfMT/view?usp=sharing \
  <capture-date>
```

The reproducible eval baseline uses the shared provider registry, guardrails,
cache, manifest, production retrieval scorer, and score report:

```bash
npm run pdf-extraction:run -- \
  --provider=apple-vision \
  --source=data/pdfs/gh2-rule-book.pdf \
  --pages=2,30,31,32,33,41,42,57,72 \
  --output-dir=eval/results/pdf-extraction \
  --run-label=apple-vision-baseline
```

The live Apple Vision path is macOS-only and should be treated as an explicit
local smoke run. Commit-time tests mock the Swift wrapper and validate the
normalized artifact, manifest, and report shape without running Vision. The
report scorer indexes the selected provider pages into temporary eval sources,
runs the ground-truth retrieval queries with the production embedding and
reranking path, and cleans those eval sources up afterward.

AWS Textract is available as a paid, opt-in extraction adapter. The adapter uses
`StartDocumentAnalysis` / `GetDocumentAnalysis` with `TABLES` and `LAYOUT`,
uploads the local PDF to `AWS_TEXTRACT_S3_BUCKET`, polls for completion, writes
the raw provider JSON under `eval/results/pdf-extraction/raw/aws-textract/`, and
deletes the uploaded S3 input unless `AWS_TEXTRACT_KEEP_S3_INPUT=1` is set. For
selected-page runs, it first writes a temporary page-subset PDF so the Textract
job and cost ceiling match the requested smoke pages. The normalized artifact
records polling mode, JobId, request IDs, S3 locator, region, latency, page
count, estimated cost, page map, and Textract warnings in `providerMetadata`.

Required live-run environment:

```bash
AWS_REGION=us-east-1
AWS_TEXTRACT_S3_BUCKET=<bucket-for-temporary-eval-inputs>
# optional:
AWS_TEXTRACT_S3_PREFIX=pdf-extraction/aws-textract
AWS_TEXTRACT_COST_PER_PAGE_USD=0.015
AWS_TEXTRACT_KEEP_S3_INPUT=0
```

Run selected pages first and keep the cost ceiling low:

```bash
npm run pdf-extraction:run -- \
  --provider=aws-textract \
  --source=data/pdfs/gh2-rule-book.pdf \
  --pages=2,30,31,32,33,41,42,57,72 \
  --output-dir=eval/results/pdf-extraction \
  --run-label=aws-textract-smoke \
  --max-estimated-cost-usd=0.25 \
  --timeout-ms=600000
```

Full-rulebook Textract runs must pass `--allow-full-rulebook`; if the estimated
selected-page cost exceeds `--max-estimated-cost-usd`, pass
`--allow-estimated-cost` only after checking the intended spend. Commit-time
tests mock the Textract and S3 runtime and cover success, async job failure,
poll timeout, rate-limit mapping, partial page warnings, and table
normalization.

LlamaParse is also available as a paid, opt-in extraction adapter. The adapter
uses the LlamaParse REST v1 beta file upload API and REST v2 parse API
directly, starts parse jobs with markdown/text/items/metadata expansion, writes
raw provider JSON under `eval/results/pdf-extraction/raw/llamaparse/`, and
normalizes page markdown, text, headings, tables, page metadata, request IDs,
cache hints, and estimated cost into the shared extraction artifact.
Selected-page runs pass
`page_ranges.target_pages` to LlamaParse so the smoke run and cost guardrail
match the requested pages.

Required live-run environment:

```bash
LLAMA_CLOUD_API_KEY=...
# optional:
LLAMA_CLOUD_BASE_URL=https://api.cloud.llamaindex.ai
LLAMAPARSE_TIER=agentic
LLAMAPARSE_VERSION=latest
LLAMAPARSE_REGION=us
LLAMAPARSE_DISABLE_CACHE=0
LLAMAPARSE_COST_PER_PAGE_USD=0.05
# or, if estimating from credits:
# LLAMAPARSE_CREDITS_PER_PAGE=40
```

The `fast` tier is rejected by this eval because it cannot return the markdown
and item payloads needed for table and block normalization. LlamaParse pricing
varies by tier and options, so keep `LLAMAPARSE_COST_PER_PAGE_USD` or
`LLAMAPARSE_CREDITS_PER_PAGE` aligned with the current account pricing before
running live evals. Cached parse data is a provider-side concern; set
`LLAMAPARSE_DISABLE_CACHE=1` when a run must avoid provider cache reuse.

Run selected pages first and keep the cost ceiling explicit:

```bash
npm run pdf-extraction:run -- \
  --provider=llamaparse \
  --source=data/pdfs/gh2-rule-book.pdf \
  --pages=2,30,31,32,33,41,42,57,72 \
  --output-dir=eval/results/pdf-extraction \
  --run-label=llamaparse-smoke \
  --max-estimated-cost-usd=0.50 \
  --timeout-ms=600000
```

Full-rulebook LlamaParse runs must pass `--allow-full-rulebook`; if the
estimated selected-page cost exceeds `--max-estimated-cost-usd`, pass
`--allow-estimated-cost` only after checking the intended spend. Commit-time
tests mock the REST runtime and cover success, async job failure, poll timeout,
rate-limit mapping, invalid output, heading normalization, table normalization,
and selected-page cost guardrails.

Unstructured is also available as a paid, opt-in extraction adapter. The adapter
uses Unstructured's workflow on-demand jobs API for local files rather than the
legacy partition endpoint: it creates a temporary workflow job with
`POST /jobs/`, polls `GET /jobs/{id}`, reads status details from
`GET /jobs/{id}/details`, downloads provider JSON with
`GET /jobs/{id}/download`, and writes raw provider JSON under
`eval/results/pdf-extraction/raw/unstructured/`. This matches Unstructured's
current production workflow path for local files and keeps the old partition
endpoint out of the eval contract.

Selected-page runs first write a temporary page-subset PDF, then remap
Unstructured's one-based subset page numbers back to the original Gloomhaven
(2nd Edition) page numbers. The default workflow uses High Res partitioning with
coordinates and table structure enabled, plus table-to-HTML enrichment. Optional
generative OCR enrichment can be enabled when the account has an available
provider/model. The normalized artifact records workflow settings, JobId,
workflow metadata, processing status, node stats, page map, table HTML parsing,
coordinates, estimated cost, and retention assumptions in `providerMetadata`.

Marker/Datalab is available as a paid, opt-in extraction adapter. The adapter
uses Datalab's managed Convert API, which runs the Marker/Chandra document
conversion stack and returns Markdown, JSON, and chunks from a single request.
The adapter defaults to `accurate` mode for the image-heavy Gloomhaven (2nd
Edition) rulebook, requests table row bounding boxes and link extraction, writes
raw provider JSON under `eval/results/pdf-extraction/raw/marker-datalab/`, and
normalizes page markdown, text, headings, table cells, geometry, images,
versions, parse quality, provider cost, and latency into the shared extraction
artifact. Selected-page runs pass Datalab's zero-indexed `page_range`, so
`--pages=30` is sent as `page_range=29`.

Required live-run environment:

```bash
UNSTRUCTURED_API_KEY=...
# optional:
UNSTRUCTURED_API_URL=https://platform.unstructuredapp.io/api/v1
UNSTRUCTURED_REGION=us
UNSTRUCTURED_PARTITION_STRATEGY=hi_res
UNSTRUCTURED_TABLE_TO_HTML=1
UNSTRUCTURED_COST_PER_PAGE_USD=0.03
# optional generative OCR, if enabled for the account:
UNSTRUCTURED_GENERATIVE_OCR_SUBTYPE=openai_ocr
UNSTRUCTURED_GENERATIVE_OCR_PROVIDER_TYPE=openai
UNSTRUCTURED_GENERATIVE_OCR_MODEL=<model-name>
```

```bash
DATALAB_API_KEY=...
# optional:
DATALAB_BASE_URL=https://www.datalab.to
DATALAB_MODE=accurate
DATALAB_REGION=us
DATALAB_SKIP_CACHE=0
DATALAB_COST_PER_PAGE_USD=0.006
```

The default cost estimate follows Datalab's published managed API pricing:
`fast` and `balanced` use `$0.004` per page, while `accurate` uses `$0.006` per
page. Keep `DATALAB_COST_PER_PAGE_USD` aligned with account pricing if that
changes.

Run selected pages first and keep the cost ceiling explicit:

```bash
npm run pdf-extraction:run -- \
  --provider=unstructured \
  --source=data/pdfs/gh2-rule-book.pdf \
  --pages=2,30,31,32,33,41,42,57,72 \
  --output-dir=eval/results/pdf-extraction \
  --run-label=unstructured-smoke \
  --max-estimated-cost-usd=0.30 \
  --timeout-ms=600000
```

Full-rulebook Unstructured runs must pass `--allow-full-rulebook`; if the
estimated selected-page cost exceeds `--max-estimated-cost-usd`, pass
`--allow-estimated-cost` only after checking the intended spend. Commit-time
tests mock the workflow-job runtime and cover success, failed jobs, poll
timeouts, rate-limit mapping, invalid output, table normalization, coordinate
normalization, optional generative OCR settings, and selected-page cost
guardrails.

```bash
npm run pdf-extraction:run -- \
  --provider=marker-datalab \
  --source=data/pdfs/gh2-rule-book.pdf \
  --pages=2,30,31,32,33,41,42,57,72 \
  --output-dir=eval/results/pdf-extraction \
  --run-label=marker-datalab-smoke \
  --max-estimated-cost-usd=0.10 \
  --timeout-ms=600000
```

Full-rulebook Marker/Datalab eval runs must pass `--allow-full-rulebook`; the
GH2 production refresh wrapper passes it for you. If the estimated cost exceeds
`--max-estimated-cost-usd`, pass `--allow-estimated-cost` to the raw eval runner
only after checking the intended spend. Commit-time tests mock the Datalab
runtime and cover success, failed requests, poll timeout, rate-limit mapping,
invalid output, provider config hashing, table geometry, selected-page cost
guardrails, full-rulebook cost guardrails, and production source promotion.
Local Marker remains useful for future self-hosted comparisons, but this adapter
intentionally targets managed Datalab so the eval harness can run without
installing local PyTorch/Surya model weights.

See
[docs/plans/sqr-188-189-pdf-extraction-vendor-eval-plan.md](plans/sqr-188-189-pdf-extraction-vendor-eval-plan.md)
for the original vendor evaluation plan and
[docs/plans/sqr-234-pdf-extraction-vendor-decision-report.md](plans/sqr-234-pdf-extraction-vendor-decision-report.md)
for the selected provider decision.
The flat-file `data/index.json` that used to hold this data was removed in
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
npm run index              # populates the rule_source_embeddings table
npm run seed:dev           # seeds card_* tables, scenario/section-book tables, and the local dev user
```

`npm run seed:dev` is a convenience bundle for local development that runs
`npm run seed` (the prod-relevant seed bundle) and then `seed:dev-user`
(inserts a single predictable dev user into the
`users` table for testing authenticated paths without the Google OAuth
round-trip). The dev-user step refuses to run with `NODE_ENV=production`.

`npm run seed` runs both `seed:cards` and `seed:scenario-section-books`, so a
fresh checkout gets the GHS card tables and the exact scenario/section-book
tables together.

Fresh linked worktrees need the same bootstrap sequence. The subtle part is
`SESSION_SECRET`: the server can still boot and serve the anonymous homepage
without it, which makes the checkout look healthy at first glance, but
authenticated routes and browser QA will break as soon as session cookies or
CSRF validation enter the path.

`npm run seed:cards` is idempotent — re-run it any time the extracted
card JSON refreshes. By default it seeds Frosthaven's legacy flat files
(`data/extracted/<type>.json`) and every game directory that exists
(`data/extracted/gh2/<type>.json`). Set `SQUIRE_SEED_GAME=frosthaven`,
`SQUIRE_SEED_GAME=gloomhaven-2e`, or their `fh` / `gh2` aliases to seed only
one game. `SQUIRE_SEED_GAME=all` is equivalent to leaving the variable unset.
It validates each record with the matching `SCHEMAS[type]` Zod schema and skips
anything that fails (the failures are warned to stderr so you can see what got
dropped). Records are upserted on `(game, source_id)`, so a stale card row gets
overwritten in place.

`npm run seed:scenario-section-books` is also idempotent. It replaces the
`scenario_book_scenarios`, `section_book_sections`, and `book_references`
rows for Frosthaven from `data/extracted/scenario-section-books.json` and
for GH2 from `data/extracted/gh2/scenario-section-books.json` when present.
GH2 section rows are structured GHS metadata summaries, not printed section
book prose. It uses the same `SQUIRE_SEED_GAME=frosthaven`,
`SQUIRE_SEED_GAME=gloomhaven-2e`, and `SQUIRE_SEED_GAME=all` scope as card
seeding.

As of SQR-56 and SQR-103, runtime reads come from Postgres only:

- `extracted-data.ts` reads the `card_*` tables
- `scenario-section-data.ts` reads `scenario_book_scenarios`,
  `section_book_sections`, and `book_references`

The JSON files in `data/extracted/` are seed inputs and inspection artifacts.
There is no flat-file runtime fallback. If Postgres is unreachable, the
loaders throw.

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
cd ~/data/ghs

# Frosthaven only
git sparse-checkout set data/fh

# Gloomhaven (2nd Edition) only
git sparse-checkout set data/gh2e

# Both games in the same sparse checkout
git sparse-checkout set data/fh data/gh2e
```

Then run any import script. `GHS_DATA_GAME` selects the GHS `data/<game>`
subtree when `GHS_DATA_DIR` points at a checkout root; it defaults to `fh`:

```bash
# Frosthaven
GHS_DATA_DIR=~/data/ghs node src/import-monster-stats.ts

# Gloomhaven (2nd Edition)
GHS_DATA_DIR=~/data/ghs GHS_DATA_GAME=gh2e node src/import-monster-stats.ts
```

The clone lives outside the repo so it doesn't interfere with git or
worktrees. Frosthaven imports write the legacy `data/extracted/*.json`
files; GH2 imports write `data/extracted/gh2/*.json`. Run
`src/import-ghs-scenario-section-books.ts` for GH2 scenario and section
metadata. Commit updated extracted JSON files alongside your script changes.

Current GH2 GHS coverage:

- Supported card tables: items, monster stats, monster abilities, scenarios,
  events, battle goals, character abilities, character mats, and personal
  quests.
- Supported scenario/section tables: scenario metadata, section metadata
  summaries, and section-to-parent-scenario links.
- Explicitly unsupported: GH2 buildings, because upstream GHS has no
  `buildings.json` for GH2.
- Deferred: GH2 treasure cards. Upstream GHS has `treasures.json`, but Squire
  does not have a table-facing treasure card type yet.

## AI tooling setup

This repo requires [gstack](https://github.com/garrytan/gstack) and gbrain for
AI-assisted development. A pre-tool hook in `.claude/settings.json`
enforces the gstack side for Claude Code. Developers should also run
`gbrain doctor --fast` before relying on prior project memory.

One-time setup (per developer machine):

```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
/setup-gbrain
```

This installs gstack skills (browse, review, ship, etc.) and enables
auto-updates at the start of each Claude Code session. `/setup-gbrain` installs
and initializes the searchable project memory used by `/sync-gbrain`. See the
`## gstack` section in `CLAUDE.md` for the full list of available skills.

## Project structure

```text
src/
  tools.ts          # Atomic data access primitives across books, scenarios/sections, and cards
  service.ts        # Service initialization + model-led /api/ask entry
  server.ts         # Hono HTTP server (REST + MCP transport)
  mcp.ts            # MCP tool registration (Streamable HTTP transport)
  agent.ts          # Knowledge agent loop (Claude Sonnet 4.6 + atomic tools)
  index-docs.ts     # Rule-source chunker + indexer (data/pdfs/, data/rule-sources/)
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
  import-scenario-section-books.ts
  query.ts          # Thin CLI wrapper over service.ts
  embedder.ts       # Voyage embedding client
  vector-store.ts   # pgvector cosine similarity search
  extracted-data.ts # Postgres-backed card load + FTS via ts_rank
  scenario-section-data.ts    # Postgres-backed exact scenario/section lookups + link following
  scenario-section-schemas.ts # Shared types for scenario/section records and links
  schemas.ts        # Zod schemas for all 10 card types
  db.ts             # Drizzle client + pool factory (server / cli modes)
  db/
    schema/         # Drizzle schema (core, auth, cards, scenario/section books) — barrel in index.ts
    migrations/     # Numbered SQL migrations (hand-written for FTS generated cols)
  seed/
    seed-cards.ts       # JSON → Zod validation → upsert into card_* tables
    seed-scenario-section-books.ts # Scenario/section-book extract → Postgres tables
    seed-dev-user.ts    # Idempotent single-row dev user for local auth testing
```

## Changelog

- **2026-04-20:** Documented the dev-only `POST /dev/login` route and the "Sign in as Dev User" button on `/login`. The route is only registered at server startup when `NODE_ENV` is `development`/`test` and `DATABASE_URL` resolves to a managed-local database. The handler also re-checks the same gate on every request as defense-in-depth, so a post-startup config change that flips either condition neutralises the route without needing a restart. Added a forward link to `docs/agent/preview-testing.md` for the Claude Code preview-tab runbook, since that sandbox is the main reason the bypass exists.
- **2026-04-19:** SQR-103 documented the scenario/section-book retrieval layer. Local bootstrap now needs both semantic indexing (`npm run index`) and the deterministic book-data seed (`npm run seed`, or `npm run seed:scenario-section-books` by itself). The MCP tool table and project structure now include `find_scenario`, `get_scenario`, `get_section`, `follow_links`, `scenario-section-data.ts`, `import-scenario-section-books.ts`, and the new scenario/section-book tables.
- **2026-04-08:** SQR-36 — local bootstrap flipped to `npm run seed:dev`, which now runs `npm run seed` and then the new `seed:dev-user` helper. `src/seed/seed-dev-user.ts` upserts a predictable `dev@squire.local` row into `users` via `ON CONFLICT DO NOTHING` (no target, so either `email` or `google_sub` conflicts no-op). CLI wrapper refuses `NODE_ENV=production`. `npm run seed` is now the prod-relevant default.
- **2026-04-09:** Clarified fresh linked-worktree bootstrap. Authenticated QA needs local dependencies installed plus the full local bootstrap (`npm install`, `docker compose up -d`, migrations, `npm run index`, `npm run seed:dev`) and `SESSION_SECRET`; otherwise the homepage can load while session-backed routes still fail.
- **2026-04-08:** SQR-56 — `extracted-data.ts` is Postgres-backed via FTS. The card tables hold the runtime data; `data/extracted/*.json` is now a seed input. The atomic tools became async and gained `opts.game`. `getCard` resolves on canonical `sourceId` (the per-type natural-key map is gone). Removed the "until SQR-56 lands" caveat from the data management section. Updated REST + MCP tables to say "Postgres FTS" instead of "keyword search". Added `src/db/`, `src/seed/` to the project structure tree and corrected the stale "Flat-file vector store" line on `vector-store.ts` (it has been pgvector since SQR-33).
- **2026-04-07:** Reconciled with SPEC v3.0 / ARCHITECTURE v1.0 split. Removed the vestigial in-process MCP client section (the two-agent split uses direct in-process function calls, not internal MCP). Updated project structure to list all 10 `src/import-*.ts` scripts plus `agent.ts` and `index-docs.ts`. Documented `data/pdfs/` as the rulebook PDF location. Replaced "Auth Module epic" references with Linear SQR-37/38/39/40 (User Accounts project). Added forward reference to `ARCHITECTURE.md` for architectural detail.
- **2026-04-07:** Renamed from `docs/development.md` to `docs/DEVELOPMENT.md` as part of the ALL_CAPS docs consolidation.
- **2026-04-06:** Retired OCR pipeline and Worldhaven dependency references (commit `34a26a1`).
- **2026-04-06:** Added gstack requirement for AI-assisted work (PR #175).
- **2026-04-06:** Documented monster abilities import from GHS structured data (PR #172).
- **2026-04-05:** Replaced git submodules with committed extracted data + weekly CI refresh workflow (PR #162).
- **2026-03-29:** Initial development guide added (PR #90).
