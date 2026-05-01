import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LangfuseClient } from '@langfuse/client';
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

// Idempotent: Langfuse returns the existing dataset on duplicate create, and
// upserts items when an id is provided. Safe to run repeatedly.
export async function seedDataset(langfuse: LangfuseClient, cases: EvalCase[]): Promise<void> {
  console.log(`Seeding dataset "${DATASET_NAME}" with ${cases.length} items...`);

  await langfuse.api.datasets.create({
    name: DATASET_NAME,
    description: 'Frosthaven rules Q&A evaluation set',
    metadata: { version: '1.0' },
  });

  for (const c of cases) {
    await langfuse.api.datasetItems.create({
      datasetName: DATASET_NAME,
      id: c.id,
      input: { question: c.question },
      expectedOutput: {
        finalAnswer: c.finalAnswer,
        trajectory: c.trajectory,
      },
      metadata: {
        id: c.id,
        category: c.category,
        source: c.source,
        hasFinalAnswer: !!c.finalAnswer,
        hasTrajectory: !!c.trajectory,
      },
    });
    process.stdout.write('.');
  }
  console.log('\nDataset seeded.');
}
