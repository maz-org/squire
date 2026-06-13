/**
 * One-shot expired proposal cleanup for the Fly Supercronic process
 * (SQR-279). Stale 'proposed' rows flip to 'expired' — they were never
 * confirmable past their TTL anyway (confirm re-checks expiry), this
 * keeps the table honest for listings.
 */
import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import { shutdownServerPool } from '../src/db.ts';
import { sweepExpiredProposals } from '../src/campaign/pending-mutations.ts';

export async function main(): Promise<number> {
  const swept = await sweepExpiredProposals();
  console.log(`[proposal-gc] expired ${swept} stale proposal(s)`);
  return swept;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((err) => {
      console.error('[proposal-gc] failed to sweep proposals:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await shutdownServerPool();
    });
}
