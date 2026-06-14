# Squire Observability Runbook

Use this runbook when a user reports a bad production conversation, failed
stream, browser problem, backend error, cron failure, or uptime alert.

## Ownership

- Sentry owns app observability: backend errors, swallowed chat failures, SSE
  failures, browser errors, cron/script failures, uptime checks, release health,
  replay, feedback, and alerting.
- LangSmith owns LLM traces and eval debugging: model input/output, tool calls,
  retrieval behavior, answer quality, eval regressions, and trace comparison.
- Linear owns the bug record. Tickets must use the diagnostic bundle and
  required Evidence section from `src/linear-bug-report-template.ts`.

Sentry links to LangSmith by safe IDs and URLs. Do not duplicate raw prompt,
model output, provider payload, retrieved passage, cookie, bearer token, OAuth
token, secret, full source document, email address, or full transcript content
in Sentry or Linear.

## Correlation Fields

Use these fields to move between the conversation, Sentry, LangSmith, and
Linear:

- `environment`: `production`, `staging`, `development`, or `test`
- `release`: the deployed Git SHA from `SENTRY_RELEASE`
- `request_id`: the HTTP request ID, also returned as `X-Request-ID`
- `route`: Hono route or browser surface
- `conversation_id`: the `/chat/<conversationId>` UUID
- `user_message_id`: the `/messages/<userMessageId>/stream` UUID for the turn
- `assistant_message_id`: the persisted assistant row when available
- `langsmith_thread_id`: equal to `conversation_id` for web chat
- `langsmith_trace_url`, `langsmith_thread_url`, or `langsmith_run_url`
- `sentry_issue_url`, `sentry_event_url`, and `sentry_replay_url`

If a field is missing, do not leave the ticket blank. Mark it as unavailable
with the reason returned by the diagnostic bundle.

## Where To Start

Start in Sentry when the report is about an exception, generic 500, failed
stream, duplicate/early-ended stream, browser UI break, masked replay, cron/job
failure, uptime alert, release regression, auth/rate-limit failure, or budget
failure.

Start in LangSmith when the app behaved normally but the answer was wrong,
missed a rule, cited the wrong source, chose the wrong tool path, ignored a
perk/effect, failed an eval, or otherwise looks like agent reasoning/retrieval
quality.

If the user report is ambiguous, start with the conversation URL and timestamp,
then gather a diagnostic bundle. The bundle should tell the bug ticket which
Sentry and LangSmith links are present and which are unavailable.

## User Report To Linear

1. Capture the conversation URL, selected turn URL if available, user-reported
   timestamp, observed behavior, and expected behavior.
2. For a web-chat report, parse `/chat/<conversationId>` and, when present,
   `/messages/<userMessageId>/stream` from the URL. For REST reports, capture
   `X-Request-ID`.
3. Gather safe evidence with `collectDiagnosticBundle()` when you have an
   authenticated user and a conversation URL, conversation ID, or user-message
   ID. Use `buildDiagnosticBundle()` when you already have safe links and IDs
   from Sentry, LangSmith, logs, or screenshots.
4. Render the Linear issue body with `createLinearBugReportBody()`.
   `kind: "app_runtime"` puts Sentry first. `kind: "answer_quality"` puts
   LangSmith first.
5. Keep every required Evidence field in the issue:
   `Conversation`, `Turn`, `Request`, `Sentry Issue/Event/Replay`, `Release`,
   `Environment`, `LangSmith Trace/Thread/Run`, `Observed`, `Expected`,
   `Likely failing area`, `First files to inspect`, `Repro`, and `Acceptance`.
6. Attach screenshots only if they do not show raw user prompts, model answers,
   secrets, cookies, or private source passages. Prefer masked Sentry replay for
   layout and stream-state reports.

## Bad Answer

Use this path when the user says the answer is wrong but the UI and stream
completed.

1. Start in LangSmith with `env:production`.
2. Search for `metadata.conversationId=<conversationId>` and
   `metadata.userMessageId=<userMessageId>`. If the report came from REST
   `/api/ask`, search by `metadata.requestId=<requestId>` instead.
3. Confirm the root `squire.agent.run` trace has:
   `metadata.thread_id`, `metadata.requestId`, `metadata.squireEnv`,
   `metadata.model`, `metadata.toolSurface`, stop reason, iterations, tool-call
   count, and token usage.
4. Inspect tool observations in order. Check searched source labels, canonical
   refs, tool errors, and whether the agent skipped the source family that
   should answer the question.
5. Check Sentry only for the same `request_id`, `conversation_id`, or
   `user_message_id` if the trace ended in an error, the browser saw a generic
   assistant failure, or a release regression alert fired.
6. File the bug as `kind: "answer_quality"` unless Sentry shows an app/runtime
   failure that directly caused the answer.

Likely first files:

- `src/agent-langgraph.ts`
- `src/agent.ts`
- `src/tools.ts`
- `src/vector-store.ts`
- `src/retrieval-source.ts`
- `src/chat/conversation-service.ts`
- eval suite files under `eval/suites/`

## Stream Or Chat Failure

