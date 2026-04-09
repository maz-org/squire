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
      agents: shared,
      claude: shared,
      development: 'AGENTS.md ~/.gstack/projects/maz-org-squire/ .mcp.json',
      mcp: JSON.stringify({ mcpServers: { squire: { url: 'http://localhost:3000/mcp' } } }),
    });

    expect(issues).toEqual([]);
  });

  it('reports missing shared references and MCP drift', () => {
    const issues = collectParityIssues({
      agents: '',
      claude: '',
      development: '',
      mcp: JSON.stringify({ mcpServers: { squire: { url: 'http://localhost:9999/mcp' } } }),
    });

    expect(issues).toContain('AGENTS.md is missing shared reference: docs/agent/issue-workflow.md');
    expect(issues).toContain('CLAUDE.md does not mention canonical gstack runtime state');
    expect(issues).toContain('docs/DEVELOPMENT.md does not mention AGENTS.md');
    expect(issues).toContain(
      '.mcp.json expected squire MCP URL http://localhost:3000/mcp, got http://localhost:9999/mcp',
    );
  });
});
