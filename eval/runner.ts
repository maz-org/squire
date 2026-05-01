import { LangfuseClient } from '@langfuse/client';
import { LANGFUSE_DEFAULT_BASE_URL } from '../src/instrumentation.ts';
import type { EvalCliOptions, EvalProviderConfig } from './cli.ts';
import { filterEvalCases, loadEvalCases, seedDataset } from './dataset.ts';
import { evalCaseHasFinalAnswer } from './schema.ts';
import { runFiltered, runOnDataset } from './experiments.ts';
import { runLocalReport } from './local-report.ts';
import { runOpenAiLocalReport } from './openai-runner.ts';

function describeProviderConfig(config: EvalProviderConfig): string {
  const tuning = [
    config.reasoningEffort ? `reasoning=${config.reasoningEffort}` : undefined,
    config.maxOutputTokens ? `maxOutput=${config.maxOutputTokens}` : undefined,
    config.timeoutMs ? `timeoutMs=${config.timeoutMs}` : undefined,
    config.toolLoopLimit ? `toolLoopLimit=${config.toolLoopLimit}` : undefined,
  ].filter(Boolean);

  return `${config.provider}:${config.model}${tuning.length > 0 ? ` (${tuning.join(', ')})` : ''}`;
}

function assertCurrentRunnerSupportsProviderConfig(config: EvalProviderConfig): void {
  if (config.provider === 'openai') return;

  const usesDefaultModel = config.provider === 'anthropic' && config.model === 'claude-sonnet-4-6';
  const hasFutureRunnerTuning =
    config.reasoningEffort || config.maxOutputTokens || config.timeoutMs || config.toolLoopLimit;
  if (usesDefaultModel && !hasFutureRunnerTuning) return;

  throw new Error(
    [
      `Eval provider config parsed as ${describeProviderConfig(config)}, but the provider runner is not implemented yet.`,
      'This SQR-124 contract only defines eval-only config and module boundaries.',
      'Use the existing default anthropic:claude-sonnet-4-6 runner until SQR-128/SQR-129 add provider-specific loops.',
    ].join(' '),
  );
}

export async function runEval(options: EvalCliOptions, env: NodeJS.ProcessEnv = process.env) {
  const allCases = loadEvalCases();
  const cases = filterEvalCases(allCases, options);
  const isFiltered = !!(options.categoryFilter || options.idFilter);

  if (cases.length === 0) {
    throw new Error('No matching eval cases found.');
  }

  if (options.shouldSeed) {
    const finalAnswerCount = allCases.filter(evalCaseHasFinalAnswer).length;
    console.log(
      `Loaded ${allCases.length} eval case(s): ${finalAnswerCount} final-answer, ${allCases.length - finalAnswerCount} trajectory-only.`,
    );
  }

  console.log(`Eval provider config: ${describeProviderConfig(options.providerConfig)}`);

  if (options.shouldSeed) {
    const langfuse = new LangfuseClient({
      baseUrl: env.LANGFUSE_BASEURL ?? LANGFUSE_DEFAULT_BASE_URL,
    });
    await seedDataset(langfuse, allCases);
    return;
  }

  assertCurrentRunnerSupportsProviderConfig(options.providerConfig);

  if (options.providerConfig.provider === 'openai') {
    if (!options.localReportPath) {
      throw new Error(
        'OpenAI Responses evals currently require --local-report so the SQR-127 trace artifacts are written to a local report. Langfuse matrix wiring lands in SQR-131.',
      );
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

  const langfuse = new LangfuseClient({
    baseUrl: env.LANGFUSE_BASEURL ?? LANGFUSE_DEFAULT_BASE_URL,
  });

  console.log(
    `Running ${cases.length} eval(s) as "${options.runName}" on ${options.toolSurface} tools...\n`,
  );
  if (isFiltered) {
    await runFiltered(langfuse, cases, options.runName, options.toolSurface);
  } else {
    await runOnDataset(langfuse, options.runName, options.toolSurface, allCases.length);
  }
}
