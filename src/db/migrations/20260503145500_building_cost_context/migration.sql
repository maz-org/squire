ALTER TABLE "card_buildings"
  ADD COLUMN "initial_build_cost" jsonb,
  ADD COLUMN "upgrade_cost" jsonb,
  ADD COLUMN "campaign_start_built" boolean DEFAULT false NOT NULL;

WITH building_cost_context AS (
  SELECT
    id,
    first_value(build_cost) OVER (
      PARTITION BY game, COALESCE(building_number, regexp_replace(source_id, '/L[0-9]+$', ''))
      ORDER BY level
    ) AS initial_build_cost,
    lead(build_cost) OVER (
      PARTITION BY game, COALESCE(building_number, regexp_replace(source_id, '/L[0-9]+$', ''))
      ORDER BY level
    ) AS upgrade_cost,
    building_number IN ('34', '35') AS campaign_start_built
  FROM "card_buildings"
)
UPDATE "card_buildings"
SET
  "initial_build_cost" = building_cost_context.initial_build_cost,
  "upgrade_cost" = building_cost_context.upgrade_cost,
  "campaign_start_built" = building_cost_context.campaign_start_built
FROM building_cost_context
WHERE "card_buildings".id = building_cost_context.id;

ALTER TABLE "card_buildings"
  ALTER COLUMN "initial_build_cost" SET NOT NULL;
