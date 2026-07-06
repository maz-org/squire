-- ADR 0027 (SQR-401): typed edge substrate for the whole knowledge space.
CREATE TABLE "knowledge_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "game" text NOT NULL,
  "from_kind" text NOT NULL,
  "from_ref" text NOT NULL,
  "edge_type" text NOT NULL,
  "to_kind" text NOT NULL,
  "to_ref" text NOT NULL,
  "provenance" text NOT NULL,
  "metadata" jsonb
);
CREATE UNIQUE INDEX "knowledge_edges_game_edge_idx" ON "knowledge_edges" ("game", "from_ref", "edge_type", "to_ref");
CREATE INDEX "knowledge_edges_from_idx" ON "knowledge_edges" ("game", "from_ref");
CREATE INDEX "knowledge_edges_to_idx" ON "knowledge_edges" ("game", "to_ref");
CREATE INDEX "knowledge_edges_provenance_idx" ON "knowledge_edges" ("game", "provenance");
