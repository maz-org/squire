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

`POST /register` is limited to 10 requests per hour per trusted client IP.
Rate-limit denials return 429 with `Retry-After` and emit structured security
log events with a hashed identity. They do not write `oauth_audit_log` rows;
that table is for durable auth lifecycle state changes.

## Secrets and environment

app-runtime secrets and settings belong in Fly:

- `ANTHROPIC_API_KEY`
- `DATABASE_URL`
- `SESSION_SECRET`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `SQUIRE_ALLOWED_EMAILS`
- `SQUIRE_ENV=production`
- `LANGFUSE_BASEURL`
- `LANGFUSE_PROJECT_ID`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `ORIGIN_SHARED_SECRET`
- `REDIS_URL`

GitHub repository secrets:

- `FLY_API_TOKEN`
- `AUTO_MERGE_APP_ID`
- `AUTO_MERGE_PRIVATE_KEY`

eval/developer-only variables stay out of Fly unless the runtime starts using
them:

- `OPENAI_API_KEY`
- `LANGSMITH_API_KEY`
- `LANGSMITH_PROJECT`
- `LANGSMITH_ENDPOINT`
- `LANGSMITH_WORKSPACE_ID`
- `SQUIRE_EVAL_LANGSMITH_TRACING`
- eval model/provider knobs from `.env.example`

Do not set `LANGFUSE_TRACING_ENVIRONMENT`. `SQUIRE_ENV` is the single source for
the Langfuse environment label. LangSmith variables are eval/prototype tracing variables; they are not required for the production ask path today.

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
checked-in PDF/data changes, is what triggers production database writes.

All production data workflows use the GitHub `production` environment and map
the environment secret `PRODUCTION_DATABASE_URL` to `DATABASE_URL`. They also set
`NODE_ENV=production` and `SQUIRE_ENV=production`, verify the database URL before
running migrations, and fail rather than silently writing to localhost or an
obvious dev/test database.

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
npm run production-data:check -- cards
```

`npm run seed:cards` is idempotent: it upserts current card rows and prunes rows
that disappeared from the checked-in extract. The final sanity check requires
every `card_*` table to contain data.

### Scenario and section books

`Production seed scenario and section books` runs on merges to `main` that change
`data/extracted/scenario-section-books.json`, `data/pdfs/`, or the scenario /
section import and seed code. It can also be run manually with
`workflow_dispatch`.

The workflow runs:

```bash
npm run production-data:verify-db-url
npm run db:migrate
npm run seed:scenario-section-books
npm run production-data:check -- scenario-section-books
```

`npm run seed:scenario-section-books` is safe to rerun. The sanity check requires
non-empty `scenario_book_scenarios`, `section_book_sections`, and
`book_references` tables.

### PDF embeddings

`Production reindex PDFs` runs on merges to `main` that change `data/pdfs/` or
the indexing/chunking code (`src/index-docs.ts`, `src/vector-store.ts`,
`src/embedder.ts`, or `src/retrieval-source.ts`). It can also be run manually
with `workflow_dispatch`.

Normal mode runs:

```bash
npm run production-data:verify-db-url
npm run db:migrate
npm run index
npm run production-data:check -- embeddings
```

Normal `npm run index` mode is content-hash based: unchanged PDFs are skipped,
changed PDFs are re-indexed, new PDFs are added, and rows for removed PDFs are
deleted. Use this path for ordinary PDF source updates and chunking changes.

Manual rebuild mode accepts `rebuild: true`. Because that truncates the
`embeddings` table before running `npm run index`, it should only be used for a
deliberate embedding model/version change or a known corrupt index. The
protected GitHub `production` environment is the approval gate for that rebuild.
After changing the embedding model or vector dimensions, confirm the migration
path first; a model-only change with the same dimensions can use rebuild mode,
while a dimensionality change needs a schema migration before indexing.

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
- PDF indexing failure: rerun normal mode after fixing the source PDF or indexing
  code. Use `rebuild: true` only when the existing `embeddings` rows are known to
  be wrong as a set.

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

Check Langfuse after the question:

- Filter to `env:production`.
- Confirm the root `squire.agent.run` trace has the user input and final output.
- Confirm `metadata.squireEnv` is `production`.
- Confirm `metadata.requestId` is present for the HTTP request that generated
  the answer.
- Confirm web-chat traces include `metadata.conversationId`,
  `metadata.userMessageId`, and `metadata.userId`; REST `/api/ask` traces may
  also include `metadata.campaignId` when the caller provides it.
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
2. Search Langfuse in `env:production` for a `squire.agent.run` trace whose
   metadata has that `conversationId` and `userMessageId`. If the report came
   from REST `/api/ask`, search by the `X-Request-ID` response header or caller
   log value instead.
3. In the root trace, inspect:
   - input question and final answer or error output
   - `metadata.userId`, `metadata.conversationId`, `metadata.userMessageId`,
     `metadata.requestId`, `metadata.squireEnv`
   - `metadata.model`, `metadata.toolSurface`, iterations, tool-call count, and
     stop reason
   - tags: `runtime`, provider (`anthropic`), SDK (`claude-sdk`), model, tool
     surface, and `env:production`
4. Open child observations in order. Generation observations show compact model
   input/output, stop reason, and token usage. Tool observations show tool name,
   compact input, output summary, source labels, canonical refs, and tool
   errors.
5. If Langfuse has no trace for the turn, check Fly logs around the same time
   and request ID:

   ```bash
   fly logs -a maz-squire --no-tail | grep '<requestId>'
   fly logs -a maz-squire --no-tail | grep '<conversationId>'
   ```

6. If the failure follows a deploy, check the GitHub deploy run before changing
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
