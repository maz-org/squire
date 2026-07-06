/**
 * knowledge_concepts — the concept-node registry for the knowledge graph
 * (ADR 0027, SQR-402).
 *
 * A concept is a curated game term — a condition, keyword, or core mechanic
 * (Muddle, Retaliate, advantage, two-speed initiative). The row is the node;
 * its ref is `concept:<game>/<slug>`. Edges into the concept live in
 * `knowledge_edges` with provenance `concepts`: rules chunks `defines` /
 * `clarifies` it, cards `references` it. The curated source of record is
 * `src/seed/concepts-data.ts`; the seed replaces rows per game.
 */

import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const knowledgeConcepts = pgTable(
  'knowledge_concepts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** 'condition' | 'keyword' | 'mechanic' */
    category: text('category').notNull(),
    /** Alternate surface forms used for resolution and ingest matching. */
    aliases: jsonb('aliases').notNull().$type<string[]>(),
  },
  (t) => [
    uniqueIndex('knowledge_concepts_game_slug_idx').on(t.game, t.slug),
    index('knowledge_concepts_game_idx').on(t.game),
  ],
);
