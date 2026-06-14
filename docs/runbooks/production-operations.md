# Production operations guide

This is the current production runbook for Squire. Historical planning docs may
mention older edge or release-tag deploy plans; production now runs at
`https://squire.maz.org` through AWS edge services and deploys from GitHub
Actions after CI passes on `main`.

## Production shape

- Public URL: `https://squire.maz.org`
- Direct Fly URL: `https://maz-squire.fly.dev`
- Fly app: `maz-squire`
- Database: Fly Managed Postgres Basic, with `vector` enabled in the `public`
  schema of `fly-db`
- Rate-limit store: Redis/Valkey-compatible service exposed through `REDIS_URL`
  (Fly Upstash Redis for Phase 1)
- Edge path: Route 53 `squire.maz.org` alias -> CloudFront distribution -> AWS
  WAF web ACL -> Fly origin
- Origin lock: CloudFront sends `X-Origin-Secret`; Fly stores the matching value
  in `ORIGIN_SHARED_SECRET`
- Runtime environment label: `SQUIRE_ENV=production`
- App observability: Sentry via Fly extension, with `SENTRY_DSN` stored as a
  Fly secret and `SENTRY_RELEASE` stamped from the deployed Git SHA
- Background cleanup: Fly `cron` process group runs Supercronic with
  `/app/crontab` and prunes expired sessions hourly

`/api/live` and `/api/health` intentionally bypass the origin lock so Fly health
checks work. Browser, OAuth, REST, and MCP routes should go through CloudFront
or include the origin secret when an operator is deliberately testing the Fly
origin.

## Trusted client IPs

Production client-IP attribution is only trusted after the origin lock passes.
CloudFront sends `X-Origin-Secret`, and the app compares it with
`ORIGIN_SHARED_SECRET` before auth routes record any forwarded client IP in
session metadata or OAuth audit rows.

For production traffic, CloudFront appends the viewer IP to `X-Forwarded-For`,
and Fly appends its proxy hop before the request reaches the app. The app reads
the IP immediately before Fly's trusted hop and ignores earlier XFF entries
because a viewer can spoof them before CloudFront appends the real viewer IP.
Malformed XFF chains, missing XFF chains, and direct-origin requests without the
origin secret resolve to an unknown client IP instead of storing a raw header
string.

`X-Real-IP` is not trusted in production because CloudFront removes it before
forwarding to the origin. Local development and tests can still resolve a
validated `X-Forwarded-For`, `X-Real-IP`, or `Fly-Client-IP` value when
`ORIGIN_SHARED_SECRET` is unset.

## Application rate limits

AWS WAF remains the coarse outer filter. Squire-specific limits live in the app
and use Redis/Valkey-compatible `rate-limiter-flexible` counters (`REDIS_URL`) so
limits are shared across app machines and restarts.

Production startup fails when `NODE_ENV=production` and `REDIS_URL` is missing.
If the Redis/Valkey limiter is unavailable at request time, protected app routes
fail closed with HTTP 503 and a structured `rate_limit_unavailable` security
log rather than falling back to unlimited traffic.

`POST /register` is limited to 10 requests per hour per trusted client IP.
Rate-limit denials return 429 with `Retry-After` and emit structured security
log events with a hashed identity. They do not write `oauth_audit_log` rows;
that table is for durable auth lifecycle state changes.

`GET /auth/google/start` is limited to 10 requests per minute per trusted
client IP. `GET /auth/google/callback` is limited to 20 requests per minute per
trusted client IP. Denials use the same `Retry-After` response and structured
log shape as registration, and do not write `oauth_audit_log` rows.

`/mcp` is limited to 120 requests per minute per authenticated token user when
available, otherwise per OAuth client id. Unauthenticated or malformed requests
fall back to the trusted client IP resolver, then a shared `unknown` bucket if no
trusted IP can be resolved. MCP denials return HTTP 429 before the Streamable
HTTP transport starts and emit the same structured `rate_limit_rejected` log
shape with `identity_kind` set to `user`, `client`, `ip`, or `unknown`.

Route-control matrix:

