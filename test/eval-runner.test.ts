import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseEvalArgs } from '../eval/cli.ts';
import { runEval } from '../eval/runner.ts';

describe('eval runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('honors estimated-cost guardrails for plain OpenAI Langfuse runs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      runEval(
        parseEvalArgs([
          '--provider=openai',
          '--model=gpt-5.5',
          '--id=rule-poison',
          '--run-label=plain-openai-cost-guardrail',
          '--max-estimated-cost-usd=0.001',
        ]),
        {},
      ),
    ).rejects.toThrow(/requires --allow-estimated-cost/);
  });
});
