/**
 * RAG pipeline evaluation runner.
 * Sends questions through askFrosthaven, then uses LLM-as-judge to grade answers.
 *
 * Usage:
 *   node eval/run.ts                  # run all questions
 *   node eval/run.ts --category=rulebook  # run one category
 *   node eval/run.ts --id=rule-poison     # run one question
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { askFrosthaven } from '../src/query.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface EvalCase {
  id: string;
  category: string;
  question: string;
  expected: string;
  grading: string;
  source: string;
}

interface EvalResult {
  id: string;
  category: string;
  question: string;
  expected: string;
  actual: string;
  pass: boolean;
  score: number;
  reasoning: string;
  durationMs: number;
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

async function judge(
  client: Anthropic,
  evalCase: EvalCase,
  actual: string,
): Promise<{ score: number; pass: boolean; reasoning: string }> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: JUDGE_PROMPT,
    messages: [
      {
        role: 'user',
        content: `## Question\n${evalCase.question}\n\n## Expected Answer\n${evalCase.expected}\n\n## Grading Criteria\n${evalCase.grading}\n\n## Actual Answer\n${actual}`,
      },
    ],
  });

  let text = response.content[0].type === 'text' ? response.content[0].text : '';
  // Strip markdown code fences if present
  text = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  try {
    const parsed = JSON.parse(text) as { score: number; pass: boolean; reasoning: string };
    return parsed;
  } catch {
    return { score: 0, pass: false, reasoning: `Judge returned unparseable response: ${text}` };
  }
}

async function runEval(cases: EvalCase[]): Promise<EvalResult[]> {
  const client = new Anthropic();
  const results: EvalResult[] = [];

  for (const evalCase of cases) {
    process.stdout.write(`  ${evalCase.id}... `);
    const start = Date.now();

    try {
      const actual = await askFrosthaven(evalCase.question);
      const verdict = await judge(client, evalCase, actual);
      const durationMs = Date.now() - start;

      results.push({
        id: evalCase.id,
        category: evalCase.category,
        question: evalCase.question,
        expected: evalCase.expected,
        actual,
        pass: verdict.pass,
        score: verdict.score,
        reasoning: verdict.reasoning,
        durationMs,
      });

      const icon = verdict.pass ? '\u2713' : '\u2717';
      console.log(`${icon} (${verdict.score}/5, ${(durationMs / 1000).toFixed(1)}s)`);
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        id: evalCase.id,
        category: evalCase.category,
        question: evalCase.question,
        expected: evalCase.expected,
        actual: `ERROR: ${message}`,
        pass: false,
        score: 0,
        reasoning: `Error: ${message}`,
        durationMs,
      });
      console.log(`\u2717 ERROR (${(durationMs / 1000).toFixed(1)}s)`);
    }
  }

  return results;
}

function printSummary(results: EvalResult[]): void {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / total;
  const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log('\n--- Summary ---');
  console.log(`Pass rate: ${passed}/${total} (${((passed / total) * 100).toFixed(0)}%)`);
  console.log(`Avg score: ${avgScore.toFixed(2)}/5`);
  console.log(`Total time: ${(totalTime / 1000).toFixed(1)}s`);

  // Per-category breakdown
  const categories = [...new Set(results.map((r) => r.category))];
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const catPassed = catResults.filter((r) => r.pass).length;
    const catAvg = catResults.reduce((sum, r) => sum + r.score, 0) / catResults.length;
    console.log(`  ${cat}: ${catPassed}/${catResults.length} pass, avg ${catAvg.toFixed(2)}`);
  }

  // Failed cases
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.log('\n--- Failures ---');
    for (const f of failed) {
      console.log(`\n${f.id} (score: ${f.score}/5)`);
      console.log(`  Q: ${f.question}`);
      console.log(`  Expected: ${f.expected}`);
      console.log(`  Reasoning: ${f.reasoning}`);
    }
  }
}

// --- CLI ---

const args = process.argv.slice(2);
const categoryFilter = args.find((a) => a.startsWith('--category='))?.split('=')[1];
const idFilter = args.find((a) => a.startsWith('--id='))?.split('=')[1];

const dataset: EvalCase[] = JSON.parse(readFileSync(join(__dirname, 'dataset.json'), 'utf-8'));

let cases = dataset;
if (categoryFilter) cases = cases.filter((c) => c.category === categoryFilter);
if (idFilter) cases = cases.filter((c) => c.id === idFilter);

if (cases.length === 0) {
  console.error('No matching eval cases found.');
  process.exit(1);
}

console.log(`Running ${cases.length} eval(s)...\n`);

const results = await runEval(cases);
printSummary(results);

// Save results
mkdirSync(join(__dirname, 'results'), { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = join(__dirname, 'results', `${timestamp}.json`);
writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nResults saved to ${outPath}`);
