import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

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

type LlamaParseJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
type LlamaParseTier = 'fast' | 'cost_effective' | 'agentic' | 'agentic_plus';

interface LlamaParsePageRange {
  target_pages?: string;
  max_pages?: number;
}

interface LlamaParseMarkdownPage {
  page_number?: number;
  success?: boolean;
  markdown?: string;
  header?: string;
  footer?: string;
}

interface LlamaParseTextPage {
  page_number?: number;
  text?: string;
}

interface LlamaParseItem {
  type?: string;
  level?: number;
  value?: string;
  md?: string;
  rows?: unknown;
  html?: string;
  csv?: string;
  bbox?: { x?: number; y?: number; width?: number; height?: number };
}

interface LlamaParseItemsPage {
  page_number?: number;
  page_width?: number;
  page_height?: number;
  success?: boolean;
  items?: LlamaParseItem[];
}

interface LlamaParseMetadataPage {
  page_number?: number;
  confidence?: number;
  cost_optimized?: boolean;
  triggered_auto_mode?: boolean;
  printed_page_number?: string;
}

interface LlamaParseJob {
  id?: string;
  status?: LlamaParseJobStatus;
  error?: string;
}

export interface LlamaParseResult {
  job?: LlamaParseJob;
  markdown?: { pages?: LlamaParseMarkdownPage[] };
  text?: { pages?: LlamaParseTextPage[] };
  items?: { pages?: LlamaParseItemsPage[] };
  metadata?: {
    pages?: LlamaParseMetadataPage[];
    document?: Record<string, unknown>;
  };
  job_metadata?: Record<string, unknown>;
  requestId?: string;
}

interface LlamaParseRequest {
  tier: LlamaParseTier;
  version: string;
  expand: string[];
  page_ranges?: LlamaParsePageRange;
  disable_cache: boolean;
  output_options: {
    markdown: {
      tables: {
        output_tables_as_markdown: boolean;
      };
    };
  };
  processing_options: {
    ocr_parameters: {
      languages: string[];
    };
  };
  processing_control: {
    timeouts: {
      base_in_seconds: number;
      extra_time_per_page_in_seconds: number;
    };
    job_failure_conditions: {
      allowed_page_failure_ratio: number;
      fail_on_markdown_reconstruction_error: boolean;
    };
  };
}

export interface LlamaParseRuntime {
  uploadFile(input: { sourcePath: string; purpose: 'parse' }): Promise<{
    fileId: string;
    requestId?: string;
  }>;
  startParse(input: { fileId: string; request: LlamaParseRequest }): Promise<{
    jobId: string;
    status?: LlamaParseJobStatus;
    requestId?: string;
  }>;
  getParseResult(input: { jobId: string; expand: string[] }): Promise<LlamaParseResult>;
}

export interface LlamaParseProviderDeps {
  runtime?: LlamaParseRuntime;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  tier?: LlamaParseTier;
  version?: string;
  region?: string;
  disableCache?: boolean;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  costPerPageUsd?: number;
}

const LLAMAPARSE_EXPAND = ['markdown', 'text', 'items', 'metadata', 'job_metadata'];
const LLAMAPARSE_DEFAULT_TIER: LlamaParseTier = 'agentic';
const LLAMAPARSE_DEFAULT_VERSION = 'latest';
const LLAMAPARSE_DEFAULT_REGION = 'us';
const LLAMAPARSE_CREDIT_USD = 0.00125;
const LLAMAPARSE_DEFAULT_COST_PER_PAGE_USD = 0.05;

export const LLAMAPARSE_PROVIDER_VERSION = 'llamaparse-v2-rest-parse-v1';

