/**
 * Domain types for core data models (SQR-38).
 *
 * These are the shapes the rest of the app works with: layout, middleware,
 * route handlers, tests. Repository methods return these types. The Drizzle
 * schema defines the DB columns; these types define the domain contract.
 *
 * If a column is added to the schema, update the matching type here and
 * the repository mapping in the same commit.
 */

export interface User {
  id: string;
  googleSub: string;
  email: string;
  name: string | null;
  createdAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  lastSeenAt: Date | null;
  user: User;
}
