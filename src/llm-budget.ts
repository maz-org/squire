import { sql } from 'drizzle-orm';

import { getDb } from './db.ts';
import { llmBudgetLedger, llmBudgetWarnings } from './db/schema/budget.ts';
import { writeSecurityLog } from './security-log.ts';
import type { TokenUsage } from './agent.ts';

const DEFAULT_DAILY_BUDGET_USD = 10;
const DEFAULT_WARNING_THRESHOLD = 0.8;

export interface LlmBudgetConfig {
  dailyBudgetUsd: number;
  warningThreshold: number;
  pricingUsdPerMillionTokens: {
    input: number;
    output: number;
    cacheCreationInput: number;
    cacheReadInput: number;
  };
}

export interface LlmBudgetStatus {
  budgetDay: string;
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  exceeded: boolean;
}

export class LlmBudgetExceededError extends Error {
  readonly status: LlmBudgetStatus;

  constructor(status: LlmBudgetStatus) {
    super('Daily LLM budget exhausted.');
    this.name = 'LlmBudgetExceededError';
    this.status = status;
  }
}

export class LlmBudgetUsageMissingError extends Error {
  constructor() {
    super('LLM usage data is required for budget accounting.');
    this.name = 'LlmBudgetUsageMissingError';
  }
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRatio(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

export function loadLlmBudgetConfig(env: NodeJS.ProcessEnv = process.env): LlmBudgetConfig {
  return {
    dailyBudgetUsd: parsePositiveNumber(env.SQUIRE_LLM_DAILY_BUDGET_USD, DEFAULT_DAILY_BUDGET_USD),
    warningThreshold: parseRatio(
      env.SQUIRE_LLM_BUDGET_WARNING_THRESHOLD,
      DEFAULT_WARNING_THRESHOLD,
    ),
    pricingUsdPerMillionTokens: {
      input: parsePositiveNumber(env.SQUIRE_LLM_INPUT_USD_PER_MILLION_TOKENS, 3),
      output: parsePositiveNumber(env.SQUIRE_LLM_OUTPUT_USD_PER_MILLION_TOKENS, 15),
      cacheCreationInput: parsePositiveNumber(
        env.SQUIRE_LLM_CACHE_CREATION_INPUT_USD_PER_MILLION_TOKENS,
        6,
      ),
      cacheReadInput: parsePositiveNumber(
        env.SQUIRE_LLM_CACHE_READ_INPUT_USD_PER_MILLION_TOKENS,
        0.3,
      ),
    },
  };
}

function budgetDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function usdToMicros(usd: number): number {
  return Math.round(usd * 1_000_000);
}

function microsToUsd(micros: number): number {
  return micros / 1_000_000;
}

function costForTokens(tokens: number, usdPerMillion: number): number {
  return (tokens / 1_000_000) * usdPerMillion;
}

export function calculateLlmUsageCostUsdMicros(
  usage: TokenUsage,
  config: LlmBudgetConfig = loadLlmBudgetConfig(),
): number {
  const usd =
    costForTokens(usage.inputTokens, config.pricingUsdPerMillionTokens.input) +
    costForTokens(usage.outputTokens, config.pricingUsdPerMillionTokens.output) +
    costForTokens(
      usage.cacheCreationInputTokens,
      config.pricingUsdPerMillionTokens.cacheCreationInput,
    ) +
    costForTokens(usage.cacheReadInputTokens, config.pricingUsdPerMillionTokens.cacheReadInput);
  return usdToMicros(usd);
}

async function spentUsdMicrosForDay(day: string): Promise<number> {
  const { db } = getDb('server');
  const rows = await db
    .select({
      spentUsdMicros: sql<number>`coalesce(sum(${llmBudgetLedger.costUsdMicros}), 0)`,
    })
    .from(llmBudgetLedger)
    .where(sql`${llmBudgetLedger.budgetDay} = ${day}`);
  return Number(rows[0]?.spentUsdMicros ?? 0);
}

export async function getLlmBudgetStatus({
  now = new Date(),
  config = loadLlmBudgetConfig(),
}: {
  now?: Date;
  config?: LlmBudgetConfig;
} = {}): Promise<LlmBudgetStatus> {
  const day = budgetDay(now);
  const budgetUsdMicros = usdToMicros(config.dailyBudgetUsd);
  const spentUsdMicros = await spentUsdMicrosForDay(day);
  const remainingUsdMicros = Math.max(0, budgetUsdMicros - spentUsdMicros);

  return {
    budgetDay: day,
    budgetUsd: microsToUsd(budgetUsdMicros),
    spentUsd: microsToUsd(spentUsdMicros),
    remainingUsd: microsToUsd(remainingUsdMicros),
    exceeded: spentUsdMicros >= budgetUsdMicros,
  };
}

export async function assertLlmBudgetAvailable({
  userId: _userId = null,
  now = new Date(),
  config = loadLlmBudgetConfig(),
}: {
  userId?: string | null;
  now?: Date;
  config?: LlmBudgetConfig;
} = {}): Promise<void> {
  const status = await getLlmBudgetStatus({ now, config });
  if (status.exceeded) throw new LlmBudgetExceededError(status);
}

async function emitThresholdWarningOnce({
  day,
  spentUsdMicros,
  budgetUsdMicros,
  thresholdPercent,
}: {
  day: string;
  spentUsdMicros: number;
  budgetUsdMicros: number;
  thresholdPercent: number;
}): Promise<void> {
  const { db } = getDb('server');
  const inserted = await db
    .insert(llmBudgetWarnings)
    .values({
      budgetDay: day,
      thresholdPercent,
      spentUsdMicros,
      budgetUsdMicros,
    })
    .onConflictDoNothing({
      target: [llmBudgetWarnings.budgetDay, llmBudgetWarnings.thresholdPercent],
    })
    .returning({ id: llmBudgetWarnings.id });

  if (inserted.length === 0) return;

  writeSecurityLog({
    event: 'llm_budget_warning',
    fields: {
      budget_day: day,
      threshold_percent: thresholdPercent,
      spent_usd_micros: spentUsdMicros,
      budget_usd_micros: budgetUsdMicros,
    },
  });
}

export async function recordLlmUsage({
  userId = null,
  model,
  usage,
  now = new Date(),
  config = loadLlmBudgetConfig(),
}: {
  userId?: string | null;
  model: string;
  usage: TokenUsage | undefined;
  now?: Date;
  config?: LlmBudgetConfig;
}): Promise<void> {
  if (!usage) throw new LlmBudgetUsageMissingError();

  const day = budgetDay(now);
  const costUsdMicros = calculateLlmUsageCostUsdMicros(usage, config);
  const { db } = getDb('server');

  await db.insert(llmBudgetLedger).values({
    budgetDay: day,
    userId,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    totalTokens: usage.totalTokens,
    costUsdMicros,
    createdAt: now,
  });

  const spentUsdMicros = await spentUsdMicrosForDay(day);
  const budgetUsdMicros = usdToMicros(config.dailyBudgetUsd);
  const thresholdUsdMicros = Math.ceil(budgetUsdMicros * config.warningThreshold);
  if (spentUsdMicros >= thresholdUsdMicros) {
    await emitThresholdWarningOnce({
      day,
      spentUsdMicros,
      budgetUsdMicros,
      thresholdPercent: Math.round(config.warningThreshold * 100),
    });
  }
}
