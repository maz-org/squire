/**
 * Campaign write tools (SQR-280): the agent/MCP mutation surface.
 *
 * Proves the contract every channel shares: identity comes from runtime
 * context only, non-destructive writes apply directly under CAS, the
 * destructive set surfaces proposal_required and flows propose→confirm,
 * idempotency keys make staging replay-safe, and rate-limit denials are
 * structured results rather than throws. MCP parity drives the REAL server
 * through an in-memory transport with injected authInfo.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { executeToolCall } from '../src/agent.ts';
import { getDb, shutdownServerPool } from '../src/db.ts';
import {
  CAMPAIGN_WRITE_RATE_LIMIT_POLICY,
  InMemoryTokenBucketStore,
  RateLimiter,
  getDefaultRateLimiter,
  resetRateLimiterForTesting,
  setRateLimiterForTesting,
} from '../src/rate-limit.ts';
import * as CampaignService from '../src/campaign/campaign-service.ts';
import * as CharacterService from '../src/campaign/character-service.ts';
import { identityFromSessionUser, type CallerIdentity } from '../src/campaign/identity.ts';
import { createMcpServer } from '../src/mcp.ts';
import { users } from '../src/db/schema/core.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

const OWNER_EMAIL = 'owner@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';

const WRITE_TOOLS = [
  'write_campaign_state',
  'write_character_state',
  'propose_state_change',
  'confirm_state_change',
  'cancel_state_change',
] as const;

async function createUser(email: string): Promise<CallerIdentity> {
  const { db } = getDb('server');
  const [user] = await db
    .insert(users)
    .values({ email, googleSub: `google-sub-${email}`, name: email.split('@')[0] })
    .returning();
  return identityFromSessionUser(user.id);
}

async function setupCampaign() {
  const owner = await createUser(OWNER_EMAIL);
  let campaign = await CampaignService.createCampaign(owner, {
    name: 'Write Tools Campaign',
    game: 'frosthaven',
    modules: [],
  });
  campaign = await CampaignService.updateSharedState(owner, campaign.id, {
    expectedVersion: campaign.version,
    playedScenarios: ['fh:1', 'fh:2'],
    prosperity: 3,
  });
  const character = await CharacterService.createCharacter(owner, campaign.id, {
    name: 'Tool Subject',
    className: 'Drifter',
  });
  return { owner, campaign, character };
}

/** Run a write tool through the agent surface and parse its JSON result. */
async function callWriteTool(
  name: string,
  input: Record<string, unknown>,
  userId?: string,
  // The result shape is the tool's own contract under test — `any` keeps
  // assertions on dynamic JSON readable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const result = await executeToolCall(name, input, userId ? { userId } : undefined);
  return JSON.parse(result.content);
}

async function connectWithAuth(authInfo?: AuthInfo): Promise<Client> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  if (authInfo) {
    const originalSend = clientTransport.send.bind(clientTransport);
    clientTransport.send = (message, options) => originalSend(message, { ...options, authInfo });
  }
  const client = new Client({ name: 'write-parity-test', version: '1.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function userBoundToken(userId: string): AuthInfo {
  return { token: 'user-token', clientId: 'test-client', scopes: [], extra: { userId } };
}

function firstText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content[0].text;
}

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  process.env.SQUIRE_ALLOWED_EMAILS = [OWNER_EMAIL, OUTSIDER_EMAIL].join(',');
});

