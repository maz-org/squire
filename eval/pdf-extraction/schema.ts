import { createHash } from 'node:crypto';
import { z } from 'zod';

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const IsoDateSchema = z.string().datetime();

const BBoxSchema = z
  .object({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

export const PdfExtractionProviderIdSchema = z.enum([
  'apple-vision',
  'aws-textract',
  'llamaparse',
  'unstructured',
  'marker-datalab',
]);

export const ExtractionFailureClassSchema = z.enum([
  'timeout',
  'rate_limit',
  'credential_failure',
  'provider_error',
  'partial_page_failure',
  'invalid_artifact',
  'cost_guardrail',
  'unsupported_configuration',
]);

export const ExtractionBlockSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      'heading',
      'paragraph',
      'line',
      'table',
      'image',
      'callout',
      'footer',
      'header',
      'page-number',
      'other',
    ]),
    order: z.number().int().nonnegative(),
    text: z.string(),
    bbox: BBoxSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const ExtractionTableCellSchema = z
  .object({
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    rowSpan: z.number().int().positive().default(1),
    columnSpan: z.number().int().positive().default(1),
    text: z.string(),
    bbox: BBoxSchema.optional(),
  })
  .strict();

export const ExtractionTableSchema = z
  .object({
    id: z.string().min(1),
    order: z.number().int().nonnegative(),
    bbox: BBoxSchema.optional(),
    cells: z.array(ExtractionTableCellSchema),
  })
  .strict();

export const ExtractionPageSchema = z
  .object({
    pageNumber: z.number().int().positive(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    unit: z.enum(['pt', 'px']),
    markdown: z.string(),
    text: z.string(),
    blocks: z.array(ExtractionBlockSchema),
    tables: z.array(ExtractionTableSchema),
  })
  .strict();

export const RawArtifactRefSchema = z
  .object({
    kind: z.enum(['provider-json', 'provider-markdown', 'provider-text', 'debug-image', 'other']),
    path: z.string().min(1).optional(),
    sha256: Sha256Schema.optional(),
    redacted: z.boolean(),
    persisted: z.boolean(),
  })
  .strict();

export const ExtractionArtifactSchema = z
  .object({
    schemaVersion: z.literal('squire-pdf-extraction-v1'),
    provider: PdfExtractionProviderIdSchema,
    providerVersion: z.string().min(1),
    providerConfigHash: Sha256Schema,
    source: z
      .object({
        path: z.string().min(1),
        sha256: Sha256Schema,
        pageCount: z.number().int().positive().optional(),
      })
      .strict(),
    run: z
      .object({
        id: z.string().min(1),
        startedAt: IsoDateSchema,
        completedAt: IsoDateSchema.optional(),
        status: z.enum(['succeeded', 'partial', 'failed']),
        pageRange: z.array(z.number().int().positive()).optional(),
        latencyMs: z.number().int().nonnegative().optional(),
        failure: z
          .object({
            class: ExtractionFailureClassSchema,
            message: z.string().min(1),
          })
          .strict()
          .optional(),
      })
      .strict()
      .superRefine((run, ctx) => {
        if (run.status === 'succeeded' && run.failure) {
          ctx.addIssue({
            code: 'custom',
            path: ['failure'],
            message: 'failure must be absent when status is succeeded',
          });
        }
        if ((run.status === 'failed' || run.status === 'partial') && !run.failure) {
          ctx.addIssue({
            code: 'custom',
            path: ['failure'],
            message: 'failure is required when status is failed or partial',
          });
        }
      }),
    cost: z
      .object({
        estimatedUsd: z.number().finite().nonnegative(),
        actualUsd: z.number().finite().nonnegative().optional(),
        pagesProcessed: z.number().int().nonnegative(),
        costPerPageUsd: z.number().finite().nonnegative().optional(),
      })
      .strict(),
    privacy: z
      .object({
        retentionPolicy: z.string().min(1),
        trainingUse: z.enum(['not-used-for-training', 'unknown', 'may-be-used-for-training']),
        region: z.string().min(1).optional(),
      })
      .strict(),
    providerMetadata: z.record(z.string(), z.unknown()).optional(),
    rawArtifacts: z.array(RawArtifactRefSchema),
    pages: z.array(ExtractionPageSchema),
  })
  .strict();

const GroundTruthTableCellSchema = z
  .object({
    row: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    text: z.string().min(1),
  })
  .strict();

const GroundTruthTableSchema = z
  .object({
    id: z.string().min(1),
    cells: z.array(GroundTruthTableCellSchema),
  })
  .strict();

export const GroundTruthRecordSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    page: z.number().int().positive(),
    region: BBoxSchema.nullable().optional(),
    category: z.string().min(1),
    expectedText: z.string().min(1),
    expectedHeadings: z.array(z.string().min(1)).default([]),
    expectedTables: z.array(GroundTruthTableSchema).default([]),
    retrievalQueries: z.array(z.string().min(1)).default([]),
    forbiddenRetrievalContextTerms: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const GroundTruthDatasetSchema = z.array(GroundTruthRecordSchema);

export type PdfExtractionProviderId = z.infer<typeof PdfExtractionProviderIdSchema>;
export type ExtractionFailureClass = z.infer<typeof ExtractionFailureClassSchema>;
export type ExtractionArtifact = z.infer<typeof ExtractionArtifactSchema>;
export type ExtractionPage = z.infer<typeof ExtractionPageSchema>;
export type ExtractionBlock = z.infer<typeof ExtractionBlockSchema>;
export type ExtractionTable = z.infer<typeof ExtractionTableSchema>;
export type ExtractionTableCell = z.infer<typeof ExtractionTableCellSchema>;
export type RawArtifactRef = z.infer<typeof RawArtifactRefSchema>;
export type GroundTruthRecord = z.infer<typeof GroundTruthRecordSchema>;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function computeStableSha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

export function computeProviderConfigHash(config: unknown): string {
  return computeStableSha256(config);
}

export function validateExtractionArtifact(value: unknown): ExtractionArtifact {
  return ExtractionArtifactSchema.parse(value);
}
