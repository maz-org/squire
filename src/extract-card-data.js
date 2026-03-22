/**
 * Extract structured data from Frosthaven card images using Claude vision.
 * Run with: npm run extract [card-type]
 * Card types: monster-stats, monster-abilities, character-abilities, items, events, battle-goals, buildings
 * Omit card-type to run all.
 *
 * Output: data/extracted/<card-type>.json
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { SCHEMAS } from './schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_BASE = join(__dirname, '..', 'data', 'worldhaven', 'images');
const OUTPUT_DIR = join(__dirname, '..', 'data', 'extracted');

// Rate limit: 10k output tokens/minute. ~200 tokens/card → max ~50/min.
// Sequential with 1.5s delay stays comfortably under.
const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 3;

const client = new Anthropic();

// ─── Card type definitions ───────────────────────────────────────────────────

const CARD_TYPES = {
  'monster-stats': {
    imageDir: join(IMAGES_BASE, 'monster-stat-cards', 'frosthaven'),
    filter: (f) => f.endsWith('.png'),
    subdirs: false,
    context:
      'This is a Frosthaven monster stat card showing HP, Move, Attack, and Range values for Normal and Elite difficulties across multiple levels.',
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
const PROMPTS = {};
for (const [type, config] of Object.entries(CARD_TYPES)) {
  const jsonSchema = z.toJSONSchema(SCHEMAS[type]);
  delete jsonSchema.$schema;
  PROMPTS[type] =
    `${config.context}\n\nExtract all data and return ONLY valid JSON matching this schema:\n${JSON.stringify(jsonSchema, null, 2)}`;
}

// ─── Image collection ─────────────────────────────────────────────────────────

function collectImages(cardType) {
  const config = CARD_TYPES[cardType];
  const images = [];

  function scanDir(dir) {
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

function extractJson(text) {
  let s = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

async function extractImage(imagePath, cardType) {
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

      const raw = response.content[0].text.trim();
      const parsed = extractJson(raw);

      // Validate against Zod schema
      const result = schema.safeParse(parsed);
      if (!result.success) {
        // Return data anyway but flag validation issues
        return {
          ...parsed,
          _validationErrors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        };
      }

      return result.data;
    } catch (err) {
      const isRateLimit = err.status === 429 || err.message?.includes('rate_limit');
      if (isRateLimit && attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt + 1) * REQUEST_DELAY_MS;
        process.stdout.write(` [rate limit, ${delay / 1000}s wait]`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// ─── Per-type runner ──────────────────────────────────────────────────────────

async function extractCardType(cardType) {
  const outputPath = join(OUTPUT_DIR, `${cardType}.json`);

  const existing = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, 'utf-8')) : [];

  // Only skip records that fully succeeded (no error, no parse error)
  const succeeded = existing.filter((r) => !r._error && !r._parseError);
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
      if (extracted._validationErrors?.length) {
        process.stdout.write(` [validation: ${extracted._validationErrors.length} issues]`);
      }
      results.push(extracted);
    } catch (err) {
      results.push({ _file: basename(imagePath), _path: imagePath, _error: err.message });
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

function saveResults(path, results) {
  writeFileSync(path, JSON.stringify(results, null, 2), 'utf-8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const arg = process.argv[2];
  const types = arg ? [arg] : Object.keys(CARD_TYPES);

  const unknown = types.filter((t) => !CARD_TYPES[t]);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
