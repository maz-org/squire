import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import * as parse5 from 'parse5';

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

type UnstructuredJobStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'STOPPED' | 'FAILED';
type UnstructuredProcessingStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'SUCCESS'
  | 'COMPLETED_WITH_ERRORS'
  | 'STOPPED'
  | 'FAILED';
type UnstructuredPartitionStrategy = 'hi_res' | 'vlm';

interface UnstructuredCoordinates {
  points?: unknown;
  layout_width?: number;
  layout_height?: number;
}

interface UnstructuredElementMetadata {
  page_number?: number;
  coordinates?: UnstructuredCoordinates;
  detection_class_prob?: number;
  text_as_html?: string;
  [key: string]: unknown;
}

interface UnstructuredElement {
  element_id?: string;
  type?: string;
  text?: string;
  metadata?: UnstructuredElementMetadata;
}

interface UnstructuredWorkflowNode {
  name: string;
  type: string;
  subtype: string;
  settings: Record<string, unknown>;
}

interface UnstructuredRequestData {
  job_nodes: UnstructuredWorkflowNode[];
}

interface UnstructuredOutputNodeFile {
  node_id?: string;
  file_id?: string;
  node_type?: string;
  node_subtype?: string;
}

export interface UnstructuredJob {
  id?: string;
  workflow_id?: string;
  workflow_name?: string;
  status?: UnstructuredJobStatus;
  created_at?: string;
  runtime?: string | null;
  input_file_ids?: string[] | null;
  output_node_files?: UnstructuredOutputNodeFile[] | null;
  job_type?: string;
}

export interface UnstructuredJobDetails {
  id?: string;
  processing_status?: UnstructuredProcessingStatus;
  node_stats?: unknown[];
  message?: string | null;
}

export interface UnstructuredRuntime {
  createJob(input: {
    sourcePath: string;
    requestData: UnstructuredRequestData;
  }): Promise<UnstructuredJob>;
  getJob(input: { jobId: string }): Promise<UnstructuredJob>;
  getJobDetails(input: { jobId: string }): Promise<UnstructuredJobDetails>;
  downloadJobOutput(input: { jobId: string; fileId: string; nodeId?: string }): Promise<unknown>;
}

export interface PreparedUnstructuredDocument {
  sourcePath: string;
  sourcePageCount?: number;
  pageMap?: number[];
}

export interface UnstructuredGenerativeOcrConfig {
  subtype: 'anthropic_ocr' | 'bedrock_ocr' | 'openai_ocr';
  providerType: 'anthropic' | 'bedrock' | 'openai';
  model: string;
}

export interface UnstructuredProviderDeps {
  runtime?: UnstructuredRuntime;
  prepareDocument?: (input: {
    sourcePath: string;
    pages: number[];
    outputPath: string;
  }) => Promise<PreparedUnstructuredDocument>;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  region?: string;
  strategy?: UnstructuredPartitionStrategy;
  tableToHtml?: boolean;
  generativeOcr?: UnstructuredGenerativeOcrConfig;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  costPerPageUsd?: number;
}

type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
};

const UNSTRUCTURED_DEFAULT_REGION = 'us';
const UNSTRUCTURED_DEFAULT_COST_PER_PAGE_USD = 0.03;
const UNSTRUCTURED_DEFAULT_STRATEGY: UnstructuredPartitionStrategy = 'hi_res';

export const UNSTRUCTURED_PROVIDER_VERSION = 'unstructured-workflow-on-demand-v1';

function providerConfigFor(input: {
  strategy: UnstructuredPartitionStrategy;
  tableToHtml: boolean;
  generativeOcr?: UnstructuredGenerativeOcrConfig;
  costPerPageUsd: number;
}) {
  return {
    api: 'workflow-on-demand-jobs',
    endpointSet: [
      'POST /jobs/',
      'GET /jobs/{id}',
      'GET /jobs/{id}/details',
      'GET /jobs/{id}/download',
    ],
    selectedPages: 'temporary-page-subset-pdf-v1',
    pageSizeFallback: { width: 612, height: 792, unit: 'pt' },
    partitioner: {
      type: 'partition',
      subtype: input.strategy === 'vlm' ? 'vlm' : 'unstructured_api',
      strategy: input.strategy,
      coordinates: true,
      inferTableStructure: true,
      pdfInferTableStructure: true,
      extractImageBlockTypes: ['Image', 'Table'],
      ocrLanguages: ['eng'],
    },
    tableToHtml: input.tableToHtml,
    generativeOcr: input.generativeOcr,
    costPerPageUsd: input.costPerPageUsd,
  };
}

