-- SQR-396: two-speed (Blinkblade-style) initiative. GHS encodes both speeds
-- in one number (2050 = 20 fast / 50 slow); store the decoded halves so
-- answers can present the fast/slow semantics instead of the raw encoding.
ALTER TABLE "card_character_abilities" ADD COLUMN "initiative_fast" integer;
ALTER TABLE "card_character_abilities" ADD COLUMN "initiative_slow" integer;
