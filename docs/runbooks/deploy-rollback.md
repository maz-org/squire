# Deploy and rollback runbook

Squire Phase 1 deploys to Fly.io from the checked-in Docker image and
`fly.toml`. The app runs on one always-on `shared-cpu-1x` machine with 1 GB of
memory. Migrations run before traffic cutover through:

```bash
node scripts/db-migrate.ts
```

That command is wired as Fly's `release_command`, so a non-zero exit from
migration aborts the deploy and leaves the previous app image live.

## One-time provisioning

Run these once from the repo root:

```bash
flyctl launch --no-deploy --name squire --region iad
flyctl mpg create \
  --name squire-db \
  --region iad \
  --plan Basic \
  --pg-major-version 16 \
  --volume-size 10
flyctl mpg attach <cluster-id> --app squire --variable-name DATABASE_URL
flyctl secrets set \
  ANTHROPIC_API_KEY='...' \
  SESSION_SECRET='...' \
  LANGFUSE_SECRET_KEY='...' \
  LANGFUSE_PUBLIC_KEY='...' \
  LANGFUSE_BASEURL='...' \
  GOOGLE_OAUTH_CLIENT_ID='...' \
  GOOGLE_OAUTH_CLIENT_SECRET='...'
```

`flyctl mpg attach` writes the `DATABASE_URL` secret with the managed Postgres
connection string. Do not put secrets in `.env`, `fly.toml`, Docker build args,
or the image.

## Local deploy checks

Before the first real deploy:

```bash
docker build -t squire:local .
flyctl deploy --local-only
```

After the first real deploy:

```bash
curl https://squire.fly.dev/api/health
```

`/api/live` is the cheap platform liveness check. `/api/health` is the
readiness check and exercises Postgres, pgvector, and embedder warmup.

## Failed migration

A migration failure appears as a failed release machine during deploy. Check:

```bash
fly releases list
fly logs
```

If the release command failed, Fly does not cut traffic over to the new image.
Fix the migration, then deploy again.

For an intentional abort test, temporarily add a no-op migration that throws,
run `flyctl deploy`, confirm the release fails, and remove the fixture before
committing.

## App rollback

Find the previous image from the releases list, then redeploy it:

```bash
fly releases list
fly deploy --image <prior-image>
```

## Schema rollback

Database schemas are not rolled back automatically. If a bad migration has
already run, restore the schema manually with corrective DDL or a forward
repair migration. Prefer a forward repair when possible so the checked-in
migration history stays append-only.
