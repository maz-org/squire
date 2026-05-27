/**
 * Local embedding using all-MiniLM-L6-v2 via @xenova/transformers
 * No API key required — runs on-device.
 */

import { pipeline } from '@xenova/transformers';
import { embedVoyageExperiment, usesVoyageExperimentEmbeddings } from './retrieval-experiment.ts';

type FeatureExtractionPipeline = Awaited<ReturnType<typeof pipeline<'feature-extraction'>>>;

let embedder: FeatureExtractionPipeline | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

export function isEmbedderLoaded(): boolean {
  return embedder !== null;
}

export async function embed(text: string): Promise<number[]> {
  if (usesVoyageExperimentEmbeddings()) {
    return (await embedVoyageExperiment([text], 'query'))[0]!;
  }
  const model = await getEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (usesVoyageExperimentEmbeddings()) {
    return embedVoyageExperiment(texts, 'document');
  }
  return Promise.all(texts.map(embed));
}
