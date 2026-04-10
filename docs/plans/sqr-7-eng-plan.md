# Engineering Plan: SQR-7 Conversation Backend

## Context

SQR-7 adds the persisted web conversation backend for Squire's authenticated web
channel.

This ticket does **not** add a second reasoning engine. The only reasoning path
remains:

- [src/service.ts](/Users/bcm/.codex/worktrees/e628/squire/src/service.ts) `ask()`
- [src/agent.ts](/Users/bcm/.codex/worktrees/e628/squire/src/agent.ts) `runAgentLoop()`

SQR-7 adds a thin conversation orchestration layer around that path:

- persisted conversations and messages in Postgres
- ownership checks for URL-addressable conversations
- explicit failure persistence
- a cookie-authenticated web route under `/chat/*`

Relevant existing code:

- [src/server.ts](/Users/bcm/.codex/worktrees/e628/squire/src/server.ts)
- [src/auth/session-middleware.ts](/Users/bcm/.codex/worktrees/e628/squire/src/auth/session-middleware.ts)
- [src/db/repositories/session-repository.ts](/Users/bcm/.codex/worktrees/e628/squire/src/db/repositories/session-repository.ts)
- [src/db/repositories/user-repository.ts](/Users/bcm/.codex/worktrees/e628/squire/src/db/repositories/user-repository.ts)
- [docs/ARCHITECTURE.md](/Users/bcm/.codex/worktrees/e628/squire/docs/ARCHITECTURE.md)
- [docs/SECURITY.md](/Users/bcm/.codex/worktrees/e628/squire/docs/SECURITY.md)

## Scope

### In scope

- New persisted `conversations` and `messages` tables
- Narrow `conversation-service` orchestration module
- Repository layer for conversation persistence
- Cookie-authenticated `/chat/*` web route(s)
- URL-backed conversation identity via `/chat/:conversationId`
- Explicit assistant failure turns
- Phase 1 recent-history cap aligned with the agent's existing 20-message cap
- Integration and boundary tests listed below

### Out of scope

