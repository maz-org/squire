/**
 * OAuth 2.1 schema: replaces the in-memory `Map`s in `src/auth.ts`.
 *
 * Token / authorization-code rows use **the SHA-256 hex of the secret** as the
 * primary key — the raw secret never lives in the database. Tokens are
 * long-lived (30-day default) by deliberate DX choice for MCP / API clients;
 * see SECURITY.md §2 and the `feedback_long_lived_tokens` memory.
 *
 * `user_id` is nullable on tokens / codes / audit log entries: until the User
 * Accounts project wires Google consent, all tokens are unattached.
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './core.ts';

export const oauthClients = pgTable('oauth_clients', {
  clientId: uuid('client_id').primaryKey().defaultRandom(),
  clientIdIssuedAt: timestamp('client_id_issued_at', { withTimezone: true }).notNull().defaultNow(),
  redirectUris: text('redirect_uris').array().notNull(),
  clientName: text('client_name'),
  grantTypes: text('grant_types').array(),
  responseTypes: text('response_types').array(),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
  scope: text('scope'),
});

export const oauthAuthorizationCodes = pgTable(
  'oauth_authorization_codes',
  {
    // SHA-256 hex of the authorization code; the raw code is only ever in flight.
    codeHash: text('code_hash').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    // Nullable until User Accounts wires consent.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
    scope: text('scope'),
    state: text('state'),
    // 60-second expiry — set at insert time as createdAt + 60s.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('oauth_auth_codes_expires_idx').on(t.expiresAt)],
);

export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    // SHA-256 hex of the access token; raw token is only ever in flight.
    tokenHash: text('token_hash').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope'),
    // Long-lived (30-day default) per SECURITY.md §2 and the
    // `feedback_long_lived_tokens` memory. Do NOT introduce 15-min access tokens
    // with refresh rotation without an explicit threat-model change.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    index('oauth_tokens_client_idx').on(t.clientId),
    index('oauth_tokens_user_idx').on(t.userId),
    index('oauth_tokens_expires_idx').on(t.expiresAt),
  ],
);

export const oauthAuditLog = pgTable(
  'oauth_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 'register' | 'authorize' | 'token_issue' | 'token_verify' |
    // 'token_revoke' | 'token_expired' | 'code_exchange'
    eventType: text('event_type').notNull(),
    // SET NULL on client/user delete — keep the audit row, lose the FK.
    clientId: uuid('client_id').references(() => oauthClients.clientId, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    outcome: text('outcome').notNull(), // 'success' | 'failure'
    failureReason: text('failure_reason'), // short machine-readable code
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('oauth_audit_client_idx').on(t.clientId),
    index('oauth_audit_user_idx').on(t.userId),
    index('oauth_audit_created_idx').on(t.createdAt),
  ],
);
