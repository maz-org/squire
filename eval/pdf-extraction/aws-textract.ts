import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import type { FeatureType } from '@aws-sdk/client-textract';

import type { PdfExtractionProvider, PdfExtractionRunInput } from './provider.ts';
import {
  computeProviderConfigHash,
  validateExtractionArtifact,
  type ExtractionArtifact,
  type ExtractionBlock,
  type ExtractionPage,
  type ExtractionTable,
  type ExtractionTableCell,
} from './schema.ts';

type AwsTextractBlockType =
  | 'PAGE'
  | 'LINE'
  | 'WORD'
  | 'TABLE'
  | 'CELL'
  | 'MERGED_CELL'
  | 'LAYOUT_TEXT'
  | 'LAYOUT_TITLE'
  | 'LAYOUT_HEADER'
  | 'LAYOUT_FOOTER'
  | 'LAYOUT_SECTION_HEADER'
  | 'LAYOUT_PAGE_NUMBER'
  | 'LAYOUT_LIST'
  | 'LAYOUT_FIGURE'
  | 'LAYOUT_TABLE'
  | 'LAYOUT_KEY_VALUE';

type AwsTextractRelationshipType = 'CHILD' | 'MERGED_CELL' | 'TABLE_TITLE' | 'TABLE_FOOTER';

interface AwsTextractRelationship {
  type?: AwsTextractRelationshipType;
  ids?: string[];
}

