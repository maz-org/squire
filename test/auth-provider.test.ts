/**
 * Integration tests for the Drizzle-backed OAuth provider (SQR-68).
 *
 * All tests run against the test DB via `test/helpers/db.ts`. No mocks.
 *
 * Coverage target: the diagram in the SQR-50 plan-eng-review.
 * - Happy paths with audit rows
 * - Failure paths with `outcome=failure` audit rows + machine-readable reasons
 * - Hashing-at-rest invariant (raw secret never appears in the DB)
 * - 60s auth code expiry regression (the pre-existing bug)
 * - `last_used_at` bumped on verify
 * - One-time auth code use
 * - PKCE S256 verification
 * - Exact-match redirect URI validation
 * - Long-lived (30-day) token default
 */
import { createHash } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError,
  UnsupportedGrantTypeError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';

import { oauthAuditLog, oauthAuthorizationCodes, oauthTokens } from '../src/db/schema/auth.ts';
import {
  AUTHORIZATION_CODE_LIFETIME_SECONDS,
  DEFAULT_TOKEN_LIFETIME_SECONDS,
  SquireOAuthProvider,
} from '../src/auth/provider.ts';

import { setupTestDb, resetTestDb, teardownTestDb } from './helpers/db.ts';

let db: Awaited<ReturnType<typeof setupTestDb>>;
let provider: SquireOAuthProvider;

beforeAll(async () => {
  db = await setupTestDb();
  provider = new SquireOAuthProvider(db);
});

beforeEach(async () => {
  await resetTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

/**
 * Build a PKCE S256 challenge for a given verifier, matching the provider's
 * verification logic exactly.
 */
function pkce(verifier: string) {
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function registerTestClient(redirectUris = ['https://example.com/cb']) {
  return provider.clientsStore.registerClient({
    redirect_uris: redirectUris,
    client_name: 'Test Client',
  });
}

async function auditRowsOrdered() {
  return db.select().from(oauthAuditLog).orderBy(oauthAuditLog.createdAt);
}

describe('DrizzleClientsStore.registerClient', () => {
  it('persists a client and returns SDK-shaped data', async () => {
    const client = await provider.clientsStore.registerClient({
      redirect_uris: ['https://example.com/cb'],
      client_name: 'My App',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: 'squire:read',
    });

    expect(client.client_id).toBeTruthy();
    expect(client.client_id_issued_at).toBeGreaterThan(0);
    expect(client.redirect_uris).toEqual(['https://example.com/cb']);
    expect(client.client_name).toBe('My App');
    expect(client.scope).toBe('squire:read');

    // Round-trip via getClient.
    const fetched = await provider.clientsStore.getClient(client.client_id);
    expect(fetched?.client_id).toBe(client.client_id);
  });

  it('writes a register audit row in the same transaction', async () => {
    const client = await registerTestClient();
    const rows = await auditRowsOrdered();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'register',
      clientId: client.client_id,
      outcome: 'success',
    });
    expect(rows[0].metadata).toMatchObject({ redirect_uris_count: 1 });
  });
});

describe('SquireOAuthProvider.createAuthorizationCode', () => {
  it('issues a code, stores only the hash, and writes an audit row', async () => {
    const client = await registerTestClient();
    const { challenge } = pkce('verifier-1234567890-1234567890-1234567890-1234567890');

    const { code, expiresAt } = await provider.createAuthorizationCode({
      client,
      redirectUri: 'https://example.com/cb',
      codeChallenge: challenge,
      scope: 'squire:read',
      state: 'opaque-state',
    });

    expect(code).toBeTruthy();
    // 60-second expiry window.
    const delta = expiresAt.getTime() - Date.now();
    expect(delta).toBeLessThanOrEqual(AUTHORIZATION_CODE_LIFETIME_SECONDS * 1000 + 500);
    expect(delta).toBeGreaterThan(0);

    // Raw code is NOT persisted.
    const storedRows = await db.select().from(oauthAuthorizationCodes);
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0].codeHash).not.toBe(code);
    expect(Object.values(storedRows[0]).some((v) => typeof v === 'string' && v === code)).toBe(
      false,
    );

    // Audit row for successful authorize.
    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'authorize',
      clientId: client.client_id,
      outcome: 'success',
    });
  });

  it('rejects unknown redirect URIs (exact match, no substring)', async () => {
    const client = await registerTestClient(['https://example.com/cb']);
    const { challenge } = pkce('v'.repeat(64));

    await expect(
      provider.createAuthorizationCode({
        client,
        redirectUri: 'https://example.com/cb/extra',
        codeChallenge: challenge,
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);

    // No auth-code row, but a failure audit row exists.
    expect(await db.select().from(oauthAuthorizationCodes)).toHaveLength(0);
    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'authorize',
      outcome: 'failure',
      failureReason: 'invalid_redirect_uri',
    });
  });

  it('rejects non-S256 code challenge methods', async () => {
    const client = await registerTestClient();
    await expect(
      provider.createAuthorizationCode({
        client,
        redirectUri: 'https://example.com/cb',
        codeChallenge: 'plain-challenge',
        codeChallengeMethod: 'plain',
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);

    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'authorize',
      outcome: 'failure',
      failureReason: 'unsupported_code_challenge_method',
    });
  });
});

