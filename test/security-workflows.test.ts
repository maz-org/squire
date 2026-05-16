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
});
