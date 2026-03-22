/**
 * Simple flat file vector store with cosine similarity search.
 * Persists to data/index.json — no external server needed.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '..', 'data', 'index.json');

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already normalized
}

export function loadIndex() {
  if (!existsSync(INDEX_PATH)) return [];
  return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
}

export function saveIndex(entries) {
  writeFileSync(INDEX_PATH, JSON.stringify(entries), 'utf-8');
}

/**
 * Add entries to the index and persist.
 * Each entry: { id, text, embedding, source, chunkIndex }
 */
export function addEntries(existing, newEntries) {
  const merged = [...existing, ...newEntries];
  saveIndex(merged);
  return merged;
}

/**
 * Find the top-k most similar chunks to a query embedding.
 */
export function search(index, queryEmbedding, k = 8) {
  const scored = index.map((entry) => ({
    ...entry,
    score: cosineSimilarity(entry.embedding, queryEmbedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
