/**
 * SHA-256 hex helper for OAuth secrets.
 *
 * Access tokens and authorization codes are stored as SHA-256 hex of the raw
 * secret — the raw value is only ever in flight. See `docs/SECURITY.md` §2 and
 * the schema in `src/db/schema/auth.ts`.
 *
 * Constant-time compare is not required: we look up rows by the hash as
 * primary key, so there is no compare-and-branch timing side channel.
 */

import { createHash } from 'node:crypto';

export function hashSecret(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