function providerConfigFor(input: {
  tier: LlamaParseTier;
  version: string;
  disableCache: boolean;
  costPerPageUsd: number;
}) {
  return {
    api: 'LlamaParse REST v1 beta files + v2 parse',
    tier: input.tier,
    version: input.version,
    expand: LLAMAPARSE_EXPAND,
    selectedPages: 'page_ranges.target_pages-v1',
    pageSizeFallback: { width: 612, height: 792, unit: 'pt' },
    outputOptions: {
      markdown: {
        tables: {
          output_tables_as_markdown: true,
        },
      },
    },
    processingOptions: {
      ocrParameters: { languages: ['en'] },
    },
    processingControl: {
      timeouts: { baseInSeconds: 300, extraTimePerPageInSeconds: 30 },
      jobFailureConditions: {
        allowedPageFailureRatio: 0.01,
        failOnMarkdownReconstructionError: true,
      },
    },
    disableCache: input.disableCache,
    costPerPageUsd: input.costPerPageUsd,
  };
}

export const LLAMAPARSE_PROVIDER_CONFIG = providerConfigFor({
  tier: LLAMAPARSE_DEFAULT_TIER,
  version: LLAMAPARSE_DEFAULT_VERSION,
  disableCache: false,
  costPerPageUsd: LLAMAPARSE_DEFAULT_COST_PER_PAGE_USD,
});
export const LLAMAPARSE_PROVIDER_CONFIG_HASH = computeProviderConfigHash(
  LLAMAPARSE_PROVIDER_CONFIG,
);

export function llamaParseProviderConfigHash(input: {
  tier: LlamaParseTier;
  version: string;
  disableCache: boolean;
  costPerPageUsd: number;
}): string {
  return computeProviderConfigHash(providerConfigFor(input));
}

