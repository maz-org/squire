import { describe, expect, it } from 'vitest';

import { langsmithOtelHeaders } from '../src/langsmith-otel.ts';

describe('langsmithOtelHeaders', () => {
  it('passes API key and workspace headers to the OTEL exporter', () => {
    expect(
      langsmithOtelHeaders({
        LANGSMITH_API_KEY: 'ls-key',
        LANGSMITH_WORKSPACE_ID: ' workspace-id ',
      }),
    ).toEqual({
      'x-api-key': 'ls-key',
      'x-tenant-id': 'workspace-id',
    });
  });

  it('lets OTEL_EXPORTER_OTLP_HEADERS own custom headers when configured', () => {
    expect(
      langsmithOtelHeaders({
        LANGSMITH_API_KEY: 'ls-key',
        LANGSMITH_WORKSPACE_ID: 'workspace-id',
        OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=other',
      }),
    ).toBeUndefined();
  });
});
