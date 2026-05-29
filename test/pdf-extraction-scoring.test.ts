import { describe, expect, it } from 'vitest';

import {
  scoreExtractionArtifact,
  type ExtractionScoreSummary,
} from '../eval/pdf-extraction/scoring.ts';
import {
  computeProviderConfigHash,
  type ExtractionArtifact,
} from '../eval/pdf-extraction/schema.ts';

const baseArtifact = {
  schemaVersion: 'squire-pdf-extraction-v1',
  provider: 'marker-datalab',
  providerVersion: 'marker-test',
  providerConfigHash: computeProviderConfigHash({ forceOcr: true }),
  source: {
    path: 'data/pdfs/gh2-rule-book.pdf',
    sha256: `sha256:${'f'.repeat(64)}`,
    pageCount: 74,
  },
  run: {
    id: 'run-marker-fixture',
    startedAt: '2026-05-28T00:00:00.000Z',
    completedAt: '2026-05-28T00:00:02.000Z',
    status: 'succeeded',
    pageRange: [30],
    latencyMs: 2_000,
  },
  cost: {
    estimatedUsd: 0,
    actualUsd: 0,
    pagesProcessed: 1,
    costPerPageUsd: 0,
  },
  privacy: {
    retentionPolicy: 'local only',
    trainingUse: 'not-used-for-training',
  },
  rawArtifacts: [],
  pages: [
    {
      pageNumber: 30,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown:
        '## Loot\n\nLoot X lets a figure loot all loot tokens within range X unless a scenario rule says otherwise.',
      text: 'Loot\n\nLoot X lets a figure loot all loot tokens within range X unless a scenario rule says otherwise.',
      blocks: [
        { id: 'heading', type: 'heading', order: 0, text: 'Loot' },
        {
          id: 'body',
          type: 'paragraph',
          order: 1,
          text: 'Loot X lets a figure loot all loot tokens within range X unless a scenario rule says otherwise.',
        },
      ],
      tables: [
        {
          id: 'loot-table',
          order: 2,
          cells: [
            { row: 0, column: 0, rowSpan: 1, columnSpan: 1, text: 'Loot X' },
            { row: 0, column: 1, rowSpan: 1, columnSpan: 1, text: 'Range X' },
          ],
        },
      ],
    },
  ],
} satisfies ExtractionArtifact;

const groundTruth = [
  {
    id: 'gh2-rulebook-page-30-loot',
    source: 'data/pdfs/gh2-rule-book.pdf',
    page: 30,
    region: null,
    category: 'rules-text',
    expectedText:
      'Loot X lets a figure loot all loot tokens within range X unless a scenario rule says otherwise.',
    expectedHeadings: ['Loot'],
    expectedTables: [
      {
        id: 'loot-table',
        cells: [
          { row: 0, column: 0, text: 'Loot X' },
          { row: 0, column: 1, text: 'Range X' },
        ],
      },
    ],
    retrievalQueries: ['How does Loot X work?'],
    forbiddenRetrievalContextTerms: ['summon loot tokens'],
  },
];

function score(artifact: ExtractionArtifact): ExtractionScoreSummary {
  return scoreExtractionArtifact(artifact, groundTruth);
}

describe('PDF extraction scorer', () => {
  it('scores a perfect fixture at full text and structure quality', () => {
    const summary = score(baseArtifact);

    expect(summary.text.requiredPhraseRecall).toBe(1);
    expect(summary.structure.headingRecall).toBe(1);
    expect(summary.structure.tableCellRecall).toBe(1);
    expect(summary.retrieval.citeableContextHits).toBe(1);
    expect(summary.failures).toEqual([]);
  });

  it('penalizes missing text without relying on a provider-specific payload', () => {
    const badArtifact = {
      ...baseArtifact,
      pages: [{ ...baseArtifact.pages[0], text: 'Loot tokens.', markdown: 'Loot tokens.' }],
    };

    expect(score(badArtifact).text.requiredPhraseRecall).toBeLessThan(1);
  });

  it('penalizes wrong reading order and table cell swaps', () => {
    const badArtifact = {
      ...baseArtifact,
      pages: [
        {
          ...baseArtifact.pages[0],
          blocks: [
            { ...baseArtifact.pages[0].blocks[0], order: 1 },
            { ...baseArtifact.pages[0].blocks[1], order: 0 },
          ],
          tables: [
            {
              ...baseArtifact.pages[0].tables[0],
              cells: [
                { row: 0, column: 0, rowSpan: 1, columnSpan: 1, text: 'Range X' },
                { row: 0, column: 1, rowSpan: 1, columnSpan: 1, text: 'Loot X' },
              ],
            },
          ],
        },
      ],
    };

    const summary = score(badArtifact);
    expect(summary.structure.readingOrderScore).toBeLessThan(1);
    expect(summary.structure.tableCellRecall).toBeLessThan(1);
  });

  it('uses explicit block order instead of array position for reading order', () => {
    const unsortedArtifact = {
      ...baseArtifact,
      pages: [
        {
          ...baseArtifact.pages[0],
          blocks: [baseArtifact.pages[0].blocks[1], baseArtifact.pages[0].blocks[0]],
        },
      ],
    };

    expect(score(unsortedArtifact).structure.readingOrderScore).toBe(1);
  });

  it('penalizes missing ground-truth pages across structure metrics', () => {
    const missingPageArtifact = {
      ...baseArtifact,
      pages: [],
    };

    const summary = score(missingPageArtifact);
    expect(summary.structure.headingRecall).toBeLessThan(1);
    expect(summary.structure.tableCellRecall).toBeLessThan(1);
    expect(summary.structure.readingOrderScore).toBeLessThan(1);
    expect(summary.structure.noiseRatio).toBe(1);
    expect(summary.failures).toEqual(expect.arrayContaining([expect.stringContaining('missing')]));
  });

  it('reports page-number noise and bad heading hierarchy', () => {
    const noisyBlocks: ExtractionArtifact['pages'][number]['blocks'] = [
      { id: 'page-number', type: 'page-number', order: 0, text: '30' },
      ...baseArtifact.pages[0].blocks.map((block) => ({ ...block, order: block.order + 1 })),
    ];
    const noisyArtifact = {
      ...baseArtifact,
      pages: [
        {
          ...baseArtifact.pages[0],
          text: `${baseArtifact.pages[0].text}\n\n30`,
          blocks: noisyBlocks,
        },
      ],
    };

    const summary = score(noisyArtifact);
    expect(summary.structure.noiseRatio).toBeGreaterThan(0);
    expect(summary.failures).toEqual(expect.arrayContaining([expect.stringContaining('heading')]));
  });

  it('penalizes misleading retrieval context separately from text extraction recall', () => {
    const misleadingArtifact = {
      ...baseArtifact,
      pages: [
        {
          ...baseArtifact.pages[0],
          text: `${baseArtifact.pages[0].text}\n\nSummon loot tokens during setup.`,
        },
      ],
    };

    const summary = score(misleadingArtifact);
    expect(summary.text.requiredPhraseRecall).toBe(1);
    expect(summary.retrieval.citeableContextHits).toBe(0);
    expect(summary.failures).toEqual(
      expect.arrayContaining([expect.stringContaining('misleading retrieval context')]),
    );
  });
});
