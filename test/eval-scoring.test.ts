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
        game: 'frosthaven',
        suite: 'trajectory',
        runtime: 'langgraph',
        caseCategory: 'trajectory',
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
        expect.objectContaining({
          name: 'failure_class',
          value: 'retrieval',
        }),
      ]),
    );
  });

  it('labels boundary failures as cross-game contamination', async () => {
    const scores = await traceScoresForEvalResult({} as never, {
      evalCase: {
        id: 'boundary-section-67-gh2-then-fh',
        game: 'frosthaven',
        suite: 'cross-game-boundary',
        runtime: 'langgraph',
        caseCategory: 'trajectory',
        category: 'trajectory',
        source: 'unit-test',
        question: 'Compare section refs.',
        trajectory: {
          requiredTools: ['open_entity'],
          requiredToolKinds: ['open'],
          forbiddenTools: [],
          forbiddenToolKinds: [],
          requiredRefs: ['section:gloomhaven-2e/67.1', 'section:frosthaven/67.1'],
          maxToolCalls: 3,
        },
      },
      answer: '',
      toolCalls: [
        {
          iteration: 1,
          id: 'call_1',
          name: 'open_entity',
          input: { ref: 'section:frosthaven/67.1' },
          ok: true,
          outputSummary: 'section text',
          sourceLabels: [],
          canonicalRefs: ['section:frosthaven/67.1'],
          startedAt: '2026-05-03T00:00:00.000Z',
          endedAt: '2026-05-03T00:00:00.001Z',
          durationMs: 1,
        },
      ],
    });

    expect(scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'failure_class',
          value: 'cross_game_contamination',
        }),
      ]),
    );
  });

  it('scores cross-game boundary answers deterministically when both refs are opened', async () => {
    const anthropic = {
      messages: {
        create: async () => {
          throw new Error('cross-game boundary scoring should not call the LLM judge');
        },
      },
    };
    const scores = await traceScoresForEvalResult(anthropic as never, {
      evalCase: {
        id: 'traj-invalid-cross-game-ref',
        game: 'gloomhaven-2e',
        suite: 'cross-game-boundary',
        runtime: 'langgraph',
        caseCategory: 'trajectory',
        category: 'trajectory',
        source: 'unit-test',
        question: 'Compare section refs.',
        finalAnswer: {
          expected:
            'Frosthaven section 67.1 and Gloomhaven 2e section 67.1 resolve to different game-qualified sections.',
          grading: 'Must distinguish both game-qualified section refs.',
        },
        trajectory: {
          requiredTools: ['resolve_entity', 'open_entity'],
          requiredToolKinds: ['resolution', 'open'],
          forbiddenTools: [],
          forbiddenToolKinds: [],
          requiredRefs: ['section:frosthaven/67.1', 'section:gloomhaven-2e/67.1'],
          maxToolCalls: 8,
        },
      },
      answer:
        'No. Frosthaven section 67.1 and Gloomhaven 2e section 67.1 are different game-qualified sections and cannot be used as evidence for each other.',
      toolCalls: [
        {
          iteration: 1,
          id: 'call_1',
          name: 'resolve_entity',
          input: { game: 'frosthaven', query: 'section 67.1' },
          ok: true,
          outputSummary: 'candidate',
          sourceLabels: [],
          canonicalRefs: ['section:frosthaven/67.1'],
          startedAt: '2026-05-03T00:00:00.000Z',
          endedAt: '2026-05-03T00:00:00.001Z',
          durationMs: 1,
        },
        {
          iteration: 1,
          id: 'call_2',
          name: 'open_entity',
          input: { game: 'frosthaven', ref: 'section:frosthaven/67.1' },
          ok: true,
          outputSummary: 'section text',
          sourceLabels: [],
          canonicalRefs: ['section:frosthaven/67.1'],
          startedAt: '2026-05-03T00:00:00.001Z',
          endedAt: '2026-05-03T00:00:00.002Z',
          durationMs: 1,
        },
        {
          iteration: 1,
          id: 'call_3',
          name: 'open_entity',
          input: { game: 'gloomhaven-2e', ref: 'section:gloomhaven-2e/67.1' },
          ok: true,
          outputSummary: 'section text',
          sourceLabels: [],
          canonicalRefs: ['section:gloomhaven-2e/67.1'],
          startedAt: '2026-05-03T00:00:00.002Z',
          endedAt: '2026-05-03T00:00:00.003Z',
          durationMs: 1,
        },
      ],
    });

    expect(scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'correctness', value: 1 }),
        expect.objectContaining({ name: 'pass', value: 'pass' }),
        expect.objectContaining({ name: 'trajectory', value: 1 }),
        expect.objectContaining({ name: 'trajectory_pass', value: 'pass' }),
      ]),
    );
    expect(scores?.some((score) => score.name === 'failure_class')).toBe(false);
  });

  it('accepts long Gloomhaven 2e naming in cross-game boundary answers', async () => {
    const scores = await traceScoresForEvalResult({} as never, {
      evalCase: {
        id: 'boundary-section-67-gh2-then-fh',
        game: 'frosthaven',
        suite: 'cross-game-boundary',
        runtime: 'langgraph',
        caseCategory: 'trajectory',
        category: 'trajectory',
        source: 'unit-test',
        question: 'Compare section refs.',
        finalAnswer: {
          expected:
            'Gloomhaven 2e section 67.1 and Frosthaven section 67.1 are separate game-qualified sections.',
          grading: 'Must distinguish both game-qualified section refs.',
        },
        trajectory: {
          requiredTools: ['open_entity'],
          requiredToolKinds: ['open'],
          forbiddenTools: [],
          forbiddenToolKinds: [],
          requiredRefs: ['section:gloomhaven-2e/67.1', 'section:frosthaven/67.1'],
          maxToolCalls: 3,
        },
      },
      answer:
        'No. Gloomhaven (2nd Edition) section 67.1 and Frosthaven section 67.1 are completely independent records in separate, distinct games.',
      toolCalls: [
        {
          iteration: 1,
          id: 'call_1',
          name: 'open_entity',
          input: { game: 'gloomhaven-2e', ref: 'section:gloomhaven-2e/67.1' },
          ok: true,
          outputSummary: 'section text',
          sourceLabels: [],
          canonicalRefs: ['section:gloomhaven-2e/67.1'],
          startedAt: '2026-05-03T00:00:00.000Z',
          endedAt: '2026-05-03T00:00:00.001Z',
          durationMs: 1,
        },
        {
          iteration: 1,
          id: 'call_2',
          name: 'open_entity',
          input: { game: 'frosthaven', ref: 'section:frosthaven/67.1' },
          ok: true,
          outputSummary: 'section text',
          sourceLabels: [],
          canonicalRefs: ['section:frosthaven/67.1'],
          startedAt: '2026-05-03T00:00:00.001Z',
          endedAt: '2026-05-03T00:00:00.002Z',
          durationMs: 1,
        },
      ],
    });

    expect(scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'correctness', value: 1 }),
        expect.objectContaining({ name: 'pass', value: 'pass' }),
      ]),
    );
    expect(scores?.some((score) => score.name === 'failure_class')).toBe(false);
  });
});