interface AwsTextractBoundingBox {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

interface AwsTextractGeometry {
  boundingBox?: AwsTextractBoundingBox;
}

export interface AwsTextractBlock {
  id?: string;
  blockType?: AwsTextractBlockType;
  text?: string;
  page?: number;
  confidence?: number;
  geometry?: AwsTextractGeometry;
  relationships?: AwsTextractRelationship[];
  rowIndex?: number;
  columnIndex?: number;
  rowSpan?: number;
  columnSpan?: number;
}

export interface AwsTextractWarning {
  errorCode?: string;
  pages?: number[];
}

export interface AwsTextractGetDocumentAnalysisResult {
  jobStatus?: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL_SUCCESS';
  blocks?: AwsTextractBlock[];
  documentMetadata?: { pages?: number };
  nextToken?: string;
  requestId?: string;
  statusMessage?: string;
  warnings?: AwsTextractWarning[];
  analyzeDocumentModelVersion?: string;
}

export interface AwsTextractDocumentLocation {
  bucket: string;
  key: string;
  version?: string;
}

export interface AwsTextractStartInput extends AwsTextractDocumentLocation {
  clientRequestToken: string;
  featureTypes: string[];
  jobTag: string;
}

export interface AwsTextractRuntime {
  uploadDocument(input: {
    sourcePath: string;
    runLabel: string;
  }): Promise<AwsTextractDocumentLocation>;
  startDocumentAnalysis(input: AwsTextractStartInput): Promise<{
    jobId: string;
    requestId?: string;
  }>;
  getDocumentAnalysis(input: {
    jobId: string;
    maxResults: number;
    nextToken?: string;
  }): Promise<AwsTextractGetDocumentAnalysisResult>;
  cleanupDocument?(input: AwsTextractDocumentLocation): Promise<void>;
}

export interface PreparedAwsTextractDocument {
  sourcePath: string;
  sourcePageCount?: number;
  pageMap?: number[];
}

export interface AwsTextractProviderDeps {
  runtime?: AwsTextractRuntime;
  prepareDocument?: (input: {
    sourcePath: string;
    pages: number[];
    outputPath: string;
  }) => Promise<PreparedAwsTextractDocument>;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  region?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  costPerPageUsd?: number;
}

export const AWS_TEXTRACT_PROVIDER_VERSION = 'aws-textract-start-document-analysis-v1';
export const AWS_TEXTRACT_FEATURE_TYPES = ['TABLES', 'LAYOUT'] as const;
export const AWS_TEXTRACT_DEFAULT_REGION = 'us-east-1';
export const AWS_TEXTRACT_DEFAULT_COST_PER_PAGE_USD = 0.015;
export const AWS_TEXTRACT_PROVIDER_CONFIG = {
  api: 'StartDocumentAnalysis/GetDocumentAnalysis',
  featureTypes: AWS_TEXTRACT_FEATURE_TYPES,
  mode: 'polling',
  selectedPageInput: 'temporary-page-subset-pdf-v1',
  pageSize: { width: 612, height: 792, unit: 'pt' },
  costPerPageUsd: AWS_TEXTRACT_DEFAULT_COST_PER_PAGE_USD,
};
export const AWS_TEXTRACT_PROVIDER_CONFIG_HASH = computeProviderConfigHash(
  AWS_TEXTRACT_PROVIDER_CONFIG,
);

function sha256(bytes: Buffer | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function fileSha256(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
}

function rawOutputPath(input: PdfExtractionRunInput, sourceHash: string): string {
  return `${input.outputDir}/raw/aws-textract/${sourceHash.slice(7)}/${AWS_TEXTRACT_PROVIDER_CONFIG_HASH.slice(7)}/${safePathSegment(input.runLabel)}.json`;
}

function preparedInputPath(input: PdfExtractionRunInput, sourceHash: string): string {
  return `${input.outputDir}/raw/aws-textract/${sourceHash.slice(7)}/${AWS_TEXTRACT_PROVIDER_CONFIG_HASH.slice(7)}/${safePathSegment(input.runLabel)}-input.pdf`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function confidence(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return round(value > 1 ? value / 100 : value);
}

function bbox(block: AwsTextractBlock): ExtractionBlock['bbox'] {
  const box = block.geometry?.boundingBox;
  if (!box) return undefined;
  return {
    x: round((box.left ?? 0) * 612),
    y: round((box.top ?? 0) * 792),
    width: round((box.width ?? 0) * 612),
    height: round((box.height ?? 0) * 792),
  };
}

function sortKey(block: AwsTextractBlock): [number, number, string] {
  const box = block.geometry?.boundingBox;
  return [box?.top ?? 1, box?.left ?? 1, block.id ?? ''];
}

function compareBlocks(left: AwsTextractBlock, right: AwsTextractBlock): number {
  const leftKey = sortKey(left);
  const rightKey = sortKey(right);
  return (
    leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1] || leftKey[2].localeCompare(rightKey[2])
  );
}

function childIds(block: AwsTextractBlock): string[] {
  return (
    block.relationships?.flatMap((relationship) =>
      relationship.type === 'CHILD' ? (relationship.ids ?? []) : [],
    ) ?? []
  );
}

function textForBlock(block: AwsTextractBlock, blocksById: Map<string, AwsTextractBlock>): string {
  if (block.text) return block.text;
  return childIds(block)
    .map((id) => blocksById.get(id)?.text)
    .filter((text): text is string => Boolean(text))
    .join(' ');
}

function blockType(block: AwsTextractBlock): ExtractionBlock['type'] | undefined {
  switch (block.blockType) {
    case 'LAYOUT_TITLE':
    case 'LAYOUT_SECTION_HEADER':
      return 'heading';
    case 'LAYOUT_TEXT':
      return 'paragraph';
    case 'LAYOUT_HEADER':
      return 'header';
    case 'LAYOUT_FOOTER':
      return 'footer';
    case 'LAYOUT_PAGE_NUMBER':
      return 'page-number';
    case 'LAYOUT_FIGURE':
      return 'image';
    case 'LAYOUT_TABLE':
    case 'TABLE':
      return 'table';
    case 'LINE':
      return 'line';
    default:
      return undefined;
  }
}

function tableCell(
  cell: AwsTextractBlock,
  blocksById: Map<string, AwsTextractBlock>,
): ExtractionTableCell {
  return {
    row: Math.max(0, (cell.rowIndex ?? 1) - 1),
    column: Math.max(0, (cell.columnIndex ?? 1) - 1),
    rowSpan: Math.max(1, cell.rowSpan ?? 1),
    columnSpan: Math.max(1, cell.columnSpan ?? 1),
    text: textForBlock(cell, blocksById),
    ...(bbox(cell) ? { bbox: bbox(cell) } : {}),
  };
}

function tableForBlock(
  table: AwsTextractBlock,
  order: number,
  blocksById: Map<string, AwsTextractBlock>,
): ExtractionTable {
  const cells = childIds(table)
    .map((id) => blocksById.get(id))
    .filter((block): block is AwsTextractBlock => block?.blockType === 'CELL')
    .sort(
      (left, right) =>
        (left.rowIndex ?? 0) - (right.rowIndex ?? 0) ||
        (left.columnIndex ?? 0) - (right.columnIndex ?? 0),
    )
    .map((cell) => tableCell(cell, blocksById));
  return {
    id: table.id ?? `table-${order}`,
    order,
    ...(bbox(table) ? { bbox: bbox(table) } : {}),
    cells,
  };
}

function markdownForBlocks(blocks: ExtractionBlock[], tables: ExtractionTable[]): string {
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      lines.push(`## ${block.text}`);
    } else if (block.type === 'table') {
      const table = tableById.get(block.id);
      if (table && table.cells.length > 0) {
        lines.push(table.cells.map((cell) => cell.text).join(' | '));
      }
    } else if (block.text.length > 0) {
      lines.push(block.text);
    }
  }
  return lines.join('\n\n');
}

