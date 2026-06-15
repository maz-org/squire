import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SENTRY_APP_HEALTH_AREAS,
  SENTRY_APP_HEALTH_DASHBOARD_TITLE,
  SENTRY_APP_HEALTH_DASHBOARD_WIDGETS,
  SENTRY_APP_HEALTH_ENVIRONMENT,
  SENTRY_APP_HEALTH_FORBIDDEN_QUERY_TERMS,
  SENTRY_APP_HEALTH_MONITORS,
  SENTRY_APP_HEALTH_PROJECT_ID,
  SENTRY_EXISTING_APP_HEALTH_ALERTS,
  appHealthDashboardPayload,
  appHealthDetectorPayload,
} from '../scripts/sentry-app-health-config.ts';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function allQueryText(): string[] {
  return [
    ...SENTRY_APP_HEALTH_DASHBOARD_WIDGETS.flatMap((widget) =>
      widget.queries.map((query) => query.conditions),
    ),
    ...SENTRY_APP_HEALTH_MONITORS.map((monitor) => monitor.query),
    ...SENTRY_EXISTING_APP_HEALTH_ALERTS.map((alert) => alert.query),
  ];
}

describe('Sentry app health configuration', () => {
  it('covers every required app health area with dashboards or alerts', () => {
    const covered = new Set([
      ...SENTRY_APP_HEALTH_DASHBOARD_WIDGETS.flatMap((widget) => widget.areas),
      ...SENTRY_APP_HEALTH_MONITORS.flatMap((monitor) => monitor.areas),
      ...SENTRY_EXISTING_APP_HEALTH_ALERTS.flatMap((alert) => alert.areas),
    ]);

    for (const area of SENTRY_APP_HEALTH_AREAS) {
      expect(covered.has(area), `missing app health area: ${area}`).toBe(true);
    }
  });

  it('defines a production dashboard with saved query names and supported datasets', () => {
    const payload = appHealthDashboardPayload();

    expect(payload.title).toBe(SENTRY_APP_HEALTH_DASHBOARD_TITLE);
    expect(payload.projects).toEqual([Number(SENTRY_APP_HEALTH_PROJECT_ID)]);
    expect(payload.environment).toEqual([SENTRY_APP_HEALTH_ENVIRONMENT]);
    expect(payload.widgets).toHaveLength(SENTRY_APP_HEALTH_DASHBOARD_WIDGETS.length);

    for (const widget of SENTRY_APP_HEALTH_DASHBOARD_WIDGETS) {
      expect(widget.savedQueryName).toMatch(/^squire\./);
      expect(['error-events', 'logs', 'spans']).toContain(widget.widgetType);
      expect(widget.queries.length).toBeGreaterThan(0);
      for (const query of widget.queries) {
        expect(query.conditions).toContain('environment:production');
        expect(query.fields).toEqual([...query.columns, ...query.aggregates]);
      }
    }
  });

  it('defines log and trace monitors with routing, thresholds, and production filters', () => {
    expect(
      SENTRY_APP_HEALTH_MONITORS.some((monitor) => monitor.eventTypes.includes('trace_item_log')),
    ).toBe(true);
    expect(
      SENTRY_APP_HEALTH_MONITORS.some((monitor) => monitor.eventTypes.includes('trace_item_span')),
    ).toBe(true);

    for (const monitor of SENTRY_APP_HEALTH_MONITORS) {
      expect(monitor.query).toContain('environment:production');
      expect(monitor.threshold.length).toBeGreaterThan(0);
      expect(monitor.routeTo).toContain('team:');
      expect(monitor.firstAction.length).toBeGreaterThan(20);
      expect(monitor.safeTest.length).toBeGreaterThan(10);

      const payload = appHealthDetectorPayload(monitor);
      expect(payload).toMatchObject({
        name: monitor.name,
        type: 'metric_issue',
        owner: expect.stringContaining('team:'),
        enabled: true,
      });
      expect(payload.data_sources).toEqual([
        expect.objectContaining({
          dataset: monitor.dataset,
          query: monitor.query,
          aggregate: monitor.aggregate,
          environment: SENTRY_APP_HEALTH_ENVIRONMENT,
          eventTypes: monitor.eventTypes,
        }),
      ]);
    }
  });

  it('keeps dashboard and alert queries away from sensitive payload families', () => {
    const lowerQueries = allQueryText().map((query) => query.toLowerCase());

    for (const term of SENTRY_APP_HEALTH_FORBIDDEN_QUERY_TERMS) {
      for (const query of lowerQueries) {
        expect(query, `query must not include ${term}`).not.toContain(term);
      }
    }
  });

  it('prints a token-free dry run payload for agent verification', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['scripts/sync-sentry-app-health.ts', '--dry-run'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          SENTRY_TOKEN: 'sentry-token-that-must-not-print',
        },
      },
    );
    const payload = JSON.parse(stdout) as {
      dashboard?: { savedQueries?: string[]; widgetCount?: number };
      mode?: string;
      monitors?: Array<{ name?: string; query?: string }>;
    };

    expect(payload.mode).toBe('dry-run');
    expect(payload.dashboard?.widgetCount).toBe(SENTRY_APP_HEALTH_DASHBOARD_WIDGETS.length);
    expect(payload.dashboard?.savedQueries).toContain('squire.chat.failures');
    expect(payload.monitors?.map((monitor) => monitor.name)).toContain(
      'Squire production chat/SSE log failure spike',
    );
    expect(stdout).not.toContain('sentry-token-that-must-not-print');
  });
});
