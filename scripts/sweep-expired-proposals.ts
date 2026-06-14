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
import { runScriptWithTelemetry } from '../src/script-telemetry.ts';

export async function main(): Promise<number> {
  const swept = await sweepExpiredProposals();
  console.log(`[proposal-gc] expired ${swept} stale proposal(s)`);
  return swept;
}

export async function runExpiredProposalSweepCli(): Promise<void> {
  try {
    await runScriptWithTelemetry(main, {
      scriptName: 'sweep-expired-proposals',
      scriptKind: 'cron',
    });
  } catch (err) {
    console.error('[proposal-gc] failed to sweep proposals:', err);
    process.exitCode = 1;
  } finally {
    await shutdownServerPool();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runExpiredProposalSweepCli();
}
