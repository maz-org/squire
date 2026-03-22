/**
 * One-time indexer: reads all PDFs from docs/, chunks text, embeds, saves to data/index.json.
 * Run with: npm run index
 */

import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { embedBatch } from './embedder.js';
import { loadIndex, addEntries } from './vector-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, '..', 'docs');
const CHUNK_SIZE = 800; // characters
const CHUNK_OVERLAP = 150; // characters

function chunkText(text, source) {
  const chunks = [];
  let i = 0;
  let chunkIndex = 0;
  while (i < text.length) {
    const end = Math.min(i + CHUNK_SIZE, text.length);
    const chunk = text.slice(i, end).trim();
    if (chunk.length > 50) {
      chunks.push({ text: chunk, source, chunkIndex });
      chunkIndex++;
    }
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

async function extractText(pdfPath) {
  const buffer = readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  return data.text;
}

async function main() {
  const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith('.pdf'));
  console.log(`Found ${files.length} PDF(s) to index.`);

  const existing = loadIndex();
  const indexedSources = new Set(existing.map((e) => e.source));

  let allNewEntries = [];

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
