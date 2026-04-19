import { z } from 'zod';

export const BOOK_RECORD_KINDS = ['scenario', 'section'] as const;
export const BOOK_REFERENCE_TYPES = [
  'conclusion',
  'read_now',
  'section_link',
  'unlock',
  'cross_reference',
] as const;

export const BookRecordKindSchema = z.enum(BOOK_RECORD_KINDS);
export const BookReferenceTypeSchema = z.enum(BOOK_REFERENCE_TYPES);
export const ScenarioGroupSchema = z.enum(['main', 'solo', 'random']);

export const ScenarioBookScenarioRecordSchema = z.object({
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

export const SectionBookSectionRecordSchema = z.object({
  ref: z.string().regex(/^\d+\.\d+$/),
  sectionNumber: z.number().int(),
  sectionVariant: z.number().int(),
  sourcePdf: z.string(),
  sourcePage: z.number().int(),
  text: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
});

export const BookReferenceRecordSchema = z.object({
  fromKind: BookRecordKindSchema,
  fromRef: z.string(),
  toKind: BookRecordKindSchema,
  toRef: z.string(),
  linkType: BookReferenceTypeSchema,
  rawLabel: z.string().nullable(),
  rawContext: z.string().nullable(),
  sequence: z.number().int().min(0),
});

export const ScenarioSectionBooksExtractSchema = z.object({
  scenarios: z.array(ScenarioBookScenarioRecordSchema),
  sections: z.array(SectionBookSectionRecordSchema),
  links: z.array(BookReferenceRecordSchema),
  warnings: z.array(z.string()),
});

export type BookRecordKind = z.infer<typeof BookRecordKindSchema>;
export type BookReferenceType = z.infer<typeof BookReferenceTypeSchema>;
export type ScenarioBookScenarioRecord = z.infer<typeof ScenarioBookScenarioRecordSchema>;
export type SectionBookSectionRecord = z.infer<typeof SectionBookSectionRecordSchema>;
export type BookReferenceRecord = z.infer<typeof BookReferenceRecordSchema>;
export type ScenarioSectionBooksExtract = z.infer<typeof ScenarioSectionBooksExtractSchema>;
