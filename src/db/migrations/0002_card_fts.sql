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
-- ## Field weights (ts_rank label → meaning)
--
-- Fields are weighted so a user searching "algox archer" gets the monster
-- stats row first, not a scenario that happens to list Algox Archer in its
-- `monsters` array. Postgres FTS uses four weight labels:
--
--   A — the canonical name of the thing itself (name, card_name)
--   B — secondary identifiers / categories (class, slot, event_type, ...)
--   C — prose description (effect, notes, flavor_text, condition, ...)
--   D — cross-reference arrays (immunities, monsters, allies, perks, ...)
--
-- `searchExtractedRanked` in src/extracted-data.ts passes
-- `'{0.1, 0.2, 0.4, 1.0}'::float4[]` to `ts_rank`, which maps to
-- `{D, C, B, A}`. A direct name match is ~10x a cross-reference array hit.
--
-- ## IMMUTABLE wrapper functions
--
-- Two IMMUTABLE wrapper functions are required because Postgres marks
-- `to_tsvector(regconfig, text)` and `array_to_string(anyarray, text, text)`
-- as STABLE (both do catalog / element-type lookups), and stored generated
-- columns reject anything weaker than IMMUTABLE. Asserting IMMUTABLE is
-- safe here because we don't redefine the 'english' text-search config
-- and we always call `array_to_string` with `text[]`. Query-time FTS in
-- `src/extracted-data.ts` still calls `websearch_to_tsquery('english', ...)`
-- directly — these wrappers exist only for the generated columns.
-- `setweight(tsvector, char)` is already IMMUTABLE in core Postgres, so it
-- goes directly in the expression.
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
    setweight(squire_english_tsv(coalesce(name, '')), 'A') ||
    setweight(squire_english_tsv(coalesce(level_range, '')), 'B') ||
    setweight(squire_english_tsv(squire_arr_join(immunities)), 'D') ||
    setweight(squire_english_tsv(coalesce(notes, '')), 'C')
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_monster_stats_search_idx ON card_monster_stats USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_monster_abilities
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(squire_english_tsv(coalesce(card_name, '')), 'A') ||
    setweight(squire_english_tsv(coalesce(monster_type, '')), 'B') ||
    setweight(squire_english_tsv(squire_arr_join(abilities)), 'D')
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_monster_abilities_search_idx ON card_monster_abilities USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_character_abilities
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(squire_english_tsv(coalesce(card_name, '')), 'A') ||
    setweight(squire_english_tsv(coalesce(character_class, '')), 'B') ||
    setweight(squire_english_tsv(coalesce(level, '')), 'C')
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_character_abilities_search_idx ON card_character_abilities USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_character_mats
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(squire_english_tsv(coalesce(name, '')), 'A') ||
    setweight(squire_english_tsv(coalesce(character_class, '')), 'B') ||
    setweight(squire_english_tsv(squire_arr_join(traits)), 'C') ||
    setweight(squire_english_tsv(squire_arr_join(perks)), 'D') ||
    setweight(squire_english_tsv(squire_arr_join(masteries)), 'D')
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_character_mats_search_idx ON card_character_mats USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_items
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(squire_english_tsv(coalesce(name, '')), 'A') ||
    setweight(squire_english_tsv(coalesce(slot, '')), 'B') ||
    setweight(squire_english_tsv(coalesce(number, '')), 'B') ||
    setweight(squire_english_tsv(coalesce(effect, '')), 'C')
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_items_search_idx ON card_items USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_events
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(squire_english_tsv(coalesce(flavor_text, '')), 'A') ||
    setweight(squire_english_tsv(coalesce(event_type, '')), 'B') ||
    setweight(squire_english_tsv(coalesce(season, '')), 'B') ||
    setweight(squire_english_tsv(coalesce(number, '')), 'B')
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_events_search_idx ON card_events USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_battle_goals
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(squire_english_tsv(coalesce(name, '')), 'A') ||
    setweight(squire_english_tsv(coalesce(condition, '')), 'C')
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_battle_goals_search_idx ON card_battle_goals USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_buildings
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(squire_english_tsv(coalesce(name, '')), 'A') ||
    setweight(squire_english_tsv(coalesce(building_number, '')), 'B') ||
    setweight(squire_english_tsv(coalesce(effect, '')), 'C') ||
    setweight(squire_english_tsv(coalesce(notes, '')), 'C')
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_buildings_search_idx ON card_buildings USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_scenarios
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(squire_english_tsv(coalesce(name, '')), 'A') ||
    setweight(squire_english_tsv(coalesce(scenario_group, '')), 'B') ||
    setweight(squire_english_tsv(coalesce(index, '')), 'B') ||
    setweight(squire_english_tsv(squire_arr_join(monsters)), 'D') ||
    setweight(squire_english_tsv(squire_arr_join(allies)), 'D') ||
    setweight(squire_english_tsv(squire_arr_join(unlocks)), 'D') ||
    setweight(squire_english_tsv(coalesce(rewards, '')), 'C')
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_scenarios_search_idx ON card_scenarios USING gin(search_vector);
--> statement-breakpoint

ALTER TABLE card_personal_quests
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(squire_english_tsv(coalesce(name, '')), 'A') ||
    setweight(squire_english_tsv(coalesce(card_id, '')), 'B') ||
    setweight(squire_english_tsv(coalesce(open_envelope, '')), 'C')
  ) STORED;
--> statement-breakpoint
CREATE INDEX card_personal_quests_search_idx ON card_personal_quests USING gin(search_vector);
