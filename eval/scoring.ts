import Anthropic from '@anthropic-ai/sdk';
import type { ToolTrajectoryStep } from '../src/agent.ts';
import { normalizeGameId, type GameId } from '../src/game.ts';
import type { EvalCase } from './schema.ts';
import { normalizeTrajectoryRef, scoreTrajectory } from './schema.ts';
import type { EvalTraceScore } from './trace.ts';
import { judgeAnswer } from './evaluators.ts';

export interface EvalScoringInput {
  evalCase: EvalCase;
  answer: string;
  toolCalls: ToolTrajectoryStep[];
}

function evalFailureClass(evalCase: EvalCase, scores: EvalTraceScore[]): string | undefined {
  const failed = scores.some(
    (score) =>
      (score.name === 'pass' || score.name === 'trajectory_pass') && score.value === 'fail',
  );
  if (!failed) return undefined;
  if (evalCase.suite === 'cross-game-boundary') return 'cross_game_contamination';
  if (scores.some((score) => score.name === 'trajectory_pass' && score.value === 'fail')) {
    return 'retrieval';
  }
  return 'answer_quality';
}

function gameIdsFromRequiredRefs(evalCase: EvalCase): GameId[] {
  const games = new Set<GameId>();
  for (const ref of evalCase.trajectory?.requiredRefs ?? []) {
    const normalized = normalizeTrajectoryRef(ref);
    const match = normalized.match(/^(?:scenario|section|card):([^/]+)\//);
    const game = match ? normalizeGameId(match[1]) : undefined;
    if (game) games.add(game);
  }
  return [...games];
}

function answerMentionsGame(answer: string, game: GameId): boolean {
  if (game === 'frosthaven') return /\bfrosthaven\b/i.test(answer);
  if (game === 'gloomhaven-2e') {
    return /\bgloomhaven\s*(?:2e\b|\(2e\)|2nd edition\b|\(2nd edition\)|second edition\b)/i.test(
      answer,
    );
  }
  return false;
}

function crossGameBoundaryVerdict(evalCase: EvalCase, answer: string): EvalTraceScore[] {
  const requiredGames = gameIdsFromRequiredRefs(evalCase);
  const missingGames = requiredGames.filter((game) => !answerMentionsGame(answer, game));
  const statesSeparation = /\b(?:not|no|different|separate|distinct|cannot|can't|neither)\b/i.test(
    answer,
  );
  const pass = missingGames.length === 0 && statesSeparation;
  const comment = pass
    ? 'Answer names each game-qualified source and states that the records are separate.'
    : [
        missingGames.length > 0 ? `missing game mention(s): ${missingGames.join(', ')}` : '',
        statesSeparation ? '' : 'missing clear cross-game separation statement',
      ]
        .filter(Boolean)
        .join('; ');

  return [
    {
      name: 'correctness',
      value: pass ? 1 : 0,
      comment,
    },
    {
      name: 'pass',
      value: pass ? 'pass' : 'fail',
      comment,
    },
  ];
}

export async function traceScoresForEvalResult(
  anthropic: Anthropic,
  input: EvalScoringInput,
): Promise<EvalTraceScore[] | undefined> {
  const scores: EvalTraceScore[] = [];

  if (input.evalCase.finalAnswer) {
    if (input.evalCase.suite === 'cross-game-boundary') {
      scores.push(...crossGameBoundaryVerdict(input.evalCase, input.answer));
    } else {
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

  const failureClass = evalFailureClass(input.evalCase, scores);
  if (failureClass) scores.push({ name: 'failure_class', value: failureClass });

  return scores.length > 0 ? scores : undefined;
}

export function scoreFromTraceScores(scores: EvalTraceScore[]): number | null {
  const score = scores.find((candidate) => candidate.name === 'correctness');
  if (typeof score?.value === 'number') return score.value;

  const trajectory = scores.find((candidate) => candidate.name === 'trajectory');
  return typeof trajectory?.value === 'number' ? trajectory.value : null;
}

export function passFromTraceScores(scores: EvalTraceScore[]): boolean | null {
  const verdicts = scores.filter(
    (candidate) => candidate.name === 'pass' || candidate.name === 'trajectory_pass',
  );
  if (verdicts.some((score) => score.value === 'fail')) return false;
  if (verdicts.some((score) => score.value === 'pass')) return true;

  return null;
}
