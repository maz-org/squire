import { sql } from 'drizzle-orm';

import { ask, type HistoryMessage, type EmitFn } from '../service.ts';
import { getDb } from '../db.ts';
import * as ConversationRepository from '../db/repositories/conversation-repository.ts';
import * as MessageRepository from '../db/repositories/message-repository.ts';
import * as MessageStreamEventRepository from '../db/repositories/message-stream-event-repository.ts';
import type {
  Conversation,
  ConversationHistoryCursor,
  ConversationMessage,
} from '../db/repositories/types.ts';
import { SUPPORTED_GAMES } from '../game.ts';
import { retrievalSourceLabelToFooterLabel } from '../web-ui/consulted-footer.ts';

const HISTORY_LIMIT = 20;
const RETRY_DELAY_MS = 200;

export const GENERIC_FAILURE_MESSAGE = "I hit an error and couldn't answer that. Please try again.";

export interface PendingConversationTurn {
  conversation: Conversation;
  currentUserMessage: ConversationMessage | null;
}

export type ConversationHistoryStatus = 'idle' | 'running' | 'error';

export interface ConversationHistoryViewRow {
  id: string;
  href: string;
  active: boolean;
  title: string;
  preview: string;
  gameScope: string | null;
  lastActivityAt: Date;
  lastActivityLabel: string;
  status: ConversationHistoryStatus;
}

export interface ConversationHistoryViewModel {
  rows: ConversationHistoryViewRow[];
  nextCursor: string | null;
  query?: string;
}

const DEFAULT_HISTORY_LIMIT = 30;
const UNTITLED_CHAT_TITLE = 'Untitled chat';
const HISTORY_QUERY_MAX_LENGTH = 120;
const HISTORY_TITLE_MAX_LENGTH = 72;
const gameLabels = new Map<string, string>([
  ...SUPPORTED_GAMES.map((game) => [game.id, game.label] as const),
  ['gloomhaven-2e', 'Gloomhaven 2e'],
]);

function normalizeHistoryText(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function clampHistoryQuery(value: string | undefined): string {
  return normalizeHistoryText(value ?? '')
    .slice(0, HISTORY_QUERY_MAX_LENGTH)
    .trim();
}

function deriveHistoryTitle(value: string | null): string {
  const normalized = normalizeHistoryText(value);
  if (!normalized) return UNTITLED_CHAT_TITLE;
  if (normalized.length <= HISTORY_TITLE_MAX_LENGTH) return normalized;

  // SQR-257: titles are deterministic excerpts from user-visible questions,
  // not model-generated summaries. That keeps first-answer latency unchanged
  // and prevents the history rail from inventing a misleading label.
  const clipped = normalized.slice(0, HISTORY_TITLE_MAX_LENGTH + 1);
  const lastSpace = clipped.lastIndexOf(' ');
  const title =
    lastSpace >= 40
      ? clipped.slice(0, lastSpace).trim()
      : normalized.slice(0, HISTORY_TITLE_MAX_LENGTH).trim();
  return `${title.replace(/[,:;.!?\s]+$/, '')}...`;
}

function gameScopeLabel(gameId: string | null): string | null {
  if (!gameId) return null;
  return gameLabels.get(gameId) ?? null;
}

function encodeHistoryCursor(cursor: ConversationHistoryCursor | null): string | null {
  if (!cursor) return null;
  return Buffer.from(
    JSON.stringify({
      lastMessageAt: cursor.lastMessageAt.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url');
}

function decodeHistoryCursor(cursor: string | undefined): ConversationHistoryCursor | null {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      lastMessageAt?: unknown;
      id?: unknown;
    };
    if (typeof decoded.id !== 'string' || typeof decoded.lastMessageAt !== 'string') return null;
    const lastMessageAt = new Date(decoded.lastMessageAt);
    if (Number.isNaN(lastMessageAt.getTime())) return null;
    return { id: decoded.id, lastMessageAt };
  } catch {
    return null;
  }
}

function formatLastActivityLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export async function loadConversationHistory(input: {
  userId: string;
  activeConversationId?: string | null;
  activeStatus?: ConversationHistoryStatus;
  limit?: number;
  cursor?: string;
  query?: string;
}): Promise<ConversationHistoryViewModel> {
  const limit = input.limit ?? DEFAULT_HISTORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError(`loadConversationHistory: limit must be a positive integer, got ${limit}`);
  }
  const query = clampHistoryQuery(input.query);

  const page =
    query.length > 0
      ? await ConversationRepository.searchOwnedSummaries({
          userId: input.userId,
          query,
          limit,
          cursor: decodeHistoryCursor(input.cursor),
        })
      : await ConversationRepository.listOwnedSummaries({
          userId: input.userId,
          limit,
          cursor: decodeHistoryCursor(input.cursor),
        });

  return {
    query,
    rows: page.rows.map((row) => {
      const active = row.id === input.activeConversationId;
      const title = deriveHistoryTitle(row.titleMessageContent);
      const preview = normalizeHistoryText(row.latestMessageContent);
      return {
        id: row.id,
        href: `/chat/${row.id}`,
        active,
        title,
        preview,
        gameScope: gameScopeLabel(row.latestMessageGame),
        lastActivityAt: row.lastMessageAt,
        lastActivityLabel: formatLastActivityLabel(row.lastMessageAt),
        status: active ? (input.activeStatus ?? 'idle') : 'idle',
      };
    }),
    nextCursor: encodeHistoryCursor(page.nextCursor),
  };
}

function isRetryableTransportError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  const errObj = err as {
    code?: string;
    cause?: { code?: string };
    name?: string;
    message?: string;
  };
  const code = errObj.code ?? errObj.cause?.code;
  const message = errObj.message ?? '';
  if (
    code &&
    ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code)
  ) {
    return true;
  }

  return errObj.name === 'AbortError' || /network|socket|timed out/i.test(message);
}

