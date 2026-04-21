import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '../../db.ts';
import type { DbOrTx } from '../../auth/audit.ts';
import { messages } from '../schema/conversations.ts';
import type { ConversationMessage, CreateConversationMessageInput } from './types.ts';

type MessageRow = typeof messages.$inferSelect;

function toDomain(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    isError: row.isError,
    responseToMessageId: row.responseToMessageId,
    // Narrow jsonb string[] → AgentToolName[] at the domain boundary.
    // Post-SQR-105: may contain ToolSourceLabel strings for search_rules hits,
    // or AgentToolName strings for other tools. Both are plain strings; the
    // aggregateSourceLabels render helper handles both formats.
    consultedSources: (row.consultedSources as string[] | null) ?? null,
    createdAt: row.createdAt,
  };
}

export async function create(
  handle: DbOrTx,
  input: CreateConversationMessageInput,
): Promise<ConversationMessage> {
  const [row] = await handle
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      isError: input.isError ?? false,
      responseToMessageId: input.responseToMessageId ?? null,
      consultedSources: input.consultedSources ?? null,
    })
    .returning();
  return toDomain(row);
}

export async function createResponse(
  handle: DbOrTx,
  input: CreateConversationMessageInput & { responseToMessageId: string },
): Promise<ConversationMessage> {
  const inserted = await handle
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      isError: input.isError ?? false,
      responseToMessageId: input.responseToMessageId,
      consultedSources: input.consultedSources ?? null,
    })
    .onConflictDoNothing({
      target: messages.responseToMessageId,
    })
    .returning();

  if (inserted[0]) {
    return toDomain(inserted[0]);
  }

  const existing = await handle
    .select()
    .from(messages)
    .where(eq(messages.responseToMessageId, input.responseToMessageId))
    .limit(1);

  if (!existing[0]) {
    throw new Error('Failed to load existing response message');
  }

  return toDomain(existing[0]);
}

export async function listByConversationId(
  conversationId: string,
  options?: { includeErrors?: boolean; limit?: number },
): Promise<ConversationMessage[]> {
  const { db } = getDb('server');
  const includeErrors = options?.includeErrors ?? true;
  const where = includeErrors
    ? eq(messages.conversationId, conversationId)
    : and(eq(messages.conversationId, conversationId), eq(messages.isError, false));

  const query = db
    .select()
    .from(messages)
    .where(where!)
    .orderBy(desc(messages.createdAt), desc(messages.id));

  const rows = options?.limit ? await query.limit(options.limit) : await query;
  return rows.reverse().map(toDomain);
}

export async function findById(messageId: string): Promise<ConversationMessage | null> {
  const { db } = getDb('server');
  const rows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function findAssistantResponse(input: {
  conversationId: string;
  responseToMessageId: string;
}): Promise<ConversationMessage | null> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, input.conversationId),
        eq(messages.responseToMessageId, input.responseToMessageId),
        eq(messages.role, 'assistant'),
      ),
    )
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}
