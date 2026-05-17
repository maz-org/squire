# Deploy and rollback runbook

Squire Phase 1 deploys to Fly.io from the checked-in Docker image and
`fly.toml`. The app runs on one always-on `shared-cpu-1x` machine with 1 GB of
memory. Migrations run before traffic cutover through:

```bash
node scripts/db-migrate.ts
```

That command is wired as Fly's `release_command`, so a non-zero exit from
migration aborts the deploy and leaves the previous app image live.

For the day-to-day operator checklist, including DNS, CloudFront, AWS WAF,
OAuth, question-answer, and Langfuse checks, see
[production-operations.md](production-operations.md).

## One-time provisioning

Run these once from the repo root:

```bash
flyctl launch --no-deploy --name maz-squire --region iad
flyctl mpg create \
  --name squire-db \
  --region iad \
  --plan Basic \
  --pg-major-version 16 \
  --volume-size 10
flyctl mpg attach <cluster-id> --app maz-squire --variable-name DATABASE_URL
flyctl secrets set \
  ANTHROPIC_API_KEY='...' \
  SESSION_SECRET='...' \
  LANGFUSE_SECRET_KEY='...' \
  LANGFUSE_PUBLIC_KEY='...' \
  LANGFUSE_BASEURL='...' \
  GOOGLE_OAUTH_CLIENT_ID='...' \
  GOOGLE_OAUTH_CLIENT_SECRET='...' \
  SQUIRE_ALLOWED_EMAILS='...' \
  SQUIRE_ENV='production' \
  ORIGIN_SHARED_SECRET='...'
```

`flyctl mpg attach` writes the `DATABASE_URL` secret with the managed Postgres
connection string. Do not put secrets in `.env`, `fly.toml`, Docker build args,
or the image.

Before the first deploy, open the Fly dashboard for the Managed Postgres
cluster and enable the `vector` extension from the Extensions page:

- Database: `fly-db`
- Schema: `public`
- Extension: `vector`

Fly Managed Postgres makes `vector` available, but the attached application
role is not a superuser and cannot run `CREATE EXTENSION vector` itself.

## Local deploy checks

Before the first real deploy:

```bash
docker build -t squire:local .
flyctl deploy --local-only
```

After the first real deploy:

```bash
curl https://maz-squire.fly.dev/api/health
```

`/api/live` is the cheap platform liveness check. `/api/health` is the
readiness check and exercises Postgres, pgvector, and embedder warmup.

## GitHub deploy automation

The `Deploy to Fly` GitHub Actions workflow runs after the `CI` workflow
finishes successfully on `main`. It uses the Fly deploy token stored in the
repository secret `FLY_API_TOKEN`, runs:

```bash
flyctl deploy -a maz-squire --remote-only
```

and then smoke-checks the direct Fly health endpoints with:

```bash
node scripts/check-deploy-health.ts --base-url https://maz-squire.fly.dev
```

The smoke check calls:

- `https://maz-squire.fly.dev/api/live`
- `https://maz-squire.fly.dev/api/health`

and fails unless `/api/health` reports `status`, `db.status`, `vector.status`,
and `embedder.status` as `ok`.

Keep `.github/workflows/dependabot-auto-merge.yml` on the `AUTO_MERGE_APP_*`
GitHub App token path for Dependabot patch/minor updates. Merges performed with
`secrets.GITHUB_TOKEN` do not start follow-up `push` workflows, which means the
`CI` run on `main` would not exist and `Deploy to Fly` would have nothing to
follow. Human and agent PRs should be merged explicitly through the normal
review, land, and deploy flow.

CI installs a pinned actionlint release and runs it against `.github/workflows`.
For local checks, install actionlint with Homebrew and run:

```bash
brew install actionlint
npm run lint:actions
```

Create or rotate the deploy token with a deploy-scoped Fly token, then write it
to GitHub without putting it in a local env file:

```bash
fly tokens create deploy -a maz-squire -x 8760h -n github-actions-maz-squire |
  gh secret set FLY_API_TOKEN --repo maz-org/squire
```

After the next successful deploy, revoke the old deploy token in Fly.

## CloudFront origin lock

Production app traffic is expected to enter through CloudFront with AWS WAF
attached. CloudFront sends `X-Origin-Secret`, and Fly stores the matching value
as `ORIGIN_SHARED_SECRET`. Requests that do not include the exact header are
rejected with 403 before the app routes run.

The production WAF web ACL is `squire-production-waf`. It includes AWS managed
rules for IP reputation, common web exploits, known bad inputs, and SQL
injection, plus a 2,000 requests per 5 minutes per-IP rate limit. Logging goes to
the CloudWatch log group `aws-waf-logs-squire-production`.

`/api/live` and `/api/health` intentionally bypass the origin lock so Fly's own
machine health checks keep working without header support. User-facing routes,
OAuth routes, API routes, and MCP routes must go through CloudFront or include
the shared secret for operator checks.

To rotate the origin secret, plan a short maintenance window. The app accepts one
origin secret at a time, so CloudFront and Fly can briefly disagree while the
change propagates.

1. Update CloudFront to send the new secret as `X-Origin-Secret`.
2. Update the Fly `ORIGIN_SHARED_SECRET` secret to the same value immediately
   after.
3. Wait for the Fly release to become healthy.
4. Verify direct Fly access without the header is 403 and with the header is 200.
5. Remove the old value from any local/operator notes.

## Failed migration

A migration failure appears as a failed release machine during deploy. Check:

```bash
fly releases -a maz-squire --image
fly logs -a maz-squire
```

If the release command failed, Fly does not cut traffic over to the new image.
Fix the migration, then deploy again.

For an intentional abort test, temporarily add a no-op migration that throws,
run `flyctl deploy`, confirm the release fails, and remove the fixture before
committing.

## App rollback

Find the previous image from the releases list, then redeploy it:

```bash
fly releases -a maz-squire --image
fly deploy --image <prior-image> -a maz-squire
```

## Schema rollback

Database schemas are not rolled back automatically. If a bad migration has
already run, restore the schema manually with corrective DDL or a forward
repair migration. Prefer a forward repair when possible so the checked-in
migration history stays append-only.
