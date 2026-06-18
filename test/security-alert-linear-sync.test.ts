import { describe, expect, it } from 'vitest';

import {
  collectRoutableAlerts,
  syncSecurityAlertsToLinear,
} from '../scripts/sync-security-alerts-to-linear.ts';
import type {
  LinearIssueCreateInput,
  LinearIssueRef,
  LinearIssueUpdateInput,
  LinearTargets,
  LinearUploadFile,
  SquireLinearClient,
} from '../src/linear-client.ts';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  });
}

class FakeSecurityLinearClient implements SquireLinearClient {
  readonly operations: string[] = [];
  readonly targets: LinearTargets = {
    teamId: 'team-id',
    projectId: 'project-id',
    labelIds: ['security-label-id'],
    labelName: 'Security',
  };

  createInputs: LinearIssueCreateInput[] = [];
  updateInputs: Array<{ id: string; input: LinearIssueUpdateInput }> = [];

  async resolveTargets(): Promise<LinearTargets> {
    this.operations.push('resolveTargets');
    return this.targets;
  }

  async findIssueByMarker(_teamKey: string, marker: string): Promise<LinearIssueRef | undefined> {
    this.operations.push('findIssueByMarker');
    if (marker !== 'github-security:maz-org/squire:code-scanning:21') return undefined;
    return {
      id: 'existing-id',
      identifier: 'SQR-999',
      url: 'https://linear.app/existing',
    };
  }

  async createIssue(input: LinearIssueCreateInput): Promise<LinearIssueRef> {
    this.operations.push('createIssue');
    this.createInputs.push(input);
    return {
      id: 'new-id',
      identifier: 'SQR-998',
      url: 'https://linear.app/new',
    };
  }

  async updateIssue(id: string, input: LinearIssueUpdateInput): Promise<LinearIssueRef> {
    this.operations.push('updateIssue');
    this.updateInputs.push({ id, input });
    return {
      id: 'existing-id',
      identifier: 'SQR-999',
      url: 'https://linear.app/existing',
    };
  }

  async createComment(_issueId: string, _body: string): Promise<void> {
    throw new Error('createComment should not be called');
  }

  async requestFileUpload(_input: {
    filename: string;
    contentType: string;
    size: number;
  }): Promise<LinearUploadFile> {
    throw new Error('requestFileUpload should not be called');
  }
}