afterEach(() => {
  resetRateLimiterForTesting();
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('identity boundary', () => {
  it('rejects every write tool without a runtime user identity', async () => {
    const { campaign } = await setupCampaign();
    for (const name of WRITE_TOOLS) {
      const body = await callWriteTool(name, {
        campaignId: campaign.id,
        characterId: campaign.id,
        proposalId: campaign.id,
        patch: { prosperity: 4 },
        mutation: { type: 'campaign.delete' },
      });
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('user_identity_required');
    }
  });

  it('ignores model-supplied userId in tool input — runtime context only', async () => {
    const { owner, campaign } = await setupCampaign();
    const body = await callWriteTool('write_campaign_state', {
      campaignId: campaign.id,
      patch: { prosperity: 4 },
      userId: owner.userId, // model-controlled — must not widen scope
    });
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('user_identity_required');
  });

  it('gives non-members the indistinguishable not_found', async () => {
    const { campaign } = await setupCampaign();
    const outsider = await createUser(OUTSIDER_EMAIL);
    const body = await callWriteTool(
      'write_campaign_state',
      { campaignId: campaign.id, patch: { prosperity: 4 } },
      outsider.userId,
    );
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_found');
  });
});

describe('direct non-destructive writes', () => {
  it('applies campaign and character updates with a fresh CAS read', async () => {
    const { owner, campaign, character } = await setupCampaign();

    const campaignBody = await callWriteTool(
      'write_campaign_state',
      { campaignId: campaign.id, patch: { playedScenarios: ['fh:1', 'fh:2', 'fh:3'] } },
      owner.userId,
    );
    expect(campaignBody.ok).toBe(true);
    expect(campaignBody.campaign.playedScenarios).toEqual(['fh:1', 'fh:2', 'fh:3']);

    const characterBody = await callWriteTool(
      'write_character_state',
      { characterId: character.id, patch: { level: 4, xp: 150 } },
      owner.userId,
    );
    expect(characterBody.ok).toBe(true);
    expect(characterBody.character.level).toBe(4);

    const detail = await CampaignService.getCampaignDetail(owner, campaign.id);
    expect(detail.campaign.playedScenarios).toContain('fh:3');
  });

  it('rejects malformed model input as a structured invalid_input', async () => {
    const { owner, campaign } = await setupCampaign();
    const body = await callWriteTool(
      'write_campaign_state',
      { campaignId: campaign.id, patch: { prosperity: 'high' } },
      owner.userId,
    );
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('invalid_input');
    expect(body.error.message).toContain('patch.prosperity');
  });

  it('surfaces destructive direct writes as proposal_required', async () => {
    const { owner, campaign } = await setupCampaign();
    const body = await callWriteTool(
      'write_campaign_state',
      { campaignId: campaign.id, patch: { playedScenarios: ['fh:1'] } }, // un-play fh:2
      owner.userId,
    );
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('proposal_required');
    expect(body.error.hint).toContain('propose_state_change');
  });
});

describe('propose → confirm → cancel through the tools', () => {
  it('stages, confirms, and applies an un-play', async () => {
    const { owner, campaign } = await setupCampaign();

    const proposed = await callWriteTool(
      'propose_state_change',
      {
        campaignId: campaign.id,
        mutation: { type: 'campaign.update', patch: { playedScenarios: ['fh:1'] } },
      },
      owner.userId,
    );
    expect(proposed.ok).toBe(true);
    expect(proposed.proposal.status).toBe('proposed');
    expect(proposed.hint).toContain('explicitly agree');

    const confirmed = await callWriteTool(
      'confirm_state_change',
      { proposalId: proposed.proposal.id },
      owner.userId,
    );
    expect(confirmed.ok).toBe(true);
    expect(confirmed.proposal.status).toBe('confirmed');

    const detail = await CampaignService.getCampaignDetail(owner, campaign.id);
    expect(detail.campaign.playedScenarios).toEqual(['fh:1']);

    const replayed = await callWriteTool(
      'confirm_state_change',
      { proposalId: proposed.proposal.id },
      owner.userId,
    );
    expect(replayed.ok).toBe(false);
    expect(replayed.error.code).toBe('proposal_resolved');
  });

  it('cancels a declined proposal terminally', async () => {
    const { owner, campaign } = await setupCampaign();
    const proposed = await callWriteTool(
      'propose_state_change',
      { campaignId: campaign.id, mutation: { type: 'campaign.delete' } },
      owner.userId,
    );
    const cancelled = await callWriteTool(
      'cancel_state_change',
      { proposalId: proposed.proposal.id },
      owner.userId,
    );
    expect(cancelled.ok).toBe(true);

    const confirmAfter = await callWriteTool(
      'confirm_state_change',
      { proposalId: proposed.proposal.id },
      owner.userId,
    );
    expect(confirmAfter.ok).toBe(false);
    expect(confirmAfter.error.code).toBe('proposal_resolved');
  });

  it('rejects unrecognized mutation shapes before they reach the store', async () => {
    const { owner, campaign } = await setupCampaign();
    const body = await callWriteTool(
      'propose_state_change',
      { campaignId: campaign.id, mutation: { type: 'campaign.nuke' } },
      owner.userId,
    );
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('invalid_input');
  });
});

describe('idempotency keys', () => {
  it('replays the same key+payload to the same proposal; conflicting payloads are rejected', async () => {
    const { owner, campaign } = await setupCampaign();
    const stage = () =>
      callWriteTool(
        'propose_state_change',
        {
          campaignId: campaign.id,
          mutation: { type: 'campaign.update', patch: { prosperity: 2 } },
          idempotencyKey: 'session-end-42',
        },
        owner.userId,
      );

    const first = await stage();
    const replay = await stage();
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(replay.proposal.id).toBe(first.proposal.id);

    const conflicting = await callWriteTool(
      'propose_state_change',
      {
        campaignId: campaign.id,
        mutation: { type: 'campaign.delete' },
        idempotencyKey: 'session-end-42',
      },
      owner.userId,
    );
    expect(conflicting.ok).toBe(false);
    expect(conflicting.error.code).toBe('idempotency_conflict');
  });
});

describe('rate limiting', () => {
  it('returns a structured rate_limited result when the write budget is gone', async () => {
    const { owner, campaign } = await setupCampaign();
    setRateLimiterForTesting(
      new RateLimiter(new InMemoryTokenBucketStore(), {
        identitySecret: 'write-tools-rate-limit-test-secret',
        nowMs: () => 1_000_000,
      }),
    );
    const limiter = getDefaultRateLimiter();
    for (let i = 0; i < CAMPAIGN_WRITE_RATE_LIMIT_POLICY.limit; i++) {
      await limiter.consume({
        policy: CAMPAIGN_WRITE_RATE_LIMIT_POLICY,
        identity: `user:${owner.userId}`,
      });
    }

    const body = await callWriteTool(
      'write_campaign_state',
      { campaignId: campaign.id, patch: { prosperity: 4 } },
      owner.userId,
    );
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.message).toMatch(/retry in \d+s/);
  });
});

describe('MCP write parity', () => {
  it('user-bound tokens get the identical propose→confirm flow over /mcp', async () => {
    const { owner, campaign } = await setupCampaign();
    const client = await connectWithAuth(userBoundToken(owner.userId));

    const direct = await client.callTool({
      name: 'write_campaign_state',
      arguments: { campaignId: campaign.id, patch: { prosperity: 4 } },
    });
    expect(direct.isError ?? false).toBe(false);
    expect(JSON.parse(firstText(direct)).campaign.prosperity).toBe(4);

    const proposed = await client.callTool({
      name: 'propose_state_change',
      arguments: {
        campaignId: campaign.id,
        mutation: { type: 'campaign.update', patch: { playedScenarios: ['fh:1'] } },
      },
    });
    const proposedBody = JSON.parse(firstText(proposed));
    expect(proposedBody.ok).toBe(true);

    const confirmed = await client.callTool({
      name: 'confirm_state_change',
      arguments: { proposalId: proposedBody.proposal.id },
    });
    expect(JSON.parse(firstText(confirmed)).proposal.status).toBe('confirmed');

    const detail = await CampaignService.getCampaignDetail(owner, campaign.id);
    expect(detail.campaign.playedScenarios).toEqual(['fh:1']);
  });

  it('client-credentials tokens cannot write at all', async () => {
    const { campaign } = await setupCampaign();
    const client = await connectWithAuth({
      token: 'client-token',
      clientId: 'test-client',
      scopes: [],
    });
    const result = await client.callTool({
      name: 'write_campaign_state',
      arguments: { campaignId: campaign.id, patch: { prosperity: 4 } },
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(firstText(result)).error.code).toBe('user_identity_required');
  });
});
