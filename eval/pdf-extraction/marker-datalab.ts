import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { parseFragment } from 'parse5';

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

type MarkerDatalabMode = 'fast' | 'balanced' | 'accurate';
type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
};

interface MarkerDatalabBlock {
  id?: string;
  block_id?: string;
  block_type?: string;
  type?: string;
  html?: string;
  text?: string;
  markdown?: string;
  polygon?: unknown;
  bbox?: unknown;
  children?: MarkerDatalabBlock[] | null;
  page_id?: number;
  page?: number;
}

export interface MarkerDatalabConvertRequest {
  mode: MarkerDatalabMode;
  outputFormat: string;
  pageRange?: string;
  paginate: boolean;
  addBlockIds: boolean;
  includeMarkdownInChunks: boolean;
  disableImageExtraction: boolean;
  disableImageCaptions: boolean;
  tokenEfficientMarkdown: boolean;
  skipCache: boolean;
  saveCheckpoint: boolean;
  extras: string;
}

export interface MarkerDatalabStartResult {
  requestId: string;
  requestCheckUrl: string;
  versions?: Record<string, unknown>;
}

export interface MarkerDatalabConvertResult {
  status?: string;
  result_url?: string;
  expires_in?: number;
  output_format?: string;
  chunks?: unknown;
  json?: unknown;
  markdown?: string | null;
  html?: string | null;
  images?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  success?: boolean | null;
  error?: string | null;
  parse_quality_score?: number | null;
  page_count?: number | null;
  total_cost?: number | null;
  cost_breakdown?: Record<string, unknown>;
  runtime?: number | null;
  checkpoint_id?: string | null;
  versions?: Record<string, unknown>;
  requestId?: string;
}

export interface MarkerDatalabRuntime {
  startConvert(input: {
    sourcePath: string;
    request: MarkerDatalabConvertRequest;
  }): Promise<MarkerDatalabStartResult>;
  getConvertResult(input: {
    requestId: string;
    requestCheckUrl: string;
  }): Promise<MarkerDatalabConvertResult>;
}

export interface MarkerDatalabProviderDeps {
  runtime?: MarkerDatalabRuntime;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  mode?: MarkerDatalabMode;
  region?: string;
  skipCache?: boolean;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  costPerPageUsd?: number;
}

const MARKER_DATALAB_OUTPUT_FORMAT = 'markdown,json,chunks';
const MARKER_DATALAB_EXTRAS = 'table_row_bboxes,extract_links,new_block_types';
const MARKER_DATALAB_DEFAULT_MODE: MarkerDatalabMode = 'accurate';
const MARKER_DATALAB_FAST_BALANCED_COST_PER_PAGE_USD = 0.004;
const MARKER_DATALAB_ACCURATE_COST_PER_PAGE_USD = 0.006;

export const MARKER_DATALAB_PROVIDER_VERSION = 'datalab-convert-v1-marker-chandra';

function providerConfigFor(input: {
  mode: MarkerDatalabMode;
  skipCache: boolean;
  costPerPageUsd: number;
}) {
  return {
    api: 'Datalab Convert API v1',
    engine: 'Datalab managed Marker/Chandra conversion',
    mode: input.mode,
    outputFormat: MARKER_DATALAB_OUTPUT_FORMAT,
    selectedPages: 'page_range-zero-indexed-v1',
    paginate: true,
    addBlockIds: true,
    includeMarkdownInChunks: true,
    disableImageExtraction: false,
    disableImageCaptions: false,
    tokenEfficientMarkdown: false,
    skipCache: input.skipCache,
    saveCheckpoint: false,
    extras: MARKER_DATALAB_EXTRAS.split(','),
    costPerPageUsd: input.costPerPageUsd,
  };
}

export const MARKER_DATALAB_PROVIDER_CONFIG = providerConfigFor({
  mode: MARKER_DATALAB_DEFAULT_MODE,
  skipCache: false,
  costPerPageUsd: MARKER_DATALAB_ACCURATE_COST_PER_PAGE_USD,
});
export const MARKER_DATALAB_PROVIDER_CONFIG_HASH = computeProviderConfigHash(
  MARKER_DATALAB_PROVIDER_CONFIG,
);

