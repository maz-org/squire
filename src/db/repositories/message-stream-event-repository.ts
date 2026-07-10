import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';

import { getDb } from '../../db.ts';
import { messageStreamEvents } from '../schema/conversations.ts';
import type {
  ConversationMessagePublicWorkEvent,
  ConversationMessagePublicWorkEventName,
} from './types.ts';

export type BrowserStreamEventName =
  | 'text-delta'
  | 'tool-start'
  | 'tool-plan'
  | 'tool-result'
  | 'tool-progress'
  | 'answer-artifact'
  | 'state-used'
  | 'proposal-staged'
  | 'done'
  | 'error';

export interface MessageStreamEvent {
  sequence: number;
  event: BrowserStreamEventName;
  payload: Record<string, unknown>;
  createdAt: Date;
}

const TERMINAL_EVENTS = new Set<BrowserStreamEventName>(['done', 'error']);
const PUBLIC_WORK_EVENTS: ConversationMessagePublicWorkEventName[] = [
  'tool-plan',
  'tool-progress',
  'tool-result',
  'answer-artifact',
];

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps driver errors (DrizzleQueryError with the pg error as
  // `cause`), so walk the cause chain — checking only the top-level error
  // meant the append retry/dedupe path never engaged (SQR-406).
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if (typeof current === 'object' && (current as { code?: string }).code === '23505') {
      return true;
    }
  }
  return false;
}

function toDomain(row: typeof messageStreamEvents.$inferSelect): MessageStreamEvent {
  return {
    sequence: row.sequence,
    event: row.event as BrowserStreamEventName,
    payload: row.payload,
    createdAt: row.createdAt,
  };
}

export function isTerminalEvent(event: MessageStreamEvent): boolean {
  return TERMINAL_EVENTS.has(event.event);
}

export async function listAfter(input: {
  userMessageId: string;
  afterSequence?: number;
}): Promise<MessageStreamEvent[]> {
  const { db } = getDb('server');
  const afterSequence = input.afterSequence ?? 0;
  const rows = await db
    .select()
    .from(messageStreamEvents)
    .where(
      afterSequence > 0
        ? and(
            eq(messageStreamEvents.userMessageId, input.userMessageId),
            gt(messageStreamEvents.sequence, afterSequence),
          )
        : eq(messageStreamEvents.userMessageId, input.userMessageId),
    )
    .orderBy(asc(messageStreamEvents.sequence));

  return rows.map((row) => toDomain(row));
}

export async function findTerminal(userMessageId: string): Promise<MessageStreamEvent | null> {
  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(messageStreamEvents)
    .where(eq(messageStreamEvents.userMessageId, userMessageId))
    .orderBy(asc(messageStreamEvents.sequence));
  const terminal = rows.find((row) => row.event === 'done' || row.event === 'error');
  return terminal ? toDomain(terminal) : null;
}

export async function listPublicWorkEventsByUserMessageIds(
  userMessageIds: string[],
): Promise<Map<string, ConversationMessagePublicWorkEvent[]>> {
  const eventsByUserMessage = new Map<string, ConversationMessagePublicWorkEvent[]>();
  if (userMessageIds.length === 0) return eventsByUserMessage;

  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(messageStreamEvents)
    .where(
      and(
        inArray(messageStreamEvents.userMessageId, userMessageIds),
        inArray(messageStreamEvents.event, PUBLIC_WORK_EVENTS),
      ),
    )
    .orderBy(asc(messageStreamEvents.userMessageId), asc(messageStreamEvents.sequence));

  for (const row of rows) {
    const event = row.event as ConversationMessagePublicWorkEventName;
    if (!PUBLIC_WORK_EVENTS.includes(event)) continue;
    const entry: ConversationMessagePublicWorkEvent = {
      sequence: row.sequence,
      event,
      payload: row.payload,
      createdAt: row.createdAt,
    };
    const existing = eventsByUserMessage.get(row.userMessageId) ?? [];
    existing.push(entry);
    eventsByUserMessage.set(row.userMessageId, existing);
  }

  return eventsByUserMessage;
}