export const UNSTRUCTURED_PROVIDER_CONFIG = providerConfigFor({
  strategy: UNSTRUCTURED_DEFAULT_STRATEGY,
  tableToHtml: true,
  generativeOcr: undefined,
  costPerPageUsd: UNSTRUCTURED_DEFAULT_COST_PER_PAGE_USD,
});
export const UNSTRUCTURED_PROVIDER_CONFIG_HASH = computeProviderConfigHash(
  UNSTRUCTURED_PROVIDER_CONFIG,
);

export function unstructuredProviderConfigHash(input: {
  strategy: UnstructuredPartitionStrategy;
  tableToHtml: boolean;
  generativeOcr?: UnstructuredGenerativeOcrConfig;
  costPerPageUsd: number;
}): string {
  return computeProviderConfigHash(providerConfigFor(input));
}

export function unstructuredProviderConfigHashFromEnv(): string {
  return unstructuredProviderConfigHash({
    strategy: strategyFromEnv(),
    tableToHtml: tableToHtmlFromEnv(),
    generativeOcr: generativeOcrFromEnv(),
    costPerPageUsd: costPerPageFromEnv(),
  });
}

function sha256(bytes: Buffer | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function fileSha256(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
}

function rawOutputPath(
  input: PdfExtractionRunInput,
  sourceHash: string,
  providerConfigHash: string,
): string {
  return `${input.outputDir}/raw/unstructured/${sourceHash.slice(7)}/${providerConfigHash.slice(7)}/${safePathSegment(input.runLabel)}.json`;
}

function preparedInputPath(
  input: PdfExtractionRunInput,
  sourceHash: string,
  providerConfigHash: string,
): string {
  return `${input.outputDir}/raw/unstructured/${sourceHash.slice(7)}/${providerConfigHash.slice(7)}/${safePathSegment(input.runLabel)}-input.pdf`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function confidence(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return round(value > 1 ? value / 100 : value);
}

function coordinatesBBox(
  coordinates: UnstructuredCoordinates | undefined,
): ExtractionBlock['bbox'] {
  const points = coordinates?.points;
  if (!Array.isArray(points)) return undefined;
  const pairs = points
    .filter((point): point is [number, number] => {
      return (
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === 'number' &&
        typeof point[1] === 'number'
      );
    })
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length === 0) return undefined;
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: round(minX),
    y: round(minY),
    width: round(Math.max(...xs) - minX),
    height: round(Math.max(...ys) - minY),
  };
}

function blockType(element: UnstructuredElement): ExtractionBlock['type'] {
  switch (element.type) {
    case 'Title':
      return 'heading';
    case 'Table':
      return 'table';
    case 'Image':
    case 'Picture':
    case 'Figure':
      return 'image';
    case 'Header':
      return 'header';
    case 'Footer':
      return 'footer';
    case 'PageBreak':
      return 'page-number';
    case 'NarrativeText':
    case 'ListItem':
    case 'Text':
    case 'Paragraph':
      return 'paragraph';
    case undefined:
      return 'other';
    default:
      return 'other';
  }
}

function pageNumber(element: UnstructuredElement): number | undefined {
  const value = element.metadata?.page_number;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function remapPageNumber(page: number, pageMap: number[] | undefined): number {
  return pageMap?.[page - 1] ?? page;
}

function nodeText(node: HtmlNode): string {
  if (node.nodeName === '#text') return node.value ?? '';
  return (node.childNodes ?? []).map(nodeText).join('');
}

function findElements(node: HtmlNode, tagName: string): HtmlNode[] {
  const matches = node.tagName?.toLowerCase() === tagName ? [node] : [];
  return [...matches, ...(node.childNodes ?? []).flatMap((child) => findElements(child, tagName))];
}

function cellsFromHtmlTable(html: string): ExtractionTableCell[] {
  const fragment = parse5.parseFragment(html) as unknown as HtmlNode;
  const rows = findElements(fragment, 'tr');
  const cells: ExtractionTableCell[] = [];
  rows.forEach((row, rowIndex) => {
    const rowCells = (row.childNodes ?? []).filter((node) =>
      ['td', 'th'].includes(node.tagName?.toLowerCase() ?? ''),
    );
    rowCells.forEach((cell, columnIndex) => {
      const text = nodeText(cell).replace(/\s+/g, ' ').trim();
      cells.push({
        row: rowIndex,
        column: columnIndex,
        rowSpan: 1,
        columnSpan: 1,
        text,
      });
    });
  });
  return cells;
}

function fallbackTableCells(text: string): ExtractionTableCell[] {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split(/\s{2,}|\s+\|\s+/).map((cell) => cell.trim()));
  if (rows.length === 0) return [];
  return rows.flatMap((row, rowIndex) =>
    row.map((text, columnIndex) => ({
      row: rowIndex,
      column: columnIndex,
      rowSpan: 1,
      columnSpan: 1,
      text,
    })),
  );
}

