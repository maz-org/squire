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

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_BASE = join(__dirname, '..', 'data', 'worldhaven', 'images');
const OUTPUT_DIR = join(__dirname, '..', 'data', 'extracted');

// Rate limit: 10k output tokens/minute. ~200 tokens/card → max ~50/min.
// Sequential with 1.5s delay keeps us comfortably under.
const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 3;

const client = new Anthropic();

// ─── Card type definitions ───────────────────────────────────────────────────

const CARD_TYPES = {
  'monster-stats': {
    imageDir: join(IMAGES_BASE, 'monster-stat-cards', 'frosthaven'),
    filter: (f) => f.endsWith('.png'),
    subdirs: false,
    prompt: `This is a Frosthaven monster stat card. Extract ALL data and return ONLY valid JSON with this schema:
{
  "name": "monster name",
  "levelRange": "0-3" or "4-7",
  "normal": {
    "0": { "move": N, "attack": N, "range": N, "hp": N },
    "1": { "move": N, "attack": N, "range": N, "hp": N }
  },
  "elite": {
    "0": { "move": N, "attack": N, "range": N, "hp": N }
  },
  "immunities": ["poison", "wound"],
  "notes": "any special rules text visible on the card"
}
Use null for stats shown as dashes. Include one entry per visible level column.`,
  },

  'monster-abilities': {
    imageDir: join(IMAGES_BASE, 'monster-ability-cards', 'frosthaven'),
    filter: (f) => f.endsWith('.png') && !f.endsWith('-back.png'),
    subdirs: true,
    prompt: `This is a Frosthaven monster ability card. Return ONLY valid JSON:
{
  "monsterType": "monster deck name",
  "cardName": "card name",
  "initiative": N,
  "abilities": ["full text of each ability line"]
}`,
  },

  'character-abilities': {
    imageDir: join(IMAGES_BASE, 'character-ability-cards', 'frosthaven'),
    filter: (f) => f.endsWith('.png') && !f.endsWith('-back.png'),
    subdirs: true,
    prompt: `This is a Frosthaven character ability card. Return ONLY valid JSON:
{
  "cardName": "name of the card",
  "characterClass": "class name if visible",
  "level": N,
  "initiative": N,
  "top": { "action": "primary action text", "effects": ["additional effect lines"] },
  "bottom": { "action": "primary action text", "effects": ["additional effect lines"] },
  "lost": true or false
}
Use null for any value not visible or not applicable.`,
  },

  'items': {
    imageDir: join(IMAGES_BASE, 'items', 'frosthaven'),
    filter: (f) => f.endsWith('.png') && !f.endsWith('-back.png'),
    subdirs: true,
    prompt: `This is a Frosthaven item card. Return ONLY valid JSON:
{
  "number": "item number as 3-digit string e.g. '099'",
  "name": "item name",
  "slot": "head" or "body" or "legs" or "one hand" or "two hands" or "small item",
  "cost": N,
  "effect": "full effect text",
  "uses": N or null,
  "spent": true or false,
  "lost": true or false
}`,
  },

  'events': {
    imageDir: join(IMAGES_BASE, 'events', 'frosthaven'),
    filter: (f) => f.endsWith('.png'),
    subdirs: true,
    prompt: `This is a Frosthaven event card. Return ONLY valid JSON:
{
  "eventType": "road" or "outpost" or "boat",
  "season": "summer" or "winter" or null,
  "number": "event number as string",
  "flavorText": "the story/flavor text",
  "optionA": { "text": "choice A text", "outcome": "outcome text for choice A" },
  "optionB": { "text": "choice B text", "outcome": "outcome text for choice B" }
}
Omit optionB if there is no choice. Keep outcome text complete and verbatim.`,
  },

  'battle-goals': {
    imageDir: join(IMAGES_BASE, 'battle-goals', 'frosthaven'),
    filter: (f) => f.endsWith('.png') && !f.endsWith('-back.png'),
    subdirs: false,
    prompt: `This is a Frosthaven battle goal card. Return ONLY valid JSON:
{
  "name": "battle goal name",
  "condition": "full text of the goal condition",
  "checkmarks": N
}`,
  },

  'buildings': {
    imageDir: join(IMAGES_BASE, 'outpost-building-cards', 'frosthaven'),
    filter: (f) => f.endsWith('.png') && !f.endsWith('-back.png'),
    subdirs: false,
    prompt: `This is a Frosthaven outpost building card. Return ONLY valid JSON:
{
  "buildingNumber": "building number as string",
  "name": "building name",
  "level": N,
  "buildCost": { "gold": N, "lumber": N, "metal": N, "hide": N },
  "effect": "full effect/ability text",
  "notes": "any other relevant text"
}
Use null for cost resources not required.`,
  },
};

// ─── Core extraction ──────────────────────────────────────────────────────────

function collectImages(cardType) {
  const config = CARD_TYPES[cardType];
  const images = [];

  function scanDir(dir) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && config.subdirs) {
        scanDir(join(dir, entry.name));
      } else if (entry.isFile() && config.filter(entry.name)) {
        images.push(join(dir, entry.name));
      }
    }
  }

  scanDir(config.imageDir);
  return images;
}

function extractJson(text) {
  // Strip markdown code fences
  let s = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  // Find outermost JSON object
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
}

async function extractImage(imagePath, prompt) {
  const imageData = readFileSync(imagePath).toString('base64');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData } },
            { type: 'text', text: prompt },
          ],
        }],
      });

      const text = response.content[0].text.trim();
      return extractJson(text);

    } catch (err) {
      const isRateLimit = err.status === 429 || (err.message && err.message.includes('rate_limit'));
      if (isRateLimit && attempt < MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt + 1) * REQUEST_DELAY_MS;
        process.stdout.write(` [rate limited, waiting ${delay / 1000}s]`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function extractCardType(cardType) {
  const config = CARD_TYPES[cardType];
  const outputPath = join(OUTPUT_DIR, `${cardType}.json`);

  const existing = existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, 'utf-8'))
    : [];

  // Retry errored records alongside unprocessed ones
  const succeeded = existing.filter((r) => !r._error && !r._parseError);
  const processedFiles = new Set(succeeded.map((r) => r._file));

  const images = collectImages(cardType);
  const pending = images.filter((p) => !processedFiles.has(basename(p)));

  console.log(`\n[${cardType}] ${images.length} images, ${succeeded.length} succeeded, ${pending.length} to process`);

  if (pending.length === 0) {
    console.log(`  All done.`);
    return succeeded;
  }

  let done = 0;
  const results = [...succeeded];

  for (const imagePath of pending) {
    try {
      const extracted = await extractImage(imagePath, config.prompt);
      extracted._file = basename(imagePath);
      extracted._path = imagePath;
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

function saveResults(outputPath, results) {
  writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const arg = process.argv[2];
  const types = arg ? [arg] : Object.keys(CARD_TYPES);

  const unknown = types.filter((t) => !CARD_TYPES[t]);
  if (unknown.length) {
    console.error(`Unknown card type(s): ${unknown.join(', ')}`);
    console.error(`Valid types: ${Object.keys(CARD_TYPES).join(', ')}`);
    process.exit(1);
  }

  for (const cardType of types) {
    await extractCardType(cardType);
  }

  console.log('\nExtraction complete.');
}

main().catch((err) => { console.error(err); process.exit(1); });
