import { describe, expect, it, vi } from 'vitest';

import type { EvalProviderConfig } from '../eval/cli.ts';
import {
  OpenAiEvalRunnerError,
  classifyOpenAiResponsesFailure,
  createOpenAiResponsesClient,
  runOpenAiResponsesEvalCase,
  type OpenAiResponsesClient,
} from '../eval/openai-runner.ts';
import type { EvalCase } from '../eval/schema.ts';
import { TRACE_CONTRACT_VERSION } from '../eval/trace-contract.ts';

const providerConfig: EvalProviderConfig = {
  provider: 'openai',
  model: 'gpt-5.5',
  reasoningEffort: 'low',
  maxOutputTokens: 1024,
  timeoutMs: 30_000,
  toolLoopLimit: 4,
};

const evalCase: EvalCase = {
  id: 'item-spyglass',
  category: 'card-data',
  source: 'unit-test',
  question: 'What does Spyglass do?',
  finalAnswer: {
    expected: 'Spyglass reveals cards.',
    grading: 'Mentions Spyglass effect.',
  },
};

function responsesClient(...responses: unknown[]): OpenAiResponsesClient {
  const create = vi.fn();
  for (const response of responses) {
    create.mockResolvedValueOnce(response);
  }
  return { responses: { create } };
}

