import { describe, expect, it } from 'vitest';

import { FROSTHAVEN_GAME_ID, GLOOMHAVEN_2E_GAME_ID } from '../src/game.ts';
import { formatRetrievalSourceLabel } from '../src/retrieval-source.ts';
import { ruleSourceProvenance } from '../src/rule-source-provenance.ts';

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

describe('ruleSourceProvenance', () => {
  it('keys manifest metadata by game and basename', () => {
    expect(ruleSourceProvenance('gh2-faq.html', GLOOMHAVEN_2E_GAME_ID)).toMatchObject({
      game: GLOOMHAVEN_2E_GAME_ID,
      sourceRef: `source:${GLOOMHAVEN_2E_GAME_ID}/gh2-faq`,
      sourceType: 'faq',
      freshness: {
        capturedAt: '2026-05-24',
        sourceLastUpdated: '2026-04-19',
      },
    });

    expect(ruleSourceProvenance('gh2-faq.html', FROSTHAVEN_GAME_ID)).toMatchObject({
      game: FROSTHAVEN_GAME_ID,
      sourceRef: `source:${FROSTHAVEN_GAME_ID}/gh2-faq`,
      sourceType: 'faq',
      freshness: undefined,
    });
  });
});
