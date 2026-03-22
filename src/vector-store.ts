/**
 * Simple flat file vector store with cosine similarity search.
 * Persists to data/index.json — no external server needed.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '..', 'data', 'index.json');

export interface IndexEntry {
  id: string;
  text: string;
  embedding: number[];
  source: string;
  chunkIndex: number;
}

export interface ScoredEntry extends IndexEntry {
  score: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already normalized
}

export function loadIndex(): IndexEntry[] {
  if (!existsSync(INDEX_PATH)) return [];
  return JSON.parse(readFileSync(INDEX_PATH, 'utf-8')) as IndexEntry[];
}

export function saveIndex(entries: IndexEntry[]): void {
  writeFileSync(INDEX_PATH, JSON.stringify(entries), 'utf-8');
}

export function addEntries(existing: IndexEntry[], newEntries: IndexEntry[]): IndexEntry[] {
  const merged = [...existing, ...newEntries];
  saveIndex(merged);
  return merged;
}

export function search(index: IndexEntry[], queryEmbedding: number[], k = 8): ScoredEntry[] {
  const scored = index.map((entry) => ({
    ...entry,
    score: cosineSimilarity(entry.embedding, queryEmbedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
