# Agent Streaming Runtime Practical Path

Date: 2026-05-24

Status: planning artifact for a standalone Linear project. This work is
outside the main Squire product phase initiatives.

Related docs:

- [docs/SSE_CONTRACT.md](../SSE_CONTRACT.md)
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md)
- [docs/adr/0015-langchain-deep-agents-intelligence-layer.md](../adr/0015-langchain-deep-agents-intelligence-layer.md)
- [docs/plans/sqr-161-langsmith-deployment-agent-runtime-report.md](./sqr-161-langsmith-deployment-agent-runtime-report.md)
- [docs/plans/agent-streaming-runtime-fuller-vision.md](./agent-streaming-runtime-fuller-vision.md)

## Goal

Fix the chat-streaming UX problem shown in the May 10 screenshots, then test a
minimal LangGraph runner behind Squire's current `ask()` boundary.

The user-visible failure is clear: Squire streams the agent's work-in-progress
text as if it were answer prose. The browser shows "Let me search..." reasoning,
failed retrieval attempts, raw markdown, awkward token joins, and partial source
fragments before the final answer. The final answer eventually becomes usable,
but the live reading experience looks like the agent thinking out loud.

The practical path has two steps:

1. Fix the current stack so model text from tool-planning turns never reaches
   the answer body.
2. Add an eval-gated LangGraph runner that separates final-answer token streams
   from tool, progress, state, and debug streams.

The project is not complete with answer-body hygiene alone. The target UX also
requires browser-visible progress rows, structured artifact events, and an
explicit final-answer node in the LangGraph runner.

## Office-Hours Synthesis

Goal: make Squire feel trustworthy at the table while preserving the option to
learn from LangGraph and Deep Agents.

Narrowest useful wedge: gate current streaming so only final-answer text reaches
`.squire-answer__content`. Tool-planning text should either be hidden or mapped
to compact status events.

What not to build first: a remote LangSmith Agent Server, a Deep Agents
production rewrite, a new chat UI, or campaign-state approval flows. Those are
future options, not the fix for the screenshots.

Best practical bet: fix the leak in the current Claude SDK loop, then run a
small LangGraph adapter behind a feature flag and compare it against evals.

## Existing System

Squire already has the right ownership split:

- The Hono server owns web routes, auth, and browser SSE.
- The conversation service owns persisted turns, failure rows, provenance
  capture, and final rendering.
- The `ask()` service boundary delegates to the knowledge agent.
- The knowledge agent owns tool planning, source lookup, and final answer
  synthesis.
- The browser consumes a stable event vocabulary: `text-delta`, `tool-start`,
  `tool-result`, `done`, and `error`.

The current agent loop already distinguishes saved final answer text from
scratch text. In `src/agent.ts`, text from a response with tool use is not saved
as the final answer. The bug is narrower: `callClaude()` streams every provider
text delta immediately when `emit` is present, before the caller knows whether
that response will end in `tool_use`.

Current behavior:

```text
Claude streaming text delta
  -> emit("text")
    -> conversation service
      -> browser text-delta
        -> live answer body
```

Needed behavior:

```text
Claude streaming text delta from a tool-planning turn
  -> buffer or discard
    -> no browser answer text

Claude streaming text delta from a final-answer turn
  -> emit("text")
    -> browser text-delta
```

## Scope

### In Scope

- Stop leaking model scratch text into the browser answer body.
- Preserve the existing final `done.html` replacement and sanitization path.
- Preserve the existing `consultedSources` footer behavior.
- Add internal progress events that can render as quiet browser-visible tool
  metadata.
- Add structured artifact events for user-safe retrieved content, such as a
  quoted section block.
- Add regression tests using the scenario-61 unlock flow or an equivalent
  fixture where the model first narrates a tool lookup.
- Add a LangGraph runner behind `ask()` as an eval-only or feature-flagged path.
- Map LangGraph stream modes into Squire internal events.
- Compare the LangGraph runner to the current Claude SDK runner on final answer
  quality, trajectory quality, latency, cost, trace clarity, and stream hygiene.

### Not in Scope

- Replacing Squire's Hono app, auth, Postgres store, or web conversation model.
- Exposing LangGraph or LangSmith streams directly to the browser.
- Moving production traffic to LangGraph without eval results and a later ADR.
- Adding remote LangSmith Agent Server.
- Adding Deep Agents to production web chat.
- Redesigning the visual chat surface.
- Persisting partial assistant answer text in Postgres.
- Adding campaign writes, spoiler approvals, or long-term memory.

## Plan-CEO Review

The 10-star version is not "Squire uses LangGraph." It is "Squire never shows
the wrong layer of the agent run to the user." Framework adoption is only useful
if it improves that outcome.

Hold scope for the first project:

