/**
 * One-time indexer: reads all PDFs from docs/, chunks text, embeds, saves to data/index.json.
 * Run with: npm run index
 */

import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { embedBatch } from './embedder.ts';
import { loadIndex, addEntries } from './vector-store.ts';
import type { IndexEntry } from './vector-store.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, '..', 'docs');

const MIN_CHUNK_CHARS = 50;
const TARGET_CHUNK_CHARS = 1200;
const MAX_CHUNK_CHARS = 1600;

interface Chunk {
  text: string;
  source: string;
  chunkIndex: number;
}

/** Split text on double-newline boundaries into paragraphs. */
export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Split a paragraph that exceeds maxChars at sentence or word boundaries. */
export function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];

  const results: string[] = [];
  let remaining = paragraph;

  while (remaining.length > maxChars) {
    // Try sentence boundary: period/exclamation/question followed by space and uppercase
    const sentenceRegex = /[.!?]\s+(?=[A-Z])/g;
    let bestBreak = -1;
    let match: RegExpExecArray | null;

    while ((match = sentenceRegex.exec(remaining)) !== null) {
      const splitAt = match.index + 1; // right after the punctuation
      if (splitAt <= maxChars) {
        bestBreak = splitAt;
      } else {
        break;
      }
    }

    if (bestBreak > 0) {
      results.push(remaining.slice(0, bestBreak).trim());
      remaining = remaining.slice(bestBreak).trim();
      continue;
    }

    // Fallback: split at last space before maxChars
    const lastSpace = remaining.lastIndexOf(' ', maxChars);
    if (lastSpace > 0) {
      results.push(remaining.slice(0, lastSpace).trim());
      remaining = remaining.slice(lastSpace).trim();
      continue;
    }

    // No space at all: hard split
    results.push(remaining.slice(0, maxChars));
    remaining = remaining.slice(maxChars);
  }

  if (remaining.length > 0) {
    results.push(remaining);
  }

  return results;
}

/** Greedily merge paragraphs into chunks up to targetChars, joining with double newlines. */
export function mergeParagraphsIntoChunks(paragraphs: string[], targetChars: number): string[] {
  const chunks: string[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;

  for (const para of paragraphs) {
    const wouldBe = bufferLen + (buffer.length > 0 ? 2 : 0) + para.length; // 2 for \n\n separator

    if (buffer.length > 0 && wouldBe > targetChars) {
      chunks.push(buffer.join('\n\n'));
      buffer = [para];
      bufferLen = para.length;
    } else {
      buffer.push(para);
      bufferLen = wouldBe;
    }
  }

  if (buffer.length > 0) {
    chunks.push(buffer.join('\n\n'));
  }

  return chunks.filter((c) => c.length >= MIN_CHUNK_CHARS);
}

/**
 * Detect if text looks like a section heading:
 * short (under 80 chars), single line, and either all uppercase, a number, or title-case.
 */
export function detectHeading(text: string): boolean {
  if (text.includes('\n')) return false;
  if (text.length > 80) return false;
  if (text.length === 0) return false;

  // Page numbers
  if (/^\d+$/.test(text.trim())) return true;

  // All uppercase (at least 2 chars)
  if (text.length >= 2 && text === text.toUpperCase() && /[A-Z]/.test(text)) return true;

  // Title-case: 1-6 words, each starting with uppercase
  const words = text.trim().split(/\s+/);
  if (words.length <= 6 && words.length >= 1) {
    const isTitleCase = words.every((w) => /^[A-Z0-9]/.test(w));
    // Reject if it looks like a regular sentence (ends with period or has many lowercase words)
    if (isTitleCase && !text.endsWith('.') && words.length <= 5) return true;
  }

  return false;
}

/**
 * Extract a heading from the first lines of a paragraph, if present.
 * Returns [heading, remainingText] or [null, originalText].
 */
export function extractHeading(paragraph: string): [string | null, string] {
  const lines = paragraph.split('\n');
  const headingLines: string[] = [];

  for (let i = 0; i < lines.length && i < 3; i++) {
    const line = lines[i].trim();
    if (detectHeading(line)) {
      headingLines.push(line);
    } else {
      break;
    }
  }

  if (headingLines.length === 0) return [null, paragraph];

  // Filter out page numbers from the heading
  const meaningfulHeadings = headingLines.filter((h) => !/^\d+$/.test(h));
  const heading = meaningfulHeadings.length > 0 ? meaningfulHeadings.join(' — ') : null;
  const remaining = lines.slice(headingLines.length).join('\n').trim();

  return [heading, remaining];
}

export function chunkText(text: string, source: string): Chunk[] {
  if (!text.trim()) return [];

  // 1. Split into paragraphs on double-newline boundaries
  const paragraphs = splitIntoParagraphs(text);

  // 2. Extract headings from paragraph starts and track current heading
  let currentHeading: string | null = null;
  const processed: string[] = [];

  for (const p of paragraphs) {
    const [heading, body] = extractHeading(p);
    if (heading) currentHeading = heading;
    if (!body) continue;

    const prefix = currentHeading ? `[${currentHeading}]\n\n` : '';
    processed.push(prefix + body);
  }

  // 3. Split oversized paragraphs at sentence/word boundaries
  const expanded = processed.flatMap((p) => splitLongParagraph(p, MAX_CHUNK_CHARS));

  // 4. Merge small paragraphs into chunks up to target size
  const chunkTexts = mergeParagraphsIntoChunks(expanded, TARGET_CHUNK_CHARS);

  // 5. Map to Chunk objects
  return chunkTexts.map((t, i) => ({
    text: t,
    source,
    chunkIndex: i,
  }));
}

async function extractText(pdfPath: string): Promise<string> {
  const buffer = readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  return data.text as string;
}

export async function main(): Promise<void> {
  const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith('.pdf'));
  console.log(`Found ${files.length} PDF(s) to index.`);

  const existing = loadIndex();
  const indexedSources = new Set(existing.map((e) => e.source));

  const allNewEntries: IndexEntry[] = [];

  for (const file of files) {
    if (indexedSources.has(file)) {
      console.log(`  Skipping (already indexed): ${file}`);
      continue;
    }
    console.log(`  Extracting: ${file}`);
    const text = await extractText(join(DOCS_DIR, file));
    const chunks = chunkText(text, file);
    console.log(`    ${chunks.length} chunks — embedding...`);

    const BATCH = 32;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const embeddings = await embedBatch(batch.map((c) => c.text));
      for (let j = 0; j < batch.length; j++) {
        allNewEntries.push({
          id: `${file}::${batch[j].chunkIndex}`,
          text: batch[j].text,
          source: batch[j].source,
          chunkIndex: batch[j].chunkIndex,
          embedding: embeddings[j],
        });
      }
      process.stdout.write(
        `\r    ${Math.min(i + BATCH, chunks.length)}/${chunks.length} chunks embedded`,
      );
    }
    console.log();
  }

  if (allNewEntries.length === 0) {
    console.log('Nothing new to index.');
    return;
  }

  addEntries(existing, allNewEntries);
  console.log(`\nDone. Index now has ${existing.length + allNewEntries.length} chunks total.`);
}

if (process.argv[1]?.endsWith('index-docs.ts')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
