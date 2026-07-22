import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const BOOTSTRAP_POLL_MS = 5000;

// ─── Mocks ───────────────────────────────────────────────────────────────────

const {
  mockRunAgentLoopWithTrajectory,
  mockRunLangGraphAgentLoopWithTrajectory,
  mockAssertLlmBudgetAvailable,
  mockRecordLlmUsage,
  mockWriteSecurityLog,
  mockEmbed,
  mockInitializeRetrieval,
  mockGetRetrievalBootstrapStatus,
  mockListCardTypes,
  mockGetScenarioSectionBooksBootstrapStatus,
} = vi.hoisted(() => ({
  mockRunAgentLoopWithTrajectory: vi.fn(),
  mockRunLangGraphAgentLoopWithTrajectory: vi.fn(),
  mockAssertLlmBudgetAvailable: vi.fn(),
  mockRecordLlmUsage: vi.fn(),
  mockWriteSecurityLog: vi.fn(),
  mockEmbed: vi.fn(),
  mockInitializeRetrieval: vi.fn(),
  mockGetRetrievalBootstrapStatus: vi.fn(),
  mockListCardTypes: vi.fn(),
  mockGetScenarioSectionBooksBootstrapStatus: vi.fn(),
}));

vi.mock('../src/agent.ts', () => ({
  runAgentLoopWithTrajectory: mockRunAgentLoopWithTrajectory,
}));

vi.mock('../src/agent-langgraph.ts', () => ({
  runLangGraphAgentLoopWithTrajectory: mockRunLangGraphAgentLoopWithTrajectory,
}));

vi.mock('../src/campaign/context.ts', () => ({
  loadCampaignContext: vi.fn().mockResolvedValue({
    campaign: { game: 'gloomhaven-2e' },
  }),
  renderCampaignContextBlock: vi.fn().mockReturnValue('<campaign_data/>'),
  applyCampaignContextToAskOptions: vi.fn(
    async (options: { campaignId?: string; userId?: string; game?: string }) =>
      options.campaignId && options.userId
        ? {
            ...options,
            campaignContext: { campaign: { game: 'gloomhaven-2e' } },
            game: options.game ?? 'gloomhaven-2e',
          }
        : options,
  ),
}));

vi.mock('../src/llm-budget.ts', () => ({
  assertLlmBudgetAvailable: mockAssertLlmBudgetAvailable,
  recordLlmUsage: mockRecordLlmUsage,
}));

vi.mock('../src/security-log.ts', () => ({
  errorLogFields: vi.fn(() => ({ error_type: 'Error', error_code: null })),
  writeSecurityLog: mockWriteSecurityLog,
}));

vi.mock('../src/tools.ts', () => ({
  listCardTypes: mockListCardTypes,
}));

vi.mock('../src/embedder.ts', () => ({
  embed: mockEmbed,
}));

vi.mock('../src/vector-store.ts', () => ({
  EMBEDDINGS_BOOTSTRAP_MESSAGE:
    'Rule-source embeddings table is empty. Run `npm run index` to populate the rule-source vector store.',
  getRetrievalBootstrapStatus: mockGetRetrievalBootstrapStatus,
  initializeRetrieval: mockInitializeRetrieval,
}));

vi.mock('../src/scenario-section-data.ts', () => ({
  SCENARIO_SECTION_BOOKS_BOOTSTRAP_MESSAGE:
    'No scenario and section book data found in Postgres. Run `npm run seed:scenario-section-books` first.',
  getScenarioSectionBooksBootstrapStatus: mockGetScenarioSectionBooksBootstrapStatus,
}));

vi.mock('../src/extracted-data.ts', () => ({
  TYPES: ['monster-stats', 'items'],
  load: vi.fn(() => [{ name: 'test' }]),
}));

import {
  initialize,
  isReady,
  ask,
  ensureBootstrapStatus,
  getBootstrapStatus,
  refreshBootstrapState,
  refreshInitializationIfReady,
  startBootstrapLifecycle,
  _resetForTesting,
} from '../src/service.ts';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ─── initialize / isReady ────────────────────────────────────────────────────

