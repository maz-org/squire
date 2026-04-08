-- Add `search_vector` (tsvector) as a STORED generated column + GIN index
-- to every `card_*` table. This is the single source of truth for the FTS
-- field lists — the schema (src/db/schema/cards.ts) declares the column
-- only as a marker so drizzle-orm excludes it from writes.
--
-- Only text / text[] columns feed the tsvector (no jsonb) — keeps recall
-- sufficient without fighting the generated-column IMMUTABLE constraint.
-- See docs/plans/sqr-34-execution.md §Session B step 2 for the per-table
-- field list rationale.
--
-- Two IMMUTABLE wrapper functions are required because Postgres marks
-- `to_tsvector(regconfig, text)` and `array_to_string(anyarray, text, text)`
-- as STABLE (both do catalog / element-type lookups), and stored generated
-- columns reject anything weaker than IMMUTABLE. Asserting IMMUTABLE is
-- safe here because we don't redefine the 'english' text-search config
-- and we always call `array_to_string` with `text[]`. Query-time FTS in
-- `src/extracted-data.ts` still calls `websearch_to_tsquery('english', ...)`
-- directly — these wrappers exist only for the generated columns.
--
-- DANGER — DO NOT change the 'english' text-search config without
-- rebuilding every `card_*.search_vector` column. The stored tsvectors
-- are frozen lexemes derived from the config at INSERT time; if a future
-- migration does any of these, the index becomes silently wrong and
-- search recall degrades without any error:
--   * `CREATE TEXT SEARCH CONFIGURATION english ...`
--   * `ALTER TEXT SEARCH CONFIGURATION english ...`
--   * `ALTER DATABASE squire SET default_text_search_config = ...`
--   * Dropping or replacing `squire_english_tsv` with a different body
-- If any of those are needed, the correct recipe is: drop the GIN
-- indexes, drop the `search_vector` columns, change the config, re-add
-- the columns (Postgres re-evaluates the generated expression against
-- every existing row), recreate the GIN indexes. Wrap the whole thing
-- in a single transaction so queries never see a half-rebuilt index.

CREATE OR REPLACE FUNCTION squire_english_tsv(text) RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT to_tsvector('english'::regconfig, $1)
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION squire_arr_join(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT array_to_string($1, ' ', '')
  $$;
--> statement-breakpoint

ALTER TABLE card_monster_stats
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    squire_english_tsv(
      coalesce(name, '') || ' ' ||
      coalesce(level_range, '') || ' ' ||
      squire_arr_join(immunities) || ' ' ||
      coalesce(notes, '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_monster_stats_search_idx ON card_monster_stats USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_monster_abilities
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    squire_english_tsv(
      coalesce(monster_type, '') || ' ' ||
      coalesce(card_name, '') || ' ' ||
      squire_arr_join(abilities)
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_monster_abilities_search_idx ON card_monster_abilities USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_character_abilities
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    squire_english_tsv(
      coalesce(card_name, '') || ' ' ||
      coalesce(character_class, '') || ' ' ||
      coalesce(level, '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_character_abilities_search_idx ON card_character_abilities USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_character_mats
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    squire_english_tsv(
      coalesce(name, '') || ' ' ||
      coalesce(character_class, '') || ' ' ||
      squire_arr_join(traits) || ' ' ||
      squire_arr_join(perks) || ' ' ||
      squire_arr_join(masteries)
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_character_mats_search_idx ON card_character_mats USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_items
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    squire_english_tsv(
      coalesce(number, '') || ' ' ||
      coalesce(name, '') || ' ' ||
      coalesce(slot, '') || ' ' ||
      coalesce(effect, '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_items_search_idx ON card_items USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_events
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    squire_english_tsv(
      coalesce(event_type, '') || ' ' ||
      coalesce(season, '') || ' ' ||
      coalesce(number, '') || ' ' ||
      coalesce(flavor_text, '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_events_search_idx ON card_events USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_battle_goals
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    squire_english_tsv(
      coalesce(name, '') || ' ' ||
      coalesce(condition, '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_battle_goals_search_idx ON card_battle_goals USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_buildings
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    squire_english_tsv(
      coalesce(building_number, '') || ' ' ||
      coalesce(name, '') || ' ' ||
      coalesce(effect, '') || ' ' ||
      coalesce(notes, '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_buildings_search_idx ON card_buildings USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_scenarios
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    squire_english_tsv(
      coalesce(scenario_group, '') || ' ' ||
      coalesce(index, '') || ' ' ||
      coalesce(name, '') || ' ' ||
      squire_arr_join(monsters) || ' ' ||
      squire_arr_join(allies) || ' ' ||
      squire_arr_join(unlocks) || ' ' ||
      coalesce(rewards, '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_scenarios_search_idx ON card_scenarios USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_personal_quests
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    squire_english_tsv(
      coalesce(card_id, '') || ' ' ||
      coalesce(name, '') || ' ' ||
      coalesce(open_envelope, '')
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_personal_quests_search_idx ON card_personal_quests USING gin(search_vector);
