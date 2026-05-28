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
    };

export interface PdfExtractionRunnerInput extends PdfExtractionRunInput {
  registry: ProviderRegistry;
  provider: PdfExtractionProviderId;
  artifactPath?: string;
  cache?: {
    key?: string;
    hit?: boolean;
  };
  onStatus?: (event: PdfExtractionStatusEvent) => void;
}

export interface PdfExtractionRunnerResult {
  artifact: ExtractionArtifact;
  manifest: ExtractionManifest;
}

function defaultArtifactPath(input: PdfExtractionRunnerInput): string {
  return `${input.outputDir}/normalized/${input.provider}/${input.runLabel}.json`;
}

function defaultCacheKey(artifact: ExtractionArtifact): string {
  const pages =
    artifact.run.pageRange?.join(',') ?? artifact.pages.map((page) => page.pageNumber).join(',');
  return `${artifact.provider}:${artifact.source.sha256}:${artifact.providerConfigHash}:${pages}`;
}

export async function runPdfExtraction(
  input: PdfExtractionRunnerInput,
): Promise<PdfExtractionRunnerResult> {
  const provider = input.registry.get(input.provider);
  input.onStatus?.({ stage: 'started', provider: input.provider, runLabel: input.runLabel });

  let rawArtifact: unknown;
  try {
    rawArtifact = await provider.extract({
      sourcePath: input.sourcePath,
      pages: input.pages,
      outputDir: input.outputDir,
      runLabel: input.runLabel,
      retryCount: input.retryCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.onStatus?.({
      stage: 'failed',
      provider: input.provider,
      runLabel: input.runLabel,
      failureClass: classifyProviderError(error),
      message,
    });
    throw error;
  }

  let artifact: ExtractionArtifact;
  try {
    artifact = validateExtractionArtifact(rawArtifact);
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

  const result = {
    artifact,
    manifest: buildExtractionManifest(artifact, {
      artifactPath: input.artifactPath ?? defaultArtifactPath(input),
      normalizedArtifactHash: computeStableSha256(artifact),
      cache: {
        key: input.cache?.key ?? defaultCacheKey(artifact),
        hit: input.cache?.hit ?? false,
      },
    }),
  };
  input.onStatus?.({
    stage: 'succeeded',
    provider: input.provider,
    runLabel: input.runLabel,
    manifest: result.manifest,
  });
  return result;
}