- Fix the live UX leak first.
- Keep the runtime experiment behind `ask()`.
- Do not attach this project to Phase 1 or Phase 2.
- Do not let it block GH2 table-readiness or other phase work.

Selective expansion worth including: measure stream hygiene explicitly. A runner
can have correct final answers and still fail the UX bar if it streams planning
text into the answer body.

## Plan-Eng Review

### Architecture

Use a runner interface at the intelligence boundary:

```text
Browser SSE
  -> Hono stream route
    -> conversation service
      -> ask(question, options)
        -> agent runner
          -> current Claude SDK runner
          -> optional LangGraph runner
        -> Squire tools
          -> Postgres + pgvector + GHS/book data
```

The browser must not know which runner produced the answer. Every runner emits
Squire internal events, and the existing web layer maps those to browser SSE.

### Stream Event Rules

Add a stricter internal rule:

- `text` means final answer prose only.
- `tool_call` means a source or lookup step started.
- `tool_result` means a source or lookup step completed.
- `tool_progress` means user-safe progress from inside a long tool or lookup.
- `artifact` means structured, sanitized answer-adjacent content such as a
  retrieved quote block.
- `debug` means trace-only, never browser-visible.

This rule matters more than the runner. The current loop and the LangGraph
runner must both satisfy it.

### Minimal Current-Stack Fix

There are two viable implementation choices:

1. Disable provider text streaming during tool-enabled turns. Keep showing tool
   events, then rely on `done.html` for the final answer. This is simplest but
   loses token streaming for final answers unless a second no-tool synthesis call
   is made.
2. Buffer provider text per model response. If the final provider message ends
   with `tool_use`, discard the buffered text or convert it to progress. If it
   ends as final answer text, flush the buffer and subsequent deltas as answer
   text.

Recommendation: implement buffering. It preserves final-answer streaming while
removing planning text. It also mirrors what LangGraph will make explicit later:
tokens are only answer tokens after the producing node is known.

### Minimal LangGraph Runner

Build a local LangGraph graph with enough structure to prove stream routing:

```text
START
  -> model_or_tool_choice
      -> execute_tools
      -> model_or_tool_choice
  -> final_answer
  -> END
```

Stream mapping:

| LangGraph stream | Squire use                                                |
| ---------------- | --------------------------------------------------------- |
| `messages`       | Emit `text` only when `metadata.langgraph_node` is final. |
| `tools`          | Emit `tool_call` and `tool_result`.                       |
| `custom`         | Emit `tool_progress` or structured artifacts.             |
| `updates`        | Store in trajectory and traces.                           |
| `values`         | Trace/debug only unless a test needs state snapshots.     |
| `debug`          | Trace/debug only, never browser-visible.                  |

The first LangGraph runner can reuse existing Squire tools and the existing
system prompt. It does not need memory, interrupts, subagents, or remote
deployment.

### Data Flow

```text
User asks question
  -> POST writes user message and pending answer shell
  -> GET /chat/:conversationId/messages/:messageId/stream
  -> conversation service calls ask(..., emit)
  -> selected runner emits internal events
  -> conversation service captures consulted sources
  -> Hono route translates to browser SSE
  -> final assistant row is persisted once
  -> done event swaps final sanitized HTML into the pending answer
```

### Failure Modes

- A provider stream emits text then ends in `tool_use`.
  - Expected: no answer-body text is emitted from that turn.
- A provider stream emits final text after several tool turns.
  - Expected: final text appears as answer prose, then `done.html` replaces it.
- Tool result contains source labels but no final answer arrives.
  - Expected: error row persists, footer stays hidden or reflects only completed
    successful source use according to the existing contract.
- LangGraph emits tokens from a non-final node.
  - Expected: tokens are ignored for browser prose and recorded only in trace.
- LangGraph emits duplicate tool events through multiple stream modes.
  - Expected: adapter de-duplicates by tool call id.
- SSE disconnects mid-run.
  - Expected in this project: current reliability policy still applies. Durable
    resume is a later project unless this work explicitly adds event-log replay.

### Test Plan

Unit tests:

- `runAgentLoop` does not emit `text` for a response that ends in `tool_use`.
- Final no-tool model text still emits answer text.
- Buffered tool-planning text is discarded or converted only to safe progress.
- `tool_call` and `tool_result` still emit in order.
- Consulted source capture still stores successful tool labels.
- Structured artifact events are never emitted as answer prose.

Conversation tests:

- Browser SSE never receives `text-delta` for "Let me search" scratch text.
- Browser SSE can receive user-safe progress rows without appending them to
  `.squire-answer__content`.
- Browser SSE can receive structured artifacts through a sanitized non-text-delta
  path.
- Existing `done.html` final replacement still renders sanitized markdown.
- Error path still persists one failure row and emits exactly one terminal event.

Web UI tests:

