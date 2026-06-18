# Bug Reporting

Use this workflow when filing a Squire bug from a user report, production
investigation, QA run, or agent conversation.

## Destination

Default Linear target:

- Team: `SQR`
- Project: `Squire · Bugs`
- Assignee: `me`
- State: `Todo`

Use the current feature project only when the bug is a narrow follow-up from an
active implementation PR. Production/user-reported defects belong in
`Squire · Bugs`.

## Evidence Template

Bug tickets must use `createLinearBugReportBody()` from
`src/linear-bug-report-template.ts`. The helper renders the fixed Evidence
section from `DiagnosticBundle` and fills every required field with either a
safe value or `Unavailable: <reason>`.

Required sections:

- `Evidence`
- `Observed Behavior`
- `Expected Behavior`
- `Why This Is Likely Failing`
- `First Files To Inspect`
- `Repro Steps`
- `Acceptance Criteria`

For app/runtime bugs, call the helper with `kind: "app_runtime"` so Sentry is
listed before LangSmith. For answer-quality bugs, use `kind: "answer_quality"`
so LangSmith is listed first and Sentry remains context only when there was an
app/runtime error.

## Inputs

Build the evidence bundle with:

- `collectDiagnosticBundle()` when the caller has an authenticated user and a
  conversation URL, conversation ID, or user-message ID.
- `buildDiagnosticBundle()` when the agent already gathered safe links and IDs,
  such as Sentry issue/event/replay/trace/logs URLs, Sentry event/trace IDs, or
  LangSmith trace/run URLs.

Do not paste raw prompts, full model output, provider payloads, retrieved
passages, cookies, auth headers, OAuth tokens, or secrets into Linear. If a
piece of evidence cannot be safely gathered, leave it unavailable with the
reason from the bundle.

## Codex And Claude Workflow

Use this same workflow for agent-filed bugs. Do not write a separate Linear
body by hand.

1. Pick the report kind:
   `bad_answer`, `broken_stream`, `visual_issue`, `wrong_source`, or `other`.
2. Build evidence with `collectDiagnosticBundle()` when you have an
   authenticated user and a conversation/message locator. Use
   `buildDiagnosticBundle()` when you already gathered safe links and IDs.
3. Call `buildLinearBugReportDraft()` for dry runs or
   `submitLinearBugReport()` for live filing. Both live in
   `src/linear-bug-intake.ts` and call `createLinearBugReportBody()`.
   Production Linear calls must go through `SquireLinearClient` in
   `src/linear-client.ts`; do not add new hand-written Linear GraphQL calls.
4. Dedupe before creating anything. The marker is
   `squire-bug:<env>:<conversationId>:<userMessageId>` and is embedded in the
   Linear description.
5. File in Linear team `SQR`, project `Squire · Bugs`, state `Todo`, assigned
   to the Linear token owner, label `Bug`.

Priority defaults:

- High (`2`): `bad_answer`, `broken_stream`, `wrong_source`
- Medium (`3`): `visual_issue`, `other`
- Low (`4`): only use for polish or no-repro follow-ups when filing manually

If a required field is missing, keep the field and write the exact unavailable
reason from the bundle. Do not hide gaps by deleting fields.

## In-Chat Flow

The product flow posts to `POST /api/bug-reports` with the web session cookie
and `x-csrf-token`. The endpoint collects the same diagnostic bundle, creates
or dedupes a Linear issue through `submitLinearBugReport()`, and adds the
redacted diagnostic JSON payload as a Linear comment. The browser receives only
the Linear identifier, URL, and dedupe marker.

The browser does not talk to Linear directly. It sends safe IDs, short
observed/expected text, browser metadata, and an optional user-approved
screenshot to Squire. Squire derives Sentry and LangSmith links from configured
server IDs where possible, uploads the screenshot to Linear if present, and
marks missing fields as unavailable when it cannot derive them.

The answer-turn button is the first product entrypoint. Conversation-level
menus should dispatch the same `squire:bug-report` browser event or post the
same JSON shape rather than inventing a second endpoint.

## Sentry logs/traces into Linear bug evidence

When the report came from a production conversation, gather the Sentry links
before creating the Linear issue whenever they exist:

- Sentry issue or event URL for grouped app/runtime errors
- Sentry event ID when the browser captured a feedback/error event but cannot
  construct the full Sentry event URL
- Sentry replay URL for browser/layout/stream-state reports
- Sentry logs query URL filtered by `request_id`, `conversation_id`,
  `user_message_id`, `route`, or `event_type`
- Sentry trace URL or trace ID for app latency and request/span debugging
- LangSmith trace/thread/run URL for answer-quality or tool/retrieval debugging

Pass those safe links into `buildDiagnosticBundle()` and render the issue with
`createLinearBugReportBody()`. If a link is not available, do not omit the
field. Let the diagnostic bundle render `Unavailable: <reason>` so the missing
evidence is explicit.

If the reporter checks the screenshot option, attach only the single bounded
image captured by the browser. Do not add automatic screenshots without user
action. The screenshot is user-approved evidence and can show visible
conversation UI text; keep automatic Sentry replay and diagnostic JSON masked.

## SQR-298 And SQR-299

SQR-298's in-chat bug report flow should create the same `DiagnosticBundle` and
pass the user's short observed/expected text into
`createLinearBugReportBody()` before creating the Linear issue.

SQR-299's shared Codex/Claude bug-reporting skill should use the same helper
for dry runs and issue creation. The skill can own dedupe, priority, labels, and
Linear calls, but it should not own a separate issue-body template.

## Dry-Run Examples

Chat-answer bug:

```md
Title: [Bad answer] 829e3da3-e63 / msg-user-1
Marker: squire-bug:production:829e3da3-e638-4eea-808c-fb8418c0abcf:msg-user-1
Priority: 2
Kind: answer_quality
Observed: Squire said the Drifter had no perk that ignored item effects.
Expected: Squire should account for the reported perk interaction or mark the
evidence unavailable.
First files:

- src/agent-langgraph.ts
- src/vector-store.ts
- src/chat/conversation-service.ts
```

UI bug:

```md
Title: [Visual issue] conv-1 / msg-user-1
Marker: squire-bug:production:conv-1:msg-user-1
Priority: 3
Kind: app_runtime
Observed: The report action overlaps answer prose on mobile.
Expected: The action stays below the answer without covering content.
First files:

- src/web-ui/layout.ts
- src/web-ui/squire.js
- src/web-ui/styles.css
```