describe('SquireOAuthProvider.exchangeAuthorizationCode', () => {
  async function walkToCode(verifier = 'verifier-ultra-long-' + 'x'.repeat(60)) {
    const client = await registerTestClient();
    const { challenge } = pkce(verifier);
    const { code } = await provider.createAuthorizationCode({
      client,
      redirectUri: 'https://example.com/cb',
      codeChallenge: challenge,
      scope: 'squire:read',
    });
    return { client, code, verifier };
  }

  it('exchanges a code for a long-lived token; hashes the token at rest', async () => {
    const { client, code, verifier } = await walkToCode();

    const tokens = await provider.exchangeAuthorizationCode(
      client,
      code,
      verifier,
      'https://example.com/cb',
    );

    expect(tokens.access_token).toBeTruthy();
    expect(tokens.token_type).toBe('bearer');
    expect(tokens.expires_in).toBe(DEFAULT_TOKEN_LIFETIME_SECONDS);
    expect(tokens.scope).toBe('squire:read');
    // No refresh_token — long-lived tokens.
    expect(tokens).not.toHaveProperty('refresh_token');

    // Hashing invariant: raw token never appears in oauth_tokens.
    const tokenRows = await db.select().from(oauthTokens);
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0].tokenHash).not.toBe(tokens.access_token);
    const stringVals = Object.values(tokenRows[0]).filter(
      (v): v is string => typeof v === 'string',
    );
    expect(stringVals).not.toContain(tokens.access_token);

    // Code consumed.
    expect(await db.select().from(oauthAuthorizationCodes)).toHaveLength(0);

    // Audit rows: authorize, register, code_exchange success, token_issue success.
    const audit = await auditRowsOrdered();
    const types = audit.map((r) => ({ t: r.eventType, o: r.outcome }));
    expect(types).toEqual(
      expect.arrayContaining([
        { t: 'register', o: 'success' },
        { t: 'authorize', o: 'success' },
        { t: 'code_exchange', o: 'success' },
        { t: 'token_issue', o: 'success' },
      ]),
    );
  });

  it('rejects reuse of a consumed authorization code (one-time use)', async () => {
    const { client, code, verifier } = await walkToCode();
    await provider.exchangeAuthorizationCode(client, code, verifier, 'https://example.com/cb');

    await expect(
      provider.exchangeAuthorizationCode(client, code, verifier, 'https://example.com/cb'),
    ).rejects.toBeInstanceOf(InvalidGrantError);

    const audit = await auditRowsOrdered();
    expect(
      audit.filter((r) => r.eventType === 'code_exchange' && r.outcome === 'failure'),
    ).toHaveLength(1);
  });

  it('rejects an expired authorization code (60s regression — pre-existing bug)', async () => {
    const { client, code, verifier } = await walkToCode();

    // Force the code to have expired already.
    const { hashSecret } = await import('../src/auth/hashing.ts');
    await db
      .update(oauthAuthorizationCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthAuthorizationCodes.codeHash, hashSecret(code)));

    await expect(
      provider.exchangeAuthorizationCode(client, code, verifier, 'https://example.com/cb'),
    ).rejects.toBeInstanceOf(InvalidGrantError);

    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'code_exchange',
      outcome: 'failure',
      failureReason: 'invalid_or_expired_code',
    });
  });

  it('rejects a code_verifier that does not match the stored challenge', async () => {
    const { client, code } = await walkToCode('verifier-A-' + 'a'.repeat(60));

    await expect(
      provider.exchangeAuthorizationCode(
        client,
        code,
        'verifier-B-' + 'b'.repeat(60),
        'https://example.com/cb',
      ),
    ).rejects.toBeInstanceOf(InvalidGrantError);

    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'code_exchange',
      outcome: 'failure',
      failureReason: 'pkce_mismatch',
    });
  });

  it('rejects a missing code_verifier', async () => {
    const { client, code } = await walkToCode();
    await expect(
      provider.exchangeAuthorizationCode(client, code, undefined, 'https://example.com/cb'),
    ).rejects.toBeInstanceOf(InvalidRequestError);

    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'code_exchange',
      outcome: 'failure',
      failureReason: 'missing_code_verifier',
    });
  });

  it('rejects a code issued to a different client', async () => {
    const { code, verifier } = await walkToCode();
    const otherClient = await provider.clientsStore.registerClient({
      redirect_uris: ['https://other.example.com/cb'],
    });

    await expect(
      provider.exchangeAuthorizationCode(otherClient, code, verifier, 'https://example.com/cb'),
    ).rejects.toBeInstanceOf(InvalidGrantError);

    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'code_exchange',
      outcome: 'failure',
      failureReason: 'client_id_mismatch',
    });
  });

  it('rejects a redirect_uri that differs from the one in the authorization request', async () => {
    const { client, code, verifier } = await walkToCode();
    await expect(
      provider.exchangeAuthorizationCode(client, code, verifier, 'https://example.com/different'),
    ).rejects.toBeInstanceOf(InvalidGrantError);

    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'code_exchange',
      outcome: 'failure',
      failureReason: 'redirect_uri_mismatch',
    });
  });
});

