CREATE TABLE "llm_budget_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_day" text NOT NULL,
	"user_id" uuid,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_creation_input_tokens" integer NOT NULL,
	"cache_read_input_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"cost_usd_micros" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_budget_warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_day" text NOT NULL,
	"threshold_percent" integer NOT NULL,
	"spent_usd_micros" integer NOT NULL,
	"budget_usd_micros" integer NOT NULL,
	"emitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_budget_warnings_threshold_percent_chk" CHECK ("threshold_percent" >= 1 AND "threshold_percent" <= 100)
);
--> statement-breakpoint
ALTER TABLE "llm_budget_ledger" ADD CONSTRAINT "llm_budget_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "llm_budget_ledger_day_idx" ON "llm_budget_ledger" USING btree ("budget_day");
--> statement-breakpoint
CREATE INDEX "llm_budget_ledger_user_day_idx" ON "llm_budget_ledger" USING btree ("user_id","budget_day");
--> statement-breakpoint
CREATE UNIQUE INDEX "llm_budget_warnings_day_threshold_idx" ON "llm_budget_warnings" USING btree ("budget_day","threshold_percent");
