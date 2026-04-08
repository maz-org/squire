/**
 * OAuth 2.1 facade — thin wrapper around {@link SquireOAuthProvider}.
 *
 * Phase 1 of the storage migration (SQR-68) ported all OAuth state into
 * Postgres via {@link SquireOAuthProvider}. This file used to hold the
 * in-memory `Map` state that prompted the IRON RULE incident: tokens were
 * lost on every process restart because the maps lived only in heap.
 *
 * Now this module is a tiny adapter that:
 *
 * 1. Lazily constructs a single {@link SquireOAuthProvider} bound to the
 *    server-mode Drizzle pool from {@link getDb}. Tests that tear the pool
 *    down call {@link resetAuthProvider} so the next call rehydrates against
 *    a fresh handle.
 * 2. Translates the loose `Record<string, unknown>` shape coming from the
 *    `/register` HTTP handler into the SDK's `OAuthClientInformationFull`
 *    shape — the only place that performs that translation lives here.
 * 3. Exposes async wrapper functions matching the call sites in
 *    `src/server.ts` and `test/mcp-transport.test.ts`. Wrappers stay thin so
 *    we don't grow a second source of truth for OAuth semantics — anything
 *    interesting happens in the provider.
 *
 * The provider is the only owner of OAuth state. There are no `new Map(...)`
 * caches in this file by design — see SECURITY.md §2 and the SQR-69 issue
 * for the IRON RULE rationale.
 */

import {
  InvalidRequestError,
  InvalidTokenError,
  OAuthError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { SquireOAuthProvider } from './auth/provider.ts';
import { getDb } from './db.ts';

let provider: SquireOAuthProvider | null = null;

/**
 * Lazily build (or return) the singleton provider bound to the server-mode
 * Drizzle pool. Lazy because importing this module under tests must not
 * eagerly open a Postgres connection at module-load time.
 */
export function getAuthProvider(): SquireOAuthProvider {
  if (!provider) {
    const { db } = getDb('server');
    provider = new SquireOAuthProvider(db);
  }
  return provider;
}

/**
 * Discard the cached provider so the next `getAuthProvider()` call rebuilds
 * against a fresh `getDb('server')` handle. Used by the restart regression
 * test, which tears down the server pool to simulate process exit.
 */
export function resetAuthProvider(): void {
  provider = null;
}

/**
 * Validate `redirect_uris` from a raw client registration body. The store
 * itself trusts that the SDK schema parsed the input — we don't have that
 * parser yet on the `/register` HTTP path, so the check lives here.
 */
function coerceRegistrationMetadata(
  metadata: Record<string, unknown>,
): Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'> {
  const redirectUris = metadata.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    throw new InvalidRequestError('redirect_uris is required and must be a non-empty array');
  }
  if (!redirectUris.every((uri) => typeof uri === 'string' && uri.length > 0)) {
    throw new InvalidRequestError('redirect_uris must contain only non-empty strings');
  }
  return {
    redirect_uris: redirectUris as [string, ...string[]],
    client_name: metadata.client_name as string | undefined,
    grant_types: metadata.grant_types as string[] | undefined,
    response_types: metadata.response_types as string[] | undefined,
    token_endpoint_auth_method: metadata.token_endpoint_auth_method as string | undefined,
    scope: metadata.scope as string | undefined,
  } as Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>;
}

/**
 * Register a new OAuth client. Returns the SDK-shaped client record (the
 * same shape the `/register` endpoint serializes to JSON).
 */
export async function registerClient(
  metadata: Record<string, unknown>,
): Promise<OAuthClientInformationFull> {
  const coerced = coerceRegistrationMetadata(metadata);
  return getAuthProvider().clientsStore.registerClient(coerced);
}

/**
 * Issue an authorization code for `clientId` after exact-match-validating
 * `redirectUri` against the client's registered URIs. PKCE method is fixed
 * to S256 — see {@link SquireOAuthProvider.createAuthorizationCode}.
 */
export async function createAuthorizationCode(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state?: string,
): Promise<{ code: string }> {
  const p = getAuthProvider();
  const client = await p.clientsStore.getClient(clientId);
  if (!client) throw new InvalidRequestError('Unknown client_id');
  const { code } = await p.createAuthorizationCode({
    client,
    redirectUri,
    codeChallenge,
    codeChallengeMethod: 'S256',
    state,
  });
  return { code };
}

/**
 * Exchange an authorization code for an access token. Returns the SDK
 * `OAuthTokens` shape directly — `/token` serializes it as-is.
 */
export async function exchangeAuthorizationCode(
  code: string,
  clientId: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const p = getAuthProvider();
  const client = await p.clientsStore.getClient(clientId);
  if (!client) throw new InvalidRequestError('Unknown client_id');
  return p.exchangeAuthorizationCode(client, code, codeVerifier, redirectUri);
}

/**
 * Verify a bearer token. Returns `AuthInfo` on success and `undefined` on
 * any auth failure (`InvalidTokenError`); other errors propagate. The bearer
 * middleware in `src/server.ts` only needs the present/absent distinction,
 * so flattening the SDK exception keeps the call site simple.
 */
export async function verifyAccessToken(token: string): Promise<AuthInfo | undefined> {
  try {
    return await getAuthProvider().verifyAccessToken(token);
  } catch (err) {
    if (err instanceof InvalidTokenError) return undefined;
    throw err;
  }
}

/** Re-export so server.ts can `instanceof`-check without reaching into the SDK. */
export { OAuthError };
