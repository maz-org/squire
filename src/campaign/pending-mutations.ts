/**
 * Propose→confirm machinery for destructive campaign writes (SQR-279,
 * eng decision E2, ADR 0021 §Permission matrix).
 *
 * The destructive set is enumerated and closed: campaign delete, member
 * removal, character delete, character retirement, scenario un-play,
 * prosperity decrease. No channel can apply one in a single shot — the
 * service layer itself rejects them with `ProposalRequiredError`; the only
 * path through is a persisted proposal confirmed by id.
 *
 * Confirm-time revalidation re-checks everything a stale preview could
 * have outrun: proposal status + expiry, exact canonical payload hash,
 * current entity versions vs the snapshot, and membership/permissions via
 * the same service functions that execute the mutation. Transactions never
 * span LLM calls — propose and confirm are separate requests by design.
 *
 * v1 keeps one mutation per proposal (SQR-283 lifts this to atomic
 * session-end batches) and confirm is proposer-only (any-member confirm is
 * a deliberate future loosening, not an accident).
 */
import { createHash } from 'node:crypto';

import { and, eq, lt } from 'drizzle-orm';

import { getDb } from '../db.ts';
import { pendingMutations } from '../db/schema/campaigns.ts';
import * as CampaignRepository from '../db/repositories/campaign-repository.ts';
import * as CharacterRepository from '../db/repositories/character-repository.ts';
import { auditedMutation } from './audit.ts';
import * as CampaignService from './campaign-service.ts';
import {
  CampaignForbiddenError,
  CampaignNotFoundError,
  requireActiveMember,
} from './campaign-service.ts';
import * as CharacterService from './character-service.ts';
import type { CallerIdentity } from './identity.ts';

export const PROPOSAL_TTL_MS = 15 * 60 * 1000;

// ─── Staged mutation descriptors (the enumerated destructive set) ───────────

export type StagedMutation =
  | { type: 'campaign.delete' }
  | { type: 'member.remove'; memberId: string }
  | {
      type: 'campaign.update';
      patch: {
        prosperity?: number;
        playedScenarios?: string[];
        drawnScenarios?: string[];
      };
    }
  | { type: 'character.delete'; characterId: string }
  | { type: 'character.retire'; characterId: string; successorId?: string | null };

export interface PendingProposal {
  id: string;
  campaignId: string;
  proposerUserId: string;
  mutation: StagedMutation;
  payloadHash: string;
  expectedVersions: Record<string, number>;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

// ─── Typed errors ────────────────────────────────────────────────────────────

export class ProposalStateError extends Error {
  readonly code: 'stale_proposal' | 'proposal_expired' | 'proposal_resolved';

