import Anthropic from '@anthropic-ai/sdk';
import type { AgentRunResult } from '../src/agent.ts';
import type { EvalToolSurface } from './cli.ts';
import {
  scoreTrajectory,
  type FinalAnswerExpectation,
  type TrajectoryExpectation,
} from './schema.ts';

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

export async function judgeAnswer(
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

export function buildEvaluators(anthropic: Anthropic) {
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

export function buildRunEvaluators() {
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
