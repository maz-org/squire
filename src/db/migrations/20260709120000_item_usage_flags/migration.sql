-- SQR-400: the items import dropped GHS usage flags — 192 consumables across
-- both games read as passive items. consumed = one-time use (discarded);
-- persistent/round = effect duration markers from the card.
ALTER TABLE "card_items" ADD COLUMN "consumed" boolean NOT NULL DEFAULT false;
ALTER TABLE "card_items" ADD COLUMN "persistent" boolean NOT NULL DEFAULT false;
ALTER TABLE "card_items" ADD COLUMN "round" boolean NOT NULL DEFAULT false;
