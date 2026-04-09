/**
 * Type-safe Hono context variables for auth state (SQR-78).
 *
 * The session middleware sets `userId` on the Hono context via c.set().
 * This module augmentation makes c.get('userId') and c.set('userId', ...)
 * type-checked at compile time. A key rename in the middleware that isn't
 * propagated to session.ts, layout.ts, or tests becomes a build error
 * instead of a silent runtime failure.
 *
 * The empty export makes this file a module (not a global script), which
 * is required for `declare module` to augment rather than replace.
 */

export {};

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
  }
}
