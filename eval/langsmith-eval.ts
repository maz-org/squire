import { Client } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';
import type { Example, Run } from 'langsmith/schemas';
import type {
  EvalAgentRuntime,
  EvalMatrixGuardrails,
  EvalProviderConfig,
  EvalToolSurface,
} from './cli.ts';
import { langSmithDatasetNameForCase } from './dataset.ts';
import {
  experimentNameForMatrixDataset,
  runMatrixInput,
  traceIdForMatrixRow,
  type EvalMatrixResult,
  type EvalMatrixRow,
  type EvalMatrixRunner,
  type EvalMatrixSelection,
} from './matrix.ts';
import type { EvalCase } from './schema.ts';

interface LangSmithNativeEvalOptions {
  cases: EvalCase[];
  examplesByDatasetName: Map<string, Example[]>;
  runLabel: string;
  toolSurface: EvalToolSurface;
  selection: EvalMatrixSelection;
  modelConfigs: EvalProviderConfig[];
  agentRuntimes: EvalAgentRuntime[];
  runner: EvalMatrixRunner;
  guardrails: EvalMatrixGuardrails;
  client: Client;
}

interface LangSmithEvaluationResults {
  results: Array<{
    key: string;
    score?: number | boolean | null;
    value?: number | boolean | string | object | null;
    comment?: string;
  }>;
}

function runUrl(projectUrl: string, runId: string): string {
  return `${projectUrl.replace(/\/$/, '')}/r/${runId}?poll=true`;
}

function targetOutputFrom(outputs: unknown): EvalMatrixRow | undefined {
  if (!outputs || typeof outputs !== 'object') return undefined;
  const record = outputs as Record<string, unknown>;
  const candidate =
    record.output && typeof record.output === 'object'
      ? (record.output as Record<string, unknown>)
      : record;
  return typeof candidate.caseId === 'string' ? (candidate as unknown as EvalMatrixRow) : undefined;
}

function millisecondsToSecondsScore(latencyMs: number | null): number | null {
  return latencyMs === null ? null : Number((latencyMs / 1000).toFixed(3));
}

