# Sentry Alert Catalog

Sentry owns Squire app alerting. Fly logs are a fallback for timeline context,
not the alert source.

The Sentry project is the Fly-provisioned `maz-squire` project
(`project=4511564194643969`). Open it with:

```bash
flyctl extensions sentry dashboard -a maz-squire
```

Use the checked-in app-health inventory for dashboards and log/trace monitors:

Usage and spend checks for broad Sentry Logs and app traces live in
[sentry-usage-guardrails.md](sentry-usage-guardrails.md). This alert catalog
tracks app health and alert routing; the usage runbook tracks quotas, PAYG
budget, billed log GB, accepted spans, and trace sampling.

```bash
npm run sentry:app-health -- --dry-run
npm run sentry:app-health -- --apply
npm run sentry:app-health -- --verify
```

`--dry-run` prints the target dashboard, saved query names, and monitor payloads
without reading `SENTRY_TOKEN`. `--apply` and `--verify` require `SENTRY_TOKEN`
with Sentry project/workflow write access. The script must not print the token.

Thresholds are still documented here so they can be reviewed without opening
Sentry. If Sentry thresholds are tuned in the UI, update
`scripts/sentry-app-health-config.ts` and this runbook in the same PR.

## Adding A New Alert Or Monitor

Start with the symptom and the dataset:

- Use error events for grouped exceptions, deploy regressions, browser
  exceptions, and uptime alerts.
- Use logs for lifecycle failures, swallowed chat failures, browser transport
  failures, auth/rate-limit events, budget/accounting events, and other
  countable operational states.
- Use spans for latency and dependency timing.

Then update the checked-in config before changing Sentry by hand:

1. Add the area to `SENTRY_APP_HEALTH_AREAS` in
   `scripts/sentry-app-health-config.ts` if this is a new app-health area.
2. Add or update a dashboard widget in `SENTRY_APP_HEALTH_DASHBOARD_WIDGETS`
   when the signal should be visible during triage.
3. Add the monitor to `SENTRY_APP_HEALTH_MONITORS` for log or span alerts that
   should notify.
4. For existing event or uptime alerts that cannot be managed through the
   detector endpoint yet, update `SENTRY_EXISTING_APP_HEALTH_ALERTS`.
5. Add a safe test event or a written safe-test path in the same change.
6. Run `npm run sentry:app-health -- --dry-run`, then use `--apply` only when
   you intend to change Sentry resources.
7. Update this runbook with the alert name, dataset, filter, trigger, first
   action, and safe test event.

Do not add alert filters that match raw prompt, answer, transcript, source
passage, email, name, token, cookie, or request-body fields. Filters should use
stable tags and attributes such as `environment`, `release`, `route`,
`request_id`, `conversation_id`, `user_message_id`, `surface`, `event_type`,
`status`, `job_kind`, `security_event`, and `squire.*` span fields.

## Dashboard

Create or update the dashboard named `Squire - Production App Health`.

Verified production dashboard:
`https://brian-moseley.sentry.io/dashboard/7078025/?project=4511564194643969&environment=production`

| Saved query name                  | Dataset      | Filter/query                                                                                                                  | Use first when                                       |
| --------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `squire.backend.errors`           | Error events | `environment:production surface:server level:error`                                                                           | A backend exception, 500, or deploy regression fires |
| `squire.backend.latency.p95`      | Spans        | `environment:production http.route:* squire.request_id:*`                                                                     | A request is slow without a grouped error            |
| `squire.chat.failures`            | Logs         | `environment:production surface:[chat_sse,api_ask] status:error`                                                              | A stream fails or `/api/ask` returns a generic error |
| `squire.chat.latency.p95`         | Spans        | `environment:production squire.surface:[chat_sse,api_ask]`                                                                    | A chat completes but feels slow                      |
| `squire.browser.errors`           | Error events | `environment:production surface:browser level:error`                                                                          | Browser exceptions or unhandled rejections appear    |
| `squire.browser.stream_transport` | Logs         | `environment:production surface:browser event_type:browser_stream_error stream_error_kind:transport`                          | EventSource transport fails in the browser           |
| `squire.scripts.failures`         | Logs         | `environment:production event_type:script.lifecycle job_kind:[cron,release_command,manual_migration] status:error`            | Cron or release commands fail outside Hono           |
| `squire.deploy.regressions`       | Error events | `environment:production release:* level:error`                                                                                | A release starts producing new errors                |
| `squire.security.auth_rate_limit` | Logs         | `environment:production surface:security_log security_event:[rate_limit_rejected,rate_limit_unavailable,google_login_denied]` | Login or limiter anomalies spike                     |
| `squire.budget.accounting`        | Logs         | `environment:production surface:security_log security_event:[llm_budget_accounting_failed,llm_budget_warning]`                | Budget warnings or accounting failures appear        |

