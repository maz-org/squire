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
 * - skipped:   key is in the campaign's skipped set (a skippable intro the
 *              party chose to skip) — counts as done for downstream prereqs
 *              but is never itself playable
 * - blocked:   an unplayed scenario whose mutex/lockedIf set intersects the
 *              played set (permanently closed by a choice)
 * - open:      prereqs/character-gate met (no prereqs = open)
 * - locked:    prereqs not met, or a character-gated scenario whose required
 *              class isn't an active character at the threshold level
 * - via-event: manual scenario whose prereqs are met but not yet drawn
 * - drew-it:   manual scenario drawn but not yet played
 *
 * Character-gated scenarios (GH2e solo, `unlockClass` set) bypass the
 * play-prereq/manual model entirely: open iff an active character of the
 * required class is at level >= `unlockMinLevel`, else locked — never
 * via-event/drew-it. Gating is LIVE: if that character retires or leaves the
 * roster, the scenario re-locks on the next recompute.
 */
import type { UnlockGraphScenario, UnlockGraphThread } from '../unlock-graph-schemas.ts';

export type ScenarioStatus =
  | 'played'
  | 'skipped'
  | 'open'
  | 'locked'
  | 'blocked'
  | 'via-event'
  | 'drew-it';

/** An active character in the campaign roster, for character-gated scenarios. */
export interface RosterCharacter {
  className: string;
  level: number;
}

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
 * `played`/`drawn`/`skipped` hold qualified keys exactly as
 * `campaigns.played_scenarios` / `drawn_scenarios` / `skipped_scenarios` store
 * them. `characters` is the campaign's ACTIVE roster (class + level), the only
 * input to character-gated scenarios. Mutex/lockedIf/prereq edges in the
 * extracts are module-local and only ever reference their own module.
 */
export function deriveAvailability(
  graphs: ModuleGraph[],
  played: ReadonlySet<string>,
  drawn: ReadonlySet<string>,
  // Default empty: a caller with no skip state / no roster degrades to the
  // play-prereq model (no skipped scenarios, character-gated stay locked).
  skipped: ReadonlySet<string> = new Set(),
  characters: readonly RosterCharacter[] = [],
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
      // Skipping a skippable intro is terminal and not itself playable, but it
      // counts as done for downstream prereqs below.
      if (skipped.has(key)) {
        statuses.set(key, 'skipped');
        continue;
      }

      const blockers = [...scenario.lockedIf, ...scenario.mutex].map(q);
      if (blockers.some((blocker) => played.has(blocker))) {
        statuses.set(key, 'blocked');
        continue;
      }

      // Character-gated (GH2e solo): open iff an active character of the
      // required class is at the threshold level. Never event/draw — purely
      // roster-driven, so it re-locks live if that character leaves.
      if (scenario.unlockClass) {
        const need = scenario.unlockClass.toLowerCase();
        const minLevel = scenario.unlockMinLevel ?? 1;
        const met = characters.some(
          (c) => c.className.toLowerCase() === need && c.level >= minLevel,
        );
        statuses.set(key, met ? 'open' : 'locked');
        continue;
      }

      // A prereq key is satisfied by play OR by skipping it (skipping the intro
      // still opens what playing it would).
      const done = (p: string) => played.has(q(p)) || skipped.has(q(p));
      const allMet = scenario.prereqsAll.every(done);
      const anyMet = scenario.prereqsAny.length === 0 || scenario.prereqsAny.some(done);
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
      if (played.has(victimKey) || skipped.has(victimKey)) continue;
      for (const culprit of [...victim.mutex, ...victim.lockedIf]) {
        const culpritKey = q(culprit);
        if (played.has(culpritKey) || skipped.has(culpritKey)) continue;
        const closes = closesByKey.get(culpritKey) ?? [];
        closes.push(victimKey);
        closesByKey.set(culpritKey, closes);
      }
    }
    for (const [key, closes] of closesByKey) {
      hazardWarnings.push({ key, closes: closes.sort() });
    }
  }

  const unknownKeys = [...new Set([...played, ...drawn, ...skipped])]
    .filter((key) => !known.has(key))
    .sort();
  hazardWarnings.sort((a, b) => a.key.localeCompare(b.key));
  return { statuses, unknownKeys, hazardWarnings };
}

const PLAYABLE: ReadonlySet<ScenarioStatus> = new Set(['open', 'via-event', 'drew-it']);

function shortKeys(keys: string[]): string {
  return keys.map((key) => (key.split(':')[1] ?? key).toUpperCase()).join(', ');
}

/**
 * Ledger-voiced derived consequences of a scenario-state change (SQR-283
 * preview narration): diff availability before vs after a staged
 * played/drawn change and name what opens, permanently closes, reopens, or
 * locks again. Pure — callers load the graphs.
 */
export function availabilityShiftLines(
  graphs: ModuleGraph[],
  current: { playedScenarios: string[]; drawnScenarios: string[]; skippedScenarios?: string[] },
  next: { playedScenarios?: string[]; drawnScenarios?: string[] },
  characters: readonly RosterCharacter[] = [],
): string[] {
  if (graphs.length === 0) return [];
  if (next.playedScenarios === undefined && next.drawnScenarios === undefined) return [];

  // Skipped state and the roster are constant across a staged played/drawn
  // change, so they hold steady on both sides of the diff.
  const skipped = new Set(current.skippedScenarios ?? []);
  const before = deriveAvailability(
    graphs,
    new Set(current.playedScenarios),
    new Set(current.drawnScenarios),
    skipped,
    characters,
  );
  const after = deriveAvailability(
    graphs,
    new Set(next.playedScenarios ?? current.playedScenarios),
    new Set(next.drawnScenarios ?? current.drawnScenarios),
    skipped,
    characters,
  );

  const opens: string[] = [];
  const closes: string[] = [];
  const reopens: string[] = [];
  const locksAgain: string[] = [];
  for (const [key, afterStatus] of after.statuses) {
    const beforeStatus = before.statuses.get(key);
    if (beforeStatus === undefined || beforeStatus === afterStatus) continue;
    if (beforeStatus === 'locked' && PLAYABLE.has(afterStatus)) opens.push(key);
    else if (beforeStatus !== 'blocked' && afterStatus === 'blocked') closes.push(key);
    else if (beforeStatus === 'blocked' && PLAYABLE.has(afterStatus)) reopens.push(key);
    else if (PLAYABLE.has(beforeStatus) && afterStatus === 'locked') locksAgain.push(key);
  }

  const lines: string[] = [];
  if (opens.length > 0) lines.push(`OPENS → ${shortKeys(opens.sort())}`);
  if (closes.length > 0) lines.push(`CLOSES PERMANENTLY → ${shortKeys(closes.sort())}`);
  if (reopens.length > 0) lines.push(`REOPENS → ${shortKeys(reopens.sort())}`);
  if (locksAgain.length > 0) lines.push(`LOCKS AGAIN → ${shortKeys(locksAgain.sort())}`);
  return lines;
}
