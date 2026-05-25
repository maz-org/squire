import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as LangSmithClient } from 'langsmith';
import { EvalDatasetSchema, type EvalCase } from './schema.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATASET_NAME = 'frosthaven-qa';

export function loadEvalCases(): EvalCase[] {
  return EvalDatasetSchema.parse(
    JSON.parse(readFileSync(join(__dirname, 'dataset.json'), 'utf-8')),
  );
}

export function filterEvalCases(
  cases: EvalCase[],
  filters: { categoryFilter: string | undefined; idFilter: string | undefined },
): EvalCase[] {
  let selected = cases;
  if (filters.categoryFilter)
    selected = selected.filter((c) => c.category === filters.categoryFilter);
  if (filters.idFilter) selected = selected.filter((c) => c.id === filters.idFilter);
  return selected;
}

export async function seedDataset(client: LangSmithClient, cases: EvalCase[]): Promise<void> {
  console.log(`Seeding LangSmith dataset "${DATASET_NAME}" with ${cases.length} items...`);

  const hasDataset = await client.hasDataset({ datasetName: DATASET_NAME });
  if (!hasDataset) {
    await client.createDataset(DATASET_NAME, {
      description: 'Frosthaven rules Q&A evaluation set',
      metadata: { version: '1.0' },
    });
  }

  const existingExampleIds: string[] = [];
  for await (const example of client.listExamples({ datasetName: DATASET_NAME })) {
    existingExampleIds.push(example.id);
  }
  if (existingExampleIds.length > 0) {
    await client.deleteExamples(existingExampleIds, { hardDelete: true });
  }

  await client.createExamples(
    cases.map((c) => ({
      dataset_name: DATASET_NAME,
      inputs: { question: c.question },
      outputs: {
        finalAnswer: c.finalAnswer,
        trajectory: c.trajectory,
      },
      metadata: {
        slug: c.id,
        category: c.category,
        source: c.source,
        hasFinalAnswer: !!c.finalAnswer,
        hasTrajectory: !!c.trajectory,
      },
    })),
  );

  console.log('\nDataset seeded.');
}

export async function createLangSmithDatasetClient(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LangSmithClient> {
  return new LangSmithClient({
    apiKey: env.LANGSMITH_API_KEY,
    apiUrl: env.LANGSMITH_ENDPOINT,
    workspaceId: env.LANGSMITH_WORKSPACE_ID,
  });
}
