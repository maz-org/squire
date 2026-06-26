/**
 * Seed contract tests for `unlock_graph_*` (SQR-267): idempotency, the
 * prune path (removed scenarios/threads never survive a reseed), duplicate
 * natural-identity fail-fast, and the loader round-trip used by the
 * availability service.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { shutdownServerPool } from '../src/db.ts';
import { loadModuleGraphs } from '../src/campaign/unlock-graph-loader.ts';
import {
  readUnlockGraphExtracts,
  seedUnlockGraphModule,
  seedUnlockGraphs,
} from '../src/seed/seed-unlock-graphs.ts';
import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';

let db: Awaited<ReturnType<typeof setupTestDb>>;

describe('seedUnlockGraphs', () => {
  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
    await shutdownServerPool();
  });

  it('seeds the checked-in extracts idempotently', async () => {
    const first = await seedUnlockGraphs(db);
    expect(first.map((r) => `${r.module}:${r.scenarios}`)).toEqual([
      'fh:162',
      'gh1e:95',
      'gh2e:101',
      'jotl:25',
      'solo1e:17',
      'solo2e:18',
    ]);

    const second = await seedUnlockGraphs(db);
    expect(second.map((r) => r.prunedScenarios)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(second.map((r) => r.scenarios)).toEqual([162, 95, 101, 25, 17, 18]);
  });

  it('imports the future GH1e and JotL modules through the shared format', () => {
    const extracts = readUnlockGraphExtracts();
    const gh1e = extracts.find((extract) => extract.module === 'gh1e');
    const jotl = extracts.find((extract) => extract.module === 'jotl');
    const solo1e = extracts.find((extract) => extract.module === 'solo1e');

    expect(gh1e).toMatchObject({ game: 'gloomhaven-1e', scenarios: expect.any(Array) });
    expect(jotl).toMatchObject({ game: 'jaws-of-the-lion', scenarios: expect.any(Array) });
    expect(solo1e).toMatchObject({ game: 'gloomhaven-1e', scenarios: expect.any(Array) });

    const barrowLair = gh1e?.scenarios.find((scenario) => scenario.key === '2');
    expect(barrowLair).toMatchObject({
      name: 'Barrow Lair',
      prereqsAll: ['1'],
      prereqsAny: [],
    });

    const gh1eHazard = gh1e?.scenarios.find((scenario) => scenario.key === '27');
    expect(gh1eHazard).toMatchObject({ name: 'Ruinous Rift', hazard: true });

    const jotlBranch = jotl?.scenarios.find((scenario) => scenario.key === '9');
    expect(jotlBranch).toMatchObject({
      name: 'Explosive Evolution',
      prereqsAny: ['7', '8'],
    });

    expect(solo1e?.scenarios.find((scenario) => scenario.key === 'brute')).toMatchObject({
      name: 'Return to the Black Barrow',
      manual: true,
      cond: 'Brute level 5',
    });
  });

  it('prunes scenarios and threads missing from the latest extract', async () => {
    const gh2e = readUnlockGraphExtracts().find((extract) => extract.module === 'gh2e');
    if (!gh2e) throw new Error('gh2e extract missing');
    await seedUnlockGraphModule(db, gh2e);

    const shrunk = {
      ...gh2e,
      scenarios: gh2e.scenarios.slice(0, 10),
      threads: gh2e.threads.slice(0, 2),
    };
    const result = await seedUnlockGraphModule(db, shrunk);
    expect(result.prunedScenarios).toBe(gh2e.scenarios.length - 10);
    expect(result.prunedThreads).toBe(gh2e.threads.length - 2);

    const [reloaded] = await loadModuleGraphs(gh2e.game, [gh2e.module]);
    expect(reloaded.scenarios).toHaveLength(10);
    expect(reloaded.threads).toHaveLength(2);
  });

  it('fails fast on duplicate module, scenario, and thread identities', () => {
    const minimalModule = (overrides: Record<string, unknown> = {}) => ({
      provenance: 'test',
      game: 'test-game',
      module: 'test-module',
      scenarios: [
        {
          key: '1',
          name: 'One',
          prereqsAll: [],
          prereqsAny: [],
          mutex: [],
          lockedIf: [],
          manual: false,
          cond: null,
          hazard: false,
        },
      ],
      threads: [],
      ...overrides,
    });
    const withDir = (files: Record<string, unknown>, assert: (dir: string) => void) => {
      const dir = mkdtempSync(join(tmpdir(), 'unlock-graph-seed-'));
      try {
        for (const [name, content] of Object.entries(files)) {
          writeFileSync(join(dir, name), JSON.stringify(content));
        }
        assert(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    // Two files with the same (game, module): prune-then-upsert would let the
    // second silently prune the first's rows.
    withDir({ 'a.json': minimalModule(), 'b.json': minimalModule() }, (dir) => {
      expect(() => readUnlockGraphExtracts(dir)).toThrow(
        'Duplicate unlock-graph module identity: test-game/test-module',
      );
    });

    const scenario = minimalModule().scenarios[0];
    withDir({ 'a.json': minimalModule({ scenarios: [scenario, scenario] }) }, (dir) => {
      expect(() => readUnlockGraphExtracts(dir)).toThrow(
        'Duplicate scenario key in test-game/test-module: 1',
      );
    });

    const thread = { id: 't1', label: 'Thread', note: '', position: 0, keys: ['1'] };
    withDir({ 'a.json': minimalModule({ threads: [thread, thread] }) }, (dir) => {
      expect(() => readUnlockGraphExtracts(dir)).toThrow(
        'Duplicate thread id in test-game/test-module: t1',
      );
    });
  });

  it('round-trips through the loader for the availability service', async () => {
    await seedUnlockGraphs(db);
    const graphs = await loadModuleGraphs('gloomhaven-2e', ['gh2e', 'solo2e', 'not-seeded']);
    expect(graphs.map((g) => g.module)).toEqual(['gh2e', 'solo2e']);

    const seven = graphs[0].scenarios.find((s) => s.key === '7');
    expect(seven?.name).toBe('Black Barrow');
    expect(seven?.prereqsAny).toEqual(['4', '5']);
    expect(graphs[0].threads[0].position).toBe(0);

    const futureGraphs = await loadModuleGraphs('jaws-of-the-lion', ['jotl']);
    expect(futureGraphs).toHaveLength(1);
    expect(futureGraphs[0].scenarios).toHaveLength(25);
    expect(futureGraphs[0].threads.map((thread) => thread.id)).toEqual([
      'jotl_tutorial',
      'jotl_main',
      'jotl_personal',
    ]);

    const gh1eWithJotlGraphs = await loadModuleGraphs('gloomhaven-1e', ['gh1e', 'solo1e', 'jotl']);
    expect(gh1eWithJotlGraphs.map((g) => `${g.game}:${g.module}`)).toEqual([
      'gloomhaven-1e:gh1e',
      'gloomhaven-1e:solo1e',
      'jaws-of-the-lion:jotl',
    ]);
    expect(gh1eWithJotlGraphs.find((g) => g.module === 'jotl')?.scenarios).toHaveLength(25);
  });
});