| Route                                                   | Auth                       | App rate limit                                                              | Budget breaker             | Notes                                                                                               |
| ------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| `/api/live`, `/api/health`                              | None                       | None                                                                        | None                       | Intentionally public health/readiness endpoints.                                                    |
| `POST /register`                                        | None                       | 10/hour per trusted client IP                                               | None                       | Dynamic OAuth client registration.                                                                  |
| `GET /auth/google/start`                                | Session bootstrap          | 10/minute per trusted client IP                                             | None                       | Google sign-in initiation.                                                                          |
| `GET /auth/google/callback`                             | Session bootstrap          | 20/minute per trusted client IP                                             | None                       | Google sign-in callback.                                                                            |
| `GET /api/search/rules`                                 | Bearer token               | 60/minute per token user, otherwise OAuth client                            | None                       | Runs embedding/vector/rerank retrieval work.                                                        |
| `GET /api/search/cards`                                 | Bearer token               | 60/minute per token user, otherwise OAuth client                            | None                       | Runs card search over extracted data.                                                               |
| `POST /api/ask`                                         | Bearer token               | 30/minute per token user, otherwise OAuth client                            | Daily LLM budget precheck  | Caps question text at 2,000 chars, history at 20 messages, and each history message at 2,000 chars. |
| `/mcp`                                                  | Bearer token after limiter | 120/minute per token user, otherwise OAuth client, trusted IP, or `unknown` | None at transport boundary | Returns 429 before creating the Streamable HTTP transport.                                          |
| `/api/card-types`, `/api/cards`, `/api/cards/:type/:id` | Bearer token               | None                                                                        | None                       | Catalog reads use checked-in/imported game data only; no provider/model work.                       |

Rate-limit exhaustion returns HTTP 429 with `error: "rate_limited"` and a
`Retry-After` header. LLM budget exhaustion returns HTTP 429 with
`error: "llm_budget_exceeded"` before opening the `/api/ask` SSE stream and does
not include `Retry-After`; the budget resets at UTC midnight.

## Secrets and environment

app-runtime secrets and settings belong in Fly:

- `ANTHROPIC_API_KEY`
- `DATABASE_URL`
- `SESSION_SECRET`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `SQUIRE_ALLOWED_EMAILS`
- `SQUIRE_ENV=production`
- `SENTRY_DSN` (created as a Fly secret by the Fly Sentry extension)
- `SENTRY_RELEASE` (set by the GitHub deploy workflow with `flyctl deploy --env`)
- `LANGSMITH_API_KEY` (optional tracing; absence must not block startup)
- `LANGSMITH_PROJECT` (optional tracing; defaults to `squire-production`)
- `LANGSMITH_TRACING=true` (required when LangSmith credentials are set)
- `LANGSMITH_ENDPOINT` (optional; defaults to LangSmith Cloud)
- `LANGSMITH_WORKSPACE_ID` (when required by the API key)
- `ORIGIN_SHARED_SECRET`
- `REDIS_URL`
- `SQUIRE_LLM_DAILY_BUDGET_USD=10`
- `SQUIRE_LLM_BUDGET_WARNING_THRESHOLD=0.8`
- `SQUIRE_LLM_INPUT_USD_PER_MILLION_TOKENS=3`
- `SQUIRE_LLM_OUTPUT_USD_PER_MILLION_TOKENS=15`
- `SQUIRE_LLM_CACHE_CREATION_INPUT_USD_PER_MILLION_TOKENS=6`
- `SQUIRE_LLM_CACHE_READ_INPUT_USD_PER_MILLION_TOKENS=0.3`

The LLM budget circuit breaker uses Postgres as the durable ledger and resets
at UTC midnight. LangSmith remains the trace/debug surface; do not rely on it
for budget admission.

### Sentry app observability

Provision Sentry through Fly from an operator shell authenticated to the
`maz-org` Fly organization:

```bash
fly ext sentry create -a maz-squire
```

The Fly extension creates or links the Sentry organization/project. It sets
`SENTRY_DSN` as a Fly secret for the app. Do not add `SENTRY_DSN` to `fly.toml`.
Do not put the DSN value in `.env.example`, GitHub workflow YAML, or checked-in
docs. The DSN value is secret material.

Open the linked Sentry project with:

```bash
fly ext sentry dashboard -a maz-squire
```

