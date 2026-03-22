/**
 * Langfuse + OpenTelemetry instrumentation.
 * Must be imported BEFORE any other application code.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

export const LANGFUSE_DEFAULT_BASE_URL = 'https://us.cloud.langfuse.com';

const sdk = new NodeSDK({
  spanProcessors: [
    new LangfuseSpanProcessor({
      baseUrl: process.env.LANGFUSE_BASEURL ?? LANGFUSE_DEFAULT_BASE_URL,
    }),
  ],
});

sdk.start();

export { sdk };
