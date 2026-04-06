# Development Guide

## Prerequisites

- Node.js 24+ (see `.nvmrc`)
- `.env` file with `ANTHROPIC_API_KEY`

Extracted card data (`data/extracted/*.json`) and the vector index
(`data/index.json`) are committed to the repo. No additional data setup
is needed for most development — just `npm ci` and go.

## Running the dev server

```bash
npm run serve
```

The server starts on port 3000 (override with `PORT` env var). It
initializes the vector index, verifies extracted card data, and warms
the embedder before accepting requests.

Health check:

```bash
curl http://localhost:3000/api/health
# {"ready":true,"index_size":2147}
```

Stop the server with Ctrl-C or `kill $(lsof -ti :3000)`.

## REST API endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/health` | Readiness check with index size |
| GET | `/api/search/rules?q=&topK=` | Vector search over rulebook passages |
| GET | `/api/search/cards?q=&topK=` | Keyword search over extracted card data |
| GET | `/api/card-types` | List card types with record counts |
| GET | `/api/cards?type=&filter=` | List cards of a type (filter is JSON) |
| GET | `/api/cards/:type/:id` | Look up a single card |
| POST | `/api/ask` | Bundled RAG pipeline (`{ question }` → `{ answer }`) |

All errors return `{ error, status }` as JSON.

`topK` defaults to 6, must be 1–100. The `filter` parameter is a
URL-encoded JSON object with AND-logic field matching.

## MCP server

Squire exposes 5 atomic tools via MCP at `/mcp`:

| Tool | Description |
| ---- | ----------- |
| `search_rules` | Vector search over rulebook passages |
| `search_cards` | Keyword search over extracted card data |
| `list_card_types` | List available card categories with counts |
| `list_cards` | List cards of a type with optional field filter |
| `get_card` | Look up a single card by type and identifier |

The MCP endpoint uses Streamable HTTP transport in stateless mode (no
auth). OAuth will be added in the Auth Module epic.

### Connecting Claude Desktop (development)

Claude Desktop doesn't natively support Streamable HTTP MCP servers
yet — it requires a stdio bridge. Use
[mcp-remote](https://www.npmjs.com/package/mcp-remote):

1. Start the dev server: `npm run serve`

2. Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "squire": {
         "command": "npx",
         "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"]
       }
     }
   }
   ```

   If Claude Desktop uses an older Node version (< 20), specify the
   full path to a Node 24+ `npx` in the `command` field, and set
   `env.PATH` to include that Node's bin directory.

3. Restart Claude Desktop. The tools appear in the chat input area.

Once the Auth Module is implemented, Squire can be added as a proper
Connector in Claude Desktop via the `+` button in Settings > Connectors
(no config file needed).

### Connecting Claude Code (development)

Add to your Claude Code MCP settings
(`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "squire": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Claude Code supports Streamable HTTP natively — no bridge needed.

### In-process client (for web UI)

The web UI conversation agent connects via in-process MCP transport
with no HTTP round-trip:

```typescript
import { createInProcessClient } from './mcp.ts';

const client = await createInProcessClient();
const { tools } = await client.listTools();
const result = await client.callTool({ name: 'search_rules', arguments: { query: 'loot' } });
await client.close(); // also closes the server side
```

## Testing

```bash
npm test              # Run all tests (shuffled order)
npm run test:watch    # Watch mode
npm run typecheck     # TypeScript type checking
npm run lint          # ESLint
npm run format:check  # Prettier check
```

Tests use randomized execution order (`sequence.shuffle` in vitest
config) to catch order-dependent tests. The full suite runs as a
pre-commit hook along with typecheck and lint.

## Data management

Extracted card data (`data/extracted/*.json`) and the vector index
(`data/index.json`) are checked into the repo as regular files. A
[CI workflow](../.github/workflows/refresh-data.yml) refreshes them
weekly from upstream sources and opens a PR if anything changed.

### Refreshing data

Trigger the workflow manually from the Actions tab, or wait for the
weekly schedule. The workflow shallow-clones only the needed portions
of each upstream repo.

### Working on import scripts locally

Import scripts read from two upstream repos. Clone them once outside
the project and point the scripts at them via env vars:

```bash
# GHS (structured JSON, ~6 MB with sparse checkout)
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/Lurkars/gloomhavensecretariat.git ~/data/ghs
cd ~/data/ghs && git sparse-checkout set data/fh

# Worldhaven (card images for OCR extraction)
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/any2cards/worldhaven.git ~/data/worldhaven
cd ~/data/worldhaven && git sparse-checkout set \
  images/monster-stat-cards/frosthaven \
  images/character-ability-cards/frosthaven \
  images/items/frosthaven \
  images/events/frosthaven \
  images/battle-goals/frosthaven \
  images/outpost-building-cards/frosthaven
```

Then run the import scripts:

```bash
# GHS imports (free — JSON parsing only)
GHS_DATA_DIR=~/data/ghs npx tsx src/import-monster-stats.ts

# OCR extraction (costs ~$5-10 per full run)
WORLDHAVEN_DIR=~/data/worldhaven npx tsx src/extract-card-data.ts
```

The clones live outside the repo so they don't interfere with git or
worktrees. Commit updated `data/extracted/*.json` files alongside your
script changes.

## Project structure

```text
src/
  tools.ts          # Atomic data access primitives (search, list, get)
  service.ts        # Service initialization + bundled RAG convenience path
  server.ts         # Hono HTTP server (REST + MCP transport)
  mcp.ts            # MCP tool registration + in-process client factory
  query.ts          # Thin CLI wrapper over service.ts
  embedder.ts       # Local embedding via all-MiniLM-L6-v2
  vector-store.ts   # Flat-file vector store with cosine similarity
  extracted-data.ts # Card data loading, search, and formatting
  schemas.ts        # Zod schemas for all 7 card types
```
