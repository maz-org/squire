import { describe, expect, it } from 'vitest';

import { isPgVectorPermissionError, pgVectorExtensionSetupMessage } from '../scripts/db-migrate.ts';

describe('db migration pgvector setup guidance', () => {
  it('detects Fly MPG permission failures when creating pgvector', () => {
    expect(
      isPgVectorPermissionError({
        query: 'CREATE EXTENSION IF NOT EXISTS vector',
        cause: { code: '42501', message: 'permission denied to create extension "vector"' },
      }),
    ).toBe(true);

    expect(
      isPgVectorPermissionError({
        query: 'CREATE EXTENSION IF NOT EXISTS vector',
        cause: { code: '42P07', message: 'relation already exists' },
      }),
    ).toBe(false);
  });

  it('explains the Fly MPG dashboard step required before first production deploy', () => {
    expect(pgVectorExtensionSetupMessage()).toContain('dashboard Extensions page');
    expect(pgVectorExtensionSetupMessage()).toContain('database fly-db');
    expect(pgVectorExtensionSetupMessage()).toContain('schema public');
  });
});
