import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-runner-'));
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
      sourceHash: artifact.source.sha256,
      providerConfigHash: artifact.providerConfigHash,
      pages: [30],
      outputDir,
      runLabel: 'run-textract-page-30',
      retryCount: 0,
      maxEstimatedCostUsd: 0.1,
      estimatedCostUsd: 0.05,
      providerConcurrency: 1,
      onStatus: (event) => statusEvents.push(event),
    });

    expect(extract).toHaveBeenCalledWith({
      sourcePath: 'data/pdfs/gh2-rule-book.pdf',
      pages: [30],
      outputDir,
      runLabel: 'run-textract-page-30',
      retryCount: 0,
      timeoutMs: undefined,
    });
    expect(result.artifact.provider).toBe('aws-textract');
    expect(result.manifest).toMatchObject({
      schemaVersion: 'squire-pdf-extraction-manifest-v1',
      provider: 'aws-textract',
      runId: 'run-textract-page-30',
      normalizedArtifactPath: `${outputDir}/normalized/aws-textract/${artifact.source.sha256.slice(7)}/${artifact.providerConfigHash.slice(7)}/pages-30.json`,
      cache: {
        key: `${artifact.provider}:${artifact.source.sha256}:${artifact.providerConfigHash}:30`,
        hit: false,
      },
      execution: {
        selectedPages: [30],
        fullRulebook: false,
        fullRulebookOverride: false,
        estimatedCostUsd: 0.05,
        maxEstimatedCostUsd: 0.1,
        costOverride: false,
        retryLimit: 0,
        retryCount: 0,
        rateLimitCount: 0,
        concurrencyLimit: 1,
        refreshedProviderOutput: false,
      },
    });
    expect(result.manifest.normalizedArtifactHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(statusEvents.map((event) => event.stage)).toEqual(['started', 'succeeded']);
  });

  it('rejects provider results that do not satisfy the shared artifact schema', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-invalid-'));
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
        sourceHash: artifact.source.sha256,
        providerConfigHash: artifact.providerConfigHash,
        pages: [30],
        outputDir,
        runLabel: 'run-textract-page-30',
        retryCount: 0,
      }),
    ).rejects.toThrow(/PDF extraction provider returned invalid artifact: aws-textract/);
  });

  it('reports classified provider failures before rethrowing them', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-failure-'));
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
        sourceHash: artifact.source.sha256,
        providerConfigHash: artifact.providerConfigHash,
        pages: [30],
        outputDir,
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

  it('refuses full-rulebook runs before calling the provider unless explicitly allowed', async () => {
    const extract = vi.fn<PdfExtractionProvider['extract']>().mockResolvedValue(artifact);
    const registry = registryWith({
      id: 'aws-textract',
      displayName: 'AWS Textract',
      version: 'textract-test',
      extract,
    });

    await expect(
      runPdfExtraction({
        registry,
        provider: 'aws-textract',
        sourcePath: 'data/pdfs/gh2-rule-book.pdf',
        sourceHash: artifact.source.sha256,
        providerConfigHash: artifact.providerConfigHash,
        pages: [],
        outputDir: 'eval/results/pdf-extraction',
        runLabel: 'run-textract-full',
        retryCount: 0,
      }),
    ).rejects.toThrow(/Full-rulebook PDF extraction requires --allow-full-rulebook/);
    expect(extract).not.toHaveBeenCalled();
  });

  it('refuses estimated-cost overruns before calling the provider unless explicitly allowed', async () => {
    const extract = vi.fn<PdfExtractionProvider['extract']>().mockResolvedValue(artifact);
    const registry = registryWith({
      id: 'aws-textract',
      displayName: 'AWS Textract',
      version: 'textract-test',
      extract,
    });

    await expect(
      runPdfExtraction({
        registry,
        provider: 'aws-textract',
        sourcePath: 'data/pdfs/gh2-rule-book.pdf',
        sourceHash: artifact.source.sha256,
        providerConfigHash: artifact.providerConfigHash,
        pages: [30],
        outputDir: 'eval/results/pdf-extraction',
        runLabel: 'run-textract-page-30',
        retryCount: 0,
        estimatedCostUsd: 0.25,
        maxEstimatedCostUsd: 0.1,
      }),
    ).rejects.toThrow(/exceeds --max-estimated-cost-usd=0.1/);
    expect(extract).not.toHaveBeenCalled();
  });

  it('validates provider concurrency caps before paid provider work', async () => {
    const extract = vi.fn<PdfExtractionProvider['extract']>().mockResolvedValue(artifact);
    const registry = registryWith({
      id: 'aws-textract',
      displayName: 'AWS Textract',
      version: 'textract-test',
      extract,
    });

    await expect(
      runPdfExtraction({
        registry,
        provider: 'aws-textract',
        sourcePath: 'data/pdfs/gh2-rule-book.pdf',
        sourceHash: artifact.source.sha256,
        providerConfigHash: artifact.providerConfigHash,
        pages: [30],
        outputDir: 'eval/results/pdf-extraction',
        runLabel: 'run-textract-page-30',
        retryCount: 0,
        providerConcurrency: 0,
      }),
    ).rejects.toThrow(/Invalid aws-textract PDF extraction concurrency/);
    expect(extract).not.toHaveBeenCalled();
  });

  it('reuses successful content-addressed artifacts by default', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-cache-'));
    const extract = vi.fn<PdfExtractionProvider['extract']>().mockResolvedValue(artifact);
    const registry = registryWith({
      id: 'aws-textract',
      displayName: 'AWS Textract',
      version: 'textract-test',
      extract,
    });

    const first = await runPdfExtraction({
      registry,
      provider: 'aws-textract',
      sourcePath: 'data/pdfs/gh2-rule-book.pdf',
      sourceHash: artifact.source.sha256,
      providerConfigHash: artifact.providerConfigHash,
      pages: [30],
      outputDir,
      runLabel: 'run-textract-page-30',
      retryCount: 0,
    });
    const second = await runPdfExtraction({
      registry,
      provider: 'aws-textract',
      sourcePath: 'data/pdfs/gh2-rule-book.pdf',
      sourceHash: artifact.source.sha256,
      providerConfigHash: artifact.providerConfigHash,
      pages: [30],
      outputDir,
      runLabel: 'run-textract-page-30-repeat',
      retryCount: 0,
    });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(second.artifact).toEqual(first.artifact);
    expect(second.manifest.cache).toMatchObject({ hit: true });
    expect(JSON.parse(await readFile(first.manifest.normalizedArtifactPath, 'utf8'))).toMatchObject(
      {
        schemaVersion: 'squire-pdf-extraction-v1',
        provider: 'aws-textract',
      },
    );
  });

  it('refreshes content-addressed artifacts when explicitly requested', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-refresh-'));
    const refreshedArtifact = {
      ...artifact,
      run: {
        ...artifact.run,
        id: 'run-textract-page-30-refreshed',
      },
    } satisfies ExtractionArtifact;
    const extract = vi
      .fn<PdfExtractionProvider['extract']>()
      .mockResolvedValueOnce(artifact)
      .mockResolvedValueOnce(refreshedArtifact);
    const registry = registryWith({
      id: 'aws-textract',
      displayName: 'AWS Textract',
      version: 'textract-test',
      extract,
    });

    await runPdfExtraction({
      registry,
      provider: 'aws-textract',
      sourcePath: 'data/pdfs/gh2-rule-book.pdf',
      sourceHash: artifact.source.sha256,
      providerConfigHash: artifact.providerConfigHash,
      pages: [30],
      outputDir,
      runLabel: 'run-textract-page-30',
      retryCount: 0,
    });
    const refreshed = await runPdfExtraction({
      registry,
      provider: 'aws-textract',
      sourcePath: 'data/pdfs/gh2-rule-book.pdf',
      sourceHash: artifact.source.sha256,
      providerConfigHash: artifact.providerConfigHash,
      pages: [30],
      outputDir,
      runLabel: 'run-textract-page-30',
      retryCount: 0,
      refreshProviderOutput: true,
    });

    expect(extract).toHaveBeenCalledTimes(2);
    expect(refreshed.artifact.run.id).toBe('run-textract-page-30-refreshed');
    expect(refreshed.manifest.cache).toMatchObject({ hit: false });
    expect(refreshed.manifest.execution.refreshedProviderOutput).toBe(true);
  });

  it('retries rate limits and records retry audit fields in the manifest', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-retry-'));
    const extract = vi
      .fn<PdfExtractionProvider['extract']>()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValueOnce(artifact);
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
      sourceHash: artifact.source.sha256,
      providerConfigHash: artifact.providerConfigHash,
      pages: [30],
      outputDir,
      runLabel: 'run-textract-page-30',
      retryCount: 1,
      onStatus: (event) => statusEvents.push(event),
    });

    expect(extract).toHaveBeenCalledTimes(2);
    expect(statusEvents.map((event) => event.stage)).toEqual(['started', 'retrying', 'succeeded']);
    expect(result.manifest.execution).toMatchObject({
      retryLimit: 1,
      retryCount: 1,
      rateLimitCount: 1,
    });
  });

  it('times out provider calls and reports the timeout failure class', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-timeout-'));
    const extract = vi.fn<PdfExtractionProvider['extract']>(() => new Promise(() => undefined));
    const registry = registryWith({
      id: 'aws-textract',
      displayName: 'AWS Textract',
      version: 'textract-test',
      extract,
    });
    const statusEvents: PdfExtractionStatusEvent[] = [];

    await expect(
      runPdfExtraction({
        registry,
        provider: 'aws-textract',
        sourcePath: 'data/pdfs/gh2-rule-book.pdf',
        sourceHash: artifact.source.sha256,
        providerConfigHash: artifact.providerConfigHash,
        pages: [30],
        outputDir,
        runLabel: 'run-textract-page-30',
        retryCount: 0,
        timeoutMs: 1,
        onStatus: (event) => statusEvents.push(event),
      }),
    ).rejects.toThrow(/timed out after 1ms/);
    expect(statusEvents).toEqual([
      { stage: 'started', provider: 'aws-textract', runLabel: 'run-textract-page-30' },
      {
        stage: 'failed',
        provider: 'aws-textract',
        runLabel: 'run-textract-page-30',
        failureClass: 'timeout',
        message: 'PDF extraction provider timed out after 1ms.',
      },
    ]);
  });

  it('does not retry timed-out provider calls without provider abort support', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-timeout-retry-'));
    const extract = vi.fn<PdfExtractionProvider['extract']>(() => new Promise(() => undefined));
    const registry = registryWith({
      id: 'aws-textract',
      displayName: 'AWS Textract',
      version: 'textract-test',
      extract,
    });

    await expect(
      runPdfExtraction({
        registry,
        provider: 'aws-textract',
        sourcePath: 'data/pdfs/gh2-rule-book.pdf',
        sourceHash: artifact.source.sha256,
        providerConfigHash: artifact.providerConfigHash,
        pages: [30],
        outputDir,
        runLabel: 'run-textract-page-30',
        retryCount: 2,
        timeoutMs: 1,
      }),
    ).rejects.toThrow(/timed out after 1ms/);
    expect(extract).toHaveBeenCalledTimes(1);
  });
});
