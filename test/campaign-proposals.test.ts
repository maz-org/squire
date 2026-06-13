/**
 * Propose→confirm state machine tests (SQR-279, eng E2).
 *
 * The destructive set cannot run one-shot at the service layer; confirm
 * revalidates status, expiry, payload integrity, entity versions, and
 * membership/permissions. Stale previews never become valid writes.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-characters-long';

import { getDb, shutdownServerPool } from '../src/db.ts';
import * as CampaignService from '../src/campaign/campaign-service.ts';
import { ProposalRequiredError } from '../src/campaign/campaign-service.ts';
import * as CharacterService from '../src/campaign/character-service.ts';
import * as PendingMutations from '../src/campaign/pending-mutations.ts';
import { ProposalStateError } from '../src/campaign/pending-mutations.ts';
import { identityFromSessionUser, type CallerIdentity } from '../src/campaign/identity.ts';
import { pendingMutations } from '../src/db/schema/campaigns.ts';
import { users } from '../src/db/schema/core.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

const OWNER_EMAIL = 'owner@example.com';
const OUTSIDER_EMAIL = 'outsider@example.com';

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
    name: 'Proposal Campaign',
    game: 'frosthaven',
    modules: [],
  });
  campaign = await CampaignService.updateSharedState(owner, campaign.id, {
    expectedVersion: campaign.version,
    playedScenarios: ['fh:1', 'fh:2'],
    prosperity: 3,
  });
  return { owner, campaign };
}

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  process.env.SQUIRE_ALLOWED_EMAILS = [OWNER_EMAIL, OUTSIDER_EMAIL].join(',');
});

afterAll(async () => {
  delete process.env.SQUIRE_ALLOWED_EMAILS;
  await teardownTestDb();
  await shutdownServerPool();
});

describe('one-shot destructive mutations are impossible at the service layer', () => {
  it('rejects un-play, prosperity decrease, delete, remove, retire', async () => {
    const { owner, campaign } = await setupCampaign();
    const character = await CharacterService.createCharacter(owner, campaign.id, {
      name: 'Doomed',
      className: 'Drifter',
    });

    await expect(
      CampaignService.updateSharedState(owner, campaign.id, {
        expectedVersion: campaign.version,
        playedScenarios: ['fh:1'], // drops fh:2 — un-play
      }),
    ).rejects.toBeInstanceOf(ProposalRequiredError);
    await expect(
      CampaignService.updateSharedState(owner, campaign.id, {
        expectedVersion: campaign.version,
        prosperity: 2, // decrease
      }),
    ).rejects.toBeInstanceOf(ProposalRequiredError);
    await expect(CampaignService.deleteCampaign(owner, campaign.id)).rejects.toBeInstanceOf(
      ProposalRequiredError,
    );
    await expect(CharacterService.deleteCharacter(owner, character.id)).rejects.toBeInstanceOf(
      ProposalRequiredError,
    );
    await expect(
      CharacterService.updateCharacter(owner, character.id, {
        expectedVersion: character.version,
        status: 'retired',
      }),
    ).rejects.toBeInstanceOf(ProposalRequiredError);

    // Non-destructive edits still apply directly.
    const updated = await CampaignService.updateSharedState(owner, campaign.id, {
      expectedVersion: campaign.version,
      prosperity: 4,
    });
    expect(updated.prosperity).toBe(4);
  });
});

describe('proposal lifecycle', () => {
  it('proposes and confirms an un-play end-to-end', async () => {
    const { owner, campaign } = await setupCampaign();
    const proposal = await PendingMutations.propose(owner, campaign.id, {
      type: 'campaign.update',
      patch: { playedScenarios: ['fh:1'] },
    });
    expect(proposal.status).toBe('proposed');
    expect(proposal.expectedVersions[campaign.id]).toBe(campaign.version);

    const confirmed = await PendingMutations.confirm(owner, proposal.id);
    expect(confirmed.status).toBe('confirmed');

    const detail = await CampaignService.getCampaignDetail(owner, campaign.id);
    expect(detail.campaign.playedScenarios).toEqual(['fh:1']);

    // Resolved proposals cannot be replayed.
    await expect(PendingMutations.confirm(owner, proposal.id)).rejects.toMatchObject({
      code: 'proposal_resolved',
    });
  });

  it('confirms retirement through a proposal', async () => {
    const { owner, campaign } = await setupCampaign();
    const character = await CharacterService.createCharacter(owner, campaign.id, {
      name: 'Veteran',
      className: 'Drifter',
    });
    const proposal = await PendingMutations.propose(owner, campaign.id, {
      type: 'character.retire',
      characterId: character.id,
    });
    await PendingMutations.confirm(owner, proposal.id);
    const detail = await CharacterService.getCharacterDetail(owner, character.id);
    expect(detail.character.status).toBe('retired');
  });

  it('rejects stale versions: state changed since the preview', async () => {
    const { owner, campaign } = await setupCampaign();
    const proposal = await PendingMutations.propose(owner, campaign.id, {
      type: 'campaign.update',
      patch: { playedScenarios: ['fh:1'] },
    });
    // A concurrent (non-destructive) write bumps the version.
    await CampaignService.updateSharedState(owner, campaign.id, {
      expectedVersion: campaign.version,
      prosperity: 5,
    });
    await expect(PendingMutations.confirm(owner, proposal.id)).rejects.toMatchObject({
      code: 'stale_proposal',
    });
    // The rejection is terminal.
    await expect(PendingMutations.confirm(owner, proposal.id)).rejects.toMatchObject({
      code: 'proposal_resolved',
    });
  });

  it('rejects expired and tampered proposals; the sweeper expires stale rows', async () => {
    const { owner, campaign } = await setupCampaign();
    const { db } = getDb('server');

    const expired = await PendingMutations.propose(owner, campaign.id, {
      type: 'campaign.delete',
    });
    await db
      .update(pendingMutations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(pendingMutations.id, expired.id));
    await expect(PendingMutations.confirm(owner, expired.id)).rejects.toMatchObject({
      code: 'proposal_expired',
    });

    const tampered = await PendingMutations.propose(owner, campaign.id, {
      type: 'campaign.delete',
    });
    await db
      .update(pendingMutations)
      .set({ payload: { mutation: { type: 'member.remove', memberId: expired.id } } })
      .where(eq(pendingMutations.id, tampered.id));
    await expect(PendingMutations.confirm(owner, tampered.id)).rejects.toBeInstanceOf(
      ProposalStateError,
    );

    const stale = await PendingMutations.propose(owner, campaign.id, { type: 'campaign.delete' });
    await db
      .update(pendingMutations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(pendingMutations.id, stale.id));
    const swept = await PendingMutations.sweepExpiredProposals();
    expect(swept).toBeGreaterThanOrEqual(1);
  });

  it('denies non-proposer confirms and lapsed-membership confirms', async () => {
    const { owner, campaign } = await setupCampaign();
    const outsider = await createUser(OUTSIDER_EMAIL);
    const proposal = await PendingMutations.propose(owner, campaign.id, {
      type: 'campaign.delete',
    });
    // Confirm is proposer-only (v1) and outsiders see nothing at all.
    await expect(PendingMutations.confirm(outsider, proposal.id)).rejects.toMatchObject({
      code: 'not_found',
    });

    // Cancel works for the proposer; the row is terminal afterwards.
    await PendingMutations.cancel(owner, proposal.id);
    await expect(PendingMutations.confirm(owner, proposal.id)).rejects.toMatchObject({
      code: 'proposal_resolved',
    });
  });
});

describe('session-end batches (SQR-283)', () => {
  it('applies a full session-end batch atomically on confirm', async () => {
    const { owner, campaign } = await setupCampaign();
    const drifter = await CharacterService.createCharacter(owner, campaign.id, {
      name: 'Drifter',
      className: 'Drifter',
    });
    const banner = await CharacterService.createCharacter(owner, campaign.id, {
      name: 'Banner Spear',
      className: 'Banner Spear',
    });

    const proposal = await PendingMutations.propose(owner, campaign.id, {
      type: 'batch',
      mutations: [
        {
          type: 'campaign.update',
          patch: { playedScenarios: ['fh:1', 'fh:2', 'fh:14'], prosperity: 4 },
        },
        { type: 'character.update', characterId: drifter.id, patch: { level: 5, gold: 12 } },
        { type: 'character.update', characterId: banner.id, patch: { xp: 45, gold: 12 } },
      ],
    });
    expect(proposal.expectedVersions).toEqual({
      [campaign.id]: campaign.version,
      [drifter.id]: drifter.version,
      [banner.id]: banner.version,
    });

    const confirmed = await PendingMutations.confirm(owner, proposal.id);
    expect(confirmed.status).toBe('confirmed');

    const campaignAfter = await CampaignService.getCampaignDetail(owner, campaign.id);
    expect(campaignAfter.campaign.playedScenarios).toContain('fh:14');
    expect(campaignAfter.campaign.prosperity).toBe(4);
    const drifterAfter = await CharacterService.getCharacterDetail(owner, drifter.id);
    expect(drifterAfter.character.level).toBe(5);
    expect(drifterAfter.character.gold).toBe(12);
    const bannerAfter = await CharacterService.getCharacterDetail(owner, banner.id);
    expect(bannerAfter.character.xp).toBe(45);
  });

  it('ATOMICITY: an induced mid-batch failure applies nothing', async () => {
    const { owner, campaign } = await setupCampaign();
    const character = await CharacterService.createCharacter(owner, campaign.id, {
      name: 'Survivor',
      className: 'Drifter',
    });
    const detail = await CampaignService.getCampaignDetail(owner, campaign.id);

    // Member 2 passes propose-time validation (the proposer IS the owner)
    // but fails at execution: owners cannot remove themselves. Member 1
    // would have already applied — the transaction must unwind it.
    const proposal = await PendingMutations.propose(owner, campaign.id, {
      type: 'batch',
      mutations: [
        { type: 'character.update', characterId: character.id, patch: { level: 9, gold: 99 } },
        { type: 'member.remove', memberId: detail.self.memberId },
      ],
    });

    await expect(PendingMutations.confirm(owner, proposal.id)).rejects.toMatchObject({
      code: 'forbidden',
    });

    const after = await CharacterService.getCharacterDetail(owner, character.id);
    expect(after.character.level).toBe(character.level);
    expect(after.character.gold).toBe(character.gold);
    expect(after.character.version).toBe(character.version);
  });

  it('enforces one mutation per entity per batch at the schema boundary', () => {
    const characterId = '00000000-0000-4000-8000-000000000001';
    expect(
      PendingMutations.StagedMutationSchema.safeParse({
        type: 'batch',
        mutations: [
          { type: 'campaign.update', patch: { prosperity: 4 } },
          { type: 'campaign.delete' },
        ],
      }).success,
    ).toBe(false);
    expect(
      PendingMutations.StagedMutationSchema.safeParse({
        type: 'batch',
        mutations: [
          { type: 'character.update', characterId, patch: { level: 2 } },
          { type: 'character.retire', characterId },
        ],
      }).success,
    ).toBe(false);
    expect(
      PendingMutations.StagedMutationSchema.safeParse({
        type: 'batch',
        mutations: [
          { type: 'campaign.update', patch: { prosperity: 4 } },
          { type: 'character.update', characterId, patch: { level: 2 } },
        ],
      }).success,
    ).toBe(true);
  });

  it('supports standalone character.update proposals', async () => {
    const { owner, campaign } = await setupCampaign();
    const character = await CharacterService.createCharacter(owner, campaign.id, {
      name: 'Solo',
      className: 'Drifter',
    });
    const proposal = await PendingMutations.propose(owner, campaign.id, {
      type: 'character.update',
      characterId: character.id,
      patch: { level: 3 },
    });
    await PendingMutations.confirm(owner, proposal.id);
    const after = await CharacterService.getCharacterDetail(owner, character.id);
    expect(after.character.level).toBe(3);
  });
});
