-- SQR-343: Frosthaven solo scenarios moved from the base `fh` graph into the
-- optional `fhsolo` module. Preserve any campaign state that was recorded
-- against the old `fh:solo-*` qualified keys.

CREATE OR REPLACE FUNCTION squire_fhsolo_state_key(key text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE key
      WHEN 'fh:solo-20' THEN 'fhsolo:drifter'
      WHEN 'fh:solo-21' THEN 'fhsolo:blinkblade'
      WHEN 'fh:solo-22' THEN 'fhsolo:banner-spear'
      WHEN 'fh:solo-23' THEN 'fhsolo:deathwalker'
      WHEN 'fh:solo-24' THEN 'fhsolo:boneshaper'
      WHEN 'fh:solo-25' THEN 'fhsolo:geminate'
      WHEN 'fh:solo-26' THEN 'fhsolo:infuser'
      WHEN 'fh:solo-27' THEN 'fhsolo:pyroclast'
      WHEN 'fh:solo-28' THEN 'fhsolo:shattersong'
      WHEN 'fh:solo-29' THEN 'fhsolo:trapper'
      WHEN 'fh:solo-30' THEN 'fhsolo:pain-conduit'
      WHEN 'fh:solo-31' THEN 'fhsolo:snowdancer'
      WHEN 'fh:solo-32' THEN 'fhsolo:frozen-fist'
      WHEN 'fh:solo-33' THEN 'fhsolo:hive'
      WHEN 'fh:solo-34' THEN 'fhsolo:metal-mosaic'
      WHEN 'fh:solo-35' THEN 'fhsolo:deepwraith'
      WHEN 'fh:solo-36' THEN 'fhsolo:crashing-tide'
      ELSE key
    END
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION squire_fhsolo_state_keys(keys text[]) RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
    WITH mapped AS (
      SELECT squire_fhsolo_state_key(raw.key) AS key, raw.ordinality
      FROM unnest(keys) WITH ORDINALITY AS raw(key, ordinality)
    ),
    deduped AS (
      SELECT key, min(ordinality) AS first_ordinality
      FROM mapped
      GROUP BY key
    )
    SELECT COALESCE(array_agg(key ORDER BY first_ordinality), ARRAY[]::text[])
    FROM deduped
  $$;
--> statement-breakpoint

WITH old_fhsolo_keys AS (
  SELECT ARRAY[
    'fh:solo-20',
    'fh:solo-21',
    'fh:solo-22',
    'fh:solo-23',
    'fh:solo-24',
    'fh:solo-25',
    'fh:solo-26',
    'fh:solo-27',
    'fh:solo-28',
    'fh:solo-29',
    'fh:solo-30',
    'fh:solo-31',
    'fh:solo-32',
    'fh:solo-33',
    'fh:solo-34',
    'fh:solo-35',
    'fh:solo-36'
  ]::text[] AS keys
)
UPDATE "campaigns"
SET
  "modules" = CASE
    WHEN NOT "campaigns"."modules" @> ARRAY['fhsolo']::text[]
      THEN "campaigns"."modules" || ARRAY['fhsolo']::text[]
    ELSE "campaigns"."modules"
  END,
  "active_scenario" = squire_fhsolo_state_key("campaigns"."active_scenario"),
  "played_scenarios" = squire_fhsolo_state_keys("campaigns"."played_scenarios"),
  "drawn_scenarios" = squire_fhsolo_state_keys("campaigns"."drawn_scenarios"),
  "skipped_scenarios" = squire_fhsolo_state_keys("campaigns"."skipped_scenarios")
FROM old_fhsolo_keys
WHERE "campaigns"."game" = 'frosthaven'
  AND (
    "campaigns"."played_scenarios" && old_fhsolo_keys.keys
    OR "campaigns"."drawn_scenarios" && old_fhsolo_keys.keys
    OR "campaigns"."skipped_scenarios" && old_fhsolo_keys.keys
    OR "campaigns"."active_scenario" = ANY(old_fhsolo_keys.keys)
  );
--> statement-breakpoint

DROP FUNCTION squire_fhsolo_state_keys(text[]);
--> statement-breakpoint

DROP FUNCTION squire_fhsolo_state_key(text);
