import { readFileSync } from 'node:fs';

type ParityFiles = {
  agents: string;
  claude: string;
  development: string;
  mcp: string;
};

export function collectParityIssues(files: ParityFiles): string[] {
  const issues: string[] = [];

  const requiredSharedRefs = [
    'docs/agent/issue-workflow.md',
    'docs/agent/testing.md',
    'docs/agent/code-quality.md',
    'docs/agent/shipping.md',
    'docs/agent/review.md',
    'docs/agent/planning-artifacts.md',
    'docs/agent/adrs.md',
    'DESIGN.md',
    'docs/ARCHITECTURE.md',
    'docs/DEVELOPMENT.md',
  ];

  for (const ref of requiredSharedRefs) {
    if (!files.agents.includes(ref)) {
      issues.push(`AGENTS.md is missing shared reference: ${ref}`);
    }
    if (!files.claude.includes(ref)) {
      issues.push(`CLAUDE.md is missing shared reference: ${ref}`);
    }
  }

  if (!files.agents.includes('~/.gstack/projects/maz-org-squire/')) {
    issues.push('AGENTS.md does not mention canonical gstack runtime state');
  }
  if (!files.claude.includes('~/.gstack/projects/maz-org-squire/')) {
    issues.push('CLAUDE.md does not mention canonical gstack runtime state');
  }
  if (!files.agents.includes('Repo-local `.gstack/`')) {
    issues.push('AGENTS.md does not clarify repo-local `.gstack/`');
  }
  if (!files.claude.includes('Repo-local `.gstack/`')) {
    issues.push('CLAUDE.md does not clarify repo-local `.gstack/`');
  }

  if (!files.development.includes('AGENTS.md')) {
    issues.push('docs/DEVELOPMENT.md does not mention AGENTS.md');
  }
  if (!files.development.includes('~/.gstack/projects/maz-org-squire/')) {
    issues.push('docs/DEVELOPMENT.md does not mention canonical gstack runtime state');
  }
  if (!files.development.includes('.mcp.json')) {
    issues.push('docs/DEVELOPMENT.md does not mention repo-local MCP config');
  }

  let parsedMcp: unknown;
  try {
    parsedMcp = JSON.parse(files.mcp);
  } catch {
    issues.push('.mcp.json is not valid JSON');
    return issues;
  }

  const url = (parsedMcp as { mcpServers?: { squire?: { url?: unknown } } }).mcpServers?.squire
    ?.url;
  if (url !== 'http://localhost:3000/mcp') {
    issues.push(`.mcp.json expected squire MCP URL http://localhost:3000/mcp, got ${String(url)}`);
  }

  return issues;
}

export function readRepoParityFiles(): ParityFiles {
  return {
    agents: readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8'),
    claude: readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8'),
    development: readFileSync(new URL('../docs/DEVELOPMENT.md', import.meta.url), 'utf8'),
    mcp: readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const issues = collectParityIssues(readRepoParityFiles());
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }
  console.log('Agent parity check passed.');
}
