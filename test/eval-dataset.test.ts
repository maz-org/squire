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

  it('treats read-now chain traversal as a neighbors requirement', () => {
    const cases = EvalDatasetSchema.parse(dataset);
    const evalCase = cases.find((candidate) => candidate.id === 'traj-section-read-now-chain');

    expect(evalCase?.trajectory?.requiredTools).toContain('neighbors');
    expect(evalCase?.trajectory?.requiredToolKinds).toContain('traversal');
    expect(evalCase?.trajectory?.requiredTools).not.toContain('open_entity');
  });

  it('keeps SQR-137 final-answer expectations aligned with checked-in data', () => {
    const cases = EvalDatasetSchema.parse(dataset);
    const byId = new Map(cases.map((evalCase) => [evalCase.id, evalCase]));

    expect(byId.get('monster-living-bones-immunity')?.finalAnswer).toMatchObject({
      expected: expect.stringMatching(/no condition immunit/i),
      grading: expect.stringMatching(/must not claim poison or wound immunity/i),
    });

    expect(byId.get('building-alchemist')?.finalAnswer).toMatchObject({
      expected: expect.stringMatching(/no initial build cost/i),
      grading: expect.stringMatching(/upgrade cost/i),
    });

    expect(byId.get('scenario-61-unlock')?.finalAnswer).toMatchObject({
      expected: expect.stringMatching(/Section 79\.4/i),
      grading: expect.stringMatching(/Crain|star iron/i),
    });
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
    ).toThrow(/invalid expectedOutput/);
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
    ).toThrow(/invalid expectedOutput/);
  });
});
