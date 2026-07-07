/**
 * Shared write boundary for structured character state.
 *
 * The old sheet accepted free-text and manually selected level fields in
 * several places. This schema is intentionally shared by REST, MCP/write tools,
 * proposals, and form handlers so removed fields fail at the edge.
 */
import { z } from 'zod';

import { LEVEL_XP_THRESHOLDS } from './character-level.ts';

const PrivateNotesSchema = z.string().trim().min(1).max(5000).nullable();
const EMPTY_PATCH_MESSAGE = 'At least one character field to update is required';

export function hasCharacterPatchFields(patch: object): boolean {
  return Object.keys(patch).some((key) => key !== 'expectedVersion');
}

export const CharacterStatePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    className: z.string().trim().min(1).max(100).optional(),
    xp: z.number().int().min(0).max(999).optional(),
    /**
     * Convenience encoding for "hit level N" recaps (SQR-410): level is
     * derived from XP, so callers without an exact XP total may pass the
     * level and the server encodes the printed threshold. Normalized away
     * before persistence — staged payloads and stored characters remain
     * xp-only. Models guessed thresholds (95, 240 for level 5; the printed
     * table says 210) when forced to invent an XP value.
     */
    level: z.number().int().min(1).max(9).optional(),
    gold: z.number().int().min(0).optional(),
    perks: z.array(z.number().int().min(0)).max(100).optional(),
    perkMarks: z.number().int().min(0).max(100).optional(),
    masteries: z.array(z.number().int().min(0)).max(100).optional(),
    personalQuestSourceId: z.string().trim().min(1).max(200).nullable().optional(),
    privateNotes: PrivateNotesSchema.optional(),
    status: z.enum(['active', 'retired']).optional(),
    successorId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const NonEmptyCharacterStatePatchSchema = CharacterStatePatchSchema.refine(
  hasCharacterPatchFields,
  { message: EMPTY_PATCH_MESSAGE },
);

export const StagedCharacterStatePatchSchema = CharacterStatePatchSchema.pick({
  name: true,
  className: true,
  xp: true,
  gold: true,
  perks: true,
  perkMarks: true,
  masteries: true,
}).refine(hasCharacterPatchFields, { message: EMPTY_PATCH_MESSAGE });

export type CharacterStatePatch = z.infer<typeof CharacterStatePatchSchema>;

/**
 * Convert a `level` field into its printed XP threshold (an explicit `xp`
 * always wins) and strip `level` so downstream schemas stay xp-only.
 */
export function normalizeCharacterLevelPatch<T extends { level?: number; xp?: number }>(
  patch: T,
): Omit<T, 'level'> {
  const { level, ...rest } = patch;
  if (level === undefined) return rest;
  if (rest.xp !== undefined) return rest;
  return { ...rest, xp: LEVEL_XP_THRESHOLDS[level - 1] };
}
