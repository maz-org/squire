-- pgvector extension is required for the `vector(384)` column on `embeddings`.
-- The docker-compose init script also enables this on the dev DBs, but production
-- hosts (Neon, Supabase, Fly, Railway, Render) need it created here.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"game" text DEFAULT 'frosthaven' NOT NULL,
	"embedding_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "oauth_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"client_id" uuid,
	"user_id" uuid,
	"ip_address" text,
	"user_agent" text,
	"outcome" text NOT NULL,
	"failure_reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text DEFAULT 'S256' NOT NULL,
	"scope" text,
	"state" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"client_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id_issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"client_name" text,
	"grant_types" text[],
	"response_types" text[],
	"token_endpoint_auth_method" text,
	"scope" text
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid,
	"scope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "card_battle_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text DEFAULT 'frosthaven' NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"condition" text NOT NULL,
	"checkmarks" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text DEFAULT 'frosthaven' NOT NULL,
	"source_id" text NOT NULL,
	"building_number" text,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"build_cost" jsonb NOT NULL,
	"effect" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "card_character_abilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text DEFAULT 'frosthaven' NOT NULL,
	"source_id" text NOT NULL,
	"card_name" text NOT NULL,
	"character_class" text NOT NULL,
	"level" text,
	"initiative" integer,
	"top" jsonb NOT NULL,
	"bottom" jsonb NOT NULL,
	"lost" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_character_mats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text DEFAULT 'frosthaven' NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"character_class" text NOT NULL,
	"hand_size" integer NOT NULL,
	"traits" text[] NOT NULL,
	"hp" jsonb NOT NULL,
	"perks" text[] NOT NULL,
	"masteries" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text DEFAULT 'frosthaven' NOT NULL,
	"source_id" text NOT NULL,
	"event_type" text NOT NULL,
	"season" text,
	"number" text NOT NULL,
	"flavor_text" text NOT NULL,
	"option_a" jsonb NOT NULL,
	"option_b" jsonb,
	"option_c" jsonb
);
--> statement-breakpoint
CREATE TABLE "card_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text DEFAULT 'frosthaven' NOT NULL,
	"source_id" text NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"slot" text NOT NULL,
	"cost" integer,
	"effect" text NOT NULL,
	"uses" integer,
	"spent" boolean NOT NULL,
	"lost" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_monster_abilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text DEFAULT 'frosthaven' NOT NULL,
	"source_id" text NOT NULL,
	"monster_type" text NOT NULL,
	"card_name" text NOT NULL,
	"initiative" integer NOT NULL,
	"abilities" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_monster_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text DEFAULT 'frosthaven' NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"level_range" text NOT NULL,
	"normal" jsonb NOT NULL,
	"elite" jsonb NOT NULL,
	"immunities" text[] NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "card_personal_quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text DEFAULT 'frosthaven' NOT NULL,
	"source_id" text NOT NULL,
	"card_id" text NOT NULL,
	"alt_id" text NOT NULL,
	"name" text NOT NULL,
	"requirements" jsonb NOT NULL,
	"open_envelope" text NOT NULL,
	"errata" text
);
--> statement-breakpoint
CREATE TABLE "card_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text DEFAULT 'frosthaven' NOT NULL,
	"source_id" text NOT NULL,
	"scenario_group" text NOT NULL,
	"index" text NOT NULL,
	"name" text NOT NULL,
	"complexity" integer NOT NULL,
	"monsters" text[] NOT NULL,
	"allies" text[] NOT NULL,
	"unlocks" text[] NOT NULL,
	"requirements" jsonb NOT NULL,
	"objectives" jsonb NOT NULL,
	"rewards" text,
	"loot_deck_config" jsonb NOT NULL,
	"flow_chart_group" text,
	"initial" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_audit_log" ADD CONSTRAINT "oauth_audit_log_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_audit_log" ADD CONSTRAINT "oauth_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_source_chunk_idx" ON "embeddings" USING btree ("source","chunk_index");--> statement-breakpoint
