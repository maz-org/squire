/**
 * Unit tests for src/web-ui/consulted-footer.ts (SQR-98).
 *
 * The typed-union drift guard on `TOOL_SOURCE_LABELS` is enforced at
 * compile time — adding a selectable tool without a matching label
 * entry would fail `npm run typecheck` before reaching runtime. These
 * tests cover the concrete mapping values (which TS can't assert),
 * plus the aggregation + formatting helpers used by both the SSE route
 * and the historical-answer render path.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ALL_AGENT_TOOLS } from '../src/agent.ts';
import {
  aggregateSourceLabels,
  formatConsultedFooter,
  retrievalSourceLabelToFooterLabel,
  TOOL_SOURCE_FALLBACK_LABEL,
  TOOL_SOURCE_LABEL_VALUES,
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

  it('returns null for tools whose dynamic results carry source labels', () => {
    expect(toolSourceLabel('open_entity')).toBeNull();
    expect(toolSourceLabel('search_knowledge')).toBeNull();
  });

  it('returns null for traversal tools that are not sources', () => {
    expect(toolSourceLabel('neighbors')).toBeNull();
    expect(toolSourceLabel('follow_links')).toBeNull();
  });

  it('returns null for unknown tool names', () => {
    expect(toolSourceLabel('unknown_tool')).toBeNull();
    expect(toolSourceLabel('')).toBeNull();
  });
});

describe('retrievalSourceLabelToFooterLabel', () => {
  it.each([
    ['Rulebook', 'RULEBOOK'],
    ['Puzzle Book', 'PUZZLE BOOK'],
    ['Card Index', 'CARD INDEX'],
    ['Scenario Book 1', 'SCENARIO BOOK'],
    ['Scenario Book A', 'SCENARIO BOOK'],
    ['Section Book A', 'SECTION BOOK'],
    ['Section Book 1', 'SECTION BOOK'],
  ])('maps %s → %s', (raw, expected) => {
    expect(retrievalSourceLabelToFooterLabel(raw)).toBe(expected);
  });

  it('returns null for unrecognised labels', () => {
    expect(retrievalSourceLabelToFooterLabel('unknown')).toBeNull();
    expect(retrievalSourceLabelToFooterLabel('')).toBeNull();
  });
});

describe('aggregateSourceLabels', () => {
  it('returns an empty list for empty input', () => {
    expect(aggregateSourceLabels([])).toEqual([]);
  });

  it('maps raw tool names to provenance labels (old format)', () => {
    expect(aggregateSourceLabels(['search_rules'])).toEqual(['RULEBOOK']);
  });

  it('passes through ToolSourceLabel strings directly (new post-SQR-105 format)', () => {
    expect(aggregateSourceLabels(['RULEBOOK'])).toEqual(['RULEBOOK']);
    expect(aggregateSourceLabels(['SECTION BOOK', 'SCENARIO BOOK'])).toEqual([
      'SECTION BOOK',
      'SCENARIO BOOK',
    ]);
    expect(aggregateSourceLabels(['PUZZLE BOOK'])).toEqual(['PUZZLE BOOK']);
  });

  it('dedupes across old and new storage formats', () => {
    // Old row had "search_rules" stored; new row stores "RULEBOOK" — both
    // should render as a single RULEBOOK entry.
    expect(aggregateSourceLabels(['search_rules', 'RULEBOOK'])).toEqual(['RULEBOOK']);
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

describe('JS ↔ TS label drift guard', () => {
  // Regression: maintainability-review findings 2026-04-21. The client
  // aggregator in src/web-ui/squire.js hand-duplicates the ToolSourceLabel
  // union as `KNOWN_CONSULTED_LABELS`. The TS side gets compile-time
  // safety via AgentToolName, the JS side is a plain object. This test
  // keeps the two in sync: if someone adds a new ToolSourceLabel to the
  // TS union, the JS allowlist must also learn the label, or the live
  // stream will silently drop the new source from the footer.
  it("squire.js KNOWN_CONSULTED_LABELS matches consulted-footer.ts's ToolSourceLabel", () => {
    const jsSrc = readFileSync(
      fileURLToPath(new URL('../src/web-ui/squire.js', import.meta.url)),
      'utf8',
    );
    const match = jsSrc.match(/KNOWN_CONSULTED_LABELS\s*=\s*(\{[^}]+\})/);
    expect(match, 'could not locate KNOWN_CONSULTED_LABELS in squire.js').not.toBeNull();
    const jsLabels = new Set<string>();
    // Match both quoted keys ('CARD INDEX': true,) and unquoted identifier
    // keys (RULEBOOK: true,) — squire.js uses both forms depending on
    // whether the label contains whitespace.
    for (const label of match![1]!.matchAll(/(?:['"]([^'"]+)['"]|(\w+))\s*:/g)) {
      jsLabels.add((label[1] ?? label[2])!);
    }

    // Post-SQR-105: compare against the full ToolSourceLabel union, not
    // just the subset reachable via toolSourceLabel(toolName). PUZZLE BOOK
    // is only surfaced via per-result sourceLabel from search_rules — no
    // tool name maps to it statically — so deriving tsLabels from tool
    // names would silently exclude it.
    const tsLabels = new Set<string>(TOOL_SOURCE_LABEL_VALUES);

    expect(jsLabels).toEqual(tsLabels);
    // The fallback label must NEVER appear in the known-labels set — it's
    // the wire-level "not a real source" signal. squire.js's filter drops
    // it explicitly; this assertion keeps both sides honest.
    expect(jsLabels.has(TOOL_SOURCE_FALLBACK_LABEL)).toBe(false);
    expect(tsLabels.has(TOOL_SOURCE_FALLBACK_LABEL as never)).toBe(false);
  });

  it('squire.js TOOL_NAME_TO_LABEL matches the TS tool-name → label mapping', () => {
    // The replay path in the done handler maps raw tool names (persisted
    // in messages.consulted_sources) back to labels without going through
    // the server. This JS map must stay in sync with TOOL_SOURCE_LABELS
    // in src/web-ui/consulted-footer.ts. If a new tool is added to
    // ALL_AGENT_TOOLS + TOOL_SOURCE_LABELS but not to TOOL_NAME_TO_LABEL,
    // replayed turns that used the new tool render a blank footer.
    const jsSrc = readFileSync(
      fileURLToPath(new URL('../src/web-ui/squire.js', import.meta.url)),
      'utf8',
    );
    const match = jsSrc.match(/TOOL_NAME_TO_LABEL\s*=\s*\{([\s\S]*?)\};/);
    expect(match, 'could not locate TOOL_NAME_TO_LABEL in squire.js').not.toBeNull();
    const jsMap = new Map<string, string>();
    for (const entry of match![1]!.matchAll(/(?:['"]([^'"]+)['"]|(\w+))\s*:\s*['"]([^'"]+)['"]/g)) {
      jsMap.set((entry[1] ?? entry[2])!, entry[3]!);
    }

    // Derive from ALL_AGENT_TOOLS, filtering to the tools that actually map to
    // a provenance label. Same drift guarantee as the first drift test:
    // a new tool added to ALL_AGENT_TOOLS that should surface in the footer
    // must also be added to TOOL_NAME_TO_LABEL, or this loop fails.
    const toolNames = ALL_AGENT_TOOLS.map((tool) => tool.name).filter(
      (name) => toolSourceLabel(name) !== null,
    );
    for (const name of toolNames) {
      const tsLabel = toolSourceLabel(name);
      expect(jsMap.get(name), `JS TOOL_NAME_TO_LABEL missing mapping for ${name}`).toBe(tsLabel);
    }
    // Null-mapped tools (traversal/utility like follow_links) must NOT appear
    // in the JS map — they aren't provenance sources on either side.
    for (const tool of ALL_AGENT_TOOLS) {
      if (toolSourceLabel(tool.name) === null) {
        expect(
          jsMap.has(tool.name),
          `${tool.name} maps to null in TS but is present in JS TOOL_NAME_TO_LABEL`,
        ).toBe(false);
      }
    }
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
