import { sql } from 'drizzle-orm';

import { getDb } from './db.ts';
import { requireGameId, type GameId } from './game.ts';
import type { ScoredEntry } from './vector-store.ts';

export type RetrievalExperimentVariant =
  | 'local'
  | 'voyage'
  | 'voyage-voyage-rerank'
  | 'voyage-cohere-rerank';

const VOYAGE_EMBEDDING_MODEL = 'voyage-4-large';
const VOYAGE_RERANK_MODEL = 'rerank-2.5';
const COHERE_RERANK_MODEL = 'rerank-v4.0-pro';
export const VOYAGE_EXPERIMENT_EMBEDDING_VERSION = `${VOYAGE_EMBEDDING_MODEL}:dim1024:experiment-v1`;

export function retrievalExperimentVariant(
  env: NodeJS.ProcessEnv = process.env,
): RetrievalExperimentVariant {
  const raw = env.SQUIRE_RETRIEVAL_EXPERIMENT_VARIANT?.trim() || 'local';
  if (
    raw === 'local' ||
    raw === 'voyage' ||
    raw === 'voyage-voyage-rerank' ||
    raw === 'voyage-cohere-rerank'
  ) {
    return raw;
  }
  throw new Error(
    `Invalid SQUIRE_RETRIEVAL_EXPERIMENT_VARIANT: ${raw}. Expected local, voyage, voyage-voyage-rerank, or voyage-cohere-rerank.`,
  );
}

export function usesVoyageExperimentEmbeddings(env: NodeJS.ProcessEnv = process.env): boolean {
  return retrievalExperimentVariant(env).startsWith('voyage');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for SQR-247 retrieval experiment.`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  return Math.min(60_000, 2000 * 2 ** attempt);
}

async function postJson(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => undefined)) as unknown;
    if (response.status === 429 && attempt < maxAttempts - 1) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }
    if (!response.ok) {
      const message =
        typeof (json as { message?: unknown })?.message === 'string'
          ? (json as { message: string }).message
          : response.statusText;
      throw new Error(
        `retrieval experiment provider request failed (${response.status}): ${message}`,
      );
    }
    return json;
  }
  throw new Error('retrieval experiment provider request failed after retries.');
}

function parseVoyageEmbeddings(json: unknown): number[][] {
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error('Voyage embeddings response did not include data.');
  return data.map((item) => {
    const embedding = (item as { embedding?: unknown }).embedding;
    if (!Array.isArray(embedding))
      throw new Error('Voyage embedding item did not include embedding.');
    return embedding.map(Number);
  });
}

export async function embedVoyageExperiment(
  texts: string[],
  inputType: 'query' | 'document',
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const json = await postJson(
    'https://api.voyageai.com/v1/embeddings',
    requiredEnv('VOYAGE_API_KEY'),
    {
      input: texts,
      model: VOYAGE_EMBEDDING_MODEL,
      input_type: inputType,
      output_dimension: 1024,
      output_dtype: 'float',
    },
  );
  const embeddings = parseVoyageEmbeddings(json);
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Voyage returned ${embeddings.length} embedding(s) for ${texts.length} input text(s).`,
    );
  }
  return embeddings;
}

export async function ensureVoyageExperimentTable(): Promise<void> {
  const { db } = getDb('server');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS retrieval_experiment_voyage_embeddings (
      id text PRIMARY KEY,
      source text NOT NULL,
      chunk_index integer NOT NULL,
      text text NOT NULL,
      game text NOT NULL,
      content_hash text,
      embedding_version text NOT NULL,
      embedding vector(1024) NOT NULL,
      UNIQUE (game, source, chunk_index)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS retrieval_experiment_voyage_game_idx
      ON retrieval_experiment_voyage_embeddings (game)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS retrieval_experiment_voyage_hnsw_idx
      ON retrieval_experiment_voyage_embeddings
      USING hnsw (embedding vector_cosine_ops)
  `);
}

export async function searchVoyageExperiment(
  queryEmbedding: number[],
  k: number,
  game: GameId | string,
): Promise<ScoredEntry[]> {
  const resolvedGame = requireGameId(game);
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;
  const { db } = getDb('server');
  const result = await db.execute<{
    id: string;
    source: string;
    chunk_index: number;
    text: string;
    game: GameId;
    score: number;
  }>(sql`
    SELECT
      id,
      source,
      chunk_index,
      text,
      game,
      1 - (embedding <=> ${vectorLiteral}::vector) AS score
    FROM retrieval_experiment_voyage_embeddings
    WHERE game = ${resolvedGame}
      AND embedding_version = ${VOYAGE_EXPERIMENT_EMBEDDING_VERSION}
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${k}
  `);

  return result.rows.map((row) => ({
    id: row.id,
    source: row.source,
    chunkIndex: Number(row.chunk_index),
    text: row.text,
    game: row.game,
    score: Number(row.score),
  }));
}

interface RerankResult {
  index: number;
  relevanceScore: number;
}

function parseRerankResults(json: unknown, provider: 'voyage' | 'cohere'): RerankResult[] {
  const results =
    provider === 'voyage'
      ? ((json as { data?: unknown; results?: unknown }).data ??
        (json as { results?: unknown }).results)
      : (json as { results?: unknown }).results;
  if (!Array.isArray(results))
    throw new Error(`${provider} rerank response did not include results.`);
  return results.map((item) => {
    const record = item as { index?: unknown; relevance_score?: unknown; relevanceScore?: unknown };
    return {
      index: Number(record.index),
      relevanceScore: Number(record.relevance_score ?? record.relevanceScore),
    };
  });
}

async function rerankVoyage(
  query: string,
  documents: string[],
  topK: number,
): Promise<RerankResult[]> {
  const json = await postJson('https://api.voyageai.com/v1/rerank', requiredEnv('VOYAGE_API_KEY'), {
    query,
    documents,
    model: VOYAGE_RERANK_MODEL,
    top_k: topK,
    truncation: true,
  });
  return parseRerankResults(json, 'voyage');
}

async function rerankCohere(
  query: string,
  documents: string[],
  topK: number,
): Promise<RerankResult[]> {
  const json = await postJson('https://api.cohere.com/v2/rerank', requiredEnv('COHERE_API_KEY'), {
    query,
    documents,
    model: COHERE_RERANK_MODEL,
    top_n: topK,
  });
  return parseRerankResults(json, 'cohere');
}

export async function rerankExperimentHits(
  query: string,
  hits: ScoredEntry[],
  topK: number,
): Promise<ScoredEntry[]> {
  const variant = retrievalExperimentVariant();
  if (variant !== 'voyage-voyage-rerank' && variant !== 'voyage-cohere-rerank') return hits;
  if (hits.length <= 1) return hits;

  const documents = hits.map((hit) => [`source: ${hit.source}`, hit.text].join('\n\n'));
  const results =
    variant === 'voyage-voyage-rerank'
      ? await rerankVoyage(query, documents, Math.min(topK, hits.length))
      : await rerankCohere(query, documents, Math.min(topK, hits.length));
  const reranked = results
    .filter(
      (result) =>
        Number.isInteger(result.index) &&
        result.index >= 0 &&
        result.index < hits.length &&
        Number.isFinite(result.relevanceScore),
    )
    .map((result) => ({
      ...hits[result.index],
      score: result.relevanceScore,
    }));
  if (reranked.length === 0) return hits;

  const seen = new Set(reranked.map((hit) => hit.id));
  return [...reranked, ...hits.filter((hit) => !seen.has(hit.id))];
}