function toHistory(messages: ConversationMessage[]): HistoryMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function agentOptions(input: {
  history: HistoryMessage[];
  userId: string;
  correlation: { conversationId: string; userMessageId: string; requestId?: string };
  game?: string;
  emit: EmitFn;
}) {
  return {
    history: input.history,
    userId: input.userId,
    requestId: input.correlation.requestId,
    conversationId: input.correlation.conversationId,
    userMessageId: input.correlation.userMessageId,
    ...(input.game ? { game: input.game } : {}),
    emit: input.emit,
  };
}

async function generateAssistantReply(
  question: string,
  history: HistoryMessage[],
  userId: string,
  correlation: { conversationId: string; userMessageId: string; requestId?: string },
  emit: EmitFn,
  options: { retryOnTransportError: boolean; game?: string; onRetry?: () => void } = {
    retryOnTransportError: true,
  },
) {
  const baseOptions = () =>
    agentOptions({
      history,
      userId,
      correlation,
      game: options.game,
      emit,
    });
  try {
    return await ask(question, baseOptions());
  } catch (err) {
    if (!isRetryableTransportError(err) || !options.retryOnTransportError) {
      throw err;
    }

    // SQR-98 regression: capture-emit wrapper is always installed so we
    // can't use emit-truthiness as the "is streaming?" gate any more.
    // Caller passes the explicit flag and, if retrying, resets any
    // accumulator state populated by the failed first attempt.
    options.onRetry?.();
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return ask(question, baseOptions());
  }
}

