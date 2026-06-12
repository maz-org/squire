/**
 * MCP read parity for campaign state (SQR-271, success metric 5 read half).
 *
 * Drives the REAL MCP server (real tools, real Postgres) through an
 * in-memory client whose transport injects `authInfo` per message — the
 * same path the HTTP transport uses — and proves the /mcp channel gets the
 * identical identity-scoped behavior the tool layer guarantees: user-bound
 * tokens see their campaigns, client-credentials tokens and anonymous
 * callers see no campaign state at all, and non-member refs are absent.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { getDb, shutdownServerPool } from '../src/db.ts';
import * as CampaignService from '../src/campaign/campaign-service.ts';
import * as CharacterService from '../src/campaign/character-service.ts';
import { identityFromSessionUser, type CallerIdentity } from '../src/campaign/identity.ts';
import { createMcpServer } from '../src/mcp.ts';
import { users } from '../src/db/schema/core.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

const OWNER_EMAIL = 'owner@example.com';
const MEMBER_EMAIL = 'member@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';

async function createUser(email: string): Promise<CallerIdentity> {
  const { db } = getDb('server');
  const [user] = await db
    .insert(users)
    .values({ email, googleSub: `google-sub-${email}`, name: email.split('@')[0] })
    .returning();
  return identityFromSessionUser(user.id);
}

/**
 * Connect a client whose every request carries the given authInfo — the
 * in-memory equivalent of the HTTP transport's `handleRequest(req,
 * { authInfo })` threading.
 */
async function connectWithAuth(authInfo?: AuthInfo): Promise<Client> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  if (authInfo) {
    const originalSend = clientTransport.send.bind(clientTransport);
    clientTransport.send = (message, options) => originalSend(message, { ...options, authInfo });
  }
  const client = new Client({ name: 'parity-test', version: '1.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function userBoundToken(userId: string): AuthInfo {
  return {
    token: 'user-token',
    clientId: 'test-client',
    scopes: [],
    extra: { userId },
  };
}

const CLIENT_ONLY_TOKEN: AuthInfo = {
  token: 'client-token',
  clientId: 'test-client',
  scopes: [],
};

function firstText(result: { content?: unknown }): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

interface Fixture {
  owner: CallerIdentity;
  member: CallerIdentity;
  outsider: CallerIdentity;
  campaignId: string;
  characterId: string;
}

async function setupFixture(): Promise<Fixture> {
  const owner = await createUser(OWNER_EMAIL);
  const member = await createUser(MEMBER_EMAIL);
  const outsider = await createUser(OUTSIDER_EMAIL);
  const campaign = await CampaignService.createCampaign(owner, {
    name: 'Parity Campaign',
    game: 'frosthaven',
    modules: [],
  });
  const invite = await CampaignService.inviteMember(owner, campaign.id, MEMBER_EMAIL);
  await CampaignService.acceptInvite(member, invite.memberId);
  const character = await CharacterService.createCharacter(owner, campaign.id, {
    name: 'Parity Subject',
    className: 'Drifter',
    personalQuest: 'SECRET-PQ-TOKEN',
  });
  return { owner, member, outsider, campaignId: campaign.id, characterId: character.id };
}

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  process.env.SQUIRE_ALLOWED_EMAILS = [OWNER_EMAIL, MEMBER_EMAIL, OUTSIDER_EMAIL].join(',');
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('MCP campaign-state parity', () => {
  it('user-bound tokens see and open their campaigns through /mcp tools', async () => {
    const fixture = await setupFixture();
    const client = await connectWithAuth(userBoundToken(fixture.owner.userId));

    const sources = await client.callTool({
      name: 'inspect_sources',
      arguments: { game: 'frosthaven' },
    });
    expect(firstText(sources)).toContain('source:frosthaven/campaign-state');

    const resolved = await client.callTool({
      name: 'resolve_entity',
      arguments: { query: 'Parity Campaign', kinds: ['campaign'], game: 'frosthaven' },
    });
    const resolvedBody = JSON.parse(firstText(resolved)) as {
      candidates: Array<{ entity: { ref: string } }>;
    };
    expect(resolvedBody.candidates[0]?.entity.ref).toBe(
      `campaign:frosthaven/${fixture.campaignId}`,
    );

    const opened = await client.callTool({
      name: 'open_entity',
      arguments: { ref: `campaign:frosthaven/${fixture.campaignId}` },
    });
    const openedBody = JSON.parse(firstText(opened)) as {
      ok: boolean;
      entity: { title: string };
    };
    expect(openedBody.ok).toBe(true);
    expect(openedBody.entity.title).toBe('Parity Campaign');

    const traversed = await client.callTool({
      name: 'neighbors',
      arguments: { ref: `campaign:frosthaven/${fixture.campaignId}` },
    });
    const neighborsBody = JSON.parse(firstText(traversed)) as {
      neighbors: Array<{ relation: string }>;
    };
    expect(neighborsBody.neighbors.map((n) => n.relation)).toContain('has_character');
  });

  it('keeps the private tier owner-only across the MCP boundary', async () => {
    const fixture = await setupFixture();

    const ownerClient = await connectWithAuth(userBoundToken(fixture.owner.userId));
    const own = await ownerClient.callTool({
      name: 'open_entity',
      arguments: { ref: `character:frosthaven/${fixture.characterId}` },
    });
    expect(firstText(own)).toContain('SECRET-PQ-TOKEN');

    const memberClient = await connectWithAuth(userBoundToken(fixture.member.userId));
    const other = await memberClient.callTool({
      name: 'open_entity',
      arguments: { ref: `character:frosthaven/${fixture.characterId}` },
    });
    const text = firstText(other);
    expect(JSON.parse(text).ok).toBe(true);
    expect(text).not.toContain('SECRET-PQ-TOKEN');
    expect(text).not.toContain('personalQuest');
  });

  it('client-credentials tokens and anonymous callers see no campaign state', async () => {
    const fixture = await setupFixture();

    for (const client of [await connectWithAuth(CLIENT_ONLY_TOKEN), await connectWithAuth()]) {
      const sources = await client.callTool({
        name: 'inspect_sources',
        arguments: { game: 'frosthaven' },
      });
      expect(firstText(sources)).not.toContain('campaign-state');

      const opened = await client.callTool({
        name: 'open_entity',
        arguments: { ref: `campaign:frosthaven/${fixture.campaignId}` },
      });
      const body = JSON.parse(firstText(opened)) as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('not_found');
    }
  });

  it('non-member refs are absent — same not_found as a nonexistent id', async () => {
    const fixture = await setupFixture();
    const client = await connectWithAuth(userBoundToken(fixture.outsider.userId));

    const real = await client.callTool({
      name: 'open_entity',
      arguments: { ref: `campaign:frosthaven/${fixture.campaignId}` },
    });
    const absent = await client.callTool({
      name: 'open_entity',
      arguments: { ref: 'campaign:frosthaven/00000000-0000-4000-8000-000000000000' },
    });
    const realBody = JSON.parse(firstText(real)) as { ok: boolean; error: { code: string } };
    const absentBody = JSON.parse(firstText(absent)) as { ok: boolean; error: { code: string } };
    expect(realBody.ok).toBe(false);
    expect(realBody.error.code).toBe('not_found');
    expect(realBody.error.code).toBe(absentBody.error.code);

    const resolved = await client.callTool({
      name: 'resolve_entity',
      arguments: { query: 'Parity Campaign', kinds: ['campaign'], game: 'frosthaven' },
    });
    expect((JSON.parse(firstText(resolved)) as { candidates: unknown[] }).candidates).toEqual([]);
  });
});
