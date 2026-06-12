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
  lookupEntity,
  openEntity,
  neighbors,
} from './tools.ts';
import { BOOK_REFERENCE_TYPES } from './scenario-section-schemas.ts';
import { CAMPAIGN_RELATIONS } from './campaign/knowledge.ts';
import { userIdFromAuthInfo } from './campaign/identity.ts';
import * as WriteTools from './campaign/write-tools.ts';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/**
 * Campaign-state kinds need the verified token's user id (SQR-269). The
 * transport threads `authInfo` into handlers as `extra.authInfo`; client-only
 * tokens (no userId) simply see no campaign state.
 */
function identityOpts(extra: { authInfo?: AuthInfo }): { userId: string } | undefined {
  const userId = userIdFromAuthInfo(extra.authInfo);
  return userId ? { userId } : undefined;
}

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
    async ({ game }, extra) => {
      const result = await inspectSources({ ...gameOpts(game), ...identityOpts(extra) });
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
    async ({ query, kinds, limit, game }, extra) => {
      const result = await resolveEntity(query, {
        kinds,
        limit,
        ...gameOpts(game),
        ...identityOpts(extra),
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'lookup_entity',
    {
      description:
        'Resolve and open one exact natural reference in a single call. Use for direct questions about scenario, section, item, monster stat, or named card details.',
      inputSchema: {
        query: z.string().describe('Natural-language entity reference to open'),
        kinds: z
          .array(z.string())
          .optional()
          .describe('Optional kind filters returned by inspect_sources, plus common aliases'),
        limit: z.number().int().min(1).max(20).default(6).describe('Maximum candidates'),
        game: gameSchema,
      },
    },
    async ({ query, kinds, limit, game }, extra) => {
      const result = await lookupEntity(query, {
        kinds,
        limit,
        ...gameOpts(game),
        ...identityOpts(extra),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
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
    async ({ ref, game }, extra) => {
      const result = await openEntity(ref, { ...gameOpts(game), ...identityOpts(extra) });
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
        relation: z
          .enum([...BOOK_REFERENCE_TYPES, ...CAMPAIGN_RELATIONS])
          .optional()
          .describe('Optional relation filter'),
        limit: z.number().int().min(1).max(50).default(20).describe('Maximum neighbors'),
        game: gameSchema,
      },
    },
    async ({ ref, relation, limit, game }, extra) => {
      const result = await neighbors(ref, {
        relation,
        limit,
        ...gameOpts(game),
        ...identityOpts(extra),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // ─── Campaign write tools (SQR-280) ───────────────────────────────────────
  // Identity comes from the verified token only; the shared write-tools layer
  // validates input shape, consumes the write budget, and returns structured
  // errors, so every channel behaves identically. Patch/mutation shapes are
  // passed through loosely here — the boundary schema lives in write-tools.

  const writeToolResult = (result: { ok: boolean }) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  });

  server.registerTool(
    'write_campaign_state',
    {
      description:
        'Apply a non-destructive shared campaign-state update for the signed-in member: mark scenarios played or drawn, raise prosperity, record unlocks, rename. Arrays replace the whole list. Destructive changes return proposal_required; stage those with propose_state_change.',
      inputSchema: {
        campaignId: z.string().describe('Campaign UUID'),
        patch: z
          .record(z.string(), z.unknown())
          .describe(
            'Fields to set: name, prosperity, activeScenario, playedScenarios, drawnScenarios, unlockedClasses, unlockedItems, unlockedBuildings',
          ),
      },
    },
    async ({ campaignId, patch }, extra) => {
      const result = await WriteTools.writeCampaignState(identityOpts(extra)?.userId, {
        campaignId,
        patch,
      });
      return writeToolResult(result);
    },
  );

  server.registerTool(
    'write_character_state',
    {
      description:
        "Update the signed-in member's OWN character: level, XP, gold, perks, name, personal quest, battle goals, private notes. Retirement and deletion return proposal_required; stage those with propose_state_change.",
      inputSchema: {
        characterId: z.string().describe('Character UUID'),
        patch: z
          .record(z.string(), z.unknown())
          .describe(
            'Fields to set: name, className, level, xp, gold, perks, personalQuest, battleGoals, privateNotes',
          ),
      },
    },
    async ({ characterId, patch }, extra) => {
      const result = await WriteTools.writeCharacterState(identityOpts(extra)?.userId, {
        characterId,
        patch,
      });
      return writeToolResult(result);
    },
  );

  server.registerTool(
    'propose_state_change',
    {
      description:
        'Stage a DESTRUCTIVE campaign mutation as a pending proposal: campaign.delete, member.remove {memberId}, campaign.update {patch} (un-play or prosperity decrease), character.delete {characterId}, or character.retire {characterId}. Show the user exactly what changes and call confirm_state_change ONLY after they explicitly agree.',
      inputSchema: {
        campaignId: z.string().describe('Campaign UUID'),
        mutation: z
          .record(z.string(), z.unknown())
          .describe('Discriminated by "type", e.g. {"type":"campaign.update","patch":{...}}'),
        idempotencyKey: z
          .string()
          .optional()
          .describe('Optional replay guard; reuse the same key when retrying the same staging'),
      },
    },
    async ({ campaignId, mutation, idempotencyKey }, extra) => {
      const result = await WriteTools.proposeStateChange(identityOpts(extra)?.userId, {
        campaignId,
        mutation,
        idempotencyKey,
      });
      return writeToolResult(result);
    },
  );

  server.registerTool(
    'confirm_state_change',
    {
      description:
        'Execute a pending proposal after the user explicitly agreed to the previewed change. Fails if the underlying state changed since the proposal was staged.',
      inputSchema: {
        proposalId: z.string().describe('Proposal id from propose_state_change'),
      },
    },
    async ({ proposalId }, extra) => {
      const result = await WriteTools.confirmStateChange(identityOpts(extra)?.userId, {
        proposalId,
      });
      return writeToolResult(result);
    },
  );

  server.registerTool(
    'cancel_state_change',
    {
      description: 'Cancel a pending proposal the user declined or no longer wants.',
      inputSchema: {
        proposalId: z.string().describe('Proposal id from propose_state_change'),
      },
    },
    async ({ proposalId }, extra) => {
      const result = await WriteTools.cancelStateChange(identityOpts(extra)?.userId, {
        proposalId,
      });
      return writeToolResult(result);
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
