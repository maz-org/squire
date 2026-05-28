import { describe, expect, it } from 'vitest';

import {
  ExtractionArtifactSchema,
  GroundTruthRecordSchema,
  computeProviderConfigHash,
  validateExtractionArtifact,
  type ExtractionArtifact,
} from '../eval/pdf-extraction/schema.ts';

function validArtifact(overrides: Partial<ExtractionArtifact> = {}): ExtractionArtifact {
  return {
    schemaVersion: 'squire-pdf-extraction-v1',
    provider: 'aws-textract',
    providerVersion: 'textract-2026-05',
    providerConfigHash: computeProviderConfigHash({
      featureTypes: ['TABLES', 'LAYOUT'],
      region: 'us-east-1',
    }),
    source: {
      path: 'data/pdfs/gh2-rule-book.pdf',
      sha256: `sha256:${'a'.repeat(64)}`,
      pageCount: 74,
    },
    run: {
      id: 'run-textract-selected-pages',
      startedAt: '2026-05-28T00:00:00.000Z',
      completedAt: '2026-05-28T00:01:00.000Z',
      status: 'succeeded',
      pageRange: [30],
      latencyMs: 60_000,
    },
    cost: {
      estimatedUsd: 0.05,
      actualUsd: 0.04,
      pagesProcessed: 1,
      costPerPageUsd: 0.04,
    },
    privacy: {
      retentionPolicy: 'Textract stores async results for 7 days unless OutputConfig is used.',
      trainingUse: 'not-used-for-training',
      region: 'us-east-1',
    },
    rawArtifacts: [
      {
        kind: 'provider-json',
        path: 'eval/results/pdf-extraction/raw/aws-textract/run-textract-selected-pages.json',
        sha256: `sha256:${'b'.repeat(64)}`,
        redacted: false,
        persisted: false,
      },
    ],
    pages: [
      {
        pageNumber: 30,
        width: 612,
        height: 792,
        unit: 'pt',
        markdown: '## Loot\n\nLoot X lets a figure loot tokens within range X.',
        text: 'Loot\n\nLoot X lets a figure loot tokens within range X.',
        blocks: [
          {
            id: 'p30-heading-loot',
            type: 'heading',
            order: 0,
            text: 'Loot',
            bbox: { x: 72, y: 100, width: 120, height: 20 },
            confidence: 0.99,
          },
          {
            id: 'p30-body-loot',
            type: 'paragraph',
            order: 1,
            text: 'Loot X lets a figure loot tokens within range X.',
            bbox: { x: 72, y: 130, width: 420, height: 60 },
          },
        ],
        tables: [
          {
            id: 'p30-table-loot',
            order: 2,
            cells: [
              {
                row: 0,
                column: 0,
                rowSpan: 1,
                columnSpan: 1,
                text: 'Loot X',
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('PDF extraction artifact schema', () => {
  it('accepts a strict provider artifact with source, config, privacy, cost, raw, page, block, and table metadata', () => {
    const parsed = validateExtractionArtifact(validArtifact());

    expect(parsed.provider).toBe('aws-textract');
    expect(parsed.pages[0].blocks[0]).toMatchObject({
      id: 'p30-heading-loot',
      type: 'heading',
      bbox: { x: 72, y: 100, width: 120, height: 20 },
    });
    expect(parsed.rawArtifacts[0]).toMatchObject({
      kind: 'provider-json',
      persisted: false,
    });
  });

  it('rejects artifacts that omit first-class audit fields', () => {
    const artifact = validArtifact();
    delete (artifact as Partial<ExtractionArtifact>).providerConfigHash;

    expect(() => validateExtractionArtifact(artifact)).toThrow(/providerConfigHash/);
  });

  it('rejects unknown fields so provider payloads cannot leak into normalized artifacts', () => {
    const artifact = {
      ...validArtifact(),
      providerPayload: { blocks: [] },
    };

    expect(() => ExtractionArtifactSchema.parse(artifact)).toThrow(/Unrecognized key/);
  });

  it('normalizes provider config hashes with stable key ordering', () => {
    expect(computeProviderConfigHash({ region: 'us-east-1', featureTypes: ['TABLES'] })).toBe(
      computeProviderConfigHash({ featureTypes: ['TABLES'], region: 'us-east-1' }),
    );
  });
});

describe('PDF extraction ground truth schema', () => {
  it('requires expected text plus structural and retrieval expectations', () => {
    const parsed = GroundTruthRecordSchema.parse({
      id: 'gh2-rulebook-page-30-loot',
      source: 'data/pdfs/gh2-rule-book.pdf',
      page: 30,
      region: { x: 60, y: 120, width: 490, height: 300 },
      category: 'rules-text',
      expectedText: 'Loot X lets a figure loot tokens within range X.',
      expectedHeadings: ['Loot'],
      expectedTables: [
        {
          id: 'loot-table',
          cells: [{ row: 0, column: 0, text: 'Loot X' }],
        },
      ],
      retrievalQueries: ['How does Loot X work?'],
      forbiddenRetrievalContextTerms: ['summon loot tokens'],
    });

    expect(parsed.expectedTables[0].cells[0].text).toBe('Loot X');
    expect(parsed.forbiddenRetrievalContextTerms).toEqual(['summon loot tokens']);
  });
});
