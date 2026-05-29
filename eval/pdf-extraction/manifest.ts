import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ExtractionArtifact, RawArtifactRef } from './schema.ts';

export interface ExtractionManifestCache {
  key: string;
  hit: boolean;
}

export interface ExtractionManifestExecution {
  selectedPages: number[];
  fullRulebook: boolean;
  fullRulebookOverride: boolean;
  estimatedCostUsd?: number;
  maxEstimatedCostUsd?: number;
  costOverride: boolean;
  retryLimit: number;
  retryCount: number;
  timeoutMs?: number;
  concurrencyLimit?: number;
  rateLimitCount: number;
  refreshedProviderOutput: boolean;
}

export interface ExtractionManifestInput {
  artifactPath: string;
  normalizedArtifactHash: string;
  cache: ExtractionManifestCache;
  execution?: ExtractionManifestExecution;
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
  execution: ExtractionManifestExecution;
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
    execution: input.execution ?? {
      selectedPages: artifact.run.pageRange ?? artifact.pages.map((page) => page.pageNumber),
      fullRulebook: !artifact.run.pageRange || artifact.run.pageRange.length === 0,
      fullRulebookOverride: false,
      estimatedCostUsd: artifact.cost.estimatedUsd,
      maxEstimatedCostUsd: undefined,
      costOverride: false,
      retryLimit: 0,
      retryCount: 0,
      timeoutMs: undefined,
      concurrencyLimit: undefined,
      rateLimitCount: 0,
      refreshedProviderOutput: false,
    },
  };
}

export async function writeExtractionManifest(
  manifest: ExtractionManifest,
  manifestPath: string,
): Promise<void> {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
