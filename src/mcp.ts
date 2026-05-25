/**
 * Squire MCP server.
 * Registers atomic tools from tools.ts as MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import {
  searchKnowledge,
  inspectSources,
  getSchema,
  resolveEntity,
  openEntity,
  neighbors,
} from './tools.ts';
import { BOOK_REFERENCE_TYPES } from './scenario-section-schemas.ts';

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
        'Discover available game knowledge sources, entity kinds, relation kinds, and live record counts before choosing a lookup tool.',
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
