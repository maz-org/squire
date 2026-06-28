/**
 * Shared write boundary for structured character state.
 *
 * The old sheet accepted free-text and manually selected level fields in
 * several places. This schema is intentionally shared by REST, MCP/write tools,
 * proposals, and form handlers so removed fields fail at the edge.
 */
import { z } from 'zod';

const PrivateNotesSchema = z.string().trim().min(1).max(5000).nullable();

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

export const StagedCharacterStatePatchSchema = CharacterStatePatchSchema.pick({
  name: true,
  className: true,
  xp: true,
  gold: true,
  perks: true,
}).refine((patch) => Object.keys(patch).length > 0, { message: 'Empty patch' });

export type CharacterStatePatch = z.infer<typeof CharacterStatePatchSchema>;
