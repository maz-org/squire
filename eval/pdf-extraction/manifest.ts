import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ExtractionArtifact, RawArtifactRef } from './schema.ts';

export interface ExtractionManifestCache {
  key: string;
  hit: boolean;
}

export interface ExtractionManifestInput {
  artifactPath: string;
  normalizedArtifactHash: string;
  cache: ExtractionManifestCache;
}

export interface ExtractionManifest {
  schemaVersion: 'squire-pdf-extraction-manifest-v1';
  provider: ExtractionArtifact['provider'];
  providerVersion: string;
  runId: string;
  runStatus: ExtractionArtifact['run']['status'];
  sourcePath: string;
  sourceHash: string;
  providerConfigHash: string;
  normalizedArtifactPath: string;
  normalizedArtifactHash: string;
  rawArtifacts: RawArtifactRef[];
  cost: ExtractionArtifact['cost'];
  privacy: ExtractionArtifact['privacy'];
  cache: ExtractionManifestCache;
}

export function buildExtractionManifest(
  artifact: ExtractionArtifact,
  input: ExtractionManifestInput,
): ExtractionManifest {
  return {
    schemaVersion: 'squire-pdf-extraction-manifest-v1',
    provider: artifact.provider,
    providerVersion: artifact.providerVersion,
    runId: artifact.run.id,
    runStatus: artifact.run.status,
    sourcePath: artifact.source.path,
    sourceHash: artifact.source.sha256,
    providerConfigHash: artifact.providerConfigHash,
    normalizedArtifactPath: input.artifactPath,
    normalizedArtifactHash: input.normalizedArtifactHash,
    rawArtifacts: artifact.rawArtifacts,
    cost: artifact.cost,
    privacy: artifact.privacy,
    cache: input.cache,
  };
}

export async function writeExtractionManifest(
  manifest: ExtractionManifest,
  manifestPath: string,
): Promise<void> {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
