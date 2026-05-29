import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ExtractionScoreSummary } from './scoring.ts';
import type { ExtractionArtifact } from './schema.ts';

export interface PdfExtractionFailureMode {
  id:
    | 'reading-order'
    | 'page-numbers'
    | 'toc-ordering'
    | 'heading-noise'
    | 'broken-hyphenation'
    | 'sidebar-callout-insertion';
  label: string;
  observed: boolean;
  evidence: string[];
}

export interface PdfExtractionReportInput {
  artifact: ExtractionArtifact;
  score: ExtractionScoreSummary;
  normalizedArtifactPath: string;
  manifestPath: string;
}

export interface PdfExtractionReport {
  schemaVersion: 'squire-pdf-extraction-report-v1';
  provider: ExtractionArtifact['provider'];
  providerVersion: string;
  runId: string;
  baselineComparator: {
    provider: 'apple-vision';
    role: 'baseline';
  };
  normalizedArtifactPath: string;
  manifestPath: string;
  score: ExtractionScoreSummary;
  failureModes: PdfExtractionFailureMode[];
}

function pageEvidence(
  artifact: ExtractionArtifact,
  predicate: (page: ExtractionArtifact['pages'][number]) => boolean,
): string[] {
  return artifact.pages
    .filter(predicate)
    .map((page) => `page ${page.pageNumber}`)
    .slice(0, 5);
}

function hasContentsPage(page: ExtractionArtifact['pages'][number]): boolean {
  return /\b(contents|table of contents)\b/i.test(page.text);
}

function hasBrokenHyphenation(page: ExtractionArtifact['pages'][number]): boolean {
  return /\w-\s*\n\s*\w/.test(page.text) || /\w-\s*\n\s*\w/.test(page.markdown);
}

function hasPageNumberNoise(page: ExtractionArtifact['pages'][number]): boolean {
  return page.blocks.some(
    (block) => block.type === 'page-number' || /^\d+$/.test(block.text.trim()),
  );
}

function buildAppleVisionFailureModes(
  artifact: ExtractionArtifact,
  score: ExtractionScoreSummary,
): PdfExtractionFailureMode[] {
  const readingOrderEvidence = pageEvidence(artifact, (page) => {
    const headingOrder = page.blocks.find((block) => block.type === 'heading')?.order;
    const firstContentOrder = page.blocks.find(
      (block) => block.type !== 'heading' && block.type !== 'page-number',
    )?.order;
    return headingOrder !== undefined && firstContentOrder !== undefined
      ? headingOrder > firstContentOrder
      : false;
  });
  const pageNumberEvidence = pageEvidence(artifact, hasPageNumberNoise);
  const tocEvidence = pageEvidence(
    artifact,
    (page) => hasContentsPage(page) && page.blocks.some((block) => block.type !== 'heading'),
  );
  const hyphenEvidence = pageEvidence(artifact, hasBrokenHyphenation);
  const sidebarEvidence = pageEvidence(artifact, (page) =>
    page.blocks.some((block) => block.type === 'callout'),
  );

  return [
    {
      id: 'reading-order',
      label: 'Reading order',
      observed: score.structure.readingOrderScore < 1 || readingOrderEvidence.length > 0,
      evidence: readingOrderEvidence,
    },
    {
      id: 'page-numbers',
      label: 'Page numbers',
      observed: pageNumberEvidence.length > 0 || score.structure.noiseRatio > 0,
      evidence: pageNumberEvidence,
    },
    {
      id: 'toc-ordering',
      label: 'Table of contents ordering',
      observed: tocEvidence.length > 0,
      evidence: tocEvidence,
    },
    {
      id: 'heading-noise',
      label: 'Heading noise',
      observed: score.failures.some((failure) => /heading/i.test(failure)),
      evidence: score.failures.filter((failure) => /heading/i.test(failure)).slice(0, 5),
    },
    {
      id: 'broken-hyphenation',
      label: 'Broken hyphenation',
      observed: hyphenEvidence.length > 0,
      evidence: hyphenEvidence,
    },
    {
      id: 'sidebar-callout-insertion',
      label: 'Sidebar and callout insertion',
      observed:
        sidebarEvidence.length > 0 ||
        score.failures.some((failure) => /misleading retrieval context/i.test(failure)),
      evidence: [
        ...sidebarEvidence,
        ...score.failures.filter((failure) => /misleading retrieval context/i.test(failure)),
      ].slice(0, 5),
    },
  ];
}

export function buildPdfExtractionReport(input: PdfExtractionReportInput): PdfExtractionReport {
  return {
    schemaVersion: 'squire-pdf-extraction-report-v1',
    provider: input.artifact.provider,
    providerVersion: input.artifact.providerVersion,
    runId: input.artifact.run.id,
    baselineComparator: {
      provider: 'apple-vision',
      role: 'baseline',
    },
    normalizedArtifactPath: input.normalizedArtifactPath,
    manifestPath: input.manifestPath,
    score: input.score,
    failureModes: buildAppleVisionFailureModes(input.artifact, input.score),
  };
}

export async function writePdfExtractionReport(
  report: PdfExtractionReport,
  reportPath: string,
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
