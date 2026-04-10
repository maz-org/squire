import { ask, type HistoryMessage } from '../service.ts';
import { getDb } from '../db.ts';
import * as ConversationRepository from '../db/repositories/conversation-repository.ts';
import * as MessageRepository from '../db/repositories/message-repository.ts';
import type { Conversation, ConversationMessage } from '../db/repositories/types.ts';

const HISTORY_LIMIT = 20;

export const GENERIC_FAILURE_MESSAGE =
  "I hit an error and couldn't answer that. Please try again.";

function isRetryableTransportError(err: unknown): boolean {
  const error = err as { code?: string; cause?: { code?: string }; name?: string; message?: string };
  const code = error.code ?? error.cause?.code;
  if (code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code)) {
    return true;
  }

  return error.name === 'AbortError' || /network|socket|timed out/i.test(error.message ?? '');
}

function toHistory(messages: ConversationMessage[]): HistoryMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

async function generateAssistantReply(question: string, history: HistoryMessage[], userId: string) {
  try {
    return await ask(question, {
      history,
      userId,
    });
  } catch (err) {
    if (!isRetryableTransportError(err)) {
      throw err;
    }

    return ask(question, {
      history,
      userId,
    });
  }
}

async function persistAssistantOutcome(input: {
  conversationId: string;
  question: string;
  userId: string;
  currentUserMessageId: string;
}): Promise<void> {
  const priorMessages = await MessageRepository.listByConversationId(input.conversationId, {
    includeErrors: false,
    limit: HISTORY_LIMIT + 1,
  });
  const history = toHistory(priorMessages.filter((message) => message.id !== input.currentUserMessageId));

  try {
    const answer = await generateAssistantReply(input.question, history, input.userId);
    await getDb('server').db.transaction(async (tx) => {
      const assistantMessage = await MessageRepository.create(tx, {
        conversationId: input.conversationId,
        role: 'assistant',
        content: answer,
      });
      await ConversationRepository.touchLastMessageAt(tx, input.conversationId, assistantMessage.createdAt);
    });
  } catch (err) {
    console.error('[conversation] ask failed:', err instanceof Error ? err.message : err);
    await getDb('server').db.transaction(async (tx) => {
      const failureMessage = await MessageRepository.create(tx, {
        conversationId: input.conversationId,
        role: 'assistant',
        content: GENERIC_FAILURE_MESSAGE,
        isError: true,
      });
      await ConversationRepository.touchLastMessageAt(tx, input.conversationId, failureMessage.createdAt);
    });
  }
}

export async function startConversation(input: {
  userId: string;
  question: string;
  idempotencyKey: string;
}): Promise<Conversation> {
  const result = await getDb('server').db.transaction(async (tx) => {
    const existingOrCreated = await ConversationRepository.getOrCreateByIdempotencyKey(tx, {
      userId: input.userId,
      creationIdempotencyKey: input.idempotencyKey,
    });

    if (!existingOrCreated.created) {
      return { conversation: existingOrCreated.conversation, currentUserMessageId: null, created: false };
    }

    const userMessage = await MessageRepository.create(tx, {
      conversationId: existingOrCreated.conversation.id,
      role: 'user',
      content: input.question,
    });
    await ConversationRepository.touchLastMessageAt(tx, existingOrCreated.conversation.id, userMessage.createdAt);
    return {
      conversation: existingOrCreated.conversation,
      currentUserMessageId: userMessage.id,
      created: true,
    };
  });

  if (result.created && result.currentUserMessageId) {
    await persistAssistantOutcome({
      conversationId: result.conversation.id,
      question: input.question,
      userId: input.userId,
      currentUserMessageId: result.currentUserMessageId,
    });
  }

  return result.conversation;
}

export async function appendMessage(input: {
  conversationId: string;
  userId: string;
  question: string;
}): Promise<Conversation | null> {
  const conversation = await ConversationRepository.findOwnedById(input.userId, input.conversationId);
  if (!conversation) return null;

  const result = await getDb('server').db.transaction(async (tx) => {
    const userMessage = await MessageRepository.create(tx, {
      conversationId: input.conversationId,
      role: 'user',
      content: input.question,
    });
    await ConversationRepository.touchLastMessageAt(tx, input.conversationId, userMessage.createdAt);
    return userMessage;
  });

  await persistAssistantOutcome({
    conversationId: input.conversationId,
    question: input.question,
    userId: input.userId,
    currentUserMessageId: result.id,
  });

  return conversation;
}

export async function loadConversation(input: {
  conversationId: string;
  userId: string;
}): Promise<{ conversation: Conversation; messages: ConversationMessage[] } | null> {
  const conversation = await ConversationRepository.findOwnedById(input.userId, input.conversationId);
  if (!conversation) return null;

  const messages = await MessageRepository.listByConversationId(conversation.id, {
    includeErrors: true,
  });

  return { conversation, messages };
}
