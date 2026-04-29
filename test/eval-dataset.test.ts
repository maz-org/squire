import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  EvalDatasetSchema,
  countTrajectoryCases,
  evalCaseHasFinalAnswer,
  evalCaseHasTrajectory,
  validateRemoteDatasetShape,
} from '../eval/schema.ts';

const dataset = JSON.parse(readFileSync(join(process.cwd(), 'eval/dataset.json'), 'utf-8'));

describe('eval dataset', () => {
  it('matches the final-answer and trajectory fixture schema', () => {
    expect(() => EvalDatasetSchema.parse(dataset)).not.toThrow();
  });

  it('keeps the existing final-answer cases and adds enough trajectory coverage', () => {
    const cases = EvalDatasetSchema.parse(dataset);

    expect(cases).toHaveLength(29);
    expect(cases.filter(evalCaseHasFinalAnswer)).toHaveLength(18);
    expect(countTrajectoryCases(cases)).toBeGreaterThanOrEqual(10);
  });

  it('makes the cross-game ref case assert both the attempt and rejection', () => {
    const cases = EvalDatasetSchema.parse(dataset);
    const evalCase = cases.find((candidate) => candidate.id === 'traj-invalid-cross-game-ref');

    expect(evalCase?.finalAnswer?.grading).toMatch(/Gloomhaven 2 path is rejected/);
    expect(evalCase?.trajectory?.requiredRefs).toContain('section:gloomhaven2/67.1');
  });

  it('defines flexible tool-path expectations for trajectory cases', () => {
    const cases = EvalDatasetSchema.parse(dataset).filter(evalCaseHasTrajectory);

    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const evalCase of cases) {
      expect(evalCase.trajectory.maxToolCalls).toBeGreaterThan(0);
      expect(
        evalCase.trajectory.requiredTools.length +
          evalCase.trajectory.requiredToolKinds.length +
          evalCase.trajectory.requiredRefs.length,
      ).toBeGreaterThan(0);
    }
  });

  it('rejects stale remote Langfuse dataset shapes before a full run', () => {
    expect(() =>
      validateRemoteDatasetShape(
        [
          { expectedOutput: { answer: 'old answer', grading: 'old grading' } },
          { expectedOutput: { answer: 'old answer', grading: 'old grading' } },
        ],
        2,
        'frosthaven-qa',
      ),
    ).toThrow(/old expected-output shape/);
  });

  it('rejects remote Langfuse datasets with a stale item count', () => {
    expect(() =>
      validateRemoteDatasetShape(
        [{ expectedOutput: { finalAnswer: { expected: 'ok', grading: 'ok' } } }],
        2,
        'frosthaven-qa',
      ),
    ).toThrow(/has 1 item/);
  });

  it('rejects malformed remote Langfuse expected outputs', () => {
    expect(() =>
      validateRemoteDatasetShape(
        [
          { expectedOutput: { finalAnswer: {} } },
          { expectedOutput: { trajectory: { maxToolCalls: '3' } } },
        ],
        2,
        'frosthaven-qa',
      ),
    ).toThrow(/old expected-output shape/);
  });
});
