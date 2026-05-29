import { basename } from 'node:path';

import { chunkText } from '../../src/index-docs.ts';
import { embed, embedBatch } from '../../src/embedder.ts';
import { GLOOMHAVEN_2E_GAME_ID, type GameId } from '../../src/game.ts';
import {
  EMBEDDING_VERSION,
  addEntries,
  deleteEntriesForSources,
  search,
  type IndexEntry,
  type ScoredEntry,
} from '../../src/vector-store.ts';
import { rerankRuleSourceHits, VOYAGE_EMBEDDING_DIMENSION } from '../../src/voyage-retrieval.ts';
import { scoreExtractionArtifact } from './scoring.ts';
import type {
  ExtractionScoreSummary,
  RetrievalFailureClass,
  RetrievalHitScore,
  RetrievalQueryScore,
} from './scoring.ts';
import {
  GroundTruthDatasetSchema,
  type ExtractionArtifact,
  type ExtractionBlock,
  type GroundTruthRecord,
} from './schema.ts';

const RETRIEVAL_EMBEDDING_MODEL = 'voyage-4-large';
const DEFAULT_TOP_K = 5;
const DEFAULT_RERANK_CANDIDATE_LIMIT = 40;

export interface PdfExtractionRetrievalScoringOptions {
  runId: string;
  game?: GameId;
  topK?: number;
  rerankCandidateLimit?: number;
  cleanup?: boolean;
}

export interface PdfExtractionRetrievalScoringDeps {
  embedDocuments?: (texts: string[]) => Promise<number[][]>;
  embedQuery?: (text: string) => Promise<number[]>;
  addEntries?: (entries: IndexEntry[]) => Promise<void>;
  deleteEntriesForSources?: (sources: string[], game: GameId) => Promise<number>;
  search?: (
    queryEmbedding: number[],
    k: number,
    opts: { game: GameId; sourcePrefix: string },
  ) => Promise<ScoredEntry[]>;
  rerank?: (query: string, hits: ScoredEntry[], topK: number) => Promise<ScoredEntry[]>;
}

interface EvalChunkIndex {
  entries: IndexEntry[];
  sources: string[];
  sourcePrefix: string;
  pages: Set<number>;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function requiredTerms(expectedText: string): string[] {
  return unique(
    normalizeText(expectedText)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3),
  );
}

function containsExpectedText(hit: ScoredEntry, record: GroundTruthRecord): boolean {
  const text = normalizeText(hit.text);
  return requiredTerms(record.expectedText).every((term) => text.includes(term));
}

function containsForbiddenContext(hit: ScoredEntry, record: GroundTruthRecord): boolean {
  const text = normalizeText(hit.text);
  return record.forbiddenRetrievalContextTerms.some((term) => text.includes(normalizeText(term)));
}

function validateEmbeddingShape(embedding: number[], label: string): void {
  if (embedding.length !== VOYAGE_EMBEDDING_DIMENSION) {
    throw new Error(
      `${label} returned ${embedding.length} dimension(s), expected ${VOYAGE_EMBEDDING_DIMENSION}.`,
    );
  }
  const badIndex = embedding.findIndex((value) => !Number.isFinite(value));
  if (badIndex >= 0) {
    throw new Error(`${label} dimension ${badIndex} was not finite.`);
  }
}

function failureClassFor(error: unknown): RetrievalFailureClass {
  const message = error instanceof Error ? error.message : String(error);
  if (/dimension|finite/.test(message)) return 'invalid_embedding_shape';
  if (/rerank/i.test(message)) return 'rerank_failure';
  if (/embedding|Voyage/i.test(message)) return 'embedding_failure';
  return 'storage_failure';
}

