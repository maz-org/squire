/**
 * LangSmith + OpenTelemetry instrumentation.
 * Must be imported BEFORE any other application code.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangSmithOTLPSpanProcessor } from 'langsmith/experimental/otel/processor';
import { LangSmithOTLPTraceExporter } from 'langsmith/experimental/otel/exporter';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { SentryPropagator, SentrySampler, SentrySpanProcessor } from '@sentry/opentelemetry';
import { SentryContextManager } from '@sentry/node';
import { applySquireEnv } from './squire-env.ts';
import { langsmithOtelHeaders } from './langsmith-otel.ts';
import { getTelemetryClient, initTelemetry, sentryTraceSampleRateFromEnv } from './telemetry.ts';

const squireEnv = applySquireEnv();
const langsmithProject = process.env.LANGSMITH_PROJECT ?? 'squire-production';

function buildLangSmithSpanProcessor(): LangSmithOTLPSpanProcessor {
  return new LangSmithOTLPSpanProcessor(
    new LangSmithOTLPTraceExporter({
      projectName: langsmithProject,
      headers: langsmithOtelHeaders(),
      transformExportedSpan: (span) => {
        span.attributes['langsmith.metadata.environment'] = squireEnv;
        return span;
      },
    }),
  );
}

function buildSentryOpenTelemetryConfig() {
  initTelemetry(process.env);
  const client = getTelemetryClient();
  const tracesSampleRate = sentryTraceSampleRateFromEnv(process.env);
  if (!client || tracesSampleRate === undefined || tracesSampleRate <= 0) {
    return {
      spanProcessors: [],
    };
  }

  return {
    spanProcessors: [new SentrySpanProcessor()],
    sampler: new SentrySampler(client),
    textMapPropagator: new SentryPropagator(),
    contextManager: new SentryContextManager(),
  };
}

const sentryOpenTelemetry = buildSentryOpenTelemetryConfig();

const sdk = new NodeSDK({
  spanProcessors: [buildLangSmithSpanProcessor(), ...sentryOpenTelemetry.spanProcessors],
  ...(sentryOpenTelemetry.sampler ? { sampler: sentryOpenTelemetry.sampler } : {}),
  ...(sentryOpenTelemetry.textMapPropagator
    ? { textMapPropagator: sentryOpenTelemetry.textMapPropagator }
    : {}),
  ...(sentryOpenTelemetry.contextManager
    ? { contextManager: sentryOpenTelemetry.contextManager }
    : {}),
  // Auto-instrument node-postgres so every Drizzle query gets a span. Drizzle
  // uses `pg` under the hood, so this captures all DB activity from day 1.
  instrumentations: [new PgInstrumentation()],
});

sdk.start();

export { sdk };
