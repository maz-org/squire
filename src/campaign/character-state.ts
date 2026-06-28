/**
 * Shared write boundary for structured character state.
 *
 * The old sheet accepted free-text and manually selected level fields in
 * several places. This schema is intentionally shared by REST, MCP/write tools,
 * proposals, and form handlers so removed fields fail at the edge.
 */
import { z } from 'zod';

const PrivateNotesSchema = z.string().trim().min(1).max(5000).nullable();
const EMPTY_PATCH_MESSAGE = 'At least one character field to update is required';

export function hasCharacterPatchFields(patch: object): boolean {
  return Object.keys(patch).some((key) => key !== 'expectedVersion');
}

export const CharacterStatePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    className: z.string().trim().min(1).max(100).optional(),
    xp: z.number().int().min(0).optional(),
    gold: z.number().int().min(0).optional(),
    perks: z.array(z.number().int().min(0)).max(100).optional(),
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
}).refine(hasCharacterPatchFields, { message: EMPTY_PATCH_MESSAGE });

export type CharacterStatePatch = z.infer<typeof CharacterStatePatchSchema>;