function toExtractionPage(
  pageNumber: number,
  pageBlocks: AwsTextractBlock[],
  blocksById: Map<string, AwsTextractBlock>,
): ExtractionPage {
  const contentBlocks = pageBlocks
    .filter((block) => blockType(block) !== undefined)
    .sort(compareBlocks);
  const blocks: ExtractionBlock[] = [];
  const tables: ExtractionTable[] = [];

  contentBlocks.forEach((block, order) => {
    const type = blockType(block)!;
    const text = textForBlock(block, blocksById);
    const normalizedBlock: ExtractionBlock = {
      id: block.id ?? `p${pageNumber}-b${order}`,
      type,
      order,
      text,
      ...(bbox(block) ? { bbox: bbox(block) } : {}),
      ...(confidence(block.confidence) !== undefined
        ? { confidence: confidence(block.confidence) }
        : {}),
    };
    blocks.push(normalizedBlock);
    if (block.blockType === 'TABLE') {
      tables.push(tableForBlock(block, order, blocksById));
    }
  });

  const text = blocks
    .filter((block) => block.type !== 'table')
    .map((block) => block.text)
    .filter(Boolean)
    .join('\n\n');
  return {
    pageNumber,
    width: 612,
    height: 792,
    unit: 'pt',
    markdown: markdownForBlocks(blocks, tables),
    text,
    blocks,
    tables,
  };
}

function pageNumbersFromBlocks(blocks: AwsTextractBlock[], pageCount?: number): number[] {
  const pageNumbers = new Set(
    blocks
      .map((block) => block.page)
      .filter(
        (page): page is number => typeof page === 'number' && Number.isInteger(page) && page > 0,
      ),
  );
  if (pageNumbers.size === 0 && pageCount !== undefined) {
    for (let page = 1; page <= pageCount; page += 1) pageNumbers.add(page);
  }
  return [...pageNumbers].sort((left, right) => left - right);
}

function selectedPageNumbers(
  blocks: AwsTextractBlock[],
  requestedPages: number[],
  pageCount?: number,
): number[] {
  return requestedPages.length > 0 ? requestedPages : pageNumbersFromBlocks(blocks, pageCount);
}

