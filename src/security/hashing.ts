/**
 * SHA-256 hex helper for opaque secrets.
 *
 * OAuth tokens, authorization codes, and session cookie tokens are stored as
 * SHA-256 hex of the raw secret. The raw value is only ever in flight.
 *
 * Constant-time compare is not required: callers look up rows by the hash as
 * primary key, so there is no compare-and-branch timing side channel.
 */

import { createHash } from 'node:crypto';

export function hashSecret(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
