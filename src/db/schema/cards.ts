/**
 * Card schema: 10 normalized tables, one per Frosthaven card type.
 *
 * Every card table follows the same shape:
 * - `id uuid` synthetic primary key
 * - `game text not null default 'frosthaven'` — pulled forward from Phase 2
 * - `source_id text not null` — the GHS source identifier (e.g.
 *   `gloomhavensecretariat:battle-goal/1301`). This is the canonical natural
 *   key for every card type.
 * - **Unique constraint on `(game, source_id)`** — the only uniqueness
 *   constraint. Replaces the per-type natural-key keys in the original tech
 *   spec, after natural-key verification on 2026-04-07 turned up four
 *   per-type collisions and three latent data-quality bugs (see tech spec
 *   §"Natural key verification").
 * - Per-type natural-key fields (`name`, `level_range`, `number`, `index`,
 *   `card_id`, etc.) remain as regular indexed columns — they're still useful
 *   for query / filter / `getCard` lookups, they just no longer carry the
 *   unique constraint.
 * - `jsonb` columns for nested or variable-shape data (e.g. monster level
 *   stats, scenario objectives, building cost breakdowns).
 *
 * `getCard(type, id)` semantics (for SQR-35): `id` resolves against
 * `source_id`, not the per-type natural key column.
 *
 * ## Hand-migrated columns — drizzle-kit generate warning
 *
 * The `searchVector` tsvector column on every table is a STORED generated
 * column whose real expression lives in the hand-written migration
 * `src/db/migrations/0002_card_fts.sql`. The schema only declares a
 * placeholder marker (`SV_MARKER`) so drizzle-orm excludes the column
 * from INSERT/UPDATE.
 *
 * If you run `npx drizzle-kit generate` against this schema, drizzle-kit
 * will see the placeholder and try to "fix" the expression by emitting a
 * migration that drops and recreates the column with the marker SQL —
 * which would destroy the FTS index and silently break
 * `searchExtracted`/`searchCards`. **Always review drizzle-kit output
 * before committing it.** If drizzle-kit proposes any change to
 * `search_vector` or to `card_*_search_idx`, discard that hunk and update
 * `0002_card_fts.sql` by hand instead.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Postgres `tsvector` column, used for FTS. The column is always a STORED
 * generated column built from text/array columns on each table; the app
 * never writes it directly, it only reads it via `websearch_to_tsquery` /
 * `ts_rank` in `src/extracted-data.ts`.
 *
 * Drizzle has no first-class `tsvector`, so we declare it via `customType`.
 * The generated expression itself lives in the hand-written migration
 * (`0002_card_fts.sql`) — that is the single source of truth for the FTS
 * field lists. We attach `.generatedAlwaysAs(SV_MARKER)`
 * here only as a marker so `drizzle-orm` excludes the column from INSERTs
 * and UPDATEs; the SQL in the marker is never emitted (drizzle-kit's
 * generated-column DDL for custom types is unreliable as of 0.45, so we
 * don't run it).
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

// Placeholder expression for `.generatedAlwaysAs`. Drizzle-orm only cares
// that the column is marked generated so it's excluded from writes; the
// real expression is in `src/db/migrations/0002_card_fts.sql`.
const SV_MARKER = sql`''::tsvector`;

// ─── card_monster_stats ─────────────────────────────────────────────────────

export const cardMonsterStats = pgTable(
  'card_monster_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    sourceId: text('source_id').notNull(),
    name: text('name').notNull(),
    levelRange: text('level_range').notNull(), // '0-3' | '4-7'
    normal: jsonb('normal').notNull(), // { "0": { hp, move, attack }, ... }
    elite: jsonb('elite').notNull(),
    immunities: text('immunities').array().notNull(),
    notes: text('notes'),
    searchVector: tsvector('search_vector').generatedAlwaysAs(SV_MARKER),
  },
  (t) => [
    uniqueIndex('card_monster_stats_game_source_idx').on(t.game, t.sourceId),
    index('card_monster_stats_game_idx').on(t.game),
    index('card_monster_stats_name_idx').on(t.name),
    index('card_monster_stats_search_idx').using('gin', t.searchVector),
  ],
);

// ─── card_monster_abilities ─────────────────────────────────────────────────

export const cardMonsterAbilities = pgTable(
  'card_monster_abilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    sourceId: text('source_id').notNull(),
    monsterType: text('monster_type').notNull(),
    cardName: text('card_name').notNull(),
    initiative: integer('initiative').notNull(),
    abilities: text('abilities').array().notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(SV_MARKER),
  },
  (t) => [
    uniqueIndex('card_monster_abilities_game_source_idx').on(t.game, t.sourceId),
    index('card_monster_abilities_game_idx').on(t.game),
    index('card_monster_abilities_monster_type_idx').on(t.monsterType),
    index('card_monster_abilities_search_idx').using('gin', t.searchVector),
  ],
);

// ─── card_character_abilities ───────────────────────────────────────────────

export const cardCharacterAbilities = pgTable(
  'card_character_abilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    sourceId: text('source_id').notNull(),
    cardName: text('card_name').notNull(),
    characterClass: text('character_class').notNull(),
    // Stored as text because the source value is `number | 'X' | null`.
    level: text('level'),
    initiative: integer('initiative'), // nullable per schema
    top: jsonb('top').notNull(), // { action, effects[] }
    bottom: jsonb('bottom').notNull(),
    lost: boolean('lost').notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(SV_MARKER),
  },
  (t) => [
    uniqueIndex('card_character_abilities_game_source_idx').on(t.game, t.sourceId),
    index('card_character_abilities_game_idx').on(t.game),
    index('card_character_abilities_character_class_idx').on(t.characterClass),
    index('card_character_abilities_search_idx').using('gin', t.searchVector),
  ],
);

// ─── card_character_mats ────────────────────────────────────────────────────

export const cardCharacterMats = pgTable(
  'card_character_mats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    sourceId: text('source_id').notNull(),
    name: text('name').notNull(), // class name, e.g. "Drifter"
    characterClass: text('character_class').notNull(), // race, e.g. "Inox"
    handSize: integer('hand_size').notNull(),
    traits: text('traits').array().notNull(),
    hp: jsonb('hp').notNull(), // { "1": 8, "2": 9, ... }
    perks: text('perks').array().notNull(),
    masteries: text('masteries').array().notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(SV_MARKER),
  },
  (t) => [
    uniqueIndex('card_character_mats_game_source_idx').on(t.game, t.sourceId),
    index('card_character_mats_game_idx').on(t.game),
    index('card_character_mats_name_idx').on(t.name),
    index('card_character_mats_search_idx').using('gin', t.searchVector),
  ],
);

// ─── card_items ─────────────────────────────────────────────────────────────

export const cardItems = pgTable(
  'card_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    sourceId: text('source_id').notNull(),
    // Stored as string because GHS uses zero-padded values like '099'.
    number: text('number').notNull(),
    name: text('name').notNull(),
    // 'head' | 'body' | 'legs' | 'one hand' | 'two hands' | 'small item'
    slot: text('slot').notNull(),
    cost: integer('cost'), // nullable
    effect: text('effect').notNull(),
    uses: integer('uses'), // nullable
    spent: boolean('spent').notNull(),
    lost: boolean('lost').notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(SV_MARKER),
  },
  (t) => [
    uniqueIndex('card_items_game_source_idx').on(t.game, t.sourceId),
    index('card_items_game_idx').on(t.game),
    index('card_items_number_idx').on(t.number),
    index('card_items_slot_idx').on(t.slot),
    index('card_items_search_idx').using('gin', t.searchVector),
  ],
);

// ─── card_events ────────────────────────────────────────────────────────────

export const cardEvents = pgTable(
  'card_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    sourceId: text('source_id').notNull(),
    eventType: text('event_type').notNull(), // 'road' | 'outpost' | 'boat'
    season: text('season'), // 'summer' | 'winter' | null
    number: text('number').notNull(),
    flavorText: text('flavor_text').notNull(),
    optionA: jsonb('option_a').notNull(), // { text, outcome }
    optionB: jsonb('option_b'), // nullable
    optionC: jsonb('option_c'), // nullable
    searchVector: tsvector('search_vector').generatedAlwaysAs(SV_MARKER),
  },
  (t) => [
    uniqueIndex('card_events_game_source_idx').on(t.game, t.sourceId),
    index('card_events_game_idx').on(t.game),
    index('card_events_event_type_idx').on(t.eventType),
    index('card_events_search_idx').using('gin', t.searchVector),
  ],
);

// ─── card_battle_goals ──────────────────────────────────────────────────────

export const cardBattleGoals = pgTable(
  'card_battle_goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    sourceId: text('source_id').notNull(),
    name: text('name').notNull(),
    condition: text('condition').notNull(),
    checkmarks: integer('checkmarks').notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(SV_MARKER),
  },
  (t) => [
    uniqueIndex('card_battle_goals_game_source_idx').on(t.game, t.sourceId),
    index('card_battle_goals_game_idx').on(t.game),
    index('card_battle_goals_search_idx').using('gin', t.searchVector),
  ],
);

// ─── card_buildings ─────────────────────────────────────────────────────────

export const cardBuildings = pgTable(
  'card_buildings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    sourceId: text('source_id').notNull(),
    // Nullable: walls (e.g. Wall J, K, L, M) have no building number in GHS.
    buildingNumber: text('building_number'),
    name: text('name').notNull(),
    level: integer('level').notNull(),
    buildCost: jsonb('build_cost').notNull(), // { gold, lumber, metal, hide }
    effect: text('effect').notNull(),
    notes: text('notes'),
    searchVector: tsvector('search_vector').generatedAlwaysAs(SV_MARKER),
  },
  (t) => [
    uniqueIndex('card_buildings_game_source_idx').on(t.game, t.sourceId),
    index('card_buildings_game_idx').on(t.game),
    index('card_buildings_name_idx').on(t.name),
    index('card_buildings_search_idx').using('gin', t.searchVector),
  ],
);

// ─── card_scenarios ─────────────────────────────────────────────────────────

export const cardScenarios = pgTable(
  'card_scenarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    sourceId: text('source_id').notNull(),
    // 'main' | 'solo' | 'random' — required to disambiguate `index`,
    // which is reused across namespaces (e.g. main scenario 20 and solo
    // scenario 20 both exist).
    scenarioGroup: text('scenario_group').notNull(),
    index: text('index').notNull(),
    name: text('name').notNull(),
    // Nullable: solo class scenarios and the random dungeon ship without a
    // printed complexity value. See src/schemas.ts#ScenarioSchema.
    complexity: integer('complexity'),
    monsters: text('monsters').array().notNull(),
    allies: text('allies').array().notNull(),
    unlocks: text('unlocks').array().notNull(),
    requirements: jsonb('requirements').notNull(),
    objectives: jsonb('objectives').notNull(),
    rewards: text('rewards'), // nullable
    lootDeckConfig: jsonb('loot_deck_config').notNull(),
    flowChartGroup: text('flow_chart_group'),
    initial: boolean('initial').notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(SV_MARKER),
  },
  (t) => [
    uniqueIndex('card_scenarios_game_source_idx').on(t.game, t.sourceId),
    index('card_scenarios_game_idx').on(t.game),
    index('card_scenarios_group_index_idx').on(t.scenarioGroup, t.index),
    index('card_scenarios_search_idx').using('gin', t.searchVector),
  ],
);

// ─── card_personal_quests ───────────────────────────────────────────────────

export const cardPersonalQuests = pgTable(
  'card_personal_quests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    sourceId: text('source_id').notNull(),
    cardId: text('card_id').notNull(),
    altId: text('alt_id').notNull(),
    name: text('name').notNull(),
    requirements: jsonb('requirements').notNull(),
    openEnvelope: text('open_envelope').notNull(),
    errata: text('errata'),
    searchVector: tsvector('search_vector').generatedAlwaysAs(SV_MARKER),
  },
  (t) => [
    uniqueIndex('card_personal_quests_game_source_idx').on(t.game, t.sourceId),
    index('card_personal_quests_game_idx').on(t.game),
    index('card_personal_quests_search_idx').using('gin', t.searchVector),
  ],
);
