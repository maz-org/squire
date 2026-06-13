/**
 * Unlock-graph runtime tables (SQR-267). Seeded from
 * `data/extracted/unlock-graphs/*.json` with prune-then-upsert per
 * `(game, module)` — see `src/seed/seed-unlock-graphs.ts`. The availability
 * service (SQR-268) loads these per campaign module set and derives
 * scenario statuses in process; statuses are never stored.
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const unlockGraphScenarios = pgTable(
  'unlock_graph_scenarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull(),
    module: text('module').notNull(),
    /** Module-local key ('14', 'bruiser'). Qualified form: '<module>:<key>'. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    prereqsAll: text('prereqs_all').array().notNull().default([]),
    prereqsAny: text('prereqs_any').array().notNull().default([]),
    mutex: text('mutex').array().notNull().default([]),
    lockedIf: text('locked_if').array().notNull().default([]),
    manual: boolean('manual').notNull().default(false),
    cond: text('cond'),
    hazard: boolean('hazard').notNull().default(false),
    /** Skippable intro (GH2e scenario 0): may be marked skipped, which counts
     * as done for downstream prereqs but is never itself playable. */
    skippable: boolean('skippable').notNull().default(false),
    /** Character-gated unlock (GH2e solo scenarios): open only when an active
     * character of this class is at level >= unlockMinLevel. Null = not
     * character-gated (the play-prereq / manual model applies). */
    unlockClass: text('unlock_class'),
    unlockMinLevel: integer('unlock_min_level'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('unlock_graph_scenarios_game_module_key_idx').on(t.game, t.module, t.key),
    index('unlock_graph_scenarios_game_module_idx').on(t.game, t.module),
  ],
);

export const unlockGraphThreads = pgTable(
  'unlock_graph_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull(),
    module: text('module').notNull(),
    threadId: text('thread_id').notNull(),
    label: text('label').notNull(),
    note: text('note').notNull().default(''),
    position: integer('position').notNull(),
    keys: text('keys').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('unlock_graph_threads_game_module_thread_idx').on(t.game, t.module, t.threadId),
    index('unlock_graph_threads_game_module_idx').on(t.game, t.module),
  ],
);
