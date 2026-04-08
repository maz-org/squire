/**
 * Squire MCP server.
 * Registers atomic tools from tools.ts as MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { searchRules, searchCards, listCardTypes, listCards, getCard } from './tools.ts';
import { CARD_TYPES, type CardType } from './schemas.ts';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'squire',
    version: '0.1.0',
  });

  // ─── search_rules ──────────────────────────────────────────────────────────

  server.registerTool(
    'search_rules',
    {
      description: 'Search the Frosthaven rulebook for passages relevant to a query.',
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
      description: 'Look up a single card by type and identifier.',
      inputSchema: {
        type: z.enum(CARD_TYPES).describe('Card type'),
        id: z.string().describe('Card identifier (name, number, etc.)'),
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
