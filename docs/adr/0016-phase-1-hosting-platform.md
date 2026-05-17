---
type: ADR
id: '0016'
title: 'Phase 1 hosting platform: Fly.io app + Fly Managed Postgres'
status: active
date: 2026-05-06
---

## Context

Phase 1 MVP needs a production hosting target. The decision had been deferred
since the project moved off GitHub Issues to Linear (see
[issue-workflow.md](../agent/issue-workflow.md)) and through the
agent-native retrieval redesign. [ADR 0013](0013-phase-1-production-agent-baseline.md)
froze the production agent runtime; SQR-115 then closed (Done, 2026-04-29) with
the decision to keep the legacy retrieval surface for Phase 1, unblocking
deployment work. SQR-59 is the gating decision for the rest of the Production
Readiness project: SQR-58 (AWS WAF + CloudFront), SQR-42 (Dockerization),
SQR-43 (`drizzle-kit migrate` in the deploy pipeline), and SQR-44 (CI/CD).

The host must satisfy:

- Node 26 runtime via a Docker image (`.nvmrc` is `26.1.0`).
- Postgres 16+ with `pgvector` for runtime retrieval (the local
  [docker-compose.yml](../../docker-compose.yml) is pinned to
  `pgvector/pgvector:pg16` precisely so the host decision could stay open).
- Long-running SSE connections (the knowledge-agent loop streams tool calls and
  tokens for tens of seconds; aggressive proxy buffering or sub-minute idle
  timeouts would break the chat surface).
- A first-class migrate-before-cutover hook so a failed migration aborts the
  deploy without leaving production on a half-migrated schema (SQR-43 contract).
- A CloudFront-friendly origin: TLS to Fly's `fly.dev` hostname, custom-domain
  DNS in Route 53, and an origin-secret lock between CloudFront and Fly
  (SQR-58 contract).
- Logs and metrics passthrough to Langfuse + OpenTelemetry without per-platform
  middleware.
- Phase 1 budget: ~$100/month for hosting end-to-end, with headroom for
  observability and future model upgrades.

The Phase 1 user base is the maintainer plus 1–2 collaborators. Pre-production
testing happens on the maintainer's local dev environment — there is no
integration-testing tier that a staging environment would accelerate.

## Decision

**Phase 1 production runs on Fly.io: a single `shared-cpu-1x@1GB` machine in
one region for the Hono app, paired with Fly Managed Postgres (Basic plan) for
data. Migrations run via `release_command` before traffic cutover. No staging
environment.**

The Hono server, MCP transport, and web UI all run in one process on one
machine. Route 53, CloudFront, and AWS WAF sit in front of the Fly origin
(SQR-58), and CloudFront sends `X-Origin-Secret` so the app can reject direct
origin traffic. The app talks to Postgres over Fly's private 6PN network —
Postgres has no public ingress.

## Options considered

- **Option A (chosen) — Fly.io app + Fly Managed Postgres (Basic).**
  Single vendor, one `flyctl`, one dashboard, one billing line. `release_command`
  runs on a temporary machine with the new image before traffic shifts, exiting
  non-zero aborts the deploy — exactly the SQR-43 contract. MPG Basic includes
  daily backups, point-in-time recovery, and connection pooling; pgvector is
  available out of the box. App-to-DB traffic stays on private 6PN. Approximate
  Phase 1 cost: $5.92/mo app + $38/mo DB ≈ **$44/mo**, well under budget with
  headroom for an APM tier later.

- **Option B — Fly.io app + Neon (free tier) for Postgres.**
  Cheapest combo at ~$6/mo total; Neon has first-class pgvector and branching
  with 24-hour restore-from-history on the free tier. Rejected on single-vendor
  ergonomics: a solo maintainer benefits more from one throat to choke than
  from saving $38/mo, and the 24h restore window is materially weaker than
  MPG Basic's daily backups + 7-day PITR. Two billing surfaces, two SLAs, and
  two failure modes for what would otherwise be a single private-network hop.
  Kept on file as the fallback if MPG ever disappoints — Drizzle migrations +
  Docker image make the swap a one-day exercise.

