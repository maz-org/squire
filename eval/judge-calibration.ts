import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

import { loadEvalCases } from './dataset.ts';
import { ANSWER_JUDGE_MODEL, ANSWER_JUDGE_PROMPT_VERSION, judgeAnswer } from './evaluators.ts';
import type { EvalCase, EvalGame } from './schema.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_JUDGE_CALIBRATION_FIXTURE_PATH = join(
  __dirname,
  'judge-calibration',
  'table-qa-reference.json',
);
export const DEFAULT_JUDGE_CALIBRATION_REPORT_JSON_PATH =
  'docs/plans/sqr-379-table-qa-judge-calibration.json';
export const DEFAULT_JUDGE_CALIBRATION_REPORT_MARKDOWN_PATH =
  'docs/plans/sqr-379-table-qa-judge-calibration.md';
export const ESTIMATED_JUDGE_COST_USD_PER_ITEM = 0.00025;

const CalibrationItemSchema = z
  .object({
    id: z.string().min(1),
    caseId: z.string().min(1),
    game: z.enum(['frosthaven', 'gloomhaven-2e']),
    expectedPass: z.boolean(),
    actualAnswer: z.string().min(1),
    rationale: z.string().min(1),
  })
  .strict();

const CalibrationFixtureSchema = z
  .object({
    version: z.literal(1),
    suite: z.literal('table-qa'),
    split: z.literal('dev'),
    description: z.string().min(1),
    items: z.array(CalibrationItemSchema).min(1),
  })
  .strict();

export type JudgeCalibrationFixture = z.infer<typeof CalibrationFixtureSchema>;
export type JudgeCalibrationItem = z.infer<typeof CalibrationItemSchema>;

export interface ResolvedJudgeCalibrationItem extends JudgeCalibrationItem {
  evalCase: EvalCase & { finalAnswer: NonNullable<EvalCase['finalAnswer']> };
}

export interface JudgeCalibrationVerdict {
  score: number;
  pass: boolean;
  reasoning: string;
}

export type JudgeCalibrationJudge = (
  item: ResolvedJudgeCalibrationItem,
) => Promise<JudgeCalibrationVerdict>;

export interface JudgeCalibrationResult {
  id: string;
  caseId: string;
  game: EvalGame;
  expectedPass: boolean;
  actualPass: boolean;
  score: number;
  agreement: boolean;
  reasoning: string;
  rationale: string;
}

export interface JudgeCalibrationReport {
  generatedAt: string;
  fixturePath: string;
  suite: 'table-qa';
  split: 'dev';
  judge: {
    model: string;
    promptVersion: string;
    promptChanged: false;
  };
  estimatedCostUsd: number;
  summary: {
    totalItems: number;
    agreedItems: number;
    disagreedItems: number;
    agreementRate: number;
    agreementThreshold: number;
    thresholdPass: boolean;
    byGame: Record<EvalGame, { totalItems: number; agreedItems: number; agreementRate: number }>;
  };
  results: JudgeCalibrationResult[];
}

export interface JudgeCalibrationOptions {
  fixturePath?: string;
  reportJsonPath?: string;
  reportMarkdownPath?: string;
  maxEstimatedCostUsd?: number;
  logProgress?: boolean;
  judge?: JudgeCalibrationJudge;
  now?: Date;
}

function relativeToCwd(path: string): string {
  const relativePath = relative(process.cwd(), path);
  return relativePath.startsWith('..') ? path : relativePath;
}

export function loadJudgeCalibrationFixture(
  fixturePath = DEFAULT_JUDGE_CALIBRATION_FIXTURE_PATH,
): JudgeCalibrationFixture {
  return CalibrationFixtureSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf-8')));
}

export function resolveJudgeCalibrationItems(
  fixture: JudgeCalibrationFixture,
  cases: EvalCase[] = loadEvalCases(),
): ResolvedJudgeCalibrationItem[] {
  const seenIds = new Set<string>();
  const seenCaseLabels = new Set<string>();

  return fixture.items.map((item) => {
    if (seenIds.has(item.id)) {
      throw new Error(`Duplicate judge calibration item id: ${item.id}`);
    }
    seenIds.add(item.id);

    const caseLabel = `${item.caseId}:${item.expectedPass ? 'pass' : 'fail'}`;
    if (seenCaseLabels.has(caseLabel)) {
      throw new Error(`Duplicate judge calibration verdict for ${caseLabel}`);
    }
    seenCaseLabels.add(caseLabel);

    const evalCase = cases.find((candidate) => candidate.id === item.caseId);
    if (!evalCase)
      throw new Error(`Unknown eval case in judge calibration fixture: ${item.caseId}`);
    if (evalCase.suite !== 'table-qa') {
      throw new Error(`Judge calibration case ${item.caseId} is not table-qa.`);
    }
    if (evalCase.split !== 'dev') {
      throw new Error(`Judge calibration case ${item.caseId} uses split ${evalCase.split}.`);
    }
    if (!evalCase.finalAnswer) {
      throw new Error(`Judge calibration case ${item.caseId} has no finalAnswer expectation.`);
    }
    if (evalCase.game !== item.game) {
      throw new Error(
        `Judge calibration case ${item.caseId} declares ${item.game}, but eval case is ${evalCase.game}.`,
      );
    }

    return {
      ...item,
      evalCase: evalCase as EvalCase & { finalAnswer: NonNullable<EvalCase['finalAnswer']> },
    };
  });
}

