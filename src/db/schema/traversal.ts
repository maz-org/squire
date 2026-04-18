/**
 * Traversal schema: deterministic scenario/section research data.
 *
 * This is the explicit navigation layer for chained scenario/section lookups:
 * - `traversal_scenarios` stores canonical scenario records plus page text
 * - `traversal_sections` stores canonical section records plus full text
 * - `traversal_links` stores normalized edges between scenarios and sections
 *
 * Runtime reads come from Postgres; the checked-in JSON extract is seed
 * material and an inspection artifact, not the production read path.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const traversalScenarios = pgTable(
  'traversal_scenarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    ref: text('ref').notNull(),
    scenarioGroup: text('scenario_group').notNull(),
    scenarioIndex: text('scenario_index').notNull(),
    name: text('name').notNull(),
    complexity: integer('complexity'),
    flowChartGroup: text('flow_chart_group'),
    initial: boolean('initial').notNull().default(false),
    sourcePdf: text('source_pdf'),
    sourcePage: integer('source_page'),
    rawText: text('raw_text'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    uniqueIndex('traversal_scenarios_game_ref_idx').on(t.game, t.ref),
    index('traversal_scenarios_game_idx').on(t.game),
    index('traversal_scenarios_index_idx').on(t.scenarioIndex),
    index('traversal_scenarios_name_idx').on(t.name),
  ],
);

export const traversalSections = pgTable(
  'traversal_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    ref: text('ref').notNull(),
    sectionNumber: integer('section_number').notNull(),
    sectionVariant: integer('section_variant').notNull(),
    sourcePdf: text('source_pdf').notNull(),
    sourcePage: integer('source_page').notNull(),
    text: text('text').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    uniqueIndex('traversal_sections_game_ref_idx').on(t.game, t.ref),
    index('traversal_sections_game_idx').on(t.game),
    index('traversal_sections_number_idx').on(t.sectionNumber),
  ],
);

export const traversalLinks = pgTable(
  'traversal_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    fromKind: text('from_kind').notNull(),
    fromRef: text('from_ref').notNull(),
    toKind: text('to_kind').notNull(),
    toRef: text('to_ref').notNull(),
    linkType: text('link_type').notNull(),
    rawLabel: text('raw_label'),
    rawContext: text('raw_context'),
    sequence: integer('sequence').notNull().default(0),
  },
  (t) => [
    uniqueIndex('traversal_links_game_unique_idx').on(
      t.game,
      t.fromKind,
      t.fromRef,
      t.toKind,
      t.toRef,
      t.linkType,
      t.sequence,
    ),
    index('traversal_links_from_idx').on(t.game, t.fromKind, t.fromRef),
    index('traversal_links_to_idx').on(t.game, t.toKind, t.toRef),
    index('traversal_links_type_idx').on(t.linkType),
  ],
);
