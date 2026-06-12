/**
 * Campaign lifecycle + membership service (Phase 4, SQR-21).
 *
 * This is the ADR 0021 enforcement point for campaign-scoped operations:
 * every function takes a `CallerIdentity` and decides visibility/permission
 * against the contract's matrix BEFORE touching repositories. Routes stay
 * thin — they translate typed errors into HTTP shapes and never make
 * authorization decisions themselves.
 *
 * Non-members (and invited/departed members) get `CampaignNotFoundError` on
 * campaign-scoped reads and writes — indistinguishable from an absent id
 * (ADR 0021 §Non-member access). Members hitting owner-only mutations get
 * `CampaignForbiddenError`: the campaign's existence is already known to
 * them, so a 403 leaks nothing.
 *
 * The allowlist is checked at campaign create, invite AND join time
 * (ADR 0021 §Invites): a lapsed allowlist entry blocks the join even when
 * the invite row still exists.
 */
import { getAllowedEmails } from '../auth/google.ts';
import * as CampaignRepository from '../db/repositories/campaign-repository.ts';
import * as CampaignMemberRepository from '../db/repositories/campaign-member-repository.ts';
import * as UserRepository from '../db/repositories/user-repository.ts';
import type {
  Campaign,
  CampaignMember,
  CampaignMemberStatus,
  CampaignRole,
  UpdateCampaignSharedStateInput,
} from '../db/repositories/types.ts';
import { normalizeGameId } from '../game.ts';
import { auditedMutation } from './audit.ts';
import { deriveAvailability } from './availability.ts';
import type { CallerIdentity } from './identity.ts';
import { loadModuleGraphs } from './unlock-graph-loader.ts';

// ─── Typed errors (routes map these to HTTP shapes) ─────────────────────────

/** Absent id and non-member access are deliberately the same error. */
export class CampaignNotFoundError extends Error {
  readonly code = 'not_found';

  constructor() {
    super('Not found');
    this.name = 'CampaignNotFoundError';
  }
}

/** A real member attempting a mutation outside their role's matrix cells. */
export class CampaignForbiddenError extends Error {
  readonly code = 'forbidden';

  constructor(message: string) {
    super(message);
    this.name = 'CampaignForbiddenError';
  }
}

export class NotAllowlistedError extends Error {
  readonly code = 'not_allowlisted';

  constructor() {
    super('That email is not on the invite allowlist');
    this.name = 'NotAllowlistedError';
  }
}

/**
 * ADR 0021: the last member cannot leave, and the single owner cannot leave
 * while the campaign exists — both resolve to "delete the campaign instead"
 * (ownership transfer is future work). Since the owner can never leave, the
 * sole-member case is always the owner and this one error covers both rules.
 */
export class OwnerCannotLeaveError extends Error {
  readonly code = 'owner_cannot_leave';

  constructor() {
    super('The owner cannot leave a campaign; delete the campaign instead');
    this.name = 'OwnerCannotLeaveError';
  }
}

export class AlreadyInvitedError extends Error {
  readonly code = 'already_invited';

  constructor(status: CampaignMemberStatus) {
    super(status === 'active' ? 'Already a member' : 'Already invited');
    this.name = 'AlreadyInvitedError';
  }
}

export class UnsupportedGameError extends Error {
  readonly code = 'unsupported_game';

  constructor(game: string) {
    super(`Unsupported game: ${game}`);
    this.name = 'UnsupportedGameError';
  }
}

// ─── Views ───────────────────────────────────────────────────────────────────

/** Roster entry: membership facts are shared-tier data among members. */
export interface RosterMember {
  memberId: string;
  userId: string | null;
  email: string;
  name: string | null;
  role: CampaignRole;
  status: CampaignMemberStatus;
  joinedAt: Date | null;
}

export interface CampaignDetail {
  campaign: Campaign;
  members: RosterMember[];
  self: { memberId: string; role: CampaignRole };
}