function byGameSummary(
  results: JudgeCalibrationResult[],
): Record<EvalGame, { totalItems: number; agreedItems: number; agreementRate: number }> {
  const summary = {
    frosthaven: { totalItems: 0, agreedItems: 0, agreementRate: 0 },
    'gloomhaven-2e': { totalItems: 0, agreedItems: 0, agreementRate: 0 },
  } satisfies Record<EvalGame, { totalItems: number; agreedItems: number; agreementRate: number }>;

  for (const result of results) {
    const game = summary[result.game];
    game.totalItems += 1;
    if (result.agreement) game.agreedItems += 1;
  }

  for (const game of Object.values(summary)) {
    game.agreementRate = game.totalItems === 0 ? 0 : game.agreedItems / game.totalItems;
  }

  return summary;
}

export function buildJudgeCalibrationReport(input: {
  fixturePath: string;
  results: JudgeCalibrationResult[];
  now: Date;
}): JudgeCalibrationReport {
  const agreedItems = input.results.filter((result) => result.agreement).length;
  const agreementThreshold = 0.85;
  const agreementRate = input.results.length === 0 ? 0 : agreedItems / input.results.length;

  return {
    generatedAt: input.now.toISOString(),
    fixturePath: relativeToCwd(input.fixturePath),
    suite: 'table-qa',
    split: 'dev',
    judge: {
      model: ANSWER_JUDGE_MODEL,
      promptVersion: ANSWER_JUDGE_PROMPT_VERSION,
      promptChanged: false,
    },
    estimatedCostUsd: input.results.length * ESTIMATED_JUDGE_COST_USD_PER_ITEM,
    summary: {
      totalItems: input.results.length,
      agreedItems,
      disagreedItems: input.results.length - agreedItems,
      agreementRate,
      agreementThreshold,
      thresholdPass: agreementRate >= agreementThreshold,
      byGame: byGameSummary(input.results),
    },
    results: input.results,
  };
}

export function formatJudgeCalibrationMarkdown(report: JudgeCalibrationReport): string {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const disagreements = report.results.filter((result) => !result.agreement);
  const disagreementRows =
    disagreements.length === 0
      ? '| Case | Expected | Judge | Score | Reasoning |\n| --- | --- | --- | --- | --- |\n| None | - | - | - | - |'
      : [
          '| Case | Expected | Judge | Score | Reasoning |',
          '| --- | --- | --- | --- | --- |',
          ...disagreements.map(
            (result) =>
              `| \`${result.caseId}\` | ${result.expectedPass ? 'pass' : 'fail'} | ${
                result.actualPass ? 'pass' : 'fail'
              } | ${result.score}/5 | ${result.reasoning.replaceAll('|', '\\|')} |`,
          ),
        ].join('\n');

  return `# SQR-379 Table-QA Judge Calibration

Generated: ${report.generatedAt}

## Summary

| Metric | Value |
| --- | --- |
| Fixture | \`${report.fixturePath}\` |
| Suite | \`${report.suite}\` |
| Split | \`${report.split}\` |
| Judge model | \`${report.judge.model}\` |
| Judge prompt version | \`${report.judge.promptVersion}\` |
| Judge prompt changed | ${report.judge.promptChanged ? 'yes' : 'no'} |
| Estimated judge spend | $${report.estimatedCostUsd.toFixed(4)} |
| Agreement | ${report.summary.agreedItems}/${report.summary.totalItems} (${percent(
    report.summary.agreementRate,
  )}) |
| Required agreement | ${percent(report.summary.agreementThreshold)} |
| Calibration gate | ${report.summary.thresholdPass ? 'pass' : 'fail'} |

## By Game

| Game | Agreement |
| --- | --- |
| Frosthaven | ${report.summary.byGame.frosthaven.agreedItems}/${
    report.summary.byGame.frosthaven.totalItems
  } (${percent(report.summary.byGame.frosthaven.agreementRate)}) |
| Gloomhaven 2e | ${report.summary.byGame['gloomhaven-2e'].agreedItems}/${
    report.summary.byGame['gloomhaven-2e'].totalItems
  } (${percent(report.summary.byGame['gloomhaven-2e'].agreementRate)}) |

## Disagreements

${disagreementRows}

## Notes

- This calibration uses only \`table-qa\` dev cases. Holdout cases were not used.
- Safety, groundedness, and source-boundary scoring remain deterministic and separate from this semantic answer judge.
- Judge prompt changes invalidate comparisons. This run did not change the judge prompt.
`;
}

