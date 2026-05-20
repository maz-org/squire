import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './core.ts';

export const llmBudgetLedger = pgTable(
  'llm_budget_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    budgetDay: text('budget_day').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheCreationInputTokens: integer('cache_creation_input_tokens').notNull(),
    cacheReadInputTokens: integer('cache_read_input_tokens').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    costUsdMicros: integer('cost_usd_micros').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('llm_budget_ledger_day_idx').on(t.budgetDay),
    index('llm_budget_ledger_user_day_idx').on(t.userId, t.budgetDay),
  ],
);

export const llmBudgetWarnings = pgTable(
  'llm_budget_warnings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    budgetDay: text('budget_day').notNull(),
    thresholdPercent: integer('threshold_percent').notNull(),
    spentUsdMicros: integer('spent_usd_micros').notNull(),
    budgetUsdMicros: integer('budget_usd_micros').notNull(),
    emittedAt: timestamp('emitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('llm_budget_warnings_day_threshold_idx').on(t.budgetDay, t.thresholdPercent),
    check(
      'llm_budget_warnings_threshold_percent_chk',
      sql`${t.thresholdPercent} >= 1 AND ${t.thresholdPercent} <= 100`,
    ),
  ],
);
