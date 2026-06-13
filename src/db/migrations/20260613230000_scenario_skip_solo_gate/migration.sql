ALTER TABLE "campaigns" ADD COLUMN "skipped_scenarios" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "unlock_graph_scenarios" ADD COLUMN "skippable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "unlock_graph_scenarios" ADD COLUMN "unlock_class" text;--> statement-breakpoint
ALTER TABLE "unlock_graph_scenarios" ADD COLUMN "unlock_min_level" integer;
