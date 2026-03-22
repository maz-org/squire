/**
 * RAG pipeline evaluation runner using Langfuse datasets & experiments.
 *
 * First run:  node eval/run.ts --seed        # upload dataset to Langfuse
 * Run eval:   node eval/run.ts               # run all questions
 * Filtered:   node eval/run.ts --category=rulebook
 *             node eval/run.ts --id=rule-poison
 * Named run:  node eval/run.ts --name="after chunking fix"
 */

import 'dotenv/config';
import { sdk } from '../src/instrumentation.ts';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { LangfuseClient } from '@langfuse/client';
import { askFrosthaven } from '../src/query.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATASET_NAME = 'frosthaven-qa';

interface EvalCase {
  id: string;
  category: string;
  question: string;
  expected: string;
  grading: string;
  source: string;
}

const JUDGE_PROMPT = `You are an evaluation judge for a Frosthaven board game rules assistant.

Given a question, expected answer, grading criteria, and the actual answer from the system, evaluate whether the actual answer is correct.

Score on a 1-5 scale:
5 = Perfect — all required information present and accurate
4 = Good — minor omissions but core answer is correct
3 = Partial — some correct information but missing key details
2 = Poor — mostly incorrect or very incomplete
1 = Wrong — incorrect answer or completely unrelated

Respond with ONLY valid JSON in this exact format:
{"score": <1-5>, "pass": <true if score >= 4>, "reasoning": "<brief explanation>"}`;

async function judgeAnswer(
  anthropic: Anthropic,
  question: string,
  expected: string,
  grading: string,
  actual: string,
): Promise<{ score: number; pass: boolean; reasoning: string }> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: JUDGE_PROMPT,
    messages: [
      {
        role: 'user',
        content: `## Question\n${question}\n\n## Expected Answer\n${expected}\n\n## Grading Criteria\n${grading}\n\n## Actual Answer\n${actual}`,
      },
    ],
  });

  const block = response.content[0];
  let text = block?.type === 'text' ? block.text : '';
  text = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  try {
    return JSON.parse(text) as { score: number; pass: boolean; reasoning: string };
  } catch {
    return { score: 0, pass: false, reasoning: `Judge returned unparseable response: ${text}` };
  }
}

// --- Seed dataset into Langfuse ---

async function seedDataset(langfuse: LangfuseClient, cases: EvalCase[]): Promise<void> {
  console.log(`Creating dataset "${DATASET_NAME}" with ${cases.length} items...`);

  await langfuse.api.datasets.create({
    name: DATASET_NAME,
    description: 'Frosthaven rules Q&A evaluation set',
    metadata: { version: '1.0' },
  });

  for (const c of cases) {
    await langfuse.api.datasetItems.create({
      datasetName: DATASET_NAME,
      input: { question: c.question },
      expectedOutput: { answer: c.expected, grading: c.grading },
      metadata: { id: c.id, category: c.category, source: c.source },
    });
    process.stdout.write('.');
  }
  console.log('\nDataset seeded.');
}

// --- Build evaluators ---

function buildEvaluators(anthropic: Anthropic) {
  return [
    async ({
      input,
      output,
      expectedOutput,
    }: {
      input: unknown;
      output: unknown;
      expectedOutput?: unknown;
    }) => {
      const question = (input as { question: string }).question;
      const exp = expectedOutput as { answer: string; grading: string };
      const actual = output as string;

      const verdict = await judgeAnswer(anthropic, question, exp.answer, exp.grading, actual);

      const icon = verdict.pass ? '\u2713' : '\u2717';
      console.log(`${icon} (${verdict.score}/5)`);

      return [
        {
          name: 'correctness',
          value: verdict.score / 5,
          dataType: 'NUMERIC' as const,
          comment: verdict.reasoning,
        },
        {
          name: 'pass',
          value: verdict.pass ? 'pass' : 'fail',
          dataType: 'CATEGORICAL' as const,
        },
      ];
    },
  ];
}

