import { describe, expect, it } from 'vitest';

import { passFromTraceScores, traceScoresForEvalResult } from '../eval/scoring.ts';

describe('eval scoring summaries', () => {
  it('requires both answer and trajectory verdicts to pass when both are present', () => {
    expect(
      passFromTraceScores([
        { name: 'pass', value: 'pass' },
        { name: 'trajectory_pass', value: 'fail' },
      ]),
    ).toBe(false);
    expect(
      passFromTraceScores([
        { name: 'pass', value: 'pass' },
        { name: 'trajectory_pass', value: 'pass' },
      ]),
    ).toBe(true);
  });

  it('includes the failed trajectory predicate in zero-score trace comments', async () => {
    const scores = await traceScoresForEvalResult({} as never, {
      evalCase: {
        id: 'traj-card-fuzzy-vs-exact',
        category: 'trajectory',
        source: 'unit-test',
        question: 'Find Algox Archer.',
        trajectory: {
          requiredTools: ['resolve_entity', 'open_entity'],
          requiredToolKinds: ['resolution', 'open'],
          forbiddenTools: [],
          forbiddenToolKinds: [],
          requiredRefs: [
            'card:frosthaven/monster-stats/gloomhavensecretariat:monster-stat/algox-archer/0-3',
          ],
          maxToolCalls: 3,
        },
      },
      answer: '',
      toolCalls: [
        {
          iteration: 1,
          id: 'call_1',
          name: 'search_cards',
          input: { query: 'Algox Archer' },
          ok: true,
          outputSummary: 'json array (2 items)',
          sourceLabels: [],
          canonicalRefs: [],
          startedAt: '2026-05-03T00:00:00.000Z',
          endedAt: '2026-05-03T00:00:00.001Z',
          durationMs: 1,
        },
      ],
    });

    expect(scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'trajectory',
          value: 0,
          comment: expect.stringContaining('missing required tool: resolve_entity'),
        }),
        expect.objectContaining({
          name: 'trajectory',
          comment: expect.stringContaining(
            'missing required ref: card:frosthaven/monster-stats/gloomhavensecretariat:monster-stat/algox-archer/0-3',
          ),
        }),
      ]),
    );
  });
});