Some widgets stay empty until the log/trace telemetry PRs are deployed and
Sentry has ingested production logs/spans. That is expected; `--verify` checks
that resources exist, not that every query currently has rows.

## Log And Trace Monitors

| Alert name                                            | Dataset | Filter/query                                                                                                                  | Trigger                                                     | First action                                                                               | Safe test event                                        |
| ----------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `Squire production backend request p95 latency`       | Spans   | `environment:production http.route:* squire.request_id:*`                                                                     | `p95(span.duration) > 2500ms` for 10 minutes                | Open the slow span, group by `http.route`, then inspect Sentry logs by `request_id`        | Run one backend safe test after deploy                 |
| `Squire production chat/SSE p95 latency`              | Spans   | `environment:production squire.surface:[chat_sse,api_ask]`                                                                    | `p95(span.duration) > 15000ms` for 10 minutes               | Open the slow span, copy turn IDs, then jump to LangSmith                                  | Run one safe chat test after deploy                    |
| `Squire production chat/SSE log failure spike`        | Logs    | `environment:production surface:[chat_sse,api_ask] status:error`                                                              | More than 3 chat lifecycle error logs in 10 minutes         | Open matching logs, copy `request_id` and `conversation_id`, then inspect the linked event | `npm run sentry:test-event -- --kind chat`             |
| `Squire production browser stream transport failures` | Logs    | `environment:production surface:browser event_type:browser_stream_error stream_error_kind:transport`                          | More than 3 browser stream transport failures in 10 minutes | Open logs and masked replay, then inspect stream counters and release                      | Browser telemetry smoke on a safe masked page          |
| `Squire production script failure log spike`          | Logs    | `environment:production event_type:script.lifecycle job_kind:[cron,release_command,manual_migration] status:error`            | Any script lifecycle error log in 30 minutes                | Open the script log, copy `job_name`/`job_kind`, then inspect the matching Fly process     | `npm run sentry:test-event -- --kind cron`             |
| `Squire production auth/rate-limit anomaly spike`     | Logs    | `environment:production surface:security_log security_event:[rate_limit_rejected,rate_limit_unavailable,google_login_denied]` | More than 20 auth/rate-limit logs in 10 minutes             | Open security logs by `security_event` and route; check whether the limiter is unavailable | Use dry-run security logs; do not generate auth floods |
| `Squire production budget/accounting failure`         | Logs    | `environment:production surface:security_log security_event:[llm_budget_accounting_failed,llm_budget_warning]`                | Any budget warning or accounting failure log in 30 minutes  | Open budget logs, inspect model and `budget_day`, then check the ledger table              | Run the API E2E budget smoke outside production        |

Verified production monitor ids:

- `7566840`: `Squire production backend request p95 latency`
- `7566845`: `Squire production chat/SSE p95 latency`
- `7566846`: `Squire production chat/SSE log failure spike`
- `7566847`: `Squire production browser stream transport failures`
- `7566848`: `Squire production script failure log spike`
- `7566849`: `Squire production auth/rate-limit anomaly spike`
- `7566850`: `Squire production budget/accounting failure`

## Existing Event And Uptime Alerts

These alerts remain valid and `npm run sentry:app-health -- --verify` checks
that they still exist.

