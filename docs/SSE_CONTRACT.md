# SSE Contract

This document defines the browser-facing Server-Sent Events contract for
Squire chat streams.

Scope:

- `GET /chat/:conversationId/messages/:messageId/stream` in
  [src/server.ts](../src/server.ts)
- pending transcript handling in
  [src/web-ui/squire.js](../src/web-ui/squire.js)
- regression coverage in
  [test/conversation.test.ts](../test/conversation.test.ts)

## Browser-visible events

The browser consumes these SSE event names:

Every browser-visible event written after `ask()` starts carries an SSE `id`
field. The id is the turn-local persisted event sequence (`1`, `2`, `3`, ...),
scoped to `(conversationId, userMessageId)`. The browser may reconnect with
`Last-Event-ID`; the server replays only stored events with a larger sequence.
The `userMessageId` is also the LangGraph checkpoint `thread_id` for the run, so
SSE replay and graph execution are keyed to the same turn. LangSmith uses
`metadata.thread_id = conversationId` to group all turns in the conversation.
The SSE event log is not a durable LangGraph node checkpoint.

- `text-delta`
  - Appends assistant answer text.
  - Payload: `{ "delta": string }`
- `tool-start`
  - Adds or updates an in-progress tool row.
  - Payload: `{ "id": string, "label": string }`
- `tool-result`
  - Marks a tool row complete or failed.
  - Payload:
    `{ "id": string, "labels": string[], "ok": boolean, "message"?: string }`
  - `message`, when present, is a user-safe completed-work description already
    translated away from raw refs. It is rendered in the work log, never
    appended as answer prose.
- `tool-plan`
  - Adds a plain-language statement of the agent's next intended lookup.
  - Payload: `{ "id": string, "message": string }`
  - `message` is user-safe intent text. It is rendered in the work log, never
    appended as answer prose.
- `tool-progress`
  - Adds a compact, user-safe progress row for long tool work.
  - Payload: `{ "id": string, "label": string, "message": string }`
  - `label` is safe tool/source metadata such as `SECTION BOOK` or the
    `REFERENCE` fallback. `message` is already filtered by the service as
    user-safe, display-ready progress text; it is rendered as metadata, never
    answer prose. Raw canonical refs should be translated into human labels
    before they become browser-visible.
- `answer-artifact`
  - Adds a structured, user-safe artifact such as a quoted section block.
  - Payload:
    `{ "id": string, "kind": "section-quote", "title": string, "body": string, "sourceLabel": string | null, "ref": string | null }`
  - The browser renders artifact fields with DOM text APIs, not `innerHTML`.
    Artifact bodies are metadata/content blocks outside
    `.squire-answer__content`; they are never appended as answer prose.
- `done`
  - Marks the stream complete and clears the pending answer UI.
  - Payload: `{ "html": string, "consultedSources": string[] | null }`
  - `consultedSources` carries the persisted per-answer tool names
    (from `messages.consulted_sources`) so the client can rebuild the
    inline checked-source work log on replay paths (duplicate `/stream` hits,
    HTMX reconnects) where no `tool-result` events fired. `null` means
    the answer used no source tools, or the row predates SQR-98; the
    client renders no source rows in both cases. The mapping from
    tool names to provenance labels lives in
    [../src/web-ui/consulted-footer.ts](../src/web-ui/consulted-footer.ts)
    and is mirrored in [../src/web-ui/squire.js](../src/web-ui/squire.js);
    a drift test in `test/consulted-footer.test.ts` keeps both sides honest.
  - SQR-108 / [ADR 0012](adr/0012-split-home-and-scrolling-chat-ia.md) E-3
    dropped the `recentQuestionsNavHtml` field. The conversation page is
    now a scrolling transcript with no recent-questions chip rail to
    refresh after a turn finishes — prior questions are read in place
    inside the transcript itself.
- `error`
  - Replaces the pending answer UI with an error banner.
  - Payload: `{ "kind": string, "message": string, "recoverable": boolean }`

The browser does not consume provider-native stream chunks directly. Any new
internal event must be mapped here before it can become browser-visible.

## Resume and Replay

`GET /chat/:conversationId/messages/:messageId/stream` writes browser-visible
events to `message_stream_events` before sending them over SSE. The durable log
covers answer text, tool rows, progress rows, structured artifacts, terminal
`done`, and terminal `error`.

Replay rules:

1. `Last-Event-ID` is parsed as a turn-local integer sequence. Missing or
   invalid values mean replay from the beginning.
2. The server sends only events with `sequence > Last-Event-ID`.
3. If a stored `done` or `error` is replayed, the route closes without calling
   the agent again.
4. If non-terminal events exist and the original turn is still running, the
   reconnecting stream polls the persisted event log until a terminal event is
   available.