The GitHub deploy workflow sets `SENTRY_RELEASE` to the exact
`github.event.workflow_run.head_sha` that passed CI and is deployed with
`flyctl deploy --env`. `SQUIRE_ENV=production` remains the environment label
that the app maps into both LangSmith metadata and Sentry event environment.

Missing `SENTRY_DSN` must remain a no-op for local dev and tests. Production
should have the Fly secret present once the Sentry SDK work lands; until then,
the secret can exist without changing runtime behavior. LangSmith remains the
LLM trace/eval owner. Sentry app events should carry correlation IDs and links
to LangSmith, not raw prompts, model outputs, cookies, bearer tokens, OAuth
tokens, provider payloads, retrieved passages, or full answers.

Fly's Sentry extension documentation describes the sponsored Team-plan quota as
50k errors, 100k performance units, 500 session replays, and 1GB of attachments
per month. If that sponsored period ends, Sentry keeps accepting events on the
Developer plan with lower quotas; events over quota are dropped.

GitHub repository secrets:

- `FLY_API_TOKEN`
- `AUTO_MERGE_APP_ID`
- `AUTO_MERGE_PRIVATE_KEY`
- `LINEAR_API_KEY`
- `SECURITY_ALERTS_GITHUB_TOKEN`

GitHub `production` environment secrets:

- `PRODUCTION_DATABASE_URL`
- `VOYAGE_API_KEY`

eval/developer-only variables stay out of Fly unless the runtime starts using
them:

- `OPENAI_API_KEY`
- `LANGSMITH_API_KEY`
- `LANGSMITH_PROJECT`
- `LANGSMITH_ENDPOINT`
- `LANGSMITH_WORKSPACE_ID`
- eval model/provider knobs from `.env.example`

`SQUIRE_ENV` is the single source for the LangSmith environment label.

## Security gates

The permanent gate contract lives in [SECURITY.md](../SECURITY.md). Use these
checks when changing workflows, dependency policy, or GitHub security-alert
routing:

```bash
npm run lint:actions
npm run security:alerts:validate-config
SECURITY_ALERT_REPOSITORY=maz-org/squire SECURITY_ALERT_GITHUB_TOKEN="$(gh auth token)" npm run security:alerts:dry-run
npm audit --omit=dev --audit-level=high
gh api 'repos/maz-org/squire/dependabot/alerts?state=open&per_page=100' --jq 'length'
gh api 'repos/maz-org/squire/code-scanning/alerts?state=open&per_page=100' --jq 'length'
gh api 'repos/maz-org/squire/secret-scanning/alerts?state=open&per_page=100' --jq 'length'
gh run list --workflow codeql.yml --branch main --limit 5
gh run list --workflow "Security Alert Linear Sync" --limit 5
```

`Security Alert Linear Sync` mirrors high/critical Dependabot, CodeQL, and
secret scanning alerts into Linear with the `Security` label. The manual
workflow dispatch defaults to dry run; set `dry_run` to false only after
`npm run security:alerts:validate-config` succeeds. The workflow falls back to
`github.token` if `SECURITY_ALERTS_GITHUB_TOKEN` is absent, but secret scanning
alert reads require the dedicated token.

## Deploy

Normal deploys happen by merging to `main`. The `CI` workflow must finish
successfully, then the `Deploy to Fly` workflow deploys the exact tested commit
with:

```bash
flyctl deploy -a maz-squire --remote-only
```

Check the current deploy path with:

```bash
gh run list --workflow "CI" --branch main --limit 5
gh run list --workflow "Deploy to Fly" --branch main --limit 5
gh run watch <run-id>
gh run view <run-id> --log
gh api 'repos/maz-org/squire/deployments?environment=production'
```

The GitHub deployment environment should show `production` and link to
`https://squire.maz.org`.

The workflow smoke check runs:

```bash
node scripts/check-deploy-health.ts --base-url https://maz-squire.fly.dev
```

Use a manual deploy only for operator recovery from a known local checkout:

```bash
flyctl deploy -a maz-squire --remote-only
```

After the first deploy that introduces the cron process group, scale exactly one
cron machine alongside the web app:

