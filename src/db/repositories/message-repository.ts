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
    })
    .returning();
  return toDomain(row);
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