function normalizePages(
  blocks: AwsTextractBlock[],
  requestedPages: number[],
  pageCount?: number,
): ExtractionPage[] {
  const blocksById = new Map(
    blocks
      .map((block) => [block.id, block] as const)
      .filter((entry): entry is readonly [string, AwsTextractBlock] => Boolean(entry[0])),
  );
  return selectedPageNumbers(blocks, requestedPages, pageCount).map((pageNumber) => {
    const pageBlocks = blocks.filter((block) => block.page === pageNumber);
    if (pageBlocks.length === 0) {
      throw new Error(`partial page failure: Textract output omitted page ${pageNumber}.`);
    }
    return toExtractionPage(pageNumber, pageBlocks, blocksById);
  });
}

function remapBlocks(
  blocks: AwsTextractBlock[],
  pageMap: number[] | undefined,
): AwsTextractBlock[] {
  if (!pageMap || pageMap.length === 0) return blocks;
  return blocks.map((block) => {
    if (block.page === undefined) return block;
    return { ...block, page: pageMap[block.page - 1] };
  });
}

function remapWarnings(
  warnings: AwsTextractWarning[],
  pageMap: number[] | undefined,
): AwsTextractWarning[] {
  if (!pageMap || pageMap.length === 0) return warnings;
  return warnings.map((warning) => ({
    ...warning,
    pages: warning.pages?.map((page) => pageMap[page - 1] ?? page),
  }));
}

