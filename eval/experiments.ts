import Anthropic from '@anthropic-ai/sdk';
import { LangfuseClient } from '@langfuse/client';
import { EVAL_MODELS_BY_PROVIDER, type EvalProviderConfig, type EvalToolSurface } from './cli.ts';
import { runAnthropicEvalCase, type AnthropicEvalCaseResult } from './anthropic-runner.ts';
import { DATASET_NAME } from './dataset.ts';
import { buildEvaluators, buildRunEvaluators, judgeAnswer } from './evaluators.ts';
import { validateRemoteDatasetShape, type EvalCase } from './schema.ts';
import type { AgentRunResult } from '../src/agent.ts';
import type { LangfuseTraceIngestionClient } from './trace.ts';

type AnthropicEvalProviderConfig = EvalProviderConfig & {
  provider: 'anthropic';
  model: (typeof EVAL_MODELS_BY_PROVIDER)['anthropic'][number];
};

function assertAnthropicProviderConfig(
  providerConfig: EvalProviderConfig,
): AnthropicEvalProviderConfig {
  if (
    providerConfig.provider === 'anthropic' &&
    (EVAL_MODELS_BY_PROVIDER.anthropic as readonly string[]).includes(providerConfig.model)
  ) {
    return providerConfig as AnthropicEvalProviderConfig;
  }
  throw new Error(`Provider runner is not implemented yet for ${providerConfig.provider}.`);
}

function traceClientFor(langfuse: LangfuseClient): LangfuseTraceIngestionClient {
  return langfuse as unknown as LangfuseTraceIngestionClient;
}

function datasetItemCase(item: {
  input?: unknown;
  metadata?: unknown;
}): Pick<EvalCase, 'id' | 'category' | 'source' | 'question'> {
  const input = item.input as { question?: string } | undefined;
  const metadata = item.metadata as { id?: string; category?: string; source?: string } | undefined;
  return {
    id: metadata?.id ?? 'unknown-case',
    category: metadata?.category ?? 'unknown',
    source: metadata?.source ?? 'langfuse',
    question: input?.question ?? '',
  };
}

async function traceScoresForCase(
  anthropic: Anthropic,
  evalCase: Pick<EvalCase, 'question' | 'finalAnswer'>,
  result: AgentRunResult,
) {
  if (!evalCase.finalAnswer) return undefined;

  const verdict = await judgeAnswer(
    anthropic,
    evalCase.question,
    evalCase.finalAnswer.expected,
    evalCase.finalAnswer.grading,
    result.answer,
  );

  return [
    {
      name: 'correctness',
      value: verdict.score / 5,
      comment: verdict.reasoning,
    },
    {
      name: 'pass',
      value: verdict.pass ? 'pass' : 'fail',
      comment: verdict.reasoning,
    },
  ];
}

export async function runOnDataset(
  langfuse: LangfuseClient,
  runName: string,
  toolSurface: EvalToolSurface,
  expectedCaseCount: number,
  providerConfig: EvalProviderConfig,
): Promise<void> {
  const anthropic = new Anthropic();
  const anthropicConfig = assertAnthropicProviderConfig(providerConfig);
  const dataset = await langfuse.dataset.get(DATASET_NAME);
  console.log(`Dataset has ${dataset.items.length} items`);
  validateRemoteDatasetShape(dataset.items, expectedCaseCount, DATASET_NAME);

  const result = await dataset.runExperiment({
    name: runName,
    maxConcurrency: 1,
    task: async (item) => {
      const meta = item.metadata as { id?: string } | undefined;
      const evalCase = datasetItemCase(item);
      const expected = item.expectedOutput as Pick<EvalCase, 'finalAnswer'> | undefined;
      process.stdout.write(`  ${meta?.id ?? '?'}... `);
      return runAnthropicEvalCase({
        case: evalCase,
        runLabel: runName,
        toolSurface,
        providerConfig: anthropicConfig,
        traceClient: traceClientFor(langfuse),
        scoreResult: (result) =>
          traceScoresForCase(
            anthropic,
            { ...evalCase, finalAnswer: expected?.finalAnswer },
            result,
          ),
      });
    },
    evaluators: buildEvaluators(anthropic),
    runEvaluators: buildRunEvaluators(),
  });

  console.log('\n' + (await result.format()));
  if (result.datasetRunUrl) {
    console.log(`\nView in Langfuse: ${result.datasetRunUrl}`);
  }
}

export async function runFiltered(
  langfuse: LangfuseClient,
  cases: EvalCase[],
  runName: string,
  toolSurface: EvalToolSurface,
  providerConfig: EvalProviderConfig,
): Promise<void> {
  const anthropic = new Anthropic();
  const anthropicConfig = assertAnthropicProviderConfig(providerConfig);

  const data = cases.map((c) => ({
    input: { question: c.question },
    expectedOutput: { finalAnswer: c.finalAnswer, trajectory: c.trajectory },
    metadata: {
      id: c.id,
      category: c.category,
      source: c.source,
      hasFinalAnswer: !!c.finalAnswer,
      hasTrajectory: !!c.trajectory,
    },
  }));

  const result = await langfuse.experiment.run({
    name: runName,
    data,
    maxConcurrency: 1,
    task: async (item) => {
      const meta = item.metadata as { id?: string } | undefined;
      const evalCase = datasetItemCase(item) as EvalCase;
      const expected = item.expectedOutput as Pick<EvalCase, 'finalAnswer'> | undefined;
      process.stdout.write(`  ${meta?.id ?? '?'}... `);
      return runAnthropicEvalCase({
        case: evalCase,
        runLabel: runName,
        toolSurface,
        providerConfig: anthropicConfig,
        traceClient: traceClientFor(langfuse),
        scoreResult: (result) =>
          traceScoresForCase(
            anthropic,
            { ...evalCase, finalAnswer: expected?.finalAnswer },
            result,
          ),
      }) satisfies Promise<AnthropicEvalCaseResult>;
    },
    evaluators: buildEvaluators(anthropic),
    runEvaluators: buildRunEvaluators(),
  });

  console.log('\n' + (await result.format()));
}
