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
import { inArray } from 'drizzle-orm';
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
import { cardCharacterMats } from '../src/db/schema/cards.ts';
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

describe('onboarding tools (SQR-284)', () => {
  it('goes zero → populated campaign: create, invite, placeholder, claim', async () => {
    const owner = await createUser(OWNER_EMAIL);

    const created = await callWriteTool(
      'create_campaign',
      { name: 'Onboarded Campaign', game: 'frosthaven' },
      owner.userId,
    );
    expect(created.ok).toBe(true);
    const campaignId = created.campaign.id;

    const invited = await callWriteTool(
      'invite_member',
      { campaignId, email: OUTSIDER_EMAIL },
      owner.userId,
    );
    expect(invited.ok).toBe(true);

    const own = await callWriteTool(
      'create_character',
      { campaignId, name: 'My Hero', className: 'Drifter', level: 2 },
      owner.userId,
    );
    expect(own.ok).toBe(true);

    const placeholder = await callWriteTool(
      'create_character',
      {
        campaignId,
        name: 'Banner Friend',
        className: 'Banner Spear',
        placeholderForEmail: OUTSIDER_EMAIL,
      },
      owner.userId,
    );
    expect(placeholder.ok).toBe(true);
    expect(placeholder.character.placeholderForEmail).toBe(OUTSIDER_EMAIL);

    // The second member joins and claims their placeholder (SQR-22 rule).
    const member = await createUser(OUTSIDER_EMAIL);
    await CampaignService.acceptInvite(member, invited.member.memberId);
    const claimed = await CharacterService.claimCharacter(member, placeholder.character.id);
    expect(claimed.ownerUserId).toBe(member.userId);
    expect(claimed.placeholderForEmail).toBeNull();
  });

  it('soft-corrects unknown class names against the game card index', async () => {
    const owner = await createUser(OWNER_EMAIL);
    const campaign = await CampaignService.createCampaign(owner, {
      name: 'Class Check Campaign',
      game: 'frosthaven',
      modules: [],
    });
    const { db } = getDb('server');
    // Card tables are NOT reset between tests (resetTestDb only truncates
    // campaign/auth/conversation state) — clean these rows up in finally so
    // extracted-data parity tests in the same DB never see them.
    const testSourceIds = ['test-class-drifter', 'test-class-banner-spear'];
    await db
      .insert(cardCharacterMats)
      .values([
        {
          game: 'frosthaven',
          sourceId: testSourceIds[0],
          name: 'Drifter',
          characterClass: 'Inox',
          handSize: 9,
          traits: [],
          hp: {},
          perks: [],
          masteries: [],
        },
        {
          game: 'frosthaven',
          sourceId: testSourceIds[1],
          name: 'Banner Spear',
          characterClass: 'Human',
          handSize: 10,
          traits: [],
          hp: {},
          perks: [],
          masteries: [],
        },
      ])
      .onConflictDoNothing();

    try {
      const misspelled = await callWriteTool(
        'create_character',
        { campaignId: campaign.id, name: 'Typo Hero', className: 'Driftr' },
        owner.userId,
      );
      expect(misspelled.ok).toBe(false);
      expect(misspelled.error.code).toBe('unknown_class');
      expect(misspelled.error.hint).toContain('did you mean Drifter?');

      // Case-insensitive matches normalize to canonical casing.
      const lowercase = await callWriteTool(
        'create_character',
        { campaignId: campaign.id, name: 'Casing Hero', className: 'banner spear' },
        owner.userId,
      );
      expect(lowercase.ok).toBe(true);
      expect(lowercase.character.className).toBe('Banner Spear');

      // The user insisted: force admits the homebrew class.
      const forced = await callWriteTool(
        'create_character',
        { campaignId: campaign.id, name: 'Homebrew Hero', className: 'Moonwalker', force: true },
        owner.userId,
      );
      expect(forced.ok).toBe(true);
      expect(forced.character.className).toBe('Moonwalker');
    } finally {
      await db.delete(cardCharacterMats).where(inArray(cardCharacterMats.sourceId, testSourceIds));
    }
  });

  it('keeps onboarding inside the contract: allowlist and ownership still gate', async () => {
    const owner = await createUser(OWNER_EMAIL);
    const created = await callWriteTool(
      'create_campaign',
      { name: 'Gated Campaign', game: 'frosthaven' },
      owner.userId,
    );
    const campaignId = created.campaign.id;

    const offList = await callWriteTool(
      'invite_member',
      { campaignId, email: 'stranger@example.com' },
      owner.userId,
    );
    expect(offList.ok).toBe(false);
    expect(offList.error.code).toBe('not_allowlisted');

    const badGame = await callWriteTool(
      'create_campaign',
      { name: 'Wrong Game', game: 'catan' },
      owner.userId,
    );
    expect(badGame.ok).toBe(false);
    expect(badGame.error.code).toBe('unsupported_game');
  });
});

