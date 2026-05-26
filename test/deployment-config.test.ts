import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

type DependabotGroup = {
  'applies-to'?: string;
  'dependency-type'?: string;
  'exclude-patterns'?: string[];
  patterns?: string[];
};

type DependabotUpdate = {
  'package-ecosystem'?: string;
  groups?: Record<string, DependabotGroup>;
  ignore?: Array<{
    'dependency-name'?: string;
    versions?: string[];
  }>;
};

describe('deployment configuration', () => {
  it('defines the production container contract', async () => {
    const dockerfile = await readProjectFile('Dockerfile');
    const nvmrc = (await readProjectFile('.nvmrc')).trim();

    expect(dockerfile).toContain(`FROM node:${nvmrc}-bookworm-slim AS deps`);
    expect(dockerfile).toContain('FROM deps AS assets');
    expect(dockerfile).toContain(`FROM node:${nvmrc}-bookworm-slim AS runtime`);
    expect(dockerfile).toContain('npm ci --omit=dev');
    expect(dockerfile).toContain('RUN npm run build:web-assets');
    expect(dockerfile).toContain('supercronic-linux-amd64');
    expect(dockerfile).toContain('COPY --from=deps /app/node_modules ./node_modules');
    expect(dockerfile).toContain('COPY --from=assets /app/dist ./dist');
    expect(dockerfile).toContain(
      'COPY --chown=node:node data/rule-sources/metadata.json ./data/rule-sources/metadata.json',
    );
    expect(dockerfile).toContain('COPY --chown=node:node src ./src');
    expect(dockerfile).toContain('COPY --chown=node:node scripts ./scripts');
    expect(dockerfile).toContain('COPY --chown=node:node crontab ./crontab');
    expect(dockerfile).toContain('ENV NODE_ENV=production');
    expect(dockerfile).toContain('ENV SQUIRE_ENV=production');
    expect(dockerfile).toContain('ENV PORT=8080');
    expect(dockerfile).toContain('EXPOSE 8080');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('/api/health');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('CMD ["node", "src/server.ts"]');
  });

  it('defines a deploy-time web asset build command', async () => {
    const packageJson = JSON.parse(await readProjectFile('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['build:web-assets']).toBe('node scripts/build-web-assets.ts');
  });

  it('defines a manual GitHub Actions lint command', async () => {
    const packageJson = JSON.parse(await readProjectFile('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['lint:actions']).toBe('actionlint');
  });

  it('splits fast PR tests from DB-backed and slow PDF extraction tests', async () => {
    const packageJson = JSON.parse(await readProjectFile('package.json')) as {
      scripts?: Record<string, string>;
    };
    const workflow = await readProjectFile('.github/workflows/ci.yml');

    expect(packageJson.scripts?.test).toBe('vitest run --config vitest.split.config.ts');
    expect(packageJson.scripts?.['test:unit']).toBe('vitest run --config vitest.unit.config.ts');
    expect(packageJson.scripts?.['test:db']).toBe('vitest run --config vitest.db.config.ts');
    expect(packageJson.scripts?.['test:split']).toBe('vitest run --config vitest.split.config.ts');
    expect(packageJson.scripts?.['test:coverage']).toBe(
      'vitest run --coverage --config vitest.split.config.ts',
    );
    expect(packageJson.scripts?.['test:coverage:serial']).toBe(
      'vitest run --coverage --exclude test/import-scenario-section-books.test.ts',
    );
    expect(packageJson.scripts?.['test:slow:pdf']).toBe(
      'vitest run test/import-scenario-section-books.test.ts',
    );
    expect(packageJson.scripts?.['test:full']).toBe('vitest run');
    expect(packageJson.scripts?.['test:coverage:full']).toBe('vitest run --coverage');
    expect(workflow).toContain('cron:');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('run: npm run test:coverage');
    expect(workflow).toContain('name: Slow PDF extraction test');
    expect(workflow).toContain("github.event_name == 'schedule'");
    expect(workflow).toContain('run: npm run test:slow:pdf');
    expect(workflow).not.toContain('run: npx vitest run --coverage');
  });

  it('defines a Fly cron process for expired session cleanup', async () => {
    const flyConfig = await readProjectFile('fly.toml');
    const crontab = await readProjectFile('crontab');
    const packageJson = JSON.parse(await readProjectFile('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['sessions:sweep-expired']).toBe(
      'node scripts/sweep-expired-sessions.ts',
    );
    expect(flyConfig).toContain('[processes]');
    expect(flyConfig).toContain('app = "node src/server.ts"');
    expect(flyConfig).toContain('cron = "supercronic /app/crontab"');
    expect(flyConfig).toContain('processes = ["app"]');
    expect(crontab).toContain('node scripts/sweep-expired-sessions.ts');
  });

  it('keeps deploy-only and secret material out of the Docker context', async () => {
    const dockerignore = await readProjectFile('.dockerignore');

    for (const ignoredPath of [
      '.env',
      '.env.*',
      '.git',
      'data/',
      'docs/',
      'eval/',
      'test/',
      '.gstack/',
      '.vscode/',
      '.idea/',
    ]) {
      expect(dockerignore).toContain(ignoredPath);
    }

    // The runtime app reads this provenance manifest directly, but the bulk
    // rule-source snapshots and PDFs should stay out of production images.
    expect(dockerignore).toContain('!data/');
    expect(dockerignore).toContain('data/*');
    expect(dockerignore).toContain('!data/rule-sources/');
    expect(dockerignore).toContain('data/rule-sources/*');
    expect(dockerignore).toContain('!data/rule-sources/metadata.json');
  });

  it('uses Fly release commands for migrate-before-cutover deploys', async () => {
    const flyConfig = await readProjectFile('fly.toml');

    expect(flyConfig).toContain('app = "maz-squire"');
    expect(flyConfig).toContain('SQUIRE_ENV = "production"');
    expect(flyConfig).toContain('LANGSMITH_TRACING = "true"');
    expect(flyConfig).toContain('release_command = "node scripts/db-migrate.ts"');
    expect(flyConfig).toContain('internal_port = 8080');
    expect(flyConfig).toContain('auto_stop_machines = "off"');
    expect(flyConfig).toContain('min_machines_running = 1');
    expect(flyConfig).toContain('idle_timeout = 600');
    expect(flyConfig).toContain('size = "shared-cpu-1x"');
    expect(flyConfig).toContain('memory = "1gb"');
    expect(flyConfig).toContain('processes = ["app"]');
    expect(flyConfig).toContain('memory = "256mb"');
    expect(flyConfig).toContain('processes = ["cron"]');
  });

  it('documents migration failure and rollback operations', async () => {
    const runbook = await readProjectFile('docs/runbooks/deploy-rollback.md');

    expect(runbook).toContain('flyctl mpg create');
    expect(runbook).toContain('flyctl mpg attach <cluster-id>');
    expect(runbook).toContain('Extensions page');
    expect(runbook).toContain('Extension: `vector`');
    expect(runbook).toContain('fly releases -a maz-squire --image');
    expect(runbook).toContain('fly logs');
    expect(runbook).toContain('fly deploy --image <prior-image>');
    expect(runbook).toContain('node scripts/db-migrate.ts');
    expect(runbook).toContain('schemas are not rolled back automatically');
  });

  it('deploys main to Fly only after CI succeeds', async () => {
    const workflow = await readProjectFile('.github/workflows/deploy.yml');

    expect(workflow).toContain('name: Deploy to Fly');
    expect(workflow).toContain('workflow_run:');
    expect(workflow).toContain('workflows: [CI]');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(workflow).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository',
    );
    expect(workflow).toContain('deployments: write');
    expect(workflow).toContain('name: production');
    expect(workflow).toContain('url: https://squire.maz.org');
    expect(workflow).toContain('group: fly-production');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}');
    expect(workflow).toMatch(/superfly\/flyctl-actions\/setup-flyctl@[a-f0-9]{40}/);
    expect(workflow).not.toContain('setup-flyctl@master');
    expect(workflow).toContain('flyctl deploy -a maz-squire --remote-only');
    expect(workflow).not.toContain('npm run db:migrate');
    expect(workflow).not.toContain('scripts/db-migrate.ts');
  });

  it('runs actionlint in CI for GitHub workflow changes', async () => {
    const workflow = await readProjectFile('.github/workflows/ci.yml');

    expect(workflow).toContain('ACTIONLINT_VERSION: v1.7.12');
    expect(workflow).toContain('attestations: read');
    expect(workflow).toContain('rhysd/actionlint/releases/download/${ACTIONLINT_VERSION}');
    expect(workflow).toContain('actionlint_${ACTIONLINT_VERSION#v}_linux_amd64.tar.gz');
    expect(workflow).toContain('gh attestation verify --repo rhysd/actionlint');
    expect(workflow).toContain('actionlint_${ACTIONLINT_VERSION#v}_checksums.txt');
    expect(workflow).toContain('name: Lint GitHub Actions');
    expect(workflow).toContain('run: actionlint');
  });

  it('limits app-token auto-merge to Dependabot patch and minor PRs', async () => {
    await expect(readProjectFile('.github/workflows/auto-merge.yml')).rejects.toThrow();

    const workflow = await readProjectFile('.github/workflows/dependabot-auto-merge.yml');

    expect(workflow).toContain("if: github.actor == 'dependabot[bot]'");
    expect(workflow).toContain('uses: actions/create-github-app-token@v3');
    expect(workflow).toContain('app-id: ${{ secrets.AUTO_MERGE_APP_ID }}');
    expect(workflow).toContain('private-key: ${{ secrets.AUTO_MERGE_PRIVATE_KEY }}');
    expect(workflow).toContain(
      "steps.metadata.outputs.update-type == 'version-update:semver-patch'",
    );
    expect(workflow).toContain(
      "steps.metadata.outputs.update-type == 'version-update:semver-minor'",
    );
    expect(workflow).toContain('gh pr review --approve "$PR_URL"');
    expect(workflow).toContain('gh pr merge --auto --squash "$PR_URL"');
    expect(workflow).toContain('GH_TOKEN: ${{ steps.app-token.outputs.token }}');
    expect(workflow).not.toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
    expect(workflow).not.toContain('security-update');
  });

  it('groups Dependabot security updates explicitly', async () => {
    const dependabotConfig = parse(await readProjectFile('.github/dependabot.yml')) as {
      updates?: DependabotUpdate[];
    };

    const updates = dependabotConfig.updates ?? [];
    const npmUpdate = updates.find((update) => update['package-ecosystem'] === 'npm');
    const githubActionsUpdate = updates.find(
      (update) => update['package-ecosystem'] === 'github-actions',
    );

    expect(npmUpdate?.groups?.['npm-security-updates']).toMatchObject({
      'applies-to': 'security-updates',
      patterns: ['*'],
    });
    expect(githubActionsUpdate?.groups?.['github-actions-security-updates']).toMatchObject({
      'applies-to': 'security-updates',
      patterns: ['*'],
    });
    expect(npmUpdate?.groups?.['dev-dependencies']).toMatchObject({
      'dependency-type': 'development',
      'exclude-patterns': ['typescript'],
    });
    expect(npmUpdate?.ignore).toContainEqual({
      'dependency-name': 'typescript',
      versions: ['>=6.0.0'],
    });
  });

  it('documents GitHub deploy token setup and post-deploy smoke checks', async () => {
    const runbook = await readProjectFile('docs/runbooks/deploy-rollback.md');

    expect(runbook).toContain('fly tokens create deploy');
    expect(runbook).toContain('FLY_API_TOKEN');
    expect(runbook).toContain('AUTO_MERGE_APP_*');
    expect(runbook).toContain('Deploy to Fly');
    expect(runbook).toContain('node scripts/check-deploy-health.ts');
    expect(runbook).toContain('https://maz-squire.fly.dev/api/live');
    expect(runbook).toContain('https://maz-squire.fly.dev/api/health');
  });
});