- **Option C — Fly.io app + legacy unmanaged Fly Postgres.**
  Rejected. Fly's docs now lead with: _"We are not able to provide support or
  guidance for unmanaged Postgres. We now offer Fly.io Managed Postgres, our
  fully-managed database service."_ For a solo maintainer, owning Postgres
  upgrades, replication, and PITR by hand is the wrong place to spend ops
  budget. Legacy by Fly's own framing.

- **Option D — Railway (app + Postgres).**
  Strong runner-up. Hobby plan is $5/mo + $5 included usage; Railway provisions
  a Postgres template with pgvector available via the separate pgvector
  template. Cutover is healthcheck-gated rather than release-command-gated:
  migrations have to run as a Dockerfile entrypoint (coupled to container
  start) or as a separate pipeline stage, which makes diagnosing migration
  failures harder than Fly's `release_command` model. No first-class
  migrate-before-cutover hook means SQR-43's "abort deploy on migration
  failure" requirement falls back to entrypoint orchestration.

- **Option E — Render (app + Render Postgres).**
  Viable. `preDeployCommand` in `render.yaml` is a first-class equivalent to
  Fly's `release_command`. pgvector is documented on PG13+. Rejected because
  Render's free Postgres tier expires after 90 days (paid required from day
  one), pricing pages required account creation to extract, and Render didn't
  win on any single criterion against Fly+MPG.

- **Option F — Self-hosted VPS (Hetzner / DigitalOcean).**
  Rejected on operations surface. ~€5/mo for a small ARM box is the cheapest
  hosting option in absolute terms, but the maintainer would own TLS renewal,
  Postgres backups, OS patches, monitoring stack, and incident response. For a
  solo-maintainer Phase 1 with no integration-test tier, that ops surface is
  not worth the savings. Reconsider only if Phase 3 multi-user economics push
  managed-host costs past the budget.

- **Option G — Cloudflare Workers.**
  Rejected on architecture, as flagged in the SQR-59 ticket. Workers run in V8
  isolates with execution-time limits, no persistent Node runtime, and a
  request-scoped programming model that rules out the long-lived SSE
  connections the knowledge-agent loop depends on. Persistent Postgres
  connections would also require Hyperdrive or an external pooler. Disqualified
  before cost or pgvector questions.

## Consequences

### What this unblocks (Linear)

- **SQR-58 (AWS WAF + CloudFront)** — public traffic enters through Route 53
  and CloudFront, passes through the `squire-production-waf` AWS WAF web ACL,
  then forwards to `https://maz-squire.fly.dev` with `X-Origin-Secret`. The Fly
  app stores the matching `ORIGIN_SHARED_SECRET` and rejects direct browser,
  OAuth, API, and MCP routes that bypass the edge.
- **SQR-42 (Dockerize)** — multi-stage Node 26 Dockerfile that `EXPOSE 8080`s
  and runs as a non-root user. CSS and vanilla JS assets are prebuilt in the
  Docker `assets` stage with `npm run build:web-assets`, while local
  development keeps the in-process Tailwind path from
  [ADR 0011](0011-on-demand-asset-pipeline.md). Squire runs TypeScript directly
  via Node 26 strip-types (no JS compile step), so the runtime stage carries
  the `src/` tree and `node_modules`.
- **SQR-43 (migrate on deploy)** — wire `release_command = "node scripts/db-migrate.ts"`
  into `fly.toml`. A non-zero exit code from the release machine aborts the
  deploy and leaves the prior version live, which is exactly the SQR-43
  acceptance criterion.
