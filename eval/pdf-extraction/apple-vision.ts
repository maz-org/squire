import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { PdfExtractionProvider, PdfExtractionRunInput } from './provider.ts';
import {
  computeProviderConfigHash,
  validateExtractionArtifact,
  type ExtractionArtifact,
  type ExtractionBlock,
  type ExtractionPage,
} from './schema.ts';

const execFileAsync = promisify(execFile);

export const APPLE_VISION_PROVIDER_VERSION = 'macos-vision-ocr-markdown-v1';
export const APPLE_VISION_SCRIPT_PATH = 'scripts/ocr-pdf-apple-vision.swift';
export const APPLE_VISION_PROVIDER_CONFIG = {
  scriptPath: APPLE_VISION_SCRIPT_PATH,
  output: 'markdown-page-sections-v1',
  pageSize: { width: 612, height: 792, unit: 'pt' },
};
export const APPLE_VISION_PROVIDER_CONFIG_HASH = computeProviderConfigHash(
  APPLE_VISION_PROVIDER_CONFIG,
);

interface AppleVisionOcrRunInput {
  sourcePath: string;
  outputPath: string;
  scriptPath: string;
  timeoutMs?: number;
}

export interface AppleVisionProviderDeps {
  runOcr?: (input: AppleVisionOcrRunInput) => Promise<void>;
  now?: () => string;
}

interface ParsedAppleVisionPage {
  pageNumber: number;
  lines: string[];
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

function rawOutputPath(input: PdfExtractionRunInput, sourceHash: string): string {
  return `${input.outputDir}/raw/apple-vision/${sourceHash.slice(7)}/${APPLE_VISION_PROVIDER_CONFIG_HASH.slice(7)}/${safePathSegment(input.runLabel)}.md`;
}

async function runAppleVisionOcr(input: AppleVisionOcrRunInput): Promise<void> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const scriptPath = isAbsolute(input.scriptPath)
    ? input.scriptPath
    : resolve(moduleDir, '..', '..', input.scriptPath);
  await execFileAsync('swift', [scriptPath, input.sourcePath, input.outputPath], {
    timeout: input.timeoutMs,
    maxBuffer: 1024 * 1024 * 128,
  });
}

function parseAppleVisionMarkdown(markdown: string): ParsedAppleVisionPage[] {
  const pages: ParsedAppleVisionPage[] = [];
  const pageHeadingPattern = /^## Page (\d+)\s*$/gm;
  const matches = [...markdown.matchAll(pageHeadingPattern)];

  for (const [index, match] of matches.entries()) {
    const pageNumber = Number(match[1]);
    const contentStart = match.index! + match[0].length;
    const nextMatch = matches[index + 1];
    const contentEnd = nextMatch?.index ?? markdown.length;
    const lines = markdown
      .slice(contentStart, contentEnd)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    pages.push({ pageNumber, lines });
  }

  return pages;
}

function isLikelyHeading(line: string, index: number): boolean {
  if (index > 1) return false;
  if (/^\d+$/.test(line)) return false;
  if (line.length > 80) return false;
  return !/[.!?:;]$/.test(line);
}

function blockForLine(pageNumber: number, line: string, index: number): ExtractionBlock {
  return {
    id: `p${pageNumber}-b${index}`,
    type: /^\d+$/.test(line) ? 'page-number' : isLikelyHeading(line, index) ? 'heading' : 'line',
    order: index,
    text: line,
  };
}

function toExtractionPage(page: ParsedAppleVisionPage): ExtractionPage {
  const blocks = page.lines.map((line, index) => blockForLine(page.pageNumber, line, index));
  const text = page.lines.join('\n');
  const markdownLines = blocks.map((block) =>
    block.type === 'heading' ? `## ${block.text}` : block.text,
  );

  return {
    pageNumber: page.pageNumber,
    width: 612,
    height: 792,
    unit: 'pt',
    markdown: markdownLines.join('\n\n'),
    text,
    blocks,
    tables: [],
  };
}

function selectPages(
  pages: ParsedAppleVisionPage[],
  requestedPages: number[],
): ParsedAppleVisionPage[] {
  if (requestedPages.length === 0) return pages;
  const byPage = new Map(pages.map((page) => [page.pageNumber, page]));
  const selected: ParsedAppleVisionPage[] = [];
  for (const pageNumber of requestedPages) {
    const page = byPage.get(pageNumber);
    if (!page) {
      throw new Error(`partial page failure: Apple Vision output omitted page ${pageNumber}.`);
    }
    selected.push(page);
  }
  return selected;
}

export function createAppleVisionProvider(
  deps: AppleVisionProviderDeps = {},
): PdfExtractionProvider {
  const runOcr = deps.runOcr ?? runAppleVisionOcr;
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    id: 'apple-vision',
    displayName: 'Apple Vision',
    version: APPLE_VISION_PROVIDER_VERSION,
    async extract(input) {
      const startedAt = now();
      const startMs = Date.now();
      const sourceHash = await fileSha256(input.sourcePath);
      const outputPath = rawOutputPath(input, sourceHash);
      await mkdir(dirname(outputPath), { recursive: true });
      await runOcr({
        sourcePath: input.sourcePath,
        outputPath,
        scriptPath: APPLE_VISION_SCRIPT_PATH,
        timeoutMs: input.timeoutMs,
      });

      const rawMarkdown = await readFile(outputPath, 'utf8');
      const parsedPages = parseAppleVisionMarkdown(rawMarkdown);
      if (parsedPages.length === 0) {
        throw new Error('partial page failure: Apple Vision output contained no page sections.');
      }
      const selectedPages = selectPages(parsedPages, input.pages).map(toExtractionPage);
      const completedAt = now();
      const rawHash = sha256(rawMarkdown);
      const artifact = {
        schemaVersion: 'squire-pdf-extraction-v1',
        provider: 'apple-vision',
        providerVersion: APPLE_VISION_PROVIDER_VERSION,
        providerConfigHash: APPLE_VISION_PROVIDER_CONFIG_HASH,
        source: {
          path: input.sourcePath,
          sha256: sourceHash,
          pageCount: Math.max(...parsedPages.map((page) => page.pageNumber)),
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
          estimatedUsd: 0,
          actualUsd: 0,
          pagesProcessed: selectedPages.length,
          costPerPageUsd: 0,
        },
        privacy: {
          retentionPolicy:
            'local macOS Vision OCR output is retained only in the configured eval output directory',
          trainingUse: 'not-used-for-training',
        },
        rawArtifacts: [
          {
            kind: 'provider-markdown',
            path: outputPath,
            sha256: rawHash,
            redacted: false,
            persisted: true,
          },
        ],
        pages: selectedPages,
      } satisfies ExtractionArtifact;

      return validateExtractionArtifact(artifact);
    },
  };
}
