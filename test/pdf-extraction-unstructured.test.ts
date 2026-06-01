import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createUnstructuredProvider,
  readUnstructuredJsonResponse,
  UNSTRUCTURED_PROVIDER_CONFIG_HASH,
  unstructuredProviderConfigHash,
  type UnstructuredRuntime,
} from '../eval/pdf-extraction/unstructured.ts';
import { validateExtractionArtifact } from '../eval/pdf-extraction/schema.ts';

function unstructuredRuntime(overrides: Partial<UnstructuredRuntime> = {}): UnstructuredRuntime {
  return {
    createJob: vi.fn().mockResolvedValue({
      id: 'job-123',
      workflow_id: 'workflow-123',
      workflow_name: 'On-demand extraction',
      status: 'SCHEDULED',
      input_file_ids: ['subset.pdf'],
      job_type: 'ephemeral',
    }),
    getJob: vi.fn().mockResolvedValue({
      id: 'job-123',
      workflow_id: 'workflow-123',
      workflow_name: 'On-demand extraction',
      status: 'COMPLETED',
      runtime: 'PT10S',
      input_file_ids: ['subset.pdf'],
      output_node_files: [
        {
          node_id: 'node-partition',
          file_id: 'partition-001.json',
          node_type: 'partition',
          node_subtype: 'unstructured_api',
        },
        {
          node_id: 'node-output',
          file_id: 'output-001.json',
          node_type: 'destination',
          node_subtype: 'local',
        },
      ],
      job_type: 'ephemeral',
    }),
    getJobDetails: vi.fn().mockResolvedValue({
      id: 'job-123',
      processing_status: 'SUCCESS',
      node_stats: [
        {
          node_name: 'Partitioner',
          node_type: 'partition',
          node_subtype: 'unstructured_api',
          ready: 0,
          in_progress: 0,
          success: 1,
          failure: 0,
        },
      ],
      message: null,
    }),
    downloadJobOutput: vi.fn().mockResolvedValue([
      {
        element_id: 'title-1',
        type: 'Title',
        text: 'Loot',
        metadata: {
          page_number: 1,
          detection_class_prob: 0.98,
          coordinates: {
            layout_width: 612,
            layout_height: 792,
            points: [
              [72, 72],
              [220, 72],
              [220, 110],
              [72, 110],
            ],
          },
        },
      },
      {
        element_id: 'text-1',
        type: 'NarrativeText',
        text: 'Loot X lets a figure loot all loot tokens within range X.',
        metadata: {
          page_number: 1,
          detection_class_prob: 0.94,
        },
      },
      {
        element_id: 'table-1',
        type: 'Table',
        text: 'Term Meaning Loot Range',
        metadata: {
          page_number: 1,
          text_as_html:
            '<table><tr><th>Term</th><th>Meaning</th></tr><tr><td>Loot</td><td>Range</td></tr></table>',
          coordinates: {
            layout_width: 612,
            layout_height: 792,
            points: [
              [72, 300],
              [420, 300],
              [420, 420],
              [72, 420],
            ],
          },
        },
      },
    ]),
    ...overrides,
  };
}

async function sourceFixture() {
  const outputDir = await mkdtemp(join(tmpdir(), 'squire-unstructured-'));
  const sourcePath = join(outputDir, 'gh2-rule-book.pdf');
  await writeFile(sourcePath, 'fake pdf bytes', 'utf8');
  return { outputDir, sourcePath };
}