```bash
flyctl scale count app=1 cron=1 -a maz-squire
```

The cleanup command is idempotent, but `cron=1` keeps the logs and database work
predictable.

## Production data lifecycle

Production data updates are separate from image deploys. The weekly
`Refresh extracted data` workflow still only refreshes `data/extracted/` from
Gloomhaven Secretariat and opens a reviewable PR. Merging that PR, or merging
checked-in source/data changes, is what triggers production database writes.

All production data workflows use the GitHub `production` environment and map
the environment secret `PRODUCTION_DATABASE_URL` to `DATABASE_URL`. They also set
`NODE_ENV=production` and `SQUIRE_ENV=production`, verify the database URL before
running migrations, and fail rather than silently writing to localhost or an
obvious dev/test database.

Manual runs for card data, scenario/section-book data, and rule-source
embeddings include a `game` input:

- `all` seeds or indexes both games.
- `frosthaven` scopes the run to Frosthaven only.
- `gloomhaven-2e` scopes the run to Gloomhaven (2nd Edition) only.

Push-triggered runs default to `all`. Use the game-scoped runs for recovery,
partial refreshes, and GH2-only verification. The production checks use the
same scope, so a GH2-only run proves GH2 tables without depending on Frosthaven
row counts, and a Frosthaven-only run leaves GH2 rows alone.

### Card data

`Production seed card data` runs on merges to `main` that change
`data/extracted/` card JSON, excluding
`data/extracted/scenario-section-books.json`. It can also be run manually with
`workflow_dispatch`.

The workflow runs:

```bash
npm run production-data:verify-db-url
npm run db:migrate
npm run seed:cards
npm run production-data:check -- cards --game "$SQUIRE_DATA_GAME"
```

`npm run seed:cards` is idempotent: it upserts current card rows and prunes rows
that disappeared from the checked-in extract. The final sanity check requires
every supported `card_*` table for the selected game to contain data. GH2
building cards are intentionally excluded until upstream GHS publishes that
data.

### Scenario and section books

`Production seed scenario and section books` runs on merges to `main` that
change `data/extracted/scenario-section-books.json`, `data/pdfs/`, or the
scenario / section import and seed code. It can also be run manually with
`workflow_dispatch`.

The workflow runs:

```bash
npm run production-data:verify-db-url
npm run db:migrate
npm run seed:scenario-section-books
npm run production-data:check -- scenario-section-books --game "$SQUIRE_DATA_GAME"
```

`npm run seed:scenario-section-books` is safe to rerun. The sanity check requires
non-empty `scenario_book_scenarios`, `section_book_sections`, and
`book_references` tables.

### Unlock graphs

`Production seed unlock graphs` runs on merges to `main` that change
`data/extracted/unlock-graphs/` or the unlock-graph seed code. It can also be run
manually with `workflow_dispatch`. Unlike the card and scenario/section-book
workflows it has no `game` input — the seed always imports every module.

The workflow runs:

```bash
npm run production-data:verify-db-url
npm run db:migrate
npm run seed:unlock-graphs
npm run production-data:check -- unlock-graphs
```

`npm run seed:unlock-graphs` is idempotent: it upserts the curated scenario and
thread rows for every module in `data/extracted/unlock-graphs/` (frosthaven `fh`,
gloomhaven-2e `gh2e` + `solo2e`) into `unlock_graph_scenarios` and
`unlock_graph_threads`. `loadModuleGraphs()` reads those tables to render the
campaign scenario-progression dashboard. The migration that creates the tables is
DDL-only, so without this workflow they stay empty and every campaign shows "No
scenario data for this campaign's modules yet." The sanity check requires a
non-empty `unlock_graph_scenarios` row count for every supported game.

### Rule-source embeddings

`Production reindex rule sources` runs on merges to `main` that change
`data/pdfs/`, `data/rule-sources/`, or the indexing/chunking code
(`src/index-docs.ts`, `src/vector-store.ts`, `src/embedder.ts`, or
`src/retrieval-source.ts`). It can also be run manually with
`workflow_dispatch`.

Normal mode runs:

