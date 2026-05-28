import { Document } from '@langchain/core/documents';

import type { ExtractionArtifact } from './schema.ts';

export function toLangChainDocuments(artifact: ExtractionArtifact): Document[] {
  return artifact.pages.map(
    (page) =>
      new Document({
        pageContent: page.markdown || page.text,
        metadata: {
          artifactSchemaVersion: artifact.schemaVersion,
          provider: artifact.provider,
          providerVersion: artifact.providerVersion,
          providerConfigHash: artifact.providerConfigHash,
          source: artifact.source.path,
          sourceSha256: artifact.source.sha256,
          runId: artifact.run.id,
          pageNumber: page.pageNumber,
          width: page.width,
          height: page.height,
          unit: page.unit,
          blockCount: page.blocks.length,
          tableCount: page.tables.length,
        },
      }),
  );
}