export async function runJudgeCalibration(
  options: JudgeCalibrationOptions = {},
): Promise<JudgeCalibrationReport> {
  const fixturePath = options.fixturePath ?? DEFAULT_JUDGE_CALIBRATION_FIXTURE_PATH;
  const reportJsonPath = options.reportJsonPath ?? DEFAULT_JUDGE_CALIBRATION_REPORT_JSON_PATH;
  const reportMarkdownPath =
    options.reportMarkdownPath ?? DEFAULT_JUDGE_CALIBRATION_REPORT_MARKDOWN_PATH;
  const logProgress = options.logProgress ?? true;
  const fixture = loadJudgeCalibrationFixture(fixturePath);
  const items = resolveJudgeCalibrationItems(fixture);
  const estimatedCostUsd = items.length * ESTIMATED_JUDGE_COST_USD_PER_ITEM;
  const maxEstimatedCostUsd = options.maxEstimatedCostUsd ?? 1;
  if (estimatedCostUsd > maxEstimatedCostUsd) {
    throw new Error(
      `Judge calibration estimated cost $${estimatedCostUsd.toFixed(
        4,
      )} exceeds max $${maxEstimatedCostUsd.toFixed(4)}.`,
    );
  }

  const anthropic = options.judge ? undefined : new Anthropic();
  const judge =
    options.judge ??
    ((item: ResolvedJudgeCalibrationItem) =>
      judgeAnswer(
        anthropic!,
        item.evalCase.question,
        item.evalCase.finalAnswer.expected,
        item.evalCase.finalAnswer.grading,
        item.actualAnswer,
      ));
  const results: JudgeCalibrationResult[] = [];
  for (const item of items) {
    if (logProgress) process.stdout.write(`  ${item.id}... `);
    const verdict = await judge(item);
    const agreement = verdict.pass === item.expectedPass;
    if (logProgress) console.log(agreement ? 'match' : 'mismatch');
    results.push({
      id: item.id,
      caseId: item.caseId,
      game: item.game,
      expectedPass: item.expectedPass,
      actualPass: verdict.pass,
      score: verdict.score,
      agreement,
      reasoning: verdict.reasoning,
      rationale: item.rationale,
    });
  }

  const report = buildJudgeCalibrationReport({
    fixturePath,
    results,
    now: options.now ?? new Date(),
  });
  mkdirSync(dirname(reportJsonPath), { recursive: true });
  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  mkdirSync(dirname(reportMarkdownPath), { recursive: true });
  writeFileSync(reportMarkdownPath, formatJudgeCalibrationMarkdown(report));
  return report;
}

function valueFor(args: string[], prefix: string): string | undefined {
  const arg = args.find((candidate) => candidate.startsWith(prefix));
  if (!arg) return undefined;
  const value = arg.slice(prefix.length);
  if (!value) throw new Error(`Invalid ${prefix.slice(0, -1)}: value cannot be empty.`);
  return value;
}

function numberFor(args: string[], prefix: string, fallback: number): number {
  const value = valueFor(args, prefix);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${prefix.slice(0, -1)}: expected a positive number.`);
  }
  return parsed;
}

async function main(args: string[]): Promise<void> {
  const report = await runJudgeCalibration({
    fixturePath: valueFor(args, '--fixture='),
    reportJsonPath: valueFor(args, '--report-json='),
    reportMarkdownPath: valueFor(args, '--report-md='),
    maxEstimatedCostUsd: numberFor(args, '--max-estimated-cost-usd=', 1),
  });
  console.log(
    `\nJudge agreement: ${report.summary.agreedItems}/${report.summary.totalItems} (${(
      report.summary.agreementRate * 100
    ).toFixed(1)}%)`,
  );
  if (!report.summary.thresholdPass) {
    throw new Error('Judge calibration agreement is below the 85% threshold.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
