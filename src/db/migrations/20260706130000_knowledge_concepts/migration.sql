CREATE TABLE "knowledge_concepts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game" text NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "aliases" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_concepts_game_slug_idx" ON "knowledge_concepts" ("game", "slug");
--> statement-breakpoint
CREATE INDEX "knowledge_concepts_game_idx" ON "knowledge_concepts" ("game");
