import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('security workflows', () => {
  it('reviews dependency changes on pull requests', async () => {
    const workflow = await readProjectFile('.github/workflows/dependency-review.yml');

    expect(workflow).toContain('name: Dependency Review');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('name: dependency-review');
    expect(workflow).toContain('uses: actions/checkout@v6');
    expect(workflow).toContain('uses: actions/dependency-review-action@v5');
    expect(workflow).toContain('fail-on-severity: high');
    expect(workflow).toContain('fail-on-scopes: runtime');
    expect(workflow).toContain('license-check: false');
    expect(workflow).toContain('show-patched-versions: true');
  });

  it('defines the CodeQL workflow', async () => {
    const workflow = await readProjectFile('.github/workflows/codeql.yml');

    expect(workflow).toContain('name: CodeQL');
    expect(workflow).toContain('push:');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('security-events: write');
    expect(workflow).toContain('language: [javascript, actions]');
    expect(workflow).toContain('uses: github/codeql-action/init@v4');
    expect(workflow).toContain('uses: github/codeql-action/analyze@v4');
  });

  it('keeps the MCP route behind bearer auth', async () => {
    const server = await readProjectFile('src/server.ts');

    expect(server).toContain("app.use('/mcp', requireMcpAuthAndRateLimit())");
  });

  it('routes high and critical security alerts into Linear', async () => {
    const workflow = await readProjectFile('.github/workflows/security-alert-linear-sync.yml');
    const packageJson = JSON.parse(await readProjectFile('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['security:alerts:dry-run']).toBe(
      'SECURITY_ALERT_DRY_RUN=1 node scripts/sync-security-alerts-to-linear.ts',
    );
    expect(packageJson.scripts?.['security:alerts:validate-config']).toBe(
      'node scripts/sync-security-alerts-to-linear.ts --validate-config',
    );

    expect(workflow).toContain('name: Security Alert Linear Sync');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('permissions: read-all');
    expect(workflow).toContain('SECURITY_ALERT_REPOSITORY: ${{ github.repository }}');
    expect(workflow).toContain('LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}');
    expect(workflow).toContain('SECURITY_ALERT_LINEAR_TEAM_KEY: SQR');
    expect(workflow).toContain('SECURITY_ALERT_LINEAR_PROJECT: Squire · Security Alert Automation');
    expect(workflow).toContain('SECURITY_ALERT_LINEAR_LABEL: Security');
    expect(workflow).toContain('node scripts/sync-security-alerts-to-linear.ts');
  });
});
