/**
 * Production rule-source embedding client.
 *
 * Squire's shipped retrieval path uses Voyage embeddings. There is no local
 * embedding fallback in runtime code; missing credentials should fail loudly so
 * the indexer/server cannot silently build or query the wrong vector family.
 */

import { embedVoyage, isEmbedderLoaded } from './voyage-retrieval.ts';

export { isEmbedderLoaded };

export async function embed(text: string): Promise<number[]> {
  return (await embedVoyage([text], 'query'))[0]!;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  return embedVoyage(texts, 'document');
}