function tableForElement(
  element: UnstructuredElement,
  pageNumberValue: number,
  order: number,
): ExtractionTable {
  const html = element.metadata?.text_as_html;
  const cells = html ? cellsFromHtmlTable(html) : fallbackTableCells(element.text ?? '');
  const bbox = coordinatesBBox(element.metadata?.coordinates);
  return {
    id: element.element_id ?? `p${pageNumberValue}-table-${order}`,
    order,
    ...(bbox ? { bbox } : {}),
    cells,
  };
}

function blockForElement(
  element: UnstructuredElement,
  pageNumberValue: number,
  order: number,
): ExtractionBlock {
  const bbox = coordinatesBBox(element.metadata?.coordinates);
  const conf = confidence(element.metadata?.detection_class_prob);
  return {
    id: element.element_id ?? `p${pageNumberValue}-b${order}`,
    type: blockType(element),
    order,
    text: element.text ?? '',
    ...(bbox ? { bbox } : {}),
    ...(conf !== undefined ? { confidence: conf } : {}),
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
      } else if (block.text) {
        lines.push(block.text);
      }
    } else if (block.text) {
      lines.push(block.text);
    }
  }
  return lines.join('\n\n');
}

function pageSize(elements: UnstructuredElement[]): { width: number; height: number } {
  for (const element of elements) {
    const width = element.metadata?.coordinates?.layout_width;
    const height = element.metadata?.coordinates?.layout_height;
    if (
      typeof width === 'number' &&
      Number.isFinite(width) &&
      width > 0 &&
      typeof height === 'number' &&
      Number.isFinite(height) &&
      height > 0
    ) {
      return { width, height };
    }
  }
  return { width: 612, height: 792 };
}

function toExtractionPage(page: number, elements: UnstructuredElement[]): ExtractionPage {
  const { width, height } = pageSize(elements);
  const blocks = elements.map((element, order) => blockForElement(element, page, order));
  const tables = elements
    .map((element, order) => ({ element, order }))
    .filter(({ element }) => element.type === 'Table')
    .map(({ element, order }) => tableForElement(element, page, order));
  return {
    pageNumber: page,
    width,
    height,
    unit: 'pt',
    markdown: markdownForBlocks(blocks, tables),
    text: blocks
      .map((block) => block.text)
      .filter(Boolean)
      .join('\n\n'),
    blocks,
    tables,
  };
}

function normalizeElements(
  value: unknown,
  requestedPages: number[],
  pageMap: number[] | undefined,
): ExtractionPage[] {
  if (!Array.isArray(value)) {
    throw new Error('invalid artifact: Unstructured output must be an array of elements.');
  }
  const elements = value as UnstructuredElement[];
  const byPage = new Map<number, UnstructuredElement[]>();
  for (const element of elements) {
    const sourcePage = pageNumber(element);
    if (sourcePage === undefined) continue;
    const mappedPage = remapPageNumber(sourcePage, pageMap);
    byPage.set(mappedPage, [...(byPage.get(mappedPage) ?? []), element]);
  }
  const selectedPages =
    requestedPages.length > 0
      ? requestedPages
      : [...byPage.keys()].sort((left, right) => left - right);
  if (selectedPages.length === 0) {
    throw new Error('invalid artifact: Unstructured output contained no pages.');
  }
  return selectedPages.map((page) => {
    const pageElements = byPage.get(page) ?? [];
    if (pageElements.length === 0) {
      throw new Error(`partial page failure: Unstructured output omitted page ${page}.`);
    }
    return toExtractionPage(page, pageElements);
  });
}

