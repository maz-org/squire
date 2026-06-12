/**
 * Caller identity resolution for campaign state (SQR-20, ADR 0021).
 *
 * The user-bound-token rule: client-credentials tokens identify a client,
 * not a user, and are structurally rejected from campaign-state access —
 * no client-identity fallback exists on state surfaces.
 */
import { describe, expect, it } from 'vitest';

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  identityFromSessionUser,
  requireIdentityFromAuthInfo,
  UserIdentityRequiredError,
  userIdFromAuthInfo,
} from '../src/campaign/identity.ts';

function authInfo(extra?: Record<string, unknown>): AuthInfo {
  return {
    token: 'raw-token',
    clientId: 'client-123',
    scopes: [],
    extra,
  };
}

describe('campaign caller identity (SQR-20)', () => {
  it('resolves the user id from a user-bound token', () => {
    const identity = requireIdentityFromAuthInfo(authInfo({ userId: 'user-1' }), 'mcp');
    expect(identity).toEqual({ userId: 'user-1', channel: 'mcp' });
  });

  it('hard-rejects client-credentials tokens (no userId) with a structured error', () => {
    expect(() => requireIdentityFromAuthInfo(authInfo(), 'rest')).toThrow(
      UserIdentityRequiredError,
    );
    try {
      requireIdentityFromAuthInfo(authInfo({ userId: '   ' }), 'mcp');
      expect.unreachable('blank userId must not resolve');
    } catch (error) {
      expect(error).toBeInstanceOf(UserIdentityRequiredError);
      expect((error as UserIdentityRequiredError).code).toBe('user_identity_required');
    }
  });

  it('hard-rejects a missing token entirely', () => {
    expect(() => requireIdentityFromAuthInfo(undefined, 'mcp')).toThrow(UserIdentityRequiredError);
  });

  it('never falls back to the client id', () => {
    expect(userIdFromAuthInfo(authInfo({ somethingElse: true }))).toBeNull();
  });

  it('wraps in-process session users as web-channel identity', () => {
    expect(identityFromSessionUser('user-9')).toEqual({ userId: 'user-9', channel: 'web' });
  });
});
