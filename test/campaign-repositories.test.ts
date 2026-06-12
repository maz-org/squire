/**
 * Integration tests for the Phase 4 campaign repositories (SQR-18) against
 * real Postgres, per ADR 0007. Exercises the ADR 0021 contract shapes the
 * repositories are responsible for: membership as the isolation primitive,
 * type-level private-tier exclusion, optimistic CAS, placeholder claims,
 * leave/rejoin ownership, and campaign-delete cascade boundaries.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { shutdownServerPool } from '../src/db.ts';
import * as CampaignRepository from '../src/db/repositories/campaign-repository.ts';
import * as MemberRepository from '../src/db/repositories/campaign-member-repository.ts';
import * as CharacterRepository from '../src/db/repositories/character-repository.ts';
import { VersionConflictError } from '../src/db/repositories/types.ts';
import { campaignMembers, characters } from '../src/db/schema/campaigns.ts';
import { users } from '../src/db/schema/core.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

let db: Awaited<ReturnType<typeof setupTestDb>>;

async function createUser(label: string) {
  const id = randomUUID();
  const [user] = await db
    .insert(users)
    .values({
      googleSub: `google-sub-${id}`,
      email: `${label}-${id}@example.com`,
      name: label,
    })
    .returning();
  return user;
}

async function createCampaignWithOwner(owner: { id: string; email: string }) {
  const campaign = await CampaignRepository.create(db, {
    name: 'Travel Campaign',
    game: 'gloomhaven-2e',
    modules: ['gh2e', 'solo2e'],
  });
  const ownerMember = await MemberRepository.createOwner(db, {
    campaignId: campaign.id,
    userId: owner.id,
    email: owner.email,
  });
  return { campaign, ownerMember };
}

describe('CampaignRepository', () => {
  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
    await shutdownServerPool();
  });

  it('creates a campaign with defaults and finds it by id', async () => {
    const owner = await createUser('owner');
    const { campaign } = await createCampaignWithOwner(owner);

    const loaded = await CampaignRepository.findById(campaign.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.game).toBe('gloomhaven-2e');
    expect(loaded?.modules).toEqual(['gh2e', 'solo2e']);
    expect(loaded?.prosperity).toBe(1);
    expect(loaded?.playedScenarios).toEqual([]);
    expect(loaded?.version).toBe(1);
  });

  it('applies shared-state writes with optimistic CAS and bumps version', async () => {
    const owner = await createUser('owner');
    const { campaign } = await createCampaignWithOwner(owner);

    const updated = await CampaignRepository.updateSharedState(db, campaign.id, {
      expectedVersion: 1,
      prosperity: 2,
      playedScenarios: ['gh2e:1'],
    });
    expect(updated.prosperity).toBe(2);
    expect(updated.playedScenarios).toEqual(['gh2e:1']);
    expect(updated.version).toBe(2);
  });

  it('throws VersionConflictError on a stale expected version', async () => {
    const owner = await createUser('owner');
    const { campaign } = await createCampaignWithOwner(owner);

    await CampaignRepository.updateSharedState(db, campaign.id, {
      expectedVersion: 1,
      prosperity: 2,
    });

    await expect(
      CampaignRepository.updateSharedState(db, campaign.id, {
        expectedVersion: 1,
        prosperity: 3,
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);

    // The losing write must not have applied.
    const loaded = await CampaignRepository.findById(campaign.id);
    expect(loaded?.prosperity).toBe(2);
    expect(loaded?.version).toBe(2);
  });

  it('cascades campaign delete to members and characters', async () => {
    const owner = await createUser('owner');
    const { campaign } = await createCampaignWithOwner(owner);
    await CharacterRepository.create(db, {
      campaignId: campaign.id,
      ownerUserId: owner.id,
      name: 'Drifter',
      className: 'Drifter',
    });

    const removed = await CampaignRepository.remove(db, campaign.id);
    expect(removed).toBe(true);

    const memberRows = await db
      .select()
      .from(campaignMembers)
      .where(eq(campaignMembers.campaignId, campaign.id));
    expect(memberRows).toHaveLength(0);
    const characterRows = await db
      .select()
      .from(characters)
      .where(eq(characters.campaignId, campaign.id));
    expect(characterRows).toHaveLength(0);
  });
});

describe('CampaignMemberRepository', () => {
  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
    await shutdownServerPool();
  });

  it('treats only active members as members (the isolation primitive)', async () => {
    const owner = await createUser('owner');
    const invitee = await createUser('invitee');
    const stranger = await createUser('stranger');
    const { campaign } = await createCampaignWithOwner(owner);

    const invite = await MemberRepository.createInvite(db, {
      campaignId: campaign.id,
      inviteEmail: invitee.email,
      invitedByUserId: owner.id,
    });

    // Invited-but-not-joined is NOT an active member (ADR 0021 carve-out).
    expect(await MemberRepository.findActiveMember(campaign.id, invitee.id)).toBeNull();
    expect(await MemberRepository.findActiveMember(campaign.id, stranger.id)).toBeNull();
    expect(await MemberRepository.findActiveMember(campaign.id, owner.id)).not.toBeNull();

    const activated = await MemberRepository.activateInvite(db, invite.id, invitee.id);
    expect(activated?.status).toBe('active');
    expect(await MemberRepository.findActiveMember(campaign.id, invitee.id)).not.toBeNull();

    // Activating twice is a no-op (row is no longer 'invited').
    expect(await MemberRepository.activateInvite(db, invite.id, invitee.id)).toBeNull();
  });

  it('lists pending invites by email and campaigns by active membership', async () => {
    const owner = await createUser('owner');
    const invitee = await createUser('invitee');
    const { campaign } = await createCampaignWithOwner(owner);
    await MemberRepository.createInvite(db, {
      campaignId: campaign.id,
      inviteEmail: invitee.email,
      invitedByUserId: owner.id,
    });

    const invites = await MemberRepository.listPendingInvitesForEmail(invitee.email);
    expect(invites).toHaveLength(1);
    expect(invites[0].campaignId).toBe(campaign.id);

    expect(await MemberRepository.listCampaignsForUser(owner.id)).toHaveLength(1);
    expect(await MemberRepository.listCampaignsForUser(invitee.id)).toHaveLength(0);
  });

  it('rejects a duplicate invite email per campaign', async () => {
    const owner = await createUser('owner');
    const { campaign } = await createCampaignWithOwner(owner);
    await MemberRepository.createInvite(db, {
      campaignId: campaign.id,
      inviteEmail: 'friend@example.com',
      invitedByUserId: owner.id,
    });
    await expect(
      MemberRepository.createInvite(db, {
        campaignId: campaign.id,
        inviteEmail: 'friend@example.com',
        invitedByUserId: owner.id,
      }),
    ).rejects.toThrow();
  });

  it('supports depart and rejoin, preserving the membership row', async () => {
    const owner = await createUser('owner');
    const member = await createUser('member');
    const { campaign } = await createCampaignWithOwner(owner);
    const invite = await MemberRepository.createInvite(db, {
      campaignId: campaign.id,
      inviteEmail: member.email,
      invitedByUserId: owner.id,
    });
    await MemberRepository.activateInvite(db, invite.id, member.id);

    expect(await MemberRepository.countActiveMembers(db, campaign.id)).toBe(2);
    await MemberRepository.markDeparted(db, invite.id);
    expect(await MemberRepository.findActiveMember(campaign.id, member.id)).toBeNull();
    expect(await MemberRepository.countActiveMembers(db, campaign.id)).toBe(1);

    const rejoined = await MemberRepository.reactivateDeparted(db, campaign.id, member.id);
    expect(rejoined?.status).toBe('active');
    expect(await MemberRepository.findActiveMember(campaign.id, member.id)).not.toBeNull();
  });
});

describe('CharacterRepository', () => {
  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
    await shutdownServerPool();
  });

  it('returns the private tier only on owner-facing reads', async () => {
    const owner = await createUser('owner');
    const { campaign } = await createCampaignWithOwner(owner);
    const character = await CharacterRepository.create(db, {
      campaignId: campaign.id,
      ownerUserId: owner.id,
      name: 'Drifter',
      className: 'Drifter',
      personalQuest: 'Seeker of the Unseen',
      battleGoals: 'secret goal',
      privateNotes: 'do not leak',
    });

    const owned = await CharacterRepository.findOwnedById(character.id, owner.id);
    expect(owned?.personalQuest).toBe('Seeker of the Unseen');

    // Wrong owner gets null from the owner-facing read, not a stripped row.
    const other = await createUser('other');
    expect(await CharacterRepository.findOwnedById(character.id, other.id)).toBeNull();

    // The member-visible projection has no private keys AT ALL.
    const visible = await CharacterRepository.findMemberVisibleById(character.id);
    expect(visible).not.toBeNull();
    expect(visible).not.toHaveProperty('personalQuest');
    expect(visible).not.toHaveProperty('battleGoals');
    expect(visible).not.toHaveProperty('privateNotes');
    expect(visible?.gold).toBe(0);
  });

  it('applies CAS updates and rejects stale versions', async () => {
    const owner = await createUser('owner');
    const { campaign } = await createCampaignWithOwner(owner);
    const character = await CharacterRepository.create(db, {
      campaignId: campaign.id,
      ownerUserId: owner.id,
      name: 'Drifter',
      className: 'Drifter',
    });

    const updated = await CharacterRepository.update(db, character.id, {
      expectedVersion: 1,
      gold: 12,
      level: 2,
    });
    expect(updated.gold).toBe(12);
    expect(updated.version).toBe(2);

    await expect(
      CharacterRepository.update(db, character.id, { expectedVersion: 1, gold: 99 }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('claims a placeholder only for the invited email and transfers ownership', async () => {
    const owner = await createUser('owner');
    const joiner = await createUser('joiner');
    const { campaign } = await createCampaignWithOwner(owner);
    const placeholder = await CharacterRepository.create(db, {
      campaignId: campaign.id,
      ownerUserId: owner.id,
      placeholderForEmail: joiner.email,
      name: 'Blinkblade',
      className: 'Blinkblade',
    });

    // The wrong email cannot claim it.
    const denied = await CharacterRepository.claimPlaceholder(db, placeholder.id, {
      claimantUserId: joiner.id,
      claimantEmail: 'not-the-invitee@example.com',
    });
    expect(denied).toBeNull();

    const claimed = await CharacterRepository.claimPlaceholder(db, placeholder.id, {
      claimantUserId: joiner.id,
      claimantEmail: joiner.email,
    });
    expect(claimed?.ownerUserId).toBe(joiner.id);
    expect(claimed?.placeholderForEmail).toBeNull();

    // Ownership transferred: the creator no longer owner-reads it.
    expect(await CharacterRepository.findOwnedById(placeholder.id, owner.id)).toBeNull();
    expect(await CharacterRepository.findOwnedById(placeholder.id, joiner.id)).not.toBeNull();
  });

  it('manages items and cards with per-character uniqueness', async () => {
    const owner = await createUser('owner');
    const { campaign } = await createCampaignWithOwner(owner);
    const character = await CharacterRepository.create(db, {
      campaignId: campaign.id,
      ownerUserId: owner.id,
      name: 'Drifter',
      className: 'Drifter',
    });

    const item = await CharacterRepository.addItem(db, {
      characterId: character.id,
      game: 'gloomhaven-2e',
      sourceId: 'gloomhavensecretariat:item/1',
    });
    expect((await CharacterRepository.listItems(character.id)).map((i) => i.id)).toEqual([item.id]);

    // FH/GH2e disallow duplicate item ownership — unique per (character, game, sourceId).
    await expect(
      CharacterRepository.addItem(db, {
        characterId: character.id,
        game: 'gloomhaven-2e',
        sourceId: 'gloomhavensecretariat:item/1',
      }),
    ).rejects.toThrow();

    const card = await CharacterRepository.addCard(db, {
      characterId: character.id,
      game: 'gloomhaven-2e',
      sourceId: 'gloomhavensecretariat:character-ability/100',
    });
    expect(card.role).toBe('owned');
    expect(await CharacterRepository.setCardRole(db, character.id, card.id, 'active')).toBe(true);
    expect((await CharacterRepository.listCards(character.id))[0].role).toBe('active');

    expect(await CharacterRepository.removeItem(db, character.id, item.id)).toBe(true);
    expect(await CharacterRepository.removeCard(db, character.id, card.id)).toBe(true);
    expect(await CharacterRepository.listItems(character.id)).toHaveLength(0);
  });

  it('nulls the successor link when the successor is deleted', async () => {
    const owner = await createUser('owner');
    const { campaign } = await createCampaignWithOwner(owner);
    const retired = await CharacterRepository.create(db, {
      campaignId: campaign.id,
      ownerUserId: owner.id,
      name: 'Old Drifter',
      className: 'Drifter',
    });
    const successor = await CharacterRepository.create(db, {
      campaignId: campaign.id,
      ownerUserId: owner.id,
      name: 'New Blinkblade',
      className: 'Blinkblade',
    });
    await CharacterRepository.update(db, retired.id, {
      expectedVersion: 1,
      status: 'retired',
      successorId: successor.id,
    });

    await CharacterRepository.remove(db, successor.id);
    const reloaded = await CharacterRepository.findOwnedById(retired.id, owner.id);
    expect(reloaded?.status).toBe('retired');
    expect(reloaded?.successorId).toBeNull();
  });
});
