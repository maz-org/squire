/**
 * Load seeded unlock-graph modules for a campaign's module set (SQR-268).
 * Returns `ModuleGraph`s ready for `deriveAvailability`. Modules without
 * seeded data simply come back absent — the advisory posture means a
 * campaign can reference a module Squire has no graph for yet.
 */
import { and, eq, or } from 'drizzle-orm';

import { getDb } from '../db.ts';
import { unlockGraphScenarios, unlockGraphThreads } from '../db/schema/unlock-graphs.ts';
import { campaignGameForModule } from '../game.ts';
import type { ModuleGraph } from './availability.ts';

export async function loadModuleGraphs(game: string, modules: string[]): Promise<ModuleGraph[]> {
  if (modules.length === 0) return [];
  const { db } = getDb('server');
  const moduleSeedGames = new Map(
    modules.map((module) => [module, campaignGameForModule(module) ?? game]),
  );
  const moduleScopes = modules.map((module) =>
    and(
      eq(unlockGraphScenarios.game, moduleSeedGames.get(module) ?? game),
      eq(unlockGraphScenarios.module, module),
    ),
  );
  const threadScopes = modules.map((module) =>
    and(
      eq(unlockGraphThreads.game, moduleSeedGames.get(module) ?? game),
      eq(unlockGraphThreads.module, module),
    ),
  );

  const scenarioRows = await db
    .select()
    .from(unlockGraphScenarios)
    .where(or(...moduleScopes));
  const threadRows = await db
    .select()
    .from(unlockGraphThreads)
    .where(or(...threadScopes))
    .orderBy(unlockGraphThreads.position);

  return modules
    .map((module) => {
      const seedGame = moduleSeedGames.get(module) ?? game;
      return {
        game: seedGame,
        module,
        scenarios: scenarioRows
          .filter((row) => row.game === seedGame && row.module === module)
          .map((row) => ({
            key: row.key,
            name: row.name,
            prereqsAll: row.prereqsAll,
            prereqsAny: row.prereqsAny,
            mutex: row.mutex,
            lockedIf: row.lockedIf,
            manual: row.manual,
            cond: row.cond,
            hazard: row.hazard,
            skippable: row.skippable,
            unlockClass: row.unlockClass,
            unlockMinLevel: row.unlockMinLevel,
          })),
        threads: threadRows
          .filter((row) => row.game === seedGame && row.module === module)
          .map((row) => ({
            id: row.threadId,
            label: row.label,
            note: row.note,
            position: row.position,
            keys: row.keys,
          })),
      };
    })
    .filter((graph) => graph.scenarios.length > 0);
}
