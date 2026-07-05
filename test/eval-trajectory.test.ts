import { describe, expect, it } from 'vitest';

import { scoreTrajectory } from '../eval/schema.ts';

describe('scoreTrajectory', () => {
  it('passes flexible required tools, kinds, refs, and budget checks', () => {
    const result = scoreTrajectory(
      {
        requiredTools: ['lookup_entity'],
        requiredToolKinds: ['open'],
        forbiddenTools: ['search_rules'],
        forbiddenToolKinds: ['traversal'],
        requiredRefs: ['card:frosthaven/items/gloomhavensecretariat:item/1'],
        maxToolCalls: 3,
      },
      [
        {
          name: 'lookup_entity',
          input: { query: 'item 1', kinds: ['item'] },
          canonicalRefs: ['card:frosthaven/items/gloomhavensecretariat:item/1'],
        },
      ],
    );

    expect(result).toEqual({ pass: true, failures: [] });
  });

  it('matches required refs against normalized inputs and tool-result canonical refs', () => {
    const result = scoreTrajectory(
      {
        requiredTools: ['resolve_entity', 'neighbors'],
        requiredToolKinds: ['resolution', 'traversal'],
        forbiddenTools: [],
        forbiddenToolKinds: [],
        requiredRefs: ['scenario:frosthaven/061', 'section:frosthaven/67.1'],
        maxToolCalls: 2,
      },
      [
        { name: 'resolve_entity', input: { query: 'scenario 61' } },
        {
          name: 'neighbors',
          input: { ref: 'gloomhavensecretariat:scenario/61' },
          canonicalRefs: ['section:67.1'],
        },
      ],
    );

    expect(result).toEqual({ pass: true, failures: [] });
  });

  it('normalizes GH2 alias refs to canonical trajectory refs', () => {
    const result = scoreTrajectory(
      {
        requiredTools: ['open_entity'],
        requiredToolKinds: ['open'],
        forbiddenTools: [],
        forbiddenToolKinds: [],
        requiredRefs: [
          'scenario:gloomhaven-2e/061',
          'scenario:gloomhaven-2e/4A',
          'section:gloomhaven-2e/67.1',
          'card:gloomhaven-2e/items/gloomhavensecretariat:item/1',
        ],
        maxToolCalls: 2,
      },
      [
        {
          name: 'open_entity',
          input: { ref: 'scenario:gloomhaven2/61' },
          canonicalRefs: [
            'scenario:gh2/4A',
            'section:gh2/67.1',
            'card:gh2e/items/gloomhavensecretariat:item/1',
          ],
        },
      ],
    );

    expect(result).toEqual({ pass: true, failures: [] });
  });

  it('accepts lookup_entity as an exact-open adapter when required refs are present', () => {
    const result = scoreTrajectory(
      {
        requiredTools: ['open_entity'],
        requiredToolKinds: ['open'],
        forbiddenTools: ['search_rules'],
        forbiddenToolKinds: [],
        requiredRefs: ['scenario:frosthaven/061', 'scenario:gloomhaven-2e/061'],
        maxToolCalls: 2,
      },
      [
        {
          name: 'lookup_entity',
          input: { game: 'frosthaven', query: 'scenario 61', kinds: ['scenario'] },
          canonicalRefs: ['scenario:frosthaven/061'],
        },
        {
          name: 'lookup_entity',
          input: { game: 'gloomhaven-2e', query: 'scenario 61', kinds: ['scenario'] },
          canonicalRefs: ['scenario:gloomhaven-2e/061'],
        },
      ],
    );

    expect(result).toEqual({ pass: true, failures: [] });
  });

  it('matches exact card refs against opened GHS source IDs', () => {
    const result = scoreTrajectory(
      {
        requiredTools: ['resolve_entity', 'open_entity'],
        requiredToolKinds: ['resolution', 'open'],
        forbiddenTools: ['search_rules'],
        forbiddenToolKinds: [],
        requiredRefs: ['card:frosthaven/items/gloomhavensecretariat:item/1'],
        maxToolCalls: 3,
      },
      [
        { name: 'resolve_entity', input: { query: 'item 1', kinds: ['item'] } },
        {
          name: 'open_entity',
          input: { ref: 'gloomhavensecretariat:item/1' },
          canonicalRefs: ['gloomhavensecretariat:item/1'],
        },
      ],
    );

    expect(result).toEqual({ pass: true, failures: [] });
  });

  it('reports missing requirements and forbidden calls', () => {
    const result = scoreTrajectory(
      {
        requiredTools: ['neighbors'],
        requiredToolKinds: ['traversal'],
        forbiddenTools: ['search_rules'],
        forbiddenToolKinds: ['search'],
        requiredRefs: ['section:frosthaven/67.1'],
        maxToolCalls: 1,
      },
      [
        { name: 'search_rules', input: { query: 'scenario 61' } },
        { name: 'open_entity', input: { ref: 'scenario:frosthaven/061' } },
      ],
    );

    expect(result.pass).toBe(false);
    expect(result.failures).toEqual([
      'expected at most 1 tool call(s), saw 2',
      'missing required tool: neighbors',
      'used forbidden tool: search_rules',
      'missing required tool kind: traversal',
      'used forbidden tool kind: search',
      'missing required ref: section:frosthaven/67.1',
    ]);
  });
});