| Alert name                                      | Sentry view     | Filter/query                                                                                           | Trigger                                   | First action                                                    | Safe test event                                                             |
| ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Squire production backend error spike`         | Issues/Discover | `environment:production surface:server level:error`                                                    | 5 events in 10 minutes                    | Open the issue, copy `request_id`, inspect route/context        | `npm run sentry:test-event -- --kind backend`                               |
| `Squire production chat/SSE failure spike`      | Issues/Discover | `environment:production failure_kind:assistant_turn level:error`                                       | 3 events in 10 minutes                    | Open Sentry event, then jump to LangSmith by turn IDs           | `npm run sentry:test-event -- --kind chat`                                  |
| `Squire production frontend error spike`        | Issues/Discover | `environment:production surface:browser event_type:browser_error level:error`                          | 5 events in 10 minutes                    | Open event/replay; verify masked replay has no text             | `npm run sentry:test-event -- --kind browser`                               |
| `Squire production cron/job failure`            | Issues/Discover | `environment:production job_kind:cron level:error`                                                     | 1 event in 30 minutes                     | Check `job_name`, then inspect the cron machine logs            | `npm run sentry:test-event -- --kind cron`                                  |
| `Squire production deploy regression new issue` | Issues/Releases | `environment:production release:* level:error` plus Sentry condition `new issue created after release` | 1 new issue in the current release window | Compare release SHA with GitHub/Fly deploy; roll back if needed | `npm run sentry:test-event -- --kind deploy-regression`                     |
| `Squire production uptime failure`              | Uptime monitor  | URL `https://squire.maz.org/api/health`; expect HTTP 200 and JSON status `ok`                          | 2 failed checks in 5 minutes              | Check Sentry uptime details, then `/api/live` and Fly status    | `npm run sentry:test-event -- --kind uptime`; use monitor test for alerting |

## Safe Test Events

Run test events from an environment with the production `SENTRY_DSN`,
`SQUIRE_ENV=production`, and `SENTRY_RELEASE` available. The production Fly
image includes the script:

```bash
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind backend'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind chat'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind browser'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind cron'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind uptime'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind deploy-regression'
```

Local dry runs print the safe event, log, trace-search, `traceProof`, and Linear
evidence payloads without sending to Sentry:

```bash
npm run sentry:test-event -- --kind chat --dry-run
npm run sentry:test-event -- --kind uptime --dry-run
npm run sentry:app-health -- --dry-run
```

The safe test events use synthetic IDs only:

- `request_id=sentry-test-<kind>`
- `conversation_id=sentry-test-conversation` for chat/browser tests
- `user_message_id=sentry-test-user-message` for chat/browser tests
- no cookies, auth headers, raw prompts, model output, provider payloads, or
  retrieved passages
- dry-run and production output include Sentry event/log search URLs, a trace
  search URL, and `traceProof`
- the trace search URL is not proof by itself; copy confirmed trace rows or
  `traceSearchableReason` into the Linear Evidence section

The uptime safe command proves app telemetry for the health-check path without
breaking `/api/health`. For the uptime alert itself, prefer Sentry's monitor test
control if it is available in the project. If it is not, create a temporary
duplicate uptime monitor against `https://squire.maz.org/api/__sentry-uptime-test-404`,
verify the rule matches, then delete the duplicate monitor.

## Required Tags

Alert filters depend on these stable tags:

- `environment`
- `release`
- `route`
- `request_id`
- `conversation_id`
- `user_message_id`
- `assistant_message_id`
- `surface`
- `failure_kind`
- `event_type`
- `job_name`
- `job_kind`
- `security_event`
- `status`
- `duration_ms`
- `squire.surface`
- `squire.request_id`
- `squire.conversation_id`
- `squire.user_message_id`
- `squire.script_name`
- `squire.script_kind`
- `http.route`

If a new event path cannot populate these tags, it should still capture the
event, but the follow-up should add the missing low-cardinality tag before that
path becomes alert-critical.

## Verification

After deploying log/trace telemetry:

1. Run `npm run sentry:app-health -- --apply` once with `SENTRY_TOKEN`.
2. Run `npm run sentry:app-health -- --verify` and record dashboard/monitor ids
   in the PR or deploy note.
3. Send safe backend, chat, browser, cron, uptime, and deploy-regression events.
4. Confirm the dashboard queries match on `environment`, `release`,
   `request_id`, `route`, `conversation_id`, `user_message_id`, `job_kind`,
   `security_event`, and the relevant `squire.*` span fields.
5. Confirm Sentry links to LangSmith for chat spans instead of copying prompts,
   model output, or retrieved passages.
