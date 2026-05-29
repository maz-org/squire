import { describe, expect, it } from 'vitest';

import { buildPdfExtractionReport } from '../eval/pdf-extraction/report.ts';
import {
  computeProviderConfigHash,
  type ExtractionArtifact,
} from '../eval/pdf-extraction/schema.ts';

const appleVisionArtifact = {
  schemaVersion: 'squire-pdf-extraction-v1',
  provider: 'apple-vision',
  providerVersion: 'macos-vision-ocr-markdown-v1',
  providerConfigHash: computeProviderConfigHash({ provider: 'apple-vision' }),
  source: {
    path: 'data/pdfs/gh2-rule-book.pdf',
    sha256: `sha256:${'a'.repeat(64)}`,
    pageCount: 74,
  },
  run: {
    id: 'apple-vision-baseline',
    startedAt: '2026-05-29T00:00:00.000Z',
    completedAt: '2026-05-29T00:00:02.000Z',
    status: 'succeeded',
    pageRange: [2, 30],
    latencyMs: 2_000,
  },
  cost: {
    estimatedUsd: 0,
    actualUsd: 0,
    pagesProcessed: 2,
    costPerPageUsd: 0,
  },
  privacy: {
    retentionPolicy: 'local only',
    trainingUse: 'not-used-for-training',
  },
  rawArtifacts: [],
  pages: [
    {
      pageNumber: 2,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown: '## Contents\n\nRules Summary\n\n2',
      text: 'Contents\nRules Summary\n2',
      blocks: [
        { id: 'p2-b0', type: 'heading', order: 1, text: 'Contents' },
        { id: 'p2-b1', type: 'line', order: 0, text: 'Rules Summary' },
        { id: 'p2-b2', type: 'page-number', order: 2, text: '2' },
      ],
      tables: [],
    },
    {
      pageNumber: 30,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown:
        '## Loot\n\nLoot X lets a figure loot all loot to-\nkens within range X.\n\nSummon loot tokens.',
      text: 'Loot\nLoot X lets a figure loot all loot to-\nkens within range X.\nSummon loot tokens.',
      blocks: [
        { id: 'p30-b0', type: 'heading', order: 0, text: 'Loot' },
        { id: 'p30-b1', type: 'line', order: 1, text: 'Loot X lets a figure loot all loot to-' },
        { id: 'p30-b2', type: 'line', order: 2, text: 'kens within range X.' },
        { id: 'p30-b3', type: 'callout', order: 3, text: 'Summon loot tokens.' },
      ],
      tables: [],
    },
  ],
} satisfies ExtractionArtifact;

describe('PDF extraction report', () => {
  it('keeps Apple Vision as the baseline comparator and reports its known failure modes', () => {
    const report = buildPdfExtractionReport({
      artifact: appleVisionArtifact,
      score: {
        provider: 'apple-vision',
        providerVersion: 'macos-vision-ocr-markdown-v1',
        text: { requiredPhraseRecall: 0.8, averageCharacterErrorRate: 0.2 },
        structure: {
          headingRecall: 0.7,
          readingOrderScore: 0.5,
          tableCellRecall: 0,
          noiseRatio: 0.1,
        },
        retrieval: {
          queryCount: 1,
          top1Hits: 0,
          top3Hits: 0,
          top5Hits: 0,
          citeableContextHits: 0,
        },
        latencyMs: 2_000,
        cost: appleVisionArtifact.cost,
        privacy: appleVisionArtifact.privacy,
        failures: ['misleading retrieval context on gh2-rulebook-page-30-loot'],
      },
      manifestPath: 'eval/results/pdf-extraction/manifests/apple-vision-baseline.json',
      normalizedArtifactPath:
        'eval/results/pdf-extraction/normalized/apple-vision/source/config/pages-2-30.json',
    });

    expect(report).toMatchObject({
      schemaVersion: 'squire-pdf-extraction-report-v1',
      baselineComparator: {
        provider: 'apple-vision',
        role: 'baseline',
      },
      provider: 'apple-vision',
      score: {
        text: { requiredPhraseRecall: 0.8 },
        structure: { readingOrderScore: 0.5 },
      },
    });
    expect(report.failureModes.map((mode) => mode.id)).toEqual([
      'reading-order',
      'page-numbers',
      'toc-ordering',
      'heading-noise',
      'broken-hyphenation',
      'sidebar-callout-insertion',
    ]);
    expect(report.failureModes.filter((mode) => mode.observed).map((mode) => mode.id)).toEqual(
      expect.arrayContaining([
        'reading-order',
        'page-numbers',
        'toc-ordering',
        'broken-hyphenation',
        'sidebar-callout-insertion',
      ]),
    );
  });
});
