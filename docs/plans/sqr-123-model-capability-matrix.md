# SQR-123 Model Capability Matrix

Generated on 2026-05-01 for SQR-123.

This file records account-visible provider capability checks for the
multi-provider eval project. It is a phase-0 gate for `SQR-124`, `SQR-125`,
and `SQR-126`.

## Summary

| Provider  | Model               | Live account status             | Decision                               |
| --------- | ------------------- | ------------------------------- | -------------------------------------- |
| Anthropic | `claude-sonnet-4-6` | Verified with live API requests | Use for the Anthropic Sonnet eval lane |
| Anthropic | `claude-opus-4-7`   | Verified with live API requests | Use for the Anthropic Opus eval lane   |
| OpenAI    | `gpt-5.5`           | Verified with live API requests | Use for the OpenAI eval lane           |

## Probe Inputs

- Anthropic credentials were loaded from `/Users/bcm/Projects/maz/squire/.env`.
- OpenAI credentials were loaded from `/Users/bcm/Projects/maz/squire/.env`.
- Langfuse credentials are present in `/Users/bcm/Projects/maz/squire/.env`, but
  this issue only verifies provider model access.

No secrets or raw API keys are recorded here.

## Anthropic Account Verification

Live probes ran against the Anthropic API on 2026-05-01 using:

- `GET /v1/models?limit=100`
- `POST /v1/messages`
- `POST /v1/messages` with `stream: true`
- `POST /v1/messages` with a minimal `ping` tool

### Anthropic Models API

The account-visible Models API returned both target model IDs:

| Model ID            | Display name      | Created at | Max input tokens | Max output tokens | Batch | Structured outputs | Effort controls        | Thinking             |
| ------------------- | ----------------- | ---------- | ---------------- | ----------------- | ----- | ------------------ | ---------------------- | -------------------- |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 2026-02-17 | 1,000,000        | 128,000           | yes   | yes                | low, medium, high, max | enabled and adaptive |
| `claude-opus-4-7`   | Claude Opus 4.7   | 2026-04-14 | 1,000,000        | 128,000           | yes   | yes                | low, medium, high, max | adaptive             |

The Models API also reported image input, PDF input, citations, code execution,
and context management support for both target models.

### Anthropic Messages Endpoint

| Model ID            | Basic message                                                         | Streaming                                                       | Tool use                                                                                | Rate limit headers seen                  |
| ------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------- |
| `claude-sonnet-4-6` | HTTP 200, model echoed as `claude-sonnet-4-6`, `stop_reason=end_turn` | HTTP 200, server-sent event stream started with `message_start` | HTTP 200, forced `ping` call returned `{"marker":"sqr-123"}` and `stop_reason=tool_use` | requests limit 1000, tokens limit 540000 |
| `claude-opus-4-7`   | HTTP 200, model echoed as `claude-opus-4-7`, `stop_reason=end_turn`   | HTTP 200, server-sent event stream started with `message_start` | HTTP 200, forced `ping` call returned `{"marker":"sqr-123"}` and `stop_reason=tool_use` | requests limit 1000, tokens limit 540000 |

The tool probes prove basic tool-call support. They do not prove the future
Squire tool schemas are valid for every provider. `SQR-126` still owns strict
OpenAI schema rendering and cross-tool schema tests.

## OpenAI Account Verification

Live probes ran against the OpenAI API on 2026-05-01 using:

- `GET /v1/models`
- `GET /v1/models/gpt-5.5`
- `POST /v1/responses`
- `POST /v1/responses` with `stream: true`
- `POST /v1/responses` with a strict function tool
- `POST /v1/responses` with manual output-item replay and no
  `previous_response_id`
- `POST /v1/responses` with `background: true`
- `GET /v1/responses/{id}` for the background response
- `GET /v1/batches?limit=1`

### OpenAI Models API

The account-visible Models API returned the target model alias and dated
snapshot:

| Model alias | Resolved response model | Model object | Created    | Notes                         |
| ----------- | ----------------------- | ------------ | ---------- | ----------------------------- |
| `gpt-5.5`   | `gpt-5.5-2026-04-23`    | `gpt-5.5`    | 2026-04-22 | Model is present and callable |