describe('Unstructured PDF extraction provider', () => {
  it('wraps selected-page on-demand job output in the shared normalized artifact schema', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const runtime = unstructuredRuntime();
    const provider = createUnstructuredProvider({
      runtime,
      prepareDocument: vi.fn().mockResolvedValue({
        sourcePath,
        sourcePageCount: 86,
        pageMap: [30],
      }),
      now: () => '2026-05-31T00:00:00.000Z',
      costPerPageUsd: 0.03,
      generativeOcr: {
        subtype: 'openai_ocr',
        providerType: 'openai',
        model: 'gpt-4.1-mini',
      },
    });

    const artifact = await provider.extract({
      sourcePath,
      pages: [30],
      outputDir,
      runLabel: 'unstructured smoke',
      retryCount: 0,
      timeoutMs: 120_000,
    });

    expect(runtime.createJob).toHaveBeenCalledWith({
      sourcePath,
      requestData: {
        job_nodes: [
          {
            name: 'Partitioner',
            type: 'partition',
            subtype: 'unstructured_api',
            settings: {
              strategy: 'hi_res',
              coordinates: true,
              infer_table_structure: true,
              pdf_infer_table_structure: true,
              extract_image_block_types: ['Image', 'Table'],
              include_page_breaks: false,
              ocr_languages: ['eng'],
            },
          },
          {
            name: 'Enrichment',
            type: 'prompter',
            subtype: 'twopass_table2html',
            settings: {},
          },
          {
            name: 'Enrichment',
            type: 'prompter',
            subtype: 'openai_ocr',
            settings: {
              provider_type: 'openai',
              model: 'gpt-4.1-mini',
            },
          },
        ],
      },
    });
    expect(runtime.getJob).toHaveBeenCalledWith({ jobId: 'job-123' });
    expect(runtime.getJobDetails).toHaveBeenCalledWith({ jobId: 'job-123' });
    expect(runtime.downloadJobOutput).toHaveBeenCalledWith({
      jobId: 'job-123',
      fileId: 'output-001.json',
      nodeId: 'node-output',
    });
    expect(validateExtractionArtifact(artifact)).toEqual(artifact);
    expect(artifact).toMatchObject({
      provider: 'unstructured',
      providerConfigHash: unstructuredProviderConfigHash({
        strategy: 'hi_res',
        tableToHtml: true,
        generativeOcr: {
          subtype: 'openai_ocr',
          providerType: 'openai',
          model: 'gpt-4.1-mini',
        },
        costPerPageUsd: 0.03,
      }),
      source: {
        path: sourcePath,
        pageCount: 86,
      },
      run: {
        id: 'unstructured smoke',
        status: 'succeeded',
        pageRange: [30],
      },
      cost: {
        estimatedUsd: 0.03,
        actualUsd: 0.03,
        pagesProcessed: 1,
        costPerPageUsd: 0.03,
      },
      privacy: {
        retentionPolicy: expect.stringContaining('on-demand workflow job'),
        trainingUse: 'unknown',
      },
      providerMetadata: {
        api: 'workflow-on-demand-jobs',
        jobId: 'job-123',
        workflowId: 'workflow-123',
        workflowName: 'On-demand extraction',
        jobType: 'ephemeral',
        processingStatus: 'SUCCESS',
        nodeStats: expect.any(Array),
        pageMap: [30],
        partitionStrategy: 'hi_res',
        tableToHtml: true,
        generativeOcr: {
          subtype: 'openai_ocr',
          providerType: 'openai',
          model: 'gpt-4.1-mini',
        },
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
      markdown: expect.stringContaining('## Loot'),
      text: expect.stringContaining('Loot X lets a figure loot all loot tokens within range X.'),
      blocks: [
        expect.objectContaining({
          id: 'title-1',
          type: 'heading',
          text: 'Loot',
          confidence: 0.98,
          bbox: { x: 72, y: 72, width: 148, height: 38 },
        }),
        expect.objectContaining({
          id: 'text-1',
          type: 'paragraph',
          text: 'Loot X lets a figure loot all loot tokens within range X.',
        }),
        expect.objectContaining({
          id: 'table-1',
          type: 'table',
          text: 'Term Meaning Loot Range',
          bbox: { x: 72, y: 300, width: 348, height: 120 },
        }),
      ],
      tables: [
        expect.objectContaining({
          id: 'table-1',
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

  it('surfaces failed workflow jobs as provider errors', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createUnstructuredProvider({
      runtime: unstructuredRuntime({
        getJob: vi.fn().mockResolvedValue({
          id: 'job-123',
          status: 'FAILED',
        }),
        getJobDetails: vi.fn().mockResolvedValue({
          id: 'job-123',
          processing_status: 'FAILED',
          node_stats: [],
          message: 'document could not be processed',
        }),
      }),
      prepareDocument: vi
        .fn()
        .mockResolvedValue({ sourcePath, sourcePageCount: 86, pageMap: [30] }),
      now: () => '2026-05-31T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'unstructured failure',
        retryCount: 0,
      }),
    ).rejects.toThrow(
      /provider error: Unstructured job job-123 failed: document could not be processed/,
    );
  });

  it('fails polling timeouts before waiting forever on running jobs', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createUnstructuredProvider({
      runtime: unstructuredRuntime({
        getJob: vi.fn().mockResolvedValue({
          id: 'job-123',
          status: 'IN_PROGRESS',
        }),
      }),
      prepareDocument: vi
        .fn()
        .mockResolvedValue({ sourcePath, sourcePageCount: 86, pageMap: [30] }),
      sleep: vi.fn().mockResolvedValue(undefined),
      maxPollAttempts: 2,
      now: () => '2026-05-31T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'unstructured timeout',
        retryCount: 0,
      }),
    ).rejects.toThrow(/timeout: Unstructured job job-123 did not finish after 2 polling attempts/);
  });

  it('maps Unstructured throttling errors to rate-limit failures', async () => {
    const response = new Response('rate limited', {
      status: 429,
      statusText: 'Too Many Requests',
    });

    await expect(readUnstructuredJsonResponse(response)).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('rate limited'),
    });
  });

  it('rejects invalid provider output before writing a misleading artifact', async () => {
    const { outputDir, sourcePath } = await sourceFixture();
    const provider = createUnstructuredProvider({
      runtime: unstructuredRuntime({
        downloadJobOutput: vi.fn().mockResolvedValue({ not: 'an element array' }),
      }),
      prepareDocument: vi
        .fn()
        .mockResolvedValue({ sourcePath, sourcePageCount: 86, pageMap: [30] }),
      now: () => '2026-05-31T00:00:00.000Z',
    });

    await expect(
      provider.extract({
        sourcePath,
        pages: [30],
        outputDir,
        runLabel: 'unstructured invalid',
        retryCount: 0,
      }),
    ).rejects.toThrow(/invalid artifact: Unstructured output must be an array of elements/);
  });

  it('keeps the default config hash stable for default high-res runs', () => {
    expect(
      unstructuredProviderConfigHash({
        strategy: 'hi_res',
        tableToHtml: true,
        generativeOcr: undefined,
        costPerPageUsd: 0.03,
      }),
    ).toBe(UNSTRUCTURED_PROVIDER_CONFIG_HASH);
  });
});
