ALTER TABLE "conversations" ADD COLUMN "campaign_id" uuid;
--> statement-breakpoint
UPDATE "conversations" c
SET "campaign_id" = first_campaign."campaign_id"
FROM (
  SELECT DISTINCT ON (m."conversation_id")
    m."conversation_id",
    m."campaign_id"
  FROM "messages" m
  WHERE m."role" = 'user'
    AND m."campaign_id" IS NOT NULL
  ORDER BY m."conversation_id", m."created_at" ASC, m."id" ASC
) first_campaign
WHERE c."id" = first_campaign."conversation_id"
  AND c."campaign_id" IS NULL;
--> statement-breakpoint
CREATE INDEX "conversations_campaign_idx" ON "conversations" ("campaign_id");