async function persistAssistantOutcome(input: {
  conversationId: string;
  question: string;
  userId: string;
  currentUserMessageId: string;
  game?: string;
  requestId?: string;
  onEvent?: EmitFn;
  failureMessage?: string;
}): Promise<ConversationMessage> {
  const priorMessages = await MessageRepository.listByConversationId(input.conversationId, {
    includeErrors: false,
    limit: HISTORY_LIMIT + 1,
  });
  const history = toHistory(
    priorMessages.filter((message) => message.id !== input.currentUserMessageId),
  );

  // SQR-98: capture consulted tool names for every write path, not just the
  // SSE one. The plain-form POST fallback (no HTMX / no live stream) still
  // renders the answer from the DB after redirect, so the footer needs real
  // provenance there too. Wrapping the caller's onEvent here is the single
  // chokepoint — any path that produces an assistant message (streaming or
  // not) now persists sources.
  const capturedSources: string[] = [];
  const captureOnEvent: EmitFn = async (event, data) => {
    if (event === 'tool_result') {
      const payload = data as { name?: string; ok?: boolean; sourceBooks?: string[] };
      // Require explicit ok === true. Absence-of-failure (ok undefined) is
      // NOT the same as success — a future tool event that forgets to set
      // ok would silently leak a failed source into the footer otherwise.
      if (payload.ok === true) {
        if (payload.sourceBooks !== undefined) {
          // search_rules path: sourceBooks is always an array (possibly empty).
          // Empty means the query returned no hits — store nothing so the footer
          // doesn't falsely claim a book was consulted when retrieval found nothing.
          for (const rawLabel of payload.sourceBooks) {
            const label = retrievalSourceLabelToFooterLabel(rawLabel);
            if (label !== null) capturedSources.push(label);
          }
        } else if (typeof payload.name === 'string' && payload.name.length > 0) {
          // All other tools: store the tool name (pre-SQR-105 format).
          // aggregateSourceLabels maps tool names to labels at render time.
          capturedSources.push(payload.name);
        }
      }
    }
    if (input.onEvent) await input.onEvent(event, data);
  };

  return getDb('server').db.transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtext(${input.conversationId}),
        hashtext(${input.currentUserMessageId})
      )
    `);

    const existingAssistantMessage = await MessageRepository.findAssistantResponse({
      conversationId: input.conversationId,
      responseToMessageId: input.currentUserMessageId,
    });
    if (existingAssistantMessage) {
      return existingAssistantMessage;
    }

    try {
      const answer = await generateAssistantReply(
        input.question,
        history,
        input.userId,
        {
          requestId: input.requestId,
          conversationId: input.conversationId,
          userMessageId: input.currentUserMessageId,
        },
        captureOnEvent,
        {
          // Retry transient transport errors ONLY on the non-streaming path.
          // On SSE the client has already seen a partial stream; silently
          // restarting would mix two runs into one DOM update.
          retryOnTransportError: input.onEvent === undefined,
          game: input.game,
          // Failed attempt may have pushed tool names before throwing — reset
          // so the persisted sources match the successful attempt only.
          onRetry: () => {
            capturedSources.length = 0;
          },
        },
      );
      const assistantMessage = await MessageRepository.createResponse(tx, {
        conversationId: input.conversationId,
        role: 'assistant',
        content: answer,
        responseToMessageId: input.currentUserMessageId,
        // Null when the agent used no source tools. Pre-SQR-98 rows and
        // tool-free answers both render with footer hidden — indistinguishable
        // at the render layer, which is correct: both states mean "no
        // provenance to show."
        consultedSources: capturedSources.length > 0 ? capturedSources : null,
      });
      await ConversationRepository.touchLastMessageAt(
        tx,
        input.conversationId,
        assistantMessage.createdAt,
      );
      return assistantMessage;
    } catch (err) {
      console.error('[conversation] ask failed:', err instanceof Error ? err.message : err);
      const failureMessage = await MessageRepository.createResponse(tx, {
        conversationId: input.conversationId,
        role: 'assistant',
        content: input.failureMessage ?? GENERIC_FAILURE_MESSAGE,
        isError: true,
        responseToMessageId: input.currentUserMessageId,
      });
      await ConversationRepository.touchLastMessageAt(
        tx,
        input.conversationId,
        failureMessage.createdAt,
      );
      return failureMessage;
    }
  });
}

async function findRepairableInitialUserMessage(
  conversationId: string,
): Promise<ConversationMessage | null> {
  const storedMessages = await MessageRepository.listByConversationId(conversationId, {
    includeErrors: true,
  });

  return storedMessages.length === 1 && storedMessages[0]?.role === 'user'
    ? storedMessages[0]
    : null;
}

async function createConversationTurn(input: {
  userId: string;
  question: string;
  idempotencyKey: string;
  game?: string;
}): Promise<PendingConversationTurn> {
  const result = await getDb('server').db.transaction(async (tx) => {
    const existingOrCreated = await ConversationRepository.getOrCreateByIdempotencyKey(tx, {
      userId: input.userId,
      creationIdempotencyKey: input.idempotencyKey,
    });

    if (!existingOrCreated.created) {
      return {
        conversation: existingOrCreated.conversation,
        currentUserMessage: null,
      };
    }

    const userMessage = await MessageRepository.create(tx, {
      conversationId: existingOrCreated.conversation.id,
      role: 'user',
      content: input.question,
      game: input.game ?? null,
    });
    await ConversationRepository.touchLastMessageAt(
      tx,
      existingOrCreated.conversation.id,
      userMessage.createdAt,
    );
    return {
      conversation: existingOrCreated.conversation,
      currentUserMessage: userMessage,
    };
  });

  if (result.currentUserMessage) {
    return result;
  }

  return {
    conversation: result.conversation,
    currentUserMessage: await findRepairableInitialUserMessage(result.conversation.id),
  };
}

export async function createPendingConversation(input: {
  userId: string;
  question: string;
  idempotencyKey: string;
  game?: string;
}): Promise<PendingConversationTurn> {
  return createConversationTurn(input);
}

export async function createPendingFollowUp(input: {
  conversationId: string;
  userId: string;
  question: string;
  game?: string;
}): Promise<PendingConversationTurn | null> {
  const existingConversation = await ConversationRepository.findOwnedById(
    input.userId,
    input.conversationId,
  );
  if (!existingConversation) return null;

  const currentUserMessage = await getDb('server').db.transaction(async (tx) => {
    const userMessage = await MessageRepository.create(tx, {
      conversationId: input.conversationId,
      role: 'user',
      content: input.question,
      game: input.game ?? null,
    });
    await ConversationRepository.touchLastMessageAt(
      tx,
      input.conversationId,
      userMessage.createdAt,
    );
    return userMessage;
  });

  return {
    conversation: existingConversation,
    currentUserMessage,
  };
}

export async function streamAssistantTurn(input: {
  conversationId: string;
  question: string;
  userId: string;
  currentUserMessageId: string;
  game?: string;
  requestId?: string;
  onEvent: EmitFn;
  failureMessage?: string;
}): Promise<ConversationMessage> {
  return persistAssistantOutcome({
    conversationId: input.conversationId,
    question: input.question,
    userId: input.userId,
    currentUserMessageId: input.currentUserMessageId,
    game: input.game,
    requestId: input.requestId,
    onEvent: input.onEvent,
    failureMessage: input.failureMessage,
  });
}

export async function persistAssistantFailureTurn(input: {
  conversationId: string;
  userMessageId: string;
  content?: string;
}): Promise<ConversationMessage> {
  return getDb('server').db.transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtext(${input.conversationId}),
        hashtext(${input.userMessageId})
      )
    `);

    const existingAssistantMessage = await MessageRepository.findAssistantResponse({
      conversationId: input.conversationId,
      responseToMessageId: input.userMessageId,
    });
    if (existingAssistantMessage) {
      return existingAssistantMessage;
    }

    const failureMessage = await MessageRepository.createResponse(tx, {
      conversationId: input.conversationId,
      role: 'assistant',
      content: input.content ?? GENERIC_FAILURE_MESSAGE,
      isError: true,
      responseToMessageId: input.userMessageId,
    });
    await ConversationRepository.touchLastMessageAt(
      tx,
      input.conversationId,
      failureMessage.createdAt,
    );
    return failureMessage;
  });
}

