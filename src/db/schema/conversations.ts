import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  integer,
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
    // Runtime context for user turns only. Keep nullable: assistant rows and
    // historical rows do not have their own selected game, and messages are
    // fetched by conversation rather than filtered by game.
    game: text('game'),
    // Per-message campaign binding (SQR-19, eng E6). Plain uuid, no FK:
    // history must keep rendering after a campaign is deleted. Null =
    // legacy/no-campaign message (selector behavior).
    campaignId: uuid('campaign_id'),
    isError: boolean('is_error').notNull().default(false),
    responseToMessageId: uuid('response_to_message_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'cascade',
    }),
    // SQR-98: selectable agent tool names that fired with
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

export const messageStreamEvents = pgTable(
  'message_stream_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userMessageId: uuid('user_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('message_stream_events_user_message_sequence_idx').on(t.userMessageId, t.sequence),
    uniqueIndex('message_stream_events_user_message_terminal_idx')
      .on(t.userMessageId)
      .where(sql`${t.event} in ('done', 'error')`),
    index('message_stream_events_conversation_message_idx').on(t.conversationId, t.userMessageId),
  ],
);
