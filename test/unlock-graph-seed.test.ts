/**
 * Seed contract tests for `unlock_graph_*` (SQR-267): idempotency, the
 * prune path (removed scenarios/threads never survive a reseed), and the
 * loader round-trip used by the availability service.
 */
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
    expect(first.map((r) => `${r.module}:${r.scenarios}`)).toEqual(['gh2e:101', 'solo2e:18']);

    const second = await seedUnlockGraphs(db);
    expect(second.map((r) => r.prunedScenarios)).toEqual([0, 0]);
    expect(second.map((r) => r.scenarios)).toEqual([101, 18]);
  });

  it('prunes scenarios and threads missing from the latest extract', async () => {
    const [gh2e] = readUnlockGraphExtracts();
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

  it('round-trips through the loader for the availability service', async () => {
    await seedUnlockGraphs(db);
    const graphs = await loadModuleGraphs('gloomhaven-2e', ['gh2e', 'solo2e', 'not-seeded']);
    expect(graphs.map((g) => g.module)).toEqual(['gh2e', 'solo2e']);

    const seven = graphs[0].scenarios.find((s) => s.key === '7');
    expect(seven?.name).toBe('Black Barrow');
    expect(seven?.prereqsAny).toEqual(['4', '5']);
    expect(graphs[0].threads[0].position).toBe(0);
  });
});
