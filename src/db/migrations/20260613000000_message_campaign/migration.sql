ALTER TABLE "messages" ADD COLUMN "campaign_id" uuid;
--> statement-breakpoint
CREATE INDEX "messages_campaign_idx" ON "messages" ("campaign_id");
