import { type EvalCliOptions, type EvalProviderConfig } from './cli.ts';
import {
  createLangSmithDatasetClient,
  filterEvalCases,
  loadLangSmithEvalCases,
  loadEvalCases,
  seedDataset,
} from './dataset.ts';
import { compareEvalRuns, formatEvalRunComparison, readEvalMatrixReport } from './cost-harness.ts';
import { evalCaseHasFinalAnswer } from './schema.ts';
import {
  assertEvalMatrixGuardrails,
  defaultEvalMatrixModels,
  formatEvalMatrixTable,
  writeEvalMatrixLocalReport,
  type EvalMatrixProgressEvent,
  type EvalMatrixSelection,
} from './matrix.ts';
import { runLangSmithNativeEvalMatrix } from './langsmith-eval.ts';
import { createEvalMatrixRunner } from './matrix-runtime.ts';

function describeProviderConfig(config: EvalProviderConfig): string {
  const tuning = [
    config.reasoningEffort ? `reasoning=${config.reasoningEffort}` : undefined,
    config.maxOutputTokens ? `maxOutput=${config.maxOutputTokens}` : undefined,
    config.timeoutMs ? `timeoutMs=${config.timeoutMs}` : undefined,
    config.toolLoopLimit ? `toolLoopLimit=${config.toolLoopLimit}` : undefined,
    config.broadSearchSynthesisThreshold
      ? `broadSearchSynthesisThreshold=${config.broadSearchSynthesisThreshold}`
      : undefined,
  ].filter(Boolean);

  return `${config.provider}:${config.model}${tuning.length > 0 ? ` (${tuning.join(', ')})` : ''}`;
}

function describeAgentRuntimes(runtimes: string[]): string {
  return runtimes.join(',');
}

function formatProgressNullable(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return '-';
  return String(value);
}

export function formatEvalMatrixProgress(event: EvalMatrixProgressEvent): string {
  const { completed, total, row } = event;
  const status = row.pass === null ? '-' : row.pass ? 'pass' : 'fail';
  const latency = row.latencyMs === null ? '-' : `${row.latencyMs}ms`;
  return [
    `[${completed}/${total}]`,
    status,
    `${row.agentRuntime}:${row.provider}:${row.model}`,
    row.caseId,
    `failure=${row.failureClass}`,
    `score=${formatProgressNullable(row.score)}`,
    `latency=${latency}`,
    `tokens=${formatProgressNullable(row.tokenTotal)}`,
    `tools=${formatProgressNullable(row.toolCallCount)}`,
    `loops=${formatProgressNullable(row.loopIterations)}`,
  ].join(' ');
}

function assertCurrentRunnerSupportsProviderConfig(config: EvalProviderConfig): void {
  if (config.provider === 'openai') return;
  if (config.provider === 'anthropic') return;

  throw new Error(
    [
      `Eval provider config parsed as ${describeProviderConfig(config)}, but the provider runner is not implemented yet.`,
      'Supported eval providers are anthropic and openai.',
    ].join(' '),
  );
}

function assertCurrentCommandSupportsAgentRuntime(options: EvalCliOptions): void {
  if (options.matrixMode) return;
  if (options.matrixAgentRuntimes.every((runtime) => runtime === 'langgraph')) return;

  throw new Error('Deep Agents runtimes are eval-matrix only; pass --matrix with --agent-runtime.');
}

function selectionFor(options: EvalCliOptions): EvalMatrixSelection {
  if (options.idFilter) return 'id';
  if (options.gameFilter || options.suiteFilter) return 'suite';
  if (options.splitFilter) return 'split';
  return options.categoryFilter ? 'category' : 'all';
}

async function runLangSmithMatrix(
  options: EvalCliOptions,
  env: NodeJS.ProcessEnv,
  cases: ReturnType<typeof loadEvalCases>,
  modelConfigs: EvalProviderConfig[],
  agentRuntimes = options.matrixAgentRuntimes,
  guardrails = options.matrixGuardrails,
): Promise<void> {
  const selection = selectionFor(options);
  assertEvalMatrixGuardrails({
    cases,
    modelConfigs,
    agentRuntimes,
    selection,
    guardrails,
  });
  const client = await createLangSmithDatasetClient(env);
  const loaded = await loadLangSmithEvalCases(client, loadEvalCases(), options);
  cases = loaded.cases;
  console.log(
    `Running ${cases.length} LangSmith dataset eval case(s) across ${modelConfigs.length} model(s) and ${agentRuntimes.length} runtime(s) as "${options.runName}" on ${options.toolSurface} tools...\n`,
  );
  const result = await runLangSmithNativeEvalMatrix({
    cases,
    examplesByDatasetName: loaded.examplesByDatasetName,
    runLabel: options.runName,
    toolSurface: options.toolSurface,
    selection,
    modelConfigs,
    agentRuntimes,
    runner: createEvalMatrixRunner(env, { langSmithTracing: false }),
    guardrails,
    client,
  });

  console.log(formatEvalMatrixTable(result.rows));
  if (result.langsmithExperimentUrls?.length) {
    console.log(`\nLangSmith experiment(s):\n${result.langsmithExperimentUrls.join('\n')}`);
  }
  if (options.localReportPath) {
    writeEvalMatrixLocalReport(options.localReportPath, result);
    console.log(`\nWrote eval matrix report: ${options.localReportPath}`);
  }
}

export async function runEval(options: EvalCliOptions, env: NodeJS.ProcessEnv = process.env) {
  if (options.comparison) {
    const comparison = compareEvalRuns({
      before: readEvalMatrixReport(options.comparison.beforeReportPath),
      after: readEvalMatrixReport(options.comparison.afterReportPath),
    });
    console.log(formatEvalRunComparison(comparison));
    return;
  }

  const allCases = loadEvalCases();
  const cases = filterEvalCases(allCases, options);

  if (cases.length === 0) {
    throw new Error('No matching eval cases found.');
  }

  if (options.shouldSeed) {
    const finalAnswerCount = cases.filter(evalCaseHasFinalAnswer).length;
    console.log(
      `Loaded ${cases.length} eval case(s): ${finalAnswerCount} final-answer, ${cases.length - finalAnswerCount} trajectory-only.`,
    );
  }

  console.log(`Eval provider config: ${describeProviderConfig(options.providerConfig)}`);
  console.log(`Eval agent runtime: ${describeAgentRuntimes(options.matrixAgentRuntimes)}`);

  if (options.shouldSeed) {
    await seedDataset(await createLangSmithDatasetClient(env), cases);
    return;
  }

  assertCurrentRunnerSupportsProviderConfig(options.providerConfig);
  assertCurrentCommandSupportsAgentRuntime(options);

  if (options.matrixMode) {
    const modelConfigs = options.matrixAgentRuntimes.some((runtime) => runtime !== 'claude-sdk')
      ? [options.providerConfig]
      : defaultEvalMatrixModels(options.providerConfig);
    await runLangSmithMatrix(options, env, cases, modelConfigs);
    return;
  }

  if (options.localReportPath) {
    throw new Error(
      'Local fixture-only eval execution has been removed. Use LangSmith credentials and dataset-backed eval execution; --local-report is supported through --matrix.',
    );
  }

  if (options.providerConfig.provider === 'openai') {
    await runLangSmithMatrix(options, env, cases, [options.providerConfig], ['langgraph'], {
      ...options.matrixGuardrails,
      allowFullDataset: true,
    });
    return;
  }

  await runLangSmithMatrix(options, env, cases, [options.providerConfig], ['langgraph'], {
    ...options.matrixGuardrails,
    allowFullDataset: true,
  });
}
