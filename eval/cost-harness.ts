import { readFileSync } from 'node:fs';
import type { EvalMatrixResult, EvalMatrixRow } from './matrix.ts';

export interface EvalRunComparisonInput {
  before: EvalMatrixResult;
  after: EvalMatrixResult;
}

export interface EvalRunAggregate {
  passRate: number;
  averageScore: number | null;
  averageLatencyMs: number | null;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  averageToolCallCount: number | null;
  averageRetryCount: number;
  timeoutRate: number;
  averageLoopIterations: number | null;
  failureBreakdown: Record<string, number>;
}

export interface EvalRunAggregateDelta {
  passRate: number;
  averageScore: number | null;
  averageLatencyMs: number | null;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  averageToolCallCount: number | null;
  averageRetryCount: number;
  timeoutRate: number;
  averageLoopIterations: number | null;
}

export interface EvalRunComparisonGroup {
  provider: EvalMatrixRow['provider'];
  model: EvalMatrixRow['model'];
  casesCompared: number;
  before: EvalRunAggregate;
  after: EvalRunAggregate;
  delta: EvalRunAggregateDelta;
  diagnosis: string[];
}

export interface EvalRunComparison {
  beforeRunLabel: string;
  afterRunLabel: string;
  groups: EvalRunComparisonGroup[];
}

function rowKey(row: EvalMatrixRow): string {
  return `${row.caseId}:${row.provider}:${row.model}`;
}

