/**
 * Domain types for core data models (SQR-38).
 *
 * These are the shapes the rest of the app works with: layout, middleware,
 * route handlers, tests. Repository methods return domain types and accept
 * input types. The Drizzle schema defines the DB columns; these types
 * define the domain contract.
 *
 * Row types ($inferSelect / $inferInsert) and toDomain() mapping functions
 * live inside each repository file, not here. This file is the public
 * contract; the repositories own the persistence boundary.
 */

// ─── User ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  googleSub: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface CreateUserInput {
  googleSub: string;
  email: string;
  name: string | null;
  avatarUrl?: string | null;
}

// ─── Session ────────────────────────────────────────────────────────────────

export interface Session {
  /** Raw session token from the signed cookie. The DB stores only its SHA-256 hash. */
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  lastSeenAt: Date | null;
  user: User;
}

export interface CreateSessionInput {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// ─── Campaign (Phase 4, ADR 0021) ───────────────────────────────────────────

export type CampaignRole = 'owner' | 'member';
export type CampaignMemberStatus = 'invited' | 'active' | 'departed';
export type CharacterStatus = 'active' | 'retired';
export type CharacterCardRole = 'owned' | 'active';

export interface Campaign {
  id: string;
  name: string;
  game: string;
  modules: string[];
  prosperity: number;
  activeScenario: string | null;
  playedScenarios: string[];
  drawnScenarios: string[];
  unlockedClasses: string[];
  unlockedItems: string[];
  unlockedBuildings: string[];
  version: number;
  lastSyncedAt: Date | null;
  syncMethod: string | null;
  externalRef: string | null;
  sourceAuthority: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCampaignInput {
  name: string;
  game: string;
  modules?: string[];
  /** The creating user becomes the campaign owner (ADR 0021 §Roles). */
  ownerUserId: string;
  ownerEmail: string;
}

/**
 * Shared-state patch applied with optimistic CAS (E3): the write succeeds
 * only when `expectedVersion` matches the row, and bumps `version` by one.
 */
export interface UpdateCampaignSharedStateInput {
  expectedVersion: number;
  name?: string;
  prosperity?: number;
  activeScenario?: string | null;
  playedScenarios?: string[];
  drawnScenarios?: string[];
  unlockedClasses?: string[];
  unlockedItems?: string[];
  unlockedBuildings?: string[];
}

export interface CampaignMember {
  id: string;
  campaignId: string;
  userId: string | null;
  inviteEmail: string;
  invitedByUserId: string | null;
  role: CampaignRole;
  status: CampaignMemberStatus;
  joinedAt: Date | null;
  createdAt: Date;
}

export interface Character {
  id: string;
  campaignId: string;
  ownerUserId: string;
  placeholderForEmail: string | null;
  name: string;
  className: string;
  level: number;
  xp: number;
  gold: number;
  perks: number[];
  /** Private tier — only populated on owner-facing reads (ADR 0021). */
  personalQuest: string | null;
  battleGoals: string | null;
  privateNotes: string | null;
  status: CharacterStatus;
  successorId: string | null;
  version: number;
  externalRef: string | null;
  sourceAuthority: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The member-visible projection of another member's character: the private
 * tier is ABSENT at the type level, not nulled — there is no code path that
 * loads it for non-owners (ADR 0021 §LLM context scoping).
 */
export type MemberVisibleCharacter = Omit<
  Character,
  'personalQuest' | 'battleGoals' | 'privateNotes'
>;

export interface CreateCharacterInput {
  campaignId: string;
  ownerUserId: string;
  placeholderForEmail?: string | null;
  name: string;
  className: string;
  level?: number;
  xp?: number;
  gold?: number;
  perks?: number[];
  personalQuest?: string | null;
  battleGoals?: string | null;
  privateNotes?: string | null;
}

export interface UpdateCharacterInput {
  expectedVersion: number;
  name?: string;
  className?: string;
  level?: number;
  xp?: number;
  gold?: number;
  perks?: number[];
  personalQuest?: string | null;
  battleGoals?: string | null;
  privateNotes?: string | null;
  status?: CharacterStatus;
  successorId?: string | null;
}

export interface CharacterItem {
  id: string;
  characterId: string;
  game: string;
  sourceId: string;
  createdAt: Date;
}

export interface CharacterCard {
  id: string;
  characterId: string;
  game: string;
  sourceId: string;
  role: CharacterCardRole;
  createdAt: Date;
}

/** Thrown by CAS writes when `expectedVersion` no longer matches (E3). */
export class VersionConflictError extends Error {
  readonly entityId: string;

