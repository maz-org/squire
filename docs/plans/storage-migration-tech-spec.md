# Storage & Data Migration — Tech Spec

**Linear project:** [Squire · Storage & Data Migration](https://linear.app/maz-org/project/squire-storage-and-data-migration-5aad3521ab7e)
**Target:** 2026-04-08
**Produced by:** plan-eng-review session on 2026-04-07
**Companion docs (read first):** `docs/ARCHITECTURE.md`, `docs/SPEC.md`, `docs/SECURITY.md`, `docs/DEVELOPMENT.md`
**Companion checkpoint:** `docs/plans/storage-migration-review-checkpoint.md` — the interactive decision log that produced this spec. Read it if you need to know *why* a decision was made.

---

## Goal

Migrate Squire's persistence layer from flat JSON files + in-memory `Map`s to Postgres + pgvector. After this project lands:

- The Xenova rulebook embeddings live in a `pgvector` column, not `data/index.json`
- The 10 GHS card types live in normalized Postgres tables, not `data/extracted/*.json`
- OAuth 2.1 state (clients, authorization codes, access tokens, audit log) lives in Postgres, not in-memory `Map`s in `src/auth.ts`
- The 5 atomic tools (`searchRules`, `searchCards`, `listCardTypes`, `listCards`, `getCard`) read from Postgres via Drizzle
- A repeatable local dev bootstrap: `docker-compose up && npm run index && npm run seed:cards` produces a fully populated dev database in ~2 minutes
- All tests (including card-data tests) run against a real Postgres service in CI

This project does **not** cover: Google OAuth web login (User Accounts project), web UI (Web UI project), Docker containerization of Squire itself (Deployment project), production host selection (Production Readiness project), rate-limiting `/register` (Production Readiness), GitHub Actions data-lifecycle workflows (Deployment).

## Non-goals for this project

- `campaigns` / `players` / `character_state` tables — those are Phase 4, need a data isolation design first per SECURITY.md §3
- Refresh-token rotation — long-lived tokens are a deliberate DX choice, see SECURITY.md §2 (as updated)
- CSRF protection on auth endpoints — User Accounts project
- Production prod-DB provisioning — Deployment project
- Conversation history persistence — Phase 3+, SPEC.md

---

## Architectural framing

### Data is independent of the image

The image is stateless. Postgres is the source of runtime truth. Data-change events (GHS upstream refresh, new PDF, chunking change, embedding model change) are managed by dedicated workflows in the Deployment project, not by rebuilding and redeploying the image.

```text
Sources (git)                Runtime (Postgres)           Image (stateless)
─────────────                ──────────────────           ─────────────────
data/pdfs/*.pdf      ────▶   embeddings (pgvector)    ◀────  serves queries
data/extracted/*.json ───▶   card_* tables            ◀────  serves queries
                             users, sessions,         ◀────  serves auth
                             oauth_*, audit_log
```

### Diff vs rebuild

| Change | Diff-able? | Recovery |
| --- | --- | --- |
| New PDF added | Yes | `index-docs.ts` skip-by-source (already works) |
| Existing PDF changed | Partial | `DELETE FROM embeddings WHERE source=$1` + reindex that source |
| PDF removed | Yes | `DELETE FROM embeddings WHERE source=$1` |
| Chunking logic changed | No | Full reindex — manual trigger with `rebuild: true` |
| Embedding model or dimension changed | No | Drizzle schema migration (vector column type changes) + full reindex |
| GHS card data updated | Yes | Idempotent upsert by `(game, <natural_id>)` |
| Card schema changed | Yes | Drizzle migration + upsert-all |

### Drift guard: `embedding_version`

The `embeddings` table gets an `embedding_version text not null` column. Value set at insert time from a constant `EMBEDDING_VERSION` in `src/index-docs.ts`. Bump it whenever chunking logic or the embedding model changes. On server startup, `src/service.ts` runs a sanity check: `SELECT DISTINCT embedding_version FROM embeddings`. If the set doesn't include the current `EMBEDDING_VERSION`, log a loud warning. Prevents silent code-data drift after a chunking change that wasn't paired with a reindex.

---

## Schema (Drizzle)

This is the target schema after all 7 issues land. Implementors should use this as the source of truth. Any deviations need to be flagged and discussed.

### `users` (shell — populated by User Accounts project a day later)

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### `sessions` (shell — populated by User Accounts)

```ts
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // opaque session token
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
}, (t) => ({
  userIdx: index('sessions_user_idx').on(t.userId),
  expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
}));
```

### `oauth_clients` (active — used from day 1)

```ts
export const oauthClients = pgTable('oauth_clients', {
  clientId: uuid('client_id').primaryKey().defaultRandom(),
  clientIdIssuedAt: timestamp('client_id_issued_at', { withTimezone: true }).notNull().defaultNow(),
  redirectUris: text('redirect_uris').array().notNull(),
  clientName: text('client_name'),
  grantTypes: text('grant_types').array(),
  responseTypes: text('response_types').array(),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
  scope: text('scope'),
});
```

### `oauth_authorization_codes` (active — hashed at rest per Decision 6)

```ts
export const oauthAuthorizationCodes = pgTable('oauth_authorization_codes', {
  // SHA-256 hex of the authorization code; the raw code is only ever in flight.
  codeHash: text('code_hash').primaryKey(),
  clientId: uuid('client_id').notNull().references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // nullable until User Accounts wires consent
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
  scope: text('scope'),
  state: text('state'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // createdAt + 60s
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  expiresIdx: index('oauth_auth_codes_expires_idx').on(t.expiresAt),
}));
```

### `oauth_tokens` (active — hashed at rest per Decision 2, long-lived per Decision 2 clarification)

```ts
export const oauthTokens = pgTable('oauth_tokens', {
  // SHA-256 hex of the access token; raw token is only ever in flight.
  tokenHash: text('token_hash').primaryKey(),
  clientId: uuid('client_id').notNull().references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // nullable until User Accounts wires consent
  scope: text('scope'),
  // Long-lived per feedback_long_lived_tokens memory and SECURITY.md §2 (as updated).
  // 30-day default, may revisit if threat model changes.
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (t) => ({
  clientIdx: index('oauth_tokens_client_idx').on(t.clientId),
  userIdx: index('oauth_tokens_user_idx').on(t.userId),
  expiresIdx: index('oauth_tokens_expires_idx').on(t.expiresAt),
}));
```

### `oauth_audit_log` (active — write on every auth event)

```ts
export const oauthAuditLog = pgTable('oauth_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: text('event_type').notNull(), // 'register' | 'authorize' | 'token_issue' | 'token_verify' | 'token_revoke' | 'token_expired' | 'code_exchange'
  clientId: uuid('client_id').references(() => oauthClients.clientId, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  outcome: text('outcome').notNull(), // 'success' | 'failure'
  failureReason: text('failure_reason'), // short machine-readable code
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  clientIdx: index('oauth_audit_client_idx').on(t.clientId),
  userIdx: index('oauth_audit_user_idx').on(t.userId),
  createdIdx: index('oauth_audit_created_idx').on(t.createdAt),
}));
```

### `embeddings` (active — rulebook vectors, per Decision 4 + 9 drift guard)

```ts
export const embeddings = pgTable('embeddings', {
  id: text('id').primaryKey(), // `${source}::${chunkIndex}` — preserves existing ID shape
  source: text('source').notNull(), // PDF filename basename
  chunkIndex: integer('chunk_index').notNull(),
  text: text('text').notNull(),
  embedding: vector('embedding', { dimensions: 384 }).notNull(), // pgvector, Xenova MiniLM-L6-v2
  game: text('game').notNull().default('frosthaven'), // Decision 4 — pulled forward from Phase 2
  embeddingVersion: text('embedding_version').notNull(), // Decision 9 — drift guard
}, (t) => ({
  sourceChunkIdx: uniqueIndex('embeddings_source_chunk_idx').on(t.source, t.chunkIndex),
  gameIdx: index('embeddings_game_idx').on(t.game),
  // HNSW index for cosine similarity — see SQR-33 note on operator sign flip.
  embeddingHnswIdx: index('embeddings_hnsw_idx')
    .using('hnsw', sql`${embeddings.embedding} vector_cosine_ops`),
}));
```

### Card tables — 10 of them, all follow this shape

Naming: `card_<type>` matching the current `CardType` keys but with hyphens → underscores.
Every table has:

- `id uuid primary key default gen_random_uuid()` — internal PK
- `game text not null default 'frosthaven'` — Decision 4
- `source_id text not null` — the GHS source identifier (e.g.
  `gloomhavensecretariat:battle-goal/1301`). Promoted from import-only
  metadata to a real Zod schema field on 2026-04-07 — see "Natural key
  verification" below.
- **Unique constraint on `(game, source_id)`** — the only uniqueness
  constraint on a card table. Idempotent upserts key on this.
- Per-type natural-key fields (`name`, `level_range`, `number`, `index`,
  `card_id`, etc.) flattened from the Zod schemas in `src/schemas.ts` —
  kept as regular indexed columns since they're useful for query / filter /
  `getCard` lookups, but **not unique**.
- `game` index
- `jsonb` column for any field that's nested or variable-shape (e.g.,
  `monster_stats.normal`, `scenarios.loot_deck_config`)

