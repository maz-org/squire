/**
 * Squire OAuth 2.1 server provider — Drizzle-backed.
 *
 * Implements the framework-agnostic subset of the MCP SDK's
 * {@link import('@modelcontextprotocol/sdk/server/auth/provider.js').OAuthServerProvider}
 * interface:
 *
 * - `clientsStore` — via {@link DrizzleClientsStore}
 * - `challengeForAuthorizationCode`
 * - `exchangeAuthorizationCode`
 * - `verifyAccessToken`
 * - `revokeToken`
 * - `exchangeRefreshToken` — throws; long-lived tokens, no refresh rotation
 *   (see `feedback_long_lived_tokens` and `docs/SECURITY.md` §2)
 *
 * The SDK's `authorize()` method takes an Express `Response` and issues the
 * redirect itself, which couples it to Express. We replace it with a
 * framework-agnostic {@link SquireOAuthProvider.createAuthorizationCode}
 * that returns the raw authorization code. The Hono layer in SQR-69 is
 * responsible for the redirect — this keeps the provider portable.
 *
 * ─── Security invariants ─────────────────────────────────────────────────
 * 1. Raw secrets (tokens, auth codes) are never persisted. The primary key
 *    on both `oauth_tokens` and `oauth_authorization_codes` is the SHA-256
 *    hex of the secret. See `src/auth/hashing.ts`.
 * 2. Every auth mutation and its audit row run inside a single transaction.
 *    Either both land or neither does. See `src/auth/audit.ts`.
 * 3. Authorization codes expire 60 seconds after issue. Expiry is enforced
 *    in SQL (`WHERE expires_at > now()`), not in application code that can
 *    silently skew with clock drift. This fixes a pre-existing bug where
 *    `createdAt` was stored but never checked.
 * 4. Access tokens default to 30-day lifetime. `last_used_at` is bumped on
 *    every successful verify so the Production Readiness project can
 *    eventually expire idle tokens without grandfathering in stale state.
 * 5. Redirect-URI validation is exact-match, not prefix. No wildcards.
 * 6. PKCE S256 is the only supported code challenge method.
 */

import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError,
  UnsupportedGrantTypeError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';

import type { Db } from '../db.ts';
import { oauthAuthorizationCodes, oauthTokens } from '../db/schema/auth.ts';
import { hashSecret } from './hashing.ts';
import { writeAuditEvent, type AuditContext } from './audit.ts';
import { DrizzleClientsStore } from './clients-store.ts';

/** Default token lifetime: 30 days. See SECURITY.md §2 rationale. */
export const DEFAULT_TOKEN_LIFETIME_SECONDS = 30 * 24 * 3600;

/** Authorization code lifetime: 60 seconds per OAuth 2.1 recommendation. */
export const AUTHORIZATION_CODE_LIFETIME_SECONDS = 60;

/**
 * Internal sentinel used to tag failures inside a transaction so the outer
 * scope can write the corresponding audit row on the non-transactional
 * connection. Audit rows must survive rollback — if we write them on `tx`
 * they get rolled back along with the state change we're auditing.
 */
class AuditableOAuthError extends Error {
  constructor(
    readonly inner: Error,
    readonly failureReason: string,
  ) {
    super(inner.message);
  }
}

export interface CreateAuthorizationCodeParams {
  client: OAuthClientInformationFull;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod?: string; // defaults to S256; rejects anything else
  scope?: string;
  state?: string;
  userId?: string | null;
}

export interface CreateAuthorizationCodeResult {
  /** The raw authorization code. Only ever in flight. */
  code: string;
  /** Wall-clock moment at which this code expires. */
  expiresAt: Date;
}

/**
 * Verify a PKCE S256 code verifier against a stored code challenge.
 * BASE64URL(SHA-256(verifier)) must equal the challenge.
 */
function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const computed = Buffer.from(hashSecret(codeVerifier), 'hex').toString('base64url');
  return computed === codeChallenge;
}

export class SquireOAuthProvider {
  readonly clientsStore: DrizzleClientsStore;
  readonly tokenLifetimeSeconds: number;

  constructor(
    private readonly db: Db,
    options: { tokenLifetimeSeconds?: number } = {},
  ) {
    this.clientsStore = new DrizzleClientsStore(db);
    this.tokenLifetimeSeconds = options.tokenLifetimeSeconds ?? DEFAULT_TOKEN_LIFETIME_SECONDS;
  }

