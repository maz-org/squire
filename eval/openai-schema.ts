import { createHash } from 'node:crypto';
import { ALL_AGENT_TOOLS, executeToolCall, type AgentToolName } from '../src/agent.ts';
import type { ToolCallResult } from '../src/agent.ts';

export const OPENAI_TOOL_SCHEMA_VERSION = 'squire-openai-tools-v1';

type JsonSchema = Record<string, unknown>;

interface AgentToolLike {
  name: string;
  description?: string;
  input_schema: JsonSchema;
}

export interface OpenAiStrictFunctionTool {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: JsonSchema;
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'description',
  'minimum',
  'maximum',
  'default',
  'additionalProperties',
]);

function clonePlainObject(value: JsonSchema): JsonSchema {
  return JSON.parse(JSON.stringify(value)) as JsonSchema;
}

function schemaTypeIncludes(type: unknown, expected: string): boolean {
  return type === expected || (Array.isArray(type) && type.includes(expected));
}

function withNullType(type: unknown): string | string[] {
  if (Array.isArray(type)) {
    return type.includes('null') ? type : [...type, 'null'];
  }
  if (typeof type === 'string') return [type, 'null'];
  throw new Error('Cannot make schema nullable without a string type.');
}

function assertSupportedKeywords(schema: JsonSchema, path: string): void {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      throw new Error(`Unsupported OpenAI tool schema keyword "${key}" at ${path}.`);
    }
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    throw new Error(`Unsupported OpenAI tool schema additionalProperties at ${path}.`);
  }
}

function strictifySchema(schema: JsonSchema, requiredByParent: boolean, path: string): JsonSchema {
  assertSupportedKeywords(schema, path);

  const out: JsonSchema = {};
  const type = schema.type;
  if (type !== undefined) {
    out.type = requiredByParent ? type : withNullType(type);
  }
  if (schema.description !== undefined) out.description = schema.description;
  if (Array.isArray(schema.enum)) {
    out.enum =
      requiredByParent || schema.enum.includes(null) ? schema.enum : [...schema.enum, null];
  }
  if (schema.minimum !== undefined) out.minimum = schema.minimum;
  if (schema.maximum !== undefined) out.maximum = schema.maximum;

  if (schemaTypeIncludes(type, 'array')) {
    if (!schema.items || typeof schema.items !== 'object' || Array.isArray(schema.items)) {
      throw new Error(`Array schema at ${path} must define object items.`);
    }
    out.items = strictifySchema(schema.items as JsonSchema, true, `${path}.items`);
  }

  if (schemaTypeIncludes(type, 'object')) {
    const properties =
      schema.properties &&
      typeof schema.properties === 'object' &&
      !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, JsonSchema>)
        : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === 'string')
      : [];
    const requiredSet = new Set(required);
    const propertyNames = Object.keys(properties);
    const strictProperties: Record<string, JsonSchema> = {};
    for (const [name, propertySchema] of Object.entries(properties)) {
      strictProperties[name] = strictifySchema(
        propertySchema,
        requiredSet.has(name),
        `${path}.properties.${name}`,
      );
    }
    out.properties = strictProperties;
    out.required = propertyNames;
    out.additionalProperties = false;
  }

  if (out.type === undefined) {
    throw new Error(`OpenAI tool schema at ${path} must define a type.`);
  }

  return out;
}

export function renderOpenAiStrictToolSchemas(
  tools: readonly AgentToolLike[] = ALL_AGENT_TOOLS,
): OpenAiStrictFunctionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description ?? '',
    strict: true,
    parameters: strictifySchema(
      clonePlainObject(tool.input_schema),
      true,
      `${tool.name}.parameters`,
    ),
  }));
}

export function getOpenAiToolSchemaHash(tools: readonly AgentToolLike[] = ALL_AGENT_TOOLS): string {
  return createHash('sha256')
    .update(JSON.stringify(renderOpenAiStrictToolSchemas(tools)))
    .digest('hex');
}

export function normalizeOpenAiToolInput(
  _name: AgentToolName | string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null) normalized[key] = value;
  }
  return normalized;
}

export async function executeOpenAiToolCall(
  name: AgentToolName | string,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  return executeToolCall(name, normalizeOpenAiToolInput(name, input));
}