5. If non-terminal events exist but no generation lock remains, the process
   cannot safely continue the prior graph run. The route persists one assistant
   failure row if needed, appends a terminal `error`, and closes.

This means already-written stream text is durable across browser reconnects and
server restarts. It does not mean an interrupted LangGraph run can always resume
model/tool execution exactly where it stopped; that requires a durable graph
checkpoint for the interrupted node. When no active lock or completed assistant
row exists, Squire prefers one explicit failure over duplicating answer text or
tool artifacts from a restarted run.

## Required success-path invariants

For every successful stream:

1. The browser may receive zero or more `text-delta` events before completion.
   If present, their concatenation represents the plain-text incremental
   answer. Planning narration, raw tool output, and debug data are never answer
   text and must not be sent as `text-delta`.
2. The browser must receive exactly one terminal `done` event.
3. Any `text-delta` events must arrive before `done`.
4. Tool, progress, and artifact events may appear before completion, but they
   do not count as answer text.
5. The terminal `done` event carries the final server-rendered sanitized HTML
   fragment, which replaces the pending plain-text transcript in the browser.
6. The terminal `done` event carries `consultedSources` (persisted tool
   names for the answer, or `null`). Live streams also accumulate sources
   from `tool-result` events as they arrive; `consultedSources` is the
   authoritative replay payload used when no tool events fired during this
   connection (duplicate `/stream` hit, reconnect, already-persisted row).
7. On replay, the same persisted event ids are reused. Replayed `text-delta`,
   tool, progress, artifact, and terminal events must not be regenerated with
   new ids.

Important:

- A provider/backend success does not imply that incremental text events were
  emitted.
- The browser treats `text-delta` as inert plain text only; rich formatting is
  introduced exclusively through the final sanitized `done.html` fragment.
- If the backend finishes without any prior incremental text, the route may
  still complete successfully with only a terminal `done` payload containing
  the final HTML fragments.

## Error-path invariants

For every failed stream:

1. The browser must receive exactly one terminal `error` event.
2. `done` must not be sent after `error`.
3. Partial `text-delta` events may have been sent before the failure.

Per [ADR 0017](adr/0017-phase-1-web-chat-reliability-policy.md), streamed chat
turns are not transparently retried after `ask()` starts. The browser may have
already received partial text or tool events, so the safe terminal state is one
recoverable error event plus one persisted assistant failure row.

## Internal event vocabulary

The conversation service emits Squire-owned internal events. These are typed in
`src/service.ts` and are intentionally narrower than provider stream events:

- `text`: final answer prose only. Tool-planning text such as "Let me search"
  or raw retrieved fragments must not be emitted as `text`.
- `tool_call`: a tool lookup or source traversal started.
- `tool_result`: a tool lookup or source traversal completed.
- `tool_plan`: optional user-safe statement of the next intended lookup. Routes
  that expose it must map it to browser `tool-plan`, not `text-delta`.
- `tool_progress`: optional user-safe progress from inside a long tool. Routes
  that expose it must map it to browser `tool-progress`, not `text-delta`.
- `artifact`: optional user-safe structured content. Routes that expose it must
  map it to browser `answer-artifact`, not `text-delta`, and the browser must
  render fields as text rather than trusted HTML.
- `debug`: diagnostic data for traces/logs. This is never browser-visible.
- `done`: internal completion signal only. The route emits browser `done` after
  persistence so it can include sanitized HTML and persisted consulted sources.

## Translation rules

The HTTP stream route is responsible for translating internal events into the
browser contract above.

The route, not the provider, owns the final browser ordering guarantees:

- provider/internal `text` -> browser `text-delta`
- provider/internal `tool_call` -> browser `tool-start`
- provider/internal `tool_result` -> browser `tool-result`
- internal `tool_plan` -> browser `tool-plan`
- internal `tool_progress` -> browser `tool-progress`
- internal `artifact` -> browser `answer-artifact`
- internal `debug` -> no browser event
- provider/internal `done` is only a completion signal
- browser `done` is emitted by the route with the final sanitized HTML derived
  from the persisted assistant message and the persisted `consultedSources`
  for replay

## Testing guidance

Regression tests should assert browser-visible behavior, not only persistence:

- successful streams without incremental text still end with a visible
  `done.html` fragment
- tool-planning text and raw tool output from intermediate model turns never
  appear in `text-delta`
- `tool_plan` appears only as browser `tool-plan`; it is rendered in the work
  log when present
- `tool_progress` appears only as browser `tool-progress`; `debug` never appears
  in browser SSE
- structured artifacts appear only as browser `answer-artifact`, not
  `text-delta`, and artifact DOM rendering treats artifact fields as text
- `text-delta` content remains inert plain text even when it contains hostile
  markup
- `done.html` is sanitized before browser insertion
- transport/bootstrap failures end in `error`
- repaired first-send retries satisfy the same stream contract as normal flows