Use this path for generic assistant failure rows, failed `/api/ask` responses,
SSE errors, reconnect problems, duplicate text, or streams that end early.

1. Start in Sentry and search:
   `environment:production failure_kind:assistant_turn level:error`
2. If the failure is a browser transport problem, also search:
   `environment:production surface:browser event_type:stream_error`
3. Open the Sentry event and copy `request_id`, `route`, `conversation_id`,
   `user_message_id`, `assistant_message_id`, `release`, and any LangSmith link.
4. Open the LangSmith trace when present. If there is no trace, check whether
   the failure happened before the agent run started.
5. Inspect durable SSE rows for the user message:

   ```sql
   select sequence, event, payload, created_at
   from message_stream_events
   where user_message_id = '<userMessageId>'
   order by sequence;
   ```

   A stored `done` or `error` means reconnects should replay and close without
   starting another agent run. Partial non-terminal rows with no active
   generation lock should end in one persisted assistant failure, not a silent
   graph restart.

6. File the bug as `kind: "app_runtime"` unless Sentry is clean and the failure
   is purely answer quality.

Likely first files:

- `src/chat/conversation-service.ts`
- `src/server.ts`
- `src/service.ts`
- `src/telemetry.ts`
- `src/web-ui/squire.js`
- `test/conversation.test.ts`
- `test/server-api.test.ts`

## Browser Or UI Report

Use this path for layout breakage, JavaScript errors, broken buttons, replay
reports, and feedback events.

1. Start in Sentry and search:
   `environment:production surface:browser level:error`
2. For stream transport failures, narrow to `event_type:stream_error`.
3. Open the masked replay if one exists. It should show layout, viewport,
   transcript turn counts, input state, and route IDs, not raw transcript text.
4. Confirm browser context has safe URL path, viewport, user agent, release,
   conversation ID, and user-message ID when available.
5. If a user screenshot is needed, ask for the smallest crop that shows layout
   or state without private text.
6. File the bug as `kind: "app_runtime"`.

Likely first files:

- `src/web-ui/squire.js`
- `src/web-ui/layout.ts`
- `src/web-ui/styles.css`
- `src/web-ui/assets.ts`
- `src/server.ts`

## Backend, Cron, And Uptime

Backend errors:

1. Start in Sentry with `environment:production surface:server level:error`.
2. Use `request_id`, `route`, and `release` to decide whether this is a deploy
   regression, input-specific bug, or dependency failure.
3. If user-facing, build a diagnostic bundle and file `kind: "app_runtime"`.

Cron and script failures:

1. Start in Sentry with `environment:production job_kind:cron level:error`.
2. Check `job_name`, `release`, and error class.
3. Use Fly logs only for timeline context:

   ```bash
   fly logs -a maz-squire --no-tail | grep '<job_name>'
   ```

4. Confirm the failed job preserved a nonzero exit and successful jobs do not
   create error events.

Uptime failures:

1. Start in the Sentry uptime monitor for
   `https://squire.maz.org/api/health`.
2. Compare with:

   ```bash
   node scripts/check-deploy-health.ts --base-url https://maz-squire.fly.dev
   flyctl status -a maz-squire
   fly releases -a maz-squire --image
   ```

3. If `/api/live` passes but `/api/health` fails, inspect database, vector, and
   embedder readiness before rolling back.
4. If the failure follows a new release and Sentry has a deploy-regression
   issue, compare `SENTRY_RELEASE` with the GitHub deploy run and rollback only
   after confirming a current-release fault.

## Safe Test Cases

Run safe test events from an environment with production `SENTRY_DSN`,
`SQUIRE_ENV=production`, and `SENTRY_RELEASE` available:

```bash
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind backend'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind chat'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind browser'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind cron'
fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind deploy-regression'
```

Local dry runs must not send to Sentry:

```bash
npm run sentry:test-event -- --kind chat --dry-run
```

Browser replay and feedback smoke:

1. Use a non-production Sentry environment first.
2. Open a safe page with no real conversation text.
3. Run the browser console smoke in
   [production-operations.md](production-operations.md#safe-browser-replay-and-feedback-smoke).
4. Confirm Sentry receives a browser error and feedback event with masked replay
   metadata only.

Uptime smoke:

1. Prefer Sentry's monitor test control when available.
2. If unavailable, create a temporary duplicate uptime monitor pointed at
   `https://squire.maz.org/api/__sentry-uptime-test-404`.
3. Verify the alert matches, then delete the duplicate monitor.
4. Do not break the real `/api/health` endpoint to test alerting.

## Release Checklist

After observability changes deploy:

1. Run `node scripts/check-deploy-health.ts --base-url https://maz-squire.fly.dev`.
2. Verify Sentry events show `environment`, `release`, `request_id`, `route`,
   and the relevant conversation/message/job/browser tags.
3. Verify LangSmith traces for one real chat show `metadata.conversationId`,
   `metadata.thread_id`, `metadata.userMessageId`, and `metadata.requestId`.
4. Generate or preview safe Sentry test events for backend, chat, browser, cron,
   deploy-regression, and uptime paths.
5. Create or update a Linear bug with the required Evidence template, using
   unavailable reasons for anything not present.