describe('security alert Linear sync', () => {
  it('routes high and critical GitHub alerts into a normalized alert stream', async () => {
    const fetches: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      fetches.push(url);

      if (url.includes('/dependabot/alerts')) {
        return jsonResponse([
          {
            number: 11,
            state: 'open',
            html_url: 'https://github.com/maz-org/squire/security/dependabot/11',
            dependency: {
              package: { name: 'vite', ecosystem: 'npm' },
              manifest_path: 'package-lock.json',
            },
            security_advisory: {
              ghsa_id: 'GHSA-1111',
              severity: 'high',
              summary: 'vite dev server exposure',
              cve_id: 'CVE-2026-1111',
            },
            security_vulnerability: {
              vulnerable_version_range: '<1.2.3',
              patched_versions: '1.2.3',
            },
          },
          {
            number: 12,
            state: 'open',
            html_url: 'https://github.com/maz-org/squire/security/dependabot/12',
            dependency: { package: { name: 'left-pad', ecosystem: 'npm' } },
            security_advisory: {
              ghsa_id: 'GHSA-2222',
              severity: 'moderate',
              summary: 'moderate dependency alert',
            },
          },
        ]);
      }

      if (url.includes('/code-scanning/alerts')) {
        return jsonResponse([
          {
            number: 21,
            state: 'open',
            html_url: 'https://github.com/maz-org/squire/security/code-scanning/21',
            rule: {
              id: 'js/xss',
              description: 'Unsanitized user input',
              security_severity_level: 'critical',
            },
            most_recent_instance: {
              location: { path: 'src/server.ts', start_line: 42 },
            },
          },
          {
            number: 22,
            state: 'open',
            html_url: 'https://github.com/maz-org/squire/security/code-scanning/22',
            rule: {
              id: 'js/style',
              description: 'Style warning',
              security_severity_level: 'medium',
            },
          },
        ]);
      }

      if (url.includes('/secret-scanning/alerts')) {
        return jsonResponse([
          {
            number: 31,
            state: 'open',
            html_url: 'https://github.com/maz-org/squire/security/secret-scanning/31',
            secret_type_display_name: 'OpenAI API Key',
            secret_type: 'openai_api_key',
            validity: 'active',
          },
        ]);
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const alerts = await collectRoutableAlerts({
      repository: 'maz-org/squire',
      githubToken: 'gh-test-token',
      fetch,
    });

    expect(fetches).toHaveLength(3);
    expect(fetches).toEqual(
      expect.arrayContaining([
        'https://api.github.com/repos/maz-org/squire/dependabot/alerts?state=open&per_page=100',
        'https://api.github.com/repos/maz-org/squire/code-scanning/alerts?state=open&per_page=100',
        'https://api.github.com/repos/maz-org/squire/secret-scanning/alerts?state=open&per_page=100',
      ]),
    );
    expect(alerts.map((alert) => alert.key)).toEqual([
      'github-security:maz-org/squire:dependabot:11',
      'github-security:maz-org/squire:code-scanning:21',
      'github-security:maz-org/squire:secret-scanning:31',
    ]);
    expect(alerts.map((alert) => alert.severity)).toEqual(['high', 'critical', 'high']);
    expect(alerts[2]?.summary).toContain('GitHub secret scanning does not expose severity');
  });

  it('dry-runs without calling Linear', async () => {
    const logs: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('api.linear.app')) {
        throw new Error('dry-run should not call Linear');
      }
      if (url.includes('/dependabot/alerts')) {
        return jsonResponse([
          {
            number: 11,
            state: 'open',
            html_url: 'https://github.com/maz-org/squire/security/dependabot/11',
            dependency: { package: { name: 'vite', ecosystem: 'npm' } },
            security_advisory: {
              ghsa_id: 'GHSA-1111',
              severity: 'critical',
              summary: 'vite dev server exposure',
            },
          },
        ]);
      }
      return jsonResponse([]);
    };

    const result = await syncSecurityAlertsToLinear({
      repository: 'maz-org/squire',
      githubToken: 'gh-test-token',
      linearApiKey: undefined,
      linearTeamKey: 'SQR',
      linearProjectName: 'Squire · Security Alert Automation',
      dryRun: true,
      fetch,
      log: (message) => logs.push(message),
    });

    expect(result).toMatchObject({ created: 0, updated: 0, dryRun: 1, alerts: 1 });
    expect(logs.join('\n')).toContain(
      '[dry-run] would create/update critical dependabot alert #11',
    );
    expect(logs.join('\n')).toContain('github-security:maz-org/squire:dependabot:11');
  });

  it('keeps routing other alerts when secret scanning is not readable', async () => {
    const logs: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);

      if (url.includes('/dependabot/alerts')) {
        return jsonResponse([
          {
            number: 11,
            state: 'open',
            html_url: 'https://github.com/maz-org/squire/security/dependabot/11',
            dependency: { package: { name: 'vite', ecosystem: 'npm' } },
            security_advisory: {
              ghsa_id: 'GHSA-1111',
              severity: 'high',
              summary: 'vite dev server exposure',
            },
          },
        ]);
      }

      if (url.includes('/code-scanning/alerts')) {
        return jsonResponse([]);
      }

      if (url.includes('/secret-scanning/alerts')) {
        return new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const alerts = await collectRoutableAlerts({
      repository: 'maz-org/squire',
      githubToken: 'gh-test-token',
      fetch,
      log: (message) => logs.push(message),
    });

    expect(alerts.map((alert) => alert.key)).toEqual([
      'github-security:maz-org/squire:dependabot:11',
    ]);
    expect(logs.join('\n')).toContain(
      'Secret scanning alerts returned 403; skipping because the token cannot read this alert type',
    );
  });

  it('fails instead of suppressing secret scanning rate-limit 403s', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);

      if (url.includes('/dependabot/alerts') || url.includes('/code-scanning/alerts')) {
        return jsonResponse([]);
      }

      if (url.includes('/secret-scanning/alerts')) {
        return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    await expect(
      collectRoutableAlerts({
        repository: 'maz-org/squire',
        githubToken: 'gh-test-token',
        fetch,
      }),
    ).rejects.toThrow('Secret scanning alerts returned 403');
  });

  it('times out stalled GitHub alert requests', async () => {
    const fetch: typeof globalThis.fetch = async () => {
      return new Promise<Response>(() => undefined);
    };

    await expect(
      collectRoutableAlerts({
        repository: 'maz-org/squire',
        githubToken: 'gh-test-token',
        fetch,
        httpTimeoutMs: 1,
      }),
    ).rejects.toThrow('timed out after 1ms');
  });

  it('creates new Linear issues and updates existing ones by alert marker', async () => {
    const linearClient = new FakeSecurityLinearClient();
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);

      if (url.includes('/dependabot/alerts')) {
        return jsonResponse([
          {
            number: 11,
            state: 'open',
            html_url: 'https://github.com/maz-org/squire/security/dependabot/11',
            dependency: { package: { name: 'vite', ecosystem: 'npm' } },
            security_advisory: {
              ghsa_id: 'GHSA-1111',
              severity: 'high',
              summary: 'vite dev server exposure',
            },
          },
        ]);
      }
      if (url.includes('/code-scanning/alerts')) {
        return jsonResponse([
          {
            number: 21,
            state: 'open',
            html_url: 'https://github.com/maz-org/squire/security/code-scanning/21',
            rule: {
              id: 'js/xss',
              description: 'Unsanitized user input',
              security_severity_level: 'critical',
            },
          },
        ]);
      }
      return jsonResponse([]);
    };

    const result = await syncSecurityAlertsToLinear({
      repository: 'maz-org/squire',
      githubToken: 'gh-test-token',
      linearApiKey: 'lin-test-token',
      linearTeamKey: 'SQR',
      linearProjectName: 'Squire · Security Alert Automation',
      dryRun: false,
      fetch,
      linearClient,
      log: () => undefined,
    });

    expect(result).toMatchObject({ created: 1, updated: 1, dryRun: 0, alerts: 2 });
    expect(linearClient.createInputs[0]).toMatchObject({
      teamId: 'team-id',
      projectId: 'project-id',
      labelIds: ['security-label-id'],
      priority: 2,
    });
    expect(linearClient.updateInputs[0]).toMatchObject({
      id: 'existing-id',
      input: { labelIds: ['security-label-id'] },
    });
    expect(linearClient.operations).toEqual([
      'resolveTargets',
      'findIssueByMarker',
      'createIssue',
      'findIssueByMarker',
      'updateIssue',
    ]);
  });

  it('validates Linear configuration on live runs even when there are no alerts', async () => {
    const linearClient = new FakeSecurityLinearClient();
    const logs: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('api.linear.app')) throw new Error('test should use fake Linear client');
      return jsonResponse([]);
    };

    const result = await syncSecurityAlertsToLinear({
      repository: 'maz-org/squire',
      githubToken: 'gh-test-token',
      linearApiKey: 'lin-test-token',
      linearTeamKey: 'SQR',
      linearProjectName: 'Squire · Security Alert Automation',
      linearLabelName: 'Security',
      dryRun: false,
      fetch,
      linearClient,
      log: (message) => logs.push(message),
    });

    expect(result).toMatchObject({ created: 0, updated: 0, dryRun: 0, alerts: 0 });
    expect(linearClient.operations).toEqual(['resolveTargets']);
    expect(logs.join('\n')).toContain('Validated Linear target');
    expect(logs.join('\n')).toContain('No high or critical GitHub security alerts found.');
  });
});
