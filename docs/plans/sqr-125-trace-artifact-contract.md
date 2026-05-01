# SQR-125 Side-by-Side Trace Artifact Contract

Schema version: `sqr-125.trace-contract.v1`

This document defines the eval-only trace contract for comparing Anthropic and
OpenAI runs side by side. It is the handoff from SQR-125 to the trace writer in
SQR-127. It does not implement provider runners, OpenAI tool schema rendering,
or production `/api/ask` routing.

Langfuse is the source of truth for eval traces. Local JSON reports may mirror a
subset for quick inspection, but they must be derived from Langfuse run or trace
data.

## Langfuse Placement Legend

| Placement                    | Use                                                                  |
| ---------------------------- | -------------------------------------------------------------------- |
| `trace.metadata`             | Required filters, grouping keys, compatibility versions, statuses.   |
| `trace.input`                | Redacted eval question and stable case input.                        |
| `trace.output`               | Optional run-level result summary.                                   |
| `generation`                 | One model call, including provider, model, timing, and status.       |
| `generation.input`           | Redacted provider-normalized request sent to the model.              |
| `generation.output`          | Redacted provider-normalized model output and final answer.          |
| `generation.metadata`        | Stop reason, provider-native transcript, response IDs, raw statuses. |
| `generation.modelParameters` | Model settings: temperature, max output, reasoning, timeout.         |
| `generation.usageDetails`    | Provider token counts.                                               |
| `generation.costDetails`     | Estimated cost fields.                                               |
| `span`                       | Child observations for tool calls, judge calls, retries, exporters.  |
| `span.input`                 | Redacted tool arguments or judge input.                              |
| `span.output`                | Redacted tool results or judge output.                               |
| `span.metadata`              | Tool status, retry data, timings, errors, and source refs.           |
| `score`                      | Langfuse scores for correctness, pass/fail, and trajectory.          |
| `optional_export`            | Convenience exports only, never the authoritative trace.             |

## Required Filter Fields

These fields must be written to `trace.metadata` on every eval case trace so
Langfuse filtering and grouped reporting work without parsing nested blobs.

| Field               | Example                         | Notes                                                |
| ------------------- | ------------------------------- | ---------------------------------------------------- |
| `contractVersion`   | `sqr-125.trace-contract.v1`     | Used to reject incompatible run comparisons.         |
| `provider`          | `anthropic`, `openai`           | Provider key from eval config.                       |
| `model`             | `gpt-5.5`                       | Requested model alias or exact ID.                   |
| `resolvedModel`     | `gpt-5.5-2026-04-23`            | Provider-returned concrete model ID when available.  |
| `runLabel`          | `sqr-123-baseline`              | Human run label from CLI/config.                     |
| `datasetName`       | `frosthaven-qa`                 | Langfuse dataset name.                               |
| `caseId`            | `building-alchemist`            | Eval case ID from `eval/dataset.json`.               |
| `caseCategory`      | `card-data`                     | Eval category from `eval/dataset.json`.              |
| `promptVersion`     | `redesigned-agent-v1`           | Stable prompt contract name or semantic version.     |
| `promptHash`        | `sha256:...`                    | Hash of system prompt plus prompt wrapper.           |
| `toolSurface`       | `redesigned`                    | Existing Squire tool surface name.                   |
| `toolSchemaVersion` | `squire-agent-tools.v1`         | Stable tool schema version coordinated with SQR-126. |
| `toolSchemaHash`    | `sha256:...`                    | Hash of provider-rendered tool definitions.          |
| `statusReason`      | `completed`, `timeout`, `error` | Normalized case status for failure filtering.        |

## Required Debug Fields

Every field below must have a known Langfuse placement or be explicitly marked
as optional export data. SQR-127 should fail fast if a required field is absent.

| Field                      | Placement                    | Required | Purpose                                                     |
| -------------------------- | ---------------------------- | -------- | ----------------------------------------------------------- |
| `modelSettings`            | `generation.modelParameters` | yes      | Temperature, max output, reasoning, timeout, loop limit.    |
| `inputQuestion`            | `trace.input`                | yes      | Redacted user question for this eval case.                  |
| `providerNativeTranscript` | `generation.metadata`        | yes      | Redacted provider-native request, response, and item data.  |
| `toolCalls`                | `span`                       | yes      | One child span per Squire tool call.                        |
| `toolArguments`            | `span.input`                 | yes      | Redacted provider-emitted tool arguments.                   |
| `toolResults`              | `span.output`                | yes      | Redacted Squire tool result or summarized large result.     |
| `errors`                   | `span.metadata`              | yes      | Provider, schema, timeout, tool, judge, trace-write errors. |
| `retries`                  | `span.metadata`              | yes      | Retry count, reason, delay, and final retry status.         |
| `timings`                  | `span.metadata`              | yes      | Start, end, and duration fields for each operation.         |
| `tokenUsage`               | `generation.usageDetails`    | yes      | Input, output, reasoning, cached, and total tokens.         |
| `costEstimate`             | `generation.costDetails`     | yes      | Prompt, completion, reasoning, and total cost in USD.       |
| `stopReason`               | `generation.metadata`        | yes      | Provider stop reason, such as `tool_use` or `length`.       |
| `statusReason`             | `trace.metadata`             | yes      | Normalized run status or failure class.                     |
| `finalAnswer`              | `generation.output`          | yes      | Final answer used by eval scoring.                          |
| `judgeScores`              | `score`                      | yes      | Correctness, pass/fail, trajectory, and later eval scores.  |
| `summaryExport`            | `optional_export`            | no       | Local convenience copy for humans and CI artifacts.         |