Example — `card_monster_stats`:

```ts
export const cardMonsterStats = pgTable(
  'card_monster_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    game: text('game').notNull().default('frosthaven'),
    sourceId: text('source_id').notNull(),
    name: text('name').notNull(),
    levelRange: text('level_range').notNull(), // '0-3' | '4-7'
    normal: jsonb('normal').notNull(),
    elite: jsonb('elite').notNull(),
    immunities: text('immunities').array().notNull(),
    notes: text('notes'),
  },
  (t) => [
    uniqueIndex('card_monster_stats_game_source_idx').on(t.game, t.sourceId),
    index('card_monster_stats_game_idx').on(t.game),
    index('card_monster_stats_name_idx').on(t.name),
  ],
);
```

`getCard(type, id)` semantics (for SQR-35): `id` resolves against
`source_id`, not the per-type natural-key column. Recorded here so SQR-35's
implementer doesn't pick a different convention.

### Natural key verification (2026-04-07)

Implementors of the original spec were told to "double-check the per-type
natural keys against `src/schemas.ts` and `data/extracted/*.json` before
building." Doing that during SQR-31 turned up four collisions and three
latent data-quality bugs. Rather than paper over them with per-type
fixes, we unified on `(game, source_id)` for every card type.

**Collisions found against the original per-type keys:**

