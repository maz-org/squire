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
  firstUserMessageContent: string | null;
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
