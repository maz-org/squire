import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildExtractionManifest,
  writeExtractionManifest,
} from '../eval/pdf-extraction/manifest.ts';
import {
  computeProviderConfigHash,
  type ExtractionArtifact,
} from '../eval/pdf-extraction/schema.ts';

const artifact = {
  schemaVersion: 'squire-pdf-extraction-v1',
  provider: 'llamaparse',
  providerVersion: 'latest-agentic',
  providerConfigHash: computeProviderConfigHash({ tier: 'agentic', output: ['markdown'] }),
  source: {
    path: 'data/pdfs/gh2-rule-book.pdf',
    sha256: `sha256:${'c'.repeat(64)}`,
    pageCount: 74,
  },
  run: {
    id: 'run-llamaparse-selected-pages',
    startedAt: '2026-05-28T00:00:00.000Z',
    completedAt: '2026-05-28T00:00:45.000Z',
    status: 'succeeded',
    pageRange: [30, 31],
    latencyMs: 45_000,
  },
  cost: {
    estimatedUsd: 0.1,
    pagesProcessed: 2,
    costPerPageUsd: 0.05,
  },
  privacy: {
    retentionPolicy: 'provider account default',
    trainingUse: 'unknown',
    region: 'us',
  },
  rawArtifacts: [
    {
      kind: 'provider-json',
      path: 'eval/results/pdf-extraction/raw/llamaparse/run.json',
      sha256: `sha256:${'d'.repeat(64)}`,
      redacted: true,
      persisted: false,
    },
  ],
  pages: [
    {
      pageNumber: 30,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown: '## Loot\n\nLoot text.',
      text: 'Loot\n\nLoot text.',
      blocks: [],
      tables: [],
    },
  ],
} satisfies ExtractionArtifact;

describe('PDF extraction manifests', () => {
  it('summarizes normalized and raw artifacts without embedding provider payloads', () => {
    const manifest = buildExtractionManifest(artifact, {
      artifactPath: 'eval/results/pdf-extraction/normalized/llamaparse/run.json',
      normalizedArtifactHash: `sha256:${'e'.repeat(64)}`,
      cache: { key: 'llamaparse:source:config', hit: false },
    });

    expect(manifest).toMatchObject({
      schemaVersion: 'squire-pdf-extraction-manifest-v1',
      provider: 'llamaparse',
      sourcePath: 'data/pdfs/gh2-rule-book.pdf',
      sourceHash: `sha256:${'c'.repeat(64)}`,
      providerConfigHash: artifact.providerConfigHash,
      normalizedArtifactHash: `sha256:${'e'.repeat(64)}`,
      normalizedArtifactPath: 'eval/results/pdf-extraction/normalized/llamaparse/run.json',
      cache: { key: 'llamaparse:source:config', hit: false },
    });
    expect(JSON.stringify(manifest)).not.toContain('Loot text');
    expect(manifest.rawArtifacts[0]).toEqual({
      kind: 'provider-json',
      path: 'eval/results/pdf-extraction/raw/llamaparse/run.json',
      sha256: `sha256:${'d'.repeat(64)}`,
      redacted: true,
      persisted: false,
    });
  });

  it('writes manifest JSON without embedding normalized page text', async () => {
    const manifest = buildExtractionManifest(artifact, {
      artifactPath: 'eval/results/pdf-extraction/normalized/llamaparse/run.json',
      normalizedArtifactHash: `sha256:${'e'.repeat(64)}`,
      cache: { key: 'llamaparse:source:config', hit: false },
    });
    const outputDir = await mkdtemp(join(tmpdir(), 'squire-pdf-extraction-'));
    const manifestPath = join(outputDir, 'nested', 'manifest.json');

    await writeExtractionManifest(manifest, manifestPath);

    const rawManifest = await readFile(manifestPath, 'utf8');
    expect(JSON.parse(rawManifest)).toMatchObject({
      schemaVersion: 'squire-pdf-extraction-manifest-v1',
      provider: 'llamaparse',
    });
    expect(rawManifest).not.toContain('Loot text');
  });
});