CREATE INDEX "embeddings_game_idx" ON "embeddings" USING btree ("game");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_audit_client_idx" ON "oauth_audit_log" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_audit_user_idx" ON "oauth_audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_audit_created_idx" ON "oauth_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "oauth_auth_codes_expires_idx" ON "oauth_authorization_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_tokens_client_idx" ON "oauth_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_user_idx" ON "oauth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_expires_idx" ON "oauth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "card_battle_goals_game_source_idx" ON "card_battle_goals" USING btree ("game","source_id");--> statement-breakpoint
CREATE INDEX "card_battle_goals_game_idx" ON "card_battle_goals" USING btree ("game");--> statement-breakpoint
CREATE UNIQUE INDEX "card_buildings_game_source_idx" ON "card_buildings" USING btree ("game","source_id");--> statement-breakpoint
CREATE INDEX "card_buildings_game_idx" ON "card_buildings" USING btree ("game");--> statement-breakpoint
CREATE INDEX "card_buildings_name_idx" ON "card_buildings" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "card_character_abilities_game_source_idx" ON "card_character_abilities" USING btree ("game","source_id");--> statement-breakpoint
CREATE INDEX "card_character_abilities_game_idx" ON "card_character_abilities" USING btree ("game");--> statement-breakpoint
CREATE INDEX "card_character_abilities_character_class_idx" ON "card_character_abilities" USING btree ("character_class");--> statement-breakpoint
CREATE UNIQUE INDEX "card_character_mats_game_source_idx" ON "card_character_mats" USING btree ("game","source_id");--> statement-breakpoint
CREATE INDEX "card_character_mats_game_idx" ON "card_character_mats" USING btree ("game");--> statement-breakpoint
CREATE INDEX "card_character_mats_name_idx" ON "card_character_mats" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "card_events_game_source_idx" ON "card_events" USING btree ("game","source_id");--> statement-breakpoint
CREATE INDEX "card_events_game_idx" ON "card_events" USING btree ("game");--> statement-breakpoint
CREATE INDEX "card_events_event_type_idx" ON "card_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "card_items_game_source_idx" ON "card_items" USING btree ("game","source_id");--> statement-breakpoint
CREATE INDEX "card_items_game_idx" ON "card_items" USING btree ("game");--> statement-breakpoint
CREATE INDEX "card_items_number_idx" ON "card_items" USING btree ("number");--> statement-breakpoint
CREATE INDEX "card_items_slot_idx" ON "card_items" USING btree ("slot");--> statement-breakpoint
CREATE UNIQUE INDEX "card_monster_abilities_game_source_idx" ON "card_monster_abilities" USING btree ("game","source_id");--> statement-breakpoint
CREATE INDEX "card_monster_abilities_game_idx" ON "card_monster_abilities" USING btree ("game");--> statement-breakpoint
CREATE INDEX "card_monster_abilities_monster_type_idx" ON "card_monster_abilities" USING btree ("monster_type");--> statement-breakpoint
CREATE UNIQUE INDEX "card_monster_stats_game_source_idx" ON "card_monster_stats" USING btree ("game","source_id");--> statement-breakpoint
CREATE INDEX "card_monster_stats_game_idx" ON "card_monster_stats" USING btree ("game");--> statement-breakpoint
CREATE INDEX "card_monster_stats_name_idx" ON "card_monster_stats" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "card_personal_quests_game_source_idx" ON "card_personal_quests" USING btree ("game","source_id");--> statement-breakpoint
CREATE INDEX "card_personal_quests_game_idx" ON "card_personal_quests" USING btree ("game");--> statement-breakpoint
CREATE UNIQUE INDEX "card_scenarios_game_source_idx" ON "card_scenarios" USING btree ("game","source_id");--> statement-breakpoint
CREATE INDEX "card_scenarios_game_idx" ON "card_scenarios" USING btree ("game");--> statement-breakpoint
CREATE INDEX "card_scenarios_group_index_idx" ON "card_scenarios" USING btree ("scenario_group","index");--> statement-breakpoint
-- HNSW index on embeddings for fast cosine-distance nearest-neighbor search.
-- Drizzle's index builder doesn't yet expose pgvector operator classes
-- (vector_cosine_ops), so we declare the index here in raw SQL. See tech spec
-- §pgvector operator sign-flip for the query-side details.
CREATE INDEX "embeddings_hnsw_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);