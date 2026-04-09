/**
 * Type-safe Hono context variables for auth state (SQR-78).
 *
 * The session middleware loads a Session (with user) from the repository
 * and stores it on the Hono context. This augmentation makes
 * c.get('session') and c.set('session', ...) type-checked at compile time.
 *
 * The empty export makes this file a module (not a global script), which
 * is required for `declare module` to augment rather than replace.
 */

import type { Session } from '../db/repositories/types.ts';

export {};

declare module 'hono' {
  interface ContextVariableMap {
    session: Session | undefined;
  }
}
