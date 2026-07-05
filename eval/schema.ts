import { z } from 'zod';

import {
  FROSTHAVEN_GAME_ID,
  SUPPORTED_GAME_IDS,
  normalizeGameId,
  type GameId,
} from '../src/game.ts';

const ToolKindSchema = z.enum(['discovery', 'resolution', 'search', 'open', 'traversal']);
export const EvalRuntimeSchema = z.enum(['langgraph', 'deep-agents']);
export const EvalSplitSchema = z.enum(['dev', 'holdout']);
/**
 * Question-class stratification (SQR-393). Latency and pass-rate percentiles
 * are reported per class so a lookup-heavy dataset cannot mask synthesis or
 * multi-hop latency. Tagging rubric lives in eval/README.md.
 */
export const QuestionClassSchema = z.enum([
  'exact-lookup',
  'rules-synthesis',
  'multi-hop',
  'campaign',
]);
export const EvalSuiteSchema = z.enum([
  'table-qa',
  'trajectory',
  'cross-game-boundary',
  'adversarial-boundary',
  'campaign-personalization',
  'campaign-writes',
]);
const EvalGameSchema = z.preprocess(
  (value) => (typeof value === 'string' ? (normalizeGameId(value) ?? value) : value),
  z.enum(SUPPORTED_GAME_IDS),
);

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

