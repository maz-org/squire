import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  scoreExtractionArtifactWithProductionRetrieval,
  type PdfExtractionRetrievalScoringDeps,
} from '../eval/pdf-extraction/retrieval-scoring.ts';
import {
  computeProviderConfigHash,
  type ExtractionArtifact,
  type GroundTruthRecord,
} from '../eval/pdf-extraction/schema.ts';
import { GLOOMHAVEN_2E_GAME_ID } from '../src/game.ts';
import { addEntries } from '../src/vector-store.ts';
import type { ScoredEntry } from '../src/vector-store.ts';

import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

function axisVector(axis: number, dim = 1024): number[] {
  const vector = new Array<number>(dim).fill(0);
  vector[axis] = 1;
  return vector;
}

function artifactWithPages(pages: Array<{ pageNumber: number; text: string }>): ExtractionArtifact {
  return {
    schemaVersion: 'squire-pdf-extraction-v1',
    provider: 'marker-datalab',
    providerVersion: 'marker-test',
    providerConfigHash: computeProviderConfigHash({ fixture: 'retrieval-scoring' }),
    source: {
      path: 'data/pdfs/gh2-rule-book.pdf',
      sha256: `sha256:${'2'.repeat(64)}`,
      pageCount: 74,
    },
    run: {
      id: 'run-marker-retrieval',
      startedAt: '2026-05-29T00:00:00.000Z',
      completedAt: '2026-05-29T00:00:02.000Z',
      status: 'succeeded',
      pageRange: pages.map((page) => page.pageNumber),
      latencyMs: 2_000,
    },
    cost: {
      estimatedUsd: 0,
      actualUsd: 0,
      pagesProcessed: pages.length,
      costPerPageUsd: 0,
    },
    privacy: {
      retentionPolicy: 'local only',
      trainingUse: 'not-used-for-training',
    },
    rawArtifacts: [],
    pages: pages.map((page) => ({
      pageNumber: page.pageNumber,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown: page.text,
      text: page.text,
      blocks: [
        { id: `p${page.pageNumber}-heading`, type: 'heading', order: 0, text: 'Loot' },
        { id: `p${page.pageNumber}-body`, type: 'paragraph', order: 1, text: page.text },
      ],
      tables: [],
    })),
  };
}

function record(overrides: Partial<GroundTruthRecord> = {}): GroundTruthRecord {
  return {
    id: 'gh2-rulebook-page-30-loot',
    source: 'data/pdfs/gh2-rule-book.pdf',
    page: 30,
    region: null,
    category: 'loot',
    expectedText: 'Loot X lets a figure loot all money tokens and treasure tiles within range X.',
    expectedHeadings: ['Loot'],
    expectedTables: [],
    retrievalQueries: ['How does Loot X work in Gloomhaven 2e?'],
    forbiddenRetrievalContextTerms: [],
    ...overrides,
  };
}

function deps(input: {
  documentEmbeddings?: number[][];
  queryEmbeddings?: number[][];
  search?: PdfExtractionRetrievalScoringDeps['search'];
  rerank?: PdfExtractionRetrievalScoringDeps['rerank'];
}): PdfExtractionRetrievalScoringDeps {
  let queryIndex = 0;
  return {
    embedDocuments: async (texts) => input.documentEmbeddings ?? texts.map(() => axisVector(0)),
    embedQuery: async () => input.queryEmbeddings?.[queryIndex++] ?? axisVector(0),
    search: input.search,
    rerank: input.rerank ?? (async (_query: string, hits: ScoredEntry[]) => hits),
  };
}

