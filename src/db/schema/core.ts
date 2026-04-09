/**
 * Core schema: users, sessions, embeddings.
 *
 * - `users` and `sessions` are shells in Phase 1 — populated a day later by the
 *   User Accounts project. They exist now so the auth tables can `references()`
 *   them and so SQR-32's migration can create everything in one shot.
 * - `embeddings` holds the rulebook RAG vectors (replaces `data/index.json`).
 *   Includes `game` (default 'frosthaven') from day 1 — pulled forward from
 *   Phase 2 to avoid an ALTER TABLE later. Includes `embedding_version` as a
 *   code-vs-data drift guard (see tech spec §Drift guard).
 *
 * The HNSW index is declared via raw SQL in the migration (SQR-32) rather
 * than here, because Drizzle's index builder doesn't yet support pgvector
 * operator classes — see tech spec §pgvector operator sign-flip.
 */

import { relations } from 'drizzle-orm';
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // opaque session token
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

// ─── Relations (for Drizzle relational queries) ─────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

// ─── Embeddings ─────────────────────────────────────────────────────────────

export const embeddings = pgTable(
  'embeddings',
  {
    // Preserves the existing `${source}::${chunkIndex}` ID shape used today.
    id: text('id').primaryKey(),
    source: text('source').notNull(), // PDF filename basename
    chunkIndex: integer('chunk_index').notNull(),
    text: text('text').notNull(),
    // Xenova MiniLM-L6-v2 produces 384-dimensional pre-normalized vectors.
    embedding: vector('embedding', { dimensions: 384 }).notNull(),
    // `game` ships in Phase 1 so SQR-32 doesn't need an ALTER TABLE later.
    // Phase 2 wires `index-docs.ts` to derive game from filename prefix.
    game: text('game').notNull().default('frosthaven'),
    // Bumped whenever chunking logic or the embedder changes — see drift guard.
    embeddingVersion: text('embedding_version').notNull(),
  },
  (t) => [
    uniqueIndex('embeddings_source_chunk_idx').on(t.source, t.chunkIndex),
    index('embeddings_game_idx').on(t.game),
    // HNSW index is added in the migration (raw SQL) — Drizzle's index builder
    // doesn't expose pgvector operator classes yet. Placeholder reference here
    // so future readers know where to look:
    //   CREATE INDEX embeddings_hnsw_idx ON embeddings
    //     USING hnsw (embedding vector_cosine_ops);
  ],
);
