# SQR-126 OpenAI Strict Tool Schema

Generated on 2026-05-01 for SQR-126.

## Scope

This issue adds an eval-only renderer for Squire's existing agent tools. It does
not implement the OpenAI Responses loop and does not change Anthropic production
tool definitions.

## Contract

The renderer lives in `eval/openai-schema.ts` and uses `ALL_AGENT_TOOLS` from
`src/agent.ts` as its source of truth.

Each emitted tool has:

- `type: "function"`
- the existing tool `name`
- the existing tool `description`
- `strict: true`
- `parameters` as a closed JSON schema

Every object schema is emitted with `additionalProperties: false`. Unsupported
future JSON Schema keywords throw during rendering instead of producing a
schema that may fail later inside OpenAI.

## Nullable Inputs

OpenAI strict tools require every property to be listed in `required`, so
optional Anthropic fields are emitted as nullable required fields. Current
fields using this rule include:

- `kinds`
- `limit`
- `scope`
- `relation`
- `topK`
- `filter`
- `linkType`

`normalizeOpenAiToolInput` removes `null` values before the tool call reaches
`executeToolCall`, preserving the current default behavior in `src/agent.ts`.

## Trace Metadata

Downstream trace work can record:

- `OPENAI_TOOL_SCHEMA_VERSION`
- `getOpenAiToolSchemaHash()`

The current version is `squire-openai-tools-v1`. The hash is a SHA-256 digest
of the rendered strict tool list.