  // ─── Authorization code issuance ───────────────────────────────────────
  //
  // Framework-agnostic replacement for the SDK's Express-coupled
  // `authorize()`. Returns the raw code; the Hono layer issues the
  // browser redirect.

  async createAuthorizationCode(
    params: CreateAuthorizationCodeParams,
    context: AuditContext = {},
  ): Promise<CreateAuthorizationCodeResult> {
    const {
      client,
      redirectUri,
      codeChallenge,
      codeChallengeMethod = 'S256',
      scope,
      state,
      userId,
    } = params;

    // Exact-match redirect URI validation. No prefix, no substring.
    if (!client.redirect_uris.includes(redirectUri)) {
      await writeAuditEvent(this.db, {
        eventType: 'authorize',
        clientId: client.client_id,
        outcome: 'failure',
        failureReason: 'invalid_redirect_uri',
        ...context,
      });
      throw new InvalidRequestError('redirect_uri does not match registered URIs');
    }

    if (codeChallengeMethod !== 'S256') {
      await writeAuditEvent(this.db, {
        eventType: 'authorize',
        clientId: client.client_id,
        outcome: 'failure',
        failureReason: 'unsupported_code_challenge_method',
        ...context,
      });
      throw new InvalidRequestError('Only S256 PKCE code challenge method is supported');
    }

    const rawCode = randomUUID();
    const codeHash = hashSecret(rawCode);
    const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_LIFETIME_SECONDS * 1000);

    await this.db.transaction(async (tx) => {
      await tx.insert(oauthAuthorizationCodes).values({
        codeHash,
        clientId: client.client_id,
        userId: userId ?? null,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        scope: scope ?? null,
        state: state ?? null,
        expiresAt,
      });

      await writeAuditEvent(tx, {
        eventType: 'authorize',
        clientId: client.client_id,
        userId: userId ?? null,
        outcome: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { scope: scope ?? null },
      });
    });

