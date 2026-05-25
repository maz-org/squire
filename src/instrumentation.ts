/**
 * LangSmith + OpenTelemetry instrumentation.
 * Must be imported BEFORE any other application code.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangSmithOTLPSpanProcessor } from 'langsmith/experimental/otel/processor';
import { LangSmithOTLPTraceExporter } from 'langsmith/experimental/otel/exporter';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { applySquireEnv } from './squire-env.ts';

const squireEnv = applySquireEnv();
const langsmithProject = process.env.LANGSMITH_PROJECT ?? 'squire-production';

const sdk = new NodeSDK({
  spanProcessors: [
    new LangSmithOTLPSpanProcessor(
      new LangSmithOTLPTraceExporter({
        projectName: langsmithProject,
        transformExportedSpan: (span) => {
          span.attributes['langsmith.metadata.environment'] = squireEnv;
          return span;
        },
      }),
    ),
  ],
  // Auto-instrument node-postgres so every Drizzle query gets a span. Drizzle
  // uses `pg` under the hood, so this captures all DB activity from day 1.
  instrumentations: [new PgInstrumentation()],
});

sdk.start();

export { sdk };
