import Anthropic from '@anthropic-ai/sdk';
import type { AgentRunResult } from '../src/agent.ts';
import type { EvalToolSurface } from './cli.ts';
import {
  scoreAnswerSafety,
  scoreTrajectory,
  type AnswerSafetyExpectation,
  type FinalAnswerExpectation,
  type TrajectoryExpectation,
} from './schema.ts';

interface EvalRunOutput {
  answer: string;
  trajectory: AgentRunResult['trajectory'];
  durationMs?: number;
  toolSurface?: EvalToolSurface;
}

export const ANSWER_JUDGE_MODEL = 'claude-haiku-4-5-20251001';
export const ANSWER_JUDGE_PROMPT_VERSION = 'table-qa-answer-judge-v2';

// v2 (SQR-392): recalibrated against Brian's frozen human labels. v1 passed
// answers that omitted asked-for parts, disclosed data gaps instead of
// answering, or invented details — all hard fails at a real table.
export const ANSWER_JUDGE_PROMPT = `You are an evaluation judge for a Frosthaven and Gloomhaven (2nd Edition) board game rules assistant. The bar is a real game table: an answer passes only if the players could act on it without re-checking the book.

Given a question, expected answer, grading criteria, and the actual answer from the system, evaluate whether the actual answer is correct.
Use the grading criteria as the source of truth. Accept semantically equivalent wording unless the grading criteria explicitly forbids it.
Extra detail beyond the expected answer is fine and never penalized on its own — many correct answers add context from the game data. Only penalize extra detail when it CONTRADICTS the expected answer or grading criteria.

Evaluation procedure — do this in order:
1. REQUIRED PARTS: List every distinct part the question and grading criteria explicitly require (for example, a question asking about "unlocks, rewards, and monsters" requires three parts; grading saying "must include X and Y" requires both).
2. For EACH required part, check: is it present in the actual answer with correct content?
3. Apply the hard failure rules below.

Hard failure rules — any of these caps the score at 3 (fail), regardless of what else is right:
- OMISSION: any required part from step 1 is entirely absent from the answer. An answer that covers two of three asked-for parts fails, even if those two are perfect.
- UNANSWERED: the answer says a required part is unavailable, missing from the data, or refers the user to the physical components. Honest non-answers are still non-answers.
- CONTRADICTION: the answer states values, names, or mechanics that conflict with the expected answer or grading criteria.
- WRONG SUBJECT: the answer addresses a different record, scenario, card, or game than the one asked about.

Score on a 1-5 scale:
5 = Perfect — all required parts present and accurate
4 = Good — all required parts present; only trivial wording gaps
3 = Partial — a hard failure rule applies, or key required details are missing
2 = Poor — mostly incorrect or very incomplete
1 = Wrong — incorrect answer or completely unrelated

Respond with ONLY valid JSON in this exact format:
{"score": <1-5>, "pass": <true if score >= 4>, "reasoning": "<first the required parts and which are missing, then brief explanation>"}`;

export async function judgeAnswer(
  anthropic: Anthropic,
  question: string,
  expected: string,
  grading: string,
  actual: string,
): Promise<{ score: number; pass: boolean; reasoning: string }> {
  const response = await anthropic.messages.create({
    model: ANSWER_JUDGE_MODEL,
    max_tokens: 512,
    // Deterministic judging: calibration exposed run-to-run verdict flips on
    // borderline items at the default temperature (SQR-392).
    temperature: 0,
    system: ANSWER_JUDGE_PROMPT,
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
        | {
            finalAnswer?: FinalAnswerExpectation;
            trajectory?: TrajectoryExpectation;
            safety?: AnswerSafetyExpectation;
          }
        | undefined;
      const runOutput =
        output && typeof output === 'object' && 'answer' in output
          ? (output as EvalRunOutput)
          : {
              answer: output as string,
              trajectory: {
                toolCalls: [],
                finalAnswer: output as string,
                tokenUsage: {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheCreationInputTokens: 0,
                  cacheReadInputTokens: 0,
                  totalTokens: 0,
                },
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

      if (exp?.safety) {
        const safety = scoreAnswerSafety(
          exp.safety,
          runOutput.answer,
          runOutput.trajectory.toolCalls,
        );
        evaluations.push(
          {
            name: 'answer_safety',
            value: safety.pass ? 1 : 0,
            dataType: 'NUMERIC' as const,
            comment:
              safety.failures.length === 0
                ? 'Answer and source metadata matched safety expectations'
                : safety.failures.join('; '),
          },
          {
            name: 'safety_pass',
            value: safety.pass ? 'pass' : 'fail',
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
      const safetyScores = itemResults
        .flatMap((r) => r.evaluations)
        .filter((e) => e.name === 'answer_safety')
        .map((e) => e.value as number);
      const safetyPassCount = itemResults
        .flatMap((r) => r.evaluations)
        .filter((e) => e.name === 'safety_pass' && e.value === 'pass').length;

      console.log(`\n--- Summary ---`);
      const scoredCount = scores.length;
      console.log(
        `Pass rate: ${passCount}/${scoredCount} (${scoredCount === 0 ? '0' : ((passCount / scoredCount) * 100).toFixed(0)}%)`,
      );
      console.log(`Avg correctness: ${(avg * 5).toFixed(2)}/5`);
      if (trajectoryScores.length > 0) {
        console.log(`Trajectory pass rate: ${trajectoryPassCount}/${trajectoryScores.length}`);
      }
      if (safetyScores.length > 0) {
        console.log(`Safety pass rate: ${safetyPassCount}/${safetyScores.length}`);
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
