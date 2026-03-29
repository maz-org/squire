import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('dotenv/config', () => ({}));
vi.mock('../src/instrumentation.ts', () => ({ sdk: { shutdown: vi.fn() } }));

const { mockInitialize, mockAsk } = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockAsk: vi.fn(),
}));

vi.mock('../src/service.ts', () => ({
  initialize: mockInitialize,
  ask: mockAsk,
}));

import { askFrosthaven } from '../src/query.ts';

describe('askFrosthaven', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitialize.mockResolvedValue(undefined);
    mockAsk.mockResolvedValue('Mocked answer from service');
  });

  it('initializes the service before asking', async () => {
    await askFrosthaven('What is the loot action?');
    expect(mockInitialize).toHaveBeenCalled();
  });

  it('delegates to service.ask()', async () => {
    await askFrosthaven('What is the loot action?');
    expect(mockAsk).toHaveBeenCalledWith('What is the loot action?');
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
});
