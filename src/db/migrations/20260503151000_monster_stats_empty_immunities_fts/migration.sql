-- Make monster-stat immunity lookups searchable as affirmative evidence.
--
-- Queries like "Living Bones immunities" used to return no card hits because
-- monster stats with `immunities = '{}'` contributed no "immunities" lexeme to
-- the generated tsvector. Rebuild only card_monster_stats.search_vector so an
-- empty list indexes as "immunities none" while non-empty lists keep indexing
-- the actual condition names. The constant "monster stat card" labels cover
-- natural model/user wording that asks for a monster stat card or stat block.

DROP INDEX IF EXISTS card_monster_stats_search_idx;
--> statement-breakpoint

ALTER TABLE card_monster_stats DROP COLUMN search_vector;
--> statement-breakpoint

ALTER TABLE card_monster_stats
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(squire_english_tsv(coalesce(name, '')), 'A') ||
    setweight(
      squire_english_tsv(
        coalesce(level_range, '') || ' monster monsters stat stats card cards block'
      ),
      'B'
    ) ||
    setweight(
      squire_english_tsv(
        CASE
          WHEN cardinality(immunities) = 0 THEN 'immunities none no condition immunities empty immunities'
          ELSE squire_arr_join(immunities)
        END
      ),
      'D'
    ) ||
    setweight(squire_english_tsv(coalesce(notes, '')), 'C')
  ) STORED;
--> statement-breakpoint

CREATE INDEX card_monster_stats_search_idx ON card_monster_stats USING gin(search_vector);
--> statement-breakpoint
