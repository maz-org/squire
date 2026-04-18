import { z } from 'zod';

export const TRAVERSAL_KINDS = ['scenario', 'section'] as const;
export const TRAVERSAL_LINK_TYPES = [
  'conclusion',
  'read_now',
  'section_link',
  'unlock',
  'cross_reference',
] as const;

export const TraversalKindSchema = z.enum(TRAVERSAL_KINDS);
export const TraversalLinkTypeSchema = z.enum(TRAVERSAL_LINK_TYPES);
export const ScenarioGroupSchema = z.enum(['main', 'solo', 'random']);

export const TraversalScenarioRecordSchema = z.object({
  ref: z.string(),
  scenarioGroup: ScenarioGroupSchema,
  scenarioIndex: z.string(),
  name: z.string(),
  complexity: z.number().int().nullable(),
  flowChartGroup: z.string().nullable(),
  initial: z.boolean(),
  sourcePdf: z.string().nullable(),
  sourcePage: z.number().int().nullable(),
  rawText: z.string().nullable(),
  metadata: z.object({
    sourceId: z.string(),
    monsters: z.array(z.string()),
    allies: z.array(z.string()),
    unlocks: z.array(z.string()),
    requirements: z.array(z.record(z.string(), z.unknown())),
    objectives: z.array(
      z.object({
        name: z.string(),
        escort: z.boolean().optional(),
      }),
    ),
    rewards: z.string().nullable(),
    lootDeckConfig: z.record(z.string(), z.number()),
  }),
});

export const TraversalSectionRecordSchema = z.object({
  ref: z.string().regex(/^\d+\.\d+$/),
  sectionNumber: z.number().int(),
  sectionVariant: z.number().int(),
  sourcePdf: z.string(),
  sourcePage: z.number().int(),
  text: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
});

export const TraversalLinkRecordSchema = z.object({
  fromKind: TraversalKindSchema,
  fromRef: z.string(),
  toKind: TraversalKindSchema,
  toRef: z.string(),
  linkType: TraversalLinkTypeSchema,
  rawLabel: z.string().nullable(),
  rawContext: z.string().nullable(),
  sequence: z.number().int().min(0),
});

export const TraversalExtractSchema = z.object({
  scenarios: z.array(TraversalScenarioRecordSchema),
  sections: z.array(TraversalSectionRecordSchema),
  links: z.array(TraversalLinkRecordSchema),
  warnings: z.array(z.string()),
});

export type TraversalKind = z.infer<typeof TraversalKindSchema>;
export type TraversalLinkType = z.infer<typeof TraversalLinkTypeSchema>;
export type TraversalScenarioRecord = z.infer<typeof TraversalScenarioRecordSchema>;
export type TraversalSectionRecord = z.infer<typeof TraversalSectionRecordSchema>;
export type TraversalLinkRecord = z.infer<typeof TraversalLinkRecordSchema>;
export type TraversalExtract = z.infer<typeof TraversalExtractSchema>;
