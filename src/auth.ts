/**
 * OAuth 2.1 auth module.
 * Client registration, token issuance, and bearer auth middleware.
 */

import { randomUUID } from 'node:crypto';

// ─── Client store ────────────────────────────────────────────────────────────

export interface RegisteredClient {
  client_id: string;
  client_id_issued_at: number;
  redirect_uris: string[];
  client_name?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
}

const clients = new Map<string, RegisteredClient>();

export function getClient(clientId: string): RegisteredClient | undefined {
  return clients.get(clientId);
}

/**
 * Register a new OAuth client. Returns the full client record.
 * Throws if redirect_uris is missing or empty.
 */
export function registerClient(metadata: Record<string, unknown>): RegisteredClient {
  const redirectUris = metadata.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    throw new Error('redirect_uris is required and must be a non-empty array');
  }
  if (!redirectUris.every((uri) => typeof uri === 'string' && uri.length > 0)) {
    throw new Error('redirect_uris must contain only non-empty strings');
  }

  const client: RegisteredClient = {
    client_id: randomUUID(),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris as string[],
    client_name: metadata.client_name as string | undefined,
    grant_types: metadata.grant_types as string[] | undefined,
    response_types: metadata.response_types as string[] | undefined,
    token_endpoint_auth_method: metadata.token_endpoint_auth_method as string | undefined,
    scope: metadata.scope as string | undefined,
  };

  clients.set(client.client_id, client);
  return client;
}

/** @internal Reset client store for testing. */
export function _resetClientsForTesting(): void {
  clients.clear();
}