describe('initialize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    mockInitializeRetrieval.mockResolvedValue(undefined);
    mockGetRetrievalBootstrapStatus.mockResolvedValue({ ready: true, indexSize: 8 });
    mockListCardTypes.mockResolvedValue([
      { type: 'monster-stats', count: 5 },
      { type: 'items', count: 3 },
    ]);
    mockGetScenarioSectionBooksBootstrapStatus.mockResolvedValue({
      ready: true,
      scenarioCount: 162,
      sectionCount: 699,
      linkCount: 817,
    });
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('isReady returns false before initialize', () => {
    expect(isReady()).toBe(false);
  });

  it('delegates retrieval bootstrap to initializeRetrieval', async () => {
    await initialize();
    // service passes the embedder in so retrieval can warm it without
    // importing it itself — keeps the retrieval layer free of a direct
    // embedder dependency in the type surface.
    expect(mockInitializeRetrieval).toHaveBeenCalledWith(mockEmbed);
  });

  it('isReady returns true after initialize', async () => {
    await initialize();
    expect(isReady()).toBe(true);
  });

  it('surfaces retrieval initialization errors', async () => {
    mockInitializeRetrieval.mockRejectedValueOnce(new Error('Vector index is empty.'));
    await expect(initialize()).rejects.toThrow(/index is empty/i);
  });

  it('reports missing bootstrap steps when embeddings or cards are absent', async () => {
    mockGetRetrievalBootstrapStatus.mockResolvedValueOnce({
      ready: false,
      indexSize: 0,
      error:
        'Rule-source embeddings table is empty. Run `npm run index` to populate the rule-source vector store.',
      missingStep: 'npm run index',
      reason: 'missing_index',
    });
    mockListCardTypes.mockResolvedValueOnce([
      { type: 'monster-stats', count: 0 },
      { type: 'items', count: 0 },
    ]);

    await refreshBootstrapState();
    const status = getBootstrapStatus();
    expect(status.ready).toBe(false);
    expect(status.lifecycle).toBe('boot_blocked');
    expect(status.missingBootstrapSteps).toEqual(['npm run index', 'npm run seed:cards']);
  });

  it('returns an immediate starting snapshot before the first live probe', () => {
    const status = getBootstrapStatus();
    expect(status.lifecycle).toBe('starting');
    expect(status.ready).toBe(false);
    expect(status.errors).toEqual([]);
  });

  it('populates the first bootstrap snapshot only through the live probe path', async () => {
    mockGetRetrievalBootstrapStatus.mockResolvedValue({
      ready: false,
      indexSize: 0,
      error: 'database unavailable',
      reason: 'dependency_unavailable',
    });
    mockListCardTypes.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const status = await ensureBootstrapStatus();
    expect(status.lifecycle).toBe('dependency_failed');
    expect(status.errors[0]).toMatch(/database unavailable/);
  });

  it('retries initialization when bootstrap prerequisites later become available', async () => {
    mockGetRetrievalBootstrapStatus.mockResolvedValue({
      ready: true,
      indexSize: 8,
    });
    mockListCardTypes.mockResolvedValue([
      { type: 'monster-stats', count: 5 },
      { type: 'items', count: 3 },
    ]);

    await refreshInitializationIfReady();

    await vi.waitFor(() => expect(mockInitializeRetrieval).toHaveBeenCalledWith(mockEmbed));
    expect(isReady()).toBe(true);
  });

  it('reports warming_up immediately while initialization is in flight', async () => {
    const warmup = createDeferred<void>();
    mockInitializeRetrieval.mockImplementation(() => warmup.promise);

    const init = initialize();
    await vi.waitFor(async () => {
      expect(getBootstrapStatus().lifecycle).toBe('warming_up');
    });

    const status = getBootstrapStatus();
    expect(status.lifecycle).toBe('warming_up');
    expect(status.warmingUp).toBe(true);
    expect(status.capabilities.ask).toEqual({
      allowed: false,
      reason: 'warming_up',
      message: 'Service is warming up. Retry in a moment.',
    });

    warmup.resolve();
    await init;
  });

  it('reports warming_up when retrying after an init failure', async () => {
    let failWarmup = true;
    const retryWarmup = createDeferred<void>();
    mockInitializeRetrieval.mockImplementation(() => {
      if (failWarmup) {
        failWarmup = false;
        return Promise.reject(new Error('embedder cold start failed'));
      }
      return retryWarmup.promise;
    });

    await expect(initialize()).rejects.toThrow(/embedder cold start failed/i);
    expect(getBootstrapStatus().lifecycle).toBe('init_failed');

    const retry = initialize();
    await vi.waitFor(() => {
      expect(getBootstrapStatus().lifecycle).toBe('warming_up');
    });

    retryWarmup.resolve();
    await retry;
    expect(getBootstrapStatus().lifecycle).toBe('ready');
  });

  it('keeps rule queries available when only card bootstrap probing fails', async () => {
    mockGetRetrievalBootstrapStatus.mockResolvedValue({
      ready: true,
      indexSize: 8,
    });
    mockListCardTypes.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const status = await ensureBootstrapStatus();
    expect(status.lifecycle).toBe('dependency_failed');
    expect(status.capabilities.rules).toEqual({
      allowed: true,
      reason: null,
      message: null,
    });
    expect(status.capabilities.cards.allowed).toBe(false);
    expect(status.capabilities.ask.allowed).toBe(false);
  });

  it('blocks ask when traversal data is missing while keeping rules and cards available', async () => {
    mockGetScenarioSectionBooksBootstrapStatus.mockResolvedValue({
      ready: false,
      scenarioCount: 0,
      sectionCount: 0,
      linkCount: 0,
      error:
        'No scenario and section book data found in Postgres. Run `npm run seed:scenario-section-books` first.',
      missingStep: 'npm run seed:scenario-section-books',
      reason: 'missing_scenario_section_books',
    });

    const status = await ensureBootstrapStatus();
    expect(status.lifecycle).toBe('boot_blocked');
    expect(status.missingBootstrapSteps).toEqual(['npm run seed:scenario-section-books']);
    expect(status.capabilities.rules).toEqual({
      allowed: true,
      reason: null,
      message: null,
    });
    expect(status.capabilities.cards).toEqual({
      allowed: true,
      reason: null,
      message: null,
    });
    expect(status.capabilities.ask).toEqual({
      allowed: false,
      reason: 'missing_scenario_section_books',
      message:
        'No scenario and section book data found in Postgres. Run `npm run seed:scenario-section-books` first.',
    });
  });

  it('blocks rule queries when warmup has failed', async () => {
    mockInitializeRetrieval.mockRejectedValueOnce(new Error('embedder cold start failed'));

    await expect(initialize()).rejects.toThrow(/embedder cold start failed/i);

    const status = await ensureBootstrapStatus();
    expect(status.lifecycle).toBe('init_failed');
    expect(status.capabilities.rules).toEqual({
      allowed: false,
      reason: 'init_failed',
      message: 'embedder cold start failed',
    });
    expect(status.capabilities.ask).toEqual({
      allowed: false,
      reason: 'init_failed',
      message: 'embedder cold start failed',
    });
  });
});

