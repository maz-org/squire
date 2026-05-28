import { PdfExtractionProviderIdSchema, type PdfExtractionProviderId } from './schema.ts';

export interface PdfExtractionCliOptions {
  provider: PdfExtractionProviderId;
  sourcePath: string;
  pages: number[];
  outputDir: string;
  runLabel: string;
  retryCount: number;
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

export function parsePdfExtractionArgs(args: string[]): PdfExtractionCliOptions {
  if (args.includes('--allow-full-rulebook')) {
    throw new Error('Full-rulebook provider runs are implemented by SQR-250.');
  }
  if (args.some((arg) => arg.startsWith('--max-estimated-cost-usd='))) {
    throw new Error('Cost guardrails are implemented by SQR-250.');
  }

  const provider = parseProvider(args);
  const sourcePath = valueFor(args, '--source=');
  if (!sourcePath) throw new Error('Missing --source.');

  const pages = parsePages(valueFor(args, '--pages='));
  if (pages.length === 0) {
    throw new Error('Selected pages are required until the guarded full-rulebook runner exists.');
  }

  return {
    provider,
    sourcePath,
    pages,
    outputDir: valueFor(args, '--output-dir=') ?? 'eval/results/pdf-extraction',
    runLabel: valueFor(args, '--run-label=') ?? `pdf-extraction-${new Date().toISOString()}`,
    retryCount: parseNonNegativeInteger(args, '--retry-count=', 0),
  };
}