/** The invite carve-out record: minimal, only via the invitee's own list. */
export interface PendingInvite {
  memberId: string;
  campaignName: string;
  game: string;
  inviterName: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertAllowlisted(email: string): void {
  if (!getAllowedEmails().includes(email.toLowerCase())) {
    throw new NotAllowlistedError();
  }
}

/** Drizzle wraps PG errors as DrizzleQueryError with the original in `cause`. */
function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: string }).code === '23505'
  );
}

/**
 * The membership gate on every campaign-scoped operation. Shared with the
 * character service (SQR-22) so both enforce the same contract.
 */
export async function requireActiveMember(
  campaignId: string,
  userId: string,
): Promise<CampaignMember> {
  const member = await CampaignMemberRepository.findActiveMember(campaignId, userId);
  if (!member) throw new CampaignNotFoundError();
  return member;
}

export async function requireUser(userId: string) {
  const user = await UserRepository.findById(userId);
  // Identities come from verified sessions/tokens, so a missing user row
  // means a deleted account still holding credentials — treat as not found.
  if (!user) throw new CampaignNotFoundError();
  return user;
}

async function rosterFor(campaignId: string): Promise<RosterMember[]> {
  const members = await CampaignMemberRepository.listMembers(campaignId);
  const roster: RosterMember[] = [];
  for (const member of members) {
    const user = member.userId ? await UserRepository.findById(member.userId) : null;
    roster.push({
      memberId: member.id,
      userId: member.userId,
      email: member.inviteEmail,
      name: user?.name ?? null,
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt,
    });
  }
  return roster;
}

// ─── Campaign lifecycle ──────────────────────────────────────────────────────

export async function createCampaign(
  identity: CallerIdentity,
  input: { name: string; game: string; modules?: string[] },
): Promise<Campaign> {
  // Pre-campaign rejections (allowlist, bad game) have no campaign to audit
  // against; they surface through the security log on the route layer.
  const user = await requireUser(identity.userId);
  assertAllowlisted(user.email);

  const game = normalizeGameId(input.game);
  if (!game) throw new UnsupportedGameError(input.game);

  return auditedMutation(
    identity,
    { mutationType: 'campaign.create', entityType: 'campaign' },
    async (tx) => {
      const campaign = await CampaignRepository.create(tx, {
        name: input.name,
        game,
        modules: input.modules,
      });
      await CampaignMemberRepository.createOwner(tx, {
        campaignId: campaign.id,
        userId: user.id,
        email: user.email,
      });
      return {
        result: campaign,
        campaignId: campaign.id,
        entityId: campaign.id,
        payloadAfter: { name: campaign.name, game: campaign.game, modules: campaign.modules },
      };
    },
  );
}

export async function listMyCampaigns(identity: CallerIdentity): Promise<Campaign[]> {
  return CampaignMemberRepository.listCampaignsForUser(identity.userId);
}

export async function getCampaignDetail(
  identity: CallerIdentity,
  campaignId: string,
): Promise<CampaignDetail> {
  const member = await requireActiveMember(campaignId, identity.userId);
  const campaign = await CampaignRepository.findById(campaignId);
  if (!campaign) throw new CampaignNotFoundError();
  return {
    campaign,
    members: await rosterFor(campaignId),
    self: { memberId: member.id, role: member.role },
  };
}

/**
 * Shared-state CAS write (E3). Any member may edit shared state; the
 * destructive subset (scenario un-play, prosperity decrease) joins the
 * propose→confirm gate when the pending-mutations mechanism lands.
 * TODO(SQR-279): route un-play / prosperity-decrease through proposals.
 */