    return { code: rawCode, expiresAt };
  }

  // ─── SDK interface: challengeForAuthorizationCode ──────────────────────

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const row = await this.findLiveAuthorizationCode(authorizationCode);
    if (!row || row.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    return row.codeChallenge;
  }

  // ─── SDK interface: exchangeAuthorizationCode ──────────────────────────

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
    _resource?: URL,
    context: AuditContext = {},
  ): Promise<OAuthTokens> {
    if (!codeVerifier) {
      await writeAuditEvent(this.db, {
        eventType: 'code_exchange',
        clientId: client.client_id,
        outcome: 'failure',
        failureReason: 'missing_code_verifier',
        ...context,
      });
      throw new InvalidRequestError('code_verifier is required');
    }

    const codeHash = hashSecret(authorizationCode);

    try {
      return await this.db.transaction(async (tx) => {
        // Consume the code atomically: DELETE … RETURNING guarantees single-use
        // and the `expires_at > now()` guard enforces the 60s lifetime in SQL,
        // closing the pre-existing bug where the old code checked nothing.
        // Validation failures below throw AuditableOAuthError, which rolls the
        // DELETE back (preserving the code for a legitimate retry) — the outer
        // catch then records the failure audit row on the non-transactional
        // connection so it survives the rollback.
        const [row] = await tx
          .delete(oauthAuthorizationCodes)
          .where(
            and(
              eq(oauthAuthorizationCodes.codeHash, codeHash),
              sql`${oauthAuthorizationCodes.expiresAt} > now()`,
            ),
          )
          .returning();

        if (!row) {
          throw new AuditableOAuthError(
            new InvalidGrantError('Invalid or expired authorization code'),
            'invalid_or_expired_code',
          );
        }

        if (row.clientId !== client.client_id) {
          throw new AuditableOAuthError(
            new InvalidGrantError('Authorization code was issued to a different client'),
            'client_id_mismatch',
          );
        }

        if (redirectUri !== undefined && row.redirectUri !== redirectUri) {
          throw new AuditableOAuthError(
            new InvalidGrantError('redirect_uri does not match the authorization request'),
            'redirect_uri_mismatch',
          );
        }

        if (!verifyPkceS256(codeVerifier, row.codeChallenge)) {
          throw new AuditableOAuthError(
            new InvalidGrantError('PKCE code_verifier does not match code_challenge'),
            'pkce_mismatch',
          );
        }

        // Issue the access token.
        const rawToken = randomUUID();
        const tokenHash = hashSecret(rawToken);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.tokenLifetimeSeconds * 1000);

        await tx.insert(oauthTokens).values({
          tokenHash,
          clientId: client.client_id,
          userId: row.userId,
          scope: row.scope,
          expiresAt,
          createdAt: now,
        });

        await writeAuditEvent(tx, {
          eventType: 'code_exchange',
          clientId: client.client_id,
          userId: row.userId,
          outcome: 'success',
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { scope: row.scope },
        });

        await writeAuditEvent(tx, {
          eventType: 'token_issue',
          clientId: client.client_id,
          userId: row.userId,
          outcome: 'success',
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return {
          access_token: rawToken,
          token_type: 'bearer',
          expires_in: this.tokenLifetimeSeconds,
          scope: row.scope ?? undefined,
        };
      });
    } catch (err) {
      if (err instanceof AuditableOAuthError) {
        // Audit row on the outer (non-transactional) connection so the
        // record survives the rollback triggered by `throw` above.
        await writeAuditEvent(this.db, {
          eventType: 'code_exchange',
          clientId: client.client_id,
          outcome: 'failure',
          failureReason: err.failureReason,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });
        throw err.inner;
      }
      throw err;
    }
  }

  // ─── SDK interface: verifyAccessToken ──────────────────────────────────

  async verifyAccessToken(token: string, context: AuditContext = {}): Promise<AuthInfo> {
    const tokenHash = hashSecret(token);

    // Bump last_used_at in the same UPDATE that validates expiry. If the
    // token is missing or expired, UPDATE … RETURNING yields no row and we
    // audit-log + throw. Single round-trip, no TOCTOU gap.
    const now = new Date();
    const [row] = await this.db
      .update(oauthTokens)
      .set({ lastUsedAt: now })
      .where(and(eq(oauthTokens.tokenHash, tokenHash), sql`${oauthTokens.expiresAt} > now()`))
      .returning();

    if (!row) {
      // Distinguish "missing" from "expired" by looking the row up without
      // the expiry guard. Only for the audit log — the error is the same.
      const [expiredRow] = await this.db
        .select({ expiresAt: oauthTokens.expiresAt, clientId: oauthTokens.clientId })
        .from(oauthTokens)
        .where(eq(oauthTokens.tokenHash, tokenHash))
        .limit(1);

      if (expiredRow) {
        await writeAuditEvent(this.db, {
          eventType: 'token_expired',
          clientId: expiredRow.clientId,
          outcome: 'failure',
          failureReason: 'expired',
          ...context,
        });
      } else {
        await writeAuditEvent(this.db, {
          eventType: 'token_verify',
          outcome: 'failure',
          failureReason: 'unknown_token',
          ...context,
        });
      }
      throw new InvalidTokenError('Invalid or expired access token');
    }

    await writeAuditEvent(this.db, {
      eventType: 'token_verify',
      clientId: row.clientId,
      userId: row.userId,
      outcome: 'success',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      token,
      clientId: row.clientId,
      scopes: row.scope ? row.scope.split(' ').filter(Boolean) : [],
      expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
    };
  }

  // ─── SDK interface: revokeToken ────────────────────────────────────────

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
    context: AuditContext = {},
  ): Promise<void> {
    const tokenHash = hashSecret(request.token);
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(oauthTokens)
        .where(
          and(eq(oauthTokens.tokenHash, tokenHash), eq(oauthTokens.clientId, client.client_id)),
        )
        .returning();

      await writeAuditEvent(tx, {
        eventType: 'token_revoke',
        clientId: client.client_id,
        userId: row?.userId ?? null,
        outcome: row ? 'success' : 'failure',
        failureReason: row ? null : 'unknown_token',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    });
  }

  // ─── SDK interface: exchangeRefreshToken ───────────────────────────────
  //
  // Not supported. Squire uses long-lived (30-day) access tokens without
  // refresh rotation as a deliberate DX choice for MCP/API clients. See
  // SECURITY.md §2 and the `feedback_long_lived_tokens` memory.

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new UnsupportedGrantTypeError('refresh_token grant is not supported');
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private async findLiveAuthorizationCode(rawCode: string) {
    const codeHash = hashSecret(rawCode);
    const [row] = await this.db
      .select()
      .from(oauthAuthorizationCodes)
      .where(
        and(
          eq(oauthAuthorizationCodes.codeHash, codeHash),
          sql`${oauthAuthorizationCodes.expiresAt} > now()`,
        ),
      )
      .limit(1);
    return row;
  }
}
