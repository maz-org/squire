import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('Sentry alert catalog', () => {
  it('documents each production alert rule with stable filters and safe tests', async () => {
    const runbook = await readProjectFile('docs/runbooks/sentry-alerts.md');

    for (const alertName of [
      'Squire production backend error spike',
      'Squire production chat/SSE failure spike',
      'Squire production frontend error spike',
      'Squire production cron/job failure',
      'Squire production deploy regression new issue',
      'Squire production uptime failure',
    ]) {
      expect(runbook).toContain(alertName);
    }

    for (const filter of [
      'environment:production surface:server level:error',
      'environment:production failure_kind:assistant_turn level:error',
      'environment:production surface:browser event_type:browser_error level:error',
      'environment:production job_kind:cron level:error',
      'environment:production release:* level:error',
      'https://squire.maz.org/api/health',
    ]) {
      expect(runbook).toContain(filter);
    }

    for (const kind of ['backend', 'chat', 'browser', 'cron', 'deploy-regression']) {
      expect(runbook).toContain(`npm run sentry:test-event -- --kind ${kind}`);
    }
    expect(runbook).toContain('api/__sentry-uptime-test-404');
  });

  it('exposes the safe test-event command without sending events in dry-run mode', async () => {
    const packageJson = JSON.parse(await readProjectFile('package.json')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['sentry:test-event']).toBe(
      'node scripts/send-sentry-safe-test-event.ts',
    );

    const { stdout } = await execFileAsync(
      process.execPath,
      ['scripts/send-sentry-safe-test-event.ts', '--kind', 'chat', '--dry-run'],
      { cwd: repoRoot },
    );
    const payload = JSON.parse(stdout) as {
      kind?: string;
      input?: { context?: Record<string, unknown> };
    };

    expect(payload.kind).toBe('chat');
    expect(payload.input?.context).toMatchObject({
      surface: 'chat_sse',
      failureKind: 'assistant_turn',
      eventType: 'safe_test',
    });
    expect(stdout).not.toContain('cookie');
    expect(stdout).not.toContain('Bearer');
    expect(stdout).not.toContain('prompt');
    expect(stdout).not.toContain('answer');
  });
});
