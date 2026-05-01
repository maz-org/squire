import Anthropic from '@anthropic-ai/sdk';
import { LangfuseClient } from '@langfuse/client';
import { askFrosthavenWithTrajectory } from '../src/query.ts';
import type { EvalToolSurface } from './cli.ts';
import { DATASET_NAME } from './dataset.ts';
import { buildEvaluators, buildRunEvaluators } from './evaluators.ts';
import { validateRemoteDatasetShape, type EvalCase } from './schema.ts';

export async function runOnDataset(
  langfuse: LangfuseClient,
  runName: string,
  toolSurface: EvalToolSurface,
  expectedCaseCount: number,
): Promise<void> {
  const anthropic = new Anthropic();
  const dataset = await langfuse.dataset.get(DATASET_NAME);
  console.log(`Dataset has ${dataset.items.length} items`);
  validateRemoteDatasetShape(dataset.items, expectedCaseCount, DATASET_NAME);

  const result = await dataset.runExperiment({
    name: runName,
    maxConcurrency: 1,
    task: async (item) => {
      const question = (item.input as { question: string }).question;
      const meta = item.metadata as { id?: string } | undefined;
      process.stdout.write(`  ${meta?.id ?? '?'}... `);
      const startedAt = Date.now();
      const result = await askFrosthavenWithTrajectory(question, { toolSurface });
      return { ...result, durationMs: Date.now() - startedAt, toolSurface };
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
): Promise<void> {
  const anthropic = new Anthropic();

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
      const question = (item.input as { question: string }).question;
      const meta = item.metadata as { id?: string } | undefined;
      process.stdout.write(`  ${meta?.id ?? '?'}... `);
      const startedAt = Date.now();
      const result = await askFrosthavenWithTrajectory(question, { toolSurface });
      return { ...result, durationMs: Date.now() - startedAt, toolSurface };
    },
    evaluators: buildEvaluators(anthropic),
    runEvaluators: buildRunEvaluators(),
  });

  console.log('\n' + (await result.format()));
}
