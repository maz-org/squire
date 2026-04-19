ALTER TABLE traversal_scenarios RENAME TO scenario_book_scenarios;
ALTER TABLE scenario_book_scenarios
  RENAME CONSTRAINT traversal_scenarios_pkey TO scenario_book_scenarios_pkey;
ALTER INDEX traversal_scenarios_game_ref_idx
  RENAME TO scenario_book_scenarios_game_ref_idx;
ALTER INDEX traversal_scenarios_game_idx
  RENAME TO scenario_book_scenarios_game_idx;
ALTER INDEX traversal_scenarios_index_idx
  RENAME TO scenario_book_scenarios_index_idx;
ALTER INDEX traversal_scenarios_name_idx
  RENAME TO scenario_book_scenarios_name_idx;

ALTER TABLE traversal_sections RENAME TO section_book_sections;
ALTER TABLE section_book_sections
  RENAME CONSTRAINT traversal_sections_pkey TO section_book_sections_pkey;
ALTER INDEX traversal_sections_game_ref_idx
  RENAME TO section_book_sections_game_ref_idx;
ALTER INDEX traversal_sections_game_idx
  RENAME TO section_book_sections_game_idx;
ALTER INDEX traversal_sections_number_idx
  RENAME TO section_book_sections_number_idx;

ALTER TABLE traversal_links RENAME TO book_references;
ALTER TABLE book_references
  RENAME CONSTRAINT traversal_links_pkey TO book_references_pkey;
ALTER INDEX traversal_links_game_unique_idx
  RENAME TO book_references_game_unique_idx;
ALTER INDEX traversal_links_from_idx
  RENAME TO book_references_from_idx;
ALTER INDEX traversal_links_to_idx
  RENAME TO book_references_to_idx;
ALTER INDEX traversal_links_type_idx
  RENAME TO book_references_type_idx;
