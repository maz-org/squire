import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { runPdfExtractionEval } from '../eval/pdf-extraction/run.ts';
import type { ExtractionArtifact } from '../eval/pdf-extraction/schema.ts';

const DEFAULT_SOURCE_PATH = 'data/pdfs/gh2-rule-book.pdf';
const DEFAULT_OUTPUT_PATH = 'data/rule-sources/gh2-rule-book.md';
const DEFAULT_METADATA_PATH = 'data/rule-sources/metadata.json';
const DEFAULT_OUTPUT_DIR = 'eval/results/pdf-extraction';
const DEFAULT_SOURCE_URL =
  'https://drive.google.com/file/d/16TmmCKa6zVVObj2qM-vIj9RcEAC3nfMT/view?usp=sharing';
const FALLBACK_REFRESH_COMMAND = [
  'swift scripts/ocr-pdf-apple-vision.swift',
  DEFAULT_SOURCE_PATH,
  DEFAULT_OUTPUT_PATH,
  DEFAULT_SOURCE_URL,
  '<capture-date>',
].join(' ');

interface RuleSourceMetadata {
  id: string;
  file: string;
  normalizedFile?: string;
  game: string;
  sourceType: string;
  sourceUrl: string;
  capturedAt: string;
  sourceLastUpdated?: string;
  refreshNotes: string;
  extractionProvider?: string;
  extractionProviderVersion?: string;
  extractionProviderConfigHash?: string;
  extractionRunId?: string;
  extractionRunStartedAt?: string;
  extractionRunCompletedAt?: string;
  extractionManifestPath?: string;
  extractionReportPath?: string;
  normalizedArtifactPath?: string;
  normalizedArtifactHash?: string;
  normalizedFileHash?: string;
  sourceHash?: string;
  fallbackExtractionProvider?: string;
  fallbackRefreshCommand?: string;
}

export interface Gh2RulebookRefreshOptions {
  sourcePath: string;
  outputPath: string;
  metadataPath: string;
  outputDir: string;
  runLabel: string;
  maxEstimatedCostUsd: number;
  timeoutMs: number;
  refreshProviderOutput: boolean;
  capturedAt?: string;
}

export interface Gh2RulebookRefreshResult {
  outputPath: string;
  metadataPath: string;
  manifestPath: string;
  reportPath: string;
  normalizedArtifactPath: string;
  normalizedArtifactHash: string;
  normalizedFileHash: string;
  sourceHash: string;
  runId: string;
}

export interface Gh2RulebookPromotionInput {
  artifact: ExtractionArtifact;
  outputPath: string;
  metadataPath: string;
  capturedAt?: string;
  manifestPath: string;
  reportPath: string;
  normalizedArtifactPath: string;
  normalizedArtifactHash: string;
}

function valueFor(args: readonly string[], prefix: string): string | undefined {
  const arg = args.find((candidate) => candidate.startsWith(prefix));
  if (!arg) return undefined;
  const value = arg.slice(prefix.length);
  if (!value) throw new Error(`Invalid ${prefix.slice(0, -1)}: value cannot be empty.`);
  return value;
}