  constructor(entityId: string) {
    super(`Version conflict on ${entityId}: re-read and retry`);
    this.name = 'VersionConflictError';
    this.entityId = entityId;
  }
}

// ─── Campaign audit log (ADR 0021 §Audit requirements) ──────────────────────

export type CampaignAuditOutcome = 'success' | 'rejected';

export interface CampaignAuditEntry {
  id: string;
  campaignId: string;
  actorUserId: string;
  mutationType: string;
  channel: string;
  entityType: string;
  entityId: string | null;
  payloadBefore: Record<string, unknown> | null;
  payloadAfter: Record<string, unknown> | null;
  availabilitySnapshot: Record<string, unknown> | null;
  outcome: CampaignAuditOutcome;
  failureReason: string | null;
  createdAt: Date;
}

export interface CreateCampaignAuditInput {
  campaignId: string;
  actorUserId: string;
  mutationType: string;
  channel: string;
  entityType: string;
  entityId?: string | null;
  payloadBefore?: Record<string, unknown> | null;
  payloadAfter?: Record<string, unknown> | null;
  availabilitySnapshot?: Record<string, unknown> | null;
  outcome?: CampaignAuditOutcome;
  failureReason?: string | null;
}

// ─── Conversation ───────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  userId: string;
  creationIdempotencyKey: string | null;
  createdAt: Date;
  lastMessageAt: Date;
}

export interface CreateConversationInput {
  userId: string;
  creationIdempotencyKey?: string | null;
}

export interface ConversationHistoryCursor {
  lastMessageAt: Date;
  id: string;
}

export interface ConversationHistorySummary {
  id: string;
  userId: string;
  createdAt: Date;
  lastMessageAt: Date;
  titleMessageContent: string | null;
  latestMessageContent: string | null;
  latestMessageRole: 'user' | 'assistant' | null;
  latestMessageGame: string | null;
  latestMessageIsError: boolean;
}

export interface ConversationHistoryPage {
  rows: ConversationHistorySummary[];
  nextCursor: ConversationHistoryCursor | null;
}

export type ConversationMessagePublicWorkEventName =
  | 'tool-plan'
  | 'tool-progress'
  | 'tool-result'
  | 'answer-artifact';

export interface ConversationMessagePublicWorkEvent {
  sequence: number;
  event: ConversationMessagePublicWorkEventName;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  /**
   * Runtime game context for user turns. Null for assistant rows and for
   * historical rows written before the active-game selector existed.
   */
  game?: string | null;
  isError: boolean;
  responseToMessageId: string | null;
  /**
   * SQR-98 / SQR-105: provenance values for this assistant turn. Always null
   * for user messages and for assistant messages written before SQR-98.
   *
   * Two storage formats coexist in the DB:
   * - Pre-SQR-105 rows: AgentToolName strings (e.g. "search_rules", "get_section")
   * - Post-SQR-105 rows: ToolSourceLabel strings for search_rules hits
   *   (e.g. "RULEBOOK", "SECTION BOOK"), and AgentToolName strings for all
   *   other tools.
   *
   * `aggregateSourceLabels` in consulted-footer.ts handles both formats at
   * render time — no migration is needed.
   */
  consultedSources: string[] | null;
  /**
   * Completed browser-safe work timeline for this assistant turn, loaded from
   * `message_stream_events` by conversation-service on page-render paths.
   * The payloads are the same public SSE payloads the browser already saw,
   * not raw tool payloads or hidden model reasoning.
   */
  publicWorkEvents?: ConversationMessagePublicWorkEvent[];
  createdAt: Date;
}

export interface CreateConversationMessageInput {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  game?: string | null;
  isError?: boolean;
  responseToMessageId?: string | null;
  /**
   * Write-side accepts plain strings because the capture wrapper in
   * persistAssistantOutcome reads raw tool names off the agent's emit
   * stream — the agent only ever emits known AgentToolName values, but the
   * event payload type is `string`, so forcing AgentToolName[] here would
   * require a cast at every call site for no safety gain. The render path
   * validates and aggregates the strings before showing provenance.
   */
  consultedSources?: string[] | null;
}
