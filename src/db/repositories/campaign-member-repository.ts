/**
 * Campaign membership repository (Phase 4, SQR-18).
 *
 * Membership is the isolation primitive: ADR 0021 requires a membership
 * check on every campaign-scoped request, and `requireActiveMember` is that
 * check's data source. Invite rows are membership rows with status
 * 'invited' and a null userId (the invitee may not have logged in yet);
 * joining binds the user and flips status to 'active'. Leaving flips to
 * 'departed' so audit/journal attribution survives (ADR 0021 §Leave).
 */
import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '../../db.ts';
import type { DbOrTx } from '../../auth/audit.ts';
import { campaignMembers, campaigns } from '../schema/campaigns.ts';
import type { Campaign, CampaignMember, CampaignMemberStatus, CampaignRole } from './types.ts';

type MemberRow = typeof campaignMembers.$inferSelect;

function toDomain(row: MemberRow): CampaignMember {
  return {
    id: row.id,
    campaignId: row.campaignId,
    userId: row.userId,
    inviteEmail: row.inviteEmail,
    invitedByUserId: row.invitedByUserId,
    role: row.role as CampaignRole,
    status: row.status as CampaignMemberStatus,
    joinedAt: row.joinedAt,
    createdAt: row.createdAt,
  };
}

/**
 * The membership check behind every campaign-scoped request. Returns null
 * for non-members AND for invited/departed members — callers translate null
 * into the indistinguishable 404 (ADR 0021 §Non-member access).
 */
export async function findActiveMember(
  campaignId: string,
  userId: string,
): Promise<CampaignMember | null> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(campaignMembers)
    .where(
      and(
        eq(campaignMembers.campaignId, campaignId),
        eq(campaignMembers.userId, userId),
        eq(campaignMembers.status, 'active'),
      ),
    )
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function listMembers(campaignId: string): Promise<CampaignMember[]> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(campaignMembers)
    .where(eq(campaignMembers.campaignId, campaignId))
    .orderBy(campaignMembers.createdAt);
  return rows.map(toDomain);
}

/** Campaigns where the user is an active member, newest activity first. */
export async function listCampaignsForUser(userId: string): Promise<Campaign[]> {
  const { db } = getDb('server');
  const rows = await db
    .select({ campaign: campaigns })
    .from(campaignMembers)
    .innerJoin(campaigns, eq(campaignMembers.campaignId, campaigns.id))
    .where(and(eq(campaignMembers.userId, userId), eq(campaignMembers.status, 'active')))
    .orderBy(desc(campaigns.updatedAt));
  return rows.map((r) => ({
    id: r.campaign.id,
    name: r.campaign.name,
    game: r.campaign.game,
    modules: r.campaign.modules,
    prosperity: r.campaign.prosperity,
    activeScenario: r.campaign.activeScenario,
    playedScenarios: r.campaign.playedScenarios,
    drawnScenarios: r.campaign.drawnScenarios,
    skippedScenarios: r.campaign.skippedScenarios,
    unlockedClasses: r.campaign.unlockedClasses,
    unlockedItems: r.campaign.unlockedItems,
    unlockedBuildings: r.campaign.unlockedBuildings,
    version: r.campaign.version,
    lastSyncedAt: r.campaign.lastSyncedAt,
    syncMethod: r.campaign.syncMethod,
    externalRef: r.campaign.externalRef,
    sourceAuthority: r.campaign.sourceAuthority,
    createdAt: r.campaign.createdAt,
    updatedAt: r.campaign.updatedAt,
  }));
}

/** Pending invites for a user, matched on their account email. */
export async function listPendingInvitesForEmail(email: string): Promise<CampaignMember[]> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(campaignMembers)
    .where(and(eq(campaignMembers.inviteEmail, email), eq(campaignMembers.status, 'invited')))
    .orderBy(campaignMembers.createdAt);
  return rows.map(toDomain);
}

/** Create the owner membership row alongside campaign creation. */
export async function createOwner(
  handle: DbOrTx,
  input: { campaignId: string; userId: string; email: string },
): Promise<CampaignMember> {
  const [row] = await handle
    .insert(campaignMembers)
    .values({
      campaignId: input.campaignId,
      userId: input.userId,
      inviteEmail: input.email,
      role: 'owner',
      status: 'active',
      joinedAt: new Date(),
    })
    .returning();
  return toDomain(row);
}

export async function createInvite(
  handle: DbOrTx,
  input: { campaignId: string; inviteEmail: string; invitedByUserId: string },
): Promise<CampaignMember> {
  const [row] = await handle
    .insert(campaignMembers)
    .values({
      campaignId: input.campaignId,
      inviteEmail: input.inviteEmail,
      invitedByUserId: input.invitedByUserId,
      role: 'member',
      status: 'invited',
    })
    .returning();
  return toDomain(row);
}

/**
 * Bind the joining user to their invite row and activate it. Activation is
 * bound to the invitee identity at the write: the row must still be
 * 'invited' AND its inviteEmail must match the claimant's account email, so
 * a leaked memberId cannot be claimed by another account (ADR 0021).
 */
export async function activateInvite(
  handle: DbOrTx,
  memberId: string,
  claimant: { userId: string; email: string },
): Promise<CampaignMember | null> {
  const [row] = await handle
    .update(campaignMembers)
    .set({ userId: claimant.userId, status: 'active', joinedAt: new Date() })
    .where(
      and(
        eq(campaignMembers.id, memberId),
        eq(campaignMembers.status, 'invited'),
        eq(campaignMembers.inviteEmail, claimant.email),
      ),
    )
    .returning();
  return row ? toDomain(row) : null;
}

/** Leave/remove: keep the row as 'departed' for history attribution. */
export async function markDeparted(handle: DbOrTx, memberId: string): Promise<boolean> {
  const updated = await handle
    .update(campaignMembers)
    .set({ status: 'departed' })
    .where(eq(campaignMembers.id, memberId))
    .returning({ id: campaignMembers.id });
  return updated.length > 0;
}

/**
 * Re-invite a departed member: the row flips back to 'invited' (keeping its
 * user binding) so the rejoin rides the normal accept path — including the
 * join-time allowlist re-check (ADR 0021 §Invites).
 */
export async function reinviteDeparted(
  handle: DbOrTx,
  memberId: string,
  invitedByUserId: string,
): Promise<CampaignMember | null> {
  const [row] = await handle
    .update(campaignMembers)
    .set({ status: 'invited', invitedByUserId, joinedAt: null })
    .where(and(eq(campaignMembers.id, memberId), eq(campaignMembers.status, 'departed')))
    .returning();
  return row ? toDomain(row) : null;
}

/** Rejoin: reactivate a departed membership (ownership of characters is user-bound). */
export async function reactivateDeparted(
  handle: DbOrTx,
  campaignId: string,
  userId: string,
): Promise<CampaignMember | null> {
  const [row] = await handle
    .update(campaignMembers)
    .set({ status: 'active', joinedAt: new Date() })
    .where(
      and(
        eq(campaignMembers.campaignId, campaignId),
        eq(campaignMembers.userId, userId),
        eq(campaignMembers.status, 'departed'),
      ),
    )
    .returning();
  return row ? toDomain(row) : null;
}

export async function countActiveMembers(handle: DbOrTx, campaignId: string): Promise<number> {
  const rows = await handle
    .select({ id: campaignMembers.id })
    .from(campaignMembers)
    .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.status, 'active')));
  return rows.length;
}
