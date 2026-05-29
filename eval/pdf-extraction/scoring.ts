import {
  GroundTruthDatasetSchema,
  type ExtractionArtifact,
  type ExtractionPage,
  type GroundTruthRecord,
} from './schema.ts';

export interface TextScoreSummary {
  requiredPhraseRecall: number;
  averageCharacterErrorRate: number;
}

export interface StructureScoreSummary {
  headingRecall: number;
  readingOrderScore: number;
  tableCellRecall: number;
  noiseRatio: number;
}

export interface RetrievalScoreSummary {
  queryCount: number;
  top1Hits: number;
  top3Hits: number;
  top5Hits: number;
  citeableContextHits: number;
  queryScores?: RetrievalQueryScore[];
  failureClasses?: RetrievalFailureClass[];
  scoreKindCounts?: {
    vector: number;
    rerank: number;
  };
  embedding?: {
    model: string;
    dimensions: number;
    version: string;
  };
}

export type RetrievalFailureClass =
  | 'embedding_failure'
  | 'invalid_embedding_shape'
  | 'missing_expected_page'
  | 'missing_expected_region'
  | 'misleading_context'
  | 'no_hits'
  | 'rerank_failure'
  | 'storage_failure';

export interface RetrievalHitScore {
  rank: number;
  id: string;
  source: string;
  page: number | null;
  chunkIndex: number;
  game: string;
  score: number;
  scoreKind: 'vector' | 'rerank';
}

export interface RetrievalQueryScore {
  recordId: string;
  query: string;
  expectedSource: string;
  expectedPage: number;
  expectedRegion?: GroundTruthRecord['region'];
  top1Hit: boolean;
  top3Hit: boolean;
  top5Hit: boolean;
  citeableContextHit: boolean;
  hits: RetrievalHitScore[];
  failureClasses: RetrievalFailureClass[];
}

export interface ExtractionScoreSummary {
  provider: ExtractionArtifact['provider'];
  providerVersion: string;
  text: TextScoreSummary;
  structure: StructureScoreSummary;
  retrieval: RetrievalScoreSummary;
  latencyMs: number | null;
  cost: ExtractionArtifact['cost'];
  privacy: ExtractionArtifact['privacy'];
  failures: string[];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function requiredTerms(expectedText: string): string[] {
  return [
    ...new Set(
      normalizeText(expectedText)
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3),
    ),
  ];
}

function recall(expected: string[], actualText: string): number {
  if (expected.length === 0) return 1;
  const actual = normalizeText(actualText);
  const found = expected.filter((term) => actual.includes(term)).length;
  return found / expected.length;
}

function characterErrorRate(expected: string, actual: string): number {
  const a = normalizeText(expected);
  const b = normalizeText(actual);
  if (a.length === 0) return b.length === 0 ? 0 : 1;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = previous[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost);
      diagonal = old;
    }
  }
  return Math.min(1, previous[b.length] / a.length);
}

function pageForRecord(
  artifact: ExtractionArtifact,
  record: GroundTruthRecord,
): ExtractionPage | undefined {
  return artifact.pages.find((page) => page.pageNumber === record.page);
}

function tableCellMatches(page: ExtractionPage, record: GroundTruthRecord): number {
  let expectedCount = 0;
  let matchedCount = 0;
  for (const expectedTable of record.expectedTables) {
    for (const expectedCell of expectedTable.cells) {
      expectedCount += 1;
      if (
        page.tables.some((table) =>
          table.cells.some(
            (cell) =>
              cell.row === expectedCell.row &&
              cell.column === expectedCell.column &&
              normalizeText(cell.text) === normalizeText(expectedCell.text),
          ),
        )
      ) {
        matchedCount += 1;
      }
    }
  }
  return expectedCount === 0 ? 1 : matchedCount / expectedCount;
}

function containsMisleadingContext(page: ExtractionPage, record: GroundTruthRecord): boolean {
  const text = normalizeText(page.text);
  return record.forbiddenRetrievalContextTerms.some((term) => text.includes(normalizeText(term)));
}