export const AnswerSafetyExpectationSchema = z
  .object({
    requiredAnswerPatterns: z.array(z.string().min(1)).default([]),
    forbiddenAnswerPatterns: z.array(z.string().min(1)).default([]),
    requiredCanonicalRefPatterns: z.array(z.string().min(1)).default([]),
    forbiddenCanonicalRefPatterns: z.array(z.string().min(1)).default([]),
    requiredSourceLabelPatterns: z.array(z.string().min(1)).default([]),
    forbiddenSourceLabelPatterns: z.array(z.string().min(1)).default([]),
    notes: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (safety) =>
      safety.requiredAnswerPatterns.length > 0 ||
      safety.forbiddenAnswerPatterns.length > 0 ||
      safety.requiredCanonicalRefPatterns.length > 0 ||
      safety.forbiddenCanonicalRefPatterns.length > 0 ||
      safety.requiredSourceLabelPatterns.length > 0 ||
      safety.forbiddenSourceLabelPatterns.length > 0,
    {
      message: 'Safety expectations must define at least one required or forbidden pattern.',
    },
  );

export const FinalAnswerExpectationSchema = z
  .object({
    expected: z.string().min(1),
    grading: z.string().min(1),
  })
  .strict();

export const LatencyBudgetSchema = z
  .object({
    firstAnswerTokenMs: z.number().int().positive().optional(),
    completeAnswerMs: z.number().int().positive().optional(),
    notes: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (budget) => budget.firstAnswerTokenMs !== undefined || budget.completeAnswerMs !== undefined,
    {
      message: 'Latency budgets must define firstAnswerTokenMs, completeAnswerMs, or both.',
    },
  );

export const EvalCaseSchema = z
  .object({
    id: z.string().min(1),
    game: EvalGameSchema,
    suite: EvalSuiteSchema,
    runtime: EvalRuntimeSchema,
    split: EvalSplitSchema.optional(),
    questionClass: QuestionClassSchema.optional(),
    caseCategory: z.string().min(1),
    category: z.string().min(1),
    question: z.string().min(1),
    source: z.string().min(1),
    /**
     * Named campaign fixture seeded before the run (SQR-272). The runner
     * resolves it to a deterministic campaign + caller identity so the
     * agent answers from real state.
     */
    campaignFixture: z.string().min(1).optional(),
    finalAnswer: FinalAnswerExpectationSchema.optional(),
    trajectory: TrajectoryExpectationSchema.optional(),
    safety: AnswerSafetyExpectationSchema.optional(),
    latencyBudget: LatencyBudgetSchema.optional(),
  })
  .strict()
  .refine((evalCase) => evalCase.finalAnswer || evalCase.trajectory || evalCase.safety, {
    message: 'Eval cases must define finalAnswer, trajectory, safety, or a combination.',
  })
  .refine((evalCase) => evalCase.suite !== 'table-qa' || evalCase.split !== undefined, {
    message: 'table-qa eval cases must define split as dev or holdout.',
  })
  .refine((evalCase) => evalCase.suite !== 'table-qa' || evalCase.questionClass !== undefined, {
    message: 'table-qa eval cases must define a questionClass.',
  })
  .refine((evalCase) => evalCase.category === evalCase.caseCategory, {
    message: 'Eval case category and caseCategory must match.',
  });

export const EvalDatasetSchema = z.array(EvalCaseSchema);

const RemoteExpectedOutputSchema = z
  .object({
    finalAnswer: FinalAnswerExpectationSchema.optional(),
    trajectory: TrajectoryExpectationSchema.optional(),
    safety: AnswerSafetyExpectationSchema.optional(),
    latencyBudget: LatencyBudgetSchema.optional(),
    split: EvalSplitSchema.optional(),
  })
  .strict()
  .refine(
    (expectedOutput) =>
      expectedOutput.finalAnswer || expectedOutput.trajectory || expectedOutput.safety,
    {
      message:
        'Remote expectedOutput must define finalAnswer, trajectory, safety, or a combination.',
    },
  );

export type ToolKind = z.infer<typeof ToolKindSchema>;
export type EvalRuntime = z.infer<typeof EvalRuntimeSchema>;
export type EvalSplit = z.infer<typeof EvalSplitSchema>;
export type QuestionClass = z.infer<typeof QuestionClassSchema>;
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;
export type TrajectoryExpectation = z.infer<typeof TrajectoryExpectationSchema>;
export type FinalAnswerExpectation = z.infer<typeof FinalAnswerExpectationSchema>;
export type AnswerSafetyExpectation = z.infer<typeof AnswerSafetyExpectationSchema>;
export type LatencyBudget = z.infer<typeof LatencyBudgetSchema>;
export type EvalCase = z.infer<typeof EvalCaseSchema> & {
  langsmithExampleId?: string;
  langsmithDatasetId?: string;
  langsmithDatasetName?: string;
};
export type EvalGame = GameId;

export interface ObservedToolCall {
  name: string;
  input: unknown;
  canonicalRefs?: string[];
  sourceLabels?: string[];
}

export interface TrajectoryScore {
  pass: boolean;
  failures: string[];
}

export interface AnswerSafetyScore {
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
  ['lookup_entity', 'open'],
  ['open_entity', 'open'],
  ['get_card', 'open'],
  ['get_scenario', 'open'],
  ['get_section', 'open'],
  ['neighbors', 'traversal'],
  ['follow_links', 'traversal'],
]);

const CARD_TYPE_BY_SOURCE_PREFIX = new Map<string, string>([
  ['item', 'items'],
  ['monster-stat', 'monster-stats'],
  ['monster-ability', 'monster-abilities'],
  ['character-ability', 'character-abilities'],
  ['character-mat', 'character-mats'],
  ['building', 'buildings'],
  ['event', 'events'],
  ['battle-goal', 'battle-goals'],
  ['personal-quest', 'personal-quests'],
  ['scenario', 'scenarios'],
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

export function evalCaseHasSafety(
  evalCase: EvalCase,
): evalCase is EvalCase & { safety: AnswerSafetyExpectation } {
  return evalCase.safety !== undefined;
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
      `Remote LangSmith dataset "${datasetName}" has ${remoteItems.length} item(s), but local eval/suites fixtures have ${expectedLocalCount}. Run \`node eval/run.ts --seed\` before running the full dataset.`,
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
      `Remote LangSmith dataset "${datasetName}" has ${invalidItems.length} invalid expectedOutput item(s). Sample: ${sample}. Run \`node eval/run.ts --seed\` before running the full dataset.`,
    );
  }
}

export function normalizeTrajectoryRef(ref: string): string {
  const qualifiedScenarioMatch = ref.match(/^scenario:([^/]+)\/([^/]+)$/);
  if (qualifiedScenarioMatch) {
    const game = normalizeGameId(qualifiedScenarioMatch[1]) ?? qualifiedScenarioMatch[1];
    const scenarioId = qualifiedScenarioMatch[2];
    const canonicalScenarioId = /^\d+$/.test(scenarioId) ? scenarioId.padStart(3, '0') : scenarioId;
    return `scenario:${game}/${canonicalScenarioId}`;
  }

  const scenarioMatch = ref.match(/^gloomhavensecretariat:scenario\/(\d+)$/);
  if (scenarioMatch) {
    return `scenario:${FROSTHAVEN_GAME_ID}/${scenarioMatch[1].padStart(3, '0')}`;
  }

  const qualifiedSectionMatch = ref.match(/^section:([^/]+)\/(\d+\.\d+)$/);
  if (qualifiedSectionMatch) {
    const game = normalizeGameId(qualifiedSectionMatch[1]) ?? qualifiedSectionMatch[1];
    return `section:${game}/${qualifiedSectionMatch[2]}`;
  }

  const sectionMatch = ref.match(/^(?:section:)?(\d+\.\d+)$/);
  if (sectionMatch) {
    return `section:${FROSTHAVEN_GAME_ID}/${sectionMatch[1]}`;
  }

  const qualifiedCardMatch = ref.match(/^card:([^/]+)\/([^/]+)\/(.+)$/);
  if (qualifiedCardMatch) {
    const game = normalizeGameId(qualifiedCardMatch[1]) ?? qualifiedCardMatch[1];
    return `card:${game}/${qualifiedCardMatch[2]}/${qualifiedCardMatch[3]}`;
  }

  const cardMatch = ref.match(/^gloomhavensecretariat:([^/]+)\/(.+)$/);
  if (cardMatch) {
    const sourcePrefix = cardMatch[1];
    const sourceRest = cardMatch[2];
    const type = CARD_TYPE_BY_SOURCE_PREFIX.get(sourcePrefix);
    if (type)
      return `card:${FROSTHAVEN_GAME_ID}/${type}/gloomhavensecretariat:${sourcePrefix}/${sourceRest}`;
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

function satisfiesRequiredTool(required: string, actual: ObservedToolCall): boolean {
  if (actual.name === required) return true;
  return required === 'open_entity' && actual.name === 'lookup_entity';
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
    if (!actual.some((call) => satisfiesRequiredTool(tool, call))) {
      failures.push(`missing required tool: ${tool}`);
    }
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

function compileSafetyPattern(
  pattern: string,
  label: string,
  failures: string[],
): RegExp | undefined {
  try {
    return new RegExp(pattern, 'iu');
  } catch (error) {
    failures.push(
      `invalid ${label} pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function valuesMatchPattern(values: string[], pattern: string, label: string, failures: string[]) {
  const regex = compileSafetyPattern(pattern, label, failures);
  if (!regex) return null;
  return values.some((value) => regex.test(value));
}

export function scoreAnswerSafety(
  expected: AnswerSafetyExpectation,
  answer: string,
  actual: ObservedToolCall[],
): AnswerSafetyScore {
  const failures: string[] = [];
  const canonicalRefs = actual.flatMap((call) => call.canonicalRefs ?? []);
  const sourceLabels = actual.flatMap((call) => call.sourceLabels ?? []);

  for (const pattern of expected.requiredAnswerPatterns) {
    const regex = compileSafetyPattern(pattern, 'required answer', failures);
    if (regex && !regex.test(answer)) {
      failures.push(`missing required answer pattern: ${pattern}`);
    }
  }

  for (const pattern of expected.forbiddenAnswerPatterns) {
    const regex = compileSafetyPattern(pattern, 'forbidden answer', failures);
    if (regex && regex.test(answer)) {
      failures.push(`forbidden answer pattern matched: ${pattern}`);
    }
  }

  for (const pattern of expected.requiredCanonicalRefPatterns) {
    const matched = valuesMatchPattern(canonicalRefs, pattern, 'required canonical ref', failures);
    if (matched === false) {
      failures.push(`missing required canonical ref pattern: ${pattern}`);
    }
  }

  for (const pattern of expected.forbiddenCanonicalRefPatterns) {
    if (valuesMatchPattern(canonicalRefs, pattern, 'forbidden canonical ref', failures)) {
      failures.push(`forbidden canonical ref pattern matched: ${pattern}`);
    }
  }

  for (const pattern of expected.requiredSourceLabelPatterns) {
    const matched = valuesMatchPattern(sourceLabels, pattern, 'required source label', failures);
    if (matched === false) {
      failures.push(`missing required source label pattern: ${pattern}`);
    }
  }

  for (const pattern of expected.forbiddenSourceLabelPatterns) {
    if (valuesMatchPattern(sourceLabels, pattern, 'forbidden source label', failures)) {
      failures.push(`forbidden source label pattern matched: ${pattern}`);
    }
  }

  return { pass: failures.length === 0, failures };
}