- Tool/progress rows appear as metadata, not answer prose.
- Skeleton clears only when answer prose begins or final HTML arrives.
- The input dock remains disabled during one active stream and re-enabled after
  `done` or `error`.

Eval tests:

- Add or reuse a scenario traversal case similar to "what is the text of the
  section that unlocks scenario 61?"
- Add a stream-hygiene assertion: no final answer stream may include phrases
  like "Let me search", "I found", or raw tool-result framing before the final
  answer node.
- Compare current runner and LangGraph runner on trajectory and final answer.

Manual QA:

- Run the scenario-61 unlock prompt locally in the browser.
- Verify the live stream shows compact lookup status, then clean answer text.
- Verify the final transcript reload matches the completed streamed answer.

### Performance

The current-stack fix should not add another model call. Buffering may delay the
first visible answer token until the first final-answer response is identified,
which is acceptable because it removes misleading text.

The LangGraph runner must report:

- time to first user-visible event
- time to first final-answer token
- total latency
- model calls
- tool calls
- token usage
- cost estimate when available

### Implementation Tasks

1. Add regression coverage for scratch-text leakage in the current runner.
2. Change the current Claude streaming path so text from tool-use responses is
   not emitted as answer prose.
3. Add `tool_progress` to the internal event type and browser mapper so
   user-safe status rows can appear outside answer prose.
4. Add structured artifact events for retrieved/quoted content, with browser
   sanitization and non-text-delta rendering.
5. Add stream-hygiene assertions to conversation or agent tests.
6. Add a runner selector behind `ask()` if a clean selector does not already
   exist for eval/runtime variants.
7. Implement the minimal LangGraph runner behind an eval-only flag, with an
   explicit final-answer node.
8. Map LangGraph stream modes into Squire internal events.
9. Add eval matrix rows for current vs LangGraph runner.
10. Write a comparison report and decide whether LangGraph should stay eval-only,
    ship behind a hidden flag, or be dropped.

### Worktree Parallelization

Sequential implementation is safest for the current-stack fix because it touches
`src/agent.ts`, streaming tests, and conversation tests.

The LangGraph runner can run in parallel after the internal event contract is
clear:

| Lane | Work                                              | Depends on                       |
| ---- | ------------------------------------------------- | -------------------------------- |
| A    | Current runner stream gating and regression tests | None                             |
| B    | Browser-visible progress rows                     | Internal event contract from A   |
| C    | Structured artifact events                        | Internal event contract from A   |
| D    | LangGraph runner adapter and eval rows            | Internal event contract from A-C |

## Linear Scope Boundary

The current issue split is:

- SQR-222: fix current-runner scratch-text leakage.
- SQR-223: lock the stream-hygiene event contract in tests.
- SQR-224: prototype a minimal LangGraph runner with an explicit final-answer
  node.
- SQR-236: add browser-visible agent progress rows.
- SQR-237: add structured answer artifact stream events.
- SQR-225: compare current runner and LangGraph runner against the full UX bar.
- SQR-226: make the adoption decision and update durable architecture docs.

SQR-225 and SQR-226 must stay blocked while SQR-224, SQR-236, or SQR-237 remain
unfinished. The project should not be marked complete until those UX pieces are
shipped or a later explicit decision removes them from scope.

## Acceptance Criteria

- The May 10 screenshot failure cannot reproduce in local browser QA.
- Tool-planning text never appears in `.squire-answer__content`.
- Final answer text still streams when the model is actually answering.
- `done.html` remains the authoritative final rendered answer.
- Existing consulted-source footer behavior is preserved.
- LangGraph runner is available for eval comparison but not production default.
- The LangGraph runner has an explicit final-answer node, and only that node's
  message stream can become answer body text.
- Browser-visible progress rows render for safe tool/custom events without
  becoming answer prose.
- Structured artifacts can carry retrieved/quoted content without using
  `text-delta`.
- Eval report clearly states whether LangGraph improves stream hygiene, answer
  quality, trace clarity, latency, and implementation clarity.

## Open Questions

- Should the current-stack fix discard scratch text entirely, or convert a small
  allowlisted subset into progress labels?
- Should the LangGraph runner use the current legacy tool surface first, or the
  redesigned self-describing tool contract first?
- Should stream-hygiene evals be hard failures in CI, or report-only while the
  runner is experimental?

## Decision Record

- Use Squire-owned app, auth, conversation, and data state.
- Use LangGraph only behind `ask()` for the practical path.
- Treat browser-visible progress rows and structured artifact events as required
  project scope, not optional polish.
- Require the LangGraph prototype to include an explicit final-answer node.
- Keep Deep Agents out of the practical-path implementation unless a later eval
  task needs it as a comparison runner.
- Keep this project outside phase initiatives.
- Promote durable decisions from this plan into ADRs after implementation.
