import { describe, expect, it, vi } from 'vitest';

import { AGENT_TOOLS, ALL_AGENT_TOOLS, LEGACY_AGENT_TOOLS, executeToolCall } from '../src/agent.ts';
import { listCards, searchCards } from '../src/tools.ts';
import {
  OPENAI_TOOL_SCHEMA_VERSION,
  executeOpenAiToolCall,
  getOpenAiToolSchemaHash,
  normalizeOpenAiToolInput,
  openAiToolsForSurface,
  renderOpenAiStrictToolSchemas,
} from '../eval/openai-schema.ts';

vi.mock('../src/tools.ts', () => ({
  searchRules: vi.fn(),
  searchCards: vi.fn(),
  searchKnowledge: vi.fn(),
  listCardTypes: vi.fn(),
  listCards: vi.fn(),
  getCard: vi.fn(),
  inspectSources: vi.fn(),
  getSchema: vi.fn(),
  resolveEntity: vi.fn(),
  openEntity: vi.fn(),
  findScenario: vi.fn(),
  getScenario: vi.fn(),
  getSection: vi.fn(),
  followLinks: vi.fn(),
  neighbors: vi.fn(),
}));

function walkSchema(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walkSchema(item, visit);
    return;
  }

  const node = value as Record<string, unknown>;
  visit(node);
  for (const child of Object.values(node)) walkSchema(child, visit);
}

