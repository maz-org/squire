import { PdfExtractionProviderIdSchema, type PdfExtractionProviderId } from './schema.ts';

export interface PdfExtractionCliOptions {
  provider: PdfExtractionProviderId;
  sourcePath: string;
  pages: number[];
  outputDir: string;
  runLabel: string;
  retryCount: number;
  allowFullRulebook: boolean;
  allowEstimatedCostOverride: boolean;
  maxEstimatedCostUsd: number;
  providerConcurrency: number;
  refreshProviderOutput: boolean;
  timeoutMs: number;
}

function valueFor(args: string[], prefix: string): string | undefined {
  const arg = args.find((candidate) => candidate.startsWith(prefix));
  if (!arg) return undefined;
  const value = arg.slice(prefix.length);
  if (value.length === 0) throw new Error(`Invalid ${prefix.slice(0, -1)}: value cannot be empty.`);
  return value;
}

function parseProvider(args: string[]): PdfExtractionProviderId {
  const raw = valueFor(args, '--provider=') ?? 'apple-vision';
  const parsed = PdfExtractionProviderIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid --provider: ${raw}. Expected one of ${PdfExtractionProviderIdSchema.options.join(', ')}.`,
    );
  }
  return parsed.data;
}

function parsePages(raw: string | undefined): number[] {
  if (!raw) return [];
  const pages = raw.split(',').map((value) => {
    const page = Number(value.trim());
    if (!Number.isInteger(page) || page <= 0) {
      throw new Error(`Invalid --pages: expected positive page numbers, got "${value}".`);
    }
    return page;
  });
  return [...new Set(pages)];
}

function parseNonNegativeInteger(args: string[], prefix: string, fallback: number): number {
  const raw = valueFor(args, prefix);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: expected a non-negative integer.`);
  }
  return parsed;
}

function parsePositiveInteger(args: string[], prefix: string, fallback: number): number {
  const raw = valueFor(args, prefix);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: expected a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeNumber(args: string[], prefix: string, fallback: number): number {
  const raw = valueFor(args, prefix);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: expected a non-negative number.`);
  }
  return parsed;
}

function rejectUnknownFlags(args: string[]): void {
  const supportedPrefixes = [
    '--provider=',
    '--source=',
    '--pages=',
    '--output-dir=',
    '--run-label=',
    '--retry-count=',
    '--max-estimated-cost-usd=',
    '--provider-concurrency=',
    '--timeout-ms=',
  ];
  const supportedLiterals = new Set([
    '--allow-full-rulebook',
    '--allow-estimated-cost',
    '--refresh-provider-output',
  ]);

  for (const arg of args) {
    if (!arg.startsWith('--')) continue;
    const isKnownPrefix = supportedPrefixes.some((prefix) => arg.startsWith(prefix));
    const isKnownLiteral = supportedLiterals.has(arg);
    if (!isKnownPrefix && !isKnownLiteral) {
      throw new Error(`Unknown argument: ${arg}.`);
    }
  }
}

export function parsePdfExtractionArgs(args: string[]): PdfExtractionCliOptions {
  rejectUnknownFlags(args);

  const provider = parseProvider(args);
  const sourcePath = valueFor(args, '--source=');
  if (!sourcePath) throw new Error('Missing --source.');

  const allowFullRulebook = args.includes('--allow-full-rulebook');
  const pages = parsePages(valueFor(args, '--pages='));
  if (pages.length === 0 && !allowFullRulebook) {
    throw new Error('Selected pages are required unless --allow-full-rulebook is set.');
  }

  return {
    provider,
    sourcePath,
    pages,
    outputDir: valueFor(args, '--output-dir=') ?? 'eval/results/pdf-extraction',
    runLabel: valueFor(args, '--run-label=') ?? `pdf-extraction-${new Date().toISOString()}`,
    retryCount: parseNonNegativeInteger(args, '--retry-count=', 0),
    allowFullRulebook,
    allowEstimatedCostOverride: args.includes('--allow-estimated-cost'),
    maxEstimatedCostUsd: parseNonNegativeNumber(args, '--max-estimated-cost-usd=', 1),
    providerConcurrency: parsePositiveInteger(args, '--provider-concurrency=', 1),
    refreshProviderOutput: args.includes('--refresh-provider-output'),
    timeoutMs: parsePositiveInteger(args, '--timeout-ms=', 120_000),
  };
}
