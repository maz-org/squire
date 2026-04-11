# SSE Contract

This document defines the browser-facing Server-Sent Events contract for
Squire chat streams.

Scope:

- `GET /chat/:conversationId/messages/:messageId/stream` in
  [src/server.ts](/Users/bcm/.codex/worktrees/059e/squire/src/server.ts)
- pending transcript handling in
  [src/web-ui/squire.js](/Users/bcm/.codex/worktrees/059e/squire/src/web-ui/squire.js)
- regression coverage in
  [test/conversation.test.ts](/Users/bcm/.codex/worktrees/059e/squire/test/conversation.test.ts)

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
  - Payload: `{}`
- `error`
  - Replaces the pending answer UI with an error banner.
  - Payload: `{ "kind": string, "message": string, "recoverable": boolean }`

## Required success-path invariants

For every successful stream:

1. The browser must receive the full assistant answer text through one or more
   `text-delta` events.
2. The browser must receive exactly one terminal `done` event.
3. Any `text-delta` events must arrive before `done`.
4. Tool events may appear before completion, but they do not count as answer
   text.

Important:

- A provider/backend success does not imply that incremental text events were
  emitted.
- If the backend returns a final persisted assistant message without any prior
  `text` emits, the stream route must synthesize a fallback `text-delta` from
  the persisted message before sending `done`.

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
- browser `done` is emitted by the route after it has confirmed whether
  fallback answer text is needed

## Testing guidance

Regression tests should assert browser-visible behavior, not only persistence:

- successful streams without incremental text still send visible answer content
  plus `done`
- tool-only success paths still send fallback answer text if the assistant
  message contains content
- transport/bootstrap failures end in `error`
- repaired first-send retries satisfy the same stream contract as normal flows
