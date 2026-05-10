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
    expect(dockerfile).toContain(`FROM node:${nvmrc}-bookworm-slim AS runtime`);
    expect(dockerfile).toContain('npm ci --omit=dev');
    expect(dockerfile).toContain('COPY --from=deps /app/node_modules ./node_modules');
    expect(dockerfile).toContain('COPY --chown=node:node src ./src');
    expect(dockerfile).toContain('COPY --chown=node:node scripts ./scripts');
    expect(dockerfile).toContain('ENV NODE_ENV=production');
    expect(dockerfile).toContain('ENV SQUIRE_ENV=production');
    expect(dockerfile).toContain('ENV PORT=8080');
    expect(dockerfile).toContain('EXPOSE 8080');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('/api/health');
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('CMD ["node", "src/server.ts"]');
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
  });

  it('documents migration failure and rollback operations', async () => {
    const runbook = await readProjectFile('docs/runbooks/deploy-rollback.md');

    expect(runbook).toContain('flyctl mpg create');
    expect(runbook).toContain('flyctl mpg attach <cluster-id>');
    expect(runbook).toContain('fly releases list');
    expect(runbook).toContain('fly logs');
    expect(runbook).toContain('fly deploy --image <prior-image>');
    expect(runbook).toContain('node scripts/db-migrate.ts');
    expect(runbook).toContain('schemas are not rolled back automatically');
  });
});