describe('OpenAI strict tool schema renderer', () => {
  it('renders every Squire agent tool as an OpenAI strict function tool', () => {
    const schemas = renderOpenAiStrictToolSchemas();

    expect(schemas.map((tool) => tool.name)).toEqual(ALL_AGENT_TOOLS.map((tool) => tool.name));
    for (const schema of schemas) {
      expect(schema).toMatchObject({
        type: 'function',
        strict: true,
        description: expect.any(String),
      });
      expect(schema.parameters).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
    }
  });

  it('removes defaults and marks every object schema as closed', () => {
    const schemas = renderOpenAiStrictToolSchemas();

    for (const schema of schemas) {
      walkSchema(schema.parameters, (node) => {
        expect(node).not.toHaveProperty('default');
        if (node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'))) {
          expect(node.additionalProperties).toBe(false);
        }
      });
    }
  });

  it('converts optional inputs to required nullable fields', () => {
    const byName = Object.fromEntries(
      renderOpenAiStrictToolSchemas().map((schema) => [schema.name, schema.parameters]),
    ) as Record<
      string,
      {
        required: string[];
        properties: Record<
          string,
          {
            type?: unknown;
            enum?: unknown[];
            required?: string[];
            additionalProperties?: unknown;
            properties?: Record<string, { type?: unknown }>;
          }
        >;
      }
    >;

    expect(byName.search_rules.required).toEqual(['query', 'topK']);
    expect(byName.search_rules.properties.topK.type).toEqual(['integer', 'null']);
    expect(byName.search_cards.required).toEqual(['query', 'topK']);
    expect(byName.search_knowledge.required).toEqual(['query', 'scope', 'limit']);
    expect(byName.resolve_entity.required).toEqual(['query', 'kinds', 'limit']);
    expect(byName.neighbors.required).toEqual(['ref', 'relation', 'limit']);
    expect(byName.neighbors.properties.relation.enum).toContain(null);
    expect(byName.list_cards.required).toEqual(['type', 'filter']);
    expect(byName.list_cards.properties.filter.type).toEqual(['object', 'null']);
    expect(byName.list_cards.properties.filter.additionalProperties).toBe(false);
    expect(byName.list_cards.properties.filter.required).toEqual(
      expect.arrayContaining(['cost', 'level', 'name', 'sourceId']),
    );
    expect(byName.list_cards.properties.filter.properties?.name.type).toEqual([
      'string',
      'number',
      'boolean',
      'null',
    ]);
    expect(byName.follow_links.required).toEqual(['fromKind', 'fromRef', 'linkType']);
    expect(byName.follow_links.properties.linkType.enum).toContain(null);
  });

  it('normalizes null optional inputs back to executeToolCall defaults', () => {
    expect(
      normalizeOpenAiToolInput('search_rules', {
        query: 'loot',
        topK: null,
      }),
    ).toEqual({ query: 'loot' });

    expect(
      normalizeOpenAiToolInput('list_cards', {
        type: 'items',
        filter: null,
      }),
    ).toEqual({ type: 'items' });

    expect(
      normalizeOpenAiToolInput('list_cards', {
        type: 'items',
        filter: {
          cost: null,
          level: null,
          name: 'Spyglass',
          sourceId: null,
        },
      }),
    ).toEqual({
      type: 'items',
      filter: {
        name: 'Spyglass',
      },
    });

    expect(
      normalizeOpenAiToolInput('list_cards', {
        type: 'items',
        filter: {
          cost: null,
          level: null,
          name: null,
          sourceId: null,
        },
      }),
    ).toEqual({ type: 'items' });

    expect(
      normalizeOpenAiToolInput('neighbors', {
        ref: 'scenario:frosthaven/061',
        relation: null,
        limit: null,
      }),
    ).toEqual({ ref: 'scenario:frosthaven/061' });

    expect(normalizeOpenAiToolInput('list_card_types', {})).toEqual({});
  });

  it('preserves non-null values while normalizing OpenAI tool inputs', () => {
    expect(
      normalizeOpenAiToolInput('search_knowledge', {
        query: 'loot',
        scope: ['rules_passage'],
        limit: 3,
      }),
    ).toEqual({
      query: 'loot',
      scope: ['rules_passage'],
      limit: 3,
    });
  });

  it('executes through executeToolCall after normalizing nullable optional fields', async () => {
    vi.mocked(searchCards).mockResolvedValueOnce([]);

    const result = await executeOpenAiToolCall('search_cards', {
      query: 'boots',
      topK: null,
    });

    expect(result.content).toContain('[]');
    expect(searchCards).toHaveBeenCalledWith('boots', 6);
  });

  it('normalizes closed list_cards filter placeholders before executing', async () => {
    vi.mocked(listCards).mockResolvedValueOnce([]);

    const result = await executeOpenAiToolCall('list_cards', {
      type: 'items',
      filter: {
        cost: null,
        level: null,
        name: 'Spyglass',
        sourceId: null,
      },
    });

    expect(result.content).toContain('[]');
    expect(listCards).toHaveBeenCalledWith('items', { name: 'Spyglass' });
  });

  it('rejects future tools that use unsupported schema keywords', () => {
    const unsafeTool = {
      name: 'unsafe_future_tool',
      description: 'Unsupported schema shape',
      input_schema: {
        type: 'object',
        properties: {
          value: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
        },
      },
    };

    expect(() => renderOpenAiStrictToolSchemas([...ALL_AGENT_TOOLS, unsafeTool])).toThrow(
      /Unsupported OpenAI tool schema keyword "oneOf"/,
    );
  });

  it('rejects future tools that require open-ended object properties', () => {
    const unsafeTool = {
      name: 'unsafe_future_tool',
      description: 'Unsupported map shape',
      input_schema: {
        type: 'object',
        properties: {
          value: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
      },
    };

    expect(() => renderOpenAiStrictToolSchemas([...ALL_AGENT_TOOLS, unsafeTool])).toThrow(
      /Unsupported OpenAI tool schema additionalProperties/,
    );
  });

  it('does not mutate the Anthropic production tool definitions', () => {
    const before = JSON.parse(JSON.stringify(ALL_AGENT_TOOLS));

    renderOpenAiStrictToolSchemas();

    expect(ALL_AGENT_TOOLS).toEqual(before);
  });

  it('exports a stable schema version and content hash for trace metadata', () => {
    expect(OPENAI_TOOL_SCHEMA_VERSION).toBe('squire-openai-tools-v2');
    expect(getOpenAiToolSchemaHash()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('selects OpenAI tool schemas by eval surface', () => {
    expect(openAiToolsForSurface('redesigned')).toBe(AGENT_TOOLS);
    expect(openAiToolsForSurface('legacy')).toBe(LEGACY_AGENT_TOOLS);
    expect(getOpenAiToolSchemaHash(openAiToolsForSurface('redesigned'))).not.toBe(
      getOpenAiToolSchemaHash(openAiToolsForSurface('legacy')),
    );
  });

  it('keeps executeToolCall import available for type-level integration', () => {
    expect(executeToolCall).toBeTypeOf('function');
  });
});
