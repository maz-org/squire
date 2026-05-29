import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { APPLE_VISION_PROVIDER_CONFIG_HASH } from './apple-vision.ts';
import { parsePdfExtractionArgs, type PdfExtractionCliOptions } from './cli.ts';
import { writeExtractionManifest } from './manifest.ts';
import type { ProviderRegistry } from './provider.ts';
import { createPdfExtractionProviderRegistry } from './providers.ts';
import { buildPdfExtractionReport, writePdfExtractionReport } from './report.ts';
import { runPdfExtraction, type PdfExtractionRunnerResult } from './runner.ts';
import type { ExtractionScoreSummary } from './scoring.ts';
import {
  GroundTruthDatasetSchema,
  type GroundTruthRecord,
  type PdfExtractionProviderId,
} from './schema.ts';

export interface PdfExtractionEvalRunDeps {
  registry?: ProviderRegistry;
  sourceHash?: string;
  providerConfigHash?: string;
  groundTruth?: GroundTruthRecord[];
  scoreArtifact?: (
    artifact: PdfExtractionRunnerResult['artifact'],
    groundTruth: GroundTruthRecord[],
    runId: string,
  ) => Promise<ExtractionScoreSummary>;
}

export interface PdfExtractionEvalRunResult extends PdfExtractionRunnerResult {
  manifestPath: string;
  reportPath: string;
  score: ExtractionScoreSummary;
  report: Awaited<ReturnType<typeof buildPdfExtractionReport>>;
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function fileSha256(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function providerConfigHash(provider: PdfExtractionProviderId, override?: string): string {
  if (override) return override;
  if (provider === 'apple-vision') return APPLE_VISION_PROVIDER_CONFIG_HASH;
  throw new Error(`Unsupported PDF extraction provider config: ${provider}.`);
}

function pageKey(pages: number[]): string {
  return pages.length === 0 ? 'full-rulebook' : `pages-${pages.join('-')}`;
}

function manifestPathFor(
  input: PdfExtractionCliOptions,
  sourceHash: string,
  configHash: string,
): string {
  return `${input.outputDir}/manifests/${input.provider}/${sourceHash.slice(7)}/${configHash.slice(7)}/${pageKey(input.pages)}.json`;
}

function reportPathFor(
  input: PdfExtractionCliOptions,
  sourceHash: string,
  configHash: string,
): string {
  return `${input.outputDir}/reports/${input.provider}/${sourceHash.slice(7)}/${configHash.slice(7)}/${pageKey(input.pages)}.json`;
}

async function loadGroundTruth(): Promise<GroundTruthRecord[]> {
  const raw = await readFile('eval/pdf-extraction/ground-truth/gh2-rulebook-v1.json', 'utf8');
  return GroundTruthDatasetSchema.parse(JSON.parse(raw));
}

function groundTruthForPages(records: GroundTruthRecord[], pages: number[]): GroundTruthRecord[] {
  if (pages.length === 0) return records;
  const selectedPages = new Set(pages);
  return records.filter((record) => selectedPages.has(record.page));
}

async function scoreWithProductionRetrieval(
  artifact: PdfExtractionRunnerResult['artifact'],
  groundTruth: GroundTruthRecord[],
  runId: string,
): Promise<ExtractionScoreSummary> {
  const { scoreExtractionArtifactWithProductionRetrieval } = await import('./retrieval-scoring.ts');
  return scoreExtractionArtifactWithProductionRetrieval(artifact, groundTruth, {
    runId,
    cleanup: true,
  });
}

export async function runPdfExtractionEval(
  input: PdfExtractionCliOptions,
  deps: PdfExtractionEvalRunDeps = {},
): Promise<PdfExtractionEvalRunResult> {
  const sourceHash = deps.sourceHash ?? (await fileSha256(input.sourcePath));
  const configHash = providerConfigHash(input.provider, deps.providerConfigHash);
  const result = await runPdfExtraction({
    registry: deps.registry ?? createPdfExtractionProviderRegistry(),
    provider: input.provider,
    sourcePath: input.sourcePath,
    sourceHash,
    providerConfigHash: configHash,
    pages: input.pages,
    outputDir: input.outputDir,
    runLabel: input.runLabel,
    retryCount: input.retryCount,
    allowFullRulebook: input.allowFullRulebook,
    allowEstimatedCostOverride: input.allowEstimatedCostOverride,
    maxEstimatedCostUsd: input.maxEstimatedCostUsd,
    estimatedCostUsd: input.provider === 'apple-vision' ? 0 : undefined,
    providerConcurrency: input.providerConcurrency,
    refreshProviderOutput: input.refreshProviderOutput,
    timeoutMs: input.timeoutMs,
  });
  const manifestPath = manifestPathFor(input, sourceHash, configHash);
  await writeExtractionManifest(result.manifest, manifestPath);

  const groundTruth = groundTruthForPages(
    deps.groundTruth ?? (await loadGroundTruth()),
    input.pages,
  );
  const score = await (deps.scoreArtifact ?? scoreWithProductionRetrieval)(
    result.artifact,
    groundTruth,
    input.runLabel,
  );
  const report = buildPdfExtractionReport({
    artifact: result.artifact,
    score,
    normalizedArtifactPath: result.manifest.normalizedArtifactPath,
    manifestPath,
  });
  const reportPath = reportPathFor(input, sourceHash, configHash);
  await writePdfExtractionReport(report, reportPath);

  return {
    ...result,
    manifestPath,
    reportPath,
    score,
    report,
  };
}

export async function runPdfExtractionCli(args: string[]): Promise<PdfExtractionEvalRunResult> {
  return runPdfExtractionEval(parsePdfExtractionArgs(args));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPdfExtractionCli(process.argv.slice(2))
    .then((result) => {
      console.log(
        JSON.stringify(
          {
            normalizedArtifactPath: result.manifest.normalizedArtifactPath,
            manifestPath: result.manifestPath,
            reportPath: result.reportPath,
            provider: result.artifact.provider,
            runId: result.artifact.run.id,
          },
          null,
          2,
        ),
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