describe('OpenAI Responses eval runner', () => {
  it('advertises only redesigned tools for redesigned eval runs', async () => {
    const client = responsesClient({
      id: 'resp_1',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output_text: 'Done.',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Done.' }],
        },
      ],
    });

    await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'unit-openai',
      toolSurface: 'redesigned',
    });

    const request = vi.mocked(client.responses.create).mock.calls[0]?.[0] as {
      tools: Array<{ name: string }>;
    };
    const toolNames = request.tools.map((tool) => tool.name);
    expect(toolNames).toEqual([
      'inspect_sources',
      'schema',
      'resolve_entity',
      'open_entity',
      'search_knowledge',
      'neighbors',
    ]);
    expect(toolNames).not.toEqual(
      expect.arrayContaining(['search_cards', 'list_cards', 'get_card']),
    );
  });

  it('runs a manual stateless Responses tool loop without previous_response_id', async () => {
    const reasoningItem = {
      type: 'reasoning',
      id: 'rs_1',
      encrypted_content: 'opaque-reasoning',
    };
    const toolCallItem = {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'search_knowledge',
      arguments: '{"query":"Spyglass","scope":["card"],"limit":6}',
    };
    const client = responsesClient(
      {
        id: 'resp_1',
        model: 'gpt-5.5-2026-04-23',
        status: 'completed',
        output: [reasoningItem, toolCallItem],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
      {
        id: 'resp_2',
        model: 'gpt-5.5-2026-04-23',
        status: 'completed',
        output: [
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Spyglass reveals the top card.' }],
          },
        ],
        output_text: 'Spyglass reveals the top card.',
        usage: {
          input_tokens: 20,
          output_tokens: 8,
          total_tokens: 28,
          output_tokens_details: { reasoning_tokens: 2 },
        },
      },
    );
    const executeTool = vi.fn().mockResolvedValue({
      content: '[{"name":"Spyglass","effect":"Reveal the top card."}]',
      sourceBooks: ['Items'],
    });

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'unit-openai',
      toolSurface: 'redesigned',
      executeTool,
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    expect(result.answer).toBe('Spyglass reveals the top card.');
    expect(result.failureClass).toBe('none');
    expect(executeTool).toHaveBeenCalledWith('search_knowledge', {
      query: 'Spyglass',
      scope: ['card'],
      limit: 6,
    });

    const create = vi.mocked(client.responses.create);
    expect(create).toHaveBeenCalledTimes(2);

    const firstRequest = create.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(firstRequest).toMatchObject({
      model: 'gpt-5.5',
      store: false,
      parallel_tool_calls: false,
      max_output_tokens: 1024,
      reasoning: { effort: 'low' },
    });
    expect(firstRequest).not.toHaveProperty('previous_response_id');
    expect(firstRequest.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'search_knowledge', strict: true })]),
    );
    expect(firstRequest.tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'search_rules' })]),
    );

    const secondRequest = create.mock.calls[1]?.[0] as { input: unknown[] };
    expect(secondRequest).not.toHaveProperty('previous_response_id');
    expect(secondRequest.input).toEqual(
      expect.arrayContaining([
        reasoningItem,
        toolCallItem,
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '[{"name":"Spyglass","effect":"Reveal the top card."}]',
        },
      ]),
    );

    expect(result.trajectory.toolCalls).toEqual([
      expect.objectContaining({
        iteration: 1,
        id: 'fc_1',
        name: 'search_knowledge',
        ok: true,
        sourceLabels: ['Items'],
      }),
    ]);
    expect(result.trace).toMatchObject({
      runLabel: 'unit-openai',
      provider: 'openai',
      model: 'gpt-5.5',
      resolvedModel: 'gpt-5.5-2026-04-23',
      caseId: 'item-spyglass',
      caseCategory: 'card-data',
      toolSurface: 'redesigned',
      statusReason: 'completed',
      stopReason: 'completed',
      finalAnswer: 'Spyglass reveals the top card.',
      tokenUsage: {
        input: 30,
        output: 13,
        reasoning: 2,
        total: 43,
      },
      toolCalls: [
        expect.objectContaining({
          toolName: 'search_knowledge',
          providerToolCallId: 'call_1',
          arguments: { query: 'Spyglass', scope: ['card'], limit: 6 },
          result: '[{"name":"Spyglass","effect":"Reveal the top card."}]',
        }),
      ],
      errors: [],
    });
    expect(result.trace.judgeScores).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'failure_class', value: 'none' })]),
    );
    expect(result.trace.providerNativeTranscript).toMatchObject({
      contractVersion: TRACE_CONTRACT_VERSION,
      turns: [
        expect.objectContaining({
          response: expect.objectContaining({ id: 'resp_1' }),
          outputItems: [reasoningItem, toolCallItem],
          functionCallOutputs: [
            {
              type: 'function_call_output',
              call_id: 'call_1',
              output: '[{"name":"Spyglass","effect":"Reveal the top card."}]',
            },
          ],
        }),
        expect.objectContaining({
          response: expect.objectContaining({ id: 'resp_2' }),
        }),
      ],
    });
  });

  it('writes SQR-127 trace artifacts when a trace client is provided', async () => {
    const client = responsesClient({
      id: 'resp_final',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output_text: 'Done.',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const batch = vi.fn();

    await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'trace-run',
      toolSurface: 'redesigned',
      traceClient: { api: { ingestion: { batch } } },
    });

    expect(batch).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { contractVersion: TRACE_CONTRACT_VERSION },
        batch: expect.arrayContaining([
          expect.objectContaining({ type: 'trace-create' }),
          expect.objectContaining({ type: 'generation-create' }),
        ]),
      }),
    );
  });

  it('uses caller-provided trace ids and merges judge scores into the Langfuse trace', async () => {
    const client = responsesClient({
      id: 'resp_final',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output_text: 'Done.',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'matrix-run',
      toolSurface: 'redesigned',
      traceId: 'matrix-openai-trace',
      scoreResult: async () => [
        { name: 'correctness', value: 1, comment: 'Correct.' },
        { name: 'pass', value: 'pass', comment: 'Correct.' },
      ],
    });

    expect(result.trace.traceId).toBe('matrix-openai-trace');
    expect(result.trace.judgeScores).toEqual(
      expect.arrayContaining([
        { name: 'correctness', value: 1, comment: 'Correct.' },
        { name: 'pass', value: 'pass', comment: 'Correct.' },
        expect.objectContaining({ name: 'retry_count', value: 0 }),
      ]),
    );
  });

  it('classifies schema failures from malformed function-call arguments', async () => {
    const client = responsesClient({
      id: 'resp_bad_args',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output: [
        {
          type: 'function_call',
          id: 'fc_bad',
          call_id: 'call_bad',
          name: 'search_knowledge',
          arguments: '{"query":',
        },
      ],
    });

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'schema-failure',
      toolSurface: 'redesigned',
    });

    expect(result.ok).toBe(false);
    expect(result.failureClass).toBe('schema');
    expect(result.trace.errors).toEqual([
      expect.objectContaining({
        type: 'schema',
        message: expect.stringContaining('Invalid JSON arguments'),
      }),
    ]);
  });

  it('rejects tools outside the selected eval surface before execution', async () => {
    const executeTool = vi.fn();
    const client = responsesClient({
      id: 'resp_unavailable_tool',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output: [
        {
          type: 'function_call',
          id: 'fc_unavailable',
          call_id: 'call_unavailable',
          name: 'search_rules',
          arguments: '{"query":"Brittle","topK":5}',
        },
      ],
    });

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'unavailable-tool',
      toolSurface: 'redesigned',
      executeTool,
    });

    expect(result.ok).toBe(false);
    expect(result.failureClass).toBe('schema');
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.trace.errors).toEqual([
      expect.objectContaining({
        type: 'schema',
        message: expect.stringContaining('unavailable redesigned tool: search_rules'),
      }),
    ]);
  });

  it('does not invoke result scoring on failed runs', async () => {
    const client = responsesClient({
      id: 'resp_empty',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output: [{ type: 'message', content: [] }],
    });
    const scoreResult = vi.fn();

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'failed-score-skip',
      toolSurface: 'redesigned',
      scoreResult,
    });

    expect(result.ok).toBe(false);
    expect(scoreResult).not.toHaveBeenCalled();
    expect(result.trace.judgeScores).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'failure_class' })]),
    );
  });

  it('classifies tool execution failures', async () => {
    const client = responsesClient({
      id: 'resp_tool',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output: [
        {
          type: 'function_call',
          id: 'fc_tool',
          call_id: 'call_tool',
          name: 'search_knowledge',
          arguments: '{"query":"Spyglass","scope":["card"],"limit":6}',
        },
      ],
    });

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'tool-failure',
      toolSurface: 'redesigned',
      executeTool: vi.fn().mockRejectedValue(new Error('tool exploded')),
    });

    expect(result.ok).toBe(false);
    expect(result.failureClass).toBe('tool_execution');
    expect(result.trace.toolCalls).toEqual([
      expect.objectContaining({
        ok: false,
        errors: [expect.objectContaining({ type: 'tool_execution', message: 'tool exploded' })],
      }),
    ]);
  });

  it('classifies answer-quality failures when the model returns no text', async () => {
    const client = responsesClient({
      id: 'resp_empty',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output: [{ type: 'message', content: [] }],
    });

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'empty-answer',
      toolSurface: 'redesigned',
    });

    expect(result.ok).toBe(false);
    expect(result.failureClass).toBe('answer_quality');
    expect(result.trace.errors).toEqual([
      expect.objectContaining({
        type: 'answer_quality',
        message: expect.stringContaining('empty final answer'),
      }),
    ]);
  });

  it('uses the default repeated-rule-search synthesis guard', async () => {
    const client = responsesClient(
      {
        id: 'resp_rule_1',
        model: 'gpt-5.5-2026-04-23',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            id: 'fc_rule_1',
            call_id: 'call_rule_1',
            name: 'search_knowledge',
            arguments: '{"query":"looting","scope":["rules_passage"],"limit":5}',
          },
        ],
      },
      {
        id: 'resp_rule_2',
        model: 'gpt-5.5-2026-04-23',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            id: 'fc_rule_2',
            call_id: 'call_rule_2',
            name: 'search_knowledge',
            arguments: '{"query":"end-of-turn looting","scope":["rules_passage"],"limit":5}',
          },
        ],
      },
      {
        id: 'resp_rule_3',
        model: 'gpt-5.5-2026-04-23',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            id: 'fc_rule_3',
            call_id: 'call_rule_3',
            name: 'search_knowledge',
            arguments: '{"query":"loot token current hex","scope":["rules_passage"],"limit":5}',
          },
        ],
      },
      {
        id: 'resp_rule_final',
        model: 'gpt-5.5-2026-04-23',
        status: 'completed',
        output_text: 'Looting collects loot tokens and treasure tiles.',
        output: [
          {
            type: 'message',
            content: [
              { type: 'output_text', text: 'Looting collects loot tokens and treasure tiles.' },
            ],
          },
        ],
      },
    );

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase: {
        ...evalCase,
        id: 'rule-looting-definition',
        question: 'What is looting?',
      },
      providerConfig: {
        ...providerConfig,
        broadSearchSynthesisThreshold: undefined,
        toolLoopLimit: 3,
      },
      runLabel: 'rule-synthesis',
      toolSurface: 'redesigned',
      executeTool: vi.fn().mockResolvedValue({ content: 'Loot rule context.' }),
    });

    expect(result.ok).toBe(true);
    const create = vi.mocked(client.responses.create);
    const finalRequest = create.mock.calls[3]?.[0] as { input: unknown[]; tools: unknown[] };
    expect(finalRequest.tools).toEqual([]);
    expect(finalRequest.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message',
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'input_text',
              text: expect.stringContaining('Use the retrieved rulebook context to answer now'),
            }),
          ]),
        }),
      ]),
    );
  });

  it('uses the legacy tool schema on the legacy eval surface', async () => {
    const client = responsesClient({
      id: 'resp_final',
      model: 'gpt-5.5-2026-04-23',
      status: 'completed',
      output_text: 'Done.',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }],
    });

    await runOpenAiResponsesEvalCase({
      client,
      evalCase,
      providerConfig,
      runLabel: 'legacy-tools',
      toolSurface: 'legacy',
    });

    const create = vi.mocked(client.responses.create);
    const firstRequest = create.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(firstRequest.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'search_rules', strict: true })]),
    );
    expect(firstRequest.tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'search_knowledge' })]),
    );
  });

  it('forces synthesis when a trajectory eval reaches its tool budget', async () => {
    const client = responsesClient(
      {
        id: 'resp_traj_1',
        model: 'gpt-5.5-2026-04-23',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            id: 'fc_traj_1',
            call_id: 'call_traj_1',
            name: 'search_knowledge',
            arguments: '{"query":"Algox Archer","scope":["card"],"limit":10}',
          },
        ],
      },
      {
        id: 'resp_traj_2',
        model: 'gpt-5.5-2026-04-23',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            id: 'fc_traj_2',
            call_id: 'call_traj_2',
            name: 'resolve_entity',
            arguments: '{"query":"Algox Archer","kinds":["monster"],"limit":6}',
          },
        ],
      },
      {
        id: 'resp_traj_final',
        model: 'gpt-5.5-2026-04-23',
        status: 'completed',
        output_text: 'The exact record is the Algox Archer monster stat record.',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'The exact record is the Algox Archer monster stat record.',
              },
            ],
          },
        ],
      },
    );

    const result = await runOpenAiResponsesEvalCase({
      client,
      evalCase: {
        ...evalCase,
        id: 'traj-card-fuzzy-vs-exact',
        category: 'trajectory',
        question: 'Find Algox Archer and explain exact versus fuzzy matches.',
        trajectory: {
          requiredTools: ['search_knowledge'],
          requiredToolKinds: ['search'],
          forbiddenTools: [],
          forbiddenToolKinds: [],
          requiredRefs: [],
          maxToolCalls: 2,
        },
      },
      providerConfig,
      runLabel: 'trajectory-budget',
      toolSurface: 'redesigned',
      executeTool: vi.fn().mockResolvedValue({ content: 'Tool context.' }),
    });

    expect(result.ok).toBe(true);
    const create = vi.mocked(client.responses.create);
    const finalRequest = create.mock.calls[2]?.[0] as { input: unknown[]; tools: unknown[] };
    expect(finalRequest.tools).toEqual([]);
    expect(finalRequest.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message',
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'input_text',
              text: expect.stringContaining('The eval tool budget has been reached'),
            }),
          ]),
        }),
      ]),
    );
  });

  it('classifies model access, API status, and timeout failures', () => {
    expect(classifyOpenAiResponsesFailure({ status: 401, message: 'missing model' })).toBe(
      'model_access',
    );
    expect(classifyOpenAiResponsesFailure({ status: 429, message: 'rate limited' })).toBe(
      'api_status',
    );
    expect(classifyOpenAiResponsesFailure(new DOMException('aborted', 'AbortError'))).toBe(
      'timeout',
    );
    expect(classifyOpenAiResponsesFailure(new OpenAiEvalRunnerError('schema', 'bad schema'))).toBe(
      'schema',
    );
  });

  it('classifies non-JSON OpenAI API responses as API status failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 }));
    const client = createOpenAiResponsesClient(
      { OPENAI_API_KEY: 'test-key' } as NodeJS.ProcessEnv,
      fetchImpl as typeof fetch,
    );

    await expect(
      client.responses.create({
        model: 'gpt-5.5',
        instructions: 'Answer the question.',
        input: [],
        tools: [],
        store: false,
        parallel_tool_calls: false,
        include: [],
      }),
    ).rejects.toMatchObject({
      failureClass: 'api_status',
      status: 502,
      message: 'OpenAI Responses API returned non-JSON body with status 502.',
    });
  });
});