export function llamaParseProviderConfigHashFromEnv(): string {
  return llamaParseProviderConfigHash({
    tier: tierFromEnv(),
    version: versionFromEnv(),
    disableCache: disableCacheFromEnv(),
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
  return `${input.outputDir}/raw/llamaparse/${sourceHash.slice(7)}/${providerConfigHash.slice(7)}/${safePathSegment(input.runLabel)}.json`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pageRanges(pages: number[]): LlamaParsePageRange | undefined {
  return pages.length === 0 ? undefined : { target_pages: pages.join(',') };
}

function confidence(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return round(value > 1 ? value / 100 : value);
}

function bbox(item: LlamaParseItem): ExtractionBlock['bbox'] {
  const box = item.bbox;
  if (!box) return undefined;
  return {
    x: round(box.x ?? 0),
    y: round(box.y ?? 0),
    width: round(box.width ?? 0),
    height: round(box.height ?? 0),
  };
}

function itemText(item: LlamaParseItem): string {
  if (typeof item.value === 'string') return item.value;
  if (typeof item.md === 'string') return item.md;
  if (typeof item.csv === 'string') return item.csv;
  if (Array.isArray(item.rows)) {
    return item.rows
      .map((row) => (Array.isArray(row) ? row.map(String).join(' | ') : String(row)))
      .join('\n');
  }
  return '';
}

function blockType(item: LlamaParseItem): ExtractionBlock['type'] {
  switch (item.type) {
    case 'heading':
    case 'title':
      return 'heading';
    case 'table':
      return 'table';
    case 'image':
    case 'figure':
      return 'image';
    case 'page_number':
      return 'page-number';
    case 'header':
      return 'header';
    case 'footer':
      return 'footer';
    case 'text':
    case 'paragraph':
    case 'list':
      return 'paragraph';
    default:
      return 'other';
  }
}

function rowsForItem(item: LlamaParseItem): string[][] {
  if (!Array.isArray(item.rows)) return [];
  return item.rows.map((row) => (Array.isArray(row) ? row.map(String) : [String(row)]));
}

function tableForItem(item: LlamaParseItem, pageNumber: number, order: number): ExtractionTable {
  const cells: ExtractionTableCell[] = [];
  rowsForItem(item).forEach((row, rowIndex) => {
    row.forEach((text, columnIndex) => {
      cells.push({
        row: rowIndex,
        column: columnIndex,
        rowSpan: 1,
        columnSpan: 1,
        text,
      });
    });
  });
  return {
    id: `p${pageNumber}-table-${order}`,
    order,
    ...(bbox(item) ? { bbox: bbox(item) } : {}),
    cells,
  };
}

function fallbackBlocksFromMarkdown(
  pageNumber: number,
  markdown: string,
  pageConfidence?: number,
): ExtractionBlock[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, order) => {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      return {
        id: `p${pageNumber}-b${order}`,
        type: heading ? 'heading' : 'line',
        order,
        text: heading?.[2] ?? line,
        ...(pageConfidence !== undefined ? { confidence: pageConfidence } : {}),
      };
    });
}

function blockForItem(
  item: LlamaParseItem,
  pageNumber: number,
  order: number,
  pageConfidence?: number,
): ExtractionBlock {
  return {
    id: `p${pageNumber}-b${order}`,
    type: blockType(item),
    order,
    text: itemText(item),
    ...(bbox(item) ? { bbox: bbox(item) } : {}),
    ...(pageConfidence !== undefined ? { confidence: pageConfidence } : {}),
  };
}

function pageNumber(value: { page_number?: number }): number | undefined {
  return typeof value.page_number === 'number' && Number.isInteger(value.page_number)
    ? value.page_number
    : undefined;
}

function pageNumbersFromResult(result: LlamaParseResult): number[] {
  const pageNumbers = new Set<number>();
  for (const page of result.markdown?.pages ?? []) {
    const value = pageNumber(page);
    if (value && value > 0) pageNumbers.add(value);
  }
  for (const page of result.text?.pages ?? []) {
    const value = pageNumber(page);
    if (value && value > 0) pageNumbers.add(value);
  }
  for (const page of result.items?.pages ?? []) {
    const value = pageNumber(page);
    if (value && value > 0) pageNumbers.add(value);
  }
  return [...pageNumbers].sort((left, right) => left - right);
}

function sourcePageCountFromResult(
  result: LlamaParseResult,
  requestedPages: number[],
): number | undefined {
  if (requestedPages.length > 0) return undefined;
  const pageNumbers = pageNumbersFromResult(result);
  return pageNumbers.length === 0 ? undefined : Math.max(...pageNumbers);
}

function indexByPage<T extends { page_number?: number }>(pages: T[] | undefined): Map<number, T> {
  return new Map(
    (pages ?? [])
      .map((page) => [pageNumber(page), page] as const)
      .filter((entry): entry is readonly [number, T] => entry[0] !== undefined),
  );
}

function toExtractionPage(result: LlamaParseResult, selectedPageNumber: number): ExtractionPage {
  const markdownByPage = indexByPage(result.markdown?.pages);
  const textByPage = indexByPage(result.text?.pages);
  const itemsByPage = indexByPage(result.items?.pages);
  const metadataByPage = indexByPage(result.metadata?.pages);
  const markdownPage = markdownByPage.get(selectedPageNumber);
  const textPage = textByPage.get(selectedPageNumber);
  const itemsPage = itemsByPage.get(selectedPageNumber);
  const metadataPage = metadataByPage.get(selectedPageNumber);
  if (!markdownPage && !textPage && !itemsPage) {
    throw new Error(`invalid artifact: LlamaParse output omitted page ${selectedPageNumber}.`);
  }
  if (markdownPage?.success === false || itemsPage?.success === false) {
    throw new Error(`partial page failure: LlamaParse marked page ${selectedPageNumber} failed.`);
  }

  const pageConfidence = confidence(metadataPage?.confidence);
  const items = itemsPage?.items ?? [];
  const blocks =
    items.length > 0
      ? items.map((item, order) => blockForItem(item, selectedPageNumber, order, pageConfidence))
      : fallbackBlocksFromMarkdown(
          selectedPageNumber,
          markdownPage?.markdown ?? '',
          pageConfidence,
        );
  const tables = items
    .map((item, order) => ({ item, order }))
    .filter(({ item }) => item.type === 'table')
    .map(({ item, order }) => tableForItem(item, selectedPageNumber, order));

  return {
    pageNumber: selectedPageNumber,
    width: itemsPage?.page_width ?? 612,
    height: itemsPage?.page_height ?? 792,
    unit: 'pt',
    markdown: markdownPage?.markdown ?? blocks.map((block) => block.text).join('\n\n'),
    text:
      textPage?.text ??
      blocks
        .map((block) => block.text)
        .filter(Boolean)
        .join('\n\n'),
    blocks,
    tables,
  };
}

function normalizePages(result: LlamaParseResult, requestedPages: number[]): ExtractionPage[] {
  const selectedPages = requestedPages.length > 0 ? requestedPages : pageNumbersFromResult(result);
  if (selectedPages.length === 0) {
    throw new Error('invalid artifact: LlamaParse output contained no pages.');
  }
  return selectedPages.map((page) => toExtractionPage(result, page));
}

function llamaParseError(error: unknown): Error {
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

function apiKeyFromEnv(): string {
  const key = process.env.LLAMA_CLOUD_API_KEY;
  if (!key) throw new Error('Missing LLAMA_CLOUD_API_KEY for live LlamaParse extraction.');
  return key;
}

function baseUrlFromEnv(): string {
  return (process.env.LLAMA_CLOUD_BASE_URL ?? 'https://api.cloud.llamaindex.ai').replace(
    /\/+$/g,
    '',
  );
}

function tierFromEnv(): LlamaParseTier {
  const tier = process.env.LLAMAPARSE_TIER ?? LLAMAPARSE_DEFAULT_TIER;
  if (!['fast', 'cost_effective', 'agentic', 'agentic_plus'].includes(tier)) {
    throw new Error(
      'Invalid LLAMAPARSE_TIER: expected fast, cost_effective, agentic, or agentic_plus.',
    );
  }
  if (tier === 'fast') {
    throw new Error(
      'unsupported configuration: LlamaParse fast tier cannot return markdown/items.',
    );
  }
  return tier as LlamaParseTier;
}

function versionFromEnv(): string {
  return process.env.LLAMAPARSE_VERSION ?? LLAMAPARSE_DEFAULT_VERSION;
}

function disableCacheFromEnv(): boolean {
  return process.env.LLAMAPARSE_DISABLE_CACHE === '1';
}

function costPerPageFromEnv(): number {
  const cost = process.env.LLAMAPARSE_COST_PER_PAGE_USD;
  if (cost) {
    const value = Number(cost);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Invalid LLAMAPARSE_COST_PER_PAGE_USD: expected a non-negative number.');
    }
    return value;
  }
  const credits = process.env.LLAMAPARSE_CREDITS_PER_PAGE;
  if (credits) {
    const value = Number(credits);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Invalid LLAMAPARSE_CREDITS_PER_PAGE: expected a non-negative number.');
    }
    return value * LLAMAPARSE_CREDIT_USD;
  }
  return LLAMAPARSE_DEFAULT_COST_PER_PAGE_USD;
}

