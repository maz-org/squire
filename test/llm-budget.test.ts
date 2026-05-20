import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestDb, setupTestDb, teardownTestDb } from './helpers/db.ts';
import {
  LlmBudgetUsageMissingError,
  assertLlmBudgetAvailable,
  getLlmBudgetStatus,
  recordLlmUsage,
  type LlmBudgetConfig,
} from '../src/llm-budget.ts';

const TEST_CONFIG: LlmBudgetConfig = {
  dailyBudgetUsd: 10,
  warningThreshold: 0.8,
  pricingUsdPerMillionTokens: {
    input: 1_000_000,
    output: 1_000_000,
    cacheCreationInput: 1_000_000,
    cacheReadInput: 1_000_000,
  },
};

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await teardownTestDb();
});

describe('LLM budget accounting', () => {
  it('accumulates usage across multiple turns', async () => {
    const now = new Date('2026-05-20T12:00:00.000Z');

    await recordLlmUsage({
      model: 'test-model',
      usage: {
        inputTokens: 2,
        outputTokens: 1,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 3,
      },
      now,
      config: TEST_CONFIG,
    });
    await recordLlmUsage({
      model: 'test-model',
      usage: {
        inputTokens: 1,
        outputTokens: 3,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 4,
      },
      now,
      config: TEST_CONFIG,
    });

    const status = await getLlmBudgetStatus({ now, config: TEST_CONFIG });

    expect(status.spentUsd).toBe(7);
    expect(status.remainingUsd).toBe(3);
    expect(status.exceeded).toBe(false);
  });

  it('resets the budget window at UTC midnight', async () => {
    await recordLlmUsage({
      model: 'test-model',
      usage: {
        inputTokens: 9,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 9,
      },
      now: new Date('2026-05-20T23:59:59.000Z'),
      config: TEST_CONFIG,
    });

    const nextDay = await getLlmBudgetStatus({
      now: new Date('2026-05-21T00:00:00.000Z'),
      config: TEST_CONFIG,
    });

    expect(nextDay.spentUsd).toBe(0);
    expect(nextDay.remainingUsd).toBe(10);
  });

  it('blocks admission when the daily budget is already spent', async () => {
    const now = new Date('2026-05-20T12:00:00.000Z');
    await recordLlmUsage({
      model: 'test-model',
      usage: {
        inputTokens: 10,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 10,
      },
      now,
      config: TEST_CONFIG,
    });

    await expect(assertLlmBudgetAvailable({ now, config: TEST_CONFIG })).rejects.toMatchObject({
      status: expect.objectContaining({ exceeded: true, remainingUsd: 0 }),
    });
  });

  it('logs the 80 percent warning once per UTC day', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = new Date('2026-05-20T12:00:00.000Z');

    await recordLlmUsage({
      model: 'test-model',
      usage: {
        inputTokens: 7,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 7,
      },
      now,
      config: TEST_CONFIG,
    });
    await recordLlmUsage({
      model: 'test-model',
      usage: {
        inputTokens: 2,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 2,
      },
      now,
      config: TEST_CONFIG,
    });
    await recordLlmUsage({
      model: 'test-model',
      usage: {
        inputTokens: 1,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 1,
      },
      now,
      config: TEST_CONFIG,
    });

    const budgetWarnings = warn.mock.calls
      .map((call) => JSON.parse(call[0] as string) as { event?: string })
      .filter((payload) => payload.event === 'llm_budget_warning');
    expect(budgetWarnings).toHaveLength(1);
  });

  it('treats missing usage data as an explicit accounting failure', async () => {
    await expect(
      recordLlmUsage({
        model: 'test-model',
        usage: undefined,
        now: new Date('2026-05-20T12:00:00.000Z'),
        config: TEST_CONFIG,
      }),
    ).rejects.toBeInstanceOf(LlmBudgetUsageMissingError);
  });
});
