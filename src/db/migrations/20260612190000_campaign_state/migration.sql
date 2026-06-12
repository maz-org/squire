-- Phase 4 campaign & character state (SQR-18, ADR 0021).
-- Additive-only. Mirrors src/db/schema/campaigns.ts exactly.
--
-- campaign_audit_log deliberately has NO foreign keys: rows are append-only
-- and must survive campaign deletion (ADR 0021 §Leave/delete semantics).

CREATE TABLE IF NOT EXISTS "campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "game" text NOT NULL,
  "modules" text[] DEFAULT '{}' NOT NULL,
  "prosperity" integer DEFAULT 1 NOT NULL,
  "active_scenario" text,
  "played_scenarios" text[] DEFAULT '{}' NOT NULL,
  "drawn_scenarios" text[] DEFAULT '{}' NOT NULL,
  "unlocked_classes" text[] DEFAULT '{}' NOT NULL,
  "unlocked_items" text[] DEFAULT '{}' NOT NULL,
  "unlocked_buildings" text[] DEFAULT '{}' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "last_synced_at" timestamp with time zone,
  "sync_method" text,
  "external_ref" text,
  "source_authority" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "campaigns_game_idx" ON "campaigns" USING btree ("game");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "campaign_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "invite_email" text NOT NULL,
  "invited_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "role" text DEFAULT 'member' NOT NULL,
  "status" text DEFAULT 'invited' NOT NULL,
  "joined_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "campaign_members_campaign_idx" ON "campaign_members" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_members_user_idx" ON "campaign_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_members_campaign_email_idx" ON "campaign_members" USING btree ("campaign_id","invite_email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_members_campaign_user_idx" ON "campaign_members" USING btree ("campaign_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_members_single_owner_idx" ON "campaign_members" USING btree ("campaign_id") WHERE "role" = 'owner';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "characters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "placeholder_for_email" text,
  "name" text NOT NULL,
  "class_name" text NOT NULL,
  "level" integer DEFAULT 1 NOT NULL,
  "xp" integer DEFAULT 0 NOT NULL,
  "gold" integer DEFAULT 0 NOT NULL,
  "perks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "personal_quest" text,
  "battle_goals" text,
  "private_notes" text,
  "status" text DEFAULT 'active' NOT NULL,
  "successor_id" uuid REFERENCES "characters"("id") ON DELETE SET NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "external_ref" text,
  "source_authority" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "characters_campaign_idx" ON "characters" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_owner_idx" ON "characters" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_successor_idx" ON "characters" USING btree ("successor_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "character_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "game" text NOT NULL,
  "source_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "character_items_character_idx" ON "character_items" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "character_items_character_card_idx" ON "character_items" USING btree ("character_id","game","source_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "character_cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "game" text NOT NULL,
  "source_id" text NOT NULL,
  "role" text DEFAULT 'owned' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "character_cards_character_idx" ON "character_cards" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "character_cards_character_card_idx" ON "character_cards" USING btree ("character_id","game","source_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "campaign_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "mutation_type" text NOT NULL,
  "channel" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid,
  "payload_before" jsonb DEFAULT 'null'::jsonb,
  "payload_after" jsonb DEFAULT 'null'::jsonb,
  "availability_snapshot" jsonb DEFAULT 'null'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "campaign_audit_log_campaign_created_idx" ON "campaign_audit_log" USING btree ("campaign_id","created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pending_mutations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "proposer_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "payload" jsonb NOT NULL,
  "payload_hash" text NOT NULL,
  "expected_versions" jsonb NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "pending_mutations_campaign_idx" ON "pending_mutations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_mutations_expires_idx" ON "pending_mutations" USING btree ("expires_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mutation_idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "tool_family" text NOT NULL,
  "payload_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "mutation_idempotency_scope_key_idx" ON "mutation_idempotency_keys" USING btree ("actor_user_id","campaign_id","tool_family","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mutation_idempotency_campaign_idx" ON "mutation_idempotency_keys" USING btree ("campaign_id");
