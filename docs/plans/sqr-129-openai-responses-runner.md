# SQR-129 OpenAI Responses Eval Runner

Generated on 2026-05-01 for SQR-129.

## Scope

SQR-129 adds an eval-only OpenAI Responses runner. It does not change
production `/api/ask`, REST, MCP, web behavior, or Anthropic runner internals.

The runner lives in `eval/openai-runner.ts` and consumes:

- provider/model config from `eval/cli.ts` (`openai:gpt-5.5`)
- strict function schemas from `eval/openai-schema.ts`
- Squire tool execution through `executeOpenAiToolCall`
- SQR-127 trace payloads through `eval/trace.ts`

## Stateless Responses Loop

The runner uses the manual stateless Responses flow verified in SQR-123:

1. Send the user eval question, strict Squire tool schemas, `store: false`, and
   `parallel_tool_calls: false`.
2. Preserve every provider-native `response.output` item, including reasoning
   and `function_call` items.
3. Execute each `function_call` through the Squire OpenAI tool wrapper.
4. Append the original provider-native output items plus
   `function_call_output` items into the next request `input`.
5. Repeat until the model returns a final message or the loop limit is reached.

The runner never sends `previous_response_id`. This keeps eval behavior
independent of hosted response retention and preserves all continuation state in
the trace artifact.

## Trace Shape

Each run returns an `EvalTraceInput` object with:

- provider request objects for every model turn
- provider response objects for every model turn
- provider-native transcript turns containing output items and function outputs
- one tool span input per Squire tool call
- one tool span output per Squire tool result
- normalized failure class, stop reason, token usage, and loop count

`runOpenAiResponsesEvalCase` can also write the trace through the SQR-127
Langfuse ingestion client when one is provided. The local report path mirrors
the same trace object for selected-case smoke runs.

## Failure Classes

OpenAI runner failures are normalized into:

- `model_access` for missing API key, unavailable model, auth, or not-found
  responses
- `api_status` for non-access API errors and failed/cancelled Responses states
- `schema` for malformed function-call arguments or unsafe argument shapes
- `tool_execution` for Squire tool errors
- `timeout` for aborted or timed-out provider calls
- `answer_quality` for completed provider turns that contain no final text
- `loop_limit` when the model keeps requesting tools until the configured limit

## CLI Behavior

OpenAI evals currently require `--local-report` so selected-case runs can write
the complete trace artifact without depending on the future matrix runner. Full
Langfuse matrix wiring remains owned by SQR-131.