function textractError(error: unknown): Error {
  if (typeof error === 'object' && error && 'name' in error) {
    const name = String((error as { name?: unknown }).name);
    const message = error instanceof Error ? error.message : name;
    if (/LimitExceeded|ProvisionedThroughputExceeded|Throttling/.test(name)) {
      return Object.assign(new Error(`rate limit: ${message}`), { status: 429, cause: error });
    }
    if (/AccessDenied|InvalidKMSKey/.test(name)) {
      return Object.assign(new Error(`credential failure: ${message}`), {
        status: 403,
        cause: error,
      });
    }
    if (/UnsupportedDocument/.test(name)) {
      return new Error(`unsupported configuration: ${message}`, { cause: error });
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

function assertWarningsDoNotAffectRequestedPages(
  warnings: AwsTextractWarning[],
  requestedPages: number[],
): void {
  if (warnings.length === 0) return;
  if (requestedPages.length === 0) {
    const warning = warnings[0]!;
    throw new Error(`partial page failure: Textract warning ${warning.errorCode ?? 'unknown'}.`);
  }
  for (const warning of warnings) {
    for (const page of warning.pages ?? []) {
      if (requestedPages.includes(page)) {
        throw new Error(
          `partial page failure: Textract warning ${warning.errorCode ?? 'unknown'} for requested page ${page}.`,
        );
      }
    }
  }
}

async function collectAnalysis(
  runtime: AwsTextractRuntime,
  jobId: string,
  maxPollAttempts: number,
  pollIntervalMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{
  responses: AwsTextractGetDocumentAnalysisResult[];
  blocks: AwsTextractBlock[];
  requestIds: string[];
  pageCount?: number;
  warnings: AwsTextractWarning[];
  modelVersion?: string;
}> {
  const responses: AwsTextractGetDocumentAnalysisResult[] = [];
  const requestIds: string[] = [];
  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
    const response = await runtime.getDocumentAnalysis({
      jobId,
      maxResults: 1000,
      nextToken: undefined,
    });
    responses.push(response);
    if (response.requestId) requestIds.push(response.requestId);
    if (response.jobStatus === 'IN_PROGRESS') {
      if (attempt === maxPollAttempts) {
        throw new Error(
          `timeout: Textract job ${jobId} did not finish after ${maxPollAttempts} polling attempts.`,
        );
      }
      await sleep(pollIntervalMs);
      continue;
    }
    if (response.jobStatus === 'FAILED') {
      throw new Error(
        `provider error: Textract job ${jobId} failed: ${response.statusMessage ?? 'unknown failure'}.`,
      );
    }

    let nextToken = response.nextToken;
    while (nextToken) {
      const page = await runtime.getDocumentAnalysis({
        jobId,
        maxResults: 1000,
        nextToken,
      });
      responses.push(page);
      if (page.requestId) requestIds.push(page.requestId);
      nextToken = page.nextToken;
    }

    return {
      responses,
      blocks: responses.flatMap((entry) => entry.blocks ?? []),
      requestIds,
      pageCount: response.documentMetadata?.pages,
      warnings: responses.flatMap((entry) => entry.warnings ?? []),
      modelVersion: response.analyzeDocumentModelVersion,
    };
  }
  throw new Error(`timeout: Textract job ${jobId} did not finish.`);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function prepareTextractInputDocument(input: {
  sourcePath: string;
  pages: number[];
  outputPath: string;
}): Promise<PreparedAwsTextractDocument> {
  const { PDFDocument } = await import('pdf-lib');
  const sourcePdf = await PDFDocument.load(await readFile(input.sourcePath));
  const sourcePageCount = sourcePdf.getPageCount();

  if (input.pages.length === 0) {
    return { sourcePath: input.sourcePath, sourcePageCount };
  }

  for (const page of input.pages) {
    if (page > sourcePageCount) {
      throw new Error(
        `partial page failure: requested page ${page} exceeds source page count ${sourcePageCount}.`,
      );
    }
  }

  const outputPdf = await PDFDocument.create();
  const copiedPages = await outputPdf.copyPages(
    sourcePdf,
    input.pages.map((page) => page - 1),
  );
  for (const page of copiedPages) outputPdf.addPage(page);

  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, await outputPdf.save());
  return {
    sourcePath: input.outputPath,
    sourcePageCount,
    pageMap: input.pages,
  };
}

function regionFromEnv(): string {
  return process.env.AWS_TEXTRACT_REGION ?? process.env.AWS_REGION ?? AWS_TEXTRACT_DEFAULT_REGION;
}

function costPerPageFromEnv(): number {
  const raw = process.env.AWS_TEXTRACT_COST_PER_PAGE_USD;
  if (!raw) return AWS_TEXTRACT_DEFAULT_COST_PER_PAGE_USD;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Invalid AWS_TEXTRACT_COST_PER_PAGE_USD: expected a non-negative number.');
  }
  return value;
}

function s3BucketFromEnv(): string {
  const bucket = process.env.AWS_TEXTRACT_S3_BUCKET;
  if (!bucket) {
    throw new Error('Missing AWS_TEXTRACT_S3_BUCKET for live AWS Textract extraction.');
  }
  return bucket;
}

export function createClientRequestToken(
  sourceHash: string,
  pages: number[],
  runLabel: string,
  providerConfigHash = AWS_TEXTRACT_PROVIDER_CONFIG_HASH,
): string {
  const digest = createHash('sha256')
    .update(`${sourceHash}:${providerConfigHash}:${pages.join(',')}:${runLabel}`)
    .digest('hex')
    .slice(0, 16);
  return `textract-${digest}`;
}

function jobTag(runLabel: string): string {
  return safePathSegment(runLabel).slice(0, 64);
}

export function estimatedAwsTextractCostUsd(pages: number[]): number | undefined {
  if (pages.length === 0) return undefined;
  return round(pages.length * costPerPageFromEnv());
}

async function createAwsSdkTextractRuntime(region: string): Promise<AwsTextractRuntime> {
  const textract = await import('@aws-sdk/client-textract');
  const s3 = await import('@aws-sdk/client-s3');
  const textractClient = new textract.TextractClient({ region });
  const s3Client = new s3.S3Client({ region });

  return {
    async uploadDocument(input) {
      const bucket = s3BucketFromEnv();
      const prefix = process.env.AWS_TEXTRACT_S3_PREFIX ?? 'pdf-extraction/aws-textract';
      const key = `${prefix.replace(/\/+$/g, '')}/${safePathSegment(input.runLabel)}-${basename(input.sourcePath)}`;
      await s3Client.send(
        new s3.PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: await readFile(input.sourcePath),
          ContentType: 'application/pdf',
        }),
      );
      return { bucket, key };
    },
    async startDocumentAnalysis(input) {
      const response = await textractClient.send(
        new textract.StartDocumentAnalysisCommand({
          DocumentLocation: {
            S3Object: {
              Bucket: input.bucket,
              Name: input.key,
              Version: input.version,
            },
          },
          FeatureTypes: input.featureTypes as FeatureType[],
          ClientRequestToken: input.clientRequestToken,
          JobTag: input.jobTag,
        }),
      );
      if (!response.JobId) throw new Error('provider error: Textract did not return a JobId.');
      return {
        jobId: response.JobId,
        requestId: response.$metadata.requestId,
      };
    },
    async getDocumentAnalysis(input) {
      const response = await textractClient.send(
        new textract.GetDocumentAnalysisCommand({
          JobId: input.jobId,
          MaxResults: input.maxResults,
          NextToken: input.nextToken,
        }),
      );
      return {
        jobStatus: response.JobStatus,
        blocks: (response.Blocks ?? []).map((block) => ({
          id: block.Id,
          blockType: block.BlockType,
          text: block.Text,
          page: block.Page,
          confidence: block.Confidence,
          geometry: block.Geometry
            ? {
                boundingBox: {
                  left: block.Geometry.BoundingBox?.Left,
                  top: block.Geometry.BoundingBox?.Top,
                  width: block.Geometry.BoundingBox?.Width,
                  height: block.Geometry.BoundingBox?.Height,
                },
              }
            : undefined,
          relationships: block.Relationships?.map((relationship) => ({
            type: relationship.Type,
            ids: relationship.Ids,
          })),
          rowIndex: block.RowIndex,
          columnIndex: block.ColumnIndex,
          rowSpan: block.RowSpan,
          columnSpan: block.ColumnSpan,
        })) as AwsTextractBlock[],
        documentMetadata: { pages: response.DocumentMetadata?.Pages },
        nextToken: response.NextToken,
        requestId: response.$metadata.requestId,
        statusMessage: response.StatusMessage,
        warnings: response.Warnings?.map((warning) => ({
          errorCode: warning.ErrorCode,
          pages: warning.Pages,
        })),
        analyzeDocumentModelVersion: response.AnalyzeDocumentModelVersion,
      };
    },
    async cleanupDocument(input) {
      if (process.env.AWS_TEXTRACT_KEEP_S3_INPUT === '1') return;
      await s3Client.send(
        new s3.DeleteObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          VersionId: input.version,
        }),
      );
    },
  };
}