// ─── bootstrap lifecycle ─────────────────────────────────────────────────────

describe('bootstrap lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    _resetForTesting();
    mockInitializeRetrieval.mockResolvedValue(undefined);
    mockGetRetrievalBootstrapStatus.mockResolvedValue({ ready: true, indexSize: 8 });
    mockListCardTypes.mockResolvedValue([
      { type: 'monster-stats', count: 5 },
      { type: 'items', count: 3 },
    ]);
    mockGetScenarioSectionBooksBootstrapStatus.mockResolvedValue({
      ready: true,
      scenarioCount: 162,
      sectionCount: 699,
      linkCount: 817,
    });
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  afterEach(() => {
    _resetForTesting();
    vi.useRealTimers();
  });

  it('stops probing after a ready startup', async () => {
    startBootstrapLifecycle();

    await vi.waitFor(() => expect(isReady()).toBe(true));
    const probesWhenReady = mockGetRetrievalBootstrapStatus.mock.calls.length;

    await vi.advanceTimersByTimeAsync(BOOTSTRAP_POLL_MS * 2);

    expect(mockGetRetrievalBootstrapStatus).toHaveBeenCalledTimes(probesWhenReady);
  });

  it('retries until bootstrap becomes ready, then stops probing', async () => {
    mockGetRetrievalBootstrapStatus
      .mockResolvedValueOnce({
        ready: false,
        indexSize: 0,
        error: 'database unavailable',
        reason: 'dependency_unavailable',
      })
      .mockResolvedValue({ ready: true, indexSize: 8 });

    startBootstrapLifecycle();

    await vi.waitFor(() => expect(mockGetRetrievalBootstrapStatus).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_POLL_MS);
    await vi.waitFor(() => expect(isReady()).toBe(true));

    const probesWhenReady = mockGetRetrievalBootstrapStatus.mock.calls.length;

    await vi.advanceTimersByTimeAsync(BOOTSTRAP_POLL_MS * 2);

    expect(mockGetRetrievalBootstrapStatus).toHaveBeenCalledTimes(probesWhenReady);
  });

  it('waits for an in-flight initialization before deciding whether to retry', async () => {
    const warmup = createDeferred<void>();
    mockInitializeRetrieval.mockImplementation(() => warmup.promise);

    const initialization = initialize();
    await vi.waitFor(() => expect(getBootstrapStatus().lifecycle).toBe('warming_up'));

    startBootstrapLifecycle();
    await vi.waitFor(() => expect(mockGetRetrievalBootstrapStatus).toHaveBeenCalledTimes(2));
    warmup.resolve();
    await initialization;
    expect(isReady()).toBe(true);
    const probesWhenReady = mockGetRetrievalBootstrapStatus.mock.calls.length;

    await vi.advanceTimersByTimeAsync(BOOTSTRAP_POLL_MS * 2);

    expect(mockGetRetrievalBootstrapStatus).toHaveBeenCalledTimes(probesWhenReady);
  });

  it('does not start duplicate lifecycle pollers', async () => {
    startBootstrapLifecycle();
    startBootstrapLifecycle();

    await vi.waitFor(() => expect(isReady()).toBe(true));

    expect(mockGetRetrievalBootstrapStatus).toHaveBeenCalledTimes(3);
  });

  it('does not probe again when lifecycle startup is called after readiness', async () => {
    startBootstrapLifecycle();
    await vi.waitFor(() => expect(isReady()).toBe(true));
    const probesWhenReady = mockGetRetrievalBootstrapStatus.mock.calls.length;

    startBootstrapLifecycle();
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_POLL_MS * 2);

    expect(mockGetRetrievalBootstrapStatus).toHaveBeenCalledTimes(probesWhenReady);
  });
});