export async function listTerminalEventsByUserMessageIds(
  userMessageIds: string[],
): Promise<Map<string, MessageStreamEvent>> {
  const terminalEventsByUserMessage = new Map<string, MessageStreamEvent>();
  if (userMessageIds.length === 0) return terminalEventsByUserMessage;

  const { db } = getDb('server');
  const rows = await db
    .select()
    .from(messageStreamEvents)
    .where(
      and(
        inArray(messageStreamEvents.userMessageId, userMessageIds),
        inArray(messageStreamEvents.event, ['done', 'error']),
      ),
    )
    .orderBy(asc(messageStreamEvents.userMessageId), asc(messageStreamEvents.sequence));

  for (const row of rows) {
    terminalEventsByUserMessage.set(row.userMessageId, toDomain(row));
  }

  return terminalEventsByUserMessage;
}

async function insertNext(input: {
  conversationId: string;
  userMessageId: string;
  event: BrowserStreamEventName;
  payload: Record<string, unknown>;
}): Promise<MessageStreamEvent> {
  const { db } = getDb('server');
  // Sequence allocation is serialized per user message (SQR-406): the
  // max(sequence)+1 CTE races when a reconnecting client and the finishing
  // generator append concurrently, colliding on the (user_message_id,
  // sequence) unique index. The advisory key deliberately differs from the
  // turn-generation lock (conversationId, userMessageId) — the generation
  // transaction holds that one for the whole turn on another connection, so
  // reusing it here would deadlock the generator against its own appends.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtext(${input.userMessageId}),
        hashtext('stream-event-sequence')
      )
    `);
    return tx.execute(sql`
    with next_sequence as (
      select coalesce(max(sequence), 0) + 1 as sequence
      from message_stream_events
      where user_message_id = ${input.userMessageId}
    )
    insert into message_stream_events (
      conversation_id,
      user_message_id,
      sequence,
      event,
      payload
    )
    select
      ${input.conversationId},
      ${input.userMessageId},
      sequence,
      ${input.event},
      ${JSON.stringify(input.payload)}::jsonb
    from next_sequence
    returning sequence, event, payload, created_at as "createdAt"
  `);
  });
  const row = result.rows[0] as
    | { sequence: number; event: string; payload: Record<string, unknown>; createdAt: Date }
    | undefined;
  if (!row) throw new Error('Failed to insert message stream event');
  return {
    sequence: row.sequence,
    event: row.event as BrowserStreamEventName,
    payload: row.payload,
    createdAt: row.createdAt,
  };
}

export async function append(input: {
  conversationId: string;
  userMessageId: string;
  event: BrowserStreamEventName;
  payload: Record<string, unknown>;
}): Promise<MessageStreamEvent> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await insertNext(input);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const terminal = await findTerminal(input.userMessageId);
      if (terminal && TERMINAL_EVENTS.has(input.event)) return terminal;
    }
  }
  // Last attempt: a terminal event must never die on a sequence race — if a
  // concurrent writer landed the real terminal, surface that instead
  // (SQR-406: the propagated violation killed the reconnect SSE).
  try {
    return await insertNext(input);
  } catch (error) {
    if (isUniqueViolation(error) && TERMINAL_EVENTS.has(input.event)) {
      const terminal = await findTerminal(input.userMessageId);
      if (terminal) return terminal;
    }
    throw error;
  }
}

export async function isTurnGenerationLocked(input: {
  conversationId: string;
  userMessageId: string;
}): Promise<boolean> {
  const { db } = getDb('server');
  const result = await db.execute(sql`
    select pg_try_advisory_xact_lock(
      hashtext(${input.conversationId}),
      hashtext(${input.userMessageId})
    ) as acquired
  `);
  const acquired = Boolean((result.rows[0] as { acquired?: boolean } | undefined)?.acquired);
  return !acquired;
}