export function createAwsTextractProvider(
  deps: AwsTextractProviderDeps = {},
): PdfExtractionProvider {
  const now = deps.now ?? (() => new Date().toISOString());
  const prepareDocument = deps.prepareDocument ?? prepareTextractInputDocument;
  const sleep = deps.sleep ?? defaultSleep;
  const region = deps.region ?? regionFromEnv();
  const pollIntervalMs = deps.pollIntervalMs ?? 2_000;
  const maxPollAttempts = deps.maxPollAttempts ?? 150;
  const costPerPageUsd = deps.costPerPageUsd ?? costPerPageFromEnv();

  return {
    id: 'aws-textract',
    displayName: 'AWS Textract',
    version: AWS_TEXTRACT_PROVIDER_VERSION,
    async extract(input) {
      const startedAt = now();
      const startMs = Date.now();
      const sourceHash = await fileSha256(input.sourcePath);
      const outputPath = rawOutputPath(input, sourceHash);
      const inputPath = preparedInputPath(input, sourceHash);
      await mkdir(dirname(outputPath), { recursive: true });
      const runtime = deps.runtime ?? (await createAwsSdkTextractRuntime(region));
      let documentLocation: AwsTextractDocumentLocation | undefined;

      try {
        const preparedDocument = await prepareDocument({
          sourcePath: input.sourcePath,
          pages: input.pages,
          outputPath: inputPath,
        });
        documentLocation = await runtime.uploadDocument({
          sourcePath: preparedDocument.sourcePath,
          runLabel: input.runLabel,
        });
        const start = await runtime.startDocumentAnalysis({
          ...documentLocation,
          clientRequestToken: createClientRequestToken(sourceHash, input.pages, input.runLabel),
          featureTypes: [...AWS_TEXTRACT_FEATURE_TYPES],
          jobTag: jobTag(input.runLabel),
        });
        const analysis = await collectAnalysis(
          runtime,
          start.jobId,
          maxPollAttempts,
          pollIntervalMs,
          sleep,
        );
        const blocks = remapBlocks(analysis.blocks, preparedDocument.pageMap);
        const warnings = remapWarnings(analysis.warnings, preparedDocument.pageMap);
        assertWarningsDoNotAffectRequestedPages(warnings, input.pages);
        const selectedPages = normalizePages(blocks, input.pages, preparedDocument.sourcePageCount);
        const completedAt = now();
        const rawPayload = {
          jobId: start.jobId,
          source: documentLocation,
          uploadedSourcePath: preparedDocument.sourcePath,
          pageMap: preparedDocument.pageMap,
          modelVersion: analysis.modelVersion,
          warnings,
          responses: analysis.responses,
        };
        const rawJson = `${JSON.stringify(rawPayload, null, 2)}\n`;
        await writeFile(outputPath, rawJson, 'utf8');
        const pagesProcessed = selectedPages.length;
        const estimatedUsd = round(pagesProcessed * costPerPageUsd);
        const artifact = {
          schemaVersion: 'squire-pdf-extraction-v1',
          provider: 'aws-textract',
          providerVersion: AWS_TEXTRACT_PROVIDER_VERSION,
          providerConfigHash: AWS_TEXTRACT_PROVIDER_CONFIG_HASH,
          source: {
            path: input.sourcePath,
            sha256: sourceHash,
            pageCount: preparedDocument.sourcePageCount ?? analysis.pageCount,
          },
          run: {
            id: input.runLabel,
            startedAt,
            completedAt,
            status: 'succeeded',
            pageRange: input.pages.length === 0 ? undefined : input.pages,
            latencyMs: Math.max(0, Date.now() - startMs),
          },
          cost: {
            estimatedUsd,
            actualUsd: estimatedUsd,
            pagesProcessed,
            costPerPageUsd,
          },
          privacy: {
            retentionPolicy:
              'AWS Textract async results are retained by provider policy for JobId access; uploaded S3 input is deleted after extraction unless AWS_TEXTRACT_KEEP_S3_INPUT=1.',
            trainingUse: 'not-used-for-training',
            region,
          },
          providerMetadata: {
            mode: 'polling',
            jobId: start.jobId,
            requestIds: [start.requestId, ...analysis.requestIds].filter(Boolean),
            s3: documentLocation,
            uploadedSourcePath: preparedDocument.sourcePath,
            pageMap: preparedDocument.pageMap,
            featureTypes: [...AWS_TEXTRACT_FEATURE_TYPES],
            warnings,
            modelVersion: analysis.modelVersion,
          },
          rawArtifacts: [
            {
              kind: 'provider-json',
              path: outputPath,
              sha256: sha256(rawJson),
              redacted: false,
              persisted: true,
            },
          ],
          pages: selectedPages,
        } satisfies ExtractionArtifact;

        return validateExtractionArtifact(artifact);
      } catch (error) {
        throw textractError(error);
      } finally {
        if (documentLocation) {
          await runtime.cleanupDocument?.(documentLocation).catch(() => undefined);
        }
      }
    },
  };
}