describe('SquireOAuthProvider.verifyAccessToken', () => {
  async function issueToken() {
    const client = await registerTestClient();
    const { verifier, challenge } = pkce('v-' + 'x'.repeat(60));
    const { code } = await provider.createAuthorizationCode({
      client,
      redirectUri: 'https://example.com/cb',
      codeChallenge: challenge,
    });
    const tokens = await provider.exchangeAuthorizationCode(
      client,
      code,
      verifier,
      'https://example.com/cb',
    );
    return { client, token: tokens.access_token };
  }

  it('returns AuthInfo for a live token and bumps last_used_at', async () => {
    const { client, token } = await issueToken();

    const info = await provider.verifyAccessToken(token);
    expect(info.token).toBe(token);
    expect(info.clientId).toBe(client.client_id);

    const { hashSecret } = await import('../src/auth/hashing.ts');
    const [row] = await db
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.tokenHash, hashSecret(token)));
    expect(row.lastUsedAt).not.toBeNull();
    expect(row.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());

    // Successful verify audit row.
    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'token_verify',
      clientId: client.client_id,
      outcome: 'success',
    });
  });

  it('rejects an unknown token with a verify/unknown_token failure row', async () => {
    await expect(provider.verifyAccessToken('no-such-token')).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'token_verify',
      outcome: 'failure',
      failureReason: 'unknown_token',
    });
  });

  it('rejects an expired token with a token_expired audit row', async () => {
    const { client, token } = await issueToken();
    const { hashSecret } = await import('../src/auth/hashing.ts');
    await db
      .update(oauthTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthTokens.tokenHash, hashSecret(token)));

    await expect(provider.verifyAccessToken(token)).rejects.toBeInstanceOf(InvalidTokenError);

    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'token_expired',
      clientId: client.client_id,
      outcome: 'failure',
      failureReason: 'expired',
    });
  });
});

