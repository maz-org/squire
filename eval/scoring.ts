import Anthropic from '@anthropic-ai/sdk';
import type { ToolTrajectoryStep } from '../src/agent.ts';
import { normalizeGameId, type GameId } from '../src/game.ts';
import { sourceAuthorityForCase } from './dataset.ts';
import type { EvalCase } from './schema.ts';
import { normalizeTrajectoryRef, scoreAnswerSafety, scoreTrajectory } from './schema.ts';
import type { EvalTraceScore } from './trace.ts';
import { judgeAnswer } from './evaluators.ts';

export interface EvalScoringInput {
  evalCase: EvalCase;
  answer: string;
  toolCalls: ToolTrajectoryStep[];
}

export interface AnswerGroundednessScore {
  pass: boolean;
  failures: string[];
  evidence: {
    canonicalRefs: string[];
    sourceLabels: string[];
  };
}

function evalFailureClass(evalCase: EvalCase, scores: EvalTraceScore[]): string | undefined {
  const failed = scores.some(
    (score) =>
      (score.name === 'pass' ||
        score.name === 'trajectory_pass' ||
        score.name === 'groundedness_pass' ||
        score.name === 'safety_pass') &&
      score.value === 'fail',
  );
  if (!failed) return undefined;
  if (scores.some((score) => score.name === 'safety_pass' && score.value === 'fail')) {
    if (evalCase.suite === 'adversarial-boundary') {
      if (/html|script|xss|unsafe/i.test(evalCase.caseCategory)) return 'unsafe_output';
      if (/source|citation|game|poisoned/i.test(evalCase.caseCategory)) return 'source_boundary';
      return 'prompt_injection';
    }
    return 'safety';
  }
  if (scores.some((score) => score.name === 'groundedness_pass' && score.value === 'fail')) {
    return 'groundedness';
  }
  if (evalCase.suite === 'cross-game-boundary') return 'cross_game_contamination';
  if (scores.some((score) => score.name === 'trajectory_pass' && score.value === 'fail')) {
    return 'retrieval';
  }
  return 'answer_quality';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const GAME_QUALIFIED_REF_PATTERN = /^(?:scenario|section|card|source):([^/]+)\//;

function canonicalRefGame(ref: string): GameId | undefined {
  const match = normalizeTrajectoryRef(ref).match(GAME_QUALIFIED_REF_PATTERN);
  return match ? (normalizeGameId(match[1]) ?? undefined) : undefined;
}

function sourceBackedCase(evalCase: EvalCase): boolean {
  return !['application', 'unknown'].includes(sourceAuthorityForCase(evalCase));
}

export function scoreAnswerGroundedness(
  evalCase: EvalCase,
  answer: string,
  toolCalls: ToolTrajectoryStep[],
): AnswerGroundednessScore {
  const successfulToolCalls = toolCalls.filter((call) => call.ok);
  const canonicalRefs = unique(successfulToolCalls.flatMap((call) => call.canonicalRefs ?? []));
  const sourceLabels = unique(successfulToolCalls.flatMap((call) => call.sourceLabels ?? []));
  const failures: string[] = [];

  if (!answer.trim()) {
    failures.push('answer text is empty');
  }

  if (sourceBackedCase(evalCase) && canonicalRefs.length + sourceLabels.length === 0) {
    failures.push('no source labels or canonical refs were recorded by successful tool calls');
  }

  const wrongGameRefs = canonicalRefs.filter((ref) => {
    const game = canonicalRefGame(ref);
    return game !== undefined && game !== evalCase.game;
  });
  if (wrongGameRefs.length > 0) {
    failures.push(`canonical refs point at the wrong game: ${wrongGameRefs.join(', ')}`);
  }

  return {
    pass: failures.length === 0,
    failures,
    evidence: {
      canonicalRefs,
      sourceLabels,
    },
  };
}

function gameIdsFromRequiredRefs(evalCase: EvalCase): GameId[] {
  const games = new Set<GameId>();
  for (const ref of evalCase.trajectory?.requiredRefs ?? []) {
    const normalized = normalizeTrajectoryRef(ref);
    const match = normalized.match(GAME_QUALIFIED_REF_PATTERN);
    const game = match ? normalizeGameId(match[1]) : undefined;
    if (game) games.add(game);
  }
  return [...games];
}

function answerMentionsGame(answer: string, game: GameId): boolean {
  if (game === 'frosthaven') return /\bfrosthaven\b/i.test(answer);
  if (game === 'gloomhaven-2e') {
    return /(?:\bgh2e\b|\bgloomhaven\s*(?:2e\b|\(2e\)|(?:2nd|second)\s+(?:edition\b|ed\.?)|\((?:2nd|second)\s+(?:edition|ed\.?)\)))/i.test(
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

  if (input.evalCase.suite === 'table-qa' && input.evalCase.finalAnswer) {
    const groundedness = scoreAnswerGroundedness(input.evalCase, input.answer, input.toolCalls);
    scores.push(
      {
        name: 'groundedness',
        value: groundedness.pass ? 1 : 0,
        comment:
          groundedness.failures.length === 0
            ? 'Answer has source evidence from the expected game.'
            : groundedness.failures.join('; '),
        metadata: groundedness,
      },
      {
        name: 'groundedness_pass',
        value: groundedness.pass ? 'pass' : 'fail',
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

  if (input.evalCase.safety) {
    const safety = scoreAnswerSafety(input.evalCase.safety, input.answer, input.toolCalls);
    scores.push(
      {
        name: 'answer_safety',
        value: safety.pass ? 1 : 0,
        comment:
          safety.failures.length === 0
            ? 'Answer and source metadata matched safety expectations'
            : safety.failures.join('; '),
      },
      {
        name: 'safety_pass',
        value: safety.pass ? 'pass' : 'fail',
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
  if (typeof trajectory?.value === 'number') return trajectory.value;

  const safety = scores.find((candidate) => candidate.name === 'answer_safety');
  return typeof safety?.value === 'number' ? safety.value : null;
}

export function passFromTraceScores(scores: EvalTraceScore[]): boolean | null {
  const verdicts = scores.filter(
    (candidate) =>
      candidate.name === 'pass' ||
      candidate.name === 'trajectory_pass' ||
      candidate.name === 'groundedness_pass' ||
      candidate.name === 'safety_pass',
  );
  if (verdicts.some((score) => score.value === 'fail')) return false;
  if (verdicts.some((score) => score.value === 'pass')) return true;

  return null;
}
