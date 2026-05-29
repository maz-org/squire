import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { scoreExtractionArtifact } from '../eval/pdf-extraction/scoring.ts';
import {
  GroundTruthDatasetSchema,
  computeProviderConfigHash,
  type ExtractionArtifact,
  type GroundTruthRecord,
} from '../eval/pdf-extraction/schema.ts';

const groundTruthPath = new URL(
  '../eval/pdf-extraction/ground-truth/gh2-rulebook-v1.json',
  import.meta.url,
);

const requiredCategories = [
  'toc-ordering',
  'line-of-sight',
  'advantage-disadvantage',
  'conditions-positive',
  'conditions-negative',
  'suffer-damage',
  'character-damage-negation',
  'loot',
  'monster-focus',
  'monster-movement',
  'campaign-overview',
  'city-phase',
  'table-reference',
  'diagram-icon-heavy',
  'dense-reference',
  'heading-noise',
  'broken-hyphenation',
  'sidebar-callout-insertion',
] as const;

function loadGroundTruth(): {
  rawRecords: Record<string, unknown>[];
  records: GroundTruthRecord[];
} {
  const raw = JSON.parse(readFileSync(groundTruthPath, 'utf8')) as unknown;
  expect(Array.isArray(raw)).toBe(true);
  const rawRecords = raw as Record<string, unknown>[];
  return {
    rawRecords,
    records: GroundTruthDatasetSchema.parse(raw),
  };
}

function buildScoringFixture(records: GroundTruthRecord[]): ExtractionArtifact {
  const recordsByPage = new Map<number, GroundTruthRecord[]>();
  for (const record of records) {
    const pageRecords = recordsByPage.get(record.page) ?? [];
    pageRecords.push(record);
    recordsByPage.set(record.page, pageRecords);
  }

  const pages: ExtractionArtifact['pages'] = [...recordsByPage.entries()].map(
    ([pageNumber, pageRecords]) => {
      const headings = [...new Set(pageRecords.flatMap((record) => record.expectedHeadings))];
      const text = [...headings, ...pageRecords.map((record) => record.expectedText)].join('\n\n');
      const headingBlocks: ExtractionArtifact['pages'][number]['blocks'] = headings.map(
        (heading, index) => ({
          id: `p${pageNumber}-heading-${index}`,
          type: 'heading',
          order: index,
          text: heading,
        }),
      );
      const bodyBlocks: ExtractionArtifact['pages'][number]['blocks'] = pageRecords.map(
        (record, index) => ({
          id: `${record.id}-body`,
          type: 'paragraph',
          order: headings.length + index,
          text: record.expectedText,
        }),
      );
      const tables: ExtractionArtifact['pages'][number]['tables'] = pageRecords.flatMap(
        (record, recordIndex) =>
          record.expectedTables.map((table, tableIndex) => ({
            id: table.id,
            order: headingBlocks.length + bodyBlocks.length + recordIndex + tableIndex,
            cells: table.cells.map((cell) => ({
              ...cell,
              rowSpan: 1,
              columnSpan: 1,
            })),
          })),
      );

      return {
        pageNumber,
        width: 612,
        height: 792,
        unit: 'pt',
        markdown: text,
        text,
        blocks: [...headingBlocks, ...bodyBlocks],
        tables,
      };
    },
  );

  return {
    schemaVersion: 'squire-pdf-extraction-v1',
    provider: 'marker-datalab',
    providerVersion: 'ground-truth-review-fixture',
    providerConfigHash: computeProviderConfigHash({ fixture: 'gh2-rulebook-ground-truth' }),
    source: {
      path: 'data/pdfs/gh2-rule-book.pdf',
      sha256: `sha256:${'1'.repeat(64)}`,
      pageCount: 74,
    },
    run: {
      id: 'gh2-rulebook-ground-truth-review',
      startedAt: '2026-05-29T00:00:00.000Z',
      completedAt: '2026-05-29T00:00:01.000Z',
      status: 'succeeded',
      pageRange: pages.map((page) => page.pageNumber).sort((left, right) => left - right),
      latencyMs: 1_000,
    },
    cost: {
      estimatedUsd: 0,
      actualUsd: 0,
      pagesProcessed: pages.length,
      costPerPageUsd: 0,
    },
    privacy: {
      retentionPolicy: 'local fixture only',
      trainingUse: 'not-used-for-training',
    },
    rawArtifacts: [],
    pages,
  };
}

describe('GH2 PDF extraction ground truth dataset', () => {
  it('validates every record against the SQR-227 ground-truth schema', () => {
    const { rawRecords, records } = loadGroundTruth();

    expect(records.length).toBeGreaterThanOrEqual(25);
    expect(records.length).toBeLessThanOrEqual(40);
    expect(new Set(records.map((record) => record.id)).size).toBe(records.length);

    for (const [index, record] of records.entries()) {
      expect(rawRecords[index]).toHaveProperty('expectedHeadings');
      expect(rawRecords[index]).toHaveProperty('expectedTables');
      expect(record.source).toBe('data/pdfs/gh2-rule-book.pdf');
      expect(record.expectedText.length).toBeGreaterThanOrEqual(40);
      expect(record.expectedText.length).toBeLessThanOrEqual(650);
      expect(record.expectedHeadings.length).toBeGreaterThan(0);
      expect(record.retrievalQueries.length).toBeGreaterThan(0);
    }
  });

  it('covers the requested rules, reference layouts, and known Apple Vision failure modes', () => {
    const { records } = loadGroundTruth();
    const categories = new Set(records.map((record) => record.category));

    for (const category of requiredCategories) {
      expect(categories.has(category), `missing category: ${category}`).toBe(true);
    }

    const tableRecords = records.filter((record) =>
      ['toc-ordering', 'table-reference', 'diagram-icon-heavy', 'dense-reference'].includes(
        record.category,
      ),
    );
    expect(tableRecords.length).toBeGreaterThanOrEqual(6);
    expect(tableRecords.every((record) => record.expectedTables.length > 0)).toBe(true);
    expect(records.some((record) => record.forbiddenRetrievalContextTerms.length > 0)).toBe(true);
  });

  it('can be scored without depending on raw provider payloads', () => {
    const { records } = loadGroundTruth();
    const score = scoreExtractionArtifact(buildScoringFixture(records), records);
    const expectedQueryCount = records.reduce(
      (sum, record) => sum + record.retrievalQueries.length,
      0,
    );

    expect(score.failures).toEqual([]);
    expect(score.text.requiredPhraseRecall).toBe(1);
    expect(score.structure.headingRecall).toBe(1);
    expect(score.structure.tableCellRecall).toBe(1);
    expect(score.retrieval.queryCount).toBe(expectedQueryCount);
    expect(score.retrieval.citeableContextHits).toBe(expectedQueryCount);
  });
});