async function prepareUnstructuredInputDocument(input: {
  sourcePath: string;
  pages: number[];
  outputPath: string;
}): Promise<PreparedUnstructuredDocument> {
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

function apiKeyFromEnv(): string {
  const key = process.env.UNSTRUCTURED_API_KEY;
  if (!key) throw new Error('Missing UNSTRUCTURED_API_KEY for live Unstructured extraction.');
  return key;
}

function baseUrlFromEnv(): string {
  return (process.env.UNSTRUCTURED_API_URL ?? 'https://platform.unstructuredapp.io/api/v1').replace(
    /\/+$/g,
    '',
  );
}

function regionFromEnv(): string {
  return process.env.UNSTRUCTURED_REGION ?? UNSTRUCTURED_DEFAULT_REGION;
}

function strategyFromEnv(): UnstructuredPartitionStrategy {
  const strategy = process.env.UNSTRUCTURED_PARTITION_STRATEGY ?? UNSTRUCTURED_DEFAULT_STRATEGY;
  if (strategy !== 'hi_res' && strategy !== 'vlm') {
    throw new Error('Invalid UNSTRUCTURED_PARTITION_STRATEGY: expected hi_res or vlm.');
  }
  return strategy;
}

function tableToHtmlFromEnv(): boolean {
  return process.env.UNSTRUCTURED_TABLE_TO_HTML !== '0';
}

function costPerPageFromEnv(): number {
  const raw = process.env.UNSTRUCTURED_COST_PER_PAGE_USD;
  if (!raw) return UNSTRUCTURED_DEFAULT_COST_PER_PAGE_USD;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Invalid UNSTRUCTURED_COST_PER_PAGE_USD: expected a non-negative number.');
  }
  return value;
}

function generativeOcrFromEnv(): UnstructuredGenerativeOcrConfig | undefined {
  const subtype = process.env.UNSTRUCTURED_GENERATIVE_OCR_SUBTYPE;
  if (!subtype) return undefined;
  if (!['anthropic_ocr', 'bedrock_ocr', 'openai_ocr'].includes(subtype)) {
    throw new Error(
      'Invalid UNSTRUCTURED_GENERATIVE_OCR_SUBTYPE: expected anthropic_ocr, bedrock_ocr, or openai_ocr.',
    );
  }
  const providerType = process.env.UNSTRUCTURED_GENERATIVE_OCR_PROVIDER_TYPE;
  if (!providerType || !['anthropic', 'bedrock', 'openai'].includes(providerType)) {
    throw new Error(
      'Invalid UNSTRUCTURED_GENERATIVE_OCR_PROVIDER_TYPE: expected anthropic, bedrock, or openai.',
    );
  }
  const model = process.env.UNSTRUCTURED_GENERATIVE_OCR_MODEL;
  if (!model) {
    throw new Error('Missing UNSTRUCTURED_GENERATIVE_OCR_MODEL for generative OCR.');
  }
  return {
    subtype: subtype as UnstructuredGenerativeOcrConfig['subtype'],
    providerType: providerType as UnstructuredGenerativeOcrConfig['providerType'],
    model,
  };
}

export function estimatedUnstructuredCostUsd(pages: number[]): number | undefined {
  if (pages.length === 0) return undefined;
  return round(pages.length * costPerPageFromEnv());
}

export async function readUnstructuredJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { detail: text };
    }
  }
  if (!response.ok) {
    const detail =
      typeof parsed === 'object' && parsed && 'detail' in parsed
        ? JSON.stringify((parsed as { detail?: unknown }).detail)
        : text || response.statusText;
    throw Object.assign(new Error(`Unstructured HTTP ${response.status}: ${detail}`), {
      status: response.status,
    });
  }
  return parsed;
}

