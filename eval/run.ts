/**
 * RAG pipeline evaluation runner using Langfuse datasets & experiments.
 *
 * First run:  node eval/run.ts --seed        # upload dataset to Langfuse
 * Run eval:   node eval/run.ts               # run all questions on redesigned tools
 * Legacy:     node eval/run.ts --tool-surface=legacy
 * Filtered:   node eval/run.ts --category=rulebook
 *             node eval/run.ts --id=rule-poison
 * Named run:  node eval/run.ts --name="after chunking fix"
 * Local JSON: node eval/run.ts --local-report=/tmp/eval.json
 */

import 'dotenv/config';
import { sdk, LANGFUSE_DEFAULT_BASE_URL } from '../src/instrumentation.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { LangfuseClient } from '@langfuse/client';
import { askFrosthavenWithTrajectory } from '../src/query.ts';
import { AGENT_SYSTEM_PROMPT, LEGACY_AGENT_SYSTEM_PROMPT, type TokenUsage } from '../src/agent.ts';
import { parseEvalArgs, type EvalToolSurface } from './cli.ts';
import {
  EvalDatasetSchema,
  evalCaseHasFinalAnswer,
  scoreTrajectory,
  validateRemoteDatasetShape,
  type EvalCase,
  type FinalAnswerExpectation,
  type TrajectoryExpectation,
} from './schema.ts';
import type { AgentRunResult } from '../src/agent.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATASET_NAME = 'frosthaven-qa';

interface EvalRunOutput {
  answer: string;
  trajectory: AgentRunResult['trajectory'];
  durationMs?: number;
  toolSurface?: EvalToolSurface;
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
// Idempotent: Langfuse returns the existing dataset on duplicate create,
// and upserts items when an id is provided. Safe to run repeatedly.

async function seedDataset(langfuse: LangfuseClient, cases: EvalCase[]): Promise<void> {
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
      const exp = expectedOutput as
        | { finalAnswer?: FinalAnswerExpectation; trajectory?: TrajectoryExpectation }
        | undefined;
      const runOutput =
        output && typeof output === 'object' && 'answer' in output
          ? (output as EvalRunOutput)
          : {
              answer: output as string,
              trajectory: {
                toolCalls: [],
                finalAnswer: output as string,
                tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                model: 'unknown',
                iterations: 0,
                stopReason: null,
              },
            };
      const evaluations = [];

      if (!exp?.finalAnswer) {
        evaluations.push({
          name: 'final_answer',
          value: 'not_applicable',
          dataType: 'CATEGORICAL' as const,
          comment: 'This case defines trajectory expectations only.',
        });
      } else {
        const question = (input as { question: string }).question;
        const verdict = await judgeAnswer(
          anthropic,
          question,
          exp.finalAnswer.expected,
          exp.finalAnswer.grading,
          runOutput.answer,
        );

        const icon = verdict.pass ? '\u2713' : '\u2717';
        console.log(`${icon} (${verdict.score}/5)`);

        evaluations.push(
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
        );
      }

      if (exp?.trajectory) {
        const trajectory = scoreTrajectory(exp.trajectory, runOutput.trajectory.toolCalls);
        evaluations.push(
          {
            name: 'trajectory',
            value: trajectory.pass ? 1 : 0,
            dataType: 'NUMERIC' as const,
            comment:
              trajectory.failures.length === 0
                ? `${runOutput.trajectory.toolCalls.length} tool call(s) matched expectations`
                : trajectory.failures.join('; '),
          },
          {
            name: 'trajectory_pass',
            value: trajectory.pass ? 'pass' : 'fail',
            dataType: 'CATEGORICAL' as const,
          },
        );
      }

      return evaluations;
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
      const trajectoryScores = itemResults
        .flatMap((r) => r.evaluations)
        .filter((e) => e.name === 'trajectory')
        .map((e) => e.value as number);
      const trajectoryPassCount = itemResults
        .flatMap((r) => r.evaluations)
        .filter((e) => e.name === 'trajectory_pass' && e.value === 'pass').length;

      console.log(`\n--- Summary ---`);
      const scoredCount = scores.length;
      console.log(
        `Pass rate: ${passCount}/${scoredCount} (${scoredCount === 0 ? '0' : ((passCount / scoredCount) * 100).toFixed(0)}%)`,
      );
      console.log(`Avg correctness: ${(avg * 5).toFixed(2)}/5`);
      if (trajectoryScores.length > 0) {
        console.log(`Trajectory pass rate: ${trajectoryPassCount}/${trajectoryScores.length}`);
      }

      return {
        name: 'avg_correctness',
        value: avg,
        dataType: 'NUMERIC' as const,
        comment: `${passCount}/${scoredCount} final-answer cases passed`,
      };
    },
  ];
}

// --- Run experiment ---

