import Anthropic from '@anthropic-ai/sdk';
import type { ToolTrajectoryStep } from '../src/agent.ts';
import type { EvalCase } from './schema.ts';
import { scoreTrajectory } from './schema.ts';
import type { EvalTraceScore } from './trace.ts';
import { judgeAnswer } from './evaluators.ts';

export interface EvalScoringInput {
  evalCase: EvalCase;
  answer: string;
  toolCalls: ToolTrajectoryStep[];
}

export async function traceScoresForEvalResult(
  anthropic: Anthropic,
  input: EvalScoringInput,
): Promise<EvalTraceScore[] | undefined> {
  const scores: EvalTraceScore[] = [];

  if (input.evalCase.finalAnswer) {
    const verdict = await judgeAnswer(
      anthropic,
      input.evalCase.question,
      input.evalCase.finalAnswer.expected,
      input.evalCase.finalAnswer.grading,
      input.answer,
    );
    scores.push(
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
    );
  }

  if (input.evalCase.trajectory) {
    const trajectory = scoreTrajectory(input.evalCase.trajectory, input.toolCalls);
    scores.push(
      {
        name: 'trajectory',
        value: trajectory.pass ? 1 : 0,
        comment:
          trajectory.failures.length === 0
            ? `${input.toolCalls.length} tool call(s) matched expectations`
            : trajectory.failures.join('; '),
      },
      {
        name: 'trajectory_pass',
        value: trajectory.pass ? 'pass' : 'fail',
      },
    );
  }

  return scores.length > 0 ? scores : undefined;
}

export function scoreFromTraceScores(scores: EvalTraceScore[]): number | null {
  const score = scores.find((candidate) => candidate.name === 'correctness');
  if (typeof score?.value === 'number') return score.value;

  const trajectory = scores.find((candidate) => candidate.name === 'trajectory');
  return typeof trajectory?.value === 'number' ? trajectory.value : null;
}

export function passFromTraceScores(scores: EvalTraceScore[]): boolean | null {
  const score = scores.find((candidate) => candidate.name === 'pass');
  if (score?.value === 'pass') return true;
  if (score?.value === 'fail') return false;

  const trajectory = scores.find((candidate) => candidate.name === 'trajectory_pass');
  if (trajectory?.value === 'pass') return true;
  if (trajectory?.value === 'fail') return false;

  return null;
}