export function markerDatalabProviderConfigHash(input: {
  mode: MarkerDatalabMode;
  skipCache: boolean;
  costPerPageUsd: number;
}): string {
  return computeProviderConfigHash(providerConfigFor(input));
}

export function markerDatalabProviderConfigHashFromEnv(): string {
  const mode = modeFromEnv();
  return markerDatalabProviderConfigHash({
    mode,
    skipCache: skipCacheFromEnv(),
    costPerPageUsd: costPerPageFromEnv(mode),
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
  return `${input.outputDir}/raw/marker-datalab/${sourceHash.slice(7)}/${providerConfigHash.slice(7)}/${safePathSegment(input.runLabel)}.json`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pageRange(pages: number[]): string | undefined {
  if (pages.length === 0) return undefined;
  return pages.map((page) => String(page - 1)).join(',');
}

function makeRequest(input: {
  pages: number[];
  mode: MarkerDatalabMode;
  skipCache: boolean;
}): MarkerDatalabConvertRequest {
  return {
    mode: input.mode,
    outputFormat: MARKER_DATALAB_OUTPUT_FORMAT,
    ...(pageRange(input.pages) ? { pageRange: pageRange(input.pages) } : {}),
    paginate: true,
    addBlockIds: true,
    includeMarkdownInChunks: true,
    disableImageExtraction: false,
    disableImageCaptions: false,
    tokenEfficientMarkdown: false,
    skipCache: input.skipCache,
    saveCheckpoint: false,
    extras: MARKER_DATALAB_EXTRAS,
  };
}

function modeFromEnv(): MarkerDatalabMode {
  const mode = process.env.DATALAB_MODE ?? MARKER_DATALAB_DEFAULT_MODE;
  if (!['fast', 'balanced', 'accurate'].includes(mode)) {
    throw new Error('Invalid DATALAB_MODE: expected fast, balanced, or accurate.');
  }
  return mode as MarkerDatalabMode;
}

function regionFromEnv(): string {
  return process.env.DATALAB_REGION ?? 'us';
}

function skipCacheFromEnv(): boolean {
  return process.env.DATALAB_SKIP_CACHE === '1';
}

function defaultCostForMode(mode: MarkerDatalabMode): number {
  return mode === 'accurate'
    ? MARKER_DATALAB_ACCURATE_COST_PER_PAGE_USD
    : MARKER_DATALAB_FAST_BALANCED_COST_PER_PAGE_USD;
}

function costPerPageFromEnv(mode: MarkerDatalabMode): number {
  const cost = process.env.DATALAB_COST_PER_PAGE_USD;
  if (!cost) return defaultCostForMode(mode);
  const value = Number(cost);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Invalid DATALAB_COST_PER_PAGE_USD: expected a non-negative number.');
  }
  return value;
}

function apiKeyFromEnv(): string {
  const key = process.env.DATALAB_API_KEY;
  if (!key) throw new Error('Missing DATALAB_API_KEY for live Marker/Datalab extraction.');
  return key;
}

function baseUrlFromEnv(): string {
  return (process.env.DATALAB_BASE_URL ?? 'https://www.datalab.to').replace(/\/+$/g, '');
}

function requestIdFrom(response: Response): string | undefined {
  return (
    response.headers.get('x-request-id') ??
    response.headers.get('x-trace-id') ??
    response.headers.get('request-id') ??
    undefined
  );
}

export async function readMarkerDatalabJsonResponse(response: Response): Promise<unknown> {
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
    throw Object.assign(new Error(`Datalab HTTP ${response.status}: ${detail}`), {
      status: response.status,
    });
  }
  return parsed;
}

async function createMarkerDatalabRestRuntime(): Promise<MarkerDatalabRuntime> {
  const apiKey = apiKeyFromEnv();
  const baseUrl = baseUrlFromEnv();
  return {
    async startConvert(input) {
      const form = new FormData();
      form.append(
        'file.0',
        new Blob([await readFile(input.sourcePath)], { type: 'application/pdf' }),
        basename(input.sourcePath),
      );
      form.append('mode', input.request.mode);
      form.append('output_format', input.request.outputFormat);
      if (input.request.pageRange) form.append('page_range', input.request.pageRange);
      form.append('paginate', String(input.request.paginate));
      form.append('add_block_ids', String(input.request.addBlockIds));
      form.append('include_markdown_in_chunks', String(input.request.includeMarkdownInChunks));
      form.append('disable_image_extraction', String(input.request.disableImageExtraction));
      form.append('disable_image_captions', String(input.request.disableImageCaptions));
      form.append('token_efficient_markdown', String(input.request.tokenEfficientMarkdown));
      form.append('skip_cache', String(input.request.skipCache));
      form.append('save_checkpoint', String(input.request.saveCheckpoint));
      form.append('extras', input.request.extras);

      const response = await fetch(`${baseUrl}/api/v1/convert`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'X-API-Key': apiKey,
        },
        body: form,
      });
      const json = (await readMarkerDatalabJsonResponse(response)) as {
        request_id?: unknown;
        request_check_url?: unknown;
        error?: unknown;
        success?: unknown;
        versions?: Record<string, unknown>;
      };
      if (json.success === false) {
        throw new Error(
          `provider error: Datalab conversion failed to start: ${json.error ?? 'unknown failure'}.`,
        );
      }
      if (typeof json.request_id !== 'string') {
        throw new Error('provider error: Datalab conversion did not return a request_id.');
      }
      if (typeof json.request_check_url !== 'string') {
        throw new Error('provider error: Datalab conversion did not return a request_check_url.');
      }
      return {
        requestId: json.request_id,
        requestCheckUrl: json.request_check_url.startsWith('http')
          ? json.request_check_url
          : `${baseUrl}${json.request_check_url}`,
        versions: json.versions,
      };
    },
    async getConvertResult(input) {
      const response = await fetch(input.requestCheckUrl, {
        headers: {
          Accept: 'application/json',
          'X-API-Key': apiKey,
        },
      });
      const json = (await readMarkerDatalabJsonResponse(response)) as MarkerDatalabConvertResult;
      return {
        ...json,
        requestId: requestIdFrom(response),
      };
    },
  };
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectResult(
  runtime: MarkerDatalabRuntime,
  start: MarkerDatalabStartResult,
  maxPollAttempts: number,
  pollIntervalMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ result: MarkerDatalabConvertResult; requestIds: string[] }> {
  const requestIds: string[] = [];
  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
    const result = await runtime.getConvertResult({
      requestId: start.requestId,
      requestCheckUrl: start.requestCheckUrl,
    });
    if (result.requestId) requestIds.push(result.requestId);
    const status = result.status?.toLowerCase();
    if (status === 'complete') {
      if (result.success === false) {
        throw new Error(
          `provider error: Datalab request ${start.requestId} failed: ${result.error ?? 'unknown failure'}.`,
        );
      }
      return { result, requestIds };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(
        `provider error: Datalab request ${start.requestId} failed: ${result.error ?? 'unknown failure'}.`,
      );
    }
    if (attempt === maxPollAttempts) {
      throw new Error(
        `timeout: Datalab request ${start.requestId} did not finish after ${maxPollAttempts} polling attempts.`,
      );
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`timeout: Datalab request ${start.requestId} did not finish.`);
}

