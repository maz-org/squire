import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  baselineCountsFor,
  filterEvalCases,
  gamePairForCase,
  langSmithDatasetNameForCase,
  loadLangSmithEvalCases,
  loadEvalCases,
  seedDataset,
  sourceAuthorityForCase,
} from '../eval/dataset.ts';
import {
  EvalDatasetSchema,
  EvalCaseSchema,
  countTrajectoryCases,
  evalCaseHasFinalAnswer,
  evalCaseHasSafety,
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
    expect(existsSync(join(process.cwd(), 'eval/suites/adversarial-boundary.json'))).toBe(true);
    expect(() => EvalDatasetSchema.parse(cases)).not.toThrow();

    expect(new Set(cases.map((evalCase) => evalCase.game))).toEqual(
      new Set(['frosthaven', 'gloomhaven-2e']),
    );
    expect(new Set(cases.map((evalCase) => evalCase.suite))).toEqual(
      new Set([
        'table-qa',
        'trajectory',
        'cross-game-boundary',
        'adversarial-boundary',
        'campaign-personalization',
        'campaign-writes',
      ]),
    );
    expect(new Set(cases.map((evalCase) => evalCase.runtime))).toEqual(new Set(['langgraph']));
  });

  it('keeps the existing final-answer cases and adds enough trajectory coverage', () => {
    expect(cases).toHaveLength(195);
    expect(cases.filter(evalCaseHasFinalAnswer)).toHaveLength(171);
    expect(countTrajectoryCases(cases)).toBeGreaterThanOrEqual(25);
    expect(cases.filter(evalCaseHasSafety)).toHaveLength(14);
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

  it('requires table-qa cases to declare dev or holdout split metadata', () => {
    const tableQaCases = cases.filter((evalCase) => evalCase.suite === 'table-qa');
    expect(tableQaCases).toHaveLength(150);
    expect(
      tableQaCases.every((evalCase) => evalCase.split === 'dev' || evalCase.split === 'holdout'),
    ).toBe(true);
    expect(new Set(tableQaCases.map((evalCase) => evalCase.game))).toEqual(
      new Set(['frosthaven', 'gloomhaven-2e']),
    );

    const holdoutCaseIds = tableQaCases
      .filter((evalCase) => evalCase.split === 'holdout')
      .map((evalCase) => evalCase.id);
    expect(holdoutCaseIds).toHaveLength(50);
    expect(holdoutCaseIds).toEqual(
      expect.arrayContaining([
        'building-mining-camp-level-1',
        'scenario-7-edge-world-unlocks',
        'gh2-monster-living-bones-elite-level-1',
        'gh2-scenario-4-crypt-damned',
        'gh2-prod-monster-ranged-disadvantage-trap-path',
      ]),
    );

    const bare: Record<string, unknown> = { ...tableQaCases[0] };
    delete bare.split;

    expect(() => EvalCaseSchema.parse(bare)).toThrow(/table-qa eval cases must define split/i);
  });

  it('accepts explicit per-case latency budgets in local and remote eval shapes', () => {
    const [evalCase] = cases;
    expect(evalCase).toBeDefined();
    const budgetedCase = {
      ...evalCase!,
      latencyBudget: {
        firstAnswerTokenMs: 2500,
        completeAnswerMs: 5000,
        notes: 'Table turnaround target for simple lookup cases.',
      },
    };

    expect(EvalCaseSchema.parse(budgetedCase).latencyBudget).toEqual({
      firstAnswerTokenMs: 2500,
      completeAnswerMs: 5000,
      notes: 'Table turnaround target for simple lookup cases.',
    });
    expect(() =>
      validateRemoteDatasetShape(
        [
          {
            expectedOutput: {
              finalAnswer: budgetedCase.finalAnswer,
              trajectory: budgetedCase.trajectory,
              safety: budgetedCase.safety,
              latencyBudget: budgetedCase.latencyBudget,
              split: 'dev',
            },
          },
        ],
        1,
        'unit/latency-budget',
      ),
    ).not.toThrow();
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
        splitFilter: undefined,
        categoryFilter: undefined,
        idFilter: undefined,
      }).every((evalCase) => evalCase.game === 'frosthaven' && evalCase.suite === 'trajectory'),
    ).toBe(true);

    expect(
      filterEvalCases(cases, {
        gameFilter: 'gloomhaven-2e',
        suiteFilter: undefined,
        splitFilter: undefined,
        categoryFilter: undefined,
        idFilter: 'traj-invalid-cross-game-ref',
      }).map((evalCase) => evalCase.id),
    ).toEqual(['traj-invalid-cross-game-ref']);

    expect(
      filterEvalCases(cases, {
        gameFilter: undefined,
        suiteFilter: 'adversarial-boundary',
        splitFilter: undefined,
        categoryFilter: 'system-prompt-extraction',
        idFilter: undefined,
      }).map((evalCase) => evalCase.id),
    ).toEqual(['adv-system-prompt-extraction']);

    expect(
      filterEvalCases(cases, {
        gameFilter: undefined,
        suiteFilter: 'table-qa',
        splitFilter: 'holdout',
        categoryFilter: undefined,
        idFilter: undefined,
      }).map((evalCase) => evalCase.id),
    ).toEqual(
      expect.arrayContaining([
        'building-mining-camp-level-1',
        'scenario-7-edge-world-unlocks',
        'gh2-monster-living-bones-elite-level-1',
        'gh2-scenario-4-crypt-damned',
        'gh2-prod-monster-ranged-disadvantage-trap-path',
      ]),
    );
  });

  it('derives parity baseline counts from fixture metadata', () => {
    expect(baselineCountsFor(cases, 'frosthaven')).toEqual({
      game: 'frosthaven',
      finalAnswerCases: 74,
      trajectoryCases: 12,
      boundaryCases: 1,
    });
    expect(baselineCountsFor(cases, 'gloomhaven-2e')).toEqual({
      game: 'gloomhaven-2e',
      finalAnswerCases: 76,
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
      langSmithDatasetNameForCase(
        cases.find((evalCase) => evalCase.id === 'adv-system-prompt-extraction')!,
      ),
    ).toBe('squire/adversarial/boundary');
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
    const adversarialCase = cases.find(
      (candidate) => candidate.id === 'adv-citation-source-boundary',
    );

    expect(faqCase && sourceAuthorityForCase(faqCase)).toBe('faq');
    expect(structuredCase && sourceAuthorityForCase(structuredCase)).toBe('structured-data');
    expect(boundaryCase && gamePairForCase(boundaryCase)).toBe('frosthaven:gloomhaven-2e');
    expect(adversarialCase && sourceAuthorityForCase(adversarialCase)).toBe('adversarial-fixture');
    expect(adversarialCase && gamePairForCase(adversarialCase)).toBe('frosthaven:gloomhaven-2e');
  });

  it('defines deterministic safety contracts for the adversarial boundary suite', () => {
    const adversarialCases = cases.filter((evalCase) => evalCase.suite === 'adversarial-boundary');

    expect(adversarialCases.map((evalCase) => evalCase.caseCategory).sort()).toEqual([
      'citation-source-boundary',
      'data-exfiltration',
      'history-context-injection',
      'hostile-source-text',
      'poisoned-source-entry',
      'role-manipulation',
      'system-prompt-extraction',
      'unsafe-html-output',
    ]);
    for (const evalCase of adversarialCases) {
      expect(evalCase.safety).toBeDefined();
      expect(
        (evalCase.safety?.forbiddenAnswerPatterns.length ?? 0) +
          (evalCase.safety?.requiredAnswerPatterns.length ?? 0) +
          (evalCase.safety?.requiredCanonicalRefPatterns.length ?? 0) +
          (evalCase.safety?.forbiddenCanonicalRefPatterns.length ?? 0) +
          (evalCase.safety?.requiredSourceLabelPatterns.length ?? 0) +
          (evalCase.safety?.forbiddenSourceLabelPatterns.length ?? 0),
      ).toBeGreaterThan(0);
    }
  });

  it('makes the cross-game ref case assert both game-qualified refs', () => {
    const evalCase = cases.find((candidate) => candidate.id === 'traj-invalid-cross-game-ref');

    expect(evalCase?.finalAnswer?.grading).toMatch(/different game-qualified sections/);
    expect(evalCase?.trajectory?.requiredRefs).toContain('section:gloomhaven-2e/67.1');
  });

  it('does not require resolution for cross-game cases that explicitly ask to open refs', () => {
    const scenarioCase = cases.find(
      (candidate) => candidate.id === 'boundary-scenario-61-fh-then-gh2',
    );
    const sectionCase = cases.find(
      (candidate) => candidate.id === 'boundary-section-67-gh2-then-fh',
    );

    for (const evalCase of [scenarioCase, sectionCase]) {
      expect(evalCase?.question).toMatch(/\bOpen\b/);
      expect(evalCase?.trajectory?.requiredTools).toEqual(['open_entity']);
      expect(evalCase?.trajectory?.requiredToolKinds).toEqual(['open']);
    }
  });

  it('allows section-parent questions to answer from opened section refs', () => {
    const evalCase = cases.find((candidate) => candidate.id === 'gh2-traj-section-parent-scenario');

    expect(evalCase?.trajectory?.requiredTools).toEqual(['open_entity']);
    expect(evalCase?.trajectory?.requiredToolKinds).toEqual(['open']);
    expect(evalCase?.trajectory?.requiredRefs).toEqual(
      expect.arrayContaining(['section:gloomhaven-2e/67.1', 'scenario:gloomhaven-2e/055']),
    );
  });

  it('allows explicit GH2 section-open checks to skip resolution', () => {
    const evalCase = cases.find((candidate) => candidate.id === 'gh2-traj-no-frosthaven-source');

    expect(evalCase?.question).toMatch(/\bOpen Gloomhaven 2e section 67\.1\b/);
    expect(evalCase?.trajectory?.requiredTools).toEqual(['open_entity']);
    expect(evalCase?.trajectory?.requiredToolKinds).toEqual(['open']);
    expect(evalCase?.trajectory?.requiredRefs).toContain('section:gloomhaven-2e/67.1');
  });

  it('keeps the GH2 advantage expectation aligned with the checked-in rulebook wording', () => {
    const evalCase = cases.find((candidate) => candidate.id === 'gh2-rule-advantage');

    expect(evalCase?.finalAnswer?.expected).toMatch(/character may use either/i);
    expect(evalCase?.finalAnswer?.grading).not.toMatch(/Frosthaven-specific character-choice/);
  });

  it('guards the GH2 high-level Living Spirit monster-stat smoke miss', () => {
    const evalCase = cases.find(
      (candidate) => candidate.id === 'gh2-monster-living-spirit-elite-level-7-hp',
    );

    expect(evalCase?.question).toMatch(/elite level 7 Living Spirit/i);
    expect(evalCase?.finalAnswer?.expected).toMatch(/10 hit points/i);
    expect(evalCase?.finalAnswer?.grading).toMatch(/levels 4-7/i);
  });

  it('treats read-now chain traversal as a neighbors requirement', () => {
    const evalCase = cases.find((candidate) => candidate.id === 'traj-section-read-now-chain');

    expect(evalCase?.trajectory?.requiredTools).toContain('neighbors');
    expect(evalCase?.trajectory?.requiredToolKinds).toContain('traversal');
    expect(evalCase?.trajectory?.requiredTools).not.toContain('open_entity');
  });

  it('uses the combined lookup tool for exact item-open trajectory checks', () => {
    const exactItemCase = cases.find((candidate) => candidate.id === 'traj-exact-item-open');
    const gh2ExactItemCase = cases.find((candidate) => candidate.id === 'gh2-traj-exact-item-open');

    for (const evalCase of [exactItemCase, gh2ExactItemCase]) {
      expect(evalCase?.trajectory?.requiredTools).toEqual(['lookup_entity']);
      expect(evalCase?.trajectory?.requiredToolKinds).toEqual(['open']);
    }
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

  it('guards the Drifter ignore-negative-item-effects user-correction regression', () => {
    const evalCase = cases.find(
      (candidate) => candidate.id === 'drifter-ignore-negative-item-effects-correction',
    );

    expect(evalCase?.question).toMatch(/Drifter/i);
    expect(evalCase?.finalAnswer?.expected).toMatch(/ignore negative item effects/i);
    expect(evalCase?.finalAnswer?.grading).toMatch(/must not deny/i);
    expect(evalCase?.finalAnswer?.grading).toMatch(/effect text/i);
    expect(evalCase?.finalAnswer?.grading).toMatch(/unsupported source text/i);
    expect(evalCase?.trajectory?.requiredTools).toEqual(['lookup_entity']);
    expect(evalCase?.trajectory?.requiredRefs).toContain(
      'card:frosthaven/character-mats/gloomhavensecretariat:character-mat/drifter',
    );
    expect(evalCase?.safety?.forbiddenAnswerPatterns).toEqual([
      'drifter[^.]{0,80}(?:no|not|does not|doesn.t)[^.]{0,80}(?:ignore negative item effects|negative item)',
    ]);
  });

  it('defines flexible tool-path expectations for trajectory cases', () => {
    const trajectoryCases = cases.filter(evalCaseHasTrajectory);

    expect(trajectoryCases.length).toBeGreaterThanOrEqual(10);
    for (const evalCase of trajectoryCases) {
      expect(evalCase.trajectory.maxToolCalls).toBeGreaterThan(0);
      // Required-path cases assert what must happen; forbidden-only cases
      // (the SQR-288 injection set) assert what must NOT happen. Either way
      // the trajectory block has to claim something.
      expect(
        evalCase.trajectory.requiredTools.length +
          evalCase.trajectory.requiredToolKinds.length +
          evalCase.trajectory.requiredRefs.length +
          evalCase.trajectory.forbiddenTools.length +
          evalCase.trajectory.forbiddenToolKinds.length,
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

  it('loads eval cases from LangSmith examples and preserves example ids', async () => {
    const evalCase = cases.find((candidate) => candidate.id === 'rule-poison');
    expect(evalCase).toBeDefined();
    const client = {
      hasDataset: vi.fn().mockResolvedValue(true),
      readDataset: vi.fn().mockResolvedValue({
        id: 'dataset-fh-table',
        name: 'squire/frosthaven/table-qa',
      }),
      listExamples: vi.fn(async function* () {
        yield {
          id: 'example-rule-poison',
          dataset_id: 'dataset-fh-table',
          created_at: '2026-05-01T00:00:00.000Z',
          inputs: { question: 'stale remote question' },
          outputs: {
            expectedOutput: {
              finalAnswer: {
                expected: 'stale remote expected answer',
                grading: 'stale remote grading',
              },
            },
          },
          metadata: {
            slug: evalCase!.id,
            game: evalCase!.game,
            suite: evalCase!.suite,
            runtime: evalCase!.runtime,
            split: evalCase!.split,
            category: evalCase!.category,
            caseCategory: evalCase!.caseCategory,
            source: evalCase!.source,
          },
          runs: [],
        };
      }),
    };

    const loaded = await loadLangSmithEvalCases(client, [evalCase!], {
      gameFilter: undefined,
      suiteFilter: undefined,
      splitFilter: undefined,
      categoryFilter: undefined,
      idFilter: 'rule-poison',
    });

    expect(loaded.cases).toHaveLength(1);
    expect(loaded.cases[0]).toMatchObject({
      id: 'rule-poison',
      question: evalCase!.question,
      finalAnswer: evalCase!.finalAnswer,
      langsmithExampleId: 'example-rule-poison',
      langsmithDatasetId: 'dataset-fh-table',
      langsmithDatasetName: 'squire/frosthaven/table-qa',
    });
    expect(loaded.datasets).toEqual([
      {
        id: 'dataset-fh-table',
        name: 'squire/frosthaven/table-qa',
      },
    ]);
  });

  it('fails when a required LangSmith dataset is missing', async () => {
    const evalCase = cases.find((candidate) => candidate.id === 'rule-poison');
    const client = {
      hasDataset: vi.fn().mockResolvedValue(false),
      readDataset: vi.fn(),
      listExamples: vi.fn(),
    };

    await expect(
      loadLangSmithEvalCases(client, [evalCase!], {
        gameFilter: undefined,
        suiteFilter: undefined,
        splitFilter: undefined,
        categoryFilter: undefined,
        idFilter: 'rule-poison',
      }),
    ).rejects.toThrow(/Missing LangSmith dataset "squire\/frosthaven\/table-qa"/);
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
      outputs: {
        expectedOutput: {
          finalAnswer: evalCase!.finalAnswer,
          trajectory: evalCase!.trajectory,
          split: evalCase!.split,
        },
      },
      metadata: expect.objectContaining({
        slug: evalCase!.id,
        game: 'frosthaven',
        suite: 'table-qa',
        runtime: 'langgraph',
        split: 'dev',
        caseCategory: evalCase!.caseCategory,
        sourceAuthority: 'rulebook',
        isHoldout: false,
      }),
    });
  });
});
