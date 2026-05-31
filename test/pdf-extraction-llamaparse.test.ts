import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createLlamaParseProvider,
  LLAMAPARSE_PROVIDER_CONFIG_HASH,
  type LlamaParseRuntime,
} from '../eval/pdf-extraction/llamaparse.ts';
import { validateExtractionArtifact } from '../eval/pdf-extraction/schema.ts';

function llamaParseRuntime(overrides: Partial<LlamaParseRuntime> = {}): LlamaParseRuntime {
  return {
    uploadFile: vi.fn().mockResolvedValue({
      fileId: 'file-123',
      requestId: 'upload-request-1',
    }),
    startParse: vi.fn().mockResolvedValue({
      jobId: 'job-123',
      status: 'PENDING',
      requestId: 'parse-request-1',
    }),
    getParseResult: vi.fn().mockResolvedValue({
      job: {
        id: 'job-123',
        status: 'COMPLETED',
      },
      markdown: {
        pages: [
          {
            page_number: 30,
            success: true,
            markdown:
              '# Loot\n\nLoot X lets a figure loot all loot tokens within range X.\n\n| Term | Meaning |\n| --- | --- |\n| Loot | Range |',
          },
        ],
      },
      text: {
        pages: [
          {
            page_number: 30,
            text: 'Loot\nLoot X lets a figure loot all loot tokens within range X.\nTerm Meaning Loot Range',
          },
        ],
      },
      items: {
        pages: [
          {
            page_number: 30,
            page_width: 612,
            page_height: 792,
            success: true,
            items: [
              { type: 'heading', level: 1, value: 'Loot', md: '# Loot' },
              {
                type: 'text',
                value: 'Loot X lets a figure loot all loot tokens within range X.',
                md: 'Loot X lets a figure loot all loot tokens within range X.',
              },
              {
                type: 'table',
                rows: [
                  ['Term', 'Meaning'],
                  ['Loot', 'Range'],
                ],
                md: '| Term | Meaning |\n| --- | --- |\n| Loot | Range |',
              },
            ],
          },
        ],
      },
      metadata: {
        pages: [
          {
            page_number: 30,
            confidence: 0.97,
            cost_optimized: false,
          },
        ],
      },
      job_metadata: {
        version: '2026-01-08',
        processing_ms: 3210,
        cache_hit: false,
      },
    }),
    ...overrides,
  };
}

async function sourceFixture() {
  const outputDir = await mkdtemp(join(tmpdir(), 'squire-llamaparse-'));
  const sourcePath = join(outputDir, 'gh2-rule-book.pdf');
  await writeFile(sourcePath, 'fake pdf bytes', 'utf8');
  return { outputDir, sourcePath };
}