## Provider-Native Transcript Rules

Provider-native transcript items are needed for replay and side-by-side diffing,
but they must stay eval-only.

Rules:

- Store redacted provider-native transcript data in
  `generation.metadata.providerNativeTranscript`.
- Do not write provider-native transcript items to app conversation tables,
  app messages, app SSE events, or persisted production chat history.
- Preserve provider-specific item types instead of forcing them into the Squire
  app message shape. Examples include Anthropic content blocks, OpenAI
  `message`, `function_call`, and `function_call_output` response items, and
  OpenAI background `status`.
- Keep normalized Squire tool trajectory fields next to provider-native items so
  reports can compare both "what Squire saw" and "what the provider emitted."
- If a provider-native object is too large for usable Langfuse UI display, write
  a redacted summary in `generation.metadata` and mirror the redacted full object
  in an optional export linked from the trace. The Langfuse trace remains the
  source of truth.

## Generation Shape

Each provider model call should be a Langfuse generation observation.

Minimum generation fields:

```text
name: "eval.model_call"
model: requested or resolved provider model
input: redacted provider-normalized request
output: redacted provider-normalized response plus final answer when present
modelParameters: modelSettings
usageDetails: tokenUsage
costDetails: costEstimate
metadata:
  provider
  resolvedModel
  stopReason
  statusReason
  providerNativeTranscript
  responseId or requestId when available
  backgroundStatus when available
```

SQR-123 verified that OpenAI Responses preserves provider-native `message` and
`function_call` output items and supports stateless continuation by replaying
those items plus `function_call_output`. The trace contract therefore keeps those
items intact in eval trace data.

## Tool Call Span Shape

Each Squire tool call should be a child span under the model-call generation or
the eval-case span.

Minimum tool span fields:

```text
name: "eval.tool_call.<tool_name>"
input: redacted tool arguments
output: redacted tool result or summarized oversized output
metadata:
  toolName
  toolCallId
  providerToolCallId
  callIndex
  ok
  durationMs
  startedAt
  endedAt
  sourceLabels
  canonicalRefs
  errorType
  errorMessage
```

Tool results can contain source text and future campaign state. Redaction must
happen before the span is written.

## Scores

Write item-level evaluator results as Langfuse scores:

| Score name         | Value shape     | Notes                                           |
| ------------------ | --------------- | ----------------------------------------------- |
| `correctness`      | numeric 0 to 1  | Existing final-answer judge score normalized.   |
| `pass`             | categorical     | `pass`, `fail`, or `not_applicable`.            |
| `trajectory`       | numeric 0 or 1  | Existing trajectory scorer result.              |
| `trajectory_pass`  | categorical     | `pass`, `fail`, or `not_applicable`.            |
| `failure_class`    | categorical     | `none`, `access`, `api`, `schema`, `tool`, etc. |
| `model_cost_usd`   | numeric         | Per-case estimated total cost.                  |
| `model_latency_ms` | numeric         | Per-case model-call latency.                    |
| `tool_call_count`  | numeric integer | Count of Squire tool calls.                     |
| `retry_count`      | numeric integer | Retry attempts across model, tool, trace write. |
| `loop_iterations`  | numeric integer | Provider loop iterations before final status.   |

Run summaries may aggregate these scores, but per-case scores are required.

## Redaction Rules

Redaction runs before any Langfuse write, local export write, or console report.
It must process nested objects, arrays, provider-native blobs, tool arguments,
tool results, errors, and retry metadata.

Always redact fields with these exact names or case-insensitive variants:

- `apiKey`
- `authorization`
- `bearer`
- `cookie`
- `setCookie`
- `session`
- `sessionId`
- `csrf`
- `oauth`
- `accessToken`
- `refreshToken`
- `userId`
- `userEmail`
- `campaignId`
- `characterId`
- `playerId`

Also redact string values that match obvious bearer-token or API-key patterns.
Use a fixed placeholder such as `[REDACTED]`, not a hash, because a stable hash
would still let future user or campaign identifiers be correlated across runs.

Future user or campaign state is allowed in eval traces only after redaction.
Production conversation history remains governed by the app message schema, not
this eval trace contract.

## Optional Export Fields

Optional exports are allowed for CI artifacts and local debugging, but they are
not the source of truth. They may include:

- Full redacted provider request/response JSON when too large for Langfuse UI.
- A compact side-by-side transcript diff.
- A cost summary grouped by provider and model.
- A failed-case replay bundle derived from Langfuse data.

Optional exports must include `contractVersion`, `runLabel`, `caseId`,
`provider`, `model`, `promptHash`, and `toolSchemaHash` so stale exports are easy
to reject.

## Compatibility Rules

Side-by-side reports must refuse to compare runs when any of these differ unless
the user explicitly asks for an incompatible comparison:

- `contractVersion`
- `datasetName`
- `promptHash`
- `toolSchemaHash`
- `toolSurface`

Provider/model differences are the thing being compared, so they must be
filterable but not compatibility blockers.

## Handoff To Follow-Up Issues

- SQR-124 owns CLI/config fields that feed `provider`, `model`, `runLabel`,
  `modelSettings`, and `toolSurface`.
- SQR-126 owns OpenAI strict tool schema rendering and the stable
  `toolSchemaVersion`/`toolSchemaHash` values.
- SQR-127 owns the trace writer, redaction utility, and Langfuse generation/span
  mapping that must satisfy this contract.
- SQR-128 and SQR-129 own provider runners and should emit provider-native items
  into this contract without changing production app history.
