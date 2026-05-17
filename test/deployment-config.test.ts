import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

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
  });

  it('uses Fly release commands for migrate-before-cutover deploys', async () => {
    const flyConfig = await readProjectFile('fly.toml');

    expect(flyConfig).toContain('app = "maz-squire"');
    expect(flyConfig).toContain('SQUIRE_ENV = "production"');
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

  it('enables auto-merge with an app token so main push workflows run', async () => {
    const workflow = await readProjectFile('.github/workflows/auto-merge.yml');

    expect(workflow).toContain(
      'if: github.event.pull_request.head.repo.full_name == github.repository',
    );
    expect(workflow).toContain('uses: actions/create-github-app-token@v3');
    expect(workflow).toContain('app-id: ${{ secrets.AUTO_MERGE_APP_ID }}');
    expect(workflow).toContain('private-key: ${{ secrets.AUTO_MERGE_PRIVATE_KEY }}');
    expect(workflow).toContain('GH_TOKEN: ${{ steps.app-token.outputs.token }}');
    expect(workflow).not.toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
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