describe('session-end batch staging (SQR-283)', () => {
  it('stages a batch through the tool with a named, consequence-aware preview', async () => {
    const { owner, campaign, character } = await setupCampaign();
    const body = await callWriteTool(
      'propose_state_change',
      {
        campaignId: campaign.id,
        mutation: {
          type: 'batch',
          mutations: [
            { type: 'campaign.update', patch: { playedScenarios: ['fh:1', 'fh:2', 'fh:14'] } },
            { type: 'character.update', characterId: character.id, patch: { level: 5, gold: 12 } },
          ],
        },
      },
      owner.userId,
    );
    expect(body.ok).toBe(true);
    expect(body.preview).toContain('SCENARIOS PLAYED → 1, 2, 14');
    expect(body.preview).toContain('TOOL SUBJECT → L5 · GOLD 12');

    const confirmed = await callWriteTool(
      'confirm_state_change',
      { proposalId: body.proposal.id },
      owner.userId,
    );
    expect(confirmed.ok).toBe(true);

    const detail = await CampaignService.getCampaignDetail(owner, campaign.id);
    expect(detail.campaign.playedScenarios).toContain('fh:14');
    const characterAfter = await CharacterService.getCharacterDetail(owner, character.id);
    expect(characterAfter.character.level).toBe(5);
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
    // Every write surface, including onboarding creates, rejects
    // structurally — headless clients need a user-bound token (SQR-287).
    for (const call of [
      {
        name: 'write_campaign_state',
        arguments: { campaignId: campaign.id, patch: { prosperity: 4 } },
      },
      {
        name: 'propose_state_change',
        arguments: { campaignId: campaign.id, mutation: { type: 'campaign.delete' } },
      },
      { name: 'create_campaign', arguments: { name: 'Headless Campaign', game: 'frosthaven' } },
    ]) {
      const result = await client.callTool(call);
      expect(result.isError).toBe(true);
      expect(JSON.parse(firstText(result)).error.code).toBe('user_identity_required');
    }
  });

  it('destructive one-shot writes are impossible over /mcp too (SQR-287)', async () => {
    const { owner, campaign } = await setupCampaign();
    const client = await connectWithAuth(userBoundToken(owner.userId));
    const result = await client.callTool({
      name: 'write_campaign_state',
      arguments: { campaignId: campaign.id, patch: { playedScenarios: ['fh:1'] } }, // un-play
    });
    expect(result.isError).toBe(true);
    const body = JSON.parse(firstText(result));
    expect(body.error.code).toBe('proposal_required');
    expect(body.error.hint).toContain('propose_state_change');
  });

  it('replayed headless confirms resolve idempotently, never double-apply (SQR-287)', async () => {
    const { owner, campaign } = await setupCampaign();
    const client = await connectWithAuth(userBoundToken(owner.userId));

    const proposed = await client.callTool({
      name: 'propose_state_change',
      arguments: {
        campaignId: campaign.id,
        mutation: { type: 'campaign.update', patch: { prosperity: 2 } },
      },
    });
    const proposalId = JSON.parse(firstText(proposed)).proposal.id;

    const first = await client.callTool({
      name: 'confirm_state_change',
      arguments: { proposalId },
    });
    expect(JSON.parse(firstText(first)).proposal.status).toBe('confirmed');

    const replay = await client.callTool({
      name: 'confirm_state_change',
      arguments: { proposalId },
    });
    expect(replay.isError).toBe(true);
    expect(JSON.parse(firstText(replay)).error.code).toBe('proposal_resolved');

    // Exactly one application: prosperity is 2, not double-touched.
    const detail = await CampaignService.getCampaignDetail(owner, campaign.id);
    expect(detail.campaign.prosperity).toBe(2);
  });

  it('runs headless onboarding over /mcp with a user-bound token (SQR-287)', async () => {
    const owner = await createUser(OWNER_EMAIL);
    const client = await connectWithAuth(userBoundToken(owner.userId));

    const created = await client.callTool({
      name: 'create_campaign',
      arguments: { name: 'Headless Onboarded', game: 'frosthaven' },
    });
    expect(created.isError ?? false).toBe(false);
    const campaignId = JSON.parse(firstText(created)).campaign.id;

    const character = await client.callTool({
      name: 'create_character',
      arguments: { campaignId, name: 'Headless Hero', className: 'Drifter' },
    });
    expect(character.isError ?? false).toBe(false);
    expect(JSON.parse(firstText(character)).character.name).toBe('Headless Hero');
  });
});