describe('SquireOAuthProvider.revokeToken', () => {
  it('deletes the token and writes a revoke audit row', async () => {
    const client = await registerTestClient();
    const { verifier, challenge } = pkce('v-' + 'x'.repeat(60));
    const { code } = await provider.createAuthorizationCode({
      client,
      redirectUri: 'https://example.com/cb',
      codeChallenge: challenge,
    });
    const tokens = await provider.exchangeAuthorizationCode(
      client,
      code,
      verifier,
      'https://example.com/cb',
    );

    await provider.revokeToken(client, { token: tokens.access_token });

    expect(await db.select().from(oauthTokens)).toHaveLength(0);

    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );

    const audit = await auditRowsOrdered();
    expect(
      audit.find((r) => r.eventType === 'token_revoke' && r.outcome === 'success'),
    ).toBeTruthy();
  });

  it('logs a failure audit row for an unknown token', async () => {
    const client = await registerTestClient();
    await provider.revokeToken(client, { token: 'never-issued' });
    const audit = await auditRowsOrdered();
    expect(audit.at(-1)).toMatchObject({
      eventType: 'token_revoke',
      outcome: 'failure',
      failureReason: 'unknown_token',
    });
  });
});

describe('SquireOAuthProvider.exchangeRefreshToken', () => {
  it('throws UnsupportedGrantTypeError — long-lived tokens, no refresh', async () => {
    await expect(provider.exchangeRefreshToken()).rejects.toBeInstanceOf(UnsupportedGrantTypeError);
  });
});

describe('Hashing-at-rest invariant (SQL grep)', () => {
  it('never persists the raw token or authorization code anywhere', async () => {
    const client = await registerTestClient();
    const { verifier, challenge } = pkce('v-' + 'x'.repeat(60));
    const { code } = await provider.createAuthorizationCode({
      client,
      redirectUri: 'https://example.com/cb',
      codeChallenge: challenge,
    });
    const tokens = await provider.exchangeAuthorizationCode(
      client,
      code,
      verifier,
      'https://example.com/cb',
    );

    // Re-issue a code we don't consume so the auth_codes table is also non-empty.
    const { code: unconsumedCode } = await provider.createAuthorizationCode({
      client,
      redirectUri: 'https://example.com/cb',
      codeChallenge: challenge,
    });

    // Cast every column of both tables to text and LIKE-grep for the raw secrets.
    const tokenHits = await db.execute<{ hits: string }>(
      sql`SELECT COUNT(*)::text AS hits FROM oauth_tokens
          WHERE oauth_tokens::text LIKE ${'%' + tokens.access_token + '%'}`,
    );
    expect(Number(tokenHits.rows[0].hits)).toBe(0);

    const codeHits = await db.execute<{ hits: string }>(
      sql`SELECT COUNT(*)::text AS hits FROM oauth_authorization_codes
          WHERE oauth_authorization_codes::text LIKE ${'%' + unconsumedCode + '%'}`,
    );
    expect(Number(codeHits.rows[0].hits)).toBe(0);
  });
});

describe('Long-lived token default', () => {
  it('persists ~30 days between created_at and expires_at', async () => {
    const client = await registerTestClient();
    const { verifier, challenge } = pkce('v-' + 'x'.repeat(60));
    const { code } = await provider.createAuthorizationCode({
      client,
      redirectUri: 'https://example.com/cb',
      codeChallenge: challenge,
    });
    await provider.exchangeAuthorizationCode(client, code, verifier, 'https://example.com/cb');

    const [row] = await db.select().from(oauthTokens);
    const lifetimeSec = (row.expiresAt.getTime() - row.createdAt.getTime()) / 1000;
    // Allow ±2s for DB round-trip.
    expect(lifetimeSec).toBeGreaterThanOrEqual(DEFAULT_TOKEN_LIFETIME_SECONDS - 2);
    expect(lifetimeSec).toBeLessThanOrEqual(DEFAULT_TOKEN_LIFETIME_SECONDS + 2);
  });
});

// Silence unused-imports lint on the `and` import when tests evolve.
void and;
