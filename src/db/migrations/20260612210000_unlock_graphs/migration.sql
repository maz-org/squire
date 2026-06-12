-- Unlock-graph runtime tables (SQR-267). Additive-only.
-- Mirrors src/db/schema/unlock-graphs.ts exactly.

CREATE TABLE IF NOT EXISTS "unlock_graph_scenarios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game" text NOT NULL,
  "module" text NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "prereqs_all" text[] DEFAULT '{}' NOT NULL,
  "prereqs_any" text[] DEFAULT '{}' NOT NULL,
  "mutex" text[] DEFAULT '{}' NOT NULL,
  "locked_if" text[] DEFAULT '{}' NOT NULL,
  "manual" boolean DEFAULT false NOT NULL,
  "cond" text,
  "hazard" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "unlock_graph_scenarios_game_module_key_idx" ON "unlock_graph_scenarios" USING btree ("game","module","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unlock_graph_scenarios_game_module_idx" ON "unlock_graph_scenarios" USING btree ("game","module");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "unlock_graph_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game" text NOT NULL,
  "module" text NOT NULL,
  "thread_id" text NOT NULL,
  "label" text NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "position" integer NOT NULL,
  "keys" text[] DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "unlock_graph_threads_game_module_thread_idx" ON "unlock_graph_threads" USING btree ("game","module","thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unlock_graph_threads_game_module_idx" ON "unlock_graph_threads" USING btree ("game","module");
