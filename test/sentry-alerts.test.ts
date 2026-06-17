import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import {
  SENTRY_EXISTING_APP_HEALTH_ALERTS,
  SENTRY_APP_HEALTH_MONITORS,
  appHealthDashboardPayload,
  appHealthDetectorPayload,
} from '../scripts/sentry-app-health-config.ts';
import {
  SENTRY_SAFE_TEST_ISSUE_QUERY,
  SAFE_TEST_KINDS,
  SAFE_VERIFICATION_KINDS,
  cleanupSafeTestIssues,
  safeTestDryRunPayload,
  safeVerificationDryRunPayload,
} from '../scripts/send-sentry-safe-test-event.ts';
import {
  assertDashboardMatchesExpected,
  assertDetectorMatchesExpected,
  parseSentryNextPath,
  verifyExistingAlerts,
} from '../scripts/sync-sentry-app-health.ts';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('Sentry alert catalog', () => {
  it('exposes safe test-event log and trace payloads without sending events in dry-run mode', async () => {
    const packageJson = JSON.parse(await readProjectFile('package.json')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['sentry:test-event']).toBe(
      'node scripts/send-sentry-safe-test-event.ts',
    );
    expect(packageJson.scripts?.['sentry:app-health']).toBe(
      'node scripts/sync-sentry-app-health.ts',
    );

    for (const kind of SAFE_VERIFICATION_KINDS) {
      const payload = safeVerificationDryRunPayload(kind);
      const stdout = JSON.stringify(payload);

      expect(payload.kind).toBe(kind);
      expect(payload.input?.requestId).toBe(`sentry-test-${kind}`);
      expect(payload.input?.fingerprint).toEqual(['squire-safe-test', kind]);
      expect(payload.input?.context).toMatchObject({
        safeTest: 'true',
        safeTestKind: kind,
        synthetic: 'true',
      });
      expect(payload.event).toMatchObject({ level: 'error' });
      expect(payload.log?.message).toBe(`sentry.safe_test.${kind}`);
      expect(payload.log?.attributes).toMatchObject({
        safe_test: true,
        safe_test_kind: kind,
        synthetic: true,
      });
      expect(payload.trace?.name).toBe(`squire.safe_test.${kind}`);
      expect(payload.trace?.attributes).toMatchObject({
        'squire.safe_test': true,
        'squire.safe_test.kind': kind,
        'squire.synthetic': true,
      });
      expect(payload.traceProof).toMatchObject({
        traceAttempted: false,
        traceSpanStarted: false,
        traceSearchable: null,
        traceSearchableReason: expect.stringContaining('dry-run'),
        traceId: null,
        spanId: null,
      });
      expect(payload.evidence).toMatchObject({
        requestId: `sentry-test-${kind}`,
        cleanupCommand: 'npm run sentry:test-event -- --cleanup',
        safeTestIssueQuery: SENTRY_SAFE_TEST_ISSUE_QUERY,
        sentrySafeTestIssueSearchUrl: expect.stringContaining('safe_test%3Atrue'),
        sentryEventSearchUrl: expect.stringContaining(`request_id%3Asentry-test-${kind}`),
        sentryLogsSearchUrl: expect.stringContaining(`request_id%3Asentry-test-${kind}`),
        sentryTraceSearchUrl: expect.stringContaining(`sentry-test-${kind}`),
      });
      expect(payload.evidence?.linearEvidence).toMatchObject({
        Request: `sentry-test-${kind}`,
        Environment: expect.any(String),
        Release: expect.any(String),
        'Sentry Issue/Event/Replay': expect.stringContaining('Event search: https://'),
        Expected: expect.stringContaining('trace rows require traceProof'),
        Acceptance: expect.stringContaining('traceProof unavailable reason'),
      });

      for (const forbidden of [
        'cookie',
        'Bearer',
        'prompt',
        'answer',
        'transcript',
        'retrieved passage',
        'provider payload',
        'email',
        'customerName',
        'fullName',
      ]) {
        expect(stdout).not.toContain(forbidden);
      }
    }
  });

  it('marks every safe-test kind with synthetic cleanup metadata', () => {
    for (const kind of SAFE_TEST_KINDS) {
      const payload = safeTestDryRunPayload(kind);

      expect(payload.input).toMatchObject({
        requestId: `sentry-test-${kind}`,
        fingerprint: ['squire-safe-test', kind],
        context: {
          safeTest: 'true',
          safeTestKind: kind,
          synthetic: 'true',
        },
      });
    }
  });

  it('cleans up unresolved safe-test Sentry issues by synthetic query only', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const url = String(input);
      calls.push({ method, url });

      if (method === 'PUT') {
        return new Response(JSON.stringify({ id: url.split('/').at(-2), status: 'resolved' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify([
          {
            id: '7555295841',
            shortId: 'MAZ-SQUIRE-6',
            title: 'browser.browser_stream_error',
            permalink: 'https://brian-moseley.sentry.io/issues/7555295841/',
            status: 'unresolved',
          },
          {
            id: '7551288604',
            shortId: 'MAZ-SQUIRE-1',
            title: 'Error: SquireSafeScrubCanary',
            permalink: 'https://brian-moseley.sentry.io/issues/7551288604/',
            status: 'unresolved',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const dryRun = await cleanupSafeTestIssues({ token: 'token', dryRun: true, fetch });

    expect(dryRun).toMatchObject({
      mode: 'cleanup',
      dryRun: true,
      query: SENTRY_SAFE_TEST_ISSUE_QUERY,
      resolvedIssues: [],
    });
    expect(dryRun.issues.map((issue) => issue.id)).toEqual(['7555295841', '7551288604']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toContain('query=is%3Aunresolved+safe_test%3Atrue');

    calls.length = 0;
    const applied = await cleanupSafeTestIssues({ token: 'token', dryRun: false, fetch });

    expect(applied).toMatchObject({
      mode: 'cleanup',
      dryRun: false,
      query: SENTRY_SAFE_TEST_ISSUE_QUERY,
    });
    expect(applied.resolvedIssues.map((issue) => issue.id)).toEqual(['7555295841', '7551288604']);
    expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT', 'PUT']);
    expect(calls[1]?.url).toBe('https://sentry.io/api/0/issues/7555295841/');
    expect(calls[2]?.url).toBe('https://sentry.io/api/0/issues/7551288604/');
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

    expect(() =>
      assertDetectorMatchesExpected(
        {
          ...detector,
          owner: { type: 'team', id: '4511564194512896', name: 'brian-moseley-team' },
          dataSources: [
            {
              queryObj: {
                snubaQuery: {
                  dataset: monitor.dataset,
                  query: monitor.query,
                  aggregate: monitor.aggregate,
                  timeWindow: monitor.timeWindowSeconds,
                  environment: 'production',
                  eventTypes: monitor.eventTypes,
                  extrapolationMode: 'unknown',
                },
              },
            },
          ],
          conditionGroup: detector.condition_group,
        },
        detector,
        monitor.name,
      ),
    ).not.toThrow();

    const staleDetector = structuredClone(detector);
    const dataSources = staleDetector.data_sources as Array<Record<string, unknown>>;
    dataSources[0]!.query = 'environment:production stale:true';
    expect(() => assertDetectorMatchesExpected(staleDetector, detector, monitor.name)).toThrow(
      '$.data_sources.0.query',
    );
  });

  it('finds existing event and uptime alerts through legacy Sentry endpoints', async () => {
    const paths: string[] = [];
    const uptimeAlert = SENTRY_EXISTING_APP_HEALTH_ALERTS.find((alert) =>
      alert.areas.includes('uptime'),
    );
    expect(uptimeAlert).toBeDefined();
    const eventAlerts = SENTRY_EXISTING_APP_HEALTH_ALERTS.filter(
      (alert) => !alert.areas.includes('uptime'),
    );

    const result = await verifyExistingAlerts({
      async list(path: string): Promise<unknown[]> {
        paths.push(path);
        if (path.endsWith('/detectors/') || path.endsWith('/workflows/')) return [];
        if (path.endsWith('/alert-rules/')) {
          return eventAlerts.map((alert, index) => ({ id: `event-${index}`, name: alert.name }));
        }
        if (path.endsWith('/uptime/')) {
          return [{ id: 'uptime-1', name: uptimeAlert!.name }];
        }
        throw new Error(`unexpected path: ${path}`);
      },
    });

    expect(paths).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/detectors/'),
        expect.stringContaining('/workflows/'),
        expect.stringContaining('/alert-rules/'),
        expect.stringContaining('/uptime/'),
      ]),
    );
    expect(result).toHaveLength(SENTRY_EXISTING_APP_HEALTH_ALERTS.length);
    expect(result.every((alert) => alert.found)).toBe(true);
  });

  it('parses Sentry pagination links only when another page has results', () => {
    expect(
      parseSentryNextPath(
        '<https://sentry.io/api/0/organizations/brian-moseley/detectors/?cursor=abc&per_page=100>; rel="next"; results="true"; cursor="abc"',
      ),
    ).toBe('/organizations/brian-moseley/detectors/?cursor=abc&per_page=100');

    expect(
      parseSentryNextPath(
        '<https://sentry.io/api/0/organizations/brian-moseley/detectors/?cursor=abc&per_page=100>; rel="next"; results="false"; cursor="abc"',
      ),
    ).toBeUndefined();
  });
});
