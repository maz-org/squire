import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  SENTRY_APP_HEALTH_MONITORS,
  appHealthDashboardPayload,
  appHealthDetectorPayload,
} from '../scripts/sentry-app-health-config.ts';
import {
  assertDashboardMatchesExpected,
  assertDetectorMatchesExpected,
} from '../scripts/sync-sentry-app-health.ts';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('Sentry alert catalog', () => {
  it('documents each production alert rule with stable filters and safe tests', async () => {
    const runbook = await readProjectFile('docs/runbooks/sentry-alerts.md');

    for (const alertName of [
      'Squire production backend request p95 latency',
      'Squire production chat/SSE p95 latency',
      'Squire production chat/SSE log failure spike',
      'Squire production browser stream transport failures',
      'Squire production script failure log spike',
      'Squire production auth/rate-limit anomaly spike',
      'Squire production budget/accounting failure',
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
      'environment:production http.route:* squire.request_id:*',
      'environment:production squire.surface:[chat_sse,api_ask]',
      'environment:production surface:[chat_sse,api_ask] status:error',
      'environment:production surface:browser event_type:browser_stream_error stream_error_kind:transport',
      'environment:production event_type:script.lifecycle job_kind:[cron,release_command,manual_migration] status:error',
      'environment:production surface:security_log security_event:[rate_limit_rejected,rate_limit_unavailable,google_login_denied]',
      'environment:production surface:security_log security_event:[llm_budget_accounting_failed,llm_budget_warning]',
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
    expect(packageJson.scripts?.['sentry:app-health']).toBe(
      'node scripts/sync-sentry-app-health.ts',
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

  it('exposes the app-health dashboard and alert sync dry run', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['scripts/sync-sentry-app-health.ts', '--dry-run'],
      { cwd: repoRoot },
    );
    const payload = JSON.parse(stdout) as {
      dashboard?: { savedQueries?: string[]; widgetCount?: number };
      monitors?: Array<{ name?: string }>;
    };

    expect(payload.dashboard?.savedQueries).toContain('squire.backend.latency.p95');
    expect(payload.dashboard?.savedQueries).toContain('squire.browser.stream_transport');
    expect(payload.monitors?.map((monitor) => monitor.name)).toContain(
      'Squire production backend request p95 latency',
    );
  });

  it('fails verification when a live dashboard or detector drifts from checked-in config', () => {
    const dashboard = appHealthDashboardPayload();
    expect(() => assertDashboardMatchesExpected(dashboard, dashboard)).not.toThrow();

    const staleDashboard = structuredClone(dashboard);
    staleDashboard.widgets[1]!.queries[0]!.conditions = 'environment:production stale:true';
    expect(() => assertDashboardMatchesExpected(staleDashboard, dashboard)).toThrow(
      '$.widgets.1.queries.0.conditions',
    );

    const monitor = SENTRY_APP_HEALTH_MONITORS[0]!;
    const detector = appHealthDetectorPayload(monitor, ['workflow-1']);
    expect(() => assertDetectorMatchesExpected(detector, detector, monitor.name)).not.toThrow();

    const staleDetector = structuredClone(detector);
    const dataSources = staleDetector.data_sources as Array<Record<string, unknown>>;
    dataSources[0]!.query = 'environment:production stale:true';
    expect(() => assertDetectorMatchesExpected(staleDetector, detector, monitor.name)).toThrow(
      '$.data_sources.0.query',
    );
  });
});
