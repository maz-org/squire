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
   */
  consultedSources: string[] | null;
  createdAt: Date;
}

export interface CreateConversationMessageInput {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  responseToMessageId?: string | null;
  consultedSources?: string[] | null;
}
