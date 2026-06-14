ALTER TABLE "campaigns" ADD COLUMN "skipped_scenarios" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "unlock_graph_scenarios" ADD COLUMN "skippable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "unlock_graph_scenarios" ADD COLUMN "unlock_class" text;--> statement-breakpoint
ALTER TABLE "unlock_graph_scenarios" ADD COLUMN "unlock_min_level" integer;--> statement-breakpoint
ALTER TABLE "unlock_graph_scenarios" ADD CONSTRAINT "unlock_graph_scenarios_character_gate_ck" CHECK (("unlock_class" IS NULL AND "unlock_min_level" IS NULL) OR ("unlock_class" IS NOT NULL AND "unlock_min_level" IS NOT NULL AND "unlock_min_level" > 0));