export async function updateSharedState(
  identity: CallerIdentity,
  campaignId: string,
  input: UpdateCampaignSharedStateInput,
): Promise<Campaign> {
  return auditedMutation(
    identity,
    { campaignId, mutationType: 'campaign.update', entityType: 'campaign', entityId: campaignId },
    async (tx) => {
      await requireActiveMember(campaignId, identity.userId);
      const before = await CampaignRepository.findById(campaignId);
      if (!before) throw new CampaignNotFoundError();
      const updated = await CampaignRepository.updateSharedState(tx, campaignId, input);

      // Audit payloads carry only the touched fields, before and after.
      const changedKeys = Object.keys(input).filter((key) => key !== 'expectedVersion');
      const pick = (campaign: Campaign) =>
        Object.fromEntries(
          changedKeys.map((key) => [key, (campaign as unknown as Record<string, unknown>)[key]]),
        );

      // Scenario-state changes snapshot derived availability so journal
      // entries stay true even after the unlock-graph seed evolves
      // (constraint 10).
      let availabilitySnapshot: Record<string, unknown> | null = null;
      if (input.playedScenarios !== undefined || input.drawnScenarios !== undefined) {
        const graphs = await loadModuleGraphs(updated.game, updated.modules);
        const availability = deriveAvailability(
          graphs,
          new Set(updated.playedScenarios),
          new Set(updated.drawnScenarios),
        );
        availabilitySnapshot = {
          statuses: Object.fromEntries(availability.statuses),
          unknownKeys: availability.unknownKeys,
          hazardWarnings: availability.hazardWarnings,
        };
      }

      return {
        result: updated,
        payloadBefore: pick(before),
        payloadAfter: pick(updated),
        availabilitySnapshot,
      };
    },
  );
}

/** Owner-only; cascades domain rows while audit rows survive (ADR 0021). */
export async function deleteCampaign(identity: CallerIdentity, campaignId: string): Promise<void> {
  await auditedMutation(
    identity,
    { campaignId, mutationType: 'campaign.delete', entityType: 'campaign', entityId: campaignId },
    async (tx) => {
      const member = await requireActiveMember(campaignId, identity.userId);
      if (member.role !== 'owner') {
        throw new CampaignForbiddenError('Only the owner can delete a campaign');
      }
      const before = await CampaignRepository.findById(campaignId);
      if (!before) throw new CampaignNotFoundError();
      // TODO(SQR-279): destructive — route through propose→confirm once the
      // pending-mutations mechanism exists.
      await CampaignRepository.remove(tx, campaignId);
      return {
        result: undefined,
        payloadBefore: { name: before.name, game: before.game, modules: before.modules },
      };
    },
  );
}

// ─── Membership ──────────────────────────────────────────────────────────────

export async function inviteMember(
  identity: CallerIdentity,
  campaignId: string,
  rawEmail: string,
): Promise<RosterMember> {
  const invite = await auditedMutation(
    identity,
    { campaignId, mutationType: 'member.invite', entityType: 'member' },
    async (tx) => {
      const actor = await requireActiveMember(campaignId, identity.userId);
      if (actor.role !== 'owner') {
        throw new CampaignForbiddenError('Only the owner can invite members');
      }

      const email = rawEmail.trim().toLowerCase();
      assertAllowlisted(email);

      const members = await CampaignMemberRepository.listMembers(campaignId);
      const existing = members.find((m) => m.inviteEmail.toLowerCase() === email);

      let row: CampaignMember;
      if (!existing) {
        try {
          row = await CampaignMemberRepository.createInvite(tx, {
            campaignId,
            inviteEmail: email,
            invitedByUserId: identity.userId,
          });
        } catch (error) {
          // Read-then-write race: a concurrent invite for the same email won
          // the (campaign_id, invite_email) unique index. Same outcome as
          // having seen the row up front.
          if (isUniqueViolation(error)) throw new AlreadyInvitedError('invited');
          throw error;
        }
      } else if (existing.status === 'departed') {
        // Rejoin keeps the user binding so character ownership survives; the
        // accept path still runs (consent + join-time allowlist re-check).
        const revived = await CampaignMemberRepository.reinviteDeparted(
          tx,
          existing.id,
          identity.userId,
        );
        if (!revived) throw new AlreadyInvitedError(existing.status);
        row = revived;
      } else {
        throw new AlreadyInvitedError(existing.status);
      }

      return {
        result: row,
        entityId: row.id,
        payloadAfter: { email: row.inviteEmail, status: row.status },
      };
    },
  );

  const user = invite.userId ? await UserRepository.findById(invite.userId) : null;
  return {
    memberId: invite.id,
    userId: invite.userId,
    email: invite.inviteEmail,
    name: user?.name ?? null,
    role: invite.role,
    status: invite.status,
    joinedAt: invite.joinedAt,
  };
}