| Card type | Original key | Collisions | Root cause |
| --- | --- | --- | --- |
| `events` | `(game, event_type, number)` | 114 | Outpost summer/winter share numbering. Adding `season` would fix it but creates a NULLs-distinct edge case for boat events. |
| `monster-abilities` | `(game, monster_type, card_name)` | 32 | The Boss deck is a *template* — every boss scenario instantiates its own variant with scenario-specific initiatives. There's no field in `MonsterAbilitySchema` that names which boss owns the card. |
| `buildings` | `(game, building_number, level)` | 4 | Walls have no building number in the GHS domain. Importer was emitting `buildingNumber: undefined`. |
| `scenarios` | `(game, index)` | 17 | Frosthaven solo scenarios share `index` values with the main campaign (e.g. main scenario 20 "Temple of Liberation" vs solo scenario 20 "Wonder of Nature"). The schema had no namespace field. |

**Why `(game, source_id)` instead of patching each per-type key:**

- `_source` already exists on every imported record — it's the GHS source
  identifier (`gloomhavensecretariat:<entity>/<id>`), stable across
  reimports because it comes from the upstream data.
- A single uniform key removes per-type domain modeling guesswork. New card
  types in Phase 2 (GH2) get a clean rule to follow.
- The Boss-deck "what's the right key for template-instantiated cards"
  question disappears: each row's `source_id` distinguishes it.
- The scenarios solo-vs-main namespace question disappears: solo20_drifter
  and 020 have different filenames, hence different `source_id` values
  (importer changed to use the filename basename, not the in-file `index`
  field, when constructing `source_id`).