export async function startConversation(input: {
  userId: string;
  question: string;
  idempotencyKey: string;
  game?: string;
  requestId?: string;
}): Promise<Conversation> {
  const result = await createConversationTurn(input);
  if (result.currentUserMessage) {
    await persistAssistantOutcome({
      conversationId: result.conversation.id,
      question: result.currentUserMessage.content,
      userId: input.userId,
      currentUserMessageId: result.currentUserMessage.id,
      game: result.currentUserMessage.game ?? input.game,
      requestId: input.requestId,
    });
  }

  return (
    (await ConversationRepository.findOwnedById(input.userId, result.conversation.id)) ??
    result.conversation
  );
}

export async function appendMessage(input: {
  conversationId: string;
  userId: string;
  question: string;
  game?: string;
  requestId?: string;
}): Promise<Conversation | null> {
  const result = await createPendingFollowUp(input);
  if (!result?.currentUserMessage) return null;

  await persistAssistantOutcome({
    conversationId: input.conversationId,
    question: input.question,
    userId: input.userId,
    currentUserMessageId: result.currentUserMessage.id,
    game: result.currentUserMessage.game ?? input.game,
    requestId: input.requestId,
  });

  return ConversationRepository.findOwnedById(input.userId, input.conversationId);
}

export async function loadConversationMessage(input: {
  conversationId: string;
  messageId: string;
  userId: string;
}): Promise<{ conversation: Conversation; message: ConversationMessage } | null> {
  const conversation = await ConversationRepository.findOwnedById(
    input.userId,
    input.conversationId,
  );
  if (!conversation) return null;

  const message = await MessageRepository.findById(input.messageId);
  if (!message || message.conversationId !== conversation.id || message.role !== 'user') {
    return null;
  }

  return { conversation, message };
}

