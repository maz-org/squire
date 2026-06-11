import { and, eq, sql } from 'drizzle-orm';

import { getDb } from '../../db.ts';
import type { DbOrTx } from '../../auth/audit.ts';
import { conversations } from '../schema/conversations.ts';
import type {
  Conversation,
  ConversationHistoryCursor,
  ConversationHistoryPage,
  ConversationHistorySummary,
  CreateConversationInput,
} from './types.ts';

type ConversationRow = typeof conversations.$inferSelect;

function toDomain(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.userId,
    creationIdempotencyKey: row.creationIdempotencyKey,
    createdAt: row.createdAt,
    lastMessageAt: row.lastMessageAt,
  };
}

interface ConversationHistorySummaryRow {
  id: string;
  userId: string;
  createdAt: Date | string;
  lastMessageAt: Date | string;
  titleMessageContent: string | null;
  latestMessageContent: string | null;
  latestMessageRole: string | null;
  latestMessageGame: string | null;
  latestMessageIsError: boolean | null;
}

function coerceDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toHistorySummary(row: ConversationHistorySummaryRow): ConversationHistorySummary {
  const createdAt = coerceDate(row.createdAt);
  const lastMessageAt = coerceDate(row.lastMessageAt);
  return {
    id: row.id,
    userId: row.userId,
    createdAt,
    lastMessageAt,
    titleMessageContent: row.titleMessageContent,
    latestMessageContent: row.latestMessageContent,
    latestMessageRole:
      row.latestMessageRole === 'user' || row.latestMessageRole === 'assistant'
        ? row.latestMessageRole
        : null,
    latestMessageGame: row.latestMessageGame,
    latestMessageIsError: row.latestMessageIsError ?? false,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function loadOwnedSummaryPage(input: {
  userId: string;
  limit: number;
  cursor?: ConversationHistoryCursor | null;
  query?: string | null;
}): Promise<ConversationHistoryPage> {
  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new TypeError(`listOwnedSummaries: limit must be a positive integer, got ${input.limit}`);
  }

  const { db } = getDb('server');
  const pageSize = input.limit + 1;
  const cursorFilter = input.cursor
    ? sql`and (c.last_message_at, c.id) < (${input.cursor.lastMessageAt}, ${input.cursor.id}::uuid)`
    : sql``;
  const searchPattern = input.query ? `%${escapeLikePattern(input.query)}%` : null;
  const searchFilter = searchPattern
    ? sql`and exists (
        select 1
        from messages search_message
        where search_message.conversation_id = c.id
          and regexp_replace(btrim(search_message.content), '[[:space:]]+', ' ', 'g')
            ilike ${searchPattern} escape '\\'
      )`
    : sql``;

  const result = await db.execute(sql`
    with base as (
      select c.id, c.user_id, c.created_at, c.last_message_at
      from conversations c
      where c.user_id = ${input.userId}
      ${cursorFilter}
      ${searchFilter}
      order by c.last_message_at desc, c.id desc
      limit ${pageSize}
    ),
    title_user as (
      select distinct on (m.conversation_id)
        m.conversation_id,
        m.content,
        m.game
      from messages m
      where m.role = 'user'
        and length(btrim(m.content)) > 0
        and m.conversation_id in (select id from base)
      order by m.conversation_id, m.created_at asc, m.id asc
    ),
    latest_message as (
      select distinct on (m.conversation_id)
        m.conversation_id,
        m.content,
        m.role,
        m.game,
        m.is_error
      from messages m
      where m.conversation_id in (select id from base)
      order by m.conversation_id, m.created_at desc, m.id desc
    )
    select
      base.id,
      base.user_id as "userId",
      base.created_at as "createdAt",
      base.last_message_at as "lastMessageAt",
      title_user.content as "titleMessageContent",
      latest_message.content as "latestMessageContent",
      latest_message.role as "latestMessageRole",
      coalesce(latest_message.game, title_user.game) as "latestMessageGame",
      latest_message.is_error as "latestMessageIsError"
    from base
    left join title_user on title_user.conversation_id = base.id
    left join latest_message on latest_message.conversation_id = base.id
    order by base.last_message_at desc, base.id desc
  `);

  const summaries = result.rows.map((row) =>
    toHistorySummary(row as unknown as ConversationHistorySummaryRow),
  );
  const pageRows = summaries.slice(0, input.limit);
  const hasNextPage = summaries.length > input.limit;
  const lastVisible = pageRows[pageRows.length - 1] ?? null;
  return {
    rows: pageRows,
    nextCursor:
      hasNextPage && lastVisible
        ? { lastMessageAt: lastVisible.lastMessageAt, id: lastVisible.id }
        : null,
  };
}

export async function findOwnedById(
  userId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function listOwnedSummaries(input: {
  userId: string;
  limit: number;
  cursor?: ConversationHistoryCursor | null;
}): Promise<ConversationHistoryPage> {
  return loadOwnedSummaryPage(input);
}

export async function searchOwnedSummaries(input: {
  userId: string;
  query: string;
  limit: number;
  cursor?: ConversationHistoryCursor | null;
}): Promise<ConversationHistoryPage> {
  return loadOwnedSummaryPage(input);
}

export async function create(
  handle: DbOrTx,
  input: CreateConversationInput,
): Promise<Conversation> {
  const [row] = await handle
    .insert(conversations)
    .values({
      userId: input.userId,
      creationIdempotencyKey: input.creationIdempotencyKey ?? null,
    })
    .returning();
  return toDomain(row);
}

export async function getOrCreateByIdempotencyKey(
  handle: DbOrTx,
  input: CreateConversationInput,
): Promise<{ conversation: Conversation; created: boolean }> {
  const key = input.creationIdempotencyKey ?? null;
  if (!key) {
    return { conversation: await create(handle, input), created: true };
  }

  const inserted = await handle
    .insert(conversations)
    .values({
      userId: input.userId,
      creationIdempotencyKey: key,
    })
    .onConflictDoNothing({
      target: [conversations.userId, conversations.creationIdempotencyKey],
    })
    .returning();

  if (inserted[0]) {
    return { conversation: toDomain(inserted[0]), created: true };
  }

  const existing = await handle
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.userId, input.userId), eq(conversations.creationIdempotencyKey, key)),
    )
    .limit(1);

  if (!existing[0]) {
    throw new Error('Failed to load conversation for idempotency key');
  }

  return { conversation: toDomain(existing[0]), created: false };
}

export async function touchLastMessageAt(
  handle: DbOrTx,
  conversationId: string,
  timestamp: Date,
): Promise<void> {
  await handle
    .update(conversations)
    .set({ lastMessageAt: timestamp })
    .where(eq(conversations.id, conversationId));
}
