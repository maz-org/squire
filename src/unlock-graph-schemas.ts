/**
 * Zod schemas for the unlock-graph extracts (SQR-267, eng decision E1).
 *
 * One extract file per MODULE under `data/extracted/unlock-graphs/`. A
 * module is a scenario-set selector within a game (constraint 11):
 * `campaigns.modules` picks which modules are active, while `game` remains
 * the isolation/retrieval dimension. Scenario keys are module-local strings
 * (the printed scenario number for campaign sets, class slugs for solo
 * sets); campaign state stores them qualified as `<module>:<key>`.
 *
 * The graph is ADVISORY: it encodes community/curated unlock knowledge so
 * Squire can derive availability, but the game is always the truth and a
 * single correction overrides it (plan pillar 1b).
 */
import { z } from 'zod';

export const UnlockGraphScenarioSchema = z.object({
  /** Module-local key: '14' for numbered scenarios, 'bruiser' for solos. */
  key: z.string().min(1),
  name: z.string().min(1),
  /** ALL of these keys must be played before this scenario opens. */
  prereqsAll: z.array(z.string()),
  /** At least ONE of these keys must be played (combined with prereqsAll). */
  prereqsAny: z.array(z.string()),
  /** Playing any of these blocks this scenario (mutually exclusive picks). */
  mutex: z.array(z.string()),
  /** Playing any of these permanently locks this scenario out. */
  lockedIf: z.array(z.string()),
  /** Manual unlock (event card, personal quest, puzzle, random draw). */
  manual: z.boolean(),
  /** Human-readable unlock condition for manual scenarios. Spoiler-light. */
  cond: z.string().nullable(),
  /** Playing this permanently closes other content — confirm before apply. */
  hazard: z.boolean(),
  /** Skippable intro (GH2e scenario 0): may be marked skipped, which counts
   * as done for downstream prereqs but is never itself playable. */
  skippable: z.boolean().default(false),
  /** Character-gated unlock (solo scenario modules): the exact className an
   * ACTIVE character must be playing at level >= unlockMinLevel for this to
   * open. Null = not character-gated (play-prereq / manual model applies). */
  unlockClass: z.string().min(1).nullable().default(null),
  unlockMinLevel: z.number().int().positive().nullable().default(null),
});

export const UnlockGraphThreadSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  note: z.string(),
  position: z.number().int().nonnegative(),
  keys: z.array(z.string()),
});

export const UnlockGraphModuleSchema = z.object({
  provenance: z.string(),
  game: z.string().min(1),
  module: z.string().min(1),
  scenarios: z.array(UnlockGraphScenarioSchema).min(1),
  threads: z.array(UnlockGraphThreadSchema),
});

export type UnlockGraphScenario = z.infer<typeof UnlockGraphScenarioSchema>;
export type UnlockGraphThread = z.infer<typeof UnlockGraphThreadSchema>;
export type UnlockGraphModule = z.infer<typeof UnlockGraphModuleSchema>;
