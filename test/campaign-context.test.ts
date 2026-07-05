/**
 * Campaign-scoped agent context tests (SQR-19, ADR 0021 §LLM context
 * scoping + test obligations).
 *
 * The context-assembly proof: the rendered prompt block for a member is
 * built from the single CampaignContextView projection, so other members'
 * private-tier values are structurally absent — asserted here against the
 * exact string that enters the context window. Also covers the E8 game
 * fallback, the active-character rule, and E6 history scoping.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { getDb, shutdownServerPool } from '../src/db.ts';
import * as CampaignService from '../src/campaign/campaign-service.ts';
import { CampaignNotFoundError } from '../src/campaign/campaign-service.ts';
import * as CharacterService from '../src/campaign/character-service.ts';
import {
  applyCampaignContextToAskOptions,
  loadCampaignContext,
  renderCampaignContextBlock,
  type CampaignContextView,
} from '../src/campaign/context.ts';
import { identityFromSessionUser, type CallerIdentity } from '../src/campaign/identity.ts';
import { campaignScopedHistory } from '../src/chat/conversation-service.ts';
import type { ConversationMessage } from '../src/db/repositories/types.ts';
import { users } from '../src/db/schema/core.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

const OWNER_EMAIL = 'owner@example.com';
const MEMBER_EMAIL = 'member@example.com';

async function createUser(email: string): Promise<CallerIdentity> {
  const { db } = getDb('server');
  const [user] = await db
    .insert(users)
    .values({ email, googleSub: `google-sub-${email}`, name: email.split('@')[0] })
    .returning();
  return identityFromSessionUser(user.id);
}

interface Fixture {
  owner: CallerIdentity;
  member: CallerIdentity;
  campaignId: string;
  ownerCharacterId: string;
}

async function setupFixture(): Promise<Fixture> {
  const owner = await createUser(OWNER_EMAIL);
  const member = await createUser(MEMBER_EMAIL);
  const campaign = await CampaignService.createCampaign(owner, {
    name: 'Context Campaign',
    game: 'gloomhaven-2e',
    modules: ['gh2e'],
  });
  const invite = await CampaignService.inviteMember(owner, campaign.id, MEMBER_EMAIL);
  await CampaignService.acceptInvite(member, invite.memberId);
  const character = await CharacterService.createCharacter(owner, campaign.id, {
    name: 'Quartermaster',
    className: 'Quartermaster',
    gold: 42,
    privateNotes: 'SECRET-NOTES-TOKEN',
  });
  return { owner, member, campaignId: campaign.id, ownerCharacterId: character.id };
}

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  process.env.SQUIRE_ALLOWED_EMAILS = [OWNER_EMAIL, MEMBER_EMAIL].join(',');
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('loadCampaignContext (the single projection)', () => {
  it('gives the requester their own characters in full and others member-visible', async () => {
    const fixture = await setupFixture();

    const ownerView = await loadCampaignContext(fixture.owner, fixture.campaignId);
    expect(ownerView.ownCharacters[0].privateNotes).toBe('SECRET-NOTES-TOKEN');
    expect(ownerView.campaign.game).toBe('gloomhaven-2e');
    expect(ownerView.ownCharacters[0].gold).toBe(42);

    const memberView = await loadCampaignContext(fixture.member, fixture.campaignId);
    expect(memberView.ownCharacters).toEqual([]);
    expect(memberView.otherCharacters).toHaveLength(1);
    const visible = memberView.otherCharacters[0] as unknown as Record<string, unknown>;
    for (const field of ['personalQuestSourceId', 'privateNotes']) {
      expect(visible, `${field} must be absent from other members' view`).not.toHaveProperty(field);
    }

    // The ADR context-assembly proof: the exact string entering the context
    // window for member B contains none of owner A's private values.
    const block = renderCampaignContextBlock(memberView);
    expect(block).not.toContain('SECRET-NOTES-TOKEN');
    // …while shared facts are present.
    expect(block).toContain('Quartermaster');
    expect(block).toContain("If asked for another member's private fields");
    expect(block).toContain('do not claim those fields are empty or unrecorded');
    expect(block).toContain('<campaign_data>');
  });

  it('only falls back to the campaign game when rules Q&A supports that game', async () => {
    const fixture = await setupFixture();
    type AskOptions = {
      campaignId?: string;
      userId?: string;
      game?: string;
      campaignContext?: CampaignContextView;
    };

    const gh2e = await applyCampaignContextToAskOptions<AskOptions>({
      campaignId: fixture.campaignId,
      userId: fixture.owner.userId,
    });
    expect(gh2e.game).toBe('gloomhaven-2e');

    const gh1eCampaign = await CampaignService.createCampaign(fixture.owner, {
      name: 'Tracker Only',
      game: 'gloomhaven-1e',
      modules: ['gh1e'],
    });
    const gh1e = await applyCampaignContextToAskOptions<AskOptions>({
      campaignId: gh1eCampaign.id,
      userId: fixture.owner.userId,
    });
    expect(gh1e.campaignContext?.campaign.game).toBe('gloomhaven-1e');
    expect(gh1e.game).toBeUndefined();
  });

  it('is member-gated and validates explicit character selections', async () => {
    const fixture = await setupFixture();
    const outsider = await createUser('outsider@example.com');

    await expect(loadCampaignContext(outsider, fixture.campaignId)).rejects.toBeInstanceOf(
      CampaignNotFoundError,
    );
    // A selection the requester does not own is indistinguishable from absent.
    await expect(
      loadCampaignContext(fixture.member, fixture.campaignId, fixture.ownerCharacterId),
    ).rejects.toBeInstanceOf(CampaignNotFoundError);
  });

  it('applies the active-character rule: one active, explicit pick, or ask', async () => {
    const fixture = await setupFixture();

    // Exactly one active character → it is the active one.
    const single = await loadCampaignContext(fixture.owner, fixture.campaignId);
    expect(single.activeCharacterId).toBe(fixture.ownerCharacterId);

    // Two active characters, no selection → null + ask instruction.
    const second = await CharacterService.createCharacter(fixture.owner, fixture.campaignId, {
      name: 'Second Blade',
      className: 'Doomstalker',
    });
    const ambiguous = await loadCampaignContext(fixture.owner, fixture.campaignId);
    expect(ambiguous.activeCharacterId).toBeNull();
    expect(renderCampaignContextBlock(ambiguous)).toContain('ask which character');

    // Explicit selection wins.
    const selected = await loadCampaignContext(fixture.owner, fixture.campaignId, second.id);
    expect(selected.activeCharacterId).toBe(second.id);
    expect(renderCampaignContextBlock(selected)).toContain(second.id);
  });
});

describe('campaignScopedHistory (E6)', () => {
  const message = (id: string, campaignId: string | null): ConversationMessage =>
    ({
      id,
      conversationId: 'c1',
      role: 'user',
      content: id,
      campaignId,
      isError: false,
      responseToMessageId: null,
      consultedSources: null,
      createdAt: new Date(),
    }) as ConversationMessage;

  it('filters bound turns to the active campaign; unbound turns always pass', () => {
    const history = [
      message('legacy', null),
      message('campaign-a', 'aaaaaaaa-0000-4000-8000-000000000000'),
      message('campaign-b', 'bbbbbbbb-0000-4000-8000-000000000000'),
    ];

    const underA = campaignScopedHistory(history, 'aaaaaaaa-0000-4000-8000-000000000000');
    expect(underA.map((m) => m.id)).toEqual(['legacy', 'campaign-a']);

    // Switching campaigns mid-session must not bleed prior campaign facts.
    const underB = campaignScopedHistory(history, 'bbbbbbbb-0000-4000-8000-000000000000');
    expect(underB.map((m) => m.id)).toEqual(['legacy', 'campaign-b']);

    // No campaign (legacy/selector behavior): only unbound turns.
    const unbound = campaignScopedHistory(history, null);
    expect(unbound.map((m) => m.id)).toEqual(['legacy']);
  });
});
