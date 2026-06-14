# Sentry Alert Catalog

Sentry owns Squire app alerting. Fly logs are a fallback for timeline context,
not the alert source.

The Sentry project is the Fly-provisioned `maz-squire` project
(`project=4511564194643969`). Open it with:

```bash
flyctl extensions sentry dashboard -a maz-squire
```

Use the Sentry alert builder to create the production rules below. Route each
rule to the default owner notification channel until Sentry has a dedicated
Slack/PagerDuty integration. Thresholds are intentionally written here, not in
code, so they can be adjusted in Sentry without an app deploy.

## Alert Rules

| Alert name                                      | Sentry view     | Filter/query                                                                                           | Trigger                                   | First action                                                    | Safe test event                                                                                      |
| ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Squire production backend error spike`         | Issues/Discover | `environment:production surface:server level:error`                                                    | 5 events in 10 minutes                    | Open the issue, copy `request_id`, inspect route/context        | `npm run sentry:test-event -- --kind backend`                                                        |
| `Squire production chat/SSE failure spike`      | Issues/Discover | `environment:production failure_kind:assistant_turn level:error`                                       | 3 events in 10 minutes                    | Open Sentry event, then jump to LangSmith by turn IDs           | `npm run sentry:test-event -- --kind chat`                                                           |
| `Squire production frontend error spike`        | Issues/Discover | `environment:production surface:browser event_type:browser_error level:error`                          | 5 events in 10 minutes                    | Open event/replay; verify masked replay has no text             | `npm run sentry:test-event -- --kind browser`                                                        |
| `Squire production cron/job failure`            | Issues/Discover | `environment:production job_kind:cron level:error`                                                     | 1 event in 30 minutes                     | Check `job_name`, then inspect the cron machine logs            | `npm run sentry:test-event -- --kind cron`                                                           |
| `Squire production deploy regression new issue` | Issues/Releases | `environment:production release:* level:error` plus Sentry condition `new issue created after release` | 1 new issue in the current release window | Compare release SHA with GitHub/Fly deploy; roll back if needed | `npm run sentry:test-event -- --kind deploy-regression`                                              |
| `Squire production uptime failure`              | Uptime monitor  | URL `https://squire.maz.org/api/health`; expect HTTP 200 and JSON status `ok`                          | 2 failed checks in 5 minutes              | Check Sentry uptime details, then `/api/live` and Fly status    | Use Sentry monitor test, or a temporary duplicate monitor pointed at `/api/__sentry-uptime-test-404` |

## Safe Test Events

Run test events from an environment with the production `SENTRY_DSN`,
`SQUIRE_ENV=production`, and `SENTRY_RELEASE` available. The production Fly
image includes the script:

```bash
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind backend'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind chat'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind browser'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind cron'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind deploy-regression'
```

Local dry runs print the safe tags/context without sending to Sentry:

```bash
npm run sentry:test-event -- --kind chat --dry-run
```

The safe test events use synthetic IDs only:

- `request_id=sentry-test-<kind>`
- `conversation_id=sentry-test-conversation` for chat/browser tests
- `user_message_id=sentry-test-user-message` for chat/browser tests
- no cookies, auth headers, raw prompts, model output, provider payloads, or
  retrieved passages

For the uptime rule, prefer Sentry's monitor test control if it is available in
the project. If it is not, create a temporary duplicate uptime monitor against
`https://squire.maz.org/api/__sentry-uptime-test-404`, verify the rule matches,
then delete the duplicate monitor. Do not break the real `/api/health` endpoint
to test alerting.

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

If a new event path cannot populate these tags, it should still capture the
event, but the follow-up should add the missing low-cardinality tag before that
path becomes alert-critical.
