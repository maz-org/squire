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
    oauthAuthorizationCodes: r.many.oauthAuthorizationCodes({
      from: r.users.id,
      to: r.oauthAuthorizationCodes.userId,
    }),
    oauthTokens: r.many.oauthTokens({
      from: r.users.id,
      to: r.oauthTokens.userId,
    }),
    oauthAuditLog: r.many.oauthAuditLog({
      from: r.users.id,
      to: r.oauthAuditLog.userId,
    }),
  },
  sessions: {
    user: r.one.users({
      from: r.sessions.userId,
      to: r.users.id,
    }),
  },
  oauthClients: {
    oauthAuthorizationCodes: r.many.oauthAuthorizationCodes({
      from: r.oauthClients.clientId,
      to: r.oauthAuthorizationCodes.clientId,
    }),
    oauthTokens: r.many.oauthTokens({
      from: r.oauthClients.clientId,
      to: r.oauthTokens.clientId,
    }),
    oauthAuditLog: r.many.oauthAuditLog({
      from: r.oauthClients.clientId,
      to: r.oauthAuditLog.clientId,
    }),
  },
  oauthAuthorizationCodes: {
    user: r.one.users({
      from: r.oauthAuthorizationCodes.userId,
      to: r.users.id,
    }),
    client: r.one.oauthClients({
      from: r.oauthAuthorizationCodes.clientId,
      to: r.oauthClients.clientId,
    }),
  },
  oauthTokens: {
    user: r.one.users({
      from: r.oauthTokens.userId,
      to: r.users.id,
    }),
    client: r.one.oauthClients({
      from: r.oauthTokens.clientId,
      to: r.oauthClients.clientId,
    }),
  },
  oauthAuditLog: {
    user: r.one.users({
      from: r.oauthAuditLog.userId,
      to: r.users.id,
    }),
    client: r.one.oauthClients({
      from: r.oauthAuditLog.clientId,
      to: r.oauthClients.clientId,
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
