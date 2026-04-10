-- Geminate is a split character mat (two forms with separate card pools)
-- whose GHS source encodes hand size as the string "7|7". The SQR-34
-- initial schema declared `hand_size` as `integer NOT NULL`, which caused
-- `seedCards` to drop the Geminate row during Zod validation. Widen the
-- column to jsonb so a single integer (normal mats) or a `[form1, form2]`
-- tuple (split mats) can be stored side by side. See SQR-63 and the
-- matching Zod union in src/schemas.ts#CharacterMatSchema.
ALTER TABLE "card_character_mats"
  ALTER COLUMN "hand_size" SET DATA TYPE jsonb USING to_jsonb("hand_size");