async function createUnstructuredRestRuntime(): Promise<UnstructuredRuntime> {
  const apiKey = apiKeyFromEnv();
  const baseUrl = baseUrlFromEnv();
  return {
    async createJob(input) {
      const form = new FormData();
      form.append('request_data', JSON.stringify(input.requestData));
      form.append(
        'input_files',
        new Blob([await readFile(input.sourcePath)], { type: 'application/pdf' }),
        basename(input.sourcePath),
      );
      const response = await fetch(`${baseUrl}/jobs/`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'unstructured-api-key': apiKey,
        },
        body: form,
      });
      const json = (await readUnstructuredJsonResponse(response)) as UnstructuredJob;
      if (typeof json.id !== 'string') {
        throw new Error('provider error: Unstructured create job did not return an id.');
      }
      return json;
    },
    async getJob(input) {
      const response = await fetch(`${baseUrl}/jobs/${input.jobId}`, {
        headers: {
          Accept: 'application/json',
          'unstructured-api-key': apiKey,
        },
      });
      return (await readUnstructuredJsonResponse(response)) as UnstructuredJob;
    },
    async getJobDetails(input) {
      const response = await fetch(`${baseUrl}/jobs/${input.jobId}/details`, {
        headers: {
          Accept: 'application/json',
          'unstructured-api-key': apiKey,
        },
      });
      return (await readUnstructuredJsonResponse(response)) as UnstructuredJobDetails;
    },
    async downloadJobOutput(input) {
      const params = new URLSearchParams({ file_id: input.fileId });
      if (input.nodeId) params.set('node_id', input.nodeId);
      const response = await fetch(`${baseUrl}/jobs/${input.jobId}/download?${params}`, {
        headers: {
          Accept: 'application/json',
          'unstructured-api-key': apiKey,
        },
      });
      return readUnstructuredJsonResponse(response);
    },
  };
}

async function collectJob(
  runtime: UnstructuredRuntime,
  jobId: string,
  maxPollAttempts: number,
  pollIntervalMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ job: UnstructuredJob; details: UnstructuredJobDetails }> {
  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
    const job = await runtime.getJob({ jobId });
    if (job.status === 'COMPLETED') {
      const details = await runtime.getJobDetails({ jobId });
      if (
        details.processing_status === 'FAILED' ||
        details.processing_status === 'STOPPED' ||
        details.processing_status === 'COMPLETED_WITH_ERRORS'
      ) {
        throw new Error(
          `provider error: Unstructured job ${jobId} failed: ${details.message ?? details.processing_status}.`,
        );
      }
      return { job, details };
    }
    if (job.status === 'FAILED' || job.status === 'STOPPED') {
      const details = await runtime.getJobDetails({ jobId });
      throw new Error(
        `provider error: Unstructured job ${jobId} failed: ${details.message ?? job.status}.`,
      );
    }
    if (attempt === maxPollAttempts) {
      throw new Error(
        `timeout: Unstructured job ${jobId} did not finish after ${maxPollAttempts} polling attempts.`,
      );
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`timeout: Unstructured job ${jobId} did not finish.`);
}

