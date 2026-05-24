import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  assertProductionDatabaseUrl,
  getProductionDatabaseConnectionUrl,
  getProductionDatabaseTargetUrl,
} from '../scripts/check-production-data.ts';

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function postgresFixtureUrl(options: { host: string; database?: string; port?: number }): string {
  const url = new URL('postgres://fixture.invalid');
  url.username = 'squire';
  url.password = 'fixture-password';
  url.hostname = options.host;
  if (options.port !== undefined) url.port = String(options.port);
  if (options.database !== undefined) url.pathname = `/${options.database}`;
  return url.toString();
}

describe('production data lifecycle workflows', () => {
  it('defines package scripts for production data URL verification and sanity checks', async () => {
    const packageJson = JSON.parse(await readProjectFile('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['production-data:verify-db-url']).toBe(
      'node scripts/check-production-data.ts verify-url',
    );
    expect(packageJson.scripts?.['production-data:check']).toBe(
      'node scripts/check-production-data.ts',
    );
    expect(packageJson.scripts?.['production-data:truncate-embeddings']).toBe(
      'node scripts/check-production-data.ts truncate-embeddings',
    );
  });

  it('rejects missing local and obvious dev/test production database URLs', () => {
    expect(() => assertProductionDatabaseUrl('')).toThrow(/PRODUCTION_DATABASE_URL/);
    expect(() =>
      assertProductionDatabaseUrl(
        postgresFixtureUrl({ host: 'localhost', port: 5432, database: 'fly-db' }),
      ),
    ).toThrow(/local database/);
    expect(() =>
      assertProductionDatabaseUrl(
        postgresFixtureUrl({ host: '127.0.0.1', port: 5432, database: 'fly-db' }),
      ),
    ).toThrow(/local database/);
    expect(() => assertProductionDatabaseUrl(postgresFixtureUrl({ host: 'db.internal' }))).toThrow(
      /explicit database name/,
    );
    expect(() =>
      assertProductionDatabaseUrl(
        postgresFixtureUrl({ host: 'db.internal', port: 5432, database: 'squire_test' }),
      ),
    ).toThrow(/dev\/test database/);
    expect(() =>
      assertProductionDatabaseUrl(
        postgresFixtureUrl({ host: 'db.internal', port: 5432, database: 'squire_dev' }),
      ),
    ).toThrow(/dev\/test database/);

    expect(() =>
      assertProductionDatabaseUrl(
        postgresFixtureUrl({
          host: 'top2.nearest.of.maz-squire-db',
          port: 5432,
          database: 'fly-db',
        }),
      ),
    ).not.toThrow();
  });

  it('allows a local Fly proxy connection only when the production target URL is separate', () => {
    const productionUrl = postgresFixtureUrl({
      host: 'pgbouncer.internal',
      port: 5432,
      database: 'fly-db',
    });
    const proxyUrl = postgresFixtureUrl({
      host: '127.0.0.1',
      port: 15432,
      database: 'fly-db',
    });

    expect(() => assertProductionDatabaseUrl(proxyUrl)).toThrow(/local database/);
    expect(
      getProductionDatabaseTargetUrl({
        DATABASE_URL: proxyUrl,
        PRODUCTION_DATABASE_URL: productionUrl,
      }),
    ).toBe(productionUrl);
    expect(
      getProductionDatabaseConnectionUrl({
        DATABASE_URL: proxyUrl,
        PRODUCTION_DATABASE_URL: productionUrl,
      }),
    ).toBe(proxyUrl);
    expect(
      getProductionDatabaseConnectionUrl({
        DATABASE_URL: productionUrl,
        PRODUCTION_DATABASE_URL: productionUrl,
      }),
    ).toBe(productionUrl);
    expect(() =>
      getProductionDatabaseConnectionUrl({
        DATABASE_URL: postgresFixtureUrl({
          host: 'staging.internal',
          port: 5432,
          database: 'fly-db',
        }),
        PRODUCTION_DATABASE_URL: productionUrl,
      }),
    ).toThrow(/local Fly proxy/);
  });

  it('seeds production card data only through the protected production environment', async () => {
    const workflow = await readProjectFile('.github/workflows/production-seed-cards.yml');

    expect(workflow).toContain('name: Production seed card data');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('data/extracted/**');
    expect(workflow).toContain('!data/extracted/scenario-section-books.json');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('name: production');
    expect(workflow).toContain('FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}');
    expect(workflow).toContain('PRODUCTION_DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}');
    expect(workflow).toContain('NODE_ENV: production');
    expect(workflow).toContain('SQUIRE_ENV: production');
    expect(workflow).toContain('superfly/flyctl-actions/setup-flyctl');
    expect(workflow).toContain('flyctl wireguard websockets enable');
    expect(workflow).toContain('flyctl proxy 15432:5432 "$remote_host" --app maz-squire');
    expect(workflow).toContain('echo "::add-mask::$proxied_url"');
    expect(workflow).toContain('run: npm run production-data:verify-db-url');
    expect(workflow).toContain('run: npm run db:migrate');
    expect(workflow).toContain('run: npm run seed:cards');
    expect(workflow).toContain('run: npm run production-data:check -- cards');
    expect(workflow).not.toContain('refresh-data');
  });

  it('seeds production scenario and section book data through a clear source trigger', async () => {
    const workflow = await readProjectFile(
      '.github/workflows/production-seed-scenario-section-books.yml',
    );

    expect(workflow).toContain('name: Production seed scenario and section books');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('data/extracted/scenario-section-books.json');
    expect(workflow).toContain('data/pdfs/**');
    expect(workflow).toContain('src/import-scenario-section-books.ts');
    expect(workflow).toContain('src/seed/seed-scenario-section-books.ts');
    expect(workflow).toContain('scripts/seed-scenario-section-books.ts');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('name: production');
    expect(workflow).toContain('PRODUCTION_DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}');
    expect(workflow).toContain('flyctl proxy 15432:5432 "$remote_host" --app maz-squire');
    expect(workflow).toContain('run: npm run production-data:verify-db-url');
    expect(workflow).toContain('run: npm run db:migrate');
    expect(workflow).toContain('run: npm run seed:scenario-section-books');
    expect(workflow).toContain('run: npm run production-data:check -- scenario-section-books');
  });

  it('indexes production rule sources with normal and protected rebuild modes', async () => {
    const workflow = await readProjectFile('.github/workflows/production-reindex-pdfs.yml');

    expect(workflow).toContain('name: Production reindex rule sources');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('data/pdfs/**');
    expect(workflow).toContain('data/rule-sources/**');
    expect(workflow).toContain('src/index-docs.ts');
    expect(workflow).toContain('src/vector-store.ts');
    expect(workflow).toContain('src/embedder.ts');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('rebuild:');
    expect(workflow).toContain('default: false');
    expect(workflow).toContain('name: production');
    expect(workflow).toContain('PRODUCTION_DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}');
    expect(workflow).toContain('flyctl proxy 15432:5432 "$remote_host" --app maz-squire');
    expect(workflow).toContain('run: npm run production-data:verify-db-url');
    expect(workflow).toContain('run: npm run db:migrate');
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && inputs.rebuild");
    expect(workflow).toContain('run: npm run production-data:truncate-embeddings');
    expect(workflow).toContain('run: npm run index');
    expect(workflow).toContain('run: npm run production-data:check -- embeddings');
  });

  it('documents normal production data refresh and recovery paths', async () => {
    const runbook = await readProjectFile('docs/runbooks/production-operations.md');

    for (const expected of [
      '## Production data lifecycle',
      'Production seed card data',
      'Production seed scenario and section books',
      'Production reindex rule sources',
      'PRODUCTION_DATABASE_URL',
      'data/extracted/',
      'data/extracted/scenario-section-books.json',
      'data/pdfs/',
      'data/rule-sources/',
      'npm run seed:cards',
      'npm run seed:scenario-section-books',
      'npm run index',
      'workflow_dispatch',
      'rebuild',
      'embedding model/version change',
      'Partial failure',
    ]) {
      expect(runbook).toContain(expected);
    }
  });
});
