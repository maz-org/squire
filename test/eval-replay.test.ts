import { describe, expect, it } from 'vitest';

import {
  diffEvalTraces,
  formatEvalTraceDiff,
  replayEvalFailure,
  renderEvalTraceTranscript,
  replayTraceIdCandidates,
  type LangfuseEvalTrace,
} from '../eval/replay.ts';

function trace(overrides: Partial<LangfuseEvalTrace>): LangfuseEvalTrace {
  return {
    id: 'eval:debug-run:anthropic:claude-sonnet-4-6:alchemy-cost',
    name: 'eval.case',
    input: { question: 'What does level 1 Alchemist cost?' },
    output: {
      finalAnswer: 'It has no cost.',
      statusReason: 'quality',
    },
    metadata: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      runLabel: 'debug-run',
      caseId: 'alchemy-cost',
      caseCategory: 'buildings',
      toolSurface: 'redesigned',
      statusReason: 'quality',
    },
    observations: [
      {
        id: 'generation',
        type: 'GENERATION',
        name: 'eval.model_call',
        model: 'claude-sonnet-4-6',
        input: { request: { question: 'What does level 1 Alchemist cost?' } },
        output: { finalAnswer: 'It has no cost.' },
        usageDetails: { input: 50, output: 20, total: 70 },
        metadata: {
          stopReason: 'end_turn',
          statusReason: 'quality',
          providerNativeTranscript: {
            modelCalls: [
              {
                stopReason: 'tool_use',
                durationMs: 1250,
              },
            ],
          },
        },
      },
      {
        id: 'tool-1',
        type: 'SPAN',
        name: 'eval.tool_call.open_entity',
        input: { type: 'building', name: 'Alchemist' },
        output: {
          outputSummary: 'json object (name, level, secret)',
          secret: 'apiKey=sk-live-abcdefghijklmnopqrstuvwxyz',
        },
        metadata: {
          toolName: 'open_entity',
          callIndex: 0,
          ok: true,
          canonicalRefs: ['building:alchemist:1'],
          retries: [],
          errors: [],
        },
      },
    ],
    scores: [
      {
        id: 'score-pass',
        traceId: 'eval:debug-run:anthropic:claude-sonnet-4-6:alchemy-cost',
        name: 'pass',
        dataType: 'CATEGORICAL',
        value: 0,
        stringValue: 'fail',
        comment: 'Expected the upgrade cost, not the initial build state.',
      },
      {
        id: 'score-failure-class',
        traceId: 'eval:debug-run:anthropic:claude-sonnet-4-6:alchemy-cost',
        name: 'failure_class',
        dataType: 'CATEGORICAL',
        value: 0,
        stringValue: 'answer_quality',
      },
    ],
    htmlPath: '/project/demo/traces/eval:debug-run:anthropic:claude-sonnet-4-6:alchemy-cost',
    ...overrides,
  };
}

describe('eval replay debugging', () => {
  it('replays one failed case from Langfuse trace data as a readable transcript', async () => {
    const fetched = trace({});
    const result = await replayEvalFailure({
      client: {
        api: {
          trace: {
            get: async (traceId) => {
              expect(traceId).toBe('eval:debug-run:anthropic:claude-sonnet-4-6:alchemy-cost');
              return fetched;
            },
          },
        },
        getTraceUrl: async () =>
          'https://cloud.langfuse.com/project/demo/traces/eval:debug-run:anthropic:claude-sonnet-4-6:alchemy-cost',
      },
      runLabel: 'debug-run',
      caseId: 'alchemy-cost',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });

    expect(result.trace).toBe(fetched);
    expect(result.transcript).toContain('Eval replay: alchemy-cost');
    expect(result.transcript).toContain('provider/model: anthropic / claude-sonnet-4-6');
    expect(result.transcript).toContain('status: quality');
    expect(result.transcript).toContain('stop reason: end_turn');
    expect(result.transcript).toContain('open_entity ok');
    expect(result.transcript).toContain('canonical refs: building:alchemist:1');
    expect(result.transcript).toContain('[REDACTED]');
    expect(result.transcript).toContain('pass: fail');
    expect(result.transcript).toContain('failure classification: answer_quality');
    expect(result.transcript).toContain('diagnosis: answer synthesis');
    expect(result.traceUrl).toContain('/traces/eval:debug-run');
  });

  it('diffs Claude and OpenAI traces for common failure modes', () => {
    const claude = trace({
      id: 'eval:debug-run:anthropic:claude-sonnet-4-6:alchemy-cost',
      output: { finalAnswer: 'Upgrade costs 1 prosperity, 2 wood, 2 metal, 1 hide.' },
      metadata: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        runLabel: 'debug-run',
        caseId: 'alchemy-cost',
        statusReason: 'completed',
      },
    });
    const openai = trace({
      id: 'eval:debug-run:alchemy-cost:openai',
      output: { finalAnswer: 'There is no cost to build it.' },
      metadata: {
        provider: 'openai',
        model: 'gpt-5.5',
        runLabel: 'debug-run',
        caseId: 'alchemy-cost',
        statusReason: 'schema',
      },
      observations: [
        {
          id: 'generation-openai',
          type: 'GENERATION',
          name: 'eval.model_call',
          model: 'gpt-5.5',
          output: { finalAnswer: 'There is no cost to build it.' },
          metadata: {
            stopReason: 'tool_loop_limit',
            statusReason: 'schema',
            errors: [{ type: 'schema', message: 'Invalid function arguments.' }],
          },
        },
        {
          id: 'tool-openai',
          type: 'SPAN',
          name: 'eval.tool_call.search_rules',
          input: { query: 'alchemist cost' },
          output: { outputSummary: 'json array (0 items)' },
          metadata: {
            toolName: 'search_rules',
            callIndex: 0,
            ok: true,
            canonicalRefs: [],
          },
        },
      ],
    });

    const diff = diffEvalTraces(claude, openai);
    const rendered = formatEvalTraceDiff(diff);

    expect(rendered).toContain('tool choice differs');
    expect(rendered).toContain('missing retrieval');
    expect(rendered).toContain('loop cutoff');
    expect(rendered).toContain('api/schema failure');
    expect(rendered).toContain('final answer differs');
  });

  it('builds deterministic Langfuse replay trace ids with the historical OpenAI fallback', () => {
    expect(
      replayTraceIdCandidates({
        runLabel: 'debug-run',
        caseId: 'alchemy-cost',
        provider: 'openai',
        model: 'gpt-5.5',
      }),
    ).toEqual(['eval:debug-run:openai:gpt-5.5:alchemy-cost', 'eval:debug-run:alchemy-cost:openai']);
  });

  it('renders transcripts directly from a fetched trace for CLI output', () => {
    expect(renderEvalTraceTranscript(trace({}))).toContain('Tool calls');
  });
});
