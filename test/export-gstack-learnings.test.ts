import { describe, expect, it } from 'vitest';

import {
  parseLearningsJsonl,
  renderLearningsMarkdown,
  selectCuratedLearnings,
} from '../scripts/export-gstack-learnings.ts';

describe('gstack learnings export', () => {
  it('parses jsonl records', () => {
    const records = parseLearningsJsonl(
      '{"key":"one","insight":"First","confidence":9}\n{"key":"two","insight":"Second","confidence":10}\n',
    );

    expect(records).toHaveLength(2);
    expect(records[0]?.key).toBe('one');
    expect(records[1]?.key).toBe('two');
  });

  it('skips malformed jsonl lines instead of aborting the export', () => {
    const records = parseLearningsJsonl(
      '{"key":"one","insight":"First","confidence":9}\nnot-json\n{"key":"two","insight":"Second","confidence":10}\n',
    );

    expect(records).toHaveLength(2);
    expect(records[0]?.key).toBe('one');
    expect(records[1]?.key).toBe('two');
  });

  it('keeps latest high-confidence unique records by key', () => {
    const records = [
      { key: 'same', insight: 'Old', confidence: 9, ts: '2026-04-08T00:00:00.000Z' },
      { key: 'same', insight: 'New', confidence: 10, ts: '2026-04-09T00:00:00.000Z' },
      { key: 'low', insight: 'Ignore me', confidence: 4, ts: '2026-04-09T01:00:00.000Z' },
    ];

    const curated = selectCuratedLearnings(records);

    expect(curated).toHaveLength(1);
    expect(curated[0]?.insight).toBe('New');
  });

  it('renders markdown with grouped sections', () => {
    const markdown = renderLearningsMarkdown([
      {
        key: 'pitfall-one',
        type: 'pitfall',
        insight: 'Do not share one test DB.',
        files: ['vitest.config.ts'],
        source: 'observed',
      },
      {
        key: 'pattern-one',
        type: 'pattern',
        insight: 'Keep repo adapters thin.',
        files: ['AGENTS.md'],
        source: 'observed',
      },
    ]);

    expect(markdown).toContain('# Curated Learnings');
    expect(markdown).toContain('## Pitfalls');
    expect(markdown).toContain('## Patterns');
    expect(markdown).toContain('**pitfall-one**');
    expect(markdown).toContain('**pattern-one**');
  });

  it('renders the documented empty state without an extra section header', () => {
    const markdown = renderLearningsMarkdown([]);

    expect(markdown).toContain('No curated learnings yet.');
    expect(markdown).not.toContain('## Current state');
  });
});
