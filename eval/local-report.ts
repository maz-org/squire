import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AGENT_SYSTEM_PROMPT, LEGACY_AGENT_SYSTEM_PROMPT, type TokenUsage } from '../src/agent.ts';
import { askFrosthavenWithTrajectory } from '../src/query.ts';
import type { EvalToolSurface } from './cli.ts';
import { DATASET_NAME } from './dataset.ts';
import { judgeAnswer } from './evaluators.ts';
import { scoreTrajectory, type EvalCase } from './schema.ts';

function addTokenUsage(total: TokenUsage, next: TokenUsage): void {
  total.inputTokens += next.inputTokens;
  total.outputTokens += next.outputTokens;
  total.totalTokens += next.totalTokens;
}

function promptLengthFor(toolSurface: EvalToolSurface): { chars: number; estimatedTokens: number } {
  const prompt = toolSurface === 'legacy' ? LEGACY_AGENT_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT;
  return { chars: prompt.length, estimatedTokens: Math.ceil(prompt.length / 4) };
}

export async function runLocalReport(
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
