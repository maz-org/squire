/**
 * SQR-98: consulted-footer provenance labels.
 *
 * The agent exposes tool names (search_rules, get_section, …). The UI wants
 * ledger-voiced provenance labels (RULEBOOK, SECTION BOOK, …). This module
 * owns that mapping plus the aggregation + formatting helpers used by both
 * the SSE route (live turns) and the layout render path (historical turns).
 *
 * Keeping the map typed against `AgentToolName` means adding a tool to
 * `AGENT_TOOLS` without extending `TOOL_SOURCE_LABELS` is a typecheck
 * failure, not a silent drop from the footer.
 */

import type { AgentToolName } from '../agent.ts';

export type ToolSourceLabel = 'RULEBOOK' | 'CARD INDEX' | 'SCENARIO BOOK' | 'SECTION BOOK';

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
 * Collapse the turn's raw tool-name list into the dedup'd provenance
 * labels shown in the footer. Insertion order is preserved so the
 * first-called source appears first. Unknown or null-mapped tools are
 * dropped.
 */
export function aggregateSourceLabels(toolNames: readonly string[]): ToolSourceLabel[] {
  const seen = new Set<ToolSourceLabel>();
  const ordered: ToolSourceLabel[] = [];
  for (const name of toolNames) {
    const label = toolSourceLabel(name);
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
