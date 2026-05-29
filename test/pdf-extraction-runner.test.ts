import { describe, expect, it, vi } from 'vitest';

import { runPdfExtraction, type PdfExtractionStatusEvent } from '../eval/pdf-extraction/runner.ts';
import {
  createProviderRegistry,
  type PdfExtractionProvider,
} from '../eval/pdf-extraction/provider.ts';
import {
  computeProviderConfigHash,
  type ExtractionArtifact,
} from '../eval/pdf-extraction/schema.ts';

const artifact = {
  schemaVersion: 'squire-pdf-extraction-v1',
  provider: 'aws-textract',
  providerVersion: 'textract-test',
  providerConfigHash: computeProviderConfigHash({ featureTypes: ['LAYOUT', 'TABLES'] }),
  source: {
    path: 'data/pdfs/gh2-rule-book.pdf',
    sha256: `sha256:${'1'.repeat(64)}`,
    pageCount: 74,
  },
  run: {
    id: 'run-textract-page-30',
    startedAt: '2026-05-28T00:00:00.000Z',
    completedAt: '2026-05-28T00:00:10.000Z',
    status: 'succeeded',
    pageRange: [30],
    latencyMs: 10_000,
  },
  cost: {
    estimatedUsd: 0.05,
    actualUsd: 0.04,
    pagesProcessed: 1,
    costPerPageUsd: 0.04,
  },
  privacy: {
    retentionPolicy: 'async job output expires by provider policy',
    trainingUse: 'not-used-for-training',
    region: 'us-east-1',
  },
  rawArtifacts: [
    {
      kind: 'provider-json',
      path: 'eval/results/pdf-extraction/raw/aws-textract/run-textract-page-30.json',
      sha256: `sha256:${'2'.repeat(64)}`,
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
      blocks: [],
      tables: [],
    },
  ],
} satisfies ExtractionArtifact;

function registryWith(provider: PdfExtractionProvider) {
  const registry = createProviderRegistry();
  registry.register(provider);
  return registry;
}

describe('runPdfExtraction', () => {
  it('executes the selected provider and returns a normalized manifest', async () => {
    const extract = vi.fn<PdfExtractionProvider['extract']>().mockResolvedValue(artifact);
    const registry = registryWith({
      id: 'aws-textract',
      displayName: 'AWS Textract',
      version: 'textract-test',
      extract,
    });
    const statusEvents: PdfExtractionStatusEvent[] = [];

    const result = await runPdfExtraction({
      registry,
      provider: 'aws-textract',
      sourcePath: 'data/pdfs/gh2-rule-book.pdf',
      pages: [30],
      outputDir: 'eval/results/pdf-extraction',
      runLabel: 'run-textract-page-30',
      retryCount: 0,
      onStatus: (event) => statusEvents.push(event),
    });

    expect(extract).toHaveBeenCalledWith({
      sourcePath: 'data/pdfs/gh2-rule-book.pdf',
      pages: [30],
      outputDir: 'eval/results/pdf-extraction',
      runLabel: 'run-textract-page-30',
      retryCount: 0,
    });
    expect(result.artifact.provider).toBe('aws-textract');
    expect(result.manifest).toMatchObject({
      schemaVersion: 'squire-pdf-extraction-manifest-v1',
      provider: 'aws-textract',
      runId: 'run-textract-page-30',
      normalizedArtifactPath:
        'eval/results/pdf-extraction/normalized/aws-textract/run-textract-page-30.json',
      cache: {
        key: `${artifact.provider}:${artifact.source.sha256}:${artifact.providerConfigHash}:30`,
        hit: false,
      },
    });
    expect(result.manifest.normalizedArtifactHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(statusEvents.map((event) => event.stage)).toEqual(['started', 'succeeded']);
  });

  it('rejects provider results that do not satisfy the shared artifact schema', async () => {
    const invalidArtifact = { ...artifact };
    delete (invalidArtifact as Partial<ExtractionArtifact>).providerConfigHash;
    const registry = registryWith({
      id: 'aws-textract',
      displayName: 'AWS Textract',
      version: 'textract-test',
      extract: vi.fn<PdfExtractionProvider['extract']>().mockResolvedValue(invalidArtifact),
    });

    await expect(
      runPdfExtraction({
        registry,
        provider: 'aws-textract',
        sourcePath: 'data/pdfs/gh2-rule-book.pdf',
        pages: [30],
        outputDir: 'eval/results/pdf-extraction',
        runLabel: 'run-textract-page-30',
        retryCount: 0,
      }),
    ).rejects.toThrow(/PDF extraction provider returned invalid artifact: aws-textract/);
  });

  it('reports classified provider failures before rethrowing them', async () => {
    const registry = registryWith({
      id: 'aws-textract',
      displayName: 'AWS Textract',
      version: 'textract-test',
      extract: vi
        .fn<PdfExtractionProvider['extract']>()
        .mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 })),
    });
    const statusEvents: PdfExtractionStatusEvent[] = [];

    await expect(
      runPdfExtraction({
        registry,
        provider: 'aws-textract',
        sourcePath: 'data/pdfs/gh2-rule-book.pdf',
        pages: [30],
        outputDir: 'eval/results/pdf-extraction',
        runLabel: 'run-textract-page-30',
        retryCount: 0,
        onStatus: (event) => statusEvents.push(event),
      }),
    ).rejects.toThrow(/rate limited/);

    expect(statusEvents).toEqual([
      { stage: 'started', provider: 'aws-textract', runLabel: 'run-textract-page-30' },
      {
        stage: 'failed',
        provider: 'aws-textract',
        runLabel: 'run-textract-page-30',
        failureClass: 'rate_limit',
        message: 'rate limited',
      },
    ]);
  });
});
