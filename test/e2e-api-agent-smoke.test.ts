import { describe, expect, it } from 'vitest';

import {
  E2E_SMOKE_GAMES,
  parseSseEvents,
  runApiAgentSmoke,
  type FetchLike,
} from '../scripts/e2e-api-agent-smoke.ts';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function sseResponse(events: Array<{ event: string; data: unknown }>) {
  const body = events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('scheduled API and agent E2E smoke runner', () => {
  it('parses named SSE events with JSON payloads', () => {
    expect(
      parseSseEvents('event: text\ndata: {"delta":"Loot"}\n\n' + 'event: done\ndata: {}\n\n'),
    ).toEqual([
      { event: 'text', data: { delta: 'Loot' } },
      { event: 'done', data: {} },
    ]);
  });

  it('runs health, bearer auth, per-game search, per-game ask, and budget checks', async () => {
    const calls: string[] = [];
    const budgetSteps: string[] = [];
    let budgetLedgerSeeded = false;

    const fetch: FetchLike = async (url, init = {}) => {
      const parsed = new URL(String(url));
      calls.push(`${init.method ?? 'GET'} ${parsed.pathname}${parsed.search}`);

      if (parsed.pathname === '/api/live') return jsonResponse({ status: 'ok' });
      if (parsed.pathname === '/api/health') {
        return jsonResponse({
          status: 'ok',
          db: { status: 'ok' },
          vector: { status: 'ok' },
          embedder: { status: 'ok' },
        });
      }
      if (parsed.pathname === '/register') {
        return jsonResponse({ client_id: 'client-1' }, { status: 201 });
      }
      if (parsed.pathname === '/authorize') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'http://localhost:8080/callback?code=code-1' },
        });
      }
      if (parsed.pathname === '/token') {
        return jsonResponse({ access_token: 'token-1', token_type: 'bearer' });
      }
      if (parsed.pathname === '/api/search/rules') {
        const game = parsed.searchParams.get('game');
        const expected = E2E_SMOKE_GAMES.find((entry) => entry.game === game);
        return jsonResponse({
          results: [
            {
              text: `Rules result for ${game}`,
              game,
              source: expected?.expectedSourceMarker + 'rule-book.pdf',
              sourceLabel: expected?.expectedSourceLabel,
              score: 0.9,
            },
          ],
        });
      }
      if (parsed.pathname === '/api/ask') {
        if (budgetLedgerSeeded) {
          return jsonResponse(
            {
              error: 'llm_budget_exceeded',
              error_description: 'Daily LLM budget exhausted. Try again tomorrow.',
            },
            { status: 429 },
          );
        }
        const body = JSON.parse(String(init.body)) as { game: string };
        const expected = E2E_SMOKE_GAMES.find((entry) => entry.game === body.game)!;
        return sseResponse([
          { event: 'tool_progress', data: { toolName: 'search_knowledge' } },
          {
            event: 'tool_result',
            data: {
              name: 'search_knowledge',
              sourceBooks: [expected.expectedSourceLabel],
            },
          },
          { event: 'text', data: { delta: expected.requiredAnswerTerms.join(' ') } },
          { event: 'done', data: {} },
        ]);
      }

      throw new Error(`Unexpected request: ${parsed.pathname}`);
    };

    const result = await runApiAgentSmoke({
      baseUrl: 'http://localhost:3000',
      fetch,
      clearBudgetExhaustion: async () => {
        budgetSteps.push('clear');
      },
      seedBudgetExhaustion: async () => {
        budgetSteps.push('seed');
        budgetLedgerSeeded = true;
      },
      logger: () => undefined,
    });

    expect(result.games).toEqual(['frosthaven', 'gloomhaven-2e']);
    expect(result.providerCalls).toBe(2);
    expect(result.budgetExceededBeforeStream).toBe(true);
    expect(budgetSteps).toEqual(['clear', 'seed']);
    expect(calls).toContain('GET /api/live');
    expect(calls).toContain('GET /api/health');
    expect(calls).toContain('POST /register');
    expect(calls).toContain('POST /token');
    expect(calls).toContain('GET /api/search/rules?q=loot&topK=3&game=frosthaven');
    expect(calls).toContain('GET /api/search/rules?q=advantage&topK=3&game=gloomhaven-2e');
    expect(calls.filter((call) => call === 'POST /api/ask')).toHaveLength(3);
  });
});
