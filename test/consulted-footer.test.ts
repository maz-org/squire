/**
 * Unit tests for src/web-ui/consulted-footer.ts (SQR-98).
 *
 * The typed-union drift guard on `TOOL_SOURCE_LABELS` is enforced at
 * compile time — adding a tool to AGENT_TOOLS without a matching label
 * entry would fail `npm run typecheck` before reaching runtime. These
 * tests cover the concrete mapping values (which TS can't assert),
 * plus the aggregation + formatting helpers used by both the SSE route
 * and the historical-answer render path.
 */
import { describe, expect, it } from 'vitest';

import {
  aggregateSourceLabels,
  formatConsultedFooter,
  toolSourceLabel,
} from '../src/web-ui/consulted-footer.ts';

describe('toolSourceLabel', () => {
  it.each([
    ['search_rules', 'RULEBOOK'],
    ['search_cards', 'CARD INDEX'],
    ['list_card_types', 'CARD INDEX'],
    ['list_cards', 'CARD INDEX'],
    ['get_card', 'CARD INDEX'],
    ['find_scenario', 'SCENARIO BOOK'],
    ['get_scenario', 'SCENARIO BOOK'],
    ['get_section', 'SECTION BOOK'],
  ])('maps %s → %s', (tool, label) => {
    expect(toolSourceLabel(tool)).toBe(label);
  });

  it('returns null for follow_links (traversal tool, not a source)', () => {
    expect(toolSourceLabel('follow_links')).toBeNull();
  });

  it('returns null for unknown tool names', () => {
    expect(toolSourceLabel('unknown_tool')).toBeNull();
    expect(toolSourceLabel('')).toBeNull();
  });
});

describe('aggregateSourceLabels', () => {
  it('returns an empty list for empty input', () => {
    expect(aggregateSourceLabels([])).toEqual([]);
  });

  it('maps raw tool names to provenance labels', () => {
    expect(aggregateSourceLabels(['search_rules'])).toEqual(['RULEBOOK']);
  });

  it('dedupes labels that come from different tool names in the same family', () => {
    // get_card, list_cards, and search_cards all map to CARD INDEX — one
    // agent turn can hit several of them, but the footer should show
    // CARD INDEX exactly once.
    expect(aggregateSourceLabels(['list_card_types', 'search_cards', 'get_card'])).toEqual([
      'CARD INDEX',
    ]);
  });

  it('preserves insertion order of the first-seen label', () => {
    // RULEBOOK came first even though the card tools were called more
    // often — the footer reads "CONSULTED · RULEBOOK · CARD INDEX", not
    // the reverse.
    expect(
      aggregateSourceLabels(['search_rules', 'search_cards', 'search_cards', 'list_cards']),
    ).toEqual(['RULEBOOK', 'CARD INDEX']);
  });

  it('drops traversal tools and unknown tool names', () => {
    expect(aggregateSourceLabels(['follow_links', 'mystery_tool'])).toEqual([]);
    expect(aggregateSourceLabels(['search_rules', 'follow_links', 'get_card'])).toEqual([
      'RULEBOOK',
      'CARD INDEX',
    ]);
  });
});

describe('formatConsultedFooter', () => {
  it('returns an empty string for empty input (render path treats this as "hidden")', () => {
    expect(formatConsultedFooter([])).toBe('');
  });

  it('joins labels with the CONSULTED prefix and a middle-dot separator', () => {
    expect(formatConsultedFooter(['RULEBOOK'])).toBe('CONSULTED · RULEBOOK');
    expect(formatConsultedFooter(['RULEBOOK', 'CARD INDEX'])).toBe(
      'CONSULTED · RULEBOOK · CARD INDEX',
    );
  });
});