```bash
npm run production-data:verify-db-url
npm run db:migrate
npm run index
npm run production-data:check -- embeddings --game "$SQUIRE_DATA_GAME"
npm run production-data:smoke -- --game "$SQUIRE_DATA_GAME"
```

Normal `npm run index` mode is content-hash based: unchanged rule sources are
skipped, changed rule sources are re-indexed, new rule sources are added, and
rows for removed rule sources are deleted for the selected game only. Use this
path for ordinary source updates and chunking changes. The smoke check performs
a real game-scoped rules search and an item lookup. A GH2-scoped smoke run also
checks a Frosthaven item and rules search so a GH2 refresh cannot silently break
the existing Frosthaven table flow.

Manual rebuild mode accepts `rebuild: true`. Because that truncates the
selected `rule_source_embeddings` scope before running `npm run index`, it
should only be used for a deliberate embedding model/version change or a known
corrupt index. `game: all` truncates both games; `game: frosthaven` and
`game: gloomhaven-2e` rebuild only that game's rows.
The protected GitHub `production` environment is the approval gate for that
rebuild. After changing the embedding model or vector dimensions, confirm the
migration path first; a model-only change with the same dimensions can use
rebuild mode, while a dimensionality change needs a schema migration before
indexing.

### Partial failure recovery

If a production data workflow partially fails, do not deploy a new image just to
retry data work. Rerun the failed workflow from GitHub Actions after fixing the
cause:

- Missing `PRODUCTION_DATABASE_URL`: add it to the GitHub `production`
  environment secrets and rerun.
- Migration failure: inspect the failed migration and prefer a forward repair
  migration unless restoring from backup is clearly safer.
- Card or scenario/section seed failure: fix the checked-in extract or seed code,
  merge the fix, then rerun the relevant workflow.
- Rule-source indexing failure: rerun normal mode after fixing the source file
  or indexing code. Use `rebuild: true` only when the existing
  `rule_source_embeddings` rows are known to be wrong as a set.

## Post-deploy checks

Start with platform and health:

```bash
flyctl status -a maz-squire
fly releases -a maz-squire --image
fly logs -a maz-squire --no-tail | grep session-gc
node scripts/check-deploy-health.ts --base-url https://maz-squire.fly.dev
curl -I https://squire.maz.org
curl https://squire.maz.org/api/live
curl https://squire.maz.org/api/health
```

Then verify the user flow in a browser:

1. Open `https://squire.maz.org/login`.
2. Confirm the page shows `Sign in with Google`.
3. Complete Google OAuth with an allowlisted account.
4. Ask one real rules question.
5. Confirm the answer renders, streams, and cites sources.

Check LangSmith after the question:

- Filter to `env:production`.
- Confirm the root `squire.agent.run` trace has the user input and final output.
- Confirm `metadata.squireEnv` is `production`.
- Confirm `metadata.requestId` is present for the HTTP request that generated
  the answer.
- Confirm web-chat traces include `metadata.conversationId`,
  `metadata.thread_id` matching that conversation ID, `metadata.userMessageId`,
  and `metadata.userId`; REST `/api/ask` traces may also include
  `metadata.campaignId` when the caller provides it.
- Confirm agent-run tags identify runtime, provider, model, tool surface, and
  production traffic.
- Confirm child generation and tool observations show model/provider usage,
  tool names, compact tool inputs, tool summaries, canonical refs, and errors
  without raw email addresses or session cookies.

## Troubleshoot one production chat

Use this path when a user reports a bad answer, failed stream, or suspicious
chat behavior.

1. Start with the browser URL. `/chat/<conversationId>` gives the persisted
   conversation UUID. The pending answer stream URL
   `/chat/<conversationId>/messages/<userMessageId>/stream` gives the user
   message UUID for the exact turn.
2. Search LangSmith in `env:production` for a `squire.agent.run` trace whose
   metadata has that `conversationId` and `userMessageId`. If the report came
   from REST `/api/ask`, search by the `X-Request-ID` response header or caller
   log value instead.
3. In the root trace, inspect:
   - input question and final answer or error output
   - `metadata.userId`, `metadata.conversationId`, `metadata.thread_id`,
     `metadata.userMessageId`, `metadata.requestId`, `metadata.squireEnv`
   - `metadata.model`, `metadata.toolSurface`, iterations, tool-call count, and
     stop reason
   - tags: `runtime`, provider (`anthropic`), SDK (`claude-sdk`), model, tool
     surface, and `env:production`
