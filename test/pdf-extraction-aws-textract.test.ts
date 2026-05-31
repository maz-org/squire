import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  AWS_TEXTRACT_PROVIDER_CONFIG_HASH,
  createClientRequestToken,
  createAwsTextractProvider,
  type AwsTextractRuntime,
} from '../eval/pdf-extraction/aws-textract.ts';
import { validateExtractionArtifact } from '../eval/pdf-extraction/schema.ts';

function textractRuntime(overrides: Partial<AwsTextractRuntime> = {}): AwsTextractRuntime {
  return {
    uploadDocument: vi.fn().mockResolvedValue({
      bucket: 'squire-evals',
      key: 'pdf-extraction/aws-textract/run.pdf',
    }),
    startDocumentAnalysis: vi.fn().mockResolvedValue({
      jobId: 'job-123',
      requestId: 'start-request-1',
    }),
    getDocumentAnalysis: vi.fn().mockResolvedValue({
      jobStatus: 'SUCCEEDED',
      requestId: 'get-request-1',
      documentMetadata: { pages: 1 },
      analyzeDocumentModelVersion: '1.0',
      blocks: [
        {
          id: 'page-30',
          blockType: 'PAGE',
          page: 1,
          relationships: [{ type: 'CHILD', ids: ['title-30', 'line-30', 'table-30'] }],
        },
        {
          id: 'title-30',
          blockType: 'LAYOUT_SECTION_HEADER',
          page: 1,
          text: 'Loot',
          confidence: 99,
          geometry: { boundingBox: { left: 0.1, top: 0.1, width: 0.2, height: 0.04 } },
        },
        {
          id: 'line-30',
          blockType: 'LINE',
          page: 1,
          text: 'Loot X lets a figure loot all loot tokens within range X.',
          confidence: 98,
          geometry: { boundingBox: { left: 0.1, top: 0.16, width: 0.7, height: 0.04 } },
        },
        {
          id: 'table-30',
          blockType: 'TABLE',
          page: 1,
          relationships: [{ type: 'CHILD', ids: ['cell-1', 'cell-2'] }],
          geometry: { boundingBox: { left: 0.1, top: 0.3, width: 0.5, height: 0.1 } },
        },
        {
          id: 'cell-1',
          blockType: 'CELL',
          page: 1,
          rowIndex: 1,
          columnIndex: 1,
          rowSpan: 1,
          columnSpan: 1,
          relationships: [{ type: 'CHILD', ids: ['word-loot'] }],
        },
        {
          id: 'cell-2',
          blockType: 'CELL',
          page: 1,
          rowIndex: 1,
          columnIndex: 2,
          rowSpan: 1,
          columnSpan: 1,
          relationships: [{ type: 'CHILD', ids: ['word-range'] }],
        },
        { id: 'word-loot', blockType: 'WORD', page: 1, text: 'Loot' },
        { id: 'word-range', blockType: 'WORD', page: 1, text: 'Range' },
      ],
    }),
    cleanupDocument: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function sourceFixture() {
  const outputDir = await mkdtemp(join(tmpdir(), 'squire-aws-textract-'));
  const sourcePath = join(outputDir, 'gh2-rule-book.pdf');
  await writeFile(sourcePath, 'fake pdf bytes', 'utf8');
  return { outputDir, sourcePath };
}

function prepareDocument() {
  return vi.fn(async (input: { pages: number[]; outputPath: string }) => ({
    sourcePath: input.outputPath,
    sourcePageCount: 74,
    pageMap: input.pages,
  }));
}

describe('AWS Textract PDF extraction provider', () => {
  it('scopes AWS idempotency tokens to provider configuration', () => {
    const baselineToken = createClientRequestToken(
      'sha256:abc',
      [30],
      'textract smoke',
      'sha256:config-a',
    );
    const changedConfigToken = createClientRequestToken(
      'sha256:abc',
      [30],
      'textract smoke',
      'sha256:config-b',
    );

    expect(baselineToken).toMatch(/^textract-[a-f0-9]{16}$/);
    expect(changedConfigToken).toMatch(/^textract-[a-f0-9]{16}$/);
    expect(changedConfigToken).not.toEqual(baselineToken);
  });

  it('wraps async Textract output in the shared normalized artifact schema', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const runtime = textractRuntime();
    const prepare = prepareDocument();
    const provider = createAwsTextractProvider({
      runtime,
      prepareDocument: prepare,
      now: () => '2026-05-30T00:00:00.000Z',
      costPerPageUsd: 0.015,
    });

    const artifact = await provider.extract({
      sourcePath,
      pages: [30],
      outputDir,
      runLabel: 'textract smoke',
      retryCount: 0,
      timeoutMs: 120_000,
    });

    expect(prepare).toHaveBeenCalledWith({
      sourcePath,
      pages: [30],
      outputPath: expect.stringContaining('/raw/aws-textract/'),
    });
    expect(runtime.uploadDocument).toHaveBeenCalledWith({
      sourcePath: expect.stringContaining('textract-smoke-input.pdf'),
      runLabel: 'textract smoke',
    });
    expect(runtime.startDocumentAnalysis).toHaveBeenCalledWith({
      bucket: 'squire-evals',
      key: 'pdf-extraction/aws-textract/run.pdf',
      clientRequestToken: expect.stringMatching(/^textract-[a-f0-9]{16}$/),
      featureTypes: ['TABLES', 'LAYOUT'],
      jobTag: 'textract-smoke',
    });
    expect(runtime.getDocumentAnalysis).toHaveBeenCalledWith({
      jobId: 'job-123',
      maxResults: 1000,
      nextToken: undefined,
    });
    expect(runtime.cleanupDocument).toHaveBeenCalledWith({
      bucket: 'squire-evals',
      key: 'pdf-extraction/aws-textract/run.pdf',
    });
    expect(validateExtractionArtifact(artifact)).toEqual(artifact);
    expect(artifact).toMatchObject({
      provider: 'aws-textract',
      providerConfigHash: AWS_TEXTRACT_PROVIDER_CONFIG_HASH,
      run: {
        id: 'textract smoke',
        status: 'succeeded',
        pageRange: [30],
      },
      cost: {
        estimatedUsd: 0.015,
        actualUsd: 0.015,
        pagesProcessed: 1,
        costPerPageUsd: 0.015,
      },
      privacy: {
        region: 'us-east-1',
        trainingUse: 'not-used-for-training',
      },
      providerMetadata: {
        mode: 'polling',
        jobId: 'job-123',
        requestIds: ['start-request-1', 'get-request-1'],
        s3: {
          bucket: 'squire-evals',
          key: 'pdf-extraction/aws-textract/run.pdf',
        },
        uploadedSourcePath: expect.stringContaining('textract-smoke-input.pdf'),
        pageMap: [30],
      },
    });
    expect(artifact.rawArtifacts[0]).toMatchObject({
      kind: 'provider-json',
      persisted: true,
      redacted: false,
    });
    expect(artifact.rawArtifacts[0].path).toContain('/raw/aws-textract/');
    expect(await readFile(artifact.rawArtifacts[0].path!, 'utf8')).toContain('"jobId": "job-123"');
    expect(artifact.pages[0]).toMatchObject({
      pageNumber: 30,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown: expect.stringContaining('## Loot'),
      text: expect.stringContaining('Loot X lets a figure loot all loot tokens within range X.'),
      blocks: expect.arrayContaining([
        expect.objectContaining({
          id: 'title-30',
          type: 'heading',
          text: 'Loot',
          confidence: 0.99,
          bbox: { x: 61.2, y: 79.2, width: 122.4, height: 31.68 },
        }),
        expect.objectContaining({
          id: 'line-30',
          type: 'line',
          text: 'Loot X lets a figure loot all loot tokens within range X.',
        }),
      ]),
      tables: [
        expect.objectContaining({
          id: 'table-30',
          order: 2,
          cells: [
            expect.objectContaining({ row: 0, column: 0, text: 'Loot' }),
            expect.objectContaining({ row: 0, column: 1, text: 'Range' }),
          ],
        }),
      ],
    });
  });

  it('surfaces failed async jobs as provider errors', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createAwsTextractProvider({
      runtime: textractRuntime({
        getDocumentAnalysis: vi.fn().mockResolvedValue({
          jobStatus: 'FAILED',
          statusMessage: 'document could not be processed',
          requestId: 'get-request-failed',
        }),
      }),
      prepareDocument: prepareDocument(),
      now: () => '2026-05-30T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'textract failure',
        retryCount: 0,
      }),
    ).rejects.toThrow(
      /provider error: Textract job job-123 failed: document could not be processed/,
    );
  });

  it('fails polling timeouts before waiting forever on in-progress jobs', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createAwsTextractProvider({
      runtime: textractRuntime({
        getDocumentAnalysis: vi.fn().mockResolvedValue({
          jobStatus: 'IN_PROGRESS',
          requestId: 'get-request-progress',
        }),
      }),
      prepareDocument: prepareDocument(),
      sleep: vi.fn().mockResolvedValue(undefined),
      maxPollAttempts: 2,
      now: () => '2026-05-30T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'textract timeout',
        retryCount: 0,
      }),
    ).rejects.toThrow(/timeout: Textract job job-123 did not finish after 2 polling attempts/);
  });

  it('maps Textract throttling and limit errors to rate-limit failures', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createAwsTextractProvider({
      runtime: textractRuntime({
        startDocumentAnalysis: vi.fn().mockRejectedValue(
          Object.assign(new Error('too many concurrent jobs'), {
            name: 'LimitExceededException',
          }),
        ),
      }),
      prepareDocument: prepareDocument(),
      now: () => '2026-05-30T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'textract rate limited',
        retryCount: 0,
      }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('fails selected-page runs when Textract returns partial success for requested pages', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createAwsTextractProvider({
      runtime: textractRuntime({
        getDocumentAnalysis: vi.fn().mockResolvedValue({
          jobStatus: 'PARTIAL_SUCCESS',
          requestId: 'get-request-partial',
          documentMetadata: { pages: 2 },
          warnings: [{ errorCode: 'PAGE_ERROR', pages: [2] }],
          blocks: [],
        }),
      }),
      prepareDocument: prepareDocument(),
      now: () => '2026-05-30T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30, 31],
        outputDir,
        runLabel: 'textract partial',
        retryCount: 0,
      }),
    ).rejects.toThrow(/partial page failure: Textract warning PAGE_ERROR for requested page 31/);
  });
});
