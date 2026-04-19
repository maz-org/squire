CREATE TABLE traversal_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game TEXT NOT NULL DEFAULT 'frosthaven',
  ref TEXT NOT NULL,
  scenario_group TEXT NOT NULL,
  scenario_index TEXT NOT NULL,
  name TEXT NOT NULL,
  complexity INTEGER,
  flow_chart_group TEXT,
  initial BOOLEAN NOT NULL DEFAULT FALSE,
  source_pdf TEXT,
  source_page INTEGER,
  raw_text TEXT,
  metadata JSONB NOT NULL
);

CREATE UNIQUE INDEX traversal_scenarios_game_ref_idx
  ON traversal_scenarios (game, ref);

CREATE INDEX traversal_scenarios_game_idx
  ON traversal_scenarios (game);

CREATE INDEX traversal_scenarios_index_idx
  ON traversal_scenarios (scenario_index);

CREATE INDEX traversal_scenarios_name_idx
  ON traversal_scenarios (name);

CREATE TABLE traversal_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game TEXT NOT NULL DEFAULT 'frosthaven',
  ref TEXT NOT NULL,
  section_number INTEGER NOT NULL,
  section_variant INTEGER NOT NULL,
  source_pdf TEXT NOT NULL,
  source_page INTEGER NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB NOT NULL
);

CREATE UNIQUE INDEX traversal_sections_game_ref_idx
  ON traversal_sections (game, ref);

CREATE INDEX traversal_sections_game_idx
  ON traversal_sections (game);

CREATE INDEX traversal_sections_number_idx
  ON traversal_sections (section_number);

CREATE TABLE traversal_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game TEXT NOT NULL DEFAULT 'frosthaven',
  from_kind TEXT NOT NULL,
  from_ref TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_ref TEXT NOT NULL,
  link_type TEXT NOT NULL,
  raw_label TEXT,
  raw_context TEXT,
  sequence INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX traversal_links_game_unique_idx
  ON traversal_links (game, from_kind, from_ref, to_kind, to_ref, link_type, sequence);

CREATE INDEX traversal_links_from_idx
  ON traversal_links (game, from_kind, from_ref);

CREATE INDEX traversal_links_to_idx
  ON traversal_links (game, to_kind, to_ref);

CREATE INDEX traversal_links_type_idx
  ON traversal_links (link_type);