**Three data-quality bugs fixed in the same PR (rather than deferred):**

1. **Exploding Ammunition duplicate.** Upstream GHS
   `ancient-artillery.json` contains two `Exploding Ammunition` rows
   (cards 627, 628) with byte-identical content except for `cardId`.
   `import-monster-abilities.ts` now dedupes by content equivalence after
   sorting each deck by `cardId`, keeping the lowest-ID row and logging
   the dropped `sourceId` to stderr.
2. **Walls have no `buildingNumber`.** `import-buildings.ts` was emitting
   `buildingNumber: undefined` and `_source: gloomhavensecretariat:building/undefined`
   for all walls. `BuildingSchema.buildingNumber` is now `z.string().nullable()`,
   the importer writes `null` for walls, and `sourceId` falls back to
   `ghs.name` so each wall gets a distinct identifier.
3. **Scenario index cross-namespace overlap.** Frosthaven solos share
   `index` values with the main campaign. `ScenarioSchema` gains a
   `scenarioGroup: 'main' | 'solo' | 'random'` field, derived from the
   GHS filename pattern (`solo*` → solo, `random` → random, otherwise →
   main). `sourceId` now uses the filename basename so the canonical key
   is unique end-to-end.

**Drizzle implementation note:** the schema files at `src/db/schema/{core,auth,cards,index}.ts` ship in SQR-31 (this issue) along with `drizzle-orm` + `pg` as dependencies. SQR-32 still owns `src/db.ts`, the migration generation, the docker-compose Postgres service, and the CI service container — adding the deps early lets the schema files typecheck in this PR.

**Parity-test note:** the `load(type)` parity snapshots for SQR-34 must
be generated *after* `sourceId` lands in the Zod schemas, not before, or
every snapshot will diff on the new field.

---

## Module layout after the migration

```text
src/
  db.ts                  NEW — Drizzle client + pool factory (CLI mode vs server mode)
  db/
    schema.ts            NEW — all Drizzle table definitions (pulled from above)
    migrations/          NEW — drizzle-kit generated migrations
  auth.ts                REWRITTEN — uses MCP SDK auth handlers + Drizzle repos
  vector-store.ts        REWRITTEN — search() queries pgvector, sign-flip handled
  extracted-data.ts      REWRITTEN — load/searchExtracted query Postgres; recordToText() unchanged
  tools.ts               UPDATED — all 5 tools become async, accept optional game filter
  mcp.ts                 UPDATED — async tool handlers
  agent.ts               UPDATED — await tool calls
  service.ts             UPDATED — startup embedding_version sanity check, DB pool init
  index-docs.ts          UPDATED — writes to embeddings table; exports EMBEDDING_VERSION const
  import-*.ts            UNCHANGED — still writes data/extracted/*.json
  seed/                  NEW
    seed-cards.ts        NEW — reads data/extracted/*.json, upserts into card_* tables
    seed-users.ts        NEW (tiny) — creates a dev user for local testing

data/
  pdfs/                  unchanged
  extracted/*.json       unchanged (still committed, refreshed weekly)
  index.json             DELETED after SQR-33 lands (Decision 7)

docker-compose.yml       NEW — Postgres 16 + pgvector 0.7.x

.github/workflows/
  test.yml               UPDATED — adds Postgres service container
  refresh-data.yml       UPDATED — drops data/index.json refresh, keeps extracted/ refresh
  # Deployment project will add: seed-cards.yml, reindex-pdfs.yml

test/
  fixtures/
    parity-snapshots/    NEW — pre-migration snapshots of load(type) output for regression tests
    search-queries.json  NEW — fixed query set for searchExtracted parity tests
```

---

## `src/db.ts` contract

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './db/schema.ts';

type Mode = 'server' | 'cli';

let serverPool: Pool | null = null;

/**
 * Get a Drizzle client.
 * - mode: 'server' — shared pool across requests, size ~10, closed on SIGTERM
 * - mode: 'cli'    — size 1, caller MUST await db.close() before process exit
 */
