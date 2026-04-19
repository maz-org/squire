const PDF_SUFFIX = /\.pdf$/i;

/**
 * Human-readable label for an indexed PDF source.
 *
 * The raw `source` value stays the PDF basename for provenance and reindexing.
 * This helper exists for tool/API/UI display so retrieval results clearly
 * distinguish the rulebook from scenario and section books.
 */
export function formatRetrievalSourceLabel(source: string): string {
  const basename = source.replace(PDF_SUFFIX, '');

  if (/-rule-book$/i.test(basename)) return 'Rulebook';
  if (/-puzzle-book$/i.test(basename)) return 'Puzzle Book';

  const scenarioMatch = basename.match(/-scenario-book-(.+)$/i);
  if (scenarioMatch) return `Scenario Book ${scenarioMatch[1]}`;

  const sectionMatch = basename.match(/-section-book-(.+)$/i);
  if (sectionMatch) return `Section Book ${sectionMatch[1]}`;

  return basename;
}
