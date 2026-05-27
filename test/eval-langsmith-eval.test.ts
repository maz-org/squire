import { describe, expect, it, vi } from 'vitest';

const { mockEvaluate } = vi.hoisted(() => ({
  mockEvaluate: vi.fn(),
}));

vi.mock('langsmith/evaluation', () => ({
  evaluate: mockEvaluate,
}));

import { runLangSmithNativeEvalMatrix } from '../eval/langsmith-eval.ts';
import type { EvalProviderConfig } from '../eval/cli.ts';
import type { EvalMatrixRunner } from '../eval/matrix.ts';
import type { EvalCase } from '../eval/schema.ts';

const evalCase: EvalCase = {
  id: 'rule-poison',
  game: 'frosthaven',
  suite: 'table-qa',
  runtime: 'langgraph',
  caseCategory: 'rulebook',
  category: 'rulebook',
  source: 'unit-test',
  question: 'What is poison?',
  finalAnswer: {
    expected: 'Poison adds +1 to attacks.',
    grading: 'Mentions +1 attack.',
  },
  langsmithExampleId: 'example-rule-poison',
  langsmithDatasetId: 'dataset-fh-table',
  langsmithDatasetName: 'squire/frosthaven/table-qa',
};

const providerConfig: EvalProviderConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  reasoningEffort: undefined,
  maxOutputTokens: undefined,
  timeoutMs: undefined,
  toolLoopLimit: undefined,
};

describe('LangSmith native eval runner', () => {
  it('runs matrix rows through LangSmith evaluate with dataset examples', async () => {
    mockEvaluate.mockImplementation(async (target, options) => {
      const output = await target(options.data[0].inputs);
      return {
        experimentName: 'native-experiment',
        results: [
          {
            run: {
              id: 'native-run-id',
              outputs: output,
            },
            example: options.data[0],
            evaluationResults: { results: [] },
          },
        ],
      };
    });
    const client = {
      getProjectUrl: vi.fn(async () => 'https://smith.langchain.test/o/org/projects/p/native'),
    };
    const runner: EvalMatrixRunner = vi.fn(async (input) => ({
      ok: true,
      answer: 'Poison adds +1 attack.',
      traceId: input.traceId,
      traceUrl: input.traceUrl,
      score: 1,
      pass: true,
      latencyMs: 250,
      tokenUsage: { input: 10, output: 5, total: 15 },
      estimatedCostUsd: 0.01,
      toolCallCount: 1,
      loopIterations: 2,
      failureClass: 'none',
    }));

    const result = await runLangSmithNativeEvalMatrix({
      cases: [evalCase],
      examplesByDatasetName: new Map([
        [
          'squire/frosthaven/table-qa',
          [
            {
              id: 'example-rule-poison',
              dataset_id: 'dataset-fh-table',
              inputs: { question: evalCase.question, caseId: evalCase.id },
              outputs: { expectedOutput: { finalAnswer: evalCase.finalAnswer } },
              metadata: {},
              created_at: '2026-05-01T00:00:00.000Z',
              runs: [],
            },
          ],
        ],
      ]),
      runLabel: 'native-run',
      toolSurface: 'redesigned',
      selection: 'id',
      modelConfigs: [providerConfig],
      agentRuntimes: ['langgraph'],
      runner,
      guardrails: {
        allowFullDataset: false,
        allowEstimatedCostOverride: false,
        maxEstimatedCostUsd: 1,
        retryCount: 0,
        continueOnModelFailure: true,
        providerConcurrency: { anthropic: 2, openai: 1 },
      },
      client: client as never,
    });

    expect(mockEvaluate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: [expect.objectContaining({ id: 'example-rule-poison' })],
        experimentPrefix:
          'squire-eval-native-run-squire-frosthaven-table-qa-langgraph-anthropic-claude-sonnet-4-6',
        targetConcurrency: 2,
        evaluationConcurrency: 2,
      }),
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        evalCase: expect.objectContaining({ id: 'rule-poison' }),
        referenceExampleId: 'example-rule-poison',
      }),
    );
    expect(result.langsmithExperimentUrls).toEqual([
      'https://smith.langchain.test/o/org/projects/p/native',
    ]);
    expect(result.rows[0]).toMatchObject({
      traceId: 'native-run-id',
      traceUrl: 'https://smith.langchain.test/o/org/projects/p/native/r/native-run-id?poll=true',
      langsmithExperimentName: 'native-experiment',
      langsmithExperimentUrl: 'https://smith.langchain.test/o/org/projects/p/native',
      referenceExampleId: 'example-rule-poison',
    });
  });
});
