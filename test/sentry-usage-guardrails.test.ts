import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SENTRY_USAGE_DASHBOARD_QUERIES,
  SENTRY_USAGE_GUARDRAIL_ACTIONS,
  SENTRY_USAGE_GUARDRAILS_AS_OF,
  SENTRY_USAGE_GUARDRAILS_SOURCES,
  SENTRY_USAGE_PRICING_SNAPSHOT,
} from '../scripts/sentry-usage-guardrails-config.ts';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

const SENSITIVE_QUERY_TERMS = [
  'answer',
  'cookie',
  'email',
  'model_output',
  'password',
  'prompt',
  'provider_payload',
  'raw_source',
  'retrieved_passage',
  'secret',
  'source_document',
  'token',
  'transcript',
];

describe('Sentry usage and spend guardrails', () => {
  it('records a dated pricing snapshot with source links', () => {
    expect(SENTRY_USAGE_GUARDRAILS_AS_OF).toBe('2026-06-15');
    expect(SENTRY_USAGE_GUARDRAILS_SOURCES).toContain('https://sentry.io/pricing/');
    expect(SENTRY_USAGE_GUARDRAILS_SOURCES).toContain('https://docs.sentry.io/pricing/');
    expect(SENTRY_USAGE_GUARDRAILS_SOURCES).toContain(
      'https://docs.sentry.io/pricing/quotas/manage-logs-quota/',
    );

    expect(SENTRY_USAGE_PRICING_SNAPSHOT.includedMonthlyVolume.developer).toMatchObject({
      errors: '5k errors',
      logs: '5GB logs',
      spans: '5M spans',
    });
    expect(SENTRY_USAGE_PRICING_SNAPSHOT.includedMonthlyVolume.team).toMatchObject({
      errors: '50k errors',
      logs: '5GB logs',
      spans: '5M spans',
    });
    expect(SENTRY_USAGE_PRICING_SNAPSHOT.payAsYouGo).toMatchObject({
      logs: '$0.50/GB',
      applicationMetrics: '$0.50/GB',
      teamSpans: '$0.0000020/span for 5M-100M spans',
      businessSpans: '$0.0000040/span for 5M-100M spans',
    });
    expect(SENTRY_USAGE_PRICING_SNAPSHOT.notes.join('\n')).toContain(
      'drops later data for the billing cycle',
    );
  });

  it('defines usage and dashboard queries for logs, spans, errors, and top talkers', () => {
    const queryNames = SENTRY_USAGE_DASHBOARD_QUERIES.map((query) => query.name);

    for (const expectedName of [
      'squire.usage.logs.accepted_gb',
      'squire.usage.spans.accepted_count',
      'squire.usage.logs.count',
      'squire.usage.spans.count',
      'squire.usage.errors.count',
      'squire.usage.top_log_routes',
      'squire.usage.top_log_events',
      'squire.usage.top_span_routes',
      'squire.usage.top_error_routes',
      'squire.usage.top_security_events',
    ]) {
      expect(queryNames).toContain(expectedName);
    }

    expect(
      SENTRY_USAGE_DASHBOARD_QUERIES.find(
        (query) => query.name === 'squire.usage.logs.accepted_gb',
      ),
    ).toMatchObject({
      surface: 'stats_usage',
      dataset: 'billing',
      fields: expect.arrayContaining(['accepted GB', 'dropped GB', 'filtered GB']),
    });

    for (const query of SENTRY_USAGE_DASHBOARD_QUERIES) {
      expect(query.name).toMatch(/^squire\.usage\./);
      expect(query.purpose.length).toBeGreaterThan(20);
      for (const term of SENSITIVE_QUERY_TERMS) {
        expect(`${query.query} ${query.fields.join(' ')}`.toLowerCase()).not.toContain(term);
      }
    }
  });

  it('prints token-free guardrail inventory for operators and agents', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['scripts/print-sentry-usage-guardrails.ts'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          SENTRY_TOKEN: 'sentry-token-that-must-not-print',
        },
      },
    );
    const payload = JSON.parse(stdout) as {
      asOf?: string;
      queries?: Array<{ name?: string }>;
      guardrails?: Array<{ name?: string }>;
    };

    expect(payload.asOf).toBe(SENTRY_USAGE_GUARDRAILS_AS_OF);
    expect(payload.queries?.map((query) => query.name)).toContain('squire.usage.logs.accepted_gb');
    expect(payload.guardrails?.map((guardrail) => guardrail.name)).toEqual(
      SENTRY_USAGE_GUARDRAIL_ACTIONS.map((guardrail) => guardrail.name),
    );
    expect(stdout).not.toContain('sentry-token-that-must-not-print');
  });

  it('keeps runtime log handling focused on sanitization, not cost filtering', async () => {
    const telemetry = await readProjectFile('src/telemetry.ts');

    expect(telemetry).toContain('beforeSendLog: sanitizeSentryLog');
    expect(telemetry).toContain("return sanitizeTelemetryPayload('log', log)");
    expect(telemetry).not.toContain('beforeSendLog: (log)');
  });
});