// ─── ask ─────────────────────────────────────────────────────────────────────

describe('ask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    mockInitializeRetrieval.mockResolvedValue(undefined);
    mockGetRetrievalBootstrapStatus.mockResolvedValue({ ready: true, indexSize: 8 });
    mockListCardTypes.mockResolvedValue([
      { type: 'monster-stats', count: 5 },
      { type: 'items', count: 3 },
    ]);
    mockGetScenarioSectionBooksBootstrapStatus.mockResolvedValue({
      ready: true,
      scenarioCount: 162,
      sectionCount: 699,
      linkCount: 817,
    });
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAssertLlmBudgetAvailable.mockResolvedValue(undefined);
    mockRecordLlmUsage.mockResolvedValue(undefined);
    mockWriteSecurityLog.mockReset();
    mockRunAgentLoopWithTrajectory.mockResolvedValue({
      answer: 'You pick up loot tokens in your hex.',
      trajectory: {
        toolCalls: [],
        modelCalls: [],
        finalAnswer: 'You pick up loot tokens in your hex.',
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationInputTokens: 20,
          cacheReadInputTokens: 10,
          totalTokens: 180,
        },
        model: 'claude-sonnet-4-6',
        iterations: 1,
        stopReason: 'end_turn',
      },
    });
    mockRunLangGraphAgentLoopWithTrajectory.mockResolvedValue({
      answer: 'LangGraph answer.',
      trajectory: {
        toolCalls: [],
        modelCalls: [],
        finalAnswer: 'LangGraph answer.',
        tokenUsage: {
          inputTokens: 20,
          outputTokens: 10,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 30,
        },
        model: 'langgraph:claude-sdk',
        iterations: 1,
        stopReason: 'end_turn',
      },
    });
  });

  it('checks the budget before delegating to the LangGraph agent', async () => {
    await initialize();
    const result = await ask('What is the loot action?');
    expect(mockAssertLlmBudgetAvailable).toHaveBeenCalledWith({ userId: null });
    expect(mockRunLangGraphAgentLoopWithTrajectory).toHaveBeenCalledWith(
      'What is the loot action?',
      undefined,
    );
    expect(result).toBe('LangGraph answer.');
  });

  it('records trajectory usage after the agent returns', async () => {
    await initialize();
    await ask('What is the loot action?', {
      userId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    });

    expect(mockRecordLlmUsage).toHaveBeenCalledWith({
      userId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      model: 'langgraph:claude-sdk',
      usage: {
        inputTokens: 20,
        outputTokens: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 30,
      },
    });
  });

  it('returns the successful answer when usage accounting fails after the model run', async () => {
    mockRecordLlmUsage.mockRejectedValueOnce(new Error('database unavailable'));

    const result = await ask('What is the loot action?');

    expect(result).toBe('LangGraph answer.');
    expect(mockWriteSecurityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'llm_budget_accounting_failed',
        level: 'error',
        fields: expect.objectContaining({
          model: 'langgraph:claude-sdk',
          has_user_id: false,
          error_type: 'Error',
        }),
      }),
    );
  });

  it('does not run the agent loop when budget admission fails', async () => {
    mockAssertLlmBudgetAvailable.mockRejectedValueOnce(new Error('daily budget exceeded'));

    await expect(ask('What is the loot action?')).rejects.toThrow(/daily budget exceeded/i);
    expect(mockRunLangGraphAgentLoopWithTrajectory).not.toHaveBeenCalled();
  });

  it('passes production options through to the LangGraph agent', async () => {
    await initialize();
    const options = {
      history: [{ role: 'user' as const, content: 'What is loot?' }],
      campaignId: '550e8400-e29b-41d4-a716-446655440000',
      userId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      game: 'gh2',
    };
    await ask('Follow-up', options);
    // Campaign-bound asks load the context projection (mocked here) and
    // attach it; the explicit game wins over the campaign's (E8 fallback
    // only fills a missing game).
    expect(mockRunLangGraphAgentLoopWithTrajectory).toHaveBeenCalledWith('Follow-up', {
      ...options,
      campaignContext: { campaign: { game: 'gloomhaven-2e' } },
    });
  });

  it('falls back to the campaign game when none is given (E8)', async () => {
    await initialize();
    await ask('Follow-up', {
      campaignId: '550e8400-e29b-41d4-a716-446655440000',
      userId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    });
    expect(mockRunLangGraphAgentLoopWithTrajectory).toHaveBeenCalledWith(
      'Follow-up',
      expect.objectContaining({ game: 'gloomhaven-2e' }),
    );
  });

  it('uses LangGraph as the production runner and strips deprecated selectors', async () => {
    await initialize();
    const emit = vi.fn().mockResolvedValue(undefined);

    const result = await ask('What unlocks scenario 61?', {
      emit,
      runner: 'langgraph',
      toolSurface: 'legacy',
      userId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    });

    expect(result).toBe('LangGraph answer.');
    expect(mockRunAgentLoopWithTrajectory).not.toHaveBeenCalled();
    expect(mockRunLangGraphAgentLoopWithTrajectory).toHaveBeenCalledWith(
      'What unlocks scenario 61?',
      {
        emit,
        userId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      },
    );
  });

  it('initializes lazily when asked before warmup', async () => {
    await ask('test');
    expect(mockInitializeRetrieval).toHaveBeenCalled();
    expect(mockRunLangGraphAgentLoopWithTrajectory).toHaveBeenCalledWith('test', undefined);
  });

  it('does not run the agent loop after readiness has regressed', async () => {
    await initialize();

    mockGetRetrievalBootstrapStatus.mockResolvedValue({
      ready: false,
      indexSize: 0,
      error: 'database unavailable',
      reason: 'dependency_unavailable',
    });
    mockListCardTypes.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await refreshBootstrapState();

    await expect(ask('test after regression')).rejects.toThrow(/database unavailable/i);
    expect(mockRunAgentLoopWithTrajectory).not.toHaveBeenCalled();
  });
});