function markerDatalabError(error: unknown): Error {
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

function blockChildren(block: MarkerDatalabBlock): MarkerDatalabBlock[] {
  return Array.isArray(block.children) ? block.children : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function datalabBlock(value: unknown): MarkerDatalabBlock | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.block_type !== 'string' &&
    typeof value.type !== 'string' &&
    !Array.isArray(value.children)
  ) {
    return undefined;
  }
  return value as MarkerDatalabBlock;
}

function findPageBlocks(value: unknown): MarkerDatalabBlock[] {
  const pages: MarkerDatalabBlock[] = [];
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    const block = datalabBlock(entry);
    if (!block) return;
    const kind = block.block_type ?? block.type;
    if (kind === 'Page') pages.push(block);
    for (const child of blockChildren(block)) visit(child);
  };
  visit(value);
  return pages;
}

function walkBlocks(block: MarkerDatalabBlock): MarkerDatalabBlock[] {
  return blockChildren(block).flatMap((child) => [child, ...walkBlocks(child)]);
}

function pageIndexFromBlock(block: MarkerDatalabBlock): number | undefined {
  if (Number.isInteger(block.page_id)) return block.page_id;
  if (Number.isInteger(block.page)) return block.page;
  const id = block.id ?? block.block_id;
  if (!id) return undefined;
  const match = /\/page\/(\d+)\b/.exec(id);
  return match ? Number(match[1]) : undefined;
}

