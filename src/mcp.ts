/**
 * Squire MCP server.
 * Registers atomic tools from tools.ts as MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import {
  searchRules,
  searchCards,
  listCardTypes,
  listCards,
  getCard,
  inspectSources,
  getSchema,
  resolveEntity,
  findScenario,
  getScenario,
  getSection,
  followLinks,
} from './tools.ts';
import { CARD_TYPES, type CardType } from './schemas.ts';
import {
  BOOK_RECORD_KINDS,
  BOOK_REFERENCE_TYPES,
  type BookRecordKind,
} from './scenario-section-schemas.ts';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'squire',
    version: '0.1.0',
  });

  // ─── inspect_sources ──────────────────────────────────────────────────────

  server.registerTool(
    'inspect_sources',
    {
      description:
        'Discover available Frosthaven knowledge sources, entity kinds, relation kinds, and live record counts before choosing a lookup tool.',
    },
    async () => {
      const result = await inspectSources();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── schema ───────────────────────────────────────────────────────────────

  server.registerTool(
    'schema',
    {
      description:
        'Inspect fields, filters, ref patterns, examples, and relations for a source kind returned by inspect_sources.',
      inputSchema: {
        kind: z
          .string()
          .describe('Entity kind or common alias, such as card, item, scenario, or section'),
      },
    },
    async ({ kind }) => {
      const result = getSchema(kind);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── resolve_entity ───────────────────────────────────────────────────────

  server.registerTool(
    'resolve_entity',
    {
      description:
        'Resolve natural references like "scenario 61", "section 90.2", "Spyglass", or "Blinkblade level 4 cards" to ranked opener-ready entity refs.',
      inputSchema: {
        query: z.string().describe('Natural-language entity reference'),
        kinds: z
          .array(z.string())
          .optional()
          .describe('Optional kind filters returned by inspect_sources, plus common aliases'),
        limit: z.number().int().min(1).max(20).default(6).describe('Maximum candidates'),
      },
    },
    async ({ query, kinds, limit }) => {
      const result = await resolveEntity(query, { kinds, limit });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── search_rules ──────────────────────────────────────────────────────────

  server.registerTool(
    'search_rules',
    {
      description:
        'Search the indexed Frosthaven books (rulebook, scenario book, section book, puzzle book) for passages relevant to a query.',
      inputSchema: {
        query: z.string().describe('Search query'),
        topK: z.number().int().min(1).max(100).default(6).describe('Number of results'),
      },
    },
    async ({ query, topK }) => {
      const results = await searchRules(query, topK);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    },
  );

  // ─── search_cards ──────────────────────────────────────────────────────────

  server.registerTool(
    'search_cards',
    {
      description: 'Search extracted card data using keyword matching.',
      inputSchema: {
        query: z.string().describe('Search query'),
        topK: z.number().int().min(1).max(100).default(6).describe('Number of results'),
      },
    },
    async ({ query, topK }) => {
      const results = await searchCards(query, topK);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    },
  );

  // ─── list_card_types ───────────────────────────────────────────────────────

  server.registerTool(
    'list_card_types',
    {
      description: 'List all available card types with record counts.',
    },
    async () => {
      const types = await listCardTypes();
      return { content: [{ type: 'text', text: JSON.stringify(types, null, 2) }] };
    },
  );

  // ─── list_cards ────────────────────────────────────────────────────────────

  server.registerTool(
    'list_cards',
    {
      description: 'List cards of a given type, optionally filtered by field values.',
      inputSchema: {
        type: z.enum(CARD_TYPES).describe('Card type to list'),
        filter: z
          .string()
          .optional()
          .describe('Optional JSON filter object (AND logic), e.g. {"name":"Algox Archer"}'),
      },
    },
    async ({ type, filter }) => {
      let parsed: Record<string, unknown> | undefined;
      if (filter) {
        try {
          parsed = JSON.parse(filter) as Record<string, unknown>;
        } catch {
          return {
            content: [{ type: 'text' as const, text: 'Invalid filter JSON' }],
            isError: true,
          };
        }
      }
      const cards = await listCards(type as CardType, parsed);
      return { content: [{ type: 'text', text: JSON.stringify(cards, null, 2) }] };
    },
  );

  // ─── get_card ──────────────────────────────────────────────────────────────

  server.registerTool(
    'get_card',
    {
      description: 'Look up a single card by type and canonical sourceId.',
      inputSchema: {
        type: z.enum(CARD_TYPES).describe('Card type'),
        id: z
          .string()
          .describe(
            'Canonical sourceId (e.g. "gloomhavensecretariat:item/1"). Case-sensitive. Use list_cards or search_cards to discover sourceIds.',
          ),
      },
    },
    async ({ type, id }) => {
      const card = await getCard(type as CardType, id);
      if (!card) {
        return {
          content: [{ type: 'text', text: `Card not found: ${type}/${id}` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(card, null, 2) }] };
    },
  );

  server.registerTool(
    'find_scenario',
    {
      description:
        'Resolve a scenario query like "scenario 61" or "Life and Death" to matching scenario records.',
      inputSchema: {
        query: z.string().describe('Scenario query'),
      },
    },
    async ({ query }) => {
      const scenarios = await findScenario(query);
      return { content: [{ type: 'text', text: JSON.stringify(scenarios, null, 2) }] };
    },
  );

  server.registerTool(
    'get_scenario',
    {
      description: 'Fetch an exact scenario record by canonical scenario ref.',
      inputSchema: {
        ref: z
          .string()
          .describe(
            'Canonical scenario ref like "gloomhavensecretariat:scenario/061". Use find_scenario if you only know the number or name.',
          ),
      },
    },
    async ({ ref }) => {
      const scenario = await getScenario(ref);
      if (!scenario) {
        return {
          content: [{ type: 'text', text: `Scenario not found: ${ref}` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(scenario, null, 2) }] };
    },
  );

  server.registerTool(
    'get_section',
    {
      description: 'Fetch an exact section record by section ref like "90.2".',
      inputSchema: {
        ref: z.string().describe('Section ref like "90.2"'),
      },
    },
    async ({ ref }) => {
      const section = await getSection(ref);
      if (!section) {
        return {
          content: [{ type: 'text', text: `Section not found: ${ref}` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(section, null, 2) }] };
    },
  );

  server.registerTool(
    'follow_links',
    {
      description:
        'Follow explicit scenario/section book references from a known scenario or section.',
      inputSchema: {
        fromKind: z.enum(BOOK_RECORD_KINDS).describe('Entity kind to follow from'),
        fromRef: z.string().describe('Canonical scenario or section ref'),
        linkType: z
          .enum(BOOK_REFERENCE_TYPES)
          .optional()
          .describe('Optional link-type filter like "conclusion" or "section_link"'),
      },
    },
    async ({ fromKind, fromRef, linkType }) => {
      const links = await followLinks(fromKind as BookRecordKind, fromRef, linkType);
      return { content: [{ type: 'text', text: JSON.stringify(links, null, 2) }] };
    },
  );

  return server;
}

/**
 * Create an in-process MCP client connected to Squire's tools.
 * No HTTP round-trip, no auth — for use by the web UI conversation agent.
 */
export async function createInProcessClient(): Promise<Client> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'squire-in-process', version: '0.1.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  // Clean up server when client closes
  const originalClose = client.close.bind(client);
  client.close = async () => {
    await originalClose();
    await server.close();
  };

  return client;
}
