/**
 * Seed `unlock_graph_*` tables from `data/extracted/unlock-graphs/*.json`
 * (SQR-267). Prune-then-upsert per `(game, module)` inside one transaction
 * per module file, so removed/renamed scenarios never survive a reseed and
 * a partial failure rolls back only that module.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { and, eq, notInArray } from 'drizzle-orm';

import type { Db } from '../db.ts';
import { unlockGraphScenarios, unlockGraphThreads } from '../db/schema/unlock-graphs.ts';
import { UnlockGraphModuleSchema, type UnlockGraphModule } from '../unlock-graph-schemas.ts';

const EXTRACT_DIR = join(process.cwd(), 'data', 'extracted', 'unlock-graphs');

export interface UnlockGraphSeedResult {
  game: string;
  module: string;
  scenarios: number;
  threads: number;
  prunedScenarios: number;
  prunedThreads: number;
}

export function readUnlockGraphExtracts(dir: string = EXTRACT_DIR): UnlockGraphModule[] {
  const extracts = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) =>
      UnlockGraphModuleSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8'))),
    );

  // Fail fast on duplicate natural identities: prune-then-upsert would let a
  // second file with the same (game, module) silently prune the first's rows,
  // and a repeated scenario key / thread id would silently last-write-win.
  const seenModules = new Set<string>();
  for (const extract of extracts) {
    const moduleIdentity = `${extract.game}/${extract.module}`;
    if (seenModules.has(moduleIdentity)) {
      throw new Error(`Duplicate unlock-graph module identity: ${moduleIdentity}`);
    }
    seenModules.add(moduleIdentity);
    const scenarioKeys = new Set<string>();
    for (const scenario of extract.scenarios) {
      if (scenarioKeys.has(scenario.key)) {
        throw new Error(`Duplicate scenario key in ${moduleIdentity}: ${scenario.key}`);
      }
      scenarioKeys.add(scenario.key);
    }
    const threadIds = new Set<string>();
    for (const thread of extract.threads) {
      if (threadIds.has(thread.id)) {
        throw new Error(`Duplicate thread id in ${moduleIdentity}: ${thread.id}`);
      }
      threadIds.add(thread.id);
    }
  }

  return extracts;
}

export async function seedUnlockGraphModule(
  db: Db,
  extract: UnlockGraphModule,
): Promise<UnlockGraphSeedResult> {
  return db.transaction(async (tx) => {
    const scope = (table: typeof unlockGraphScenarios | typeof unlockGraphThreads) =>
      and(eq(table.game, extract.game), eq(table.module, extract.module));

    const currentKeys = extract.scenarios.map((s) => s.key);
    const prunedScenarios = await tx
      .delete(unlockGraphScenarios)
      .where(
        currentKeys.length === 0
          ? scope(unlockGraphScenarios)
          : and(scope(unlockGraphScenarios), notInArray(unlockGraphScenarios.key, currentKeys)),
      )
      .returning({ key: unlockGraphScenarios.key });

    const currentThreadIds = extract.threads.map((t) => t.id);
    const prunedThreads = await tx
      .delete(unlockGraphThreads)
      .where(
        currentThreadIds.length === 0
          ? scope(unlockGraphThreads)
          : and(
              scope(unlockGraphThreads),
              notInArray(unlockGraphThreads.threadId, currentThreadIds),
            ),
      )
      .returning({ threadId: unlockGraphThreads.threadId });

    for (const scenario of extract.scenarios) {
      await tx
        .insert(unlockGraphScenarios)
        .values({
          game: extract.game,
          module: extract.module,
          key: scenario.key,
          name: scenario.name,
          prereqsAll: scenario.prereqsAll,
          prereqsAny: scenario.prereqsAny,
          mutex: scenario.mutex,
          lockedIf: scenario.lockedIf,
          manual: scenario.manual,
          cond: scenario.cond,
          hazard: scenario.hazard,
        })
        .onConflictDoUpdate({
          target: [
            unlockGraphScenarios.game,
            unlockGraphScenarios.module,
            unlockGraphScenarios.key,
          ],
          set: {
            name: scenario.name,
            prereqsAll: scenario.prereqsAll,
            prereqsAny: scenario.prereqsAny,
            mutex: scenario.mutex,
            lockedIf: scenario.lockedIf,
            manual: scenario.manual,
            cond: scenario.cond,
            hazard: scenario.hazard,
          },
        });
    }

    for (const thread of extract.threads) {
      await tx
        .insert(unlockGraphThreads)
        .values({
          game: extract.game,
          module: extract.module,
          threadId: thread.id,
          label: thread.label,
          note: thread.note,
          position: thread.position,
          keys: thread.keys,
        })
        .onConflictDoUpdate({
          target: [unlockGraphThreads.game, unlockGraphThreads.module, unlockGraphThreads.threadId],
          set: {
            label: thread.label,
            note: thread.note,
            position: thread.position,
            keys: thread.keys,
          },
        });
    }

    return {
      game: extract.game,
      module: extract.module,
      scenarios: extract.scenarios.length,
      threads: extract.threads.length,
      prunedScenarios: prunedScenarios.length,
      prunedThreads: prunedThreads.length,
    };
  });
}

export async function seedUnlockGraphs(
  db: Db,
  dir: string = EXTRACT_DIR,
): Promise<UnlockGraphSeedResult[]> {
  const results: UnlockGraphSeedResult[] = [];
  for (const extract of readUnlockGraphExtracts(dir)) {
    results.push(await seedUnlockGraphModule(db, extract));
  }
  return results;
}
