/**
 * SQR-98 / SQR-105: consulted-footer provenance labels.
 *
 * Two label sources feed the footer:
 *
 * 1. Static tool-name map (`TOOL_SOURCE_LABELS`): tools like `get_section`,
 *    `search_cards`, etc. always map to one fixed label. Stored as tool names
 *    in `consulted_sources` (pre-SQR-105 rows) and mapped at render time.
 *
 * 2. Dynamic per-result labels (`retrievalSourceLabelToFooterLabel`): used by
 *    `search_rules`, which searches all four Frosthaven books and can surface
 *    passages from any of them. The actual books hit are extracted from the
 *    result data in agent.ts and stored directly as ToolSourceLabel strings
 *    in `consulted_sources` (post-SQR-105 rows).
 *
 * `aggregateSourceLabels` handles both storage formats — tool names (old rows)
 * and label strings (new rows) — so no migration is required.
 *
 * Keeping `TOOL_SOURCE_LABELS` typed against `AgentToolName` means adding a
 * selectable tool without extending the map is a typecheck failure.
 */

import type { AgentToolName } from '../agent.ts';

// Derive the union from the array so there's one place to update when adding
// a new provenance label.
const TOOL_SOURCE_LABEL_VALUES_CONST = [
  'RULEBOOK',
  'PUZZLE BOOK',
  'CARD INDEX',
  'SCENARIO BOOK',
  'SECTION BOOK',
] as const;

export type ToolSourceLabel = (typeof TOOL_SOURCE_LABEL_VALUES_CONST)[number];

/** All valid ToolSourceLabel values. Used by the JS/TS drift test. */
export const TOOL_SOURCE_LABEL_VALUES: readonly ToolSourceLabel[] = TOOL_SOURCE_LABEL_VALUES_CONST;

/**
 * Wire-level label the SSE `tool-start` / `tool-result` events send for
 * tools that aren't provenance sources (traversal/utility tools like
 * `follow_links`, or unknown tools). The aggregator in the UI and in the
 * client skip this value when building the CONSULTED footer. Exporting
 * the constant keeps server.ts's fallback emission and any downstream
 * filters in sync with one string.
 */
export const TOOL_SOURCE_FALLBACK_LABEL = 'REFERENCE';

// null = a utility/traversal tool that isn't itself a provenance source
// (the agent used it to navigate, but the actual content it surfaced
// came from another tool call that already contributed a label).
const TOOL_SOURCE_LABELS: Record<AgentToolName, ToolSourceLabel | null> = {
  inspect_sources: null,
  schema: null,
  resolve_entity: null,
  open_entity: null,
  search_knowledge: null,
  neighbors: null,
  search_rules: 'RULEBOOK',
  search_cards: 'CARD INDEX',
  list_card_types: 'CARD INDEX',
  list_cards: 'CARD INDEX',
  get_card: 'CARD INDEX',
  find_scenario: 'SCENARIO BOOK',
  get_scenario: 'SCENARIO BOOK',
  get_section: 'SECTION BOOK',
  follow_links: null,
};

/**
 * Map a `formatRetrievalSourceLabel()` string ("Rulebook", "Section Book A",
 * etc.) to its ledger-voiced footer label. Returns null for unknown sources.
 *
 * The raw sourceLabel values come from the PDF basename patterns in
 * src/retrieval-source.ts — one entry per book volume. We collapse variants
 * ("Section Book A", "Section Book B", …) to a single SECTION BOOK label
 * because the footer shows which *type* of book was consulted, not which
 * volume.
 */
export function retrievalSourceLabelToFooterLabel(label: string): ToolSourceLabel | null {
  if (label === 'Rulebook') return 'RULEBOOK';
  if (label === 'Puzzle Book') return 'PUZZLE BOOK';
  if (label === 'Card Index') return 'CARD INDEX';
  if (label.startsWith('Scenario Book')) return 'SCENARIO BOOK';
  if (label.startsWith('Section Book')) return 'SECTION BOOK';
  return null;
}

/** Returns true iff `value` is one of the known ToolSourceLabel strings. */
export function isToolSourceLabel(value: string): value is ToolSourceLabel {
  return (TOOL_SOURCE_LABEL_VALUES as readonly string[]).includes(value);
}

function isKnownAgentToolName(name: string): name is AgentToolName {
  // Object.hasOwn ignores the prototype chain — plain `in` would match
  // inherited properties like '__proto__', 'toString', 'hasOwnProperty',
  // which would then return `undefined` from TOOL_SOURCE_LABELS and
  // silently break the `ToolSourceLabel | null` type contract.
  return Object.hasOwn(TOOL_SOURCE_LABELS, name);
}

/**
 * Map a single tool name to its provenance label, or null if the tool is
 * unknown or is a utility/traversal tool that shouldn't appear as a source.
 */
export function toolSourceLabel(name: string): ToolSourceLabel | null {
  if (!isKnownAgentToolName(name)) return null;
  return TOOL_SOURCE_LABELS[name];
}

/**
 * Collapse the turn's stored provenance values into the dedup'd labels
 * shown in the footer. Handles two storage formats:
 *
 * - Old (pre-SQR-105): tool names like `"search_rules"`, `"get_section"`.
 *   Mapped via `TOOL_SOURCE_LABELS` at render time.
 * - New (post-SQR-105): ToolSourceLabel strings like `"RULEBOOK"`,
 *   `"SECTION BOOK"`. Stored directly, passed through without mapping.
 *
 * Insertion order is preserved so the first-called source appears first.
 * Unknown or null-mapped values are dropped.
 */
export function aggregateSourceLabels(stored: readonly string[]): ToolSourceLabel[] {
  const seen = new Set<ToolSourceLabel>();
  const ordered: ToolSourceLabel[] = [];
  for (const value of stored) {
    // New format: value is already a ToolSourceLabel (stored directly since SQR-105)
    if (isToolSourceLabel(value)) {
      if (!seen.has(value)) {
        seen.add(value);
        ordered.push(value);
      }
      continue;
    }
    // Old format: value is a tool name stored pre-SQR-105
    const label = toolSourceLabel(value);
    if (label === null) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    ordered.push(label);
  }
  return ordered;
}

/**
 * Format the dedup'd labels into the footer text. Empty input → '', which
 * the render path treats as "leave the footer hidden."
 */
export function formatConsultedFooter(labels: readonly ToolSourceLabel[]): string {
  return labels.length === 0 ? '' : ['CONSULTED', ...labels].join(' · ');
}