- SSE-rich streaming protocol, tool indicators, citations: SQR-8
- Context compaction and summarization: SQR-12
- `tool_calls` on conversation messages: SQR-8
- Browser-level E2E chat flows: deferred follow-up work
- Broader reliability policy: [SQR-86](https://linear.app/maz-org/issue/SQR-86/define-phase-1-reliability-policy-for-web-chat-failures-and-retries)
- Broader observability plan: [SQR-87](https://linear.app/maz-org/issue/SQR-87/define-phase-1-observability-plan-for-app-failures-and-llm-traces)

## Naming

Reserve `session` for auth/web session concepts.

Name the new persisted chat resource:

- `conversation`
- `conversationId`
- `conversations`

Rationale: avoids collision with the existing auth `Session` domain object and
avoids ambiguity around "thread".

## Architecture

### Shape

- Keep exactly one reasoning engine, the existing `ask()` path.
- Add one narrow `conversation-service` module.
- Add one or two repositories:
  - `conversation-repository`
  - `message-repository`
- Do not split the workflow into micro-files per verb.

### Route and auth boundary

- Do **not** reuse `/api/ask` for the web channel.
- Web chat uses cookie auth and CSRF under `/chat/*`.
- `/api/ask` remains bearer-only and channel-neutral.

### Conversation identity and ownership

- Conversations are URL-addressable via `/chat/:conversationId`.
- Every conversation read/write must scope by both `conversation_id` and
  `user_id`.
- Missing and non-owned conversations return indistinguishable `404`.

### First-message creation and idempotency

- First message creation accepts a client-generated idempotency key.
- Server guarantees one create result per `(user, idempotency_key)` pair.
- UI must prevent double-submit while the first-send request is in flight.

### Write order and failure behavior

- Persist user turn first.
- Call `ask()` in-process using stored history.
- On success, persist assistant text turn.
- On failure, persist a generic assistant-visible failure turn:
  - `"I hit an error and couldn't answer that. Please try again."`
- Exclude failure turns from future history sent back into `ask()`.

### Retry policy

- Retry transparently once for clear network or transient transport failures.
- Do **not** retry LLM server-side failures automatically.
- If the retry still fails, persist the generic failure turn and let the user
  retry explicitly.

### `ask()` contract

- Keep `ask()` returning plain text in SQR-7.
- If SQR-8 needs richer output, widen the interface there.
- Do not add speculative structured return types in this ticket.

## Data Model

### Tables

- `conversations`
  - `id`
  - `user_id`
  - `created_at`
  - `last_message_at`
- `messages`
  - `id`
  - `conversation_id`
  - `role` (`user` | `assistant`)
  - `content`
  - `created_at`
  - optional status/type fields only if needed to distinguish failure turns

### Constraints and indexes

- New Drizzle migration file for `conversations` and `messages`
- `conversations.user_id` foreign key to `users.id`
- `messages.conversation_id` foreign key to `conversations.id`
- Composite index on `(conversation_id, created_at)` for ordered history reads
- User-scoped conversation listing/resume index, e.g. `(user_id, last_message_at)`
- First-message idempotency uniqueness must be scoped to user

### Explicitly deferred

- No `tool_calls` field in SQR-7

## Request Flow

```text
Authenticated browser
  |
  | GET /chat/:conversationId
  v
Cookie session middleware -> load auth session
  |
  v
conversation-service -> load owned conversation by (conversation_id, user_id)
  |
  +-- not found / not owned -> 404
  |
  +-- found -> load recent messages ordered by created_at
  v
render chat page

Authenticated browser
  |
  | POST /chat/:conversationId/messages
  | CSRF token via existing web UI meta-tag/header pattern
  v
Cookie session middleware + CSRF middleware
  |
  v
conversation-service
  |
  +-- persist user turn
  +-- load recent message history (max 20)
  +-- call ask(question, { history, userId })
  |     |
  |     +-- transient transport failure -> retry once
  |     +-- LLM/server failure -> no auto retry
  |
  +-- success -> persist assistant turn
  +-- failure -> persist generic assistant failure turn
  v
return updated conversation response
```

## CSRF

- Authenticated chat pages render the CSRF token in HTML.
- Every `/chat/*` POST sends it using the same header/meta-tag pattern already
  used by the authenticated web UI.
- Do not create a separate chat-specific CSRF token transport.

## History Window

- In SQR-7, cap loaded persisted history to the same 20-message limit already
  enforced by [src/agent.ts](/Users/bcm/.codex/worktrees/e628/squire/src/agent.ts).
- This is a Phase 1 guardrail only.
- SQR-12 replaces this with real compaction/summarization.

## Files

### New

- `src/chat/conversation-service.ts`
- `src/db/repositories/conversation-repository.ts`
- `src/db/repositories/message-repository.ts`
- Drizzle migration for `conversations` and `messages`
- conversation backend tests

### Modified

- `src/db/schema/core.ts` or another appropriate schema file under `src/db/schema/`
- `src/db/repositories/types.ts` if shared domain types belong there
- `src/server.ts`
- relevant test helpers if truncate/reset coverage must expand
- [docs/ARCHITECTURE.md](/Users/bcm/.codex/worktrees/e628/squire/docs/ARCHITECTURE.md) post-merge if any load-bearing pattern should graduate out of `docs/plans`

## Testing

This ticket should stay at unit + integration level. Full browser E2E remains
deferred.

### Required tests

1. Adversarial integration test proving user A cannot access user B's
   `/chat/:conversationId`
2. Integration test proving:
   - user turn is persisted first
   - `ask()` failure persists a generic assistant failure turn
3. Integration test proving:
   - first message creates a stable conversation
   - reload resumes ordered history
4. Boundary test proving conversation orchestration forwards stored history to
   `ask()` untouched
5. Tests covering the aligned 20-message history cap
6. Tests covering the first-send idempotency key and duplicate-submit protection

### QA artifact

Primary QA input already written to:

- [bcm-bcm-sqr-7-conversation-agent-backend-eng-review-test-plan-20260410-100636.md](/Users/bcm/.gstack/projects/maz-org-squire/bcm-bcm-sqr-7-conversation-agent-backend-eng-review-test-plan-20260410-100636.md)

## Production Risks and Follow-ups

### Already tracked

- Per-user rate limit and cost budget: [SQR-60](https://linear.app/maz-org/issue/SQR-60/per-user-rate-limit-daily-cost-budget-circuit-breaker)
- Reliability policy: [SQR-86](https://linear.app/maz-org/issue/SQR-86/define-phase-1-reliability-policy-for-web-chat-failures-and-retries)
- Observability plan: [SQR-87](https://linear.app/maz-org/issue/SQR-87/define-phase-1-observability-plan-for-app-failures-and-llm-traces)

### Minimum expectations for SQR-7

- failures are visible in logs/traces well enough to debug locally
- conversation id and user id can be correlated during debugging
- generic assistant failure turns do not leak internal error text

## Implementation Order

1. Add schema + migration
2. Add repositories
3. Add `conversation-service`
4. Add `/chat/*` route wiring with cookie auth + CSRF
5. Add tests
6. Verify history-cap, retry, and failure-turn behavior

## Review Outcome

- Scope reduced and clarified during eng review
- Outside voice used Claude CLI, not Codex, for actual independence
- Durable checkpoint:
  - [20260410-103406-bcm-sqr-7-conversation-agent-backend-plan-eng-review-sqr7.md](/Users/bcm/.gstack/projects/maz-org-squire/checkpoints/20260410-103406-bcm-sqr-7-conversation-agent-backend-plan-eng-review-sqr7.md)
