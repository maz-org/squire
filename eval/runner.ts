import { type EvalCliOptions, type EvalProviderConfig } from './cli.ts';
import {
  createLangSmithDatasetClient,
  filterEvalCases,
  loadEvalCases,
  seedDataset,
} from './dataset.ts';
import { compareEvalRuns, formatEvalRunComparison, readEvalMatrixReport } from './cost-harness.ts';
import { evalCaseHasFinalAnswer } from './schema.ts';
import { runLocalReport } from './local-report.ts';
import { langSmithProjectUrlFromEnv } from './langsmith-trace.ts';
import { runOpenAiLocalReport } from './openai-runner.ts';
import {
  assertEvalMatrixGuardrails,
  defaultEvalMatrixModels,
  formatEvalMatrixTable,
  runEvalMatrix,
  writeEvalMatrixLocalReport,
  type EvalMatrixProgressEvent,
  type EvalMatrixSelection,
} from './matrix.ts';
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
  console.log(
    `Running ${cases.length} eval case(s) across ${modelConfigs.length} model(s) and ${agentRuntimes.length} runtime(s) as "${options.runName}" on ${options.toolSurface} tools...\n`,
  );
  const langsmithProjectUrl = await langSmithProjectUrlFromEnv(env);
  const result = await runEvalMatrix({
    cases,
    runLabel: options.runName,
    toolSurface: options.toolSurface,
    selection,
    modelConfigs,
    agentRuntimes,
    runner: createEvalMatrixRunner(env),
    guardrails,
    langsmithProjectUrl,
    onProgress: (event) => console.log(formatEvalMatrixProgress(event)),
  });

  console.log(formatEvalMatrixTable(result.rows));
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

  if (options.providerConfig.provider === 'openai') {
    if (!options.localReportPath) {
      await runLangSmithMatrix(options, env, cases, [options.providerConfig], ['langgraph'], {
        ...options.matrixGuardrails,
        allowFullDataset: true,
      });
      return;
    }
    console.log(
      `Running ${cases.length} OpenAI eval(s) as "${options.runName}" on ${options.toolSurface} tools...\n`,
    );
    await runOpenAiLocalReport(
      cases,
      options.runName,
      options.providerConfig,
      options.toolSurface,
      options.localReportPath,
      env,
    );
    return;
  }

  if (options.localReportPath) {
    console.log(
      `Running ${cases.length} local eval(s) as "${options.runName}" on ${options.toolSurface} tools...\n`,
    );
    await runLocalReport(cases, options.runName, options.toolSurface, options.localReportPath);
    return;
  }

  await runLangSmithMatrix(options, env, cases, [options.providerConfig], ['langgraph'], {
    ...options.matrixGuardrails,
    allowFullDataset: true,
  });
}
