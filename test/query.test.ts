import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dotenv/config', () => ({}));
vi.mock('../src/instrumentation.ts', () => ({ sdk: { shutdown: vi.fn() } }));

const { mockInitialize, mockAsk } = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockAsk: vi.fn(),
}));

const { mockRunAgentLoopWithTrajectory } = vi.hoisted(() => ({
  mockRunAgentLoopWithTrajectory: vi.fn(),
}));

vi.mock('../src/service.ts', () => ({
  initialize: mockInitialize,
  ask: mockAsk,
}));

vi.mock('../src/agent.ts', () => ({
  runAgentLoopWithTrajectory: mockRunAgentLoopWithTrajectory,
}));

import { askFrosthaven, askFrosthavenWithTrajectory } from '../src/query.ts';

describe('askFrosthaven', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitialize.mockResolvedValue(undefined);
    mockAsk.mockResolvedValue('Mocked answer from service');
    mockRunAgentLoopWithTrajectory.mockResolvedValue({
      answer: 'Mocked trajectory answer',
      trajectory: {
        toolCalls: [],
        finalAnswer: 'Mocked trajectory answer',
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 0,
        },
        model: 'test-model',
        iterations: 1,
        stopReason: 'end_turn',
      },
    });
  });

  it('initializes the service before asking', async () => {
    await askFrosthaven('What is the loot action?');
    expect(mockInitialize).toHaveBeenCalled();
  });

  it('delegates to service.ask()', async () => {
    await askFrosthaven('What is the loot action?');
    expect(mockAsk).toHaveBeenCalledWith('What is the loot action?');
  });

  it('passes options through to service.ask()', async () => {
    const options = { toolSurface: 'legacy' as const };
    await askFrosthaven('What is the loot action?', options);
    expect(mockAsk).toHaveBeenCalledWith('What is the loot action?', options);
  });

  it('returns the answer from service.ask()', async () => {
    const result = await askFrosthaven('What is the loot action?');
    expect(result).toBe('Mocked answer from service');
  });

  it('propagates initialization errors', async () => {
    mockInitialize.mockRejectedValue(new Error('Vector index is empty'));
    await expect(askFrosthaven('test')).rejects.toThrow('Vector index is empty');
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it('propagates ask errors', async () => {
    mockAsk.mockRejectedValue(new Error('Claude API error'));
    await expect(askFrosthaven('test')).rejects.toThrow('Claude API error');
  });

  it('passes options through to trajectory runs', async () => {
    const options = { toolSurface: 'legacy' as const };

    await askFrosthavenWithTrajectory('What is the loot action?', options);

    expect(mockInitialize).toHaveBeenCalled();
    expect(mockRunAgentLoopWithTrajectory).toHaveBeenCalledWith(
      'What is the loot action?',
      options,
    );
  });
});
