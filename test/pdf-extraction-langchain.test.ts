import { describe, expect, it } from 'vitest';

import { toLangChainDocuments } from '../eval/pdf-extraction/langchain.ts';
import {
  computeProviderConfigHash,
  type ExtractionArtifact,
} from '../eval/pdf-extraction/schema.ts';

const artifact = {
  schemaVersion: 'squire-pdf-extraction-v1',
  provider: 'apple-vision',
  providerVersion: 'macos-vision',
  providerConfigHash: computeProviderConfigHash({ recognitionLevel: 'accurate' }),
  source: {
    path: 'data/pdfs/gh2-rule-book.pdf',
    sha256: `sha256:${'1'.repeat(64)}`,
    pageCount: 74,
  },
  run: {
    id: 'run-apple-fixture',
    startedAt: '2026-05-28T00:00:00.000Z',
    completedAt: '2026-05-28T00:00:01.000Z',
    status: 'succeeded',
    pageRange: [30],
    latencyMs: 1_000,
  },
  cost: {
    estimatedUsd: 0,
    actualUsd: 0,
    pagesProcessed: 1,
    costPerPageUsd: 0,
  },
  privacy: {
    retentionPolicy: 'local only',
    trainingUse: 'not-used-for-training',
  },
  rawArtifacts: [],
  pages: [
    {
      pageNumber: 30,
      width: 612,
      height: 792,
      unit: 'pt',
      markdown: '## Loot\n\nLoot X text.',
      text: 'Loot\n\nLoot X text.',
      blocks: [{ id: 'heading', type: 'heading', order: 0, text: 'Loot' }],
      tables: [],
    },
  ],
} satisfies ExtractionArtifact;

describe('LangChain Document projection for PDF extraction artifacts', () => {
  it('projects pages into Document objects without becoming the canonical artifact', () => {
    const docs = toLangChainDocuments(artifact);

    expect(docs).toHaveLength(1);
    expect(docs[0].pageContent).toBe('## Loot\n\nLoot X text.');
    expect(docs[0].metadata).toMatchObject({
      artifactSchemaVersion: 'squire-pdf-extraction-v1',
      provider: 'apple-vision',
      providerVersion: 'macos-vision',
      source: 'data/pdfs/gh2-rule-book.pdf',
      sourceSha256: `sha256:${'1'.repeat(64)}`,
      pageNumber: 30,
      blockCount: 1,
      tableCount: 0,
    });
    expect(docs[0].metadata).not.toHaveProperty('rawArtifacts');
  });
});
