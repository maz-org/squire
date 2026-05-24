import { describe, expect, it } from 'vitest';

import { formatRetrievalSourceLabel } from '../src/retrieval-source.ts';

describe('formatRetrievalSourceLabel', () => {
  it('labels indexed PDF and HTML rule sources', () => {
    expect(formatRetrievalSourceLabel('gh2-rule-book.pdf')).toBe('Rulebook');
    expect(formatRetrievalSourceLabel('gh2-rule-book.md')).toBe('Rulebook');
    expect(formatRetrievalSourceLabel('gh2-faq.html')).toBe('FAQ');
    expect(formatRetrievalSourceLabel('gh2-faq.htm')).toBe('FAQ');
    expect(formatRetrievalSourceLabel('gh2-errata.html')).toBe('Errata');
    expect(formatRetrievalSourceLabel('gh2-errata.txt')).toBe('Errata');
    expect(formatRetrievalSourceLabel('fh-scenario-book-42-61.pdf')).toBe('Scenario Book 42-61');
  });
});
