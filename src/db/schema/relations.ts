import { defineRelations } from 'drizzle-orm/relations';

import * as auth from './auth.ts';
import * as cards from './cards.ts';
import * as conversations from './conversations.ts';
import * as core from './core.ts';

const schema = {
  ...core,
  ...auth,
  ...cards,
  ...conversations,
};

export const relations = defineRelations(schema, (r) => ({
  users: {
    sessions: r.many.sessions({
      from: r.users.id,
      to: r.sessions.userId,
    }),
    conversations: r.many.conversations({
      from: r.users.id,
      to: r.conversations.userId,
    }),
  },
  sessions: {
    user: r.one.users({
      from: r.sessions.userId,
      to: r.users.id,
    }),
  },
  conversations: {
    user: r.one.users({
      from: r.conversations.userId,
      to: r.users.id,
    }),
    messages: r.many.messages({
      from: r.conversations.id,
      to: r.messages.conversationId,
    }),
  },
  messages: {
    conversation: r.one.conversations({
      from: r.messages.conversationId,
      to: r.conversations.id,
    }),
    responseToMessage: r.one.messages({
      from: r.messages.responseToMessageId,
      to: r.messages.id,
    }),
  },
}));
