import type { ScoredEntry } from './vector-store.ts';

const VOYAGE_EMBEDDING_MODEL = 'voyage-4-large';
const VOYAGE_RERANK_MODEL = 'rerank-2.5';
export const VOYAGE_EMBEDDING_DIMENSION = 1024;
const PROVIDER_ATTEMPT_TIMEOUT_MS = 30_000;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Voyage retrieval.`);
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

function providerRetryDelayMs(attempt: number): number {
  return Math.min(60_000, 2000 * 2 ** attempt);
}

async function postJson(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_ATTEMPT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (attempt < maxAttempts - 1) {
        await sleep(providerRetryDelayMs(attempt));
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Voyage retrieval provider request failed after retries: ${message}`, {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

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
      throw new Error(`Voyage retrieval provider request failed (${response.status}): ${message}`);
    }
    return json;
  }
  throw new Error('Voyage retrieval provider request failed after retries.');
}

function parseVoyageEmbeddings(json: unknown): number[][] {
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error('Voyage embeddings response did not include data.');
  return data.map((item, itemIndex) => {
    const embedding = (item as { embedding?: unknown }).embedding;
    if (!Array.isArray(embedding))
      throw new Error(`parseVoyageEmbeddings: item ${itemIndex} did not include embedding.`);
    if (embedding.length !== VOYAGE_EMBEDDING_DIMENSION) {
      throw new Error(
        `parseVoyageEmbeddings: item ${itemIndex} returned ${embedding.length} dimension(s), expected ${VOYAGE_EMBEDDING_DIMENSION}.`,
      );
    }
    return embedding.map((value, valueIndex) => {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        throw new Error(
          `parseVoyageEmbeddings: item ${itemIndex} dimension ${valueIndex} was not finite.`,
        );
      }
      return number;
    });
  });
}

export async function embedVoyage(
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
      output_dimension: VOYAGE_EMBEDDING_DIMENSION,
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

interface RerankResult {
  index: number;
  relevanceScore: number;
}

function parseVoyageRerankResults(json: unknown): RerankResult[] {
  const results =
    (json as { data?: unknown; results?: unknown }).data ?? (json as { results?: unknown }).results;
  if (!Array.isArray(results)) throw new Error('Voyage rerank response did not include results.');
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
  return parseVoyageRerankResults(json);
}

export async function rerankRuleSourceHits(
  query: string,
  hits: ScoredEntry[],
  topK: number,
): Promise<ScoredEntry[]> {
  if (hits.length <= 1) return hits;

  const documents = hits.map((hit) => [`source: ${hit.source}`, hit.text].join('\n\n'));
  const results = await rerankVoyage(query, documents, Math.min(topK, hits.length));
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
      scoreKind: 'rerank' as const,
    }));
  if (reranked.length === 0) return hits;

  const seen = new Set(reranked.map((hit) => hit.id));
  return [...reranked, ...hits.filter((hit) => !seen.has(hit.id))];
}

export function isEmbedderLoaded(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY?.trim());
}
