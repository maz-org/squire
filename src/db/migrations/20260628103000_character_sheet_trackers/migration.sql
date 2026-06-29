ALTER TABLE "characters" ADD COLUMN "perk_marks" integer DEFAULT 0 NOT NULL;
ALTER TABLE "characters" ADD COLUMN "masteries" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "characters" ADD CONSTRAINT "characters_perk_marks_nonnegative" CHECK ("perk_marks" >= 0);
