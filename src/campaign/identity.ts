/**
 * Caller identity for campaign-state access (Phase 4, SQR-20).
 *
 * ADR 0021 requires every campaign-scoped operation to know WHO is asking,
 * on every channel. This module is the one place that turns channel
 * mechanics (web session, OAuth bearer token, in-process call) into a typed
 * `CallerIdentity`, and the one place that enforces the user-bound-token
 * rule: client-credentials tokens carry no `userId` and are structurally
 * rejected from campaign state — there is no client-identity fallback here,
 * unlike rate limiting, where falling back to the OAuth client id is fine.
 *
 * Identity is not authorization: membership and permission checks happen in
 * the campaign service layer against the SQR-28 contract. This type just
 * guarantees the checks have a real user to evaluate.
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export type CallerChannel = 'web' | 'mcp' | 'rest' | 'system';

export interface CallerIdentity {
  userId: string;
  channel: CallerChannel;
}

/**
 * Structured rejection for tokens that identify a client but not a user.
 * State surfaces translate this into their channel's error shape (HTTP 403
 * JSON, MCP tool error payload) — never a silent fallback.
 */
export class UserIdentityRequiredError extends Error {
  readonly code = 'user_identity_required';

  constructor(channel: CallerChannel) {
    super(
      `Campaign state requires a user-bound token on the ${channel} channel; ` +
        `client-credentials tokens have no user identity`,
    );
    this.name = 'UserIdentityRequiredError';
  }
}

/** Extract the token's user id, if the token is user-bound. */
export function userIdFromAuthInfo(authInfo: AuthInfo | undefined): string | null {
  const userId = authInfo?.extra?.userId;
  return typeof userId === 'string' && userId.trim().length > 0 ? userId : null;
}

/**
 * The hard gate for state surfaces (ADR 0021, plan constraint: hard-reject
 * client-only tokens). Throws `UserIdentityRequiredError` when the token is
 * absent or client-only.
 */
export function requireIdentityFromAuthInfo(
  authInfo: AuthInfo | undefined,
  channel: CallerChannel,
): CallerIdentity {
  const userId = userIdFromAuthInfo(authInfo);
  if (!userId) throw new UserIdentityRequiredError(channel);
  return { userId, channel };
}

/** In-process callers (web conversation agent) carry identity without auth. */
export function identityFromSessionUser(userId: string): CallerIdentity {
  return { userId, channel: 'web' };
}
