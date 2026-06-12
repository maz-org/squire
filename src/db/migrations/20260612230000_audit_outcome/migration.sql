ALTER TABLE "campaign_audit_log" ADD COLUMN "outcome" text NOT NULL DEFAULT 'success';
--> statement-breakpoint
ALTER TABLE "campaign_audit_log" ADD COLUMN "failure_reason" text;
