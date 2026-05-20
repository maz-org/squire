import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('security workflows', () => {
  it('reviews dependency changes on pull requests', async () => {
    const workflow = await readProjectFile('.github/workflows/dependency-review.yml');
    const securityDocs = await readProjectFile('docs/SECURITY.md');

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

    expect(securityDocs).toContain('Dependency Review');
    expect(securityDocs).toContain('high and critical runtime vulnerabilities');
    expect(securityDocs).toContain('low and moderate findings stay non-blocking');
  });

  it('keeps the MCP threat model aligned with the bearer-auth route', async () => {
    const securityDocs = await readProjectFile('docs/SECURITY.md');
    const server = await readProjectFile('src/server.ts');

    expect(server).toContain("app.use('/mcp', requireBearerAuth())");
    expect(securityDocs).toContain('MCP Bearer-Auth Boundary');
    expect(securityDocs).toContain('The `/mcp` endpoint is no longer pre-auth');
    expect(securityDocs).toContain('Keep `/mcp` behind `requireBearerAuth()`');
    expect(securityDocs).not.toContain('The `/mcp` endpoint is currently open with no auth');
    expect(securityDocs).not.toContain('Do not deploy to a public network until auth is wired up');
  });

  it('routes high and critical security alerts into Linear', async () => {
    const workflow = await readProjectFile('.github/workflows/security-alert-linear-sync.yml');
    const securityDocs = await readProjectFile('docs/SECURITY.md');
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

    expect(securityDocs).toContain('Security Alert Linear Sync');
    expect(securityDocs).toContain('Dependabot, CodeQL code scanning, and secret scanning');
    expect(securityDocs).toContain('Linear `Security` label');
    expect(securityDocs).toContain('npm run security:alerts:validate-config');
    expect(securityDocs).toContain('Secret scanning alert reads require');
    expect(securityDocs).toContain('SECURITY_ALERT_DRY_RUN=1');
  });
});
