import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { buildExtractionManifest, type ExtractionManifest } from './manifest.ts';
import {
  classifyProviderError,
  type PdfExtractionRunInput,
  type ProviderRegistry,
} from './provider.ts';
import {
  computeStableSha256,
  validateExtractionArtifact,
  type ExtractionArtifact,
  type ExtractionFailureClass,
  type PdfExtractionProviderId,
} from './schema.ts';

export type PdfExtractionStatusEvent =
  | {
      stage: 'started';
      provider: PdfExtractionProviderId;
      runLabel: string;
    }
  | {
      stage: 'succeeded';
      provider: PdfExtractionProviderId;
      runLabel: string;
      manifest: ExtractionManifest;
    }
  | {
      stage: 'failed';
      provider: PdfExtractionProviderId;
      runLabel: string;
      failureClass: ExtractionFailureClass;
      message: string;
    }
  | {
      stage: 'retrying';
      provider: PdfExtractionProviderId;
      runLabel: string;
      failureClass: ExtractionFailureClass;
      message: string;
      retryCount: number;
    };

export interface PdfExtractionRunnerInput extends PdfExtractionRunInput {
  registry: ProviderRegistry;
  provider: PdfExtractionProviderId;
  sourceHash: string;
  providerConfigHash: string;
  artifactPath?: string;
  allowFullRulebook?: boolean;
  allowEstimatedCostOverride?: boolean;
  estimatedCostUsd?: number;
  maxEstimatedCostUsd?: number;
  providerConcurrency?: number;
  refreshProviderOutput?: boolean;
  onStatus?: (event: PdfExtractionStatusEvent) => void;
}

export interface PdfExtractionRunnerResult {
  artifact: ExtractionArtifact;
  manifest: ExtractionManifest;
}

function defaultArtifactPath(input: PdfExtractionRunnerInput): string {
  const pageKey = input.pages.length === 0 ? 'full-rulebook' : `pages-${input.pages.join('-')}`;
  return `${input.outputDir}/normalized/${input.provider}/${input.sourceHash.slice(7)}/${input.providerConfigHash.slice(7)}/${pageKey}.json`;
}

function defaultCacheKey(input: PdfExtractionRunnerInput): string {
  const pages = input.pages.length === 0 ? 'full-rulebook' : input.pages.join(',');
  return `${input.provider}:${input.sourceHash}:${input.providerConfigHash}:${pages}`;
}

function isRetryableFailure(failureClass: ExtractionFailureClass): boolean {
  return (
    failureClass === 'rate_limit' || failureClass === 'timeout' || failureClass === 'provider_error'
  );
}

function validateGuardrails(input: PdfExtractionRunnerInput): void {
  if (input.pages.length === 0 && !input.allowFullRulebook) {
    throw new Error('Full-rulebook PDF extraction requires --allow-full-rulebook.');
  }

  if (
    input.maxEstimatedCostUsd !== undefined &&
    input.estimatedCostUsd !== undefined &&
    input.estimatedCostUsd > input.maxEstimatedCostUsd &&
    !input.allowEstimatedCostOverride
  ) {
    throw new Error(
      `Estimated PDF extraction cost $${input.estimatedCostUsd.toFixed(2)} exceeds --max-estimated-cost-usd=${input.maxEstimatedCostUsd} and requires --allow-estimated-cost.`,
    );
  }

  if (
    input.providerConcurrency !== undefined &&
    (!Number.isInteger(input.providerConcurrency) || input.providerConcurrency < 1)
  ) {
    throw new Error(
      `Invalid ${input.provider} PDF extraction concurrency: expected a positive integer.`,
    );
  }

  if (input.retryCount < 0 || !Number.isInteger(input.retryCount)) {
    throw new Error('Invalid PDF extraction retry count: expected a non-negative integer.');
  }
}