  constructor(code: 'stale_proposal' | 'proposal_expired' | 'proposal_resolved', message: string) {
    super(message);
    this.code = code;
    this.name = 'ProposalStateError';
  }
}

// ─── Canonical hashing ───────────────────────────────────────────────────────

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function payloadHashFor(mutation: StagedMutation): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(mutation)))
    .digest('hex');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toProposal(row: typeof pendingMutations.$inferSelect): PendingProposal {
  return {
    id: row.id,
    campaignId: row.campaignId,
    proposerUserId: row.proposerUserId,
    mutation: (row.payload as { mutation: StagedMutation }).mutation,
    payloadHash: row.payloadHash,
    expectedVersions: row.expectedVersions,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/**
 * Pre-validate the proposer could execute this mutation (the same matrix
 * cells confirm re-checks) and snapshot the versions confirm must match.
 */
async function validateAndSnapshot(
  identity: CallerIdentity,
  campaignId: string,
  mutation: StagedMutation,
): Promise<Record<string, number>> {
  const member = await requireActiveMember(campaignId, identity.userId);
  const campaign = await CampaignRepository.findById(campaignId);
  if (!campaign) throw new CampaignNotFoundError();

  switch (mutation.type) {
    case 'campaign.delete':
    case 'member.remove':
      if (member.role !== 'owner') {
        throw new CampaignForbiddenError('Only the owner can propose this mutation');
      }
      return { [campaignId]: campaign.version };
    case 'campaign.update':
      return { [campaignId]: campaign.version };
    case 'character.delete':
    case 'character.retire': {
      const character = await CharacterRepository.findOwnedById(
        mutation.characterId,
        identity.userId,
      );
      // Not yours (or absent) — indistinguishable.
      if (!character || character.campaignId !== campaignId) throw new CampaignNotFoundError();
      return { [mutation.characterId]: character.version };
    }
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export async function propose(
  identity: CallerIdentity,
  campaignId: string,
  mutation: StagedMutation,
): Promise<PendingProposal> {
  const expectedVersions = await validateAndSnapshot(identity, campaignId, mutation);

  return auditedMutation(
    identity,
    { campaignId, mutationType: 'proposal.proposed', entityType: 'proposal' },
    async (tx) => {
      const [row] = await tx
        .insert(pendingMutations)
        .values({
          campaignId,
          proposerUserId: identity.userId,
          payload: { mutation },
          payloadHash: payloadHashFor(mutation),
          expectedVersions,
          expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
        })
        .returning();
      return {
        result: toProposal(row),
        entityId: row.id,
        payloadAfter: { mutation: mutation.type, expiresAt: row.expiresAt.toISOString() },
      };
    },
  );
}

async function loadOwnProposal(
  identity: CallerIdentity,
  proposalId: string,
): Promise<PendingProposal> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(pendingMutations)
    .where(eq(pendingMutations.id, proposalId))
    .limit(1);
  const row = rows[0];
  // Absent, foreign, or non-member proposals are all the same not-found;
  // confirm is proposer-only in v1 (see module header).
  if (!row || row.proposerUserId !== identity.userId) throw new CampaignNotFoundError();
  await requireActiveMember(row.campaignId, identity.userId);
  return toProposal(row);
}

async function markResolved(proposalId: string, status: string): Promise<void> {
  const { db } = getDb('server');
  await db
    .update(pendingMutations)
    .set({ status, resolvedAt: new Date() })
    .where(eq(pendingMutations.id, proposalId));
}

/**
 * Execute one staged mutation through the SAME service functions a direct
 * call would use — the confirmed flag is the only thing that lets them
 * past their destructive gate, and it never crosses a request boundary.
 */
async function execute(identity: CallerIdentity, proposal: PendingProposal): Promise<void> {
  const confirmed = { confirmedProposalId: proposal.id };
  const mutation = proposal.mutation;
  switch (mutation.type) {
    case 'campaign.delete':
      return CampaignService.deleteCampaign(identity, proposal.campaignId, confirmed);
    case 'member.remove':
      return CampaignService.removeMember(
        identity,
        proposal.campaignId,
        mutation.memberId,
        confirmed,
      );
    case 'campaign.update': {
      await CampaignService.updateSharedState(
        identity,
        proposal.campaignId,
        {
          expectedVersion: proposal.expectedVersions[proposal.campaignId],
          ...mutation.patch,
        },
        confirmed,
      );
      return;
    }
    case 'character.delete':
      return CharacterService.deleteCharacter(identity, mutation.characterId, confirmed);
    case 'character.retire': {
      await CharacterService.updateCharacter(
        identity,
        mutation.characterId,
        {
          expectedVersion: proposal.expectedVersions[mutation.characterId],
          status: 'retired',
          successorId: mutation.successorId ?? null,
        },
        confirmed,
      );
      return;
    }
  }
}

export async function confirm(
  identity: CallerIdentity,
  proposalId: string,
): Promise<PendingProposal> {
  const proposal = await loadOwnProposal(identity, proposalId);

  if (proposal.status !== 'proposed') {
    throw new ProposalStateError('proposal_resolved', `Proposal already ${proposal.status}`);
  }
  if (proposal.expiresAt.getTime() <= Date.now()) {
    await markResolved(proposalId, 'expired');
    throw new ProposalStateError('proposal_expired', 'Proposal expired — propose again');
  }
  // Tamper check: the stored payload must still hash to the stored hash.
  if (payloadHashFor(proposal.mutation) !== proposal.payloadHash) {
    await markResolved(proposalId, 'rejected');
    throw new ProposalStateError('stale_proposal', 'Proposal payload integrity check failed');
  }
  // Version re-check: the preview must still describe current state.
  for (const [entityId, expected] of Object.entries(proposal.expectedVersions)) {
    const current =
      entityId === proposal.campaignId
        ? (await CampaignRepository.findById(entityId))?.version
        : (await CharacterRepository.findMemberVisibleById(entityId))?.version;
    if (current !== expected) {
      await markResolved(proposalId, 'rejected');
      throw new ProposalStateError(
        'stale_proposal',
        'State changed since the preview — propose again',
      );
    }
  }

  // Membership + permissions re-validate inside the executing service fn.
  await execute(identity, proposal);
  await markResolved(proposalId, 'confirmed');
  return { ...proposal, status: 'confirmed' };
}

export async function cancel(identity: CallerIdentity, proposalId: string): Promise<void> {
  const proposal = await loadOwnProposal(identity, proposalId);
  if (proposal.status !== 'proposed') {
    throw new ProposalStateError('proposal_resolved', `Proposal already ${proposal.status}`);
  }
  await auditedMutation(
    identity,
    {
      campaignId: proposal.campaignId,
      mutationType: 'proposal.rejected',
      entityType: 'proposal',
      entityId: proposalId,
    },
    async () => {
      await markResolved(proposalId, 'rejected');
      return { result: undefined };
    },
  );
}

/** Cron sweeper (Supercronic, like session sweeping): expire stale rows. */
export async function sweepExpiredProposals(): Promise<number> {
  const { db } = getDb('server');
  const swept = await db
    .update(pendingMutations)
    .set({ status: 'expired', resolvedAt: new Date() })
    .where(and(eq(pendingMutations.status, 'proposed'), lt(pendingMutations.expiresAt, new Date())))
    .returning({ id: pendingMutations.id });
  return swept.length;
}
