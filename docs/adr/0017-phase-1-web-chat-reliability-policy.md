---
type: ADR
id: '0017'
title: 'Phase 1 web chat reliability policy'
status: active
date: 2026-05-17
---

## Context

SQR-7's engineering review left the web chat reliability policy underspecified,
and SQR-86 tracks the Phase 1 follow-through. The implementation is no longer
greenfield: the Phase 1 web channel already has a concrete conversation service,
persisted transcript, HTMX/SSE stream path, and plain-form fallback path.

The current split matters:

- The conversation service owns persisted turns, idempotency, retry behavior,
  and failure persistence.
- The knowledge agent owns domain reasoning and model/tool calls.
- The SSE route owns browser-visible stream event ordering.
- ADR 0013 keeps Phase 1 production on this current Hono, conversation-service,
  Claude SDK, SSE, LangSmith, and OpenTelemetry path.

Reliability behavior needs to protect the transcript first. A failed model call
must not lose the user's question, duplicate an assistant answer, or silently mix
two streamed attempts into one browser update.

## Decision

**Phase 1 web chat persists the user turn before calling `ask()`, retries at
most once only for clear non-streaming transport failures, never transparently
retries an SSE turn after `ask()` starts, and persists exactly one assistant
failure turn when the agent cannot answer.**

The retry budget is one retry after the first failed attempt. A retry is allowed
only on the non-SSE plain-form path, where the browser has not already received
partial answer text.

Retryable transport failures are intentionally narrow:

- `ECONNRESET`
- `ETIMEDOUT`
- `ENOTFOUND`
- `EAI_AGAIN`
- `ECONNREFUSED`
- nested `cause.code` with one of the above values
- `AbortError`
- error messages containing `network`, `socket`, or `timed out`

Provider/server-side failures, including status-shaped errors such as `500` or
`429` without a transport-style code/name/message, are not retried blindly in
Phase 1. They persist the generic assistant failure turn.

Retries and persistence interact this way:

```text
plain-form submit
  └── persist user turn
      └── call ask()
          ├── success -> persist one assistant answer
          ├── retryable transport failure
          │   └── reset captured sources
          │       └── wait 200ms
          │           └── call ask() one final time
          │               ├── success -> persist one assistant answer
          │               └── failure -> persist one assistant failure
          └── non-retryable failure -> persist one assistant failure

SSE stream
  └── user turn already persisted by POST
      └── call ask()
          ├── success -> persist one assistant answer, emit terminal done
          └── failure -> persist one assistant failure, emit terminal error
```

SSE events written after `ask()` starts are also persisted in
`message_stream_events` with a turn-local sequence id. On browser reconnect,
the stream route honors `Last-Event-ID` and replays only later stored events.
If a terminal `done` or `error` already exists, replay closes without calling
the agent again. The stream log is keyed by `userMessageId`, which is also the
LangGraph `thread_id` for the run.

If a reconnect finds partial stored events and the original generation is still
locked, the route waits for more stored events and relays them. If partial
stored events exist but no generation lock remains, the previous graph run is
not safely resumable from the SSE layer alone. The route persists one assistant
failure row if needed and appends a terminal stream error instead of restarting
the agent and risking duplicate answer text or artifacts.

Duplicate assistant turns are avoided by taking a transaction-scoped advisory
lock on the `(conversationId, userMessageId)` pair and reusing any existing
assistant response for that user message.

Failure turns are persisted as assistant messages with `isError = true`,
associated via `responseToMessageId`, and excluded from future history passed to
the knowledge agent.

Phase 1 operator signals to watch are:

- chat failure rate
- retry rate
- timeout rate
- provider/server error rate

SQR-87 owns turning those signals into trace fields, metrics, dashboards, or
alerts. SQR-86 only fixes the policy boundary and tests.

## Options considered

- **Option A (chosen) — one retry only for non-SSE transport failures.** This
  handles brief network flakes without risking duplicated streamed text or
  repeated model/provider work on server errors.
- **Option B — no retries anywhere.** Simpler, but too brittle for the
  plain-form path where one short transport reset can be recovered without a bad
  user experience.
- **Option C — retry both plain-form and SSE failures.** Rejected because an SSE
  client may already have received partial text/tool events. A silent replay
  would merge two attempts into one pending answer.
- **Option D — retry provider/server errors too.** Rejected for Phase 1 because
  status-only retry policy needs provider-specific semantics, cost controls, and
  observability. Blindly retrying `500`/`429` can amplify incidents and spend.

## Consequences

- User questions are durable before model/provider work begins.
- Plain-form users can recover from one clear transport failure without seeing
  an error.
- SSE users never see a mixed stream from two backend attempts.
- Browser reconnects replay already-persisted stream events by id instead of
  depending on in-process buffers.
- A process crash can preserve already-written stream text, progress rows, and
  artifacts, but cannot continue an incomplete graph run unless a completed
  assistant row or active generation lock exists.
- The transcript has exactly one assistant outcome per user message: answer or
  failure.
- The retry classifier remains a small private implementation detail tested
  through the conversation boundary rather than a new public API.
- Provider-aware retry policy remains future work. It should land with SQR-87
  observability and SQR-60 cost controls, not as a hidden behavior change.
