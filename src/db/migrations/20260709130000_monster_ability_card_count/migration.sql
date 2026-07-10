-- SQR-397: monster decks contain physically duplicated cards (FH Ancient
-- Artillery ships Exploding Ammunition x2); the import collapsed them,
-- losing deck composition. One row per distinct card, with a copy count.
ALTER TABLE "card_monster_abilities" ADD COLUMN "count" integer NOT NULL DEFAULT 1;