function buildRunEvaluators() {
  return [
    async ({
      itemResults,
    }: {
      itemResults: Array<{ evaluations: Array<{ name: string; value: unknown }> }>;
    }) => {
      const scores = itemResults
        .flatMap((r) => r.evaluations)
        .filter((e) => e.name === 'correctness')
        .map((e) => e.value as number);
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const passCount = itemResults
        .flatMap((r) => r.evaluations)
        .filter((e) => e.name === 'pass' && e.value === 'pass').length;

      console.log(`\n--- Summary ---`);
      console.log(
        `Pass rate: ${passCount}/${itemResults.length} (${((passCount / itemResults.length) * 100).toFixed(0)}%)`,
      );
      console.log(`Avg correctness: ${(avg * 5).toFixed(2)}/5`);

      return {
        name: 'avg_correctness',
        value: avg,
        dataType: 'NUMERIC' as const,
        comment: `${passCount}/${itemResults.length} passed`,
      };
    },
  ];
}

// --- Run experiment ---

async function runOnDataset(langfuse: LangfuseClient, runName: string): Promise<void> {
  const anthropic = new Anthropic();
  const dataset = await langfuse.dataset.get(DATASET_NAME);
  console.log(`Dataset has ${dataset.items.length} items`);

  const result = await dataset.runExperiment({
    name: runName,
    maxConcurrency: 1,
    task: async (item) => {
      const question = (item.input as { question: string }).question;
      const meta = item.metadata as { id?: string } | undefined;
      process.stdout.write(`  ${meta?.id ?? '?'}... `);
      return askFrosthaven(question);
    },
    evaluators: buildEvaluators(anthropic),
    runEvaluators: buildRunEvaluators(),
  });

  console.log('\n' + (await result.format()));
  if (result.datasetRunUrl) {
    console.log(`\nView in Langfuse: ${result.datasetRunUrl}`);
  }
}

async function runFiltered(
  langfuse: LangfuseClient,
  cases: EvalCase[],
  runName: string,
): Promise<void> {
  const anthropic = new Anthropic();

  const data = cases.map((c) => ({
    input: { question: c.question },
    expectedOutput: { answer: c.expected, grading: c.grading },
    metadata: { id: c.id, category: c.category, source: c.source },
  }));

  const result = await langfuse.experiment.run({
    name: runName,
    data,
    maxConcurrency: 1,
    task: async (item) => {
      const question = (item.input as { question: string }).question;
      const meta = item.metadata as { id?: string } | undefined;
      process.stdout.write(`  ${meta?.id ?? '?'}... `);
      return askFrosthaven(question);
    },
    evaluators: buildEvaluators(anthropic),
    runEvaluators: buildRunEvaluators(),
  });

  console.log('\n' + (await result.format()));
}

// --- CLI ---

const args = process.argv.slice(2);
const shouldSeed = args.includes('--seed');
const categoryFilter = args.find((a) => a.startsWith('--category='))?.split('=')[1];
const idFilter = args.find((a) => a.startsWith('--id='))?.split('=')[1];
const runName =
  args.find((a) => a.startsWith('--name='))?.split('=')[1] ??
  `eval-${new Date().toISOString().slice(0, 16)}`;

const allCases: EvalCase[] = JSON.parse(readFileSync(join(__dirname, 'dataset.json'), 'utf-8'));
const isFiltered = !!(categoryFilter || idFilter);

let cases = allCases;
if (categoryFilter) cases = cases.filter((c) => c.category === categoryFilter);
if (idFilter) cases = cases.filter((c) => c.id === idFilter);

if (cases.length === 0) {
  console.error('No matching eval cases found.');
  process.exit(1);
}

const langfuse = new LangfuseClient();

if (shouldSeed) {
  await seedDataset(langfuse, allCases);
} else {
  console.log(`Running ${cases.length} eval(s) as "${runName}"...\n`);
  if (isFiltered) {
    await runFiltered(langfuse, cases, runName);
  } else {
    await runOnDataset(langfuse, runName);
  }
}

await sdk.shutdown();
