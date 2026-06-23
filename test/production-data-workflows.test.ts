import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  assertProductionDatabaseUrl,
  getProductionDatabaseConnectionUrl,
  getProductionDatabaseTargetUrl,
  parseProductionDataOptions,
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

const productionDataMigrationWorkflowPaths = [
  '.github/workflows/production-seed-cards.yml',
  '.github/workflows/production-seed-scenario-section-books.yml',
  '.github/workflows/production-seed-unlock-graphs.yml',
  '.github/workflows/production-reindex-pdfs.yml',
];

type WorkflowConfig = {
  concurrency?: {
    group?: string;
    'cancel-in-progress'?: boolean;
  };
};

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
    expect(packageJson.scripts?.['production-data:smoke']).toBe(
      'node scripts/check-production-data.ts smoke',
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

  it('parses production data check commands with explicit game scopes', () => {
    expect(parseProductionDataOptions(['cards'])).toEqual({
      command: 'cards',
      games: ['frosthaven', 'gloomhaven-2e'],
    });
    expect(parseProductionDataOptions(['unlock-graphs'])).toEqual({
      command: 'unlock-graphs',
      games: ['frosthaven', 'gloomhaven-2e'],
    });
    expect(parseProductionDataOptions(['embeddings', '--game', 'gh2'])).toEqual({
      command: 'embeddings',
      games: ['gloomhaven-2e'],
    });
    expect(parseProductionDataOptions(['--game=gh2', 'smoke'])).toEqual({
      command: 'smoke',
      games: ['gloomhaven-2e'],
    });
    expect(
      parseProductionDataOptions(['scenario-section-books'], {
        SQUIRE_DATA_GAME: 'frosthaven',
      }),
    ).toEqual({
      command: 'scenario-section-books',
      games: ['frosthaven'],
    });
    expect(() => parseProductionDataOptions(['cards', '--game', 'jotl'])).toThrow(
      /Unsupported game id/,
    );
    // The unknown-command help text must list every accepted command, including
    // unlock-graphs and smoke (CodeRabbit on #543).
    expect(() => parseProductionDataOptions(['bogus'])).toThrow(
      /cards, scenario-section-books, unlock-graphs, embeddings, all, smoke, verify-url, or truncate-embeddings/,
    );
  });

  it('serializes production data workflows before they run production migrations', async () => {
    for (const workflowPath of productionDataMigrationWorkflowPaths) {
      const workflow = parse(await readProjectFile(workflowPath)) as WorkflowConfig;

      expect(workflow.concurrency, workflowPath).toEqual({
        group: 'production-data-db',
        'cancel-in-progress': false,
      });
    }
  });

  it('seeds production card data only through the protected production environment', async () => {
    const workflow = await readProjectFile('.github/workflows/production-seed-cards.yml');

    expect(workflow).toContain('name: Production seed card data');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('data/extracted/**');
    expect(workflow).toContain('!data/extracted/scenario-section-books.json');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('game:');
    expect(workflow).toContain('options:');
    expect(workflow).toContain('- all');
    expect(workflow).toContain('- frosthaven');
    expect(workflow).toContain('- gloomhaven-2e');
    expect(workflow).toContain('name: production');
    expect(workflow).toContain('FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}');
    expect(workflow).toContain('PRODUCTION_DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}');
    expect(workflow).toContain('NODE_ENV: production');
    expect(workflow).toContain('SQUIRE_ENV: production');
    expect(workflow).toContain("SQUIRE_DATA_GAME: ${{ github.event.inputs.game || 'all' }}");
    expect(workflow).toContain("SQUIRE_SEED_GAME: ${{ github.event.inputs.game || 'all' }}");
    expect(workflow).toContain('superfly/flyctl-actions/setup-flyctl');
    expect(workflow).toContain('flyctl wireguard websockets enable');
    expect(workflow).toContain('flyctl proxy 15432:5432 "$remote_host" --app maz-squire');
    expect(workflow).toContain('echo "::add-mask::$proxied_url"');
    expect(workflow).toContain('run: npm run production-data:verify-db-url');
    expect(workflow).toContain('run: npm run db:migrate');
    expect(workflow).toContain('run: npm run seed:cards');
    expect(workflow).toContain('npm run production-data:check -- cards --game "$SQUIRE_DATA_GAME"');
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
    expect(workflow).toContain('game:');
    expect(workflow).toContain('- all');
    expect(workflow).toContain('- frosthaven');
    expect(workflow).toContain('- gloomhaven-2e');
    expect(workflow).toContain('name: production');
    expect(workflow).toContain('PRODUCTION_DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}');
    expect(workflow).toContain("SQUIRE_DATA_GAME: ${{ github.event.inputs.game || 'all' }}");
    expect(workflow).toContain("SQUIRE_SEED_GAME: ${{ github.event.inputs.game || 'all' }}");
    expect(workflow).toContain('flyctl proxy 15432:5432 "$remote_host" --app maz-squire');
    expect(workflow).toContain('run: npm run production-data:verify-db-url');
    expect(workflow).toContain('run: npm run db:migrate');
    expect(workflow).toContain('run: npm run seed:scenario-section-books');
    expect(workflow).toContain(
      'npm run production-data:check -- scenario-section-books --game "$SQUIRE_DATA_GAME"',
    );
  });

  it('seeds production unlock graphs through the protected production environment', async () => {
    const workflow = await readProjectFile('.github/workflows/production-seed-unlock-graphs.yml');

    expect(workflow).toContain('name: Production seed unlock graphs');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('data/extracted/unlock-graphs/**');
    expect(workflow).toContain('scripts/seed-unlock-graphs.ts');
    expect(workflow).toContain('src/seed/seed-unlock-graphs.ts');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('name: production');
    expect(workflow).toContain('FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}');
    expect(workflow).toContain('PRODUCTION_DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}');
    expect(workflow).toContain('NODE_ENV: production');
    expect(workflow).toContain('SQUIRE_ENV: production');
    expect(workflow).toContain('superfly/flyctl-actions/setup-flyctl');
    expect(workflow).toContain('flyctl proxy 15432:5432 "$remote_host" --app maz-squire');
    expect(workflow).toContain('echo "::add-mask::$proxied_url"');
    expect(workflow).toContain('run: npm run production-data:verify-db-url');
    expect(workflow).toContain('run: npm run db:migrate');
    expect(workflow).toContain('run: npm run seed:unlock-graphs');
    expect(workflow).toContain('npm run production-data:check -- unlock-graphs');
    // The seed is all-modules: no game input, unlike the card/scenario workflows.
    expect(workflow).not.toContain('inputs.game');
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
    expect(workflow).toContain('src/retrieval-source.ts');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('rebuild:');
    expect(workflow).toContain('game:');
    expect(workflow).toContain('- all');
    expect(workflow).toContain('- frosthaven');
    expect(workflow).toContain('- gloomhaven-2e');
    expect(workflow).toContain('default: false');
    expect(workflow).toContain('name: production');
    expect(workflow).toContain('PRODUCTION_DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}');
    expect(workflow).toContain("SQUIRE_DATA_GAME: ${{ github.event.inputs.game || 'all' }}");
    expect(workflow).toContain("SQUIRE_INDEX_GAME: ${{ github.event.inputs.game || 'all' }}");
    expect(workflow).toContain('flyctl proxy 15432:5432 "$remote_host" --app maz-squire');
    expect(workflow).toContain('run: npm run production-data:verify-db-url');
    expect(workflow).toContain('run: npm run db:migrate');
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && inputs.rebuild");
    expect(workflow).toContain('run: npm run production-data:truncate-embeddings');
    expect(workflow).toContain('run: npm run index');
    expect(workflow).toContain(
      'npm run production-data:check -- embeddings --game "$SQUIRE_DATA_GAME"',
    );
    expect(workflow).toContain('npm run production-data:smoke -- --game "$SQUIRE_DATA_GAME"');
  });

  it('waits for production rule-source reindex before Fly deploy when retrieval changed', async () => {
    const workflow = await readProjectFile('.github/workflows/deploy.yml');

    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('Wait for production rule-source reindex when retrieval changed');
    expect(workflow).toContain('gh api "repos/${{ github.repository }}/commits/$HEAD_SHA"');
    expect(workflow).toContain('src/vector-store\\.ts');
    expect(workflow).toContain('production-reindex-pdfs.yml');
    expect(workflow).toContain('gh run watch "$run_id" --exit-status --interval 30');
    expect(
      workflow.indexOf('Wait for production rule-source reindex when retrieval changed'),
    ).toBeLessThan(workflow.indexOf('- name: Deploy to Fly'));
  });
});
