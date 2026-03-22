/**
 * Local embedding using all-MiniLM-L6-v2 via @xenova/transformers
 * No API key required — runs on-device.
 */

import { pipeline } from '@xenova/transformers';

let embedder = null;

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

/**
 * Embed a single string. Returns a Float32Array of 384 dimensions.
 */
export async function embed(text) {
  const model = await getEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Embed multiple strings in batch.
 */
export async function embedBatch(texts) {
  return Promise.all(texts.map(embed));
}