The OpenAI model object exposed `id`, `object`, `created`, and `owned_by`. It
did not expose exact context-window or max-output-token fields. The Responses
API accepted a validation probe with `max_output_tokens: 1000000`, but this
only proves the request was accepted; it is not a reliable published max-output
limit.

### OpenAI Responses Endpoint

| Requirement                    | Status                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live `gpt-5.5` request         | HTTP 200, resolved to `gpt-5.5-2026-04-23`, `status=completed`                                                                                                           |
| Responses endpoint support     | HTTP 200 with output item type `message`                                                                                                                                 |
| Streaming support              | HTTP 200 server-sent event stream with `response.created`, `response.in_progress`, `response.output_item.added`, and `response.output_text.delta` events                 |
| Function/tool calling behavior | HTTP 200 with output item type `function_call`                                                                                                                           |
| Strict schema support          | Strict tool with `additionalProperties: false` returned arguments `{"marker":"sqr-123"}`                                                                                 |
| Stateless tool continuation    | HTTP 200 when replaying the returned `function_call` item plus a `function_call_output`, with no `previous_response_id`                                                  |
| Provider-native response items | Response output preserves `message` and `function_call` items; stream metadata includes `phase` on assistant message items                                               |
| Max output limit               | Exact published limit not exposed by `/v1/models/gpt-5.5`; `max_output_tokens: 1000000` was accepted but should not be treated as a contract                             |
| Context limit                  | Exact published limit not exposed by `/v1/models/gpt-5.5`                                                                                                                |
| Reasoning controls             | `reasoning.effort=none` works; invalid-value response says supported values are `none`, `low`, `medium`, `high`, and `xhigh`; official guidance says default is `medium` |
| Background support             | HTTP 200 with `background: true`; later retrieval returned `status=completed`                                                                                            |
| Batch endpoint access          | `GET /v1/batches?limit=1` returned HTTP 200 and `object=list`; no batch job was submitted                                                                                |
| Account-visible rate limits    | Responses headers showed requests limit 500 and tokens limit 500000                                                                                                      |

OpenAI-dependent downstream work can start, with one constraint: do not build
logic that assumes an exact OpenAI context or max-output limit from the Models
API. Keep those values configurable until a published limit is confirmed by
OpenAI docs or a stable account-visible metadata field.

## Kill Criteria

The OpenAI eval lane remains viable while all of the following stay true:

- The account can make a successful request to `gpt-5.5`.
- The Responses API supports stateless tool continuation for the account.
- Function calling accepts the strict JSON schemas needed by Squire tools.
- The response preserves provider-native items needed for replay and Langfuse
  trace diffing.
- Rate limits remain high enough to run at least one selected eval case across
  the model matrix without special scheduling.

If `gpt-5.5` becomes unavailable, do not guess a fallback from provider docs.
Pick a fallback only after a live OpenAI Models or Responses probe proves that
the fallback model supports Responses, tools, strict schemas, reasoning
controls, and the output/context limits needed for the eval.

## Downstream Instructions

- `SQR-124`: may build Anthropic provider/model parsing for
  `claude-sonnet-4-6`, `claude-opus-4-7`, and OpenAI provider/model parsing for
  `gpt-5.5`.
- `SQR-125`: may design trace fields for provider/model metadata, token usage,
  latency, rate-limit metadata, provider-native output items, background status,
  reasoning effort, and failure classification.
- `SQR-126`: may build the OpenAI strict schema renderer against the Responses
  strict function-tool shape verified here.
- `SQR-129`: may build the OpenAI runner as a stateless Responses loop that
  replays provider-native output items plus `function_call_output` items rather
  than depending on `previous_response_id`.

## Sources

- Live Anthropic API probes run from this branch on 2026-05-01.
- Anthropic Models API response, which exposed model IDs, limits, and capability
  fields for the account.
- Anthropic models overview page checked on 2026-05-01 in gstack browse:
  <https://docs.anthropic.com/en/docs/about-claude/models/overview>
- Live OpenAI API probes run from this branch on 2026-05-01.
- OpenAI latest GPT-5.5 guide checked on 2026-05-01 in gstack browse:
  <https://developers.openai.com/api/docs/guides/latest-model.md>
