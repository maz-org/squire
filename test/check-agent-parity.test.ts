import { describe, expect, it } from 'vitest';

import { collectParityIssues } from '../scripts/check-agent-parity.ts';

describe('collectParityIssues', () => {
  it('passes when the required refs and MCP endpoint are present', () => {
    const shared = `
docs/agent/issue-workflow.md
docs/agent/testing.md
docs/agent/code-quality.md
docs/agent/shipping.md
docs/agent/review.md
docs/agent/planning-artifacts.md
docs/agent/adrs.md
DESIGN.md
docs/ARCHITECTURE.md
docs/DEVELOPMENT.md
~/.gstack/projects/maz-org-squire/
Repo-local \`.gstack/\`
`;

    const issues = collectParityIssues({
      agents: 'docs/agent/agent-baseline.md',
      baseline: shared,
      claude: 'docs/agent/agent-baseline.md',
      development: 'AGENTS.md ~/.gstack/projects/maz-org-squire/ .mcp.json',
      mcp: JSON.stringify({ mcpServers: { squire: { url: 'http://localhost:3000/mcp' } } }),
    });

    expect(issues).toEqual([]);
  });

  it('reports missing shared references and MCP drift', () => {
    const issues = collectParityIssues({
      agents: '',
      baseline: '',
      claude: '',
      development: '',
      mcp: JSON.stringify({ mcpServers: { squire: { url: 'http://localhost:9999/mcp' } } }),
    });

    expect(issues).toContain(
      'docs/agent/agent-baseline.md is missing shared reference: docs/agent/issue-workflow.md',
    );
    expect(issues).toContain('CLAUDE.md does not point to the shared baseline');
    expect(issues).toContain('docs/DEVELOPMENT.md does not mention AGENTS.md');
    expect(issues).toContain(
      '.mcp.json expected squire MCP URL http://localhost:3000/mcp, got http://localhost:9999/mcp',
    );
  });
});
