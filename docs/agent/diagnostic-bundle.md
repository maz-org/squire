# Diagnostic Bundle Contract

Bug reports that originate from a Squire conversation should use
`src/diagnostic-bundle.ts` as the evidence contract. The bundle is safe to copy
into Linear because every evidence field is either:

- `available`, with a redacted low-cardinality value
- `unavailable`, with a concrete reason

The bundle deliberately excludes raw cookies, auth headers, OAuth tokens, raw
prompts, full model output, provider payloads, retrieved passages, and full
source documents. Sentry owns app/runtime evidence, and LangSmith remains the
trace/eval system for answer-quality debugging.

## Shape

Top-level fields:

- `report`: generated time, environment, release SHA
- `request`: request ID and route
- `conversation`: conversation URL, conversation ID, turn IDs, safe user ID/hash,
  game/campaign IDs, message timestamps, assistant error flag
- `sentry`: issue, event, replay, trace, logs-query URLs, and trace ID
- `langsmith`: trace/thread/run URLs and IDs
- `browser`: safe browser URL, user agent, viewport, replay snapshot ID
- `stream`: terminal status, event count, and safe work-log rows
- `sourceIndex`: embedding version plus consulted/work-log source labels
- `unavailable`: flattened list of missing field paths and reasons

Work-log rows are reduced to public event names, sequence numbers, timestamps,
source labels, boolean success, and canonical refs. They do not include tool
messages, artifact bodies, state summaries, proposal lines, or stream text.

## Collection

Use `collectDiagnosticBundle()` when the caller has an authenticated safe user
ID and wants repository-backed evidence from a conversation URL, conversation
ID, or user-message ID. The collector verifies conversation ownership before it
loads messages or stream events.

Use `buildDiagnosticBundle()` when the caller already has safe evidence, such as
a Sentry issue/event/replay/trace/logs URL or LangSmith URL supplied by an
agent workflow. Missing fields are not omitted; they are marked unavailable.

SQR-310's Linear Evidence template renders this bundle with
`createLinearBugReportBody()` in `src/linear-bug-report-template.ts`. New
in-chat or agent-created bug report paths should call that helper rather than
inventing ad hoc field names.

## Extending The Bundle

When adding a new diagnostic field, update the schema, sanitizer, collector,
builder, and Linear rendering path in the same PR:

- Add the field to `DiagnosticBundleSchema` and the TypeScript shape.
- Accept only low-cardinality IDs, URLs, timestamps, booleans, counts, or other
  values that are safe to copy into Linear.
- Add an unavailable reason for every path where the field cannot be collected.
- Render the field through `createLinearBugReportBody()` or explain why it is
  internal-only.
- Add tests for a full bundle, a missing-field bundle, and redaction of unsafe
  input.

Every new diagnostic field must add an unavailable reason before it can ship.

Do not add fields for raw prompts, model output, retrieved passages, full
transcripts, request bodies, cookies, tokens, emails, names, or provider
payloads. Those belong in LangSmith or the original source system, not in a
Linear bug ticket.