async function runOnDataset(
  langfuse: LangfuseClient,
  runName: string,
  toolSurface: EvalToolSurface,
): Promise<void> {
  const anthropic = new Anthropic();
  const dataset = await langfuse.dataset.get(DATASET_NAME);
  console.log(`Dataset has ${dataset.items.length} items`);
  validateRemoteDatasetShape(dataset.items, allCases.length, DATASET_NAME);

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

async function runFiltered(
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

function addTokenUsage(total: TokenUsage, next: TokenUsage): void {
  total.inputTokens += next.inputTokens;
  total.outputTokens += next.outputTokens;
  total.totalTokens += next.totalTokens;
}

function promptLengthFor(toolSurface: EvalToolSurface): { chars: number; estimatedTokens: number } {
  const prompt = toolSurface === 'legacy' ? LEGACY_AGENT_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT;
  return { chars: prompt.length, estimatedTokens: Math.ceil(prompt.length / 4) };
}

async function runLocalReport(
  cases: EvalCase[],
  runName: string,
  toolSurface: EvalToolSurface,
  outputPath: string,
): Promise<void> {
  const anthropic = new Anthropic();
  const results = [];
  const totalTokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  for (const c of cases) {
    process.stdout.write(`  ${c.id}... `);
    const startedAt = Date.now();
    try {
      const output = await askFrosthavenWithTrajectory(c.question, { toolSurface });
      const durationMs = Date.now() - startedAt;
      addTokenUsage(totalTokenUsage, output.trajectory.tokenUsage);

      const finalAnswer = c.finalAnswer
        ? await judgeAnswer(
            anthropic,
            c.question,
            c.finalAnswer.expected,
            c.finalAnswer.grading,
            output.answer,
          )
        : null;
      const trajectory = c.trajectory
        ? scoreTrajectory(c.trajectory, output.trajectory.toolCalls)
        : null;

      const mark =
        (finalAnswer ? finalAnswer.pass : true) && (trajectory ? trajectory.pass : true)
          ? '\u2713'
          : '\u2717';
      console.log(mark);

      results.push({
        id: c.id,
        category: c.category,
        source: c.source,
        hasFinalAnswerExpectation: Boolean(c.finalAnswer),
        hasTrajectoryExpectation: Boolean(c.trajectory),
        question: c.question,
        answer: output.answer,
        durationMs,
        finalAnswer,
        trajectory,
        toolCallCount: output.trajectory.toolCalls.length,
        toolCalls: output.trajectory.toolCalls.map((call) => ({
          name: call.name,
          input: call.input,
          ok: call.ok,
          sourceLabels: call.sourceLabels,
          canonicalRefs: call.canonicalRefs,
          durationMs: call.durationMs,
          error: call.error,
        })),
        tokenUsage: output.trajectory.tokenUsage,
        iterations: output.trajectory.iterations,
        stopReason: output.trajectory.stopReason,
      });
    } catch (err) {
      console.log('\u2717');
      results.push({
        id: c.id,
        category: c.category,
        source: c.source,
        hasFinalAnswerExpectation: Boolean(c.finalAnswer),
        hasTrajectoryExpectation: Boolean(c.trajectory),
        question: c.question,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const finalAnswerResults = results.filter((result) => result.finalAnswer);
  const trajectoryResults = results.filter((result) => result.trajectory);
  const finalAnswerCases = results.filter((result) => result.hasFinalAnswerExpectation).length;
  const trajectoryCases = results.filter((result) => result.hasTrajectoryExpectation).length;
  const totalDurationMs = results.reduce((sum, result) => sum + (result.durationMs ?? 0), 0);
  const totalToolCalls = results.reduce((sum, result) => sum + (result.toolCallCount ?? 0), 0);
  const promptLength = promptLengthFor(toolSurface);

  const report = {
    generatedAt: new Date().toISOString(),
    runName,
    toolSurface,
    datasetName: DATASET_NAME,
    promptLength,
    summary: {
      totalCases: results.length,
      erroredCases: results.filter((result) => result.error).length,
      finalAnswerCases,
      finalAnswerPasses: finalAnswerResults.filter((result) => result.finalAnswer?.pass === true)
        .length,
      avgCorrectnessScore:
        finalAnswerResults.length === 0
          ? null
          : finalAnswerResults.reduce((sum, result) => sum + (result.finalAnswer?.score ?? 0), 0) /
            finalAnswerResults.length,
      trajectoryCases,
      trajectoryPasses: trajectoryResults.filter((result) => result.trajectory?.pass === true)
        .length,
      avgToolCalls: results.length === 0 ? 0 : totalToolCalls / results.length,
      avgLatencyMs: results.length === 0 ? 0 : totalDurationMs / results.length,
      totalLatencyMs: totalDurationMs,
      tokenUsage: totalTokenUsage,
    },
    results,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote local eval report: ${outputPath}`);
}

// --- CLI ---

const { shouldSeed, categoryFilter, idFilter, runName, toolSurface, localReportPath } =
  parseEvalArgs(process.argv.slice(2));

const allCases: EvalCase[] = EvalDatasetSchema.parse(
  JSON.parse(readFileSync(join(__dirname, 'dataset.json'), 'utf-8')),
);
const isFiltered = !!(categoryFilter || idFilter);

let cases = allCases;
if (categoryFilter) cases = cases.filter((c) => c.category === categoryFilter);
if (idFilter) cases = cases.filter((c) => c.id === idFilter);

if (cases.length === 0) {
  console.error('No matching eval cases found.');
  process.exit(1);
}

if (shouldSeed) {
  const finalAnswerCount = allCases.filter(evalCaseHasFinalAnswer).length;
  console.log(
    `Loaded ${allCases.length} eval case(s): ${finalAnswerCount} final-answer, ${allCases.length - finalAnswerCount} trajectory-only.`,
  );
}

if (localReportPath) {
  console.log(`Running ${cases.length} local eval(s) as "${runName}" on ${toolSurface} tools...\n`);
  await runLocalReport(cases, runName, toolSurface, localReportPath);
} else {
  const langfuse = new LangfuseClient({
    baseUrl: process.env.LANGFUSE_BASEURL ?? LANGFUSE_DEFAULT_BASE_URL,
  });

  if (shouldSeed) {
    await seedDataset(langfuse, allCases);
  } else {
    console.log(`Running ${cases.length} eval(s) as "${runName}" on ${toolSurface} tools...\n`);
    if (isFiltered) {
      await runFiltered(langfuse, cases, runName, toolSurface);
    } else {
      await runOnDataset(langfuse, runName, toolSurface);
    }
  }
}

await sdk.shutdown();
