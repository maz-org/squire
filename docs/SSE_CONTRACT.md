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

- `text-delta`
  - Appends assistant answer text.
  - Payload: `{ "delta": string }`
- `tool-start`
  - Adds or updates an in-progress tool row.
  - Payload: `{ "id": string, "label": string }`
- `tool-result`
  - Marks a tool row complete or failed.
  - Payload: `{ "id": string, "label": string, "ok": boolean }`
- `done`
  - Marks the stream complete and clears the pending answer UI.
  - Payload:
    `{ "html": string, "recentQuestionsNavHtml": string, "consultedSources": string[] | null }`
  - `consultedSources` carries the persisted per-answer tool names
    (from `messages.consulted_sources`) so the client can rebuild the
    "CONSULTED · …" footer on replay paths (duplicate `/stream` hits,
    HTMX reconnects) where no `tool-result` events fired. `null` means
    the answer used no source tools, or the row predates SQR-98; the
    client renders the footer hidden in both cases. The mapping from
    tool names to provenance labels lives in
    [../src/web-ui/consulted-footer.ts](../src/web-ui/consulted-footer.ts)
    and is mirrored in [../src/web-ui/squire.js](../src/web-ui/squire.js);
    a drift test in `test/consulted-footer.test.ts` keeps both sides honest.
- `error`
  - Replaces the pending answer UI with an error banner.
  - Payload: `{ "kind": string, "message": string, "recoverable": boolean }`

## Required success-path invariants

For every successful stream:

1. The browser may receive zero or more `text-delta` events before completion.
   If present, their concatenation represents the plain-text incremental
   answer.
2. The browser must receive exactly one terminal `done` event.
3. Any `text-delta` events must arrive before `done`.
4. Tool events may appear before completion, but they do not count as answer
   text.
5. The terminal `done` event carries the final server-rendered sanitized HTML
   fragment, which replaces the pending plain-text transcript in the browser.
6. The terminal `done` event also carries the final server-rendered
   `recentQuestionsNavHtml` fragment for the canonical conversation page, so
   the browser can restore or refresh the recent-question rail immediately
   after streaming completes.
7. The terminal `done` event carries `consultedSources` (persisted tool
   names for the answer, or `null`). Live streams also accumulate sources
   from `tool-result` events as they arrive; `consultedSources` is the
   authoritative replay payload used when no tool events fired during this
   connection (duplicate `/stream` hit, reconnect, already-persisted row).

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

## Translation rules

The conversation service emits internal events like `text`, `tool_call`,
`tool_result`, and `done`. The HTTP stream route is responsible for translating
those into the browser contract above.

The route, not the provider, owns the final browser ordering guarantees:

- provider/internal `text` -> browser `text-delta`
- provider/internal `tool_call` -> browser `tool-start`
- provider/internal `tool_result` -> browser `tool-result`
- provider/internal `done` is only a completion signal
- browser `done` is emitted by the route with the final sanitized HTML derived
  from the persisted assistant message, plus the canonical recent-question rail
  HTML derived from the refreshed persisted conversation state

## Testing guidance

Regression tests should assert browser-visible behavior, not only persistence:

- successful streams without incremental text still end with a visible
  `done.html` fragment and the refreshed recent-question rail payload
- `text-delta` content remains inert plain text even when it contains hostile
  markup
- `done.html` is sanitized before browser insertion
- transport/bootstrap failures end in `error`
- repaired first-send retries satisfy the same stream contract as normal flows