export async function loadConversation(input: {
  conversationId: string;
  userId: string;
  /**
   * Cap the number of returned messages. Used by the conversation page
   * GET handler to bound the O(n) HTML render cost on long sessions —
   * with the scrolling-chat IA (ADR 0012) every persisted turn is
   * rendered, not just the latest. The repository sorts newest-first
   * under the hood and reverses to oldest-first on return, so a limit
   * of N keeps the most recent N messages and drops the older ones.
   * Omit (or pass undefined) for the full transcript — used by stream /
   * persistence paths that need the complete history for state checks.
   */
  limit?: number;
}): Promise<{ conversation: Conversation; messages: ConversationMessage[] } | null> {
  // Reject non-positive / non-integer limits — the repository uses a truthy
  // check on `limit`, so 0 would silently return the full transcript and
  // defeat the cap. Callers that want unbounded results must omit `limit`.
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new TypeError(
        `loadConversation: limit must be a positive integer or undefined, got ${input.limit}`,
      );
    }
  }

  const conversation = await ConversationRepository.findOwnedById(
    input.userId,
    input.conversationId,
  );
  if (!conversation) return null;

  const messages = await MessageRepository.listByConversationId(conversation.id, {
    includeErrors: true,
    limit: input.limit,
  });

  // CodeRabbit (PR 274): if the limit window cut between a user message and
  // its assistant reply, any assistant in the slice whose paired user is
  // older than the cap is orphaned. `pairConversationTurns` keys assistants
  // by responseToMessageId and silently drops orphans — visible data loss
  // in the rendered transcript. Multiple orphans are possible when
  // assistants land out-of-order (e.g., U1, U2, A1, A2 chronologically →
  // limit 2 returns A1, A2 with both pairs cut). Scan the whole slice for
  // missing user pairs, batch-fetch them, and prepend in chronological
  // order so every assistant retains its question.
  if (input.limit !== undefined && messages.length > 0) {
    const presentIds = new Set(messages.map((message) => message.id));
    const missingUserIds = [
      ...new Set(
        messages.flatMap((message) =>
          message.role === 'assistant' &&
          message.responseToMessageId &&
          !presentIds.has(message.responseToMessageId)
            ? [message.responseToMessageId]
            : [],
        ),
      ),
    ];

    if (missingUserIds.length > 0) {
      const paddedUsers = (
        await Promise.all(missingUserIds.map((id) => MessageRepository.findById(id)))
      )
        .filter(
          (message): message is ConversationMessage =>
            !!message && message.conversationId === conversation.id && message.role === 'user',
        )
        .sort((left, right) => {
          const byTime = left.createdAt.getTime() - right.createdAt.getTime();
          return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
        });

      messages.unshift(...paddedUsers);
    }
  }

  // SQR-261: completed work logs reload from the same browser-safe SSE rows
  // the live client saw. That keeps persisted timelines inspectable without a
  // second storage shape for raw tool payloads or hidden reasoning.
  const responseUserMessageIds = [
    ...new Set(
      messages.flatMap((message) =>
        message.role === 'assistant' && message.responseToMessageId
          ? [message.responseToMessageId]
          : [],
      ),
    ),
  ];
  const publicWorkEventsByUserMessage =
    await MessageStreamEventRepository.listPublicWorkEventsByUserMessageIds(responseUserMessageIds);
  const messagesWithPublicWorkEvents = messages.map((message) =>
    message.role === 'assistant' && message.responseToMessageId
      ? {
          ...message,
          publicWorkEvents: publicWorkEventsByUserMessage.get(message.responseToMessageId) ?? [],
        }
      : message,
  );

  return { conversation, messages: messagesWithPublicWorkEvents };
}