async function readCachedArtifact(artifactPath: string): Promise<ExtractionArtifact | undefined> {
  try {
    const raw = await readFile(artifactPath, 'utf8');
    const artifact = validateExtractionArtifact(JSON.parse(raw));
    return artifact.run.status === 'succeeded' ? artifact : undefined;
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function writeNormalizedArtifact(
  artifactPath: string,
  artifact: ExtractionArtifact,
): Promise<void> {
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

function assertArtifactMatchesRequest(
  artifact: ExtractionArtifact,
  input: PdfExtractionRunnerInput,
): void {
  if (artifact.provider !== input.provider) {
    throw new Error(
      `Provider artifact mismatch: expected ${input.provider}, got ${artifact.provider}.`,
    );
  }
  if (artifact.source.sha256 !== input.sourceHash) {
    throw new Error(
      `Source artifact hash mismatch: expected ${input.sourceHash}, got ${artifact.source.sha256}.`,
    );
  }
  if (artifact.providerConfigHash !== input.providerConfigHash) {
    throw new Error(
      `Provider config artifact hash mismatch: expected ${input.providerConfigHash}, got ${artifact.providerConfigHash}.`,
    );
  }
}

function buildManifestForArtifact(
  artifact: ExtractionArtifact,
  input: PdfExtractionRunnerInput,
  artifactPath: string,
  cacheHit: boolean,
  retryCount: number,
  rateLimitCount: number,
): ExtractionManifest {
  return buildExtractionManifest(artifact, {
    artifactPath,
    normalizedArtifactHash: computeStableSha256(artifact),
    cache: {
      key: defaultCacheKey(input),
      hit: cacheHit,
    },
    execution: {
      selectedPages: input.pages,
      fullRulebook: input.pages.length === 0,
      fullRulebookOverride: input.allowFullRulebook ?? false,
      estimatedCostUsd: input.estimatedCostUsd ?? artifact.cost.estimatedUsd,
      maxEstimatedCostUsd: input.maxEstimatedCostUsd,
      costOverride: input.allowEstimatedCostOverride ?? false,
      retryLimit: input.retryCount,
      retryCount,
      timeoutMs: input.timeoutMs,
      concurrencyLimit: input.providerConcurrency,
      rateLimitCount,
      refreshedProviderOutput: input.refreshProviderOutput ?? false,
    },
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) return promise;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`PDF extraction provider timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runPdfExtraction(
  input: PdfExtractionRunnerInput,
): Promise<PdfExtractionRunnerResult> {
  const provider = input.registry.get(input.provider);
  validateGuardrails(input);

  input.onStatus?.({ stage: 'started', provider: input.provider, runLabel: input.runLabel });

  const artifactPath = input.artifactPath ?? defaultArtifactPath(input);
  const cachedArtifact = input.refreshProviderOutput
    ? undefined
    : await readCachedArtifact(artifactPath);
  if (cachedArtifact) {
    assertArtifactMatchesRequest(cachedArtifact, input);
    const manifest = buildManifestForArtifact(cachedArtifact, input, artifactPath, true, 0, 0);
    const result = { artifact: cachedArtifact, manifest };
    input.onStatus?.({
      stage: 'succeeded',
      provider: input.provider,
      runLabel: input.runLabel,
      manifest: result.manifest,
    });
    return result;
  }

  let rawArtifact: unknown;
  let observedRetryCount = 0;
  let rateLimitCount = 0;
  for (;;) {
    try {
      rawArtifact = await withTimeout(
        provider.extract({
          sourcePath: input.sourcePath,
          pages: input.pages,
          outputDir: input.outputDir,
          runLabel: input.runLabel,
          retryCount: input.retryCount,
          timeoutMs: input.timeoutMs,
        }),
        input.timeoutMs,
      );
      break;
    } catch (error) {
      const failureClass = classifyProviderError(error);
      if (failureClass === 'rate_limit') rateLimitCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      if (!isRetryableFailure(failureClass) || observedRetryCount >= input.retryCount) {
        input.onStatus?.({
          stage: 'failed',
          provider: input.provider,
          runLabel: input.runLabel,
          failureClass,
          message,
        });
        throw error;
      }
      observedRetryCount += 1;
      input.onStatus?.({
        stage: 'retrying',
        provider: input.provider,
        runLabel: input.runLabel,
        failureClass,
        message,
        retryCount: observedRetryCount,
      });
    }
  }

  let artifact: ExtractionArtifact;
  try {
    artifact = validateExtractionArtifact(rawArtifact);
    assertArtifactMatchesRequest(artifact, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.onStatus?.({
      stage: 'failed',
      provider: input.provider,
      runLabel: input.runLabel,
      failureClass: 'invalid_artifact',
      message,
    });
    throw new Error(
      `PDF extraction provider returned invalid artifact: ${provider.id}: ${message}`,
      {
        cause: error,
      },
    );
  }

  await writeNormalizedArtifact(artifactPath, artifact);
  const result = {
    artifact,
    manifest: buildManifestForArtifact(
      artifact,
      input,
      artifactPath,
      false,
      observedRetryCount,
      rateLimitCount,
    ),
  };
  input.onStatus?.({
    stage: 'succeeded',
    provider: input.provider,
    runLabel: input.runLabel,
    manifest: result.manifest,
  });
  return result;
}
