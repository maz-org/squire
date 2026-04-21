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

import type { AgentToolName } from '../../agent.ts';

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  isError: boolean;
  responseToMessageId: string | null;
  /**
   * SQR-98: tool names (from AGENT_TOOLS in src/agent.ts) that fired with
   * ok:true during this assistant answer's turn. Rendered as provenance
   * labels in the tool-call footer. Always null for user messages and
   * for assistant messages written before SQR-98 landed.
   *
   * Typed as AgentToolName[] so a caller that adds a new tool to
   * AGENT_TOOLS has the domain contract in sync with TOOL_SOURCE_LABELS.
   * At the DB boundary the column is raw jsonb — toDomain() trusts that
   * the write-side only ever inserts tool names from AGENT_TOOLS, which
   * is enforced by the capture wrapper in persistAssistantOutcome.
   */
  consultedSources: AgentToolName[] | null;
  createdAt: Date;
}

export interface CreateConversationMessageInput {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  responseToMessageId?: string | null;
  /**
   * Write-side accepts plain strings because the capture wrapper in
   * persistAssistantOutcome reads raw tool names off the agent's emit
   * stream — the agent only ever emits names from AGENT_TOOLS, but the
   * event payload type is `string`, so forcing AgentToolName[] here
   * would require a cast at every call site for no safety gain. The
   * read-side ConversationMessage.consultedSources narrows to
   * AgentToolName[] after toDomain, which is where the contract is
   * actually useful (render path).
   */
  consultedSources?: string[] | null;
}