- **SQR-44 (CI/CD)** — GitHub Actions workflow runs after `CI` succeeds on
  `main`, uses a pinned `superfly/flyctl-actions/setup-flyctl` commit, then
  runs `flyctl deploy -a maz-squire --remote-only`. The deploy token lives in
  the GitHub secret `FLY_API_TOKEN`; app secrets such as `DATABASE_URL` stay
  scoped to the Fly app via `fly secrets set` and are never written to the
  repo. Dependabot patch/minor auto-merge uses
  `actions/create-github-app-token@v3` so those automated merges create the
  follow-up `push` event that the deploy workflow follows. Human and agent PRs
  are merged explicitly after review rather than auto-merged on every opened PR.

### Operational shape

- **One environment.** Production only — no staging tier. Pre-production
  testing happens on the maintainer's local dev environment (Docker Compose
  Postgres + `npm run dev`). Revisit if multi-maintainer collaboration in a
  later phase needs an integration-test surface.
- **One region.** Phase 1 has 1–2 users. Multi-region is a Phase 3+ concern;
  switching regions on Fly is a `fly.toml` edit.
- **One machine, always-on.** `auto_stop_machines = "off"` and
  `min_machines_running = 1` so the machine never scales to zero — the primary
  protection against SSE streams being severed mid-flight. `[http_service]
idle_timeout` set to 600s as belt-and-suspenders for any brief silent gap
  between streamed events; the always-on machine is the load-bearing setting,
  not the timeout.
- **Private DB only.** App reaches Postgres over 6PN; Postgres has no public
  ingress. DATABASE_URL is a Fly secret.
- **Backups + PITR** are MPG Basic defaults; no separate backup tooling needed
  for Phase 1.
- **Rollback** is `fly releases -a maz-squire --image` +
  `fly deploy --image <prior-image> -a maz-squire` for the app, hand-rolled DDL
  or a forward repair migration for schema.

### Cost

| Line                                                    | Monthly        |
| ------------------------------------------------------- | -------------- |
| Fly `shared-cpu-1x@1GB` machine (Amsterdam pricing)     | $5.92          |
| Fly Managed Postgres Basic (Shared-2x / 1GB / 1 TB cap) | $38.00         |
| Volume-snapshot storage (first 10 GB free)              | ~$0            |
| CloudFront + AWS WAF + WAF logging                      | ~$10–15        |
| Claude API (Sonnet 4.6, Phase 1 chat volume)            | $10–30         |
| **Total Phase 1 estimate**                              | **~$65–90/mo** |

Within the $100/mo Phase 1 budget. Headroom is reserved for the open
APM/RUM question (see [docs/ARCHITECTURE.md §Open Tech Questions](../ARCHITECTURE.md#open-tech-questions)).

### Lock-in and reversibility

Reversibility 4/5. The Drizzle schema and Docker image are host-portable. The
host-specific surface is `fly.toml` + `release_command` + Fly secret names —
roughly a day's work to translate to `render.yaml` + `preDeployCommand` or to
a Railway project. Postgres data is dump-and-restore; pgvector and Postgres 16
are common across the candidate set.

### What would trigger re-evaluation

- Phase 3 multi-user economics push monthly cost past the $100 budget without a
  clear path to revenue.
- Fly platform reliability incidents materially affect availability.
- A future ADR replaces this one — for example, when adding a managed agent
  runtime or moving compute closer to a model provider's region.

## Advice

WebFetched current pricing and capability docs for Fly, Railway, and Render
before drafting (May 2026). Initial recommendation paired Fly with Neon free
under the prior `$0–10/mo` Postgres budget assumption captured in
ARCHITECTURE.md §Cost. The user clarified that the actual Phase 1 budget is
$100/mo, which made the single-vendor argument for Fly Managed Postgres
dominant over the cheapest-possible-Neon-pairing. Staging tier was offered and
declined: 1–2 users and local-dev-as-pre-prod doesn't justify a second
environment. Both pivots are recorded above for future re-evaluation.
