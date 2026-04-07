/**
 * Langfuse + OpenTelemetry instrumentation.
 * Must be imported BEFORE any other application code.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

export const LANGFUSE_DEFAULT_BASE_URL = 'https://us.cloud.langfuse.com';

const sdk = new NodeSDK({
  spanProcessors: [
    new LangfuseSpanProcessor({
      baseUrl: process.env.LANGFUSE_BASEURL ?? LANGFUSE_DEFAULT_BASE_URL,
    }),
  ],
  // Auto-instrument node-postgres so every Drizzle query gets a span. Drizzle
  // uses `pg` under the hood, so this captures all DB activity from day 1.
  instrumentations: [new PgInstrumentation()],
});

sdk.start();

export { sdk };
