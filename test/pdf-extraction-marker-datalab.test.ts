import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMarkerDatalabProvider,
  createMarkerDatalabRestRuntime,
  markerDatalabProviderConfigHash,
  MARKER_DATALAB_PROVIDER_CONFIG_HASH,
  readMarkerDatalabJsonResponse,
  type MarkerDatalabRuntime,
} from '../eval/pdf-extraction/marker-datalab.ts';
import { validateExtractionArtifact } from '../eval/pdf-extraction/schema.ts';

function markerDatalabRuntime(overrides: Partial<MarkerDatalabRuntime> = {}): MarkerDatalabRuntime {
  return {
    startConvert: vi.fn().mockResolvedValue({
      requestId: 'request-123',
      requestCheckUrl: 'https://www.datalab.to/api/v1/convert/request-123',
      versions: { marker: '1.10.2' },
    }),
    getConvertResult: vi.fn().mockResolvedValue({
      status: 'complete',
      success: true,
      output_format: 'markdown,json,chunks',
      markdown:
        '# Loot\n\nLoot X lets a figure loot all loot tokens within range X.\n\n| Term | Meaning |\n| --- | --- |\n| Loot | Range |',
      json: [
        {
          id: '/page/29/Page/0',
          block_type: 'Page',
          polygon: [
            [0, 0],
            [612, 0],
            [612, 792],
            [0, 792],
          ],
          children: [
            {
              id: '/page/29/SectionHeader/0',
              block_type: 'SectionHeader',
              html: '<h1>Loot</h1>',
              polygon: [
                [70, 80],
                [180, 80],
                [180, 104],
                [70, 104],
              ],
              children: null,
            },
            {
              id: '/page/29/Text/1',
              block_type: 'Text',
              html: '<p>Loot X lets a figure loot all loot tokens within range X.</p>',
              children: null,
            },
            {
              id: '/page/29/Table/2',
              block_type: 'Table',
              html: '<table><tr><th>Term</th><th>Meaning</th></tr><tr><td>Loot</td><td>Range</td></tr></table>',
              polygon: [
                [64, 300],
                [260, 300],
                [260, 360],
                [64, 360],
              ],
              children: null,
            },
          ],
        },
      ],
      chunks: {
        blocks: [{ text: 'Loot X lets a figure loot all loot tokens within range X.' }],
      },
      images: { 'page-29-image-0.png': '<base64>' },
      metadata: {
        table_of_contents: [{ title: 'Loot', page_id: 29 }],
      },
      parse_quality_score: 4.8,
      page_count: 1,
      total_cost: 1,
      cost_breakdown: { final_cost: 1, list_cost: 1 },
      runtime: 2.4,
      versions: { marker: '1.10.2', chandra: '2026-01' },
      requestId: 'poll-request-1',
    }),
    ...overrides,
  };
}

