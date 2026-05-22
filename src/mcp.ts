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
  searchKnowledge,
  listCardTypes,
  listCards,
  getCard,
  inspectSources,
  getSchema,
  resolveEntity,
  openEntity,
  findScenario,
  getScenario,
  getSection,
  followLinks,
  neighbors,
} from './tools.ts';
import { CARD_TYPES, type CardType } from './schemas.ts';
import {
  BOOK_RECORD_KINDS,
  BOOK_REFERENCE_TYPES,
  type BookRecordKind,
} from './scenario-section-schemas.ts';

const gameSchema = z
  .string()
  .optional()
  .describe('Active game id or alias, such as "frosthaven" or "gh2"');

function gameOpts(game?: string): { game: string } | undefined {
  return game === undefined ? undefined : { game };
}

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
      inputSchema: {
        game: gameSchema,
      },
    },
    async ({ game }) => {
      const opts = gameOpts(game);
      const result = opts ? await inspectSources(opts) : await inspectSources();
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
        game: gameSchema,
      },
    },
    async ({ query, kinds, limit, game }) => {
      const result = await resolveEntity(query, { kinds, limit, ...gameOpts(game) });
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
        game: gameSchema,
      },
    },
    async ({ query, topK, game }) => {
      const opts = gameOpts(game);
      const results = opts ? await searchRules(query, topK, opts) : await searchRules(query, topK);
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
        game: gameSchema,
      },
    },
    async ({ query, topK, game }) => {
      const opts = gameOpts(game);
      const results = opts ? await searchCards(query, topK, opts) : await searchCards(query, topK);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    },
  );

  // ─── list_card_types ───────────────────────────────────────────────────────

  server.registerTool(
    'list_card_types',
    {
      description: 'List all available card types with record counts.',
      inputSchema: {
        game: gameSchema,
      },
    },
    async ({ game }) => {
      const opts = gameOpts(game);
      const types = opts ? await listCardTypes(opts) : await listCardTypes();
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
        game: gameSchema,
      },
    },
    async ({ type, filter, game }) => {
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
      const opts = gameOpts(game);
      const cards = opts
        ? await listCards(type as CardType, parsed, opts)
        : await listCards(type as CardType, parsed);
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
        game: gameSchema,
      },
    },
    async ({ type, id, game }) => {
      const opts = gameOpts(game);
      const card = opts
        ? await getCard(type as CardType, id, opts)
        : await getCard(type as CardType, id);
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
        game: gameSchema,
      },
    },
    async ({ query, game }) => {
      const opts = gameOpts(game);
      const scenarios = opts ? await findScenario(query, opts) : await findScenario(query);
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
        game: gameSchema,
      },
    },
    async ({ ref, game }) => {
      const opts = gameOpts(game);
      const scenario = opts ? await getScenario(ref, opts) : await getScenario(ref);
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
        game: gameSchema,
      },
    },
    async ({ ref, game }) => {
      const opts = gameOpts(game);
      const section = opts ? await getSection(ref, opts) : await getSection(ref);
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
        game: gameSchema,
      },
    },
    async ({ fromKind, fromRef, linkType, game }) => {
      const opts = gameOpts(game);
      const links = opts
        ? await followLinks(fromKind as BookRecordKind, fromRef, linkType, opts)
        : await followLinks(fromKind as BookRecordKind, fromRef, linkType);
      return { content: [{ type: 'text', text: JSON.stringify(links, null, 2) }] };
    },
  );

  server.registerTool(
    'open_entity',
    {
      description:
        'Open one exact Squire entity by canonical ref: rules passage, scenario, section, or card.',
      inputSchema: {
        ref: z.string().describe('Canonical inspectable ref'),
        game: gameSchema,
      },
    },
    async ({ ref, game }) => {
      const opts = gameOpts(game);
      const result = opts ? await openEntity(ref, opts) : await openEntity(ref);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  server.registerTool(
    'search_knowledge',
    {
      description: 'Search rules passages, scenarios, sections, and cards with openable refs.',
      inputSchema: {
        query: z.string().describe('Search query'),
        scope: z
          .array(z.enum(['rules_passage', 'scenario', 'section', 'card']))
          .optional()
          .describe('Optional searchable kind filter'),
        limit: z.number().int().min(1).max(20).default(6).describe('Global result limit'),
        game: gameSchema,
      },
    },
    async ({ query, scope, limit, game }) => {
      const result = await searchKnowledge(query, { scope, limit, ...gameOpts(game) });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  server.registerTool(
    'neighbors',
    {
      description: 'Traverse known outgoing relationships from a scenario or section ref.',
      inputSchema: {
        ref: z.string().describe('Canonical traversable ref'),
        relation: z.enum(BOOK_REFERENCE_TYPES).optional().describe('Optional relation filter'),
        limit: z.number().int().min(1).max(50).default(20).describe('Maximum neighbors'),
        game: gameSchema,
      },
    },
    async ({ ref, relation, limit, game }) => {
      const result = await neighbors(ref, { relation, limit, ...gameOpts(game) });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
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
