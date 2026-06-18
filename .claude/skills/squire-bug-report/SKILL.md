# Squire Bug Report

Use this skill when filing a Squire bug from a user report, QA run, production
probe, or agent investigation.

## Required Reading

Read these repo docs before creating or updating a Linear bug:

- `docs/agent/bug-reporting.md`
- `docs/agent/diagnostic-bundle.md`

## Workflow

1. Gather safe IDs and links only: conversation URL, conversation ID, user
   message ID, assistant message ID, request ID, Sentry issue/event/replay/logs
   URLs, Sentry event/trace IDs, LangSmith trace/thread/run URLs, release,
   environment, viewport, and screenshot or masked replay IDs when available.
2. Do not copy raw prompts, full answers, provider payloads, cookies, auth
   headers, OAuth tokens, secrets, retrieved passages, or full conversations.
3. Build a `DiagnosticBundle`.
4. Use `buildLinearBugReportDraft()` for a dry run or `submitLinearBugReport()`
   to file the issue.
5. Search by the dedupe marker before creating a ticket:
   `squire-bug:<env>:<conversationId>:<userMessageId>`.
6. File in Linear team `SQR`, project `Squire · Bugs`, state `Todo`, label
   `Bug`, assigned to the Linear token owner.

If evidence is missing, keep the field and state the exact unavailable reason.
