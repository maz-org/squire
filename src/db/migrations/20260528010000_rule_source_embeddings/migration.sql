CREATE TABLE IF NOT EXISTS "rule_source_embeddings" (
  "id" text PRIMARY KEY NOT NULL,
  "source" text NOT NULL,
  "chunk_index" integer NOT NULL,
  "text" text NOT NULL,
  "embedding" vector(1024) NOT NULL,
  "game" text DEFAULT 'frosthaven' NOT NULL,
  "embedding_version" text NOT NULL,
  "content_hash" text
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "rule_source_embeddings_game_source_chunk_idx"
  ON "rule_source_embeddings" USING btree ("game","source","chunk_index");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "rule_source_embeddings_game_idx"
  ON "rule_source_embeddings" USING btree ("game");--> statement-breakpoint
