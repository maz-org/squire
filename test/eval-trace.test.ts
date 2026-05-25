import { describe, expect, it } from 'vitest';

import {
  compositeEvalTraceWriter,
  redactTracePayload,
  TRACE_REDACTION_PLACEHOLDER,
  withEvalTraceEnvironment,
  type EvalTraceInput,
} from '../eval/trace.ts';

const baseTrace: EvalTraceInput = {
  traceId: 'trace-1',
  runLabel: 'unit',
  datasetName: 'frosthaven-qa',
  caseId: 'case-1',
  caseCategory: 'rules',
  agentRuntime: 'langgraph',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  resolvedModel: 'langgraph:claude-sonnet-4-6',
  promptVersion: 'prompt-v1',
  promptHash: 'sha256:prompt',
  toolSurface: 'redesigned',
  toolSchemaVersion: 'tools-v1',
  toolSchemaHash: 'sha256:tools',
  modelSettings: {},
  inputQuestion: 'question',
  finalAnswer: 'answer',
  statusReason: 'completed',
  stopReason: 'end_turn',
  startedAt: '2026-05-01T00:00:00.000Z',
  providerRequest: {},
  providerResponse: {},
  providerNativeTranscript: {},
  tokenUsage: { input: 1, output: 1, total: 2 },
  costEstimate: { totalUsd: 0 },
  errors: [],
  retries: [],
  toolCalls: [],
  judgeScores: [],
};

describe('eval trace helpers', () => {
  it('redacts secret-shaped keys and values', () => {
    expect(
      redactTracePayload({
        authorization: 'Bearer abcdefghijklmnop',
        nested: { apiKey: 'sk-live-abcdefghijklmnopqrstuvwxyz' },
      }),
    ).toEqual({
      authorization: TRACE_REDACTION_PLACEHOLDER,
      nested: { apiKey: TRACE_REDACTION_PLACEHOLDER },
    });
  });

  it('adds the resolved Squire environment when missing', async () => {
    const calls: EvalTraceInput[] = [];
    const writer = withEvalTraceEnvironment(
      { writeTrace: async (input) => void calls.push(input) },
      { SQUIRE_ENV: 'test' },
    );

    await writer.writeTrace({ ...baseTrace, environment: undefined });
    await writer.writeTrace({ ...baseTrace, environment: 'development' });

    expect(calls.map((call) => call.environment)).toEqual(['test', 'development']);
  });

  it('fails if any composite writer fails', async () => {
    const writer = compositeEvalTraceWriter([
      { writeTrace: async () => undefined },
      {
        async writeTrace() {
          throw new Error('trace failed');
        },
      },
    ]);

    await expect(writer.writeTrace(baseTrace)).rejects.toThrow('trace failed');
  });
});
