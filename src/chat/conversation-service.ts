import { sql } from 'drizzle-orm';

import { ask, type HistoryMessage } from '../service.ts';
import { getDb } from '../db.ts';
import * as ConversationRepository from '../db/repositories/conversation-repository.ts';
import * as MessageRepository from '../db/repositories/message-repository.ts';
import type { Conversation, ConversationMessage } from '../db/repositories/types.ts';
import { retrievalSourceLabelToFooterLabel } from '../web-ui/consulted-footer.ts';

const HISTORY_LIMIT = 20;
const RETRY_DELAY_MS = 200;

export const GENERIC_FAILURE_MESSAGE = "I hit an error and couldn't answer that. Please try again.";

export interface PendingConversationTurn {
  conversation: Conversation;
  currentUserMessage: ConversationMessage | null;
}

export interface SelectedConversationQuestion {
  messageId: string;
  question: string;
  askedAt: Date;
}

export interface SelectedConversationTurn {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  isEarlierQuestion: boolean;
}

export interface SelectedConversationProjection {
  conversation: Conversation;
  selectedTurn: SelectedConversationTurn;
  recentQuestions: SelectedConversationQuestion[];
}

interface CompletedConversationTurn {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
}

function listCompletedTurns(messages: ConversationMessage[]): CompletedConversationTurn[] {
  const assistantResponses = new Map<string, ConversationMessage>();
  const completedTurns: CompletedConversationTurn[] = [];

  for (const message of messages) {
    if (message.role === 'assistant' && message.responseToMessageId && !message.isError) {
      assistantResponses.set(message.responseToMessageId, message);
    }
  }

  for (const message of messages) {
    if (message.role !== 'user') continue;

    const assistantMessage = assistantResponses.get(message.id);
    if (!assistantMessage) continue;

    completedTurns.push({
      userMessage: message,
      assistantMessage,
    });
  }

  return completedTurns;
}

export function listRecentCompletedQuestions(
  messages: ConversationMessage[],
  options: { excludeMessageId?: string } = {},
): SelectedConversationQuestion[] {
  return listCompletedTurns(messages)
    .filter((turn) => turn.userMessage.id !== options.excludeMessageId)
    .slice()
    .sort((left, right) => {
      const timestampDiff =
        right.userMessage.createdAt.getTime() - left.userMessage.createdAt.getTime();
      if (timestampDiff !== 0) return timestampDiff;
      return right.userMessage.id.localeCompare(left.userMessage.id);
    })
    .map((turn) => ({
      messageId: turn.userMessage.id,
      question: turn.userMessage.content,
      askedAt: turn.userMessage.createdAt,
    }));
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

async function generateAssistantReply(
  question: string,
  history: HistoryMessage[],
  userId: string,
  emit: (event: string, data: unknown) => Promise<void>,
  options: { retryOnTransportError: boolean; onRetry?: () => void } = {
    retryOnTransportError: true,
  },
) {
  try {
    return await ask(question, { history, userId, emit });
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
    return ask(question, { history, userId, emit });
  }
}

async function persistAssistantOutcome(input: {
  conversationId: string;
  question: string;
  userId: string;
  currentUserMessageId: string;
  onEvent?: (event: string, data: unknown) => Promise<void>;
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
  const captureOnEvent = async (event: string, data: unknown) => {
    if (event === 'tool_result') {
      const payload = data as { name?: string; ok?: boolean; sourceBooks?: string[] };
      // Require explicit ok === true. Absence-of-failure (ok undefined) is
      // NOT the same as success — a future tool event that forgets to set
      // ok would silently leak a failed source into the footer otherwise.
      if (payload.ok === true) {
        if (payload.sourceBooks && payload.sourceBooks.length > 0) {
          // search_rules: store the actual book labels (ToolSourceLabel strings)
          // so the replay path renders the right books without a mapping step.
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
        captureOnEvent,
        {
          // Retry transient transport errors ONLY on the non-streaming path.
          // On SSE the client has already seen a partial stream; silently
          // restarting would mix two runs into one DOM update.
          retryOnTransportError: input.onEvent === undefined,
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
}): Promise<PendingConversationTurn> {
  return createConversationTurn(input);
}

export async function createPendingFollowUp(input: {
  conversationId: string;
  userId: string;
  question: string;
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
  onEvent: (event: string, data: unknown) => Promise<void>;
  failureMessage?: string;
}): Promise<ConversationMessage> {
  return persistAssistantOutcome({
    conversationId: input.conversationId,
    question: input.question,
    userId: input.userId,
    currentUserMessageId: input.currentUserMessageId,
    onEvent: input.onEvent,
    failureMessage: input.failureMessage,
  });
}

export async function startConversation(input: {
  userId: string;
  question: string;
  idempotencyKey: string;
}): Promise<Conversation> {
  const result = await createConversationTurn(input);
  if (result.currentUserMessage) {
    await persistAssistantOutcome({
      conversationId: result.conversation.id,
      question: result.currentUserMessage.content,
      userId: input.userId,
      currentUserMessageId: result.currentUserMessage.id,
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
}): Promise<Conversation | null> {
  const result = await createPendingFollowUp(input);
  if (!result?.currentUserMessage) return null;

  await persistAssistantOutcome({
    conversationId: input.conversationId,
    question: input.question,
    userId: input.userId,
    currentUserMessageId: result.currentUserMessage.id,
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
}): Promise<{ conversation: Conversation; messages: ConversationMessage[] } | null> {
  const conversation = await ConversationRepository.findOwnedById(
    input.userId,
    input.conversationId,
  );
  if (!conversation) return null;

  const messages = await MessageRepository.listByConversationId(conversation.id, {
    includeErrors: true,
  });

  return { conversation, messages };
}

export async function loadSelectedConversation(input: {
  conversationId: string;
  messageId: string;
  userId: string;
}): Promise<SelectedConversationProjection | null> {
  const loaded = await loadConversation({
    conversationId: input.conversationId,
    userId: input.userId,
  });
  if (!loaded) return null;

  const completedTurns = listCompletedTurns(loaded.messages);

  const selectedIndex = completedTurns.findIndex((turn) => turn.userMessage.id === input.messageId);
  if (selectedIndex === -1) return null;

  const selectedTurn = completedTurns[selectedIndex]!;
  const userMessages = loaded.messages.filter((message) => message.role === 'user');
  const latestUserMessage = userMessages.at(-1);
  const recentQuestions = listRecentCompletedQuestions(loaded.messages, {
    excludeMessageId: input.messageId,
  });

  return {
    conversation: loaded.conversation,
    selectedTurn: {
      userMessage: selectedTurn.userMessage,
      assistantMessage: selectedTurn.assistantMessage,
      isEarlierQuestion: latestUserMessage?.id !== selectedTurn.userMessage.id,
    },
    recentQuestions,
  };
}
