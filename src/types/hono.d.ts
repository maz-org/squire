/**
 * Type-safe Hono context variables for auth state (SQR-78, SQR-173).
 *
 * The session middleware loads a Session (with user) from the repository
 * and stores it on the Hono context. The bearer middleware stores validated
 * OAuth token metadata for API/MCP routes. This augmentation makes
 * c.get(...) and c.set(...) type-checked at compile time.
 *
 * The empty export makes this file a module (not a global script), which
 * is required for `declare module` to augment rather than replace.
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import type { Session } from '../db/repositories/types.ts';

export {};

declare module 'hono' {
  interface ContextVariableMap {
    authInfo: AuthInfo | undefined;
    session: Session | undefined;
  }
}
