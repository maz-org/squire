import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildGh2RulebookMarkdown,
  parseGh2RulebookRefreshArgs,
  promoteGh2RulebookArtifact,
} from '../scripts/refresh-gh2-rulebook-source.ts';
import type { ExtractionArtifact } from '../eval/pdf-extraction/schema.ts';

const markerDatalabArtifact = {
  schemaVersion: 'squire-pdf-extraction-v1',
  provider: 'marker-datalab',
  providerVersion: 'datalab-convert-v1-marker-chandra',
  providerConfigHash: `sha256:${'2'.repeat(64)}`,
  source: {
    path: 'data/pdfs/gh2-rule-book.pdf',
    sha256: `sha256:${'1'.repeat(64)}`,
    pageCount: 2,
  },
  run: {
    id: 'marker-datalab-full-rulebook',
    startedAt: '2026-06-01T01:00:00.000Z',
    completedAt: '2026-06-01T01:05:00.000Z',
    status: 'succeeded',
    latencyMs: 300_000,
  },
  cost: {
    estimatedUsd: 0.012,
    actualUsd: 0.02,
    pagesProcessed: 2,
    costPerPageUsd: 0.006,
  },
  privacy: {
    retentionPolicy: 'temporary hosted results',
    trainingUse: 'not-used-for-training',
    region: 'us',
  },
  rawArtifacts: [],
  pages: [
    {
      pageNumber: 2,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown: 'Table of Contents\n\nForced Movement........30',
      text: 'Table of Contents\nForced Movement........30',
      blocks: [],
      tables: [],
    },
    {
      pageNumber: 1,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown: '## # GLOOMHAVEN\nRULEBOOK',
      text: 'GLOOMHAVEN\nRULEBOOK',
      blocks: [],
      tables: [],
    },
  ],
} satisfies ExtractionArtifact;

describe('GH2 rulebook refresh source promotion', () => {
  it('parses the production refresh command defaults for Marker/Datalab', () => {
    expect(parseGh2RulebookRefreshArgs([])).toMatchObject({
      sourcePath: 'data/pdfs/gh2-rule-book.pdf',
      outputPath: 'data/rule-sources/gh2-rule-book.md',
      metadataPath: 'data/rule-sources/metadata.json',
      outputDir: 'eval/results/pdf-extraction',
      maxEstimatedCostUsd: 0.5,
      timeoutMs: 1_800_000,
      refreshProviderOutput: false,
    });

    expect(
      parseGh2RulebookRefreshArgs([
        '--capture-date=2026-06-01',
        '--max-estimated-cost-usd=0.74',
        '--refresh-provider-output',
      ]),
    ).toMatchObject({
      capturedAt: '2026-06-01',
      maxEstimatedCostUsd: 0.74,
      refreshProviderOutput: true,
    });
  });

  it('builds a stable Markdown snapshot from a full Marker/Datalab artifact', () => {
    const markdown = buildGh2RulebookMarkdown({
      artifact: markerDatalabArtifact,
      normalizedArtifactHash: `sha256:${'3'.repeat(64)}`,
      manifestPath: 'eval/results/pdf-extraction/manifests/marker-datalab/full-rulebook.json',
      reportPath: 'eval/results/pdf-extraction/reports/marker-datalab/full-rulebook.json',
    });

    expect(markdown).toContain('# Gloomhaven (2nd Edition) Rulebook Text Snapshot');
    expect(markdown).toContain('Provider: Marker/Datalab');
    expect(markdown.indexOf('## Page 1')).toBeLessThan(markdown.indexOf('## Page 2'));
    expect(markdown).toContain('# GLOOMHAVEN');
    expect(markdown).not.toContain('## # GLOOMHAVEN');
    expect(markdown).toContain('Apple Vision remains the local fallback extraction path.');
  });

  it('rejects selected-page artifacts before replacing the production source', () => {
    expect(() =>
      buildGh2RulebookMarkdown({
        artifact: {
          ...markerDatalabArtifact,
          run: { ...markerDatalabArtifact.run, pageRange: [30] },
        },
        normalizedArtifactHash: `sha256:${'3'.repeat(64)}`,
        manifestPath: 'manifest.json',
        reportPath: 'report.json',
      }),
    ).toThrow('Expected full-rulebook Marker/Datalab artifact');
  });

  it('updates the stable source file and metadata with extraction provenance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'squire-gh2-rulebook-refresh-'));
    const outputPath = join(dir, 'gh2-rule-book.md');
    const metadataPath = join(dir, 'metadata.json');
    await writeFile(
      metadataPath,
      `${JSON.stringify(
        [
          {
            id: 'gh2-rule-book',
            file: 'data/pdfs/gh2-rule-book.pdf',
            normalizedFile: 'data/rule-sources/gh2-rule-book.md',
            game: 'gloomhaven-2e',
            sourceType: 'rulebook',
            sourceUrl: 'https://example.invalid',
            capturedAt: '2026-05-24',
            refreshNotes: 'old notes',
          },
        ],
        null,
        2,
      )}\n`,
      'utf8',
    );

    const result = await promoteGh2RulebookArtifact({
      artifact: markerDatalabArtifact,
      outputPath,
      metadataPath,
      capturedAt: '2026-06-01',
      manifestPath: 'eval/results/pdf-extraction/manifests/marker-datalab/full-rulebook.json',
      reportPath: 'eval/results/pdf-extraction/reports/marker-datalab/full-rulebook.json',
      normalizedArtifactPath:
        'eval/results/pdf-extraction/normalized/marker-datalab/full-rulebook.json',
      normalizedArtifactHash: `sha256:${'3'.repeat(64)}`,
    });

    const markdown = await readFile(outputPath, 'utf8');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Array<
      Record<string, unknown>
    >;

    expect(markdown).toContain('Captured: 2026-06-01');
    expect(result.normalizedFileHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(metadata[0]).toMatchObject({
      id: 'gh2-rule-book',
      sourceUrl:
        'https://drive.google.com/file/d/16TmmCKa6zVVObj2qM-vIj9RcEAC3nfMT/view?usp=sharing',
      capturedAt: '2026-06-01',
      extractionProvider: 'marker-datalab',
      extractionProviderVersion: 'datalab-convert-v1-marker-chandra',
      extractionProviderConfigHash: `sha256:${'2'.repeat(64)}`,
      extractionRunId: 'marker-datalab-full-rulebook',
      normalizedArtifactHash: `sha256:${'3'.repeat(64)}`,
      normalizedFileHash: result.normalizedFileHash,
      sourceHash: `sha256:${'1'.repeat(64)}`,
      fallbackExtractionProvider: 'apple-vision',
    });
    expect(metadata[0].refreshNotes).toContain('Gloomhaven (2nd Edition)');
    expect(metadata[0].fallbackRefreshCommand).toContain('ocr-pdf-apple-vision.swift');
  });
});
