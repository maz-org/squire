import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runPdfExtractionEval } from '../eval/pdf-extraction/run.ts';
import {
  createProviderRegistry,
  type PdfExtractionProvider,
} from '../eval/pdf-extraction/provider.ts';
import { scoreExtractionArtifact } from '../eval/pdf-extraction/scoring.ts';
import {
  computeProviderConfigHash,
  type ExtractionArtifact,
} from '../eval/pdf-extraction/schema.ts';

const artifact = {
  schemaVersion: 'squire-pdf-extraction-v1',
  provider: 'apple-vision',
  providerVersion: 'macos-vision-ocr-markdown-v1',
  providerConfigHash: computeProviderConfigHash({ provider: 'apple-vision-test' }),
  source: {
    path: 'data/pdfs/gh2-rule-book.pdf',
    sha256: `sha256:${'1'.repeat(64)}`,
    pageCount: 74,
  },
  run: {
    id: 'apple-vision-page-30',
    startedAt: '2026-05-29T00:00:00.000Z',
    completedAt: '2026-05-29T00:00:01.000Z',
    status: 'succeeded',
    pageRange: [30],
    latencyMs: 1_000,
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
      markdown: '## Loot\n\nLoot X lets a figure loot all loot tokens within range X.',
      text: 'Loot\nLoot X lets a figure loot all loot tokens within range X.',
      blocks: [
        { id: 'p30-b0', type: 'heading', order: 0, text: 'Loot' },
        {
          id: 'p30-b1',
          type: 'line',
          order: 1,
          text: 'Loot X lets a figure loot all loot tokens within range X.',
        },
      ],
      tables: [],
    },
  ],
} satisfies ExtractionArtifact;

describe('PDF extraction eval run', () => {
  it('runs Apple Vision through the shared runner and writes manifest plus score report', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-eval-run-'));
    const registry = createProviderRegistry();
    const extract = vi.fn<PdfExtractionProvider['extract']>().mockResolvedValue(artifact);
    registry.register({
      id: 'apple-vision',
      displayName: 'Apple Vision',
      version: artifact.providerVersion,
      extract,
    });

    const result = await runPdfExtractionEval(
      {
        provider: 'apple-vision',
        sourcePath: artifact.source.path,
        pages: [30],
        outputDir,
        runLabel: 'apple-vision-page-30',
        retryCount: 0,
        allowFullRulebook: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        providerConcurrency: 1,
        refreshProviderOutput: false,
        timeoutMs: 120_000,
      },
      {
        registry,
        sourceHash: artifact.source.sha256,
        providerConfigHash: artifact.providerConfigHash,
        groundTruth: [
          {
            id: 'gh2-rulebook-page-30-loot',
            source: artifact.source.path,
            page: 30,
            region: null,
            category: 'rules-text',
            expectedText: 'Loot X lets a figure loot all loot tokens within range X.',
            expectedHeadings: ['Loot'],
            expectedTables: [],
            retrievalQueries: ['How does Loot X work?'],
            forbiddenRetrievalContextTerms: [],
          },
          {
            id: 'gh2-rulebook-page-31-line-of-sight',
            source: artifact.source.path,
            page: 31,
            region: null,
            category: 'rules-text',
            expectedText: 'Line-of-sight is checked from any part of one hex to another.',
            expectedHeadings: ['Line-of-Sight'],
            expectedTables: [],
            retrievalQueries: ['How does line-of-sight work?'],
            forbiddenRetrievalContextTerms: [],
          },
        ],
        scoreArtifact: async (artifact, groundTruth) =>
          scoreExtractionArtifact(artifact, groundTruth),
      },
    );

    expect(extract).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(result.manifestPath, 'utf8'))).toMatchObject({
      schemaVersion: 'squire-pdf-extraction-manifest-v1',
      provider: 'apple-vision',
      cache: { hit: false },
    });
    expect(JSON.parse(await readFile(result.reportPath, 'utf8'))).toMatchObject({
      schemaVersion: 'squire-pdf-extraction-report-v1',
      baselineComparator: { provider: 'apple-vision', role: 'baseline' },
      provider: 'apple-vision',
      score: {
        text: { requiredPhraseRecall: 1 },
        retrieval: { queryCount: 1, citeableContextHits: 1 },
      },
    });
    expect(result.manifest.normalizedArtifactPath).toContain('/normalized/apple-vision/');
    expect(result.report.failureModes.map((mode) => mode.id)).toContain('reading-order');
  });

  it('loads the checked-in ground truth when the caller runs outside the repo root', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-eval-run-'));
    const cwd = process.cwd();
    process.chdir(await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-cwd-')));

    try {
      const registry = createProviderRegistry();
      registry.register({
        id: 'apple-vision',
        displayName: 'Apple Vision',
        version: artifact.providerVersion,
        extract: vi.fn<PdfExtractionProvider['extract']>().mockResolvedValue(artifact),
      });

      await runPdfExtractionEval(
        {
          provider: 'apple-vision',
          sourcePath: artifact.source.path,
          pages: [30],
          outputDir,
          runLabel: 'apple-vision-page-30',
          retryCount: 0,
          allowFullRulebook: false,
          allowEstimatedCostOverride: false,
          maxEstimatedCostUsd: 1,
          providerConcurrency: 1,
          refreshProviderOutput: false,
          timeoutMs: 120_000,
        },
        {
          registry,
          sourceHash: artifact.source.sha256,
          providerConfigHash: artifact.providerConfigHash,
          scoreArtifact: async (artifact, groundTruth) => {
            expect(groundTruth).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  id: 'gh2-rulebook-p30-loot-ability',
                  page: 30,
                }),
              ]),
            );
            return scoreExtractionArtifact(artifact, groundTruth);
          },
        },
      );
    } finally {
      process.chdir(cwd);
    }
  });
});