4. Open child observations in order. Generation observations show compact model
   input/output, stop reason, and token usage. Tool observations show tool name,
   compact input, output summary, source labels, canonical refs, and tool
   errors.
5. If the user saw a reconnect, duplicate text, or a stream that ended early,
   inspect the durable SSE log for that user message. Event `sequence` values
   are the browser `id` / `Last-Event-ID` values.

   ```sql
   select sequence, event, payload, created_at
   from message_stream_events
   where user_message_id = '<userMessageId>'
   order by sequence;
   ```

   A stored `done` or `error` means reconnects should replay and close without
   another agent run. Partial non-terminal rows with no active generation lock
   are expected to end in one persisted assistant failure rather than a silent
   graph restart.

6. If LangSmith has no trace for the turn, check Fly logs around the same time
   and request ID:

   ```bash
   fly logs -a maz-squire --no-tail | grep '<requestId>'
   fly logs -a maz-squire --no-tail | grep '<conversationId>'
   ```

7. If the failure follows a deploy, check the GitHub deploy run before changing
   app code:

   ```bash
   gh run list --workflow "Deploy to Fly" --branch main --limit 5
   gh run view <run-id> --log
   gh api 'repos/maz-org/squire/deployments?environment=production'
   ```

Do not paste raw user questions, email addresses, cookies, bearer tokens, or
full trace payloads into issues. Use UUIDs, request IDs, model/tool metadata,
stop reasons, and short redacted excerpts.

Probe the edge:

```bash
curl -sS -o /tmp/squire-waf-body -w '%{http_code}\n' "https://squire.maz.org/login?q=1%27%20OR%20%271%27%3D%271"
curl -sS -o /tmp/squire-origin-body -w '%{http_code}\n' https://maz-squire.fly.dev/login
```

The WAF probe payload is `q=1' OR '1'='1`; it should be blocked by AWS WAF. The
direct Fly login request should return 403 because it is missing
`X-Origin-Secret`.

## Inspect production

Useful commands:

```bash
flyctl status -a maz-squire
fly logs -a maz-squire
fly releases -a maz-squire --image
fly secrets list -a maz-squire
```

AWS resources to inspect:

- Route 53 hosted zone: `maz.org`
- CloudFront distribution for `squire.maz.org`
- AWS WAF web ACL: `squire-production-waf`
- WAF log group: `aws-waf-logs-squire-production`

## Rollback

Find the previous image, then redeploy it:

```bash
fly releases -a maz-squire --image
fly deploy --image <prior-image> -a maz-squire
```

Schema changes are not rolled back automatically. If a migration has already
run, prefer a forward repair migration unless restoring from backup is clearly
safer.

## Origin secret rotation

The app accepts one `ORIGIN_SHARED_SECRET` value at a time. Rotate it during a
short maintenance window:

1. Update CloudFront to send the new `X-Origin-Secret` header.
2. Immediately update the Fly secret with the same value.
3. Wait for the Fly release to become healthy.
4. Verify `https://squire.maz.org/login` still works.
5. Verify `https://maz-squire.fly.dev/login` without the header is still 403.

See [deploy-rollback.md](deploy-rollback.md) for the lower-level deploy token,
origin-lock, and migration notes.

## One-time live GH2e campaign import (SQR-273)

Imports Brian's prototype campaign (played/drawn scenario state) into Squire.
One-time operational step — recurring sync is Phase 6 scope.

1. Capture the prototype state: `GET https://squire-campaign-tracker.replit.app/api/campaign/<id>`
   and save the JSON (`{name, modules, played, drawn}`).
2. Ensure the owner has logged into Squire at least once (the script binds
   the campaign to the user row matching the owner email, default
   `bcm@maz.org`).
3. Run against the target database:

```sh
npm run migrate:live-gh2e -- <capture.json> [owner-email]
```

Idempotent on campaign identity (name + owner): re-running against a fresh
export updates played/drawn state in place. The script exits non-zero if any
imported key is unknown to the seeded unlock graphs.
