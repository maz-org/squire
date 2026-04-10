import { and, eq } from 'drizzle-orm';

import { getDb } from '../../db.ts';
import type { DbOrTx } from '../../auth/audit.ts';
import { conversations } from '../schema/conversations.ts';
import type { Conversation, CreateConversationInput } from './types.ts';

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

export async function findOwnedById(userId: string, conversationId: string): Promise<Conversation | null> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function create(handle: DbOrTx, input: CreateConversationInput): Promise<Conversation> {
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
      and(
        eq(conversations.userId, input.userId),
        eq(conversations.creationIdempotencyKey, key),
      ),
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