function trimmedEnvValue(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function matrixRowEvaluator({
  outputs,
}: {
  outputs: Record<string, unknown>;
}): LangSmithEvaluationResults {
  const row = targetOutputFrom(outputs);
  if (!row) {
    return {
      results: [
        {
          key: 'squire_matrix_row',
          value: 'missing',
          comment: 'Squire target did not return a matrix row.',
        },
      ],
    };
  }

  return {
    results: [
      { key: 'pass', score: row.pass },
      { key: 'correctness', score: row.score },
      { key: 'failure_class', value: row.failureClass },
      { key: 'groundedness_pass', score: row.groundednessPass },
      { key: 'groundedness_failures', value: row.groundednessFailures?.join('; ') },
      { key: 'latency_ms', value: row.latencyMs },
      { key: 'latency_seconds', score: millisecondsToSecondsScore(row.latencyMs) },
      { key: 'first_answer_token_latency_ms', value: row.firstAnswerTokenLatencyMs },
      {
        key: 'first_answer_token_latency_seconds',
        score: millisecondsToSecondsScore(row.firstAnswerTokenLatencyMs),
      },
      { key: 'latency_budget_pass', score: row.latencyBudgetPass },
      { key: 'latency_budget_failures', value: row.latencyBudgetFailures?.join('; ') },
      { key: 'estimated_cost_usd', score: row.estimatedCostUsd },
      { key: 'retry_count', score: row.retryCount },
      { key: 'tool_call_count', score: row.toolCallCount },
      { key: 'loop_iterations', score: row.loopIterations },
    ].filter((result) => result.score != null || result.value != null),
  };
}

function caseIdFromInputs(inputs: Record<string, unknown>): string | undefined {
  return typeof inputs.caseId === 'string' ? inputs.caseId : undefined;
}

function examplesForCases(examples: Example[], cases: EvalCase[]): Example[] {
  const exampleIds = new Set(cases.map((evalCase) => evalCase.langsmithExampleId).filter(Boolean));
  return examples.filter((example) => exampleIds.has(example.id));
}

function experimentSuffix(
  agentRuntime: EvalAgentRuntime,
  providerConfig: EvalProviderConfig,
): string {
  return `${agentRuntime}-${providerConfig.provider}-${providerConfig.model}`;
}

function groupCasesByDataset(cases: EvalCase[]): Map<string, EvalCase[]> {
  const grouped = new Map<string, EvalCase[]>();
  for (const evalCase of cases) {
    const datasetName = langSmithDatasetNameForCase(evalCase);
    grouped.set(datasetName, [...(grouped.get(datasetName) ?? []), evalCase]);
  }
  return grouped;
}

export async function runLangSmithNativeEvalMatrix(
  options: LangSmithNativeEvalOptions,
): Promise<EvalMatrixResult> {
  const groupedCases = groupCasesByDataset(options.cases);
  const rows: EvalMatrixRow[] = [];
  const experimentUrls: string[] = [];

  for (const [datasetName, datasetCases] of groupedCases) {
    const examples = examplesForCases(
      options.examplesByDatasetName.get(datasetName) ?? [],
      datasetCases,
    );
    if (examples.length !== datasetCases.length) {
      throw new Error(
        `LangSmith dataset "${datasetName}" did not return every selected example. Run \`npm run eval -- --seed\` and retry.`,
      );
    }

    for (const agentRuntime of options.agentRuntimes) {
      for (const providerConfig of options.modelConfigs) {
        const caseById = new Map(datasetCases.map((evalCase) => [evalCase.id, evalCase]));
        const suffix = experimentSuffix(agentRuntime, providerConfig);
        const experimentPrefix = experimentNameForMatrixDataset(
          options.runLabel,
          datasetName,
          suffix,
        );

        const target = async (inputs: Record<string, unknown>) => {
          const caseId = caseIdFromInputs(inputs);
          const evalCase = caseId ? caseById.get(caseId) : undefined;
          if (!evalCase) {
            throw new Error(
              `LangSmith example input is missing a known caseId for dataset "${datasetName}". Run \`npm run eval -- --seed\` and retry.`,
            );
          }
          const traceId = traceIdForMatrixRow(
            options.runLabel,
            evalCase,
            agentRuntime,
            providerConfig,
          );
          return runMatrixInput(
            {
              evalCase,
              agentRuntime,
              providerConfig,
              runLabel: options.runLabel,
              toolSurface: options.toolSurface,
              traceId,
              traceUrl: traceId,
              referenceExampleId: evalCase.langsmithExampleId,
              attempt: 1,
            },
            options.runner,
            options.guardrails,
          );
        };

        const result = await evaluate(target, {
          data: examples,
          client: options.client,
          experimentPrefix,
          targetConcurrency: options.guardrails.providerConcurrency[providerConfig.provider],
          evaluationConcurrency: options.guardrails.providerConcurrency[providerConfig.provider],
          evaluators: [matrixRowEvaluator],
          metadata: {
            runLabel: options.runLabel,
            datasetName,
            retrievalExperimentDataset: trimmedEnvValue('SQUIRE_RETRIEVAL_EXPERIMENT_DATASET'),
            selection: options.selection,
            agentRuntime,
            provider: providerConfig.provider,
            model: providerConfig.model,
            toolSurface: options.toolSurface,
          },
        });
        const projectUrl = await options.client.getProjectUrl({
          projectName: result.experimentName,
        });
        experimentUrls.push(projectUrl);

        for (const row of result.results) {
          const outputRow = targetOutputFrom((row.run as Run).outputs);
          if (!outputRow) continue;
          const traceUrl = runUrl(projectUrl, row.run.id);
          rows.push({
            ...outputRow,
            traceId: row.run.id,
            traceUrl,
            langsmithTraceUrl: traceUrl,
            runUrl: traceUrl,
            langsmithExperimentName: result.experimentName,
            langsmithExperimentUrl: projectUrl,
          });
        }
      }
    }
  }

  return {
    runLabel: options.runLabel,
    rows,
    guardrailEstimatedCostUsd: rows.reduce((sum, row) => sum + row.guardrailEstimatedCostUsd, 0),
    estimatedCostUsd: Number(
      rows.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0).toFixed(6),
    ),
    langsmithExperimentUrls: [...new Set(experimentUrls)],
  };
}
