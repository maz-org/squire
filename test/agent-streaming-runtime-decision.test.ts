import { access, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function projectFileExists(path: string): Promise<boolean> {
  try {
    await access(new URL(`../${path}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

describe('agent streaming runtime decision docs', () => {
  it('keeps SQR-226 LangGraph adoption decision in durable architecture docs', async () => {
    const architecture = await readProjectFile('docs/ARCHITECTURE.md');
    const adr = await readProjectFile('docs/adr/0019-langgraph-production-knowledge-agent.md');

    for (const expected of [
      'Agent Streaming Runtime Closeout',
      'LangGraph as the production',
      'runtime, not eval-only, hidden QA only, canary-only, or dropped',
      'Final-answer-node routing',
      'Browser-visible progress rows',
      'Structured artifact events',
      'Updates/debug excluded from visible prose',
      'SQR-224, SQR-225, SQR-236, SQR-237, and SQR-238 are complete',
      'SQR-239 remains a',
      'normal retrieval-quality follow-up, not a blocker',
      'Deep Agents and remote LangSmith Agent Server stay out',
    ]) {
      expect(architecture).toContain(expected);
    }

    expect(architecture).toContain('[ADR 0019');
    expect(architecture).toContain('production LangGraph graph]');
    expect(architecture).toContain('`final_answer` is the only graph node');
    expect(architecture).toContain('`tool-progress` maps to persisted `answer-progress`');
    expect(architecture).toContain('`artifact` maps to persisted `answer-artifact`');

    expect(adr).toContain('status: active');
    expect(adr).toContain(
      'Replace the production knowledge-agent loop with a real LangGraph graph',
    );
    expect(adr).toContain('Only the `final_answer` node may emit answer-body text');
  });

  it('removes superseded Agent Streaming Runtime planning artifacts after promotion', async () => {
    for (const stalePlan of [
      'docs/plans/agent-streaming-runtime-practical-path.md',
      'docs/plans/agent-streaming-runtime-fuller-vision.md',
      'docs/plans/sqr-225-langgraph-runner-comparison.md',
      'docs/plans/sqr-225-production-langgraph-runtime-eng-review.md',
      'docs/plans/sqr-225-langsmith-smoke-matrix.json',
      'docs/plans/sqr-225-scenario-61-traversal-matrix.json',
      'docs/plans/sqr-225-scenario-61-unlock-matrix.json',
    ]) {
      await expect(projectFileExists(stalePlan)).resolves.toBe(false);
    }
  });
});
