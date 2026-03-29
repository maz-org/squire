/**
 * Squire HTTP server.
 * Hono-based API with health check and service initialization.
 */

import { Hono } from 'hono';
import { isReady, initialize, ask } from './service.ts';
import { loadIndex } from './vector-store.ts';
import { searchRules, searchCards, listCardTypes, listCards, getCard } from './tools.ts';
import type { CardType } from './schemas.ts';

export const app = new Hono();

// ─── Health endpoint ─────────────────────────────────────────────────────────

app.get('/api/health', (c) => {
  const index = loadIndex();
  return c.json({
    ready: isReady(),
    index_size: index.length,
  });
});

// ─── Search endpoints ────────────────────────────────────────────────────────

function parseTopK(raw: string | undefined): number {
  if (!raw) return 6;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) return 6;
  return n;
}

app.get('/api/search/rules', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'Missing required query parameter: q' }, 400);

  const topK = parseTopK(c.req.query('topK'));
  const results = await searchRules(q, topK);
  return c.json({ results });
});

app.get('/api/search/cards', (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'Missing required query parameter: q' }, 400);

  const topK = parseTopK(c.req.query('topK'));
  const results = searchCards(q, topK);
  return c.json({ results });
});

// ─── Card discovery and lookup endpoints ─────────────────────────────────────

app.get('/api/card-types', (c) => {
  const types = listCardTypes();
  return c.json({ types });
});

app.get('/api/cards/:type/:id', (c) => {
  const type = c.req.param('type') as CardType;
  const id = decodeURIComponent(c.req.param('id'));
  const card = getCard(type, id);
  if (!card) return c.json({ error: 'Card not found' }, 404);
  return c.json({ card });
});

app.get('/api/cards', (c) => {
  const type = c.req.query('type');
  if (!type) return c.json({ error: 'Missing required query parameter: type' }, 400);

  const filterRaw = c.req.query('filter');
  let filter: Record<string, unknown> | undefined;
  if (filterRaw) {
    try {
      const parsed = JSON.parse(filterRaw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return c.json({ error: 'Filter must be a JSON object' }, 400);
      }
      filter = parsed as Record<string, unknown>;
    } catch {
      return c.json({ error: 'Invalid filter JSON' }, 400);
    }
  }

  const cards = listCards(type as CardType, filter);
  return c.json({ cards });
});

// ─── Ask endpoint ────────────────────────────────────────────────────────────

app.post('/api/ask', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { question } = body as { question?: string };
  if (!question) return c.json({ error: 'Missing required field: question' }, 400);

  const answer = await ask(question);
  return c.json({ answer });
});

// ─── Server startup ──────────────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  await initialize();

  const parsed = parseInt(process.env.PORT || '3000', 10);
  const port = Number.isNaN(parsed) ? 3000 : parsed;
  const { serve } = await import('@hono/node-server');
  serve({ fetch: app.fetch, port });
  console.log(`Squire server listening on port ${port}`);
}

// CLI entrypoint
if (process.argv[1]?.endsWith('server.ts')) {
  startServer().catch((err: unknown) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
