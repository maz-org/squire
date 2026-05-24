const SOURCE_SUFFIX = /\.(pdf|html?|md|txt)$/i;

/**
 * Human-readable label for an indexed rule source.
 *
 * The raw `source` value stays the source basename for provenance and
 * reindexing.
 * This helper exists for tool/API/UI display so retrieval results clearly
 * distinguish rulebooks, FAQ snapshots, errata, and scenario/section books.
 */
export function formatRetrievalSourceLabel(source: string): string {
  const basename = source.replace(SOURCE_SUFFIX, '');

  if (/-rule-book$/i.test(basename)) return 'Rulebook';
  if (/-puzzle-book$/i.test(basename)) return 'Puzzle Book';
  if (/-faq$/i.test(basename)) return 'FAQ';
  if (/-errata$/i.test(basename)) return 'Errata';

  const scenarioMatch = basename.match(/-scenario-book-(.+)$/i);
  if (scenarioMatch) return `Scenario Book ${scenarioMatch[1]}`;

  const sectionMatch = basename.match(/-section-book-(.+)$/i);
  if (sectionMatch) return `Section Book ${sectionMatch[1]}`;

  return basename;
}
