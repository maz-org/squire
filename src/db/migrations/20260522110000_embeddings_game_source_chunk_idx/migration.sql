DROP INDEX IF EXISTS "embeddings_source_chunk_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_game_source_chunk_idx" ON "embeddings" USING btree ("game","source","chunk_index");
