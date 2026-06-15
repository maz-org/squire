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
  such as Sentry event/replay URLs or LangSmith trace/run URLs.

Do not paste raw prompts, full model output, provider payloads, retrieved
passages, cookies, auth headers, OAuth tokens, or secrets into Linear. If a
piece of evidence cannot be safely gathered, leave it unavailable with the
reason from the bundle.

## SQR-298 And SQR-299

SQR-298's in-chat bug report flow should create the same `DiagnosticBundle` and
pass the user's short observed/expected text into
`createLinearBugReportBody()` before creating the Linear issue.

SQR-299's shared Codex/Claude bug-reporting skill should use the same helper
for dry runs and issue creation. The skill can own dedupe, priority, labels, and
Linear calls, but it should not own a separate issue-body template.
