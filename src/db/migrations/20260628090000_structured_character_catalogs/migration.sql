ALTER TABLE "characters" ADD COLUMN "personal_quest_source_id" text;

CREATE TABLE "campaign_item_catalog" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE cascade,
  "game" text NOT NULL,
  "source_id" text NOT NULL,
  "status" text DEFAULT 'locked' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "campaign_item_catalog_campaign_idx" ON "campaign_item_catalog" USING btree ("campaign_id");
CREATE INDEX "campaign_item_catalog_status_idx" ON "campaign_item_catalog" USING btree ("campaign_id","status");
CREATE UNIQUE INDEX "campaign_item_catalog_campaign_source_idx" ON "campaign_item_catalog" USING btree ("campaign_id","game","source_id");

CREATE TABLE "campaign_personal_quest_catalog" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE cascade,
  "game" text NOT NULL,
  "source_id" text NOT NULL,
  "status" text DEFAULT 'available' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "campaign_personal_quest_catalog_campaign_idx" ON "campaign_personal_quest_catalog" USING btree ("campaign_id");
CREATE INDEX "campaign_personal_quest_catalog_status_idx" ON "campaign_personal_quest_catalog" USING btree ("campaign_id","status");
CREATE UNIQUE INDEX "campaign_personal_quest_catalog_campaign_source_idx" ON "campaign_personal_quest_catalog" USING btree ("campaign_id","game","source_id");
