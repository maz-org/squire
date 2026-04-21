import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './core.ts';

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    creationIdempotencyKey: text('creation_idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('conversations_user_last_message_idx').on(t.userId, t.lastMessageAt),
    uniqueIndex('conversations_user_creation_idempotency_idx').on(
      t.userId,
      t.creationIdempotencyKey,
    ),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    isError: boolean('is_error').notNull().default(false),
    responseToMessageId: uuid('response_to_message_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'cascade',
    }),
    // SQR-98: tool names (from AGENT_TOOLS in src/agent.ts) that fired with
    // ok:true during this answer's turn. Rendered into the footer as
    // provenance labels. Null for user messages and for any assistant
    // message written before SQR-98 landed (pre-migration rows); both
    // render with footer hidden.
    consultedSources: jsonb('consulted_sources').$type<string[] | null>().default(null),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_conversation_created_at_idx').on(t.conversationId, t.createdAt),
    uniqueIndex('messages_response_to_message_id_idx').on(t.responseToMessageId),
  ],
);
