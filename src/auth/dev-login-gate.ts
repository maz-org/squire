import { isManagedLocalDatabaseUrl, resolveDatabaseUrl } from '../db.ts';

/**
 * Returns true iff the dev-login affordances are safe to expose on this
 * process. This gate is intentionally shared by the route registration and
 * the local dev-user allowlist exception so authenticated local testing
 * behaves consistently without weakening production.
 *
 * The route only exists when this passes at server startup. The handler and
 * allowlist helper also re-check it at request time, so clearing
 * `SQUIRE_DEV_LOGIN` or pointing at a non-local DB disables the affordance
 * without a restart.
 */
export function shouldRegisterDevLogin(): boolean {
  if (process.env.SQUIRE_DEV_LOGIN !== '1') return false;
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== 'development' && nodeEnv !== 'test') return false;
  try {
    return isManagedLocalDatabaseUrl(resolveDatabaseUrl());
  } catch {
    // Malformed DATABASE_URL -> refuse. We only enable dev affordances when
    // we can prove the DB is a managed-local one.
    return false;
  }
}
