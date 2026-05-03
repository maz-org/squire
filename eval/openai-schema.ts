import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AGENT_TOOLS,
  ALL_AGENT_TOOLS,
  LEGACY_AGENT_TOOLS,
  executeToolCall,
  type AgentToolName,
  type AgentToolSurface,
} from '../src/agent.ts';
import type { ToolCallResult } from '../src/agent.ts';
import { SCHEMAS } from '../src/schemas.ts';

export const OPENAI_TOOL_SCHEMA_VERSION = 'squire-openai-tools-v2';

type JsonSchema = Record<string, unknown>;

export interface AgentToolLike {
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

function objectProperties(schema: JsonSchema): Record<string, JsonSchema> | undefined {
  return schema.properties &&
    typeof schema.properties === 'object' &&
    !Array.isArray(schema.properties)
    ? (schema.properties as Record<string, JsonSchema>)
    : undefined;
}

function cardFilterPropertyNames(): string[] {
  const names = new Set<string>();
  for (const schema of Object.values(SCHEMAS)) {
    const jsonSchema = z.toJSONSchema(schema) as JsonSchema;
    const properties = objectProperties(jsonSchema);
    if (!properties) continue;
    for (const name of Object.keys(properties)) names.add(name);
  }
  return [...names].sort();
}

function buildListCardsFilterSchema(description: unknown): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const name of cardFilterPropertyNames()) {
    properties[name] = {
      type: ['string', 'number', 'boolean', 'null'],
      description: `Exact-match value for the ${name} field, or null when unused.`,
    };
  }

  return {
    type: 'object',
    description:
      typeof description === 'string'
        ? description
        : 'Exact-match primitive filters for known card fields.',
    properties,
    required: [],
    additionalProperties: false,
  };
}

function normalizedInputSchema(tool: AgentToolLike): JsonSchema {
  const schema = clonePlainObject(tool.input_schema);
  if (tool.name !== 'list_cards') return schema;

  const properties = objectProperties(schema);
  const filterSchema = properties?.filter;
  if (
    !properties ||
    !filterSchema ||
    typeof filterSchema !== 'object' ||
    Array.isArray(filterSchema)
  ) {
    return schema;
  }

  properties.filter = buildListCardsFilterSchema((filterSchema as JsonSchema).description);
  return schema;
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
    parameters: strictifySchema(normalizedInputSchema(tool), true, `${tool.name}.parameters`),
  }));
}

export function openAiToolsForSurface(toolSurface: AgentToolSurface): readonly AgentToolLike[] {
  return toolSurface === 'legacy' ? LEGACY_AGENT_TOOLS : AGENT_TOOLS;
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
  return (stripNullValues(input) as Record<string, unknown> | undefined) ?? {};
}

function stripNullValues(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) {
    return value.map(stripNullValues).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedChild = stripNullValues(child);
    if (normalizedChild !== undefined) normalized[key] = normalizedChild;
  }
  if (Object.keys(normalized).length === 0) return undefined;
  return normalized;
}

export async function executeOpenAiToolCall(
  name: AgentToolName | string,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  return executeToolCall(name, normalizeOpenAiToolInput(name, input));
}
