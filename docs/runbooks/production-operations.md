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
- Edge path: Route 53 `squire.maz.org` alias -> CloudFront distribution -> AWS
  WAF web ACL -> Fly origin
- Origin lock: CloudFront sends `X-Origin-Secret`; Fly stores the matching value
  in `ORIGIN_SHARED_SECRET`
- Runtime environment label: `SQUIRE_ENV=production`

`/api/live` and `/api/health` intentionally bypass the origin lock so Fly health
checks work. Browser, OAuth, REST, and MCP routes should go through CloudFront
or include the origin secret when an operator is deliberately testing the Fly
origin.

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

## Post-deploy checks

Start with platform and health:

```bash
flyctl status -a maz-squire
fly releases -a maz-squire --image
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
- Confirm the root agent trace has the user input.
- Confirm the final output is present.
- Confirm agent-run tags include enough context to identify runtime, provider,
  model, and production traffic.

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