function sourcePage(source: string): number | null {
  const rawPage = source.match(/\/page-(\d+)\//)?.[1];
  return rawPage ? Number(rawPage) : null;
}

function boxesIntersect(
  a: NonNullable<GroundTruthRecord['region']>,
  b: NonNullable<ExtractionBlock['bbox']>,
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function artifactHasExpectedRegion(
  artifact: ExtractionArtifact,
  record: GroundTruthRecord,
): boolean {
  if (!record.region) return true;
  const region = record.region;
  const page = artifact.pages.find((candidate) => candidate.pageNumber === record.page);
  if (!page) return false;
  return page.blocks.some((block) => block.bbox && boxesIntersect(region, block.bbox));
}

function hitScores(hits: ScoredEntry[]): RetrievalHitScore[] {
  return hits.slice(0, DEFAULT_TOP_K).map((hit, index) => ({
    rank: index + 1,
    id: hit.id,
    source: hit.source,
    page: sourcePage(hit.source),
    chunkIndex: hit.chunkIndex,
    game: hit.game,
    score: hit.score,
    scoreKind: hit.scoreKind ?? 'vector',
  }));
}

function emptyQueryScore(
  record: GroundTruthRecord,
  query: string,
  failureClasses: RetrievalFailureClass[],
): RetrievalQueryScore {
  return {
    recordId: record.id,
    query,
    expectedSource: record.source,
    expectedPage: record.page,
    expectedRegion: record.region ?? undefined,
    top1Hit: false,
    top3Hit: false,
    top5Hit: false,
    citeableContextHit: false,
    hits: [],
    failureClasses,
  };
}

async function buildEvalChunkIndex(
  artifact: ExtractionArtifact,
  options: Required<Pick<PdfExtractionRetrievalScoringOptions, 'runId' | 'game'>>,
  deps: Required<Pick<PdfExtractionRetrievalScoringDeps, 'embedDocuments'>>,
): Promise<EvalChunkIndex> {
  const sourcePrefix = `eval/pdf-extraction/${options.runId}/${artifact.provider}/`;
  const sourceBase = basename(artifact.source.path);
  const chunks = artifact.pages.flatMap((page) => {
    const source = `${sourcePrefix}page-${page.pageNumber}/${sourceBase}`;
    return chunkText(page.markdown || page.text, source).map((chunk) => ({
      ...chunk,
      pageNumber: page.pageNumber,
    }));
  });
  const embeddings = await deps.embedDocuments(chunks.map((chunk) => chunk.text));
  if (embeddings.length !== chunks.length) {
    throw new Error(
      `document embedding provider returned ${embeddings.length} embedding(s) for ${chunks.length} chunk(s).`,
    );
  }

  const entries = chunks.map((chunk, index): IndexEntry => {
    const embedding = embeddings[index]!;
    validateEmbeddingShape(embedding, `document embedding ${index}`);
    return {
      id: `${sourcePrefix}page-${chunk.pageNumber}/chunk-${chunk.chunkIndex}`,
      source: chunk.source,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      embedding,
      game: options.game,
      contentHash: artifact.source.sha256,
    };
  });

  return {
    entries,
    sources: unique(entries.map((entry) => entry.source)),
    sourcePrefix,
    pages: new Set(chunks.map((chunk) => chunk.pageNumber)),
  };
}

async function scoreRetrievalQuery(
  record: GroundTruthRecord,
  query: string,
  artifact: ExtractionArtifact,
  index: EvalChunkIndex,
  options: Required<
    Pick<PdfExtractionRetrievalScoringOptions, 'game' | 'topK' | 'rerankCandidateLimit'>
  >,
  deps: Required<Pick<PdfExtractionRetrievalScoringDeps, 'embedQuery' | 'search' | 'rerank'>>,
): Promise<RetrievalQueryScore> {
  const failureClasses: RetrievalFailureClass[] = [];
  if (!index.pages.has(record.page)) failureClasses.push('missing_expected_page');
  const expectedRegionHit = artifactHasExpectedRegion(artifact, record);
  if (!expectedRegionHit) failureClasses.push('missing_expected_region');

  let hits: ScoredEntry[];
  try {
    const queryEmbedding = await deps.embedQuery(query);
    validateEmbeddingShape(queryEmbedding, 'query embedding');
    const vectorHits = await deps.search(queryEmbedding, options.rerankCandidateLimit, {
      game: options.game,
      sourcePrefix: index.sourcePrefix,
    });
    hits = await deps.rerank(query, vectorHits, options.topK);
  } catch (error) {
    return emptyQueryScore(record, query, unique([...failureClasses, failureClassFor(error)]));
  }

  if (hits.length === 0) failureClasses.push('no_hits');
  const top5 = hits.slice(0, options.topK);
  const top1Hit = top5.slice(0, 1).some((hit) => sourcePage(hit.source) === record.page);
  const top3Hit = top5.slice(0, 3).some((hit) => sourcePage(hit.source) === record.page);
  const top5Hit = top5.some((hit) => sourcePage(hit.source) === record.page);
  const citeableContextHit = top5.some(
    (hit) =>
      sourcePage(hit.source) === record.page &&
      expectedRegionHit &&
      containsExpectedText(hit, record) &&
      !containsForbiddenContext(hit, record),
  );

  if (top5Hit && expectedRegionHit && !citeableContextHit) {
    failureClasses.push('misleading_context');
  }

  return {
    recordId: record.id,
    query,
    expectedSource: record.source,
    expectedPage: record.page,
    expectedRegion: record.region ?? undefined,
    top1Hit,
    top3Hit,
    top5Hit,
    citeableContextHit,
    hits: hitScores(top5),
    failureClasses: unique(failureClasses),
  };
}

function summarizeRetrieval(
  queryScores: RetrievalQueryScore[],
): ExtractionScoreSummary['retrieval'] {
  const failureClasses = unique(queryScores.flatMap((score) => score.failureClasses));
  const firstHits = queryScores.map((score) => score.hits[0]).filter((hit) => hit !== undefined);
  return {
    queryCount: queryScores.length,
    top1Hits: queryScores.filter((score) => score.top1Hit).length,
    top3Hits: queryScores.filter((score) => score.top3Hit).length,
    top5Hits: queryScores.filter((score) => score.top5Hit).length,
    citeableContextHits: queryScores.filter((score) => score.citeableContextHit).length,
    queryScores,
    failureClasses,
    scoreKindCounts: {
      vector: firstHits.filter((hit) => hit.scoreKind === 'vector').length,
      rerank: firstHits.filter((hit) => hit.scoreKind === 'rerank').length,
    },
    embedding: {
      model: RETRIEVAL_EMBEDDING_MODEL,
      dimensions: VOYAGE_EMBEDDING_DIMENSION,
      version: EMBEDDING_VERSION,
    },
  };
}

export async function scoreExtractionArtifactWithProductionRetrieval(
  artifact: ExtractionArtifact,
  groundTruthInput: GroundTruthRecord[],
  options: PdfExtractionRetrievalScoringOptions,
  deps: PdfExtractionRetrievalScoringDeps = {},
): Promise<ExtractionScoreSummary> {
  const groundTruth = GroundTruthDatasetSchema.parse(groundTruthInput);
  const base = scoreExtractionArtifact(artifact, groundTruth);
  const resolvedOptions = {
    runId: options.runId,
    game: options.game ?? GLOOMHAVEN_2E_GAME_ID,
    topK: options.topK ?? DEFAULT_TOP_K,
    rerankCandidateLimit: options.rerankCandidateLimit ?? DEFAULT_RERANK_CANDIDATE_LIMIT,
    cleanup: options.cleanup ?? true,
  };
  const resolvedDeps = {
    embedDocuments: deps.embedDocuments ?? embedBatch,
    embedQuery: deps.embedQuery ?? embed,
    addEntries: deps.addEntries ?? addEntries,
    deleteEntriesForSources: deps.deleteEntriesForSources ?? deleteEntriesForSources,
    search: deps.search ?? search,
    rerank: deps.rerank ?? rerankRuleSourceHits,
  };

  let index: EvalChunkIndex | undefined;
  try {
    index = await buildEvalChunkIndex(artifact, resolvedOptions, resolvedDeps);
    await resolvedDeps.addEntries(index.entries);
  } catch (error) {
    const failureClass = failureClassFor(error);
    const queryScores = groundTruth.flatMap((record) =>
      record.retrievalQueries.map((query) => emptyQueryScore(record, query, [failureClass])),
    );
    return {
      ...base,
      retrieval: summarizeRetrieval(queryScores),
      failures: [...base.failures, `retrieval scoring failed: ${failureClass}`],
    };
  }

  try {
    const queryScores: RetrievalQueryScore[] = [];
    for (const record of groundTruth) {
      for (const query of record.retrievalQueries) {
        queryScores.push(
          await scoreRetrievalQuery(record, query, artifact, index, resolvedOptions, resolvedDeps),
        );
      }
    }
    const retrieval = summarizeRetrieval(queryScores);
    return {
      ...base,
      retrieval,
      failures: [
        ...base.failures,
        ...retrieval.failureClasses!.map((failureClass) => `retrieval scoring: ${failureClass}`),
      ],
    };
  } finally {
    if (resolvedOptions.cleanup) {
      await resolvedDeps.deleteEntriesForSources(index.sources, resolvedOptions.game);
    }
  }
}