export function getDb(mode: Mode = 'server') {
  if (mode === 'server') {
    serverPool ??= new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    return {
      db: drizzle(serverPool, { schema }),
      close: async () => { /* server pool lives for process lifetime */ },
    };
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}

export async function shutdownServerPool() {
  if (serverPool) {
    await serverPool.end();
    serverPool = null;
  }
}
```

`src/server.ts` gets a SIGTERM handler calling `shutdownServerPool`. `src/query.ts` and `src/index-docs.ts` use `mode: 'cli'` and `await close()` at the end.

---

## pgvector operator sign-flip (SQR-33 critical detail)

`src/vector-store.ts#cosineSimilarity` returns **dot product** of normalized vectors (high = more similar).

pgvector uses **distance** operators (low = more similar):

- `<=>` — cosine distance = `1 - cosine_similarity`
- `<#>` — negative inner product = `-1 * dot_product`

The vectors are pre-normalized by the embedder, so cosine similarity = dot product. The cleanest migration is to preserve the "high score = more similar" contract in the `search()` return value:

```ts
// Old: scored.sort((a, b) => b.score - a.score)
// New SQL:
const rows = await db.execute(sql`
  SELECT
    id, source, chunk_index, text, embedding, game, embedding_version,
    1 - (embedding <=> ${vectorParam}) AS score
  FROM embeddings
  WHERE game = ${game}
  ORDER BY embedding <=> ${vectorParam}
  LIMIT ${k}
`);
```

Two things going on:

1. `ORDER BY embedding <=> $1` — lets pgvector use the HNSW index for fast nearest-neighbor
2. `SELECT 1 - (embedding <=> $1) AS score` — returns similarity (0..1, high = better) to preserve the `ScoredEntry` contract

All downstream callers (`mcp.ts`, `agent.ts`, `tools.ts`) keep working without any semantic change. The tests in `test/tools.test.ts` and `test/mcp-in-process.test.ts` that assert on score ordering keep passing.

---

## Async ripple (SQR-35 critical detail)

Today, `searchCards`, `listCardTypes`, `listCards`, `getCard` in `tools.ts` are synchronous. `searchRules` is already async (because of the embedder). After the migration, all 5 tools become async.

Ripple sites to update:

- `src/tools.ts` — signatures become `async`, internals use `await db.select()...`
- `src/mcp.ts` — all 5 tool handlers become `async ({...}) => { const results = await ... }`
- `src/service.ts` — the bundled `/api/ask` path awaits all tool calls
- `src/agent.ts` — tool call loop already handles async tool execution (double-check)
- `src/server.ts` — REST endpoints in `/api/cards`, `/api/card-types`, `/api/cards/:type/:id` await tool calls
- `test/tools.test.ts`, `test/mcp-in-process.test.ts`, `test/mcp.test.ts`, `test/server.test.ts`, `test/service.test.ts` — fixture setup becomes `beforeEach` DB seed rather than pre-built JSON

Two changes to the tool signatures, both deliberate:

1. **All five tools become async.** `searchCards`, `listCardTypes`, `listCards`, and `getCard` were synchronous; they now return `Promise<...>`. `searchRules` was already async (because of the embedder), unchanged in that regard.
2. **Each tool gains an optional `game` parameter.** `searchRules(query, topK, opts?)`, `searchCards(query, topK, opts?)`, `listCardTypes(opts?)`, `listCards(type, filter?, opts?)`, `getCard(type, id, opts?)`, where `opts = { game?: 'frosthaven' | 'gloomhaven-2' }` and defaults to `'frosthaven'`. Phase 1 ignores the value at the call sites; Phase 2 wires the per-session game selector through to the tool calls.

Return types are unchanged (`RuleResult[]`, `CardResult[]`, `CardTypeInfo[]`, etc.). The score semantics on `searchRules` are preserved by the operator sign-flip handling in `vector-store.ts`. The score semantics on `searchCards` shift from "keyword overlap count" to "ts_rank value" once SQR-34's FTS swap lands — same field, different distribution; PR description must call this out.

---

## Test strategy (Decision 10)

Full integration against a test Postgres. Implementation pattern:

```ts
// test/helpers/db.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../../src/db/schema.ts';

let testPool: Pool;

export async function setupTestDb() {
  testPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const db = drizzle(testPool, { schema });
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  return db;
}

export async function resetTestDb(db) {
  // Fast: truncate all tables with CASCADE in reverse dependency order.
  // Slow but safer: use a transaction per test that rolls back.
  await db.execute(sql`
    TRUNCATE embeddings, oauth_audit_log, oauth_tokens, oauth_authorization_codes,
             oauth_clients, sessions, users,
             card_monster_stats, card_monster_abilities, card_character_abilities,
             card_character_mats, card_items, card_events, card_battle_goals,
             card_buildings, card_scenarios, card_personal_quests
             RESTART IDENTITY CASCADE
  `);
}
```

Every test file calls `setupTestDb()` once in `beforeAll` and `resetTestDb()` in `beforeEach`. Seeding fixtures go through the same seed scripts the prod flow uses — that way seed scripts are test-verified for free.

CI: GitHub Actions services block added to `.github/workflows/test.yml`:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    env:
      POSTGRES_PASSWORD: test
      POSTGRES_DB: squire_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

Test suite runtime target: under 15s. If it goes over, add a parallel-safe test DB pool with per-worker schemas.

---

## Regression tests (IRON RULE — mandatory)

Three regressions the migration must not silently introduce. These get tests *before* the migration code is written.

### 1. `load(type)` parity (SQR-34)

Before touching `extracted-data.ts`, snapshot the output of `load(type)` for each of the 10 card types into `test/fixtures/parity-snapshots/`. Post-migration, the same function reads from Postgres. A test asserts `deepEqual(load(type), loadParitySnapshot(type))` for each type. If the migration silently drops a field, re-shapes a value, or changes ordering, the test fails.

One-time snapshot generator script: `scripts/generate-parity-snapshots.ts`. Committed snapshots are the gold standard.

### 2. `searchExtracted` parity (SQR-34)

Fixed query set in `test/fixtures/search-queries.json`:

```json
[
  {"query": "poison condition", "expectedTopSources": ["monster-stats"]},
  {"query": "drifter level 4", "expectedTopSources": ["character-abilities"]},
  {"query": "prosperity 3 items", "expectedTopSources": ["items"]},
  // ... 20 total
]
```

Pre-migration: capture top-6 IDs for each query. Post-migration: assert same top-6 IDs come back in the same order.

**Expected failure mode:** if SQR-34 swaps the keyword scorer for `ts_rank`, ordering *will* change. That's an intentional decision, not a regression — update the snapshot in the same PR, explain the delta in the PR description, and get explicit approval.

### 3. Tokens survive process restart (new auth.ts rewrite issue)

E2E integration test: start the server, register a client via `/register`, walk through the PKCE flow, get a token. Stop the server. Start a new server process against the same DB. Use the token on an MCP endpoint. Assert 200.

This is the test that proves the in-memory `Map` bug is actually fixed.

---

## Execution order & parallelization

Dependencies:

```text
SQR-32 (Postgres setup + db.ts + CI service container)
   │
   ├─► SQR-33 (embeddings table, pgvector port, vector-store.ts rewrite)
   │
   ├─► SQR-34 (card_* tables, extracted-data.ts rewrite, parity snapshots)
   │
   ├─► [NEW] auth.ts rewrite (oauth_* tables, SDK handlers, hashing, audit log)
   │      │
   │      └─► depends on SQR-31 schema for oauth_* tables and
   │          db.ts from SQR-32
   │
   └─► SQR-31 is not really a sequential step — it's the design output that
       feeds 32/33/34/auth.ts. SQR-31 is "design the schema"; SQR-32 implements
       it in Drizzle. In practice, SQR-31 and SQR-32 are one unit of work.

SQR-35 (atomic tools → SQL, async ripple)
   └─► depends on SQR-33 + SQR-34 both landed (tools touch both tables)

SQR-36 (seed scripts)
   └─► depends on SQR-31/32 schema existing; can start once tables exist
       even before data is migrated, because the seed scripts are idempotent
```

Parallelization across 4 worktrees / agents:

| Lane | Sequence | Touches |
| --- | --- | --- |
| **A** | SQR-31 + SQR-32 (schema design + Postgres setup, one unit) → SQR-33 (vector store) | `src/db*`, `src/vector-store.ts`, `src/index-docs.ts`, `docker-compose.yml`, `.github/workflows/test.yml` |
| **B** | wait for Lane A's `db.ts` + schema → SQR-34 (card data) | `src/extracted-data.ts`, `src/db/schema.ts` (card_* only) |
| **C** | wait for Lane A's `db.ts` + schema → NEW auth.ts rewrite | `src/auth.ts`, `src/db/schema.ts` (oauth_* only) |
| **D** | wait for A+B+C → SQR-35 (atomic tools async ripple) + SQR-36 (seed scripts) | `src/tools.ts`, `src/mcp.ts`, `src/service.ts`, `src/agent.ts`, `src/seed/*` |

Lane A ships first. Lanes B and C run in parallel after A. Lane D consolidates.

Possible conflict: Lanes B and C both touch `src/db/schema.ts`. Mitigation: split schema into `src/db/schema/cards.ts` + `src/db/schema/auth.ts` + `src/db/schema/core.ts` so the two lanes touch different files and merge clean.

---

## Docs to update before/after landing

Order them into PRs per lane so the docs match the code that ships:

**With Lane A (SQR-32/33):**

- `docs/ARCHITECTURE.md` §Game Dimension — note `game` column ships in Phase 1
- `docs/ARCHITECTURE.md` — add a new "Data Lifecycle" section capturing the diff-vs-rebuild table, the `embedding_version` guardrail, and the "data is independent of image" principle
- `docs/SPEC.md` §Phase 2 — remove "Tag each card record with a `game` field" from the task list (already done in Phase 1)
- `docs/DEVELOPMENT.md` §Data management — update the `npm run index` section; add `docker-compose up && npm run index && npm run seed:cards` bootstrap; drop the "vector index is committed as a regular file" language
- `docs/CONTRIBUTING.md` §Data files — same

**With Lane C (auth.ts rewrite):**

- `docs/SECURITY.md` §2 — replace "short-lived access tokens (15 min) with refresh token rotation" with "long-lived access tokens (30-day default) chosen for MCP/API client DX. Revisit if the threat model changes — e.g., multi-tenant production, compliance requirements, or detected abuse." Keep all other §2 mitigations (SDK handlers, exact-match redirect URIs, hashing at rest, audit log, rate limit on `/register` — the last deferred to Production Readiness).

**With the last PR (SQR-36 / Lane D):**

- Delete `data/index.json` from git (Decision 7)
- Update `.github/workflows/refresh-data.yml` to stop touching `data/index.json`

---

## Out of scope for this project (be explicit so these don't drift in)

- `campaigns` / `players` / `character_state` tables (Phase 4)
- Refresh-token rotation (long-lived tokens are the decision)
- Client registration rate limiting (Production Readiness project)
- Google OAuth login UI / consent page (User Accounts project)
- CSRF middleware (User Accounts project)
- Data lifecycle GitHub workflows beyond the test-CI Postgres service (Deployment project)
- Production DB provisioning, backup/restore runbook (Deployment / Production Readiness)
- Conversation history persistence (Phase 3+)
- Embedding model upgrade to Voyage AI (deferred per arch doc tech risk 1)

---

## Success criteria

- [ ] `docker-compose up && npm ci && npm run index && npm run seed:cards` produces a fully populated local dev DB in under 3 minutes on a clean clone
- [ ] `npm test` passes against the CI Postgres service container
- [ ] `load(type)` parity tests pass for all 10 card types
- [ ] `searchExtracted` parity tests pass (or snapshots updated with explicit rationale)
- [ ] Tokens-survive-restart regression test passes
- [ ] `src/auth.ts` no longer contains any `new Map(...)` state
- [ ] `grep -r "data/index.json" src/` returns nothing
- [ ] Startup sanity check logs correctly when `EMBEDDING_VERSION` matches / mismatches
- [ ] All 5 atomic tools accept an optional `game` filter (defaults ignored in Phase 1)
- [ ] PR descriptions link to this tech spec