function parsePositiveInteger(args: readonly string[], prefix: string, fallback: number): number {
  const raw = valueFor(args, prefix);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: expected a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeNumber(args: readonly string[], prefix: string, fallback: number): number {
  const raw = valueFor(args, prefix);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: expected a non-negative number.`);
  }
  return parsed;
}

function rejectUnknownFlags(args: readonly string[]): void {
  const supportedPrefixes = [
    '--source=',
    '--output=',
    '--metadata=',
    '--output-dir=',
    '--run-label=',
    '--capture-date=',
    '--max-estimated-cost-usd=',
    '--timeout-ms=',
  ];
  const supportedLiterals = new Set(['--refresh-provider-output']);

  for (const arg of args) {
    if (!arg.startsWith('--')) continue;
    if (supportedLiterals.has(arg)) continue;
    if (supportedPrefixes.some((prefix) => arg.startsWith(prefix))) continue;
    throw new Error(`Unknown argument: ${arg}.`);
  }
}

export function parseGh2RulebookRefreshArgs(args: readonly string[]): Gh2RulebookRefreshOptions {
  rejectUnknownFlags(args);
  const runLabel =
    valueFor(args, '--run-label=') ??
    `marker-datalab-gh2-rulebook-refresh-${new Date().toISOString()}`;

  return {
    sourcePath: valueFor(args, '--source=') ?? DEFAULT_SOURCE_PATH,
    outputPath: valueFor(args, '--output=') ?? DEFAULT_OUTPUT_PATH,
    metadataPath: valueFor(args, '--metadata=') ?? DEFAULT_METADATA_PATH,
    outputDir: valueFor(args, '--output-dir=') ?? DEFAULT_OUTPUT_DIR,
    runLabel,
    maxEstimatedCostUsd: parseNonNegativeNumber(args, '--max-estimated-cost-usd=', 0.5),
    timeoutMs: parsePositiveInteger(args, '--timeout-ms=', 1_800_000),
    refreshProviderOutput: args.includes('--refresh-provider-output'),
    capturedAt: valueFor(args, '--capture-date='),
  };
}

function sha256Text(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function captureDateFor(artifact: ExtractionArtifact, override?: string): string {
  if (override) return override;
  const completedAt = artifact.run.completedAt ?? artifact.run.startedAt;
  return completedAt.slice(0, 10);
}

function assertMarkerDatalabFullRulebookArtifact(artifact: ExtractionArtifact): void {
  if (artifact.provider !== 'marker-datalab') {
    throw new Error(`Expected Marker/Datalab artifact, got ${artifact.provider}.`);
  }
  if (artifact.run.status !== 'succeeded') {
    throw new Error(`Expected succeeded Marker/Datalab artifact, got ${artifact.run.status}.`);
  }
  if (artifact.run.pageRange && artifact.run.pageRange.length > 0) {
    throw new Error('Expected full-rulebook Marker/Datalab artifact, got selected pages.');
  }
  if (
    artifact.source.pageCount !== undefined &&
    artifact.pages.length !== artifact.source.pageCount
  ) {
    throw new Error(
      `Expected ${artifact.source.pageCount} full-rulebook page(s), got ${artifact.pages.length}.`,
    );
  }
}

function pageMarkdown(page: ExtractionArtifact['pages'][number]): string {
  const markdown = page.markdown.trim();
  const text = markdown || page.text.trim();
  return text.replace(/^(#{1,6})\s+(#{1,6})\s+/gm, '$2 ').replace(/[ \t]+$/gm, '');
}

export function buildGh2RulebookMarkdown(input: {
  artifact: ExtractionArtifact;
  capturedAt?: string;
  normalizedArtifactHash: string;
  manifestPath: string;
  reportPath: string;
}): string {
  assertMarkerDatalabFullRulebookArtifact(input.artifact);
  const capturedAt = captureDateFor(input.artifact, input.capturedAt);
  const pages = [...input.artifact.pages].sort((left, right) => left.pageNumber - right.pageNumber);
  const pageSections = pages
    .map((page) => `## Page ${page.pageNumber}\n\n${pageMarkdown(page)}`)
    .join('\n\n');

  return `${[
    '# Gloomhaven (2nd Edition) Rulebook Text Snapshot',
    '',
    `Source PDF: ${input.artifact.source.path}`,
    `Official source URL: ${DEFAULT_SOURCE_URL}`,
    `Captured: ${capturedAt}`,
    `Provider: Marker/Datalab (${input.artifact.providerVersion})`,
    `Provider config hash: ${input.artifact.providerConfigHash}`,
    `Source SHA-256: ${input.artifact.source.sha256}`,
    `Normalized artifact SHA-256: ${input.normalizedArtifactHash}`,
    `Extraction manifest: ${input.manifestPath}`,
    `Extraction report: ${input.reportPath}`,
    '',
    'This normalized text snapshot was generated from the official image-based PDF with Marker/Datalab so Squire can index the Gloomhaven (2nd Edition) rulebook for retrieval and citation. Apple Vision remains the local fallback extraction path.',
    '',
    pageSections,
  ].join('\n')}\n`;
}

async function updateMetadata(input: {
  metadataPath: string;
  artifact: ExtractionArtifact;
  capturedAt?: string;
  manifestPath: string;
  reportPath: string;
  normalizedArtifactPath: string;
  normalizedArtifactHash: string;
  normalizedFileHash: string;
}): Promise<void> {
  const raw = await readFile(input.metadataPath, 'utf8');
  const metadata = JSON.parse(raw) as RuleSourceMetadata[];
  const rulebook = metadata.find((entry) => entry.id === 'gh2-rule-book');
  if (!rulebook) {
    throw new Error('data/rule-sources/metadata.json is missing gh2-rule-book metadata.');
  }

  rulebook.file = DEFAULT_SOURCE_PATH;
  rulebook.normalizedFile = DEFAULT_OUTPUT_PATH;
  rulebook.game = 'gloomhaven-2e';
  rulebook.sourceType = 'rulebook';
  rulebook.sourceUrl = DEFAULT_SOURCE_URL;
  rulebook.capturedAt = captureDateFor(input.artifact, input.capturedAt);
  rulebook.refreshNotes =
    'Official Gloomhaven (2nd Edition) rulebook linked from the Cephalofair Gloomhaven page. The linked PDF is image-based, so indexing uses the normalized Marker/Datalab text snapshot in data/rule-sources/gh2-rule-book.md. Refresh with npm run rulebook:refresh:gh2, review the table of contents and page 30, then run SQUIRE_INDEX_GAME=gloomhaven-2e npm run index. Apple Vision remains the local fallback extraction path.';
  rulebook.extractionProvider = input.artifact.provider;
  rulebook.extractionProviderVersion = input.artifact.providerVersion;
  rulebook.extractionProviderConfigHash = input.artifact.providerConfigHash;
  rulebook.extractionRunId = input.artifact.run.id;
  rulebook.extractionRunStartedAt = input.artifact.run.startedAt;
  rulebook.extractionRunCompletedAt = input.artifact.run.completedAt;
  rulebook.extractionManifestPath = input.manifestPath;
  rulebook.extractionReportPath = input.reportPath;
  rulebook.normalizedArtifactPath = input.normalizedArtifactPath;
  rulebook.normalizedArtifactHash = input.normalizedArtifactHash;
  rulebook.normalizedFileHash = input.normalizedFileHash;
  rulebook.sourceHash = input.artifact.source.sha256;
  rulebook.fallbackExtractionProvider = 'apple-vision';
  rulebook.fallbackRefreshCommand = FALLBACK_REFRESH_COMMAND;

  await writeFile(input.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

export async function refreshGh2RulebookSource(
  options: Gh2RulebookRefreshOptions,
): Promise<Gh2RulebookRefreshResult> {
  const extraction = await runPdfExtractionEval({
    provider: 'marker-datalab',
    sourcePath: options.sourcePath,
    pages: [],
    outputDir: options.outputDir,
    runLabel: options.runLabel,
    retryCount: 0,
    allowFullRulebook: true,
    allowEstimatedCostOverride: false,
    maxEstimatedCostUsd: options.maxEstimatedCostUsd,
    providerConcurrency: 1,
    refreshProviderOutput: options.refreshProviderOutput,
    timeoutMs: options.timeoutMs,
  });

  const promotion = await promoteGh2RulebookArtifact({
    artifact: extraction.artifact,
    outputPath: options.outputPath,
    metadataPath: options.metadataPath,
    capturedAt: options.capturedAt,
    manifestPath: extraction.manifestPath,
    reportPath: extraction.reportPath,
    normalizedArtifactPath: extraction.manifest.normalizedArtifactPath,
    normalizedArtifactHash: extraction.manifest.normalizedArtifactHash,
  });

  return {
    outputPath: options.outputPath,
    metadataPath: options.metadataPath,
    manifestPath: extraction.manifestPath,
    reportPath: extraction.reportPath,
    normalizedArtifactPath: extraction.manifest.normalizedArtifactPath,
    normalizedArtifactHash: extraction.manifest.normalizedArtifactHash,
    normalizedFileHash: promotion.normalizedFileHash,
    sourceHash: extraction.artifact.source.sha256,
    runId: extraction.artifact.run.id,
  };
}

export async function promoteGh2RulebookArtifact(
  input: Gh2RulebookPromotionInput,
): Promise<{ normalizedFileHash: string }> {
  const markdown = buildGh2RulebookMarkdown({
    artifact: input.artifact,
    capturedAt: input.capturedAt,
    normalizedArtifactHash: input.normalizedArtifactHash,
    manifestPath: input.manifestPath,
    reportPath: input.reportPath,
  });
  const normalizedFileHash = sha256Text(markdown);
  await writeFile(input.outputPath, markdown, 'utf8');
  await updateMetadata({
    metadataPath: input.metadataPath,
    artifact: input.artifact,
    capturedAt: input.capturedAt,
    manifestPath: input.manifestPath,
    reportPath: input.reportPath,
    normalizedArtifactPath: input.normalizedArtifactPath,
    normalizedArtifactHash: input.normalizedArtifactHash,
    normalizedFileHash,
  });
  return { normalizedFileHash };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  refreshGh2RulebookSource(parseGh2RulebookRefreshArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