function pageNumberFor(block: MarkerDatalabBlock, order: number, requestedPages: number[]): number {
  const providerPageIndex = pageIndexFromBlock(block);
  if (providerPageIndex !== undefined) {
    const originalPage = providerPageIndex + 1;
    if (requestedPages.length === 0 || requestedPages.includes(originalPage)) return originalPage;
  }
  if (requestedPages.length > 0 && order < requestedPages.length) return requestedPages[order];
  return providerPageIndex === undefined ? order + 1 : providerPageIndex + 1;
}

function htmlText(html: string): string {
  const fragment = parseFragment(html) as HtmlNode;
  const collect = (node: HtmlNode): string[] => {
    if (typeof node.value === 'string') return [node.value];
    return (node.childNodes ?? []).flatMap(collect);
  };
  return collect(fragment).join(' ').replace(/\s+/g, ' ').trim();
}

function blockText(block: MarkerDatalabBlock): string {
  if (typeof block.text === 'string') return block.text.trim();
  if (typeof block.markdown === 'string') return block.markdown.trim();
  if (typeof block.html === 'string') return htmlText(block.html);
  return '';
}

function blockType(block: MarkerDatalabBlock): ExtractionBlock['type'] {
  switch (block.block_type ?? block.type) {
    case 'SectionHeader':
    case 'Title':
      return 'heading';
    case 'Text':
    case 'TextInlineMath':
    case 'ListItem':
    case 'Code':
    case 'Equation':
    case 'Form':
      return 'paragraph';
    case 'Table':
    case 'TableGroup':
      return 'table';
    case 'Picture':
    case 'PictureGroup':
    case 'Figure':
    case 'FigureGroup':
      return 'image';
    case 'PageHeader':
      return 'header';
    case 'PageFooter':
      return 'footer';
    case 'Page':
      return 'other';
    default:
      return 'other';
  }
}