let db: Awaited<ReturnType<typeof setupTestDb>>;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe('PDF extraction production retrieval scoring', () => {
  it('scores a vector-only hit through pgvector and cleans up eval rows', async () => {
    const artifact = artifactWithPages([
      {
        pageNumber: 30,
        text: [
          'Loot',
          '',
          'Loot X lets a figure loot all money tokens and treasure tiles within range X.',
          'The looting figure removes those tokens from the map.',
        ].join('\n'),
      },
    ]);

    const summary = await scoreExtractionArtifactWithProductionRetrieval(
      artifact,
      [record()],
      { runId: 'run-vector-only' },
      deps({ documentEmbeddings: [axisVector(0)] }),
    );

    expect(summary.retrieval.top1Hits).toBe(1);
    expect(summary.retrieval.top3Hits).toBe(1);
    expect(summary.retrieval.top5Hits).toBe(1);
    expect(summary.retrieval.citeableContextHits).toBe(1);
    expect(summary.retrieval.queryScores?.[0]).toMatchObject({
      recordId: 'gh2-rulebook-page-30-loot',
      top1Hit: true,
      top3Hit: true,
      top5Hit: true,
      citeableContextHit: true,
      failureClasses: [],
    });
    expect(summary.retrieval.queryScores?.[0]?.hits[0]).toMatchObject({
      page: 30,
      scoreKind: 'vector',
    });

    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM rule_source_embeddings WHERE source LIKE 'eval/pdf-extraction/run-vector-only/%'`,
    );
    expect(Number(rows.rows[0].count)).toBe(0);
  });

  it('credits a hit promoted by the production reranker', async () => {
    const artifact = artifactWithPages([
      {
        pageNumber: 30,
        text: 'Loot\n\nLoot X lets a figure loot all money tokens and treasure tiles within range X.',
      },
      {
        pageNumber: 31,
        text: 'Recover\n\nRecover abilities return cards and are unrelated to loot questions.',
      },
    ]);

    const summary = await scoreExtractionArtifactWithProductionRetrieval(
      artifact,
      [record()],
      { runId: 'run-reranked' },
      deps({
        documentEmbeddings: [axisVector(1), axisVector(0)],
        rerank: async (_query, hits) => [
          {
            ...hits.find((hit) => hit.source.includes('/page-30/'))!,
            score: 0.99,
            scoreKind: 'rerank',
          },
          ...hits.filter((hit) => !hit.source.includes('/page-30/')),
        ],
      }),
    );

    expect(summary.retrieval.top1Hits).toBe(1);
    expect(summary.retrieval.scoreKindCounts).toEqual({ rerank: 1, vector: 0 });
    expect(summary.retrieval.queryScores?.[0]?.hits[0]).toMatchObject({
      page: 30,
      scoreKind: 'rerank',
    });
  });

  it('keeps top-5 scoring fixed when callers request more hits', async () => {
    const summary = await scoreExtractionArtifactWithProductionRetrieval(
      artifactWithPages([
        { pageNumber: 25, text: 'Setup\n\nScenario setup text.' },
        { pageNumber: 26, text: 'Movement\n\nMove abilities spend movement points.' },
        { pageNumber: 27, text: 'Attack\n\nAttack abilities draw attack modifiers.' },
        { pageNumber: 28, text: 'Heal\n\nHeal abilities remove damage.' },
        { pageNumber: 29, text: 'Elements\n\nElements can be infused and consumed.' },
        {
          pageNumber: 30,
          text: 'Loot\n\nLoot X lets a figure loot all money tokens and treasure tiles within range X.',
        },
      ]),
      [record()],
      { runId: 'run-top-k-six', topK: 6 },
      deps({
        search: async () =>
          [25, 26, 27, 28, 29, 30].map((page, index) => ({
            id: `hit-${page}`,
            source: `eval/pdf-extraction/run-top-k-six/marker-datalab/page-${page}/gh2-rule-book.pdf`,
            chunkIndex: 0,
            text: page === 30 ? record().expectedText : `Distractor page ${page}`,
            game: GLOOMHAVEN_2E_GAME_ID,
            score: 1 - index * 0.01,
            scoreKind: 'vector',
          })),
      }),
    );

    expect(summary.retrieval.top5Hits).toBe(0);
    expect(summary.retrieval.queryScores?.[0]).toMatchObject({
      top1Hit: false,
      top3Hit: false,
      top5Hit: false,
    });
    expect(summary.retrieval.queryScores?.[0]?.hits).toHaveLength(5);
  });

  it('uses the GH2 game filter so same-namespace Frosthaven rows cannot win', async () => {
    await addEntries([
      {
        id: 'fh-contaminant',
        source: 'eval/pdf-extraction/run-wrong-game/marker-datalab/page-30/fh',
        chunkIndex: 0,
        text: 'Loot X lets a figure loot all money tokens and treasure tiles within range X.',
        embedding: axisVector(0),
        game: 'frosthaven',
      },
    ]);

    const summary = await scoreExtractionArtifactWithProductionRetrieval(
      artifactWithPages([
        {
          pageNumber: 30,
          text: 'Loot\n\nLoot X lets a figure loot all money tokens and treasure tiles within range X.',
        },
      ]),
      [record()],
      { runId: 'run-wrong-game' },
      deps({ documentEmbeddings: [axisVector(1)] }),
    );

    expect(summary.retrieval.queryScores?.[0]?.hits[0]).toMatchObject({
      game: GLOOMHAVEN_2E_GAME_ID,
      page: 30,
    });
  });

  it('treats eval run ids as literal source prefixes', async () => {
    await addEntries([
      {
        id: 'wildcard-contaminant',
        source: 'eval/pdf-extraction/run-likeAX/marker-datalab/page-99/gh2',
        chunkIndex: 0,
        text: 'Loot X lets a figure loot all money tokens and treasure tiles within range X.',
        embedding: axisVector(0),
        game: GLOOMHAVEN_2E_GAME_ID,
      },
    ]);

    const summary = await scoreExtractionArtifactWithProductionRetrieval(
      artifactWithPages([
        {
          pageNumber: 30,
          text: 'Loot\n\nLoot X lets a figure loot all money tokens and treasure tiles within range X.',
        },
      ]),
      [record()],
      { runId: 'run-like_%' },
      deps({ documentEmbeddings: [axisVector(1)] }),
    );

    expect(summary.retrieval.queryScores?.[0]?.hits[0]).toMatchObject({
      page: 30,
      source: 'eval/pdf-extraction/run-like_%/marker-datalab/page-30/gh2-rule-book.pdf',
    });
  });

  it('flags misleading retrieved context as not citeable', async () => {
    const summary = await scoreExtractionArtifactWithProductionRetrieval(
      artifactWithPages([
        {
          pageNumber: 30,
          text: [
            'Loot',
            '',
            'Loot X lets a figure loot all money tokens and treasure tiles within range X.',
            'Summon loot tokens during setup.',
          ].join('\n'),
        },
      ]),
      [record({ forbiddenRetrievalContextTerms: ['summon loot tokens'] })],
      { runId: 'run-misleading' },
      deps({ documentEmbeddings: [axisVector(0)] }),
    );

    expect(summary.retrieval.top1Hits).toBe(1);
    expect(summary.retrieval.citeableContextHits).toBe(0);
    expect(summary.retrieval.failureClasses).toEqual(['misleading_context']);
    expect(summary.retrieval.queryScores?.[0]?.failureClasses).toContain('misleading_context');
  });

  it('records a missing expected page when no retrieved hit cites that page', async () => {
    const summary = await scoreExtractionArtifactWithProductionRetrieval(
      artifactWithPages([
        {
          pageNumber: 31,
          text: 'Recover\n\nRecover abilities return cards and are unrelated to loot questions.',
        },
      ]),
      [record()],
      { runId: 'run-missing-page' },
      deps({ documentEmbeddings: [axisVector(0)] }),
    );

    expect(summary.retrieval.top1Hits).toBe(0);
    expect(summary.retrieval.failureClasses).toContain('missing_expected_page');
    expect(summary.retrieval.queryScores?.[0]).toMatchObject({
      top1Hit: false,
      top3Hit: false,
      top5Hit: false,
      citeableContextHit: false,
    });
  });

  it('records a missing expected region when the page is retrieved without region evidence', async () => {
    const summary = await scoreExtractionArtifactWithProductionRetrieval(
      artifactWithPages([
        {
          pageNumber: 30,
          text: 'Loot\n\nLoot X lets a figure loot all money tokens and treasure tiles within range X.',
        },
      ]),
      [
        record({
          region: { x: 60, y: 120, width: 490, height: 300 },
        }),
      ],
      { runId: 'run-missing-region' },
      deps({ documentEmbeddings: [axisVector(0)] }),
    );

    expect(summary.retrieval.top1Hits).toBe(1);
    expect(summary.retrieval.citeableContextHits).toBe(0);
    expect(summary.retrieval.failureClasses).toContain('missing_expected_region');
    expect(summary.retrieval.queryScores?.[0]).toMatchObject({
      expectedRegion: { x: 60, y: 120, width: 490, height: 300 },
      top1Hit: true,
      citeableContextHit: false,
      failureClasses: ['missing_expected_region'],
    });
  });

  it('classifies vector-store failures separately from embedding provider failures', async () => {
    const summary = await scoreExtractionArtifactWithProductionRetrieval(
      artifactWithPages([
        {
          pageNumber: 30,
          text: 'Loot\n\nLoot X lets a figure loot all money tokens and treasure tiles within range X.',
        },
      ]),
      [record()],
      { runId: 'run-storage-failure' },
      deps({
        documentEmbeddings: [axisVector(0)],
        search: async () => {
          throw new Error('relation "rule_source_embeddings" does not exist');
        },
      }),
    );

    expect(summary.retrieval.failureClasses).toEqual(['storage_failure']);
    expect(summary.failures).toContain('retrieval scoring: storage_failure');
  });

  it('records invalid embedding shape before vector storage', async () => {
    const summary = await scoreExtractionArtifactWithProductionRetrieval(
      artifactWithPages([
        {
          pageNumber: 30,
          text: 'Loot\n\nLoot X lets a figure loot all money tokens and treasure tiles within range X.',
        },
      ]),
      [record()],
      { runId: 'run-invalid-shape' },
      deps({ documentEmbeddings: [[1, 0, 0]] }),
    );

    expect(summary.retrieval.queryCount).toBe(1);
    expect(summary.retrieval.top1Hits).toBe(0);
    expect(summary.retrieval.failureClasses).toEqual(['invalid_embedding_shape']);
    expect(summary.failures).toEqual(
      expect.arrayContaining([expect.stringContaining('invalid_embedding_shape')]),
    );
  });
});
