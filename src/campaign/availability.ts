/**
 * Scenario availability derivation (SQR-268, eng decision E9).
 *
 * Pure, in-process port of the prototype's `computeStatus` semantics over
 * module-scoped keys. Statuses are DERIVED, never stored — the write path
 * snapshots them into audit rows at mutation time (constraint 10), and the
 * dashboard/agent recompute on read. The graph is advisory: campaign keys
 * that aren't in any loaded module graph surface in `unknownKeys` rather
 * than failing, and the game is always the truth.
 *
 * Status semantics (mirroring the prototype, golden-tested against Brian's
 * live campaign in test/fixtures/unlock-graphs/):
 * - played:    key is in the campaign's played set
 * - blocked:   an unplayed scenario whose mutex/lockedIf set intersects the
 *              played set (permanently closed by a choice)
 * - open:      non-manual scenario whose prereqs are met (no prereqs = open)
 * - locked:    prereqs not met (manual or not)
 * - via-event: manual scenario whose prereqs are met but not yet drawn
 * - drew-it:   manual scenario drawn but not yet played
 */
import type { UnlockGraphScenario, UnlockGraphThread } from '../unlock-graph-schemas.ts';

export type ScenarioStatus = 'played' | 'open' | 'locked' | 'blocked' | 'via-event' | 'drew-it';

export interface ModuleGraph {
  game: string;
  module: string;
  scenarios: UnlockGraphScenario[];
  threads: UnlockGraphThread[];
}

/**
 * Edge-derived: a warning is emitted for ANY unplayed scenario that appears
 * in another scenario's mutex/lockedIf list, independent of the scenario's
 * `hazard` flag. The flag marks closures the edges cannot see (a hidden
 * in-scenario choice, e.g. FH scenario 4 picking which Algox path opens) and
 * is consumed directly by the confirm-before-apply UX alongside `cond`.
 */
export interface HazardWarning {
  /** Qualified key of the scenario whose play closes content. */
  key: string;
  /** Qualified keys it would permanently close (currently still reachable). */
  closes: string[];
}

export interface AvailabilityResult {
  /** Qualified key ('<module>:<key>') → derived status. */
  statuses: Map<string, ScenarioStatus>;
  /** Played/drawn keys that no loaded module graph knows (advisory gap). */
  unknownKeys: string[];
  /** Unplayed hazardous picks and the reachable content they would close. */
  hazardWarnings: HazardWarning[];
}

export function qualifiedKey(module: string, key: string): string {
  return `${module}:${key}`;
}

/**
 * Derive statuses for every scenario in the loaded module graphs.
 *
 * `played`/`drawn` hold qualified keys exactly as `campaigns.played_scenarios`
 * and `campaigns.drawn_scenarios` store them. Mutex/lockedIf/prereq edges in
 * the extracts are module-local and only ever reference their own module.
 */
export function deriveAvailability(
  graphs: ModuleGraph[],
  played: ReadonlySet<string>,
  drawn: ReadonlySet<string>,
): AvailabilityResult {
  const statuses = new Map<string, ScenarioStatus>();
  const known = new Set<string>();
  const hazardWarnings: HazardWarning[] = [];

  for (const graph of graphs) {
    const q = (key: string) => qualifiedKey(graph.module, key);
    for (const scenario of graph.scenarios) {
      known.add(q(scenario.key));
    }

    for (const scenario of graph.scenarios) {
      const key = q(scenario.key);
      if (played.has(key)) {
        statuses.set(key, 'played');
        continue;
      }

      const blockers = [...scenario.lockedIf, ...scenario.mutex].map(q);
      if (blockers.some((blocker) => played.has(blocker))) {
        statuses.set(key, 'blocked');
        continue;
      }

      const allMet = scenario.prereqsAll.every((p) => played.has(q(p)));
      const anyMet =
        scenario.prereqsAny.length === 0 || scenario.prereqsAny.some((p) => played.has(q(p)));
      const hasPrereqs = scenario.prereqsAll.length > 0 || scenario.prereqsAny.length > 0;
      // No declared prereqs means available from the start (prototype: null
      // prereqs → met). The extract always materializes both arrays, so the
      // prototype's "empty prereqs object" edge cannot occur here.
      const prereqsMet = hasPrereqs ? allMet && anyMet : true;

      if (scenario.manual) {
        statuses.set(key, !prereqsMet ? 'locked' : drawn.has(key) ? 'drew-it' : 'via-event');
      } else {
        statuses.set(key, prereqsMet ? 'open' : 'locked');
      }
    }

    // Hazard projection: for each unplayed scenario, what reachable content
    // would playing it permanently close? (Inverted mutex/lockedIf edges.)
    const closesByKey = new Map<string, string[]>();
    for (const victim of graph.scenarios) {
      const victimKey = q(victim.key);
      if (played.has(victimKey)) continue;
      for (const culprit of [...victim.mutex, ...victim.lockedIf]) {
        const culpritKey = q(culprit);
        if (played.has(culpritKey)) continue;
        const closes = closesByKey.get(culpritKey) ?? [];
        closes.push(victimKey);
        closesByKey.set(culpritKey, closes);
      }
    }
    for (const [key, closes] of closesByKey) {
      hazardWarnings.push({ key, closes: closes.sort() });
    }
  }

  const unknownKeys = [...new Set([...played, ...drawn])].filter((key) => !known.has(key)).sort();
  hazardWarnings.sort((a, b) => a.key.localeCompare(b.key));
  return { statuses, unknownKeys, hazardWarnings };
}
