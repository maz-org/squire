-- Solo class scenarios (e.g. solo20_drifter) and the random dungeon ship
-- without a printed complexity value. The SQR-34 initial schema declared
-- `complexity` NOT NULL, which caused `scripts/seed-cards.ts` to silently
-- drop 18 scenario rows during seed-time Zod validation. This surfaced as
-- load() parity drift in SQR-57; see src/schemas.ts#ScenarioSchema for the
-- matching Zod relaxation.
ALTER TABLE "card_scenarios" ALTER COLUMN "complexity" DROP NOT NULL;
