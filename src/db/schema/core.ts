/**
 * Core schema: users, sessions, rule-source embeddings.
 *
 * - `users` and `sessions` are shells in Phase 1 — populated a day later by the
 *   User Accounts project. They exist now so the auth tables can `references()`
 *   them and so SQR-32's migration can create everything in one shot.
 * - `rule_source_embeddings` holds the active indexed-book RAG vectors.
 *   Includes `game`, `embedding_version` as a code-vs-data drift guard (see
 *   tech spec §Drift guard), and `content_hash` so data-only source changes can
 *   invalidate stale derived rows.
 *
 * The HNSW index is declared via raw SQL in the migration (SQR-32) rather
 * than here, because Drizzle's index builder doesn't yet support pgvector
 * operator classes — see tech spec §pgvector operator sign-flip.
 */

import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // SHA-256 hex of the opaque session token
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

// ─── Embeddings ─────────────────────────────────────────────────────────────

export const ruleSourceEmbeddings = pgTable(
  'rule_source_embeddings',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    text: text('text').notNull(),
    // Voyage voyage-4-large produces 1024-dimensional vectors for this corpus.
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    game: text('game').notNull().default('frosthaven'),
    embeddingVersion: text('embedding_version').notNull(),
    contentHash: text('content_hash'),
  },
  (t) => [
    uniqueIndex('rule_source_embeddings_game_source_chunk_idx').on(t.game, t.source, t.chunkIndex),
    index('rule_source_embeddings_game_idx').on(t.game),
  ],
);