function makeRequest(input: {
  strategy: UnstructuredPartitionStrategy;
  tableToHtml: boolean;
  generativeOcr?: UnstructuredGenerativeOcrConfig;
}): UnstructuredRequestData {
  const nodes: UnstructuredWorkflowNode[] = [
    input.strategy === 'vlm'
      ? {
          name: 'Partitioner',
          type: 'partition',
          subtype: 'vlm',
          settings: {
            provider: 'auto',
            output_format: 'application/json',
            unique_element_ids: true,
            is_dynamic: false,
            allow_fast: true,
          },
        }
      : {
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
  ];
  if (input.tableToHtml && input.strategy === 'hi_res') {
    nodes.push({
      name: 'Enrichment',
      type: 'prompter',
      subtype: 'twopass_table2html',
      settings: {},
    });
  }
  if (input.generativeOcr && input.strategy === 'hi_res') {
    nodes.push({
      name: 'Enrichment',
      type: 'prompter',
      subtype: input.generativeOcr.subtype,
      settings: {
        provider_type: input.generativeOcr.providerType,
        model: input.generativeOcr.model,
      },
    });
  }
  return { job_nodes: nodes };
}

function unstructuredError(error: unknown): Error {
  if (typeof error === 'object' && error && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    const message = error instanceof Error ? error.message : `HTTP ${status}`;
    if (status === 429) {
      return Object.assign(new Error(`rate limit: ${message}`), { status: 429, cause: error });
    }
    if (status === 401 || status === 403) {
      return Object.assign(new Error(`credential failure: ${message}`), {
        status,
        cause: error,
      });
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createUnstructuredProvider(
  deps: UnstructuredProviderDeps = {},
): PdfExtractionProvider {
  const now = deps.now ?? (() => new Date().toISOString());
  const prepareDocument = deps.prepareDocument ?? prepareUnstructuredInputDocument;
  const sleep = deps.sleep ?? defaultSleep;
  const region = deps.region ?? regionFromEnv();
  const strategy = deps.strategy ?? strategyFromEnv();
  const tableToHtml = deps.tableToHtml ?? tableToHtmlFromEnv();
  const generativeOcr = deps.generativeOcr ?? generativeOcrFromEnv();
  const pollIntervalMs = deps.pollIntervalMs ?? 2_000;
  const maxPollAttempts = deps.maxPollAttempts ?? 150;
  const costPerPageUsd = deps.costPerPageUsd ?? costPerPageFromEnv();

  return {
    id: 'unstructured',
    displayName: 'Unstructured',
    version: UNSTRUCTURED_PROVIDER_VERSION,
    async extract(input) {
      const startedAt = now();
      const startMs = Date.now();
      const sourceHash = await fileSha256(input.sourcePath);
      const providerConfigHash = unstructuredProviderConfigHash({
        strategy,
        tableToHtml,
        generativeOcr,
        costPerPageUsd,
      });
      const outputPath = rawOutputPath(input, sourceHash, providerConfigHash);
      const inputPath = preparedInputPath(input, sourceHash, providerConfigHash);
      await mkdir(dirname(outputPath), { recursive: true });
      const runtime = deps.runtime ?? (await createUnstructuredRestRuntime());

      try {
        const preparedDocument = await prepareDocument({
          sourcePath: input.sourcePath,
          pages: input.pages,
          outputPath: inputPath,
        });
        const requestData = makeRequest({ strategy, tableToHtml, generativeOcr });
        const start = await runtime.createJob({
          sourcePath: preparedDocument.sourcePath,
          requestData,
        });
        if (typeof start.id !== 'string') {
          throw new Error('provider error: Unstructured create job did not return an id.');
        }
        const { job, details } = await collectJob(
          runtime,
          start.id,
          maxPollAttempts,
          pollIntervalMs,
          sleep,
        );
        const outputFile = job.output_node_files
          ?.toReversed()
          .find((file) => typeof file.file_id === 'string');
        if (!outputFile?.file_id) {
          throw new Error(
            `provider error: Unstructured job ${start.id} did not return output files.`,
          );
        }
        const output = await runtime.downloadJobOutput({
          jobId: start.id,
          fileId: outputFile.file_id,
          nodeId: outputFile.node_id,
        });
        const selectedPages = normalizeElements(output, input.pages, preparedDocument.pageMap);
        const completedAt = now();
        const pagesProcessed = selectedPages.length;
        const estimatedUsd = round(pagesProcessed * costPerPageUsd);
        const rawPayload = {
          jobId: start.id,
          requestData,
          preparedSourcePath: preparedDocument.sourcePath,
          pageMap: preparedDocument.pageMap,
          createdJob: start,
          completedJob: job,
          details,
          output,
        };
        const rawJson = `${JSON.stringify(rawPayload, null, 2)}\n`;
        await writeFile(outputPath, rawJson, 'utf8');
        const artifact = {
          schemaVersion: 'squire-pdf-extraction-v1',
          provider: 'unstructured',
          providerVersion: UNSTRUCTURED_PROVIDER_VERSION,
          providerConfigHash,
          source: {
            path: input.sourcePath,
            sha256: sourceHash,
            ...(preparedDocument.sourcePageCount !== undefined
              ? { pageCount: preparedDocument.sourcePageCount }
              : {}),
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
              'Unstructured on-demand workflow job data is retained according to the configured Unstructured workspace policy; raw outputs are persisted only in the configured eval output directory.',
            trainingUse: 'unknown',
            region,
          },
          providerMetadata: {
            api: 'workflow-on-demand-jobs',
            jobId: start.id,
            workflowId: job.workflow_id ?? start.workflow_id,
            workflowName: job.workflow_name ?? start.workflow_name,
            jobType: job.job_type ?? start.job_type,
            runtime: job.runtime,
            processingStatus: details.processing_status,
            nodeStats: details.node_stats ?? [],
            outputNodeFiles: job.output_node_files ?? [],
            pageMap: preparedDocument.pageMap,
            partitionStrategy: strategy,
            tableToHtml,
            generativeOcr,
            requestData,
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
        throw unstructuredError(error);
      }
    },
  };
}
