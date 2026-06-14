/**
 * One-shot expired session cleanup for the Fly Supercronic process.
 */
import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import { shutdownServerPool } from '../src/db.ts';
import * as SessionRepository from '../src/db/repositories/session-repository.ts';
import { runScriptWithTelemetry } from '../src/script-telemetry.ts';

export async function main(): Promise<number> {
  const deleted = await SessionRepository.deleteExpired();
  console.log(`[session-gc] deleted ${deleted} expired session(s)`);
  return deleted;
}

export async function runExpiredSessionSweepCli(): Promise<void> {
  try {
    await runScriptWithTelemetry(main, {
      scriptName: 'sweep-expired-sessions',
      scriptKind: 'cron',
    });
  } catch (err) {
    console.error('[session-gc] failed to delete expired sessions:', err);
    process.exitCode = 1;
  } finally {
    await shutdownServerPool();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runExpiredSessionSweepCli();
}