describe('LlamaParse PDF extraction provider', () => {
  it('wraps selected-page LlamaParse output in the shared normalized artifact schema', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const runtime = llamaParseRuntime();
    const provider = createLlamaParseProvider({
      runtime,
      now: () => '2026-05-31T00:00:00.000Z',
      costPerPageUsd: 0.05,
    });

    const artifact = await provider.extract({
      sourcePath,
      pages: [30],
      outputDir,
      runLabel: 'llamaparse smoke',
      retryCount: 0,
      timeoutMs: 120_000,
    });

    expect(runtime.uploadFile).toHaveBeenCalledWith({
      sourcePath,
      purpose: 'parse',
    });
    expect(runtime.startParse).toHaveBeenCalledWith({
      fileId: 'file-123',
      request: expect.objectContaining({
        tier: 'agentic',
        version: 'latest',
        page_ranges: { target_pages: '30' },
        disable_cache: false,
        expand: ['markdown', 'text', 'items', 'metadata', 'job_metadata'],
      }),
    });
    expect(runtime.getParseResult).toHaveBeenCalledWith({
      jobId: 'job-123',
      expand: ['markdown', 'text', 'items', 'metadata', 'job_metadata'],
    });
    expect(validateExtractionArtifact(artifact)).toEqual(artifact);
    expect(artifact).toMatchObject({
      provider: 'llamaparse',
      providerConfigHash: LLAMAPARSE_PROVIDER_CONFIG_HASH,
      run: {
        id: 'llamaparse smoke',
        status: 'succeeded',
        pageRange: [30],
      },
      cost: {
        estimatedUsd: 0.05,
        actualUsd: 0.05,
        pagesProcessed: 1,
        costPerPageUsd: 0.05,
      },
      privacy: {
        trainingUse: 'unknown',
        region: 'us',
      },
      providerMetadata: {
        tier: 'agentic',
        version: 'latest',
        effectiveVersion: '2026-01-08',
        cacheHit: false,
        fileId: 'file-123',
        jobId: 'job-123',
        requestIds: ['upload-request-1', 'parse-request-1'],
        expand: ['markdown', 'text', 'items', 'metadata', 'job_metadata'],
        pageRanges: { target_pages: '30' },
        parseSettings: expect.any(Object),
        ocrSettings: { languages: ['en'] },
      },
    });
    expect(artifact.rawArtifacts).toEqual([
      expect.objectContaining({ kind: 'provider-json', redacted: false, persisted: true }),
    ]);
    expect(await readFile(artifact.rawArtifacts[0].path!, 'utf8')).toContain('"jobId": "job-123"');
    expect(artifact.pages[0]).toMatchObject({
      pageNumber: 30,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown: expect.stringContaining('# Loot'),
      text: expect.stringContaining('Loot X lets a figure loot all loot tokens within range X.'),
      blocks: [
        expect.objectContaining({ type: 'heading', text: 'Loot', confidence: 0.97 }),
        expect.objectContaining({
          type: 'paragraph',
          text: 'Loot X lets a figure loot all loot tokens within range X.',
        }),
        expect.objectContaining({ type: 'table', text: expect.stringContaining('| Term |') }),
      ],
      tables: [
        expect.objectContaining({
          cells: [
            expect.objectContaining({ row: 0, column: 0, text: 'Term' }),
            expect.objectContaining({ row: 0, column: 1, text: 'Meaning' }),
            expect.objectContaining({ row: 1, column: 0, text: 'Loot' }),
            expect.objectContaining({ row: 1, column: 1, text: 'Range' }),
          ],
        }),
      ],
    });
  });

  it('surfaces failed parse jobs as provider errors', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createLlamaParseProvider({
      runtime: llamaParseRuntime({
        getParseResult: vi.fn().mockResolvedValue({
          job: {
            id: 'job-123',
            status: 'FAILED',
            error: 'document could not be processed',
          },
        }),
      }),
      now: () => '2026-05-31T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'llamaparse failure',
        retryCount: 0,
      }),
    ).rejects.toThrow(
      /provider error: LlamaParse job job-123 failed: document could not be processed/,
    );
  });

  it('fails polling timeouts before waiting forever on running jobs', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createLlamaParseProvider({
      runtime: llamaParseRuntime({
        getParseResult: vi.fn().mockResolvedValue({
          job: { id: 'job-123', status: 'RUNNING' },
        }),
      }),
      sleep: vi.fn().mockResolvedValue(undefined),
      maxPollAttempts: 2,
      now: () => '2026-05-31T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'llamaparse timeout',
        retryCount: 0,
      }),
    ).rejects.toThrow(/timeout: LlamaParse job job-123 did not finish after 2 polling attempts/);
  });

  it('maps LlamaParse throttling errors to rate-limit failures', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createLlamaParseProvider({
      runtime: llamaParseRuntime({
        startParse: vi.fn().mockRejectedValue(
          Object.assign(new Error('too many parse jobs'), {
            status: 429,
          }),
        ),
      }),
      now: () => '2026-05-31T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'llamaparse rate limited',
        retryCount: 0,
      }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('rejects completed jobs that omit requested page output', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createLlamaParseProvider({
      runtime: llamaParseRuntime({
        getParseResult: vi.fn().mockResolvedValue({
          job: { id: 'job-123', status: 'COMPLETED' },
          markdown: { pages: [] },
          text: { pages: [] },
          items: { pages: [] },
          metadata: { pages: [] },
        }),
      }),
      now: () => '2026-05-31T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'llamaparse invalid',
        retryCount: 0,
      }),
    ).rejects.toThrow(/invalid artifact: LlamaParse output omitted page 30/);
  });
});