function requestIdFrom(response: Response): string | undefined {
  return (
    response.headers.get('x-request-id') ??
    response.headers.get('x-trace-id') ??
    response.headers.get('request-id') ??
    undefined
  );
}

export async function readLlamaParseJsonResponse(response: Response): Promise<unknown> {
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
    throw Object.assign(new Error(`LlamaParse HTTP ${response.status}: ${detail}`), {
      status: response.status,
    });
  }
  return parsed;
}

async function createLlamaParseRestRuntime(): Promise<LlamaParseRuntime> {
  const apiKey = apiKeyFromEnv();
  const baseUrl = baseUrlFromEnv();
  return {
    async uploadFile(input) {
      const form = new FormData();
      form.append(
        'file',
        new Blob([await readFile(input.sourcePath)], { type: 'application/pdf' }),
        basename(input.sourcePath),
      );
      form.append('purpose', input.purpose);
      const response = await fetch(`${baseUrl}/api/v1/beta/files`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      });
      const json = (await readLlamaParseJsonResponse(response)) as { id?: unknown };
      if (typeof json.id !== 'string') {
        throw new Error('provider error: LlamaParse file upload did not return an id.');
      }
      return {
        fileId: json.id,
        requestId: requestIdFrom(response),
      };
    },
    async startParse(input) {
      const response = await fetch(`${baseUrl}/api/v2/parse`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file_id: input.fileId,
          tier: input.request.tier,
          version: input.request.version,
          ...(input.request.page_ranges ? { page_ranges: input.request.page_ranges } : {}),
          disable_cache: input.request.disable_cache,
          output_options: input.request.output_options,
          processing_options: input.request.processing_options,
          processing_control: input.request.processing_control,
        }),
      });
      const json = (await readLlamaParseJsonResponse(response)) as {
        id?: unknown;
        status?: unknown;
      };
      if (typeof json.id !== 'string') {
        throw new Error('provider error: LlamaParse parse request did not return a job id.');
      }
      return {
        jobId: json.id,
        status: typeof json.status === 'string' ? (json.status as LlamaParseJobStatus) : undefined,
        requestId: requestIdFrom(response),
      };
    },
    async getParseResult(input) {
      const params = new URLSearchParams();
      for (const value of input.expand) params.append('expand', value);
      const response = await fetch(`${baseUrl}/api/v2/parse/${input.jobId}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      });
      const json = (await readLlamaParseJsonResponse(response)) as LlamaParseResult;
      return {
        ...json,
        requestId: requestIdFrom(response),
      };
    },
  };
}

async function collectResult(
  runtime: LlamaParseRuntime,
  jobId: string,
  expand: string[],
  maxPollAttempts: number,
  pollIntervalMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ result: LlamaParseResult; requestIds: string[] }> {
  const requestIds: string[] = [];
  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
    const result = await runtime.getParseResult({ jobId, expand });
    if (result.requestId) requestIds.push(result.requestId);
    const status = result.job?.status;
    if (status === 'COMPLETED') return { result, requestIds };
    if (status === 'FAILED') {
      throw new Error(
        `provider error: LlamaParse job ${jobId} failed: ${result.job?.error ?? 'unknown failure'}.`,
      );
    }
    if (attempt === maxPollAttempts) {
      throw new Error(
        `timeout: LlamaParse job ${jobId} did not finish after ${maxPollAttempts} polling attempts.`,
      );
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`timeout: LlamaParse job ${jobId} did not finish.`);
}

function makeRequest(input: {
  pages: number[];
  tier: LlamaParseTier;
  version: string;
  disableCache: boolean;
}): LlamaParseRequest {
  return {
    tier: input.tier,
    version: input.version,
    ...(pageRanges(input.pages) ? { page_ranges: pageRanges(input.pages) } : {}),
    disable_cache: input.disableCache,
    output_options: {
      markdown: {
        tables: {
          output_tables_as_markdown: true,
        },
      },
    },
    processing_options: {
      ocr_parameters: { languages: ['en'] },
    },
    processing_control: {
      timeouts: {
        base_in_seconds: 300,
        extra_time_per_page_in_seconds: 30,
      },
      job_failure_conditions: {
        allowed_page_failure_ratio: 0.01,
        fail_on_markdown_reconstruction_error: true,
      },
    },
    expand: [...LLAMAPARSE_EXPAND],
  };
}

export function estimatedLlamaParseCostUsd(pages: number[]): number | undefined {
  if (pages.length === 0) return undefined;
  return round(pages.length * costPerPageFromEnv());
}

export function createLlamaParseProvider(deps: LlamaParseProviderDeps = {}): PdfExtractionProvider {
  const now = deps.now ?? (() => new Date().toISOString());
  const sleep = deps.sleep ?? defaultSleep;
  const tier = deps.tier ?? tierFromEnv();
  const version = deps.version ?? versionFromEnv();
  const region = deps.region ?? process.env.LLAMAPARSE_REGION ?? LLAMAPARSE_DEFAULT_REGION;
  const disableCache = deps.disableCache ?? disableCacheFromEnv();
  const pollIntervalMs = deps.pollIntervalMs ?? 2_000;
  const maxPollAttempts = deps.maxPollAttempts ?? 150;
  const costPerPageUsd = deps.costPerPageUsd ?? costPerPageFromEnv();

  return {
    id: 'llamaparse',
    displayName: 'LlamaParse',
    version: LLAMAPARSE_PROVIDER_VERSION,
    async extract(input) {
      const startedAt = now();
      const startMs = Date.now();
      const sourceHash = await fileSha256(input.sourcePath);
      const providerConfigHash = llamaParseProviderConfigHash({
        tier,
        version,
        disableCache,
        costPerPageUsd,
      });
      const outputPath = rawOutputPath(input, sourceHash, providerConfigHash);
      await mkdir(dirname(outputPath), { recursive: true });
      const runtime = deps.runtime ?? (await createLlamaParseRestRuntime());

      try {
        const request = makeRequest({
          pages: input.pages,
          tier,
          version,
          disableCache,
        });
        const upload = await runtime.uploadFile({
          sourcePath: input.sourcePath,
          purpose: 'parse',
        });
        const start = await runtime.startParse({
          fileId: upload.fileId,
          request,
        });
        const { result, requestIds } = await collectResult(
          runtime,
          start.jobId,
          request.expand,
          maxPollAttempts,
          pollIntervalMs,
          sleep,
        );
        const selectedPages = normalizePages(result, input.pages);
        const completedAt = now();
        const pagesProcessed = selectedPages.length;
        const sourcePageCount = sourcePageCountFromResult(result, input.pages);
        const estimatedUsd = round(pagesProcessed * costPerPageUsd);
        const rawPayload = {
          fileId: upload.fileId,
          jobId: start.jobId,
          request,
          result,
        };
        const rawJson = `${JSON.stringify(rawPayload, null, 2)}\n`;
        await writeFile(outputPath, rawJson, 'utf8');
        const artifact = {
          schemaVersion: 'squire-pdf-extraction-v1',
          provider: 'llamaparse',
          providerVersion: LLAMAPARSE_PROVIDER_VERSION,
          providerConfigHash,
          source: {
            path: input.sourcePath,
            sha256: sourceHash,
            ...(sourcePageCount !== undefined ? { pageCount: sourcePageCount } : {}),
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
              'LlamaParse SaaS stores cached parse data for provider-defined retention; disable_cache can avoid result cache reuse, and raw outputs are persisted only in the configured eval output directory.',
            trainingUse: 'unknown',
            region,
          },
          providerMetadata: {
            tier,
            version,
            effectiveVersion:
              typeof result.job_metadata?.version === 'string'
                ? result.job_metadata.version
                : undefined,
            cacheHit:
              typeof result.job_metadata?.cache_hit === 'boolean'
                ? result.job_metadata.cache_hit
                : undefined,
            fileId: upload.fileId,
            jobId: start.jobId,
            requestIds: [upload.requestId, start.requestId, ...requestIds].filter(Boolean),
            expand: request.expand,
            pageRanges: request.page_ranges,
            disableCache,
            parsedPageCount: pagesProcessed,
            sourcePageCount,
            parseSettings: {
              outputOptions: request.output_options,
              processingControl: request.processing_control,
            },
            ocrSettings: {
              languages: request.processing_options.ocr_parameters.languages,
            },
            metadata: result.metadata,
            jobMetadata: result.job_metadata,
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
        throw llamaParseError(error);
      }
    },
  };
}