async function sourceFixture() {
  const outputDir = await mkdtemp(join(tmpdir(), 'squire-marker-datalab-'));
  const sourcePath = join(outputDir, 'gh2-rule-book.pdf');
  await writeFile(sourcePath, 'fake pdf bytes', 'utf8');
  return { outputDir, sourcePath };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Marker/Datalab PDF extraction provider', () => {
  it('wraps selected-page Datalab output in the shared normalized artifact schema', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const runtime = markerDatalabRuntime();
    const provider = createMarkerDatalabProvider({
      runtime,
      now: () => '2026-06-01T00:00:00.000Z',
      costPerPageUsd: 0.006,
    });

    const artifact = await provider.extract({
      sourcePath,
      pages: [30],
      outputDir,
      runLabel: 'marker-datalab smoke',
      retryCount: 0,
      timeoutMs: 120_000,
    });

    expect(runtime.startConvert).toHaveBeenCalledWith({
      sourcePath,
      request: expect.objectContaining({
        mode: 'accurate',
        outputFormat: 'markdown,json,chunks',
        pageRange: '29',
        addBlockIds: true,
        includeMarkdownInChunks: true,
        extras: 'table_row_bboxes,extract_links,new_block_types',
      }),
    });
    expect(runtime.getConvertResult).toHaveBeenCalledWith({
      requestId: 'request-123',
      requestCheckUrl: 'https://www.datalab.to/api/v1/convert/request-123',
    });
    expect(validateExtractionArtifact(artifact)).toEqual(artifact);
    expect(artifact).toMatchObject({
      provider: 'marker-datalab',
      providerConfigHash: MARKER_DATALAB_PROVIDER_CONFIG_HASH,
      run: {
        id: 'marker-datalab smoke',
        status: 'succeeded',
        pageRange: [30],
      },
      cost: {
        estimatedUsd: 0.006,
        actualUsd: 0.01,
        pagesProcessed: 1,
        costPerPageUsd: 0.006,
      },
      privacy: {
        trainingUse: 'not-used-for-training',
        region: 'us',
      },
      providerMetadata: {
        mode: 'accurate',
        outputFormat: 'markdown,json,chunks',
        pageRange: '29',
        requestId: 'request-123',
        parseQualityScore: 4.8,
        imageCount: 1,
      },
    });
    expect(artifact.rawArtifacts).toEqual([
      expect.objectContaining({ kind: 'provider-json', redacted: false, persisted: true }),
    ]);
    expect(await readFile(artifact.rawArtifacts[0].path!, 'utf8')).toContain(
      '"requestId": "request-123"',
    );
    expect(artifact.pages[0]).toMatchObject({
      pageNumber: 30,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown: expect.stringContaining('Loot'),
      text: expect.stringContaining('Loot X lets a figure loot all loot tokens within range X.'),
      blocks: [
        expect.objectContaining({ type: 'heading', text: 'Loot' }),
        expect.objectContaining({
          type: 'paragraph',
          text: 'Loot X lets a figure loot all loot tokens within range X.',
        }),
        expect.objectContaining({ type: 'table', text: 'Term Meaning Loot Range' }),
      ],
      tables: [
        expect.objectContaining({
          bbox: { x: 64, y: 300, width: 196, height: 60 },
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

  it('surfaces failed convert requests as provider errors', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createMarkerDatalabProvider({
      runtime: markerDatalabRuntime({
        getConvertResult: vi.fn().mockResolvedValue({
          status: 'failed',
          success: false,
          error: 'document could not be processed',
        }),
      }),
      now: () => '2026-06-01T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'marker-datalab failure',
        retryCount: 0,
      }),
    ).rejects.toThrow(
      /provider error: Datalab request request-123 failed: document could not be processed/,
    );
  });

  it('fails polling timeouts before waiting forever on processing requests', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createMarkerDatalabProvider({
      runtime: markerDatalabRuntime({
        getConvertResult: vi.fn().mockResolvedValue({
          status: 'processing',
          success: true,
        }),
      }),
      sleep: vi.fn().mockResolvedValue(undefined),
      maxPollAttempts: 2,
      now: () => '2026-06-01T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'marker-datalab timeout',
        retryCount: 0,
      }),
    ).rejects.toThrow(
      /timeout: Datalab request request-123 did not finish after 2 polling attempts/,
    );
  });

  it('maps Datalab throttling errors to rate-limit failures', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createMarkerDatalabProvider({
      runtime: markerDatalabRuntime({
        startConvert: vi.fn().mockRejectedValue(
          Object.assign(new Error('too many conversion jobs'), {
            status: 429,
          }),
        ),
      }),
      now: () => '2026-06-01T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'marker-datalab rate limited',
        retryCount: 0,
      }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('preserves HTTP status on non-JSON provider errors', async () => {
    await expect(
      readMarkerDatalabJsonResponse(
        new Response('upstream unavailable', {
          status: 502,
          statusText: 'Bad Gateway',
        }),
      ),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('upstream unavailable'),
    });
  });

  it('uploads local PDFs with the Datalab file multipart field', async () => {
    const { sourcePath } = await sourceFixture();
    vi.stubEnv('DATALAB_API_KEY', 'test-key');
    vi.stubEnv('DATALAB_BASE_URL', 'https://datalab.test');
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      expect(url).toBe('https://datalab.test/api/v1/convert');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        Accept: 'application/json',
        'X-API-Key': 'test-key',
      });
      const body = init?.body as FormData;
      expect(body.get('file')).toBeInstanceOf(Blob);
      expect(body.get('file.0')).toBeNull();
      expect(body.get('mode')).toBe('accurate');
      expect(body.get('output_format')).toBe('markdown,json,chunks');
      expect(body.get('page_range')).toBe('29');
      return new Response(
        JSON.stringify({
          request_id: 'request-123',
          request_check_url: '/api/v1/convert/request-123',
          success: true,
          versions: { marker: '1.10.2' },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetch);

    const runtime = await createMarkerDatalabRestRuntime();
    const result = await runtime.startConvert({
      sourcePath,
      request: {
        mode: 'accurate',
        outputFormat: 'markdown,json,chunks',
        pageRange: '29',
        paginate: true,
        addBlockIds: true,
        includeMarkdownInChunks: true,
        disableImageExtraction: false,
        disableImageCaptions: false,
        tokenEfficientMarkdown: false,
        skipCache: false,
        saveCheckpoint: false,
        extras: 'table_row_bboxes,extract_links,new_block_types',
      },
    });

    expect(result).toEqual({
      requestId: 'request-123',
      requestCheckUrl: 'https://datalab.test/api/v1/convert/request-123',
      versions: { marker: '1.10.2' },
    });
  });

  it('hashes the effective runtime provider configuration', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createMarkerDatalabProvider({
      runtime: markerDatalabRuntime(),
      mode: 'balanced',
      skipCache: true,
      costPerPageUsd: 0.004,
      now: () => '2026-06-01T00:00:00.000Z',
    });

    const artifact = await provider.extract({
      sourcePath,
      pages: [30],
      outputDir,
      runLabel: 'marker-datalab effective config',
      retryCount: 0,
    });

    expect(artifact.providerConfigHash).toBe(
      markerDatalabProviderConfigHash({
        mode: 'balanced',
        skipCache: true,
        costPerPageUsd: 0.004,
      }),
    );
    expect(artifact.providerConfigHash).not.toBe(MARKER_DATALAB_PROVIDER_CONFIG_HASH);
    expect(artifact.rawArtifacts[0].path).toContain(artifact.providerConfigHash.slice(7));
  });

  it('redacts signed result URLs from persisted raw provider output', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const signedResultUrl = 'https://signed.datalab.test/result.json?token=secret';
    const provider = createMarkerDatalabProvider({
      runtime: markerDatalabRuntime({
        getConvertResult: vi.fn().mockResolvedValue({
          ...((await markerDatalabRuntime().getConvertResult({
            requestId: 'request-123',
            requestCheckUrl: 'https://www.datalab.to/api/v1/convert/request-123',
          })) as object),
          result_url: signedResultUrl,
        }),
      }),
      now: () => '2026-06-01T00:00:00.000Z',
    });

    const artifact = await provider.extract({
      sourcePath,
      pages: [30],
      outputDir,
      runLabel: 'marker-datalab redacted result url',
      retryCount: 0,
    });

    expect(artifact.rawArtifacts[0].redacted).toBe(true);
    const raw = await readFile(artifact.rawArtifacts[0].path!, 'utf8');
    expect(raw).not.toContain(signedResultUrl);
    expect(raw).toContain('"result_url": "[redacted]"');
  });

  it('rejects completed requests that omit requested page output', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createMarkerDatalabProvider({
      runtime: markerDatalabRuntime({
        getConvertResult: vi.fn().mockResolvedValue({
          status: 'complete',
          success: true,
          json: [],
          markdown: null,
        }),
      }),
      now: () => '2026-06-01T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'marker-datalab invalid',
        retryCount: 0,
      }),
    ).rejects.toThrow(/invalid artifact: Datalab output contained no pages/);
  });
});
