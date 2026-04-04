/**
 * Extract structured data from Frosthaven card images using Claude vision.
 * Run with: npm run extract [card-type]
 * Card types: monster-stats, monster-abilities, character-abilities, items, events, battle-goals, buildings
 * Omit card-type to run all.
 *
 * Output: data/extracted/<card-type>.json
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { SCHEMAS } from './schemas.ts';
import type { CardType } from './schemas.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_BASE = join(__dirname, '..', 'data', 'worldhaven', 'images');
const OUTPUT_DIR = join(__dirname, '..', 'data', 'extracted');

// Rate limit: 10k output tokens/minute. ~200 tokens/card → max ~50/min.
// Sequential with 1.5s delay stays comfortably under.
const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 3;

const client = new Anthropic();

// ─── Card type definitions ───────────────────────────────────────────────────

interface CardTypeConfig {
  imageDir: string;
  filter: (f: string) => boolean;
  subdirs: boolean;
  context: string;
}

// Scenarios are imported from GHS data (not OCR-extracted), so they're excluded here.
type OcrCardType = Exclude<CardType, 'scenarios'>;

const CARD_TYPES: Record<OcrCardType, CardTypeConfig> = {
  'monster-stats': {
    imageDir: join(IMAGES_BASE, 'monster-stat-cards', 'frosthaven'),
    filter: (f) => f.endsWith('.png'),
    subdirs: false,
    context:
      'This is a Frosthaven monster stat card showing HP, Move, and Attack values for Normal and Elite difficulties across multiple levels.',
  },
  'monster-abilities': {
    imageDir: join(IMAGES_BASE, 'monster-ability-cards', 'frosthaven'),
    filter: (f) => f.endsWith('.png') && !f.endsWith('-back.png'),
    subdirs: true,
    context:
      'This is a Frosthaven monster ability card. Describe any icons as words (e.g. sword icon = "Attack", boot icon = "Move", heart = "Heal").',
  },
  'character-abilities': {
    imageDir: join(IMAGES_BASE, 'character-ability-cards', 'frosthaven'),
    filter: (f) => f.endsWith('.png') && !f.endsWith('-back.png'),
    subdirs: true,
    context:
      'This is a Frosthaven character ability card with a top action and a bottom action. Describe icons as words.',
  },
  items: {
    imageDir: join(IMAGES_BASE, 'items', 'frosthaven'),
    filter: (f) => f.endsWith('.png') && !f.endsWith('-back.png'),
    subdirs: true,
    context: 'This is a Frosthaven item card.',
  },
  events: {
    imageDir: join(IMAGES_BASE, 'events', 'frosthaven'),
    filter: (f) => f.endsWith('.png'),
    subdirs: true,
    context:
      'This is a Frosthaven event card (road, outpost, or boat). Extract the full flavor text and both options with their complete outcomes.',
  },
  'battle-goals': {
    imageDir: join(IMAGES_BASE, 'battle-goals', 'frosthaven'),
    filter: (f) => f.endsWith('.png') && !f.endsWith('-back.png'),
    subdirs: false,
    context: 'This is a Frosthaven battle goal card.',
  },
  buildings: {
    imageDir: join(IMAGES_BASE, 'outpost-building-cards', 'frosthaven'),
    filter: (f) => f.endsWith('.png') && !f.endsWith('-back.png'),
    subdirs: false,
    context: 'This is a Frosthaven outpost building card.',
  },
};

// Pre-generate prompts from Zod schemas using Zod 4's built-in toJSONSchema
const PROMPTS: Record<string, string> = {};
for (const [type, config] of Object.entries(CARD_TYPES)) {
  const jsonSchema = z.toJSONSchema(SCHEMAS[type as CardType]);
  delete (jsonSchema as Record<string, unknown>).$schema;
  PROMPTS[type] =
    `${config.context}\n\nExtract all data and return ONLY valid JSON matching this schema:\n${JSON.stringify(jsonSchema, null, 2)}`;
}

// ─── Filename-based number extraction ────────────────────────────────────────
// OCR frequently misreads card numbers. Filenames encode the correct number,
// so we parse it from the filename and override the OCR value.

const FILENAME_NUMBER_PATTERNS: Partial<Record<CardType, RegExp>> = {
  // fh-sre-01-f.png, fh-woe-35-b.png, fh-be-01-f.png
  events: /^fh-(?:sre|wre|soe|woe|be)-(\d+)-[fb]\.png$/,
  // fh-001-spyglass.png, fh-142-boots-of-quickness.png
  items: /^fh-(\d+)-/,
  // fh-39-jeweler-level-2.png, fh-05-mining-camp-level-1.png
  buildings: /^fh-(\d+)-/,
};

export function extractNumberFromFilename(filename: string, cardType: CardType): string | null {
  const pattern = FILENAME_NUMBER_PATTERNS[cardType];
  if (!pattern) return null;
  const match = filename.match(pattern);
  return match ? match[1] : null;
}

// ─── Image collection ─────────────────────────────────────────────────────────

export function collectImages(cardType: OcrCardType): string[] {
  const config = CARD_TYPES[cardType];
  const images: string[] = [];

  function scanDir(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && config.subdirs) scanDir(join(dir, entry.name));
      else if (entry.isFile() && config.filter(entry.name)) images.push(join(dir, entry.name));
    }
  }

  scanDir(config.imageDir);
  return images;
}

// ─── Extraction ───────────────────────────────────────────────────────────────

interface ExtractedResult extends Record<string, unknown> {
  _file?: string;
  _path?: string;
  _validationErrors?: string[];
  _error?: string;
}

export function extractJson(text: string): unknown {
  let s = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

export async function extractImage(
  imagePath: string,
  cardType: CardType,
): Promise<ExtractedResult> {
  const imageData = readFileSync(imagePath).toString('base64');
  const prompt = PROMPTS[cardType];
  const schema = SCHEMAS[cardType];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: imageData },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      });

      const block = response.content[0];
      const raw = block.type === 'text' ? block.text.trim() : '';
      const parsed = extractJson(raw) as Record<string, unknown>;

      // Validate against Zod schema
      const result = schema.safeParse(parsed);
      if (!result.success) {
        // Return data anyway but flag validation issues
        return {
          ...parsed,
          _validationErrors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        };
      }

      return result.data as ExtractedResult;
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      const isRateLimit = error.status === 429 || error.message?.includes('rate_limit');
      if (isRateLimit && attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt + 1) * REQUEST_DELAY_MS;
        process.stdout.write(` [rate limit, ${delay / 1000}s wait]`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  // Should not reach here, but satisfy TypeScript
  throw new Error('Max retries exceeded');
}

// ─── Per-type runner ──────────────────────────────────────────────────────────

export async function extractCardType(cardType: OcrCardType): Promise<ExtractedResult[]> {
  const outputPath = join(OUTPUT_DIR, `${cardType}.json`);

  const existing: ExtractedResult[] = existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, 'utf-8'))
    : [];

  // Only skip records that fully succeeded (no error, no parse error)
  const succeeded = existing.filter((r) => !r._error);
  const processedFiles = new Set(succeeded.map((r) => r._file));

  const images = collectImages(cardType);
  const pending = images.filter((p) => !processedFiles.has(basename(p)));

  const errCount = existing.length - succeeded.length;
  console.log(
    `\n[${cardType}] ${images.length} images — ${succeeded.length} succeeded, ${errCount} retrying, ${pending.length} pending`,
  );

  if (pending.length === 0) {
    console.log('  All done.');
    return succeeded;
  }

  let done = 0;
  const results = [...succeeded];

  for (const imagePath of pending) {
    try {
      const extracted = await extractImage(imagePath, cardType);
      extracted._file = basename(imagePath);
      extracted._path = imagePath;

      // Override OCR number with filename-derived number (more reliable)
      const fileNumber = extractNumberFromFilename(basename(imagePath), cardType);
      if (fileNumber !== null) {
        if (cardType === 'events' || cardType === 'items') {
          extracted.number = fileNumber;
        }
        if (cardType === 'buildings') {
          extracted.buildingNumber = fileNumber;
        }
      }

      if (extracted._validationErrors?.length) {
        process.stdout.write(` [validation: ${extracted._validationErrors.length} issues]`);
      }
      results.push(extracted);
    } catch (err: unknown) {
      const error = err as { message?: string };
      results.push({
        _file: basename(imagePath),
        _path: imagePath,
        _error: error.message || 'Unknown error',
      });
      process.stdout.write(' [err]');
    }
    done++;
    process.stdout.write(`\r  ${done}/${pending.length}`);
    if (done % 20 === 0) saveResults(outputPath, results);
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  console.log();
  saveResults(outputPath, results);
  return results;
}

function saveResults(path: string, results: ExtractedResult[]): void {
  writeFileSync(path, JSON.stringify(results, null, 2), 'utf-8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const arg = process.argv[2] as OcrCardType | undefined;
  const types: OcrCardType[] = arg ? [arg] : (Object.keys(CARD_TYPES) as OcrCardType[]);

  const unknown = types.filter((t) => !CARD_TYPES[t as OcrCardType]);
  if (unknown.length) {
    console.error(`Unknown card type(s): ${unknown.join(', ')}`);
    console.error(`Valid: ${Object.keys(CARD_TYPES).join(', ')}`);
    process.exit(1);
  }

  for (const cardType of types) {
    await extractCardType(cardType);
  }

  console.log('\nExtraction complete.');
}

if (process.argv[1]?.endsWith('extract-card-data.ts')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
