/**
 * Squire HTTP server.
 * Hono-based API with health check and service initialization.
 */

import { Hono } from 'hono';
import { isReady, initialize } from './service.ts';
import { loadIndex } from './vector-store.ts';
import { searchRules, searchCards } from './tools.ts';

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
