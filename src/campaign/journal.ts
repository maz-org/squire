/**
 * Campaign journal read-model (SQR-266, CEO decision D4.2).
 *
 * A redacted projection that SELECTS FROM the audit log — one-directional
 * coupling, so journal presentation needs can never reshape the security
 * artifact. Redaction is whitelist-based (ADR 0021): payload keys are
 * copied through only when listed for their entity type, so private-tier
 * character fields can never appear no matter what a mutation recorded.
 * Failed/rejected writes and operational metadata (channel, failure
 * reasons) never reach the journal.
 *
 * Entries cluster by calendar day (UTC) — the "session" granularity for the
 * journal surface and the agent's "what happened last session?" reads.
 */
import * as CampaignAuditRepository from '../db/repositories/campaign-audit-repository.ts';
import * as UserRepository from '../db/repositories/user-repository.ts';
import type { CampaignAuditEntry } from '../db/repositories/types.ts';
import { requireActiveMember } from './campaign-service.ts';
import type { CallerIdentity } from './identity.ts';

/** Per-entity payload key whitelists. Private-tier keys are never listed. */
const JOURNAL_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  campaign: [
    'name',
    'game',
    'modules',
    'prosperity',
    'activeScenario',
    'playedScenarios',
    'drawnScenarios',
    'unlockedClasses',
    'unlockedItems',
    'unlockedBuildings',
  ],
  member: ['email', 'status', 'role'],
  character: [
    'name',
    'className',
    'level',
    'xp',
    'gold',
    'perks',
    'perkMarks',
    'masteries',
    'status',
    'successorId',
    'placeholderForEmail',
    'ownerUserId',
  ],
  character_item: ['sourceId', 'game', 'itemId'],
  character_card: ['sourceId', 'game', 'role', 'cardId'],
};

export interface JournalEntry {
  id: string;
  occurredAt: Date;
  actorUserId: string;
  actorName: string | null;
  mutationType: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Derived availability captured at write time (scenario changes only). */
  availabilitySnapshot: Record<string, unknown> | null;
}

export interface JournalDay {
  /** ISO calendar date (UTC), e.g. '2026-06-12'. */
  date: string;
  entries: JournalEntry[];
}

function redactPayload(
  entityType: string,
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!payload) return null;
  const allowed = JOURNAL_PAYLOAD_KEYS[entityType] ?? [];
  const redacted = Object.fromEntries(
    allowed.filter((key) => key in payload).map((key) => [key, payload[key]]),
  );
  return Object.keys(redacted).length > 0 ? redacted : null;
}

async function toJournalEntry(
  entry: CampaignAuditEntry,
  actorNames: Map<string, string | null>,
): Promise<JournalEntry> {
  if (!actorNames.has(entry.actorUserId)) {
    const user = await UserRepository.findById(entry.actorUserId);
    actorNames.set(entry.actorUserId, user?.name ?? null);
  }
  return {
    id: entry.id,
    occurredAt: entry.createdAt,
    actorUserId: entry.actorUserId,
    actorName: actorNames.get(entry.actorUserId) ?? null,
    mutationType: entry.mutationType,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: redactPayload(entry.entityType, entry.payloadBefore),
    after: redactPayload(entry.entityType, entry.payloadAfter),
    availabilitySnapshot: entry.availabilitySnapshot,
  };
}

/** Member-gated journal read: newest day first, newest entry first. */
export async function listJournal(
  identity: CallerIdentity,
  campaignId: string,
  options: { limit?: number } = {},
): Promise<JournalDay[]> {
  await requireActiveMember(campaignId, identity.userId);

  const rows = await CampaignAuditRepository.listByCampaign(campaignId, {
    ...options,
    outcome: 'success',
  });
  const actorNames = new Map<string, string | null>();
  const days = new Map<string, JournalEntry[]>();

  for (const row of rows) {
    const entry = await toJournalEntry(row, actorNames);
    const date = entry.occurredAt.toISOString().slice(0, 10);
    const bucket = days.get(date) ?? [];
    bucket.push(entry);
    days.set(date, bucket);
  }

  return [...days.entries()].map(([date, entries]) => ({ date, entries }));
}
