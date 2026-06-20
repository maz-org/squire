# Sentry Usage And Spend Guardrails

Use this runbook after enabling Sentry Logs and app traces. The goal is broad
app visibility with sanitized data, plus enough usage checks to avoid surprise
spend or accidental loss of monitoring.

Sentry pricing changes. The quota and price notes below were checked on
2026-06-15 from:

- <https://sentry.io/pricing/>
- <https://docs.sentry.io/pricing/>
- <https://docs.sentry.io/pricing/quotas/>
- <https://docs.sentry.io/pricing/quotas/manage-logs-quota/>
- <https://docs.sentry.io/pricing/quotas/manage-transaction-quota/>

Before changing Sentry plan, PAYG budget, reserved volume, or sampling, verify
current prices in Sentry.

## Current Pricing Snapshot

| Plan             | Included errors | Included logs | Included spans | Included replay | Included monitors                   |
| ---------------- | --------------- | ------------- | -------------- | --------------- | ----------------------------------- |
| Developer / Free | 5k errors       | 5GB logs      | 5M spans       | 50 replays      | 1 uptime monitor and 1 cron monitor |
| Team             | 50k errors      | 5GB logs      | 5M spans       | 50 replays      | 1 uptime monitor and 1 cron monitor |
| Business         | 50k errors      | 5GB logs      | 5M spans       | 50 replays      | 1 uptime monitor and 1 cron monitor |

Observed PAYG units as of 2026-06-15:

- Logs: `$0.50/GB`
- Application metrics: `$0.50/GB`
- Team spans, 5M-100M: `$0.0000020/span`
- Business spans, 5M-100M: `$0.0000040/span`
- Extra uptime monitors: `$1.00/monitor`
- Extra cron monitors: `$0.78/monitor`

Sentry docs say data sent after reserved volume and PAYG budget are exhausted
is dropped for the rest of the billing cycle. Treat that as degraded monitoring,
not a normal cost-control path.

## What To Check

The billed source of truth is Sentry's Usage page, not Fly logs and not a
dashboard count widget.

1. Open Sentry for the Fly-provisioned project:

   ```bash
   flyctl extensions sentry dashboard -a maz-squire
   ```

2. Go to `Stats & Usage`.
3. Filter to the `maz-squire` project.
4. Check these rows:
   - Logs: accepted GB, dropped GB, filtered GB.
   - Spans: accepted spans, dropped spans, filtered spans.
   - Errors: accepted errors and top projects.
5. Go to `Settings > Subscription`.
6. Confirm the owner/billing user has quota emails and the PAYG budget set to
   the intended monthly maximum. Leaving PAYG at `$0` is valid, but it means
   Sentry can drop data after included volume is exhausted.

Run this local command to print the checked-in query and guardrail inventory:

```bash
npm run sentry:usage-guardrails
```

The command does not read or print `SENTRY_TOKEN`.

## Dashboard Queries

Use these Sentry views for app-side volume and top-talker diagnosis. The first
two are Usage-page checks because Sentry exposes billed log GB and accepted span
volume there. The remaining rows are dashboard widgets or Discover queries.

- `squire.usage.logs.accepted_gb`
  Surface: Stats & Usage. Dataset: billing. Query:
  `Stats & Usage > Logs > project=maz-squire > accepted log data`. Fields:
  accepted GB, dropped GB, filtered GB, project.
- `squire.usage.spans.accepted_count`
  Surface: Stats & Usage. Dataset: billing. Query:
  `Stats & Usage > Spans > project=maz-squire > accepted spans`. Fields:
  accepted spans, dropped spans, filtered spans.
- `squire.usage.logs.count`
  Surface: dashboard. Dataset: logs. Query: `environment:production`. Field:
  `count()`.
- `squire.usage.spans.count`
  Surface: dashboard. Dataset: spans. Query: `environment:production`. Field:
  `count()`.
- `squire.usage.errors.count`
  Surface: dashboard. Dataset: error events. Query:
  `environment:production level:error`. Field: `count()`.
- `squire.usage.top_log_routes`
  Surface: dashboard. Dataset: logs. Query: `environment:production route:*`.
  Fields: `route`, `count()`.
- `squire.usage.top_log_events`
  Surface: dashboard. Dataset: logs. Query:
  `environment:production event_type:*`. Fields: `event_type`, `count()`.
- `squire.usage.top_span_routes`
  Surface: dashboard. Dataset: spans. Query:
  `environment:production http.route:*`. Fields: `http.route`, `count()`,
  `p95(span.duration)`.
- `squire.usage.top_error_routes`
  Surface: dashboard. Dataset: error events. Query:
  `environment:production route:* level:error`. Fields: `route`, `count()`.
- `squire.usage.top_security_events`
  Surface: dashboard. Dataset: logs. Query:
  `environment:production surface:security_log security_event:*`. Fields:
  `security_event`, `count()`.

Keep these queries free of prompt text, answer text, email addresses, cookies,
tokens, provider payloads, retrieved passages, source documents, and transcript
content. They should use low-cardinality operational fields only.

## Cost Controls

Do use:

- Sentry `Stats & Usage` for accepted/dropped/filtered logs and spans.
- Sentry owner quota emails and PAYG budget in `Settings > Subscription`.
- `SENTRY_TRACES_SAMPLE_RATE` when span volume is too high.
- Sentry spike protection and inbound filters for emergency noise control when
  the owner and rollback condition are recorded.

Do not use:

- A cost-based log allowlist.
- Dropping safe production logs just because they are `info`.
- Removing route, request, conversation, message, job, release, or environment
  metadata to lower volume.
- Copying raw prompts, model output, provider payloads, retrieved passages,
  names, emails, cookies, tokens, or transcript text into Sentry.

Privacy filtering is always allowed and required. Cost filtering is only an
explicit emergency throttle with an owner, reason, start time, and rollback
condition.

## Trace Sampling

`SENTRY_TRACES_SAMPLE_RATE` controls Sentry app-span volume. It accepts a number
from `0` to `1`:

- unset: do not export Sentry app spans
- `0`: explicitly disable Sentry app spans
- `0.10`: send roughly 10% of sampled app spans
- `1`: send all sampled app spans

LangSmith remains the trace and eval source for AI behavior. Lowering
`SENTRY_TRACES_SAMPLE_RATE` should not reduce LangSmith tracing.

`/api/live` and `/api/health` intentionally suppress app span export. Fly and
Sentry probe those routes constantly, so tracing them consumes performance-unit
quota without improving app debugging. Keep request logs and the Sentry uptime
monitor for those routes.

Production should store the sample rate as a Fly secret so it can change without
a code deploy:

```bash
fly secrets set SENTRY_TRACES_SAMPLE_RATE=0.10 -a maz-squire
```

After changing it:

1. Note the old and new values in the deploy or incident log.
2. Run `node scripts/check-deploy-health.ts --base-url https://maz-squire.fly.dev`.
3. Verify Sentry spans change volume in `Stats & Usage`.
4. Verify safe error and log events still arrive.
5. Revert or tune again once the spike is understood.

## Weekly Check

Until the baseline is known, review this weekly:

- Logs accepted GB and percent of included 5GB.
- Spans accepted count and percent of included 5M.
- Errors accepted count and percent of included plan quota.
- Dropped or filtered rows for logs, spans, and errors.
- Top routes and event families from the dashboard queries above.
- Current PAYG budget and whether owner quota emails are going to the right
  person.

Move to monthly once usage is stable.
