import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  baselineCountsFor,
  filterEvalCases,
  gamePairForCase,
  langSmithDatasetNameForCase,
  loadEvalCases,
  seedDataset,
  sourceAuthorityForCase,
} from '../eval/dataset.ts';
import {
  EvalDatasetSchema,
  countTrajectoryCases,
  evalCaseHasFinalAnswer,
  evalCaseHasTrajectory,
  validateRemoteDatasetShape,
} from '../eval/schema.ts';

const cases = loadEvalCases();
const items = JSON.parse(
  readFileSync(join(process.cwd(), 'data/extracted/items.json'), 'utf-8'),
) as
  | Array<{
      name: string;
      number: string;
      slot: string;
      cost: number | null;
      craftCost?: { resources?: Record<string, number> };
      effect: string;
      uses: number | null;
    }>
  | undefined;
const buildings = JSON.parse(
  readFileSync(join(process.cwd(), 'data/extracted/buildings.json'), 'utf-8'),
) as
  | Array<{
      name: string;
      level: number;
      initialBuildCost?: Record<string, number>;
      upgradeCost?: Record<string, number> | null;
      campaignStartBuilt?: boolean;
      effect: string;
    }>
  | undefined;

describe('eval dataset', () => {
  it('loads split final-answer, trajectory, and boundary fixtures', () => {
    expect(existsSync(join(process.cwd(), 'eval/suites/frosthaven.json'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'eval/suites/cross-game-boundary.json'))).toBe(true);
    expect(() => EvalDatasetSchema.parse(cases)).not.toThrow();

    expect(new Set(cases.map((evalCase) => evalCase.game))).toEqual(
      new Set(['frosthaven', 'gloomhaven-2e']),
    );
    expect(new Set(cases.map((evalCase) => evalCase.suite))).toEqual(
      new Set(['table-qa', 'trajectory', 'cross-game-boundary']),
    );
    expect(new Set(cases.map((evalCase) => evalCase.runtime))).toEqual(new Set(['langgraph']));
  });

  it('keeps the existing final-answer cases and adds enough trajectory coverage', () => {
    expect(cases).toHaveLength(59);
    expect(cases.filter(evalCaseHasFinalAnswer)).toHaveLength(37);
    expect(countTrajectoryCases(cases)).toBeGreaterThanOrEqual(25);
  });

  it('requires explicit eval metadata on cases', () => {
    const [evalCase] = cases;
    expect(evalCase).toBeDefined();
    const bare: Partial<typeof evalCase> = { ...evalCase };
    delete bare.game;
    delete bare.suite;
    delete bare.runtime;
    delete bare.caseCategory;

    expect(() => EvalDatasetSchema.parse([bare])).toThrow(/game|required/i);
  });

  it('uses canonical Gloomhaven 2e display copy in fixture text', () => {
    const serialized = JSON.stringify(cases);

    expect(serialized).not.toContain('Gloomhaven 2.0');
    expect(serialized).toContain('Gloomhaven 2e');
  });

  it('filters eval cases by game, suite, category, and id', () => {
    expect(
      filterEvalCases(cases, {
        gameFilter: 'frosthaven',
        suiteFilter: 'trajectory',
        categoryFilter: undefined,
        idFilter: undefined,
      }).every((evalCase) => evalCase.game === 'frosthaven' && evalCase.suite === 'trajectory'),
    ).toBe(true);

    expect(
      filterEvalCases(cases, {
        gameFilter: 'gloomhaven-2e',
        suiteFilter: undefined,
        categoryFilter: undefined,
        idFilter: 'traj-invalid-cross-game-ref',
      }).map((evalCase) => evalCase.id),
    ).toEqual(['traj-invalid-cross-game-ref']);
  });

  it('derives the Frosthaven parity baseline from fixture metadata', () => {
    expect(baselineCountsFor(cases, 'frosthaven')).toEqual({
      game: 'frosthaven',
      finalAnswerCases: 17,
      trajectoryCases: 11,
      boundaryCases: 1,
    });
    expect(baselineCountsFor(cases, 'gloomhaven-2e')).toEqual({
      game: 'gloomhaven-2e',
      finalAnswerCases: 17,
      trajectoryCases: 11,
      boundaryCases: 2,
    });
  });

  it('maps cases to suite-specific LangSmith dataset names', () => {
    const frosthavenCase = cases.find((evalCase) => evalCase.id === 'rule-poison');
    const boundaryCase = cases.find((evalCase) => evalCase.id === 'traj-invalid-cross-game-ref');

    expect(frosthavenCase && langSmithDatasetNameForCase(frosthavenCase)).toBe(
      'squire/frosthaven/table-qa',
    );
    expect(boundaryCase && langSmithDatasetNameForCase(boundaryCase)).toBe(
      'squire/cross-game/boundary',
    );
    expect(
      frosthavenCase &&
        langSmithDatasetNameForCase({
          ...frosthavenCase,
          game: 'gloomhaven-2e',
          suite: 'trajectory',
        }),
    ).toBe('squire/gloomhaven-2e/trajectory');
  });

  it('derives source authority and game-pair metadata for reports and LangSmith examples', () => {
    const faqCase = cases.find((candidate) => candidate.id === 'gh2-faq-red-hex-aoe-targets');
    const structuredCase = cases.find((candidate) => candidate.id === 'gh2-item-weathered-boots');
    const boundaryCase = cases.find(
      (candidate) => candidate.id === 'boundary-scenario-61-fh-then-gh2',
    );

    expect(faqCase && sourceAuthorityForCase(faqCase)).toBe('faq');
    expect(structuredCase && sourceAuthorityForCase(structuredCase)).toBe('structured-data');
    expect(boundaryCase && gamePairForCase(boundaryCase)).toBe('frosthaven:gloomhaven-2e');
  });

  it('makes the cross-game ref case assert both game-qualified refs', () => {
    const evalCase = cases.find((candidate) => candidate.id === 'traj-invalid-cross-game-ref');

    expect(evalCase?.finalAnswer?.grading).toMatch(/different game-qualified sections/);
    expect(evalCase?.trajectory?.requiredRefs).toContain('section:gloomhaven-2e/67.1');
  });

  it('treats read-now chain traversal as a neighbors requirement', () => {
    const evalCase = cases.find((candidate) => candidate.id === 'traj-section-read-now-chain');

    expect(evalCase?.trajectory?.requiredTools).toContain('neighbors');
    expect(evalCase?.trajectory?.requiredToolKinds).toContain('traversal');
    expect(evalCase?.trajectory?.requiredTools).not.toContain('open_entity');
  });

  it('keeps SQR-137 final-answer expectations aligned with checked-in data', () => {
    const byId = new Map(cases.map((evalCase) => [evalCase.id, evalCase]));

    expect(byId.get('monster-living-bones-immunity')?.finalAnswer).toMatchObject({
      expected: expect.stringMatching(/no condition immunit/i),
      grading: expect.stringMatching(/must not claim poison or wound immunity/i),
    });

    expect(byId.get('building-alchemist')?.finalAnswer).toMatchObject({
      expected: expect.stringMatching(/initial build cost is no cost/i),
      grading: expect.stringMatching(/upgrade cost/i),
    });

    expect(byId.get('scenario-61-unlock')?.finalAnswer).toMatchObject({
      expected: expect.stringMatching(/Section 79\.4/i),
      grading: expect.stringMatching(/Crain|star iron/i),
    });
  });

  it('keeps the Alchemist eval contract scoped to cost semantics', () => {
    const alchemistCase = cases.find((evalCase) => evalCase.id === 'building-alchemist');
    const alchemistLevel1 = buildings?.find(
      (building) => building.name === 'Alchemist' && building.level === 1,
    );

    expect(alchemistLevel1).toMatchObject({
      campaignStartBuilt: true,
      initialBuildCost: {
        prosperity: 0,
        gold: 0,
        lumber: 0,
        metal: 0,
        hide: 0,
      },
      upgradeCost: {
        prosperity: 1,
        gold: 0,
        lumber: 2,
        metal: 2,
        hide: 1,
      },
      effect: 'Characters cannot use potions',
    });
    expect(alchemistCase?.finalAnswer?.expected).toMatch(/built at campaign start/i);
    expect(alchemistCase?.finalAnswer?.expected).toMatch(
      /1 prosperity, 2 lumber, 2 metal, and 1 hide/i,
    );
    expect(alchemistCase?.finalAnswer?.grading).toMatch(/effect text is not required/i);
    expect(alchemistCase?.finalAnswer?.grading).toMatch(/do not penalize.*sourced level 1 effect/i);
    expect(alchemistCase?.finalAnswer?.grading).toMatch(/penalize.*unbuilt/i);
    expect(alchemistCase?.finalAnswer?.grading).toMatch(/ruined/i);
  });

  it('keeps the Spyglass final-answer expectation aligned with checked-in item data', () => {
    const spyglassCase = cases.find((evalCase) => evalCase.id === 'item-spyglass');
    const spyglassItem = items?.find((item) => item.name === 'Spyglass');

    expect(spyglassItem).toMatchObject({
      number: '001',
      slot: 'head',
      cost: null,
      craftCost: { resources: { metal: 1 } },
      effect: 'During your attack ability, gain advantage on one attack.',
      uses: null,
    });
    expect(spyglassCase?.finalAnswer).toMatchObject({
      expected: expect.stringMatching(/Item #001/i),
      grading: expect.stringMatching(/not say 40 gold/i),
    });
    expect(spyglassCase?.finalAnswer?.expected).toMatch(/head slot/i);
    expect(spyglassCase?.finalAnswer?.expected).toMatch(/craft cost 1 metal/i);
    expect(spyglassCase?.finalAnswer?.expected).not.toMatch(/40 gold|small item slot|2 uses/i);
  });

  it('defines flexible tool-path expectations for trajectory cases', () => {
    const trajectoryCases = cases.filter(evalCaseHasTrajectory);

    expect(trajectoryCases.length).toBeGreaterThanOrEqual(10);
    for (const evalCase of trajectoryCases) {
      expect(evalCase.trajectory.maxToolCalls).toBeGreaterThan(0);
      expect(
        evalCase.trajectory.requiredTools.length +
          evalCase.trajectory.requiredToolKinds.length +
          evalCase.trajectory.requiredRefs.length,
      ).toBeGreaterThan(0);
    }
  });

  it('rejects stale remote LangSmith dataset shapes before a full run', () => {
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

  it('rejects remote LangSmith datasets with a stale item count', () => {
    expect(() =>
      validateRemoteDatasetShape(
        [{ expectedOutput: { finalAnswer: { expected: 'ok', grading: 'ok' } } }],
        2,
        'frosthaven-qa',
      ),
    ).toThrow(/has 1 item/);
  });

  it('rejects malformed remote LangSmith expected outputs', () => {
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

  it('reseeds LangSmith examples without using slug ids as UUIDs', async () => {
    const [evalCase] = cases;
    const client = {
      hasDataset: vi.fn().mockResolvedValue(true),
      listExamples: vi.fn(async function* () {
        yield { id: '550e8400-e29b-41d4-a716-446655440000' };
      }),
      deleteExamples: vi.fn().mockResolvedValue(undefined),
      createExamples: vi.fn().mockResolvedValue([]),
    };

    await seedDataset(client as unknown as Parameters<typeof seedDataset>[0], [evalCase!]);

    expect(client.deleteExamples).toHaveBeenCalledWith(['550e8400-e29b-41d4-a716-446655440000'], {
      hardDelete: true,
    });
    const [[createdExamples]] = client.createExamples.mock.calls;
    const [createdExample] = createdExamples;
    expect(createdExample).not.toHaveProperty('id');
    expect(createdExample).toMatchObject({
      dataset_name: 'squire/frosthaven/table-qa',
      metadata: expect.objectContaining({
        slug: evalCase!.id,
        game: 'frosthaven',
        suite: 'table-qa',
        runtime: 'langgraph',
        caseCategory: evalCase!.caseCategory,
        sourceAuthority: 'rulebook',
      }),
    });
  });
});
