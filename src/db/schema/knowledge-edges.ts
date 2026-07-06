/**
 * knowledge_edges — the typed edge substrate for the whole knowledge space
 * (ADR 0027, SQR-401).
 *
 * Nodes are canonical refs from the existing URI scheme
 * (`rules:<game>/<source>#chunk=N`, `scenario:<game>/<id>`,
 * `section:<game>/<id>`, `card:<game>/<type>/<sourceId>`,
 * `concept:<game>/<slug>`). Edges are directed and typed, and every edge
 * carries the provenance of the ingest job that wrote it so edge families
 * can be re-run independently (`book_references` mirror, concept ingest,
 * supersedes ingest, cross-surface ingest).
 *
 * `book_references` remains the source of record for printed-book links;
 * the seed step mirrors it here (provenance `book_references`) and a parity
 * test guards drift. Scenario/section traversal switches to this substrate
 * once context bundles land (SQR-404); all other kinds read it now.
 */

import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const knowledgeEdges = pgTable(
  'knowledge_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull(),
    fromKind: text('from_kind').notNull(),
    fromRef: text('from_ref').notNull(),
    edgeType: text('edge_type').notNull(),
    toKind: text('to_kind').notNull(),
    toRef: text('to_ref').notNull(),
    /** Which ingest job wrote this edge (e.g. "book_references", "concepts"). */
    provenance: text('provenance').notNull(),
    metadata: jsonb('metadata'),
  },
  (t) => [
    uniqueIndex('knowledge_edges_game_edge_idx').on(t.game, t.fromRef, t.edgeType, t.toRef),
    index('knowledge_edges_from_idx').on(t.game, t.fromRef),
    index('knowledge_edges_to_idx').on(t.game, t.toRef),
    index('knowledge_edges_provenance_idx').on(t.game, t.provenance),
  ],
);