function groupKey(row: EvalMatrixRow): string {
  return `${row.provider}:${row.model}`;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nullableDelta(after: number | null, before: number | null): number | null {
  if (after === null || before === null) return null;
  return after - before;
}

function numeric(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function aggregate(rows: EvalMatrixRow[]): EvalRunAggregate {
  const failureBreakdown: Record<string, number> = {};
  for (const row of rows) {
    failureBreakdown[row.failureClass] = (failureBreakdown[row.failureClass] ?? 0) + 1;
  }

  return {
    passRate: rows.filter((row) => row.pass === true).length / rows.length,
    averageScore: average(rows.map((row) => row.score).filter(numeric)),
    averageLatencyMs: average(rows.map((row) => row.latencyMs).filter(numeric)),
    totalTokens: rows
      .map((row) => row.tokenTotal)
      .filter(numeric)
      .reduce((sum, value) => sum + value, 0),
    totalEstimatedCostUsd: rows
      .map((row) => row.estimatedCostUsd)
      .filter(numeric)
      .reduce((sum, value) => sum + value, 0),
    averageToolCallCount: average(rows.map((row) => row.toolCallCount).filter(numeric)),
    averageRetryCount: rows.reduce((sum, row) => sum + row.retryCount, 0) / rows.length,
    timeoutRate: rows.filter((row) => row.failureClass === 'timeout').length / rows.length,
    averageLoopIterations: average(rows.map((row) => row.loopIterations).filter(numeric)),
    failureBreakdown,
  };
}

function delta(after: EvalRunAggregate, before: EvalRunAggregate): EvalRunAggregateDelta {
  return {
    passRate: after.passRate - before.passRate,
    averageScore: nullableDelta(after.averageScore, before.averageScore),
    averageLatencyMs: nullableDelta(after.averageLatencyMs, before.averageLatencyMs),
    totalTokens: after.totalTokens - before.totalTokens,
    totalEstimatedCostUsd: after.totalEstimatedCostUsd - before.totalEstimatedCostUsd,
    averageToolCallCount: nullableDelta(after.averageToolCallCount, before.averageToolCallCount),
    averageRetryCount: after.averageRetryCount - before.averageRetryCount,
    timeoutRate: after.timeoutRate - before.timeoutRate,
    averageLoopIterations: nullableDelta(after.averageLoopIterations, before.averageLoopIterations),
  };
}

function increasedFailure(
  before: EvalRunAggregate,
  after: EvalRunAggregate,
  failureClass: string,
): boolean {
  return (after.failureBreakdown[failureClass] ?? 0) > (before.failureBreakdown[failureClass] ?? 0);
}

function decreasedFailure(
  before: EvalRunAggregate,
  after: EvalRunAggregate,
  failureClass: string,
): boolean {
  return (after.failureBreakdown[failureClass] ?? 0) < (before.failureBreakdown[failureClass] ?? 0);
}

function diagnose(before: EvalRunAggregate, after: EvalRunAggregate): string[] {
  const reasons: string[] = [];
  if (
    after.passRate > before.passRate &&
    (decreasedFailure(before, after, 'quality') ||
      decreasedFailure(before, after, 'answer_quality'))
  ) {
    reasons.push('raw_answer_quality improved');
  }
  if (after.timeoutRate < before.timeoutRate) reasons.push('timeouts improved');
  if (increasedFailure(before, after, 'timeout')) reasons.push('timeouts worsened');
  if (increasedFailure(before, after, 'rate_limit'))
    reasons.push('provider_rate_limiting worsened');
  if (increasedFailure(before, after, 'cost_guardrail')) reasons.push('cost_guardrails worsened');
  if (
    increasedFailure(before, after, 'loop_limit') ||
    increasedFailure(before, after, 'iteration_limit')
  ) {
    reasons.push('loop_budget worsened');
  }
  if (
    increasedFailure(before, after, 'quality') ||
    increasedFailure(before, after, 'answer_quality')
  ) {
    reasons.push('raw_answer_quality worsened');
  }
  if (after.passRate < before.passRate && reasons.length === 0) reasons.push('accuracy worsened');
  if (reasons.length === 0) reasons.push('no obvious regression driver');
  return reasons;
}

function assertCompatibleRows(before: EvalMatrixRow, after: EvalMatrixRow): void {
  const mismatches = [
    before.promptVersion !== after.promptVersion ? 'promptVersion' : undefined,
    before.promptHash !== after.promptHash ? 'promptHash' : undefined,
    before.toolSurface !== after.toolSurface ? 'toolSurface' : undefined,
    before.toolSchemaVersion !== after.toolSchemaVersion ? 'toolSchemaVersion' : undefined,
    before.toolSchemaHash !== after.toolSchemaHash ? 'toolSchemaHash' : undefined,
  ].filter(Boolean);

  if (mismatches.length > 0) {
    throw new Error(
      `Cannot compare ${before.runLabel} to ${after.runLabel}: incompatible ${mismatches.join(', ')} for ${before.caseId} ${before.provider}:${before.model}.`,
    );
  }
}

export function compareEvalRuns(input: EvalRunComparisonInput): EvalRunComparison {
  const beforeRows = new Map(input.before.rows.map((row) => [rowKey(row), row]));
  const pairs: Array<{ before: EvalMatrixRow; after: EvalMatrixRow }> = [];

  for (const after of input.after.rows) {
    const before = beforeRows.get(rowKey(after));
    if (!before) continue;
    assertCompatibleRows(before, after);
    pairs.push({ before, after });
  }

  if (pairs.length === 0) {
    throw new Error(
      `Cannot compare ${input.before.runLabel} to ${input.after.runLabel}: no matching case/provider/model rows.`,
    );
  }

  const grouped = new Map<string, Array<{ before: EvalMatrixRow; after: EvalMatrixRow }>>();
  for (const pair of pairs) {
    const key = groupKey(pair.after);
    grouped.set(key, [...(grouped.get(key) ?? []), pair]);
  }

  return {
    beforeRunLabel: input.before.runLabel,
    afterRunLabel: input.after.runLabel,
    groups: [...grouped.values()].map((pairsForGroup) => {
      const before = aggregate(pairsForGroup.map((pair) => pair.before));
      const after = aggregate(pairsForGroup.map((pair) => pair.after));
      const first = pairsForGroup[0].after;
      return {
        provider: first.provider,
        model: first.model,
        casesCompared: pairsForGroup.length,
        before,
        after,
        delta: delta(after, before),
        diagnosis: diagnose(before, after),
      };
    }),
  };
}

function formatNumber(value: number | null, digits = 3): string {
  if (value === null) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

export function formatEvalRunComparison(comparison: EvalRunComparison): string {
  const lines = [
    `Eval run comparison: ${comparison.beforeRunLabel} -> ${comparison.afterRunLabel}`,
    'model\tcases\tpass_delta\tlatency_delta_ms\ttoken_delta\tcost_delta_usd\tretry_delta\ttimeout_delta\tloop_delta\ttool_delta\tdiagnosis',
  ];

  for (const group of comparison.groups) {
    lines.push(
      [
        `${group.provider}:${group.model}`,
        group.casesCompared,
        formatNumber(group.delta.passRate),
        formatNumber(group.delta.averageLatencyMs),
        group.delta.totalTokens,
        formatNumber(group.delta.totalEstimatedCostUsd, 4),
        formatNumber(group.delta.averageRetryCount),
        formatNumber(group.delta.timeoutRate),
        formatNumber(group.delta.averageLoopIterations),
        formatNumber(group.delta.averageToolCallCount),
        group.diagnosis.join('; '),
      ].join('\t'),
    );
  }

  return lines.join('\n');
}

export function readEvalMatrixReport(path: string): EvalMatrixResult {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || !('runLabel' in parsed) || !('rows' in parsed)) {
    throw new Error(`Invalid eval matrix report: ${path}`);
  }
  return parsed as EvalMatrixResult;
}
