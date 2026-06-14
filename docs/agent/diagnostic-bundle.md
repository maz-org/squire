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
- `sentry`: issue, event, and replay URLs
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
a Sentry URL or LangSmith URL supplied by an agent workflow. Missing fields are
not omitted; they are marked unavailable.

SQR-310's Linear Evidence template should render from this bundle rather than
inventing ad hoc field names.