/** The invitee's own invite list — the only non-member campaign visibility. */
export async function listMyInvites(identity: CallerIdentity): Promise<PendingInvite[]> {
  const user = await requireUser(identity.userId);
  const invites = await CampaignMemberRepository.listPendingInvitesForEmail(
    user.email.toLowerCase(),
  );
  const views: PendingInvite[] = [];
  for (const invite of invites) {
    const campaign = await CampaignRepository.findById(invite.campaignId);
    if (!campaign) continue;
    const inviter = invite.invitedByUserId
      ? await UserRepository.findById(invite.invitedByUserId)
      : null;
    views.push({
      memberId: invite.id,
      campaignName: campaign.name,
      game: campaign.game,
      inviterName: inviter?.name ?? null,
    });
  }
  return views;
}

export async function acceptInvite(identity: CallerIdentity, memberId: string): Promise<Campaign> {
  const user = await requireUser(identity.userId);
  // Join-time allowlist re-check: a lapsed entry blocks the join even though
  // the invite row exists (ADR 0021 §Invites). Rejections before the invite
  // resolves have no campaign to audit against (see audit.ts header).
  assertAllowlisted(user.email);

  return auditedMutation(
    identity,
    { mutationType: 'member.join', entityType: 'member', entityId: memberId },
    async (tx) => {
      const activated = await CampaignMemberRepository.activateInvite(tx, memberId, {
        userId: user.id,
        email: user.email.toLowerCase(),
      });
      // Wrong member id, someone else's invite, or already accepted — all the
      // same indistinguishable not-found.
      if (!activated) throw new CampaignNotFoundError();

      const campaign = await CampaignRepository.findById(activated.campaignId);
      if (!campaign) throw new CampaignNotFoundError();
      return {
        result: campaign,
        campaignId: campaign.id,
        payloadAfter: { email: activated.inviteEmail, status: activated.status },
      };
    },
  );
}

export async function leaveCampaign(identity: CallerIdentity, campaignId: string): Promise<void> {
  await auditedMutation(
    identity,
    { campaignId, mutationType: 'member.leave', entityType: 'member' },
    async (tx) => {
      const member = await requireActiveMember(campaignId, identity.userId);
      if (member.role === 'owner') throw new OwnerCannotLeaveError();
      await CampaignMemberRepository.markDeparted(tx, member.id);
      return {
        result: undefined,
        entityId: member.id,
        payloadBefore: { email: member.inviteEmail, status: member.status },
        payloadAfter: { email: member.inviteEmail, status: 'departed' },
      };
    },
  );
}

export async function removeMember(
  identity: CallerIdentity,
  campaignId: string,
  targetMemberId: string,
): Promise<void> {
  await auditedMutation(
    identity,
    {
      campaignId,
      mutationType: 'member.remove',
      entityType: 'member',
      entityId: targetMemberId,
    },
    async (tx) => {
      const actor = await requireActiveMember(campaignId, identity.userId);
      if (actor.role !== 'owner') {
        throw new CampaignForbiddenError('Only the owner can remove members');
      }
      if (actor.id === targetMemberId) {
        throw new CampaignForbiddenError('Owners cannot remove themselves; delete the campaign');
      }

      const members = await CampaignMemberRepository.listMembers(campaignId);
      const target = members.find((m) => m.id === targetMemberId);
      // A member id from another campaign is indistinguishable from absent.
      if (!target) throw new CampaignNotFoundError();
      if (target.status === 'departed') {
        return { result: undefined, payloadBefore: { status: 'departed' } }; // idempotent
      }

      // TODO(SQR-279): destructive — route through propose→confirm once the
      // pending-mutations mechanism exists.
      await CampaignMemberRepository.markDeparted(tx, target.id);
      return {
        result: undefined,
        payloadBefore: { email: target.inviteEmail, status: target.status },
        payloadAfter: { email: target.inviteEmail, status: 'departed' },
      };
    },
  );
}
