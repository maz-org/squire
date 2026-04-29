import { z } from 'zod';

const ToolKindSchema = z.enum(['discovery', 'resolution', 'search', 'open', 'traversal']);

export const TrajectoryExpectationSchema = z
  .object({
    requiredTools: z.array(z.string().min(1)).default([]),
    requiredToolKinds: z.array(ToolKindSchema).default([]),
    forbiddenTools: z.array(z.string().min(1)).default([]),
    forbiddenToolKinds: z.array(ToolKindSchema).default([]),
    requiredRefs: z.array(z.string().min(1)).default([]),
    maxToolCalls: z.number().int().positive(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const FinalAnswerExpectationSchema = z
  .object({
    expected: z.string().min(1),
    grading: z.string().min(1),
  })
  .strict();

export const EvalCaseSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    question: z.string().min(1),
    source: z.string().min(1),
    finalAnswer: FinalAnswerExpectationSchema.optional(),
    trajectory: TrajectoryExpectationSchema.optional(),
  })
  .strict()
  .refine((evalCase) => evalCase.finalAnswer || evalCase.trajectory, {
    message: 'Eval cases must define finalAnswer, trajectory, or both.',
  });

export const EvalDatasetSchema = z.array(EvalCaseSchema);

const RemoteExpectedOutputSchema = z
  .object({
    finalAnswer: FinalAnswerExpectationSchema.optional(),
    trajectory: TrajectoryExpectationSchema.optional(),
  })
  .strict()
  .refine((expectedOutput) => expectedOutput.finalAnswer || expectedOutput.trajectory, {
    message: 'Remote expectedOutput must define finalAnswer, trajectory, or both.',
  });

export type ToolKind = z.infer<typeof ToolKindSchema>;
export type TrajectoryExpectation = z.infer<typeof TrajectoryExpectationSchema>;
export type FinalAnswerExpectation = z.infer<typeof FinalAnswerExpectationSchema>;
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export interface ObservedToolCall {
  name: string;
  input: unknown;
  canonicalRefs?: string[];
}

export interface TrajectoryScore {
  pass: boolean;
  failures: string[];
}

export interface RemoteDatasetItemShape {
  expectedOutput?: unknown;
}

const TOOL_KIND_BY_NAME = new Map<string, ToolKind>([
  ['inspect_sources', 'discovery'],
  ['schema', 'discovery'],
  ['list_card_types', 'discovery'],
  ['resolve_entity', 'resolution'],
  ['find_scenario', 'resolution'],
  ['search_knowledge', 'search'],
  ['search_rules', 'search'],
  ['search_cards', 'search'],
  ['list_cards', 'search'],
  ['open_entity', 'open'],
  ['get_card', 'open'],
  ['get_scenario', 'open'],
  ['get_section', 'open'],
  ['neighbors', 'traversal'],
  ['follow_links', 'traversal'],
]);

export function evalCaseHasFinalAnswer(
  evalCase: EvalCase,
): evalCase is EvalCase & { finalAnswer: FinalAnswerExpectation } {
  return evalCase.finalAnswer !== undefined;
}

export function evalCaseHasTrajectory(
  evalCase: EvalCase,
): evalCase is EvalCase & { trajectory: TrajectoryExpectation } {
  return evalCase.trajectory !== undefined;
}

export function countTrajectoryCases(cases: EvalCase[]): number {
  return cases.filter(evalCaseHasTrajectory).length;
}

export function validateRemoteDatasetShape(
  remoteItems: RemoteDatasetItemShape[],
  expectedLocalCount: number,
  datasetName: string,
): void {
  if (remoteItems.length !== expectedLocalCount) {
    throw new Error(
      `Remote Langfuse dataset "${datasetName}" has ${remoteItems.length} item(s), but local eval/dataset.json has ${expectedLocalCount}. Run \`node eval/run.ts --seed\` before running the full dataset.`,
    );
  }

  const invalidItems: Array<{ index: number; issues: string[] }> = [];
  remoteItems.forEach((item, index) => {
    const result = RemoteExpectedOutputSchema.safeParse(item.expectedOutput);
    if (!result.success) {
      invalidItems.push({
        index,
        issues: result.error.issues.map((issue) => issue.message),
      });
    }
  });
  if (invalidItems.length > 0) {
    const sample = invalidItems
      .slice(0, 3)
      .map((item) => `item ${item.index}: ${item.issues[0] ?? 'invalid expectedOutput'}`)
      .join('; ');
    throw new Error(
      `Remote Langfuse dataset "${datasetName}" has ${invalidItems.length} invalid expectedOutput item(s). Sample: ${sample}. Run \`node eval/run.ts --seed\` before running the full dataset.`,
    );
  }
}

export function normalizeTrajectoryRef(ref: string): string {
  const scenarioMatch = ref.match(
    /^(?:scenario:frosthaven\/|gloomhavensecretariat:scenario\/)(\d+)$/,
  );
  if (scenarioMatch) {
    return `scenario:frosthaven/${scenarioMatch[1].padStart(3, '0')}`;
  }

  const sectionMatch = ref.match(/^(?:section:frosthaven\/|section:)?(\d+\.\d+)$/);
  if (sectionMatch) {
    return `section:frosthaven/${sectionMatch[1]}`;
  }

  return ref;
}

function refMatches(actual: string, expected: string): boolean {
  return normalizeTrajectoryRef(actual) === normalizeTrajectoryRef(expected);
}

function inputContainsRef(input: unknown, ref: string): boolean {
  if (typeof input === 'string') return refMatches(input, ref);
  if (Array.isArray(input)) return input.some((item) => inputContainsRef(item, ref));
  if (!input || typeof input !== 'object') return false;
  return Object.values(input).some((value) => inputContainsRef(value, ref));
}

export function scoreTrajectory(
  expected: TrajectoryExpectation,
  actual: ObservedToolCall[],
): TrajectoryScore {
  const failures: string[] = [];
  const names = actual.map((call) => call.name);
  const kinds = actual.map((call) => TOOL_KIND_BY_NAME.get(call.name)).filter((kind) => !!kind);

  if (actual.length > expected.maxToolCalls) {
    failures.push(`expected at most ${expected.maxToolCalls} tool call(s), saw ${actual.length}`);
  }

  for (const tool of expected.requiredTools) {
    if (!names.includes(tool)) failures.push(`missing required tool: ${tool}`);
  }

  for (const tool of expected.forbiddenTools) {
    if (names.includes(tool)) failures.push(`used forbidden tool: ${tool}`);
  }

  for (const kind of expected.requiredToolKinds) {
    if (!kinds.includes(kind)) failures.push(`missing required tool kind: ${kind}`);
  }

  for (const kind of expected.forbiddenToolKinds) {
    if (kinds.includes(kind)) failures.push(`used forbidden tool kind: ${kind}`);
  }

  for (const ref of expected.requiredRefs) {
    const hasRef = actual.some(
      (call) =>
        inputContainsRef(call.input, ref) ||
        (call.canonicalRefs ?? []).some((actualRef) => refMatches(actualRef, ref)),
    );
    if (!hasRef) {
      failures.push(`missing required ref: ${ref}`);
    }
  }

  return { pass: failures.length === 0, failures };
}