function earliestBlockOrder(
  page: ExtractionPage,
  predicate: (block: ExtractionPage['blocks'][number]) => boolean,
): number | undefined {
  const orders = page.blocks
    .map((block, index) => (predicate(block) ? (block.order ?? index) : undefined))
    .filter((order): order is number => order !== undefined);
  if (orders.length === 0) return undefined;
  return Math.min(...orders);
}

function readingOrderScore(page: ExtractionPage): number {
  const headingOrder = earliestBlockOrder(page, (block) => block.type === 'heading');
  const contentOrder = earliestBlockOrder(
    page,
    (block) => block.type !== 'heading' && block.type !== 'page-number',
  );
  if (headingOrder === undefined || contentOrder === undefined) return 1;
  return headingOrder < contentOrder ? 1 : 0;
}

function noiseRatio(page: ExtractionPage): number {
  if (page.blocks.length === 0) return 0;
  const noisyBlocks = page.blocks.filter(
    (block) =>
      block.type === 'page-number' ||
      block.type === 'header' ||
      block.type === 'footer' ||
      /^\d+$/.test(block.text.trim()),
  );
  return noisyBlocks.length / page.blocks.length;
}

function average(values: number[]): number {
  if (values.length === 0) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function scoreExtractionArtifact(
  artifact: ExtractionArtifact,
  groundTruthInput: GroundTruthRecord[],
): ExtractionScoreSummary {
  const groundTruth = GroundTruthDatasetSchema.parse(groundTruthInput);
  const failures: string[] = [];
  const phraseRecalls: number[] = [];
  const characterErrorRates: number[] = [];
  const headingRecalls: number[] = [];
  const readingScores: number[] = [];
  const tableRecalls: number[] = [];
  const noiseScores: number[] = [];
  let queryCount = 0;
  let citeableContextHits = 0;

  for (const record of groundTruth) {
    const page = pageForRecord(artifact, record);
    queryCount += record.retrievalQueries.length;
    if (!page) {
      failures.push(`missing page ${record.page} for ${record.id}`);
      phraseRecalls.push(0);
      characterErrorRates.push(1);
      headingRecalls.push(0);
      tableRecalls.push(record.expectedTables.length > 0 ? 0 : 1);
      readingScores.push(0);
      noiseScores.push(1);
      continue;
    }

    const phraseRecall = recall(requiredTerms(record.expectedText), page.text);
    phraseRecalls.push(phraseRecall);
    characterErrorRates.push(characterErrorRate(record.expectedText, page.text));
    headingRecalls.push(recall(record.expectedHeadings.map(normalizeText), page.text));
    tableRecalls.push(tableCellMatches(page, record));
    readingScores.push(readingOrderScore(page));
    noiseScores.push(noiseRatio(page));

    if (record.retrievalQueries.length > 0) {
      if (containsMisleadingContext(page, record)) {
        failures.push(`misleading retrieval context on ${record.id}`);
      } else if (phraseRecall === 1) {
        citeableContextHits += record.retrievalQueries.length;
      }
    }

    const firstMeaningfulBlock = page.blocks.find((block) => block.type !== 'page-number');
    if (record.expectedHeadings.length > 0 && firstMeaningfulBlock?.type !== 'heading') {
      failures.push(`heading hierarchy mismatch on ${record.id}`);
    }
    if (record.expectedHeadings.length > 0 && page.blocks[0]?.type === 'page-number') {
      failures.push(`heading hierarchy starts after page-number noise on ${record.id}`);
    }
  }

  return {
    provider: artifact.provider,
    providerVersion: artifact.providerVersion,
    text: {
      requiredPhraseRecall: average(phraseRecalls),
      averageCharacterErrorRate: average(characterErrorRates),
    },
    structure: {
      headingRecall: average(headingRecalls),
      readingOrderScore: average(readingScores),
      tableCellRecall: average(tableRecalls),
      noiseRatio: average(noiseScores),
    },
    retrieval: {
      queryCount,
      top1Hits: 0,
      top3Hits: 0,
      top5Hits: 0,
      citeableContextHits,
    },
    latencyMs: artifact.run.latencyMs ?? null,
    cost: artifact.cost,
    privacy: artifact.privacy,
    failures,
  };
}