function polygonBBox(value: unknown): ExtractionBlock['bbox'] {
  if (!Array.isArray(value)) return undefined;
  const points = value
    .filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2)
    .map(([x, y]) => ({ x: Number(x), y: Number(y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length === 0) return undefined;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: round(Math.max(0, minX)),
    y: round(Math.max(0, minY)),
    width: round(Math.max(0, maxX - minX)),
    height: round(Math.max(0, maxY - minY)),
  };
}

function bboxFromBlock(block: MarkerDatalabBlock): ExtractionBlock['bbox'] {
  const polygon = polygonBBox(block.polygon);
  if (polygon) return polygon;
  if (!isRecord(block.bbox)) return undefined;
  const x = Number(block.bbox.x);
  const y = Number(block.bbox.y);
  const width = Number(block.bbox.width);
  const height = Number(block.bbox.height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  return {
    x: round(Math.max(0, x)),
    y: round(Math.max(0, y)),
    width: round(Math.max(0, width)),
    height: round(Math.max(0, height)),
  };
}

function blockFor(pageNumber: number, block: MarkerDatalabBlock, order: number): ExtractionBlock {
  return {
    id: block.id ?? block.block_id ?? `p${pageNumber}-b${order}`,
    type: blockType(block),
    order,
    text: blockText(block),
    ...(bboxFromBlock(block) ? { bbox: bboxFromBlock(block) } : {}),
  };
}

function nodesByTag(node: HtmlNode, tagName: string): HtmlNode[] {
  const matches = node.tagName === tagName ? [node] : [];
  return matches.concat((node.childNodes ?? []).flatMap((child) => nodesByTag(child, tagName)));
}

function attr(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((entry) => entry.name.toLowerCase() === name)?.value;
}

function tableCellsFromHtml(html: string): ExtractionTableCell[] {
  const fragment = parseFragment(html) as HtmlNode;
  return nodesByTag(fragment, 'tr').flatMap((row, rowIndex) =>
    (row.childNodes ?? [])
      .filter((cell) => cell.tagName === 'th' || cell.tagName === 'td')
      .map((cell, columnIndex) => ({
        row: rowIndex,
        column: columnIndex,
        rowSpan: Number(attr(cell, 'rowspan') ?? 1),
        columnSpan: Number(attr(cell, 'colspan') ?? 1),
        text: htmlTextFromNode(cell),
      })),
  );
}

function htmlTextFromNode(node: HtmlNode): string {
  const collect = (entry: HtmlNode): string[] => {
    if (typeof entry.value === 'string') return [entry.value];
    return (entry.childNodes ?? []).flatMap(collect);
  };
  return collect(node).join(' ').replace(/\s+/g, ' ').trim();
}

function tableForBlock(
  pageNumber: number,
  block: MarkerDatalabBlock,
  order: number,
): ExtractionTable | undefined {
  if (blockType(block) !== 'table' || typeof block.html !== 'string') return undefined;
  const cells = tableCellsFromHtml(block.html);
  if (cells.length === 0) return undefined;
  return {
    id: block.id ?? block.block_id ?? `p${pageNumber}-table-${order}`,
    order,
    ...(bboxFromBlock(block) ? { bbox: bboxFromBlock(block) } : {}),
    cells,
  };
}

function markdownForBlocks(blocks: ExtractionBlock[]): string {
  return blocks
    .map((block) => (block.type === 'heading' ? `## ${block.text}` : block.text))
    .filter(Boolean)
    .join('\n\n');
}

function toExtractionPage(
  pageBlock: MarkerDatalabBlock,
  order: number,
  requestedPages: number[],
): ExtractionPage {
  const pageNumber = pageNumberFor(pageBlock, order, requestedPages);
  const sourceBlocks = walkBlocks(pageBlock).filter(
    (block) => (block.block_type ?? block.type) !== 'Page',
  );
  const blocks = sourceBlocks.map((block, index) => blockFor(pageNumber, block, index));
  const tables = sourceBlocks
    .map((block, index) => tableForBlock(pageNumber, block, index))
    .filter((table): table is ExtractionTable => table !== undefined);
  const bbox = bboxFromBlock(pageBlock);
  const markdown =
    typeof pageBlock.markdown === 'string' && pageBlock.markdown.trim()
      ? pageBlock.markdown.trim()
      : markdownForBlocks(blocks);
  const text = blocks
    .map((block) => block.text)
    .filter(Boolean)
    .join('\n\n');

  return {
    pageNumber,
    width: bbox?.width ?? 612,
    height: bbox?.height ?? 792,
    unit: 'pt',
    markdown,
    text,
    blocks,
    tables,
  };
}

function fallbackPageFromMarkdown(
  result: MarkerDatalabConvertResult,
  requestedPages: number[],
): ExtractionPage[] {
  const markdown = result.markdown?.trim();
  if (!markdown) throw new Error('invalid artifact: Datalab output contained no pages.');
  const pages = requestedPages.length > 0 ? requestedPages : [1];
  if (pages.length !== 1) {
    throw new Error('invalid artifact: Datalab JSON output is required for multi-page runs.');
  }
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks = lines.map((line, order) => ({
    id: `p${pages[0]}-b${order}`,
    type: /^#{1,6}\s+/.test(line) ? 'heading' : 'line',
    order,
    text: line.replace(/^#{1,6}\s+/, ''),
  })) satisfies ExtractionBlock[];
  return [
    {
      pageNumber: pages[0],
      width: 612,
      height: 792,
      unit: 'pt',
      markdown,
      text: blocks.map((block) => block.text).join('\n\n'),
      blocks,
      tables: [],
    },
  ];
}

function normalizePages(
  result: MarkerDatalabConvertResult,
  requestedPages: number[],
): ExtractionPage[] {
  const pageBlocks = findPageBlocks(result.json);
  const pages =
    pageBlocks.length > 0
      ? pageBlocks.map((page, order) => toExtractionPage(page, order, requestedPages))
      : fallbackPageFromMarkdown(result, requestedPages);
  if (requestedPages.length > 0) {
    const byPage = new Map(pages.map((page) => [page.pageNumber, page]));
    return requestedPages.map((pageNumber) => {
      const page = byPage.get(pageNumber);
      if (!page) throw new Error(`invalid artifact: Datalab output omitted page ${pageNumber}.`);
      return page;
    });
  }
  return pages.sort((left, right) => left.pageNumber - right.pageNumber);
}

function actualCostUsd(result: MarkerDatalabConvertResult): number | undefined {
  if (typeof result.total_cost === 'number' && Number.isFinite(result.total_cost)) {
    return round(result.total_cost / 100);
  }
  const breakdown = result.cost_breakdown;
  if (!breakdown) return undefined;
  for (const key of ['final_cost', 'client_cost', 'total_cost', 'list_cost']) {
    const value = breakdown[key];
    if (typeof value === 'number' && Number.isFinite(value)) return round(value / 100);
  }
  return undefined;
}

export function estimatedMarkerDatalabCostUsd(pages: number[]): number | undefined {
  if (pages.length === 0) return undefined;
  const mode = modeFromEnv();
  return round(pages.length * costPerPageFromEnv(mode));
}

export function createMarkerDatalabProvider(
  deps: MarkerDatalabProviderDeps = {},
): PdfExtractionProvider {
  const now = deps.now ?? (() => new Date().toISOString());
  const sleep = deps.sleep ?? defaultSleep;
  const mode = deps.mode ?? modeFromEnv();
  const region = deps.region ?? regionFromEnv();
  const skipCache = deps.skipCache ?? skipCacheFromEnv();
  const pollIntervalMs = deps.pollIntervalMs ?? 2_000;
  const maxPollAttempts = deps.maxPollAttempts ?? 150;
  const costPerPageUsd = deps.costPerPageUsd ?? costPerPageFromEnv(mode);

  return {
    id: 'marker-datalab',
    displayName: 'Marker/Datalab',
    version: MARKER_DATALAB_PROVIDER_VERSION,
    async extract(input) {
      const startedAt = now();
      const startMs = Date.now();
      const sourceHash = await fileSha256(input.sourcePath);
      const providerConfigHash = markerDatalabProviderConfigHash({
        mode,
        skipCache,
        costPerPageUsd,
      });
      const outputPath = rawOutputPath(input, sourceHash, providerConfigHash);
      await mkdir(dirname(outputPath), { recursive: true });
      const runtime = deps.runtime ?? (await createMarkerDatalabRestRuntime());

      try {
        const request = makeRequest({ pages: input.pages, mode, skipCache });
        const start = await runtime.startConvert({
          sourcePath: input.sourcePath,
          request,
        });
        const { result, requestIds } = await collectResult(
          runtime,
          start,
          maxPollAttempts,
          pollIntervalMs,
          sleep,
        );
        const selectedPages = normalizePages(result, input.pages);
        const completedAt = now();
        const pagesProcessed = selectedPages.length;
        const estimatedUsd = round(pagesProcessed * costPerPageUsd);
        const rawPayload = {
          request,
          start,
          result,
        };
        const rawJson = `${JSON.stringify(rawPayload, null, 2)}\n`;
        await writeFile(outputPath, rawJson, 'utf8');
        const artifact = {
          schemaVersion: 'squire-pdf-extraction-v1',
          provider: 'marker-datalab',
          providerVersion: MARKER_DATALAB_PROVIDER_VERSION,
          providerConfigHash,
          source: {
            path: input.sourcePath,
            sha256: sourceHash,
            ...(typeof result.page_count === 'number' && result.page_count > 0
              ? { pageCount: result.page_count }
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
            actualUsd: actualCostUsd(result) ?? estimatedUsd,
            pagesProcessed,
            costPerPageUsd,
          },
          privacy: {
            retentionPolicy:
              'Datalab managed conversion stores hosted results temporarily and documents result deletion after processing; raw outputs are persisted only in the configured eval output directory.',
            trainingUse: 'not-used-for-training',
            region,
          },
          providerMetadata: {
            mode,
            outputFormat: request.outputFormat,
            pageRange: request.pageRange,
            skipCache,
            requestId: start.requestId,
            requestCheckUrl: start.requestCheckUrl,
            requestIds,
            parseQualityScore: result.parse_quality_score,
            runtime: result.runtime,
            outputFormatReturned: result.output_format,
            resultUrlExpiresIn: result.expires_in,
            checkpointId: result.checkpoint_id,
            versions: { start: start.versions, result: result.versions },
            metadata: result.metadata,
            imageCount: result.images ? Object.keys(result.images).length : 0,
            costBreakdown: result.cost_breakdown,
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
        throw markerDatalabError(error);
      }
    },
  };
}
