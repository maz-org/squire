# SQR-34 — Execution plan (sliced)

**Parent issue:** [SQR-34](https://linear.app/maz-org/issue/SQR-34)
**Tech spec (source of truth for schema + decisions):** [docs/plans/storage-migration-tech-spec.md](./storage-migration-tech-spec.md)
**Sub-issues:** SQR-55 (Session A) → SQR-56 (Session B) → SQR-57 (Session C)

This plan was approved 2026-04-07 after a `/plan-eng-review` session and explicit Q&A. The original SQR-34 description called for one PR; we sliced into three sub-issues so each session can land green and reviewable. **Read this top-to-bottom before touching code.** The resolved-decisions list at the bottom is load-bearing.

---

## Context

`src/extracted-data.ts` currently reads `data/extracted/*.json` into a process-level `Map` cache and runs an in-process keyword scorer for `searchExtracted`. SQR-32 already shipped the `card_*` tables and `src/db.ts`. SQR-34 wires `extracted-data.ts` to Postgres, replaces the keyword scorer with Postgres FTS (`tsvector` + `ts_rank`), and brings the card-data tests onto the real test DB.

The migration is fenced by two parity regression tests built **before** the rewrite — `load(type)` deepEqual against committed snapshots, and `searchExtracted` top-6 against a committed query set. The FTS swap will intentionally fail the search parity test; that snapshot gets updated in Session C with rationale and an eval comparison.

---

## Slicing

Each sub-issue is a separate PR off `main`. Session B starts from Session A's merged state, etc. — no long-lived integration branch.

| Sub-issue | Title | Lands when |
| --- | --- | --- |
| **SQR-55** (Session A) | Seed-cards module + parity snapshots + eval baseline | Tests still green; nothing rewritten yet |
| **SQR-56** (Session B) | FTS schema + extracted-data Postgres rewrite + async tools ripple | Typecheck clean; search-parity test red on purpose |
| **SQR-57** (Session C) | Test rewrites, FTS snapshot refresh, eval delta | All tests green; eval delta documented |

---

## Session A — SQR-55

**Goal:** prep work that doesn't change runtime behavior. Ends with all tests green.

### Session A steps

1. **Branch + issue prep.** `gitBranchName` from SQR-55. Move SQR-55 to In Progress.
2. **Eval baseline.** `npm run eval` against current main. Save log to `/tmp/sqr-55-eval-baseline.log`. Note the Langfuse run/experiment ID — Session C will compare against it.
3. **`src/seed/seed-cards.ts`.** Export `seedCards(db, opts?: { game?: string; types?: CardType[] })`:
   - For each requested type, read `data/extracted/<type>.json`.
   - Skip records with `_error` or `_parseError`.
   - Validate each record with `SCHEMAS[type]` from `src/schemas.ts`. Skip + warn on Zod failure.
   - Map Zod-shaped object → Drizzle row (camelCase → camelCase; Drizzle handles snake_case at the column level).
   - Upsert via `db.insert(table).values(rows).onConflictDoUpdate({ target: [table.game, table.sourceId], set: <all-non-key-cols-via-getTableColumns> })`.
   - Wrap each type in its own `db.transaction(...)` so partial failure rolls back per type.
4. **`scripts/seed-cards.ts`.** Thin CLI: `getDb('cli')` → `seedCards(db)` → `await close()`. Print row counts. Wire `"seed:cards": "node scripts/seed-cards.ts"` in `package.json`.
5. **Smoke.** `docker compose up -d && npm run db:migrate && npm run seed:cards` populates all 10 tables. Row counts match `data/extracted/*.json` lengths.
6. **`scripts/generate-parity-snapshots.ts`.** A one-shot script that:
   - Imports the **current JSON-backed** `load(type)` from `src/extracted-data.ts` (do NOT rewrite extracted-data.ts in this session).
   - Writes `test/fixtures/parity-snapshots/<type>.json` for all 10 types, **sorted by `sourceId`** so the snapshots line up with the post-migration `ORDER BY source_id`.
   - For each query in the seed list below, runs the **current keyword-scorer** `searchExtracted(query, 6)` and captures the top-6 `sourceId`s. Writes `test/fixtures/search-queries/cards.json` as `[{query, expectedTopSourceIds: string[]}, ...]`.
   - Query seeds (drop any that return empty against real data, replace with adjacent queries that hit something — the goal is ~20 queries that exercise all 10 card types):

     ```text
     "algox archer hp", "drifter level 3 abilities", "prosperity 3 items",
     "minor healing potion", "winter outpost event", "wall building cost",
     "scenario temple liberation", "personal quest envelope", "battle goal assassin",
     "monster initiative low", "fire elemental immunity", "shield boots small item",
     "boss monster stats", "wood gathering camp", "starting scenario",
     "two-handed weapon", "level 0 monster move", "summer road event",
     "character mat hand size", "loot deck herbs"
     ```

7. **Move existing fixture.** `git mv test/fixtures/search-queries.json test/fixtures/search-queries/rules.json`. Update the SQR-33 test that references the old path (grep for it).
8. **Commits** (small + focused, in order):
   1. `test(fixtures): nest search-queries under rules.json subdir`
   2. `feat(seed): add seed-cards bridge module (SQR-55)`
   3. `test(parity): commit pre-migration load + search snapshots (SQR-55)`
9. **Verify.** `npm run lint`, `npm run typecheck`, `npm run test` all green. `git status` clean.
10. **PR.** `/review` → `/ship`. Eval baseline log + run ID in the PR description.

### Out of scope for SQR-55

- Schema changes, FTS, `extracted-data.ts` rewrite, async ripple, test rewrites. Those land in SQR-56 and SQR-57.

---

## Session B — SQR-56

**Goal:** lands the migration core. Typecheck-green, runtime-green, but `extracted-data.test.ts` will be red until SQR-57.

### Session B steps

1. **Branch + issue prep.** `gitBranchName` from SQR-56 off latest `main` (SQR-55 should be merged first). Move SQR-56 to In Progress.
2. **FTS schema.** Edit `src/db/schema/cards.ts`:
   - Define a custom tsvector column type via `customType` from `drizzle-orm/pg-core` (or fall back to `text('search_vector')` if `customType` fights us — the column is generated and only ever read).
   - Add `searchVector` generated column to each of the 10 card tables: `.generatedAlwaysAs(sql\`...\`, { mode: 'stored' })`.
   - Build the tsvector from text/array columns only (NOT jsonb — keeps it simple, recall is sufficient). Use `coalesce(col, '')` for nullable text and `array_to_string(arr_col, ' ', '')` for text arrays. Per-type field lists:

     | Table | Fields concatenated into tsvector |
     | --- | --- |
     | `card_monster_stats` | `name`, `level_range`, `array_to_string(immunities, ' ', '')`, `coalesce(notes, '')` |
     | `card_monster_abilities` | `monster_type`, `card_name`, `array_to_string(abilities, ' ', '')` |
     | `card_character_abilities` | `card_name`, `character_class`, `coalesce(level, '')` |
     | `card_character_mats` | `name`, `character_class`, `array_to_string(traits, ' ', '')`, `array_to_string(perks, ' ', '')`, `array_to_string(masteries, ' ', '')` |
     | `card_items` | `number`, `name`, `slot`, `effect` |
     | `card_events` | `event_type`, `coalesce(season, '')`, `number`, `flavor_text` |
     | `card_battle_goals` | `name`, `condition` |
     | `card_buildings` | `coalesce(building_number, '')`, `name`, `effect`, `coalesce(notes, '')` |
     | `card_scenarios` | `scenario_group`, `index`, `name`, `array_to_string(monsters, ' ', '')`, `array_to_string(allies, ' ', '')`, `array_to_string(unlocks, ' ', '')`, `coalesce(rewards, '')` |
     | `card_personal_quests` | `card_id`, `name`, `open_envelope` |

   - Add a GIN index per table: `index('card_<type>_search_idx').using('gin', t.searchVector)`. If Drizzle 0.45's `.using('gin', ...)` doesn't accept it, declare in raw SQL inside the migration file.
3. **Migration.** `npx drizzle-kit generate` → `src/db/migrations/0002_card_fts.sql`. Drizzle's stored-generated tsvector support is rough; if generation produces wrong SQL, hand-write the migration: per-table `ALTER TABLE card_<type> ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', <expr>)) STORED; CREATE INDEX card_<type>_search_idx ON card_<type> USING gin(search_vector);`. Keep schema.ts and migration in sync so future drizzle introspection round-trips cleanly.
4. **Apply migration.** `npm run db:migrate` (dev) and `npm run db:migrate:test` (test). Smoke check: `psql ... -c "SELECT search_vector FROM card_battle_goals LIMIT 1;"` returns a non-null tsvector.
5. **Rewrite `src/extracted-data.ts`:**
   - Drop `_cache`, `existsSync`, `readFileSync`, `EXTRACTED_DIR`, `score`, `scoreRecord`, `STOPWORDS`, the tokenizer, `loadAll`. (Verify with `grep` that no caller depends on `loadAll`.)
   - Build a `TYPE_TO_TABLE: Record<CardType, PgTable>` map.
   - `export async function load(type, opts?: { game?: string }): Promise<ExtractedRecord[]>`:
     - `const { db } = getDb();` (server-mode shared pool)
     - `db.select().from(table).where(eq(table.game, game ?? 'frosthaven')).orderBy(table.sourceId)`
     - Map row → record: drop `id`, `game`, `searchVector`; add `_type: type`. Drizzle returns camelCase keys per the schema.
   - `export async function searchExtractedRanked(query, k = 6, opts?: { game?: string }): Promise<{ record: ExtractedRecord; score: number }[]>`:
     - Use `db.execute(sql\`...\`)` with a UNION ALL across all 10 tables.
     - Per branch, build a `jsonb_build_object('camelKey', col, ...)` payload from `getTableColumns(table)` (excluding `id`, `game`, `searchVector`). A small helper `tableToJsonbObject(table)` keeps the SQL maintainable.
     - Each branch:

       ```sql
       SELECT
         '<type>' AS card_type,
         <jsonb_build_object_expr> AS payload,
         ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS score
       FROM card_<type>
       WHERE game = $2 AND search_vector @@ websearch_to_tsquery('english', $1)
       ```

     - Wrap as subquery, `ORDER BY score DESC LIMIT $3`.
     - Reshape: payload comes back as a parsed JS object (pg jsonb). Build `record = { _type: card_type, ...payload }`.
   - `export async function searchExtracted(query, k, opts?): Promise<ExtractedRecord[]>` is `searchExtractedRanked(...).then(rs => rs.map(r => r.record))`.
   - `recordToText` and `formatExtracted` UNCHANGED.
   - `export async function extractedStats(): Promise<string>` — single CTE counting all 10 tables, format as before.
   - **No JSON fallback** — per Decision 9 of the tech spec, throw a clear error if the DB is unreachable.
6. **Async ripple in `src/tools.ts`:**
   - Drop `scoreRecord`, `STOPWORDS`, the tokenizer, `ID_FIELDS` map.
   - `searchRules(query, topK, opts?)` — already async; just add `opts?: { game? }`. If `vector-store.search()` doesn't yet support a game filter, leave a TODO comment referencing the Phase 2 issue.
   - `searchCards(query, topK, opts?)` — async. `const ranked = await searchExtractedRanked(query, topK, opts); return ranked.map(({ record, score }) => ({ type: record._type, data: stripUnderscoreKeys(record), score }))`.
   - `listCardTypes(opts?)` — async. `Promise.all(TYPES.map(async t => ({ type: t, count: (await load(t, opts)).length })))`. (Optimization to a single CTE later if needed.)
   - `listCards(type, filter?, opts?)` — async. `await load(type, opts)`, then existing in-memory filter logic on the records (after stripping `_*` keys).
   - `getCard(type, id, opts?)` — async. **Match on `sourceId`, not the natural key.** `const records = await load(type, opts); return records.find(r => r.sourceId === id) ?? null;` — case-sensitive (sourceId is canonical). Update the doc comment to reference §natural key verification of the tech spec. Drop `ID_FIELDS`.
7. **Caller awaits.** `src/mcp.ts`, `src/service.ts`, `src/agent.ts`, `src/server.ts`. Run `npm run typecheck` after each file to catch missed sites.
8. **Commits:**
   1. `feat(db): add card_* search_vector + GIN indexes (SQR-56)`
   2. `refactor(extracted-data): query Postgres + Postgres FTS (SQR-56)`
   3. `refactor(tools): async ripple + drop duplicate scorer (SQR-56)`
9. **Verify.** `npm run typecheck` clean. `npm run db:migrate{,:test}` clean. `npm run lint` clean. `npm run test` will be red on `extracted-data.test.ts` and any test that mocks fs for card data — that's expected, SQR-57 fixes it. **Note this in the PR description so reviewers know.**
10. **PR.** `/review` → `/ship`. Call out in the description that test rewrites land in SQR-57; reviewers should not block on the red tests.

### Out of scope for SQR-56

- Test rewrites, FTS snapshot regeneration, eval delta. Those land in SQR-57.

---

## Session C — SQR-57

**Goal:** close out the migration. All tests green. Eval delta documented.

### Session C steps

1. **Branch + issue prep.** `gitBranchName` from SQR-57 off latest `main`. Move SQR-57 to In Progress.
2. **Extend `test/helpers/db.ts#resetTestDb`.** TRUNCATE all 10 `card_*` tables in addition to the existing list. RESTART IDENTITY CASCADE handles dependencies.
3. **Rewrite `test/extracted-data.test.ts`:**
   - Drop `vi.mock('node:fs', …)` and FAKE_* fixtures entirely.
   - Imports: `setupTestDb`, `resetTestDb` from `./helpers/db.ts`; `seedCards` from `../src/seed/seed-cards.ts`; `load`, `searchExtracted`, `searchExtractedRanked`, `formatExtracted`, `extractedStats` from `../src/extracted-data.ts`.
   - `let db; beforeAll(async () => { db = await setupTestDb(); });`
   - `beforeEach(async () => { await resetTestDb(); await seedCards(db); });`
   - `describe('load parity')` — `for (const type of TYPES)` deepEqual against `test/fixtures/parity-snapshots/<type>.json`.
   - `describe('searchExtracted parity')` — for each query in `cards.json`, assert top-6 sourceIds match in order.
   - `describe('idempotency')` — seed twice, query count for each table, assert equal.
   - `describe('game filter')` — insert a synthetic `gloomhaven-2` battle goal directly via Drizzle, assert `load('battle-goals', { game: 'gloomhaven-2' })` returns it and the default-`frosthaven` call doesn't.
   - Keep `recordToText` / `formatExtracted` tests as pure-function tests (no DB).
4. **Fix other test files broken by ripple.** Drop fs mocks, add the same `setupTestDb` + `seedCards` pattern, add `await` to tool call sites:
   - `test/tools.test.ts` — also update `getCard` assertions to use `sourceId` values from the seeded fixtures (the natural-key lookup is gone).
   - `test/mcp-in-process.test.ts`
   - `test/server.test.ts`
   - `test/service.test.ts`
   - `test/mcp.test.ts` — likely just needs awaits.
5. **Run tests.** `npx vitest run` — load parity should pass; search parity will FAIL (intentional, FTS ranking differs from keyword).
6. **FTS snapshot regeneration.** Add a `--mode fts` flag (or a sibling script `scripts/regenerate-fts-snapshots.ts`) that uses the new `searchExtracted` to regenerate `test/fixtures/search-queries/cards.json` against the dev DB. Diff old vs new. Build a per-query summary table for the PR description (or a sibling `cards.README.md` since JSON can't hold comments).
7. **Re-run tests.** Should now be all green.
8. **Eval comparison.**
   - `npm run eval` again, capture to `/tmp/sqr-57-eval-postmigration.log`. Note the Langfuse run/experiment ID.
   - Compare baseline (from SQR-55 PR description) vs post-migration. If `/eval-compare` skill is available, use it; otherwise diff metric lines manually or via Langfuse UI.
   - If scores regress meaningfully, **STOP** and report. Do not paper over with snapshot updates.
   - If scores hold or improve, summarize for the PR description.
9. **Docs.** Add a short note in `docs/ARCHITECTURE.md` §Data Lifecycle that card data is now Postgres-backed and FTS-ranked.
10. **Commits:**
    1. `test(helpers): truncate card_* tables in resetTestDb (SQR-57)`
    2. `test(extracted-data): rewrite against test DB; parity tests (SQR-57)`
    3. `test(tools,mcp,server,service): async ripple test fixes (SQR-57)`
    4. `test(fixtures): update card search snapshots for FTS ranking (SQR-57)` — body summarizes the delta.
    5. `docs(architecture): note card data is Postgres + FTS (SQR-57)`
11. **Verify.** Lint, typecheck, full test run, all green. `grep -r "scoreRecord\|STOPWORDS\|EXTRACTED_DIR" src/` empty. `grep -r "data/extracted" src/extracted-data.ts` empty.
12. **PR.** `/review` → `/ship`. PR description must include:
    - FTS search-snapshot delta summary.
    - Eval baseline → post comparison (with Langfuse run IDs).
    - Hold for explicit @bcm approval before merge if anything looks off.

---

## Resolved decisions (load-bearing — do not re-litigate)

1. **Search fixtures live under `test/fixtures/search-queries/{rules,cards}.json`.** The original SQR-33 file is renamed in SQR-55. Resolves the SQR-34 issue's collision with the existing fixture.
2. **`load(type)` orders by `sourceId`.** Snapshots are generated in that order so they align with the post-migration `ORDER BY source_id`.
3. **FTS UNION uses `jsonb_build_object` per branch** (camelCase keys built via a small `tableToJsonbObject(table)` helper from `getTableColumns`). TS reshapes to `ExtractedRecord` by adding `_type`.
4. **Async ripple for the 5 atomic tools is folded in** (originally out of scope per the SQR-34 description, but unavoidable once `searchExtracted` becomes async). Lands in SQR-56.
5. **`resetTestDb` TRUNCATE list extended** to include all 10 `card_*` tables in SQR-57.
6. **`searchExtractedRanked` is a separate exported helper** returning `{ record, score }[]`. `searchExtracted` keeps the simpler `Promise<ExtractedRecord[]>` shape. `tools.ts#searchCards` calls `searchExtractedRanked`.
7. **`getCard` resolves on `sourceId`**, not the per-type natural key. `ID_FIELDS` map is dropped. Test assertions in `test/tools.test.ts` are updated to use `sourceId` values from the seeded fixtures.
8. **No JSON fallback** if the DB is unreachable. `load` and friends throw a clear error per Decision 9 of the tech spec.
9. **End-to-end evals are part of the verification.** Baseline captured in SQR-55, post run + comparison in SQR-57. Block merge of SQR-57 on @bcm approval if scores regress.
10. **FTS tsvector is built from text/array columns only** (no jsonb). Per-type field lists are in the SQR-56 step 2 table above. Sufficient for keyword recall and avoids drizzle-kit fighting jsonb expressions.

---

## Critical files (cumulative across all 3 sessions)

**Modified:**

- `src/extracted-data.ts` — full rewrite (SQR-56)
- `src/tools.ts` — async + drop duplicate scorer (SQR-56)
- `src/mcp.ts`, `src/service.ts`, `src/agent.ts`, `src/server.ts` — `await` ripple (SQR-56)
- `src/db/schema/cards.ts` — add `searchVector` + GIN indexes (SQR-56)
- `test/extracted-data.test.ts` — full rewrite (SQR-57)
- `test/helpers/db.ts` — extend TRUNCATE list (SQR-57)
- `test/tools.test.ts`, `test/mcp-in-process.test.ts`, `test/server.test.ts`, `test/service.test.ts`, `test/mcp.test.ts` — DB fixtures + awaits (SQR-57)
- `package.json` — `seed:cards` script (SQR-55)
- `docs/ARCHITECTURE.md` — Data Lifecycle note (SQR-57)

**Created:**

- `src/seed/seed-cards.ts` (SQR-55)
- `scripts/seed-cards.ts` (SQR-55)
- `scripts/generate-parity-snapshots.ts` (SQR-55)
- `src/db/migrations/0002_card_fts.sql` (SQR-56)
- `test/fixtures/parity-snapshots/<type>.json` × 10 (SQR-55)
- `test/fixtures/search-queries/rules.json` (renamed from existing, SQR-55)
- `test/fixtures/search-queries/cards.json` (SQR-55, updated in SQR-57)

**Reused — do not duplicate:**

- `src/db.ts#getDb`, `resolveDatabaseUrl`, `schema`
- `src/db/schema/cards.ts` — existing table definitions
- `src/schemas.ts#SCHEMAS`, `CARD_TYPES` — Zod validation in seed
- `test/helpers/db.ts#setupTestDb`, `resetTestDb`
- `eval/run.ts` — eval harness

---

## Always-on constraints (reaffirmed)

- Linear is the tracker. Move sub-issues to In Progress before starting; assign to yourself.
- Always use PRs. Never push to main. Never force-push.
- TDD where feasible — parity snapshot tests come **before** the extracted-data rewrite.
- Document *why* in the codebase. Resolved decisions above belong here, not in PR comments alone.
- Conventional Commits. Small focused commits within each PR.
- No JSON fallback (Decision 9). No 15-min token rotation (long-lived tokens are deliberate). Merge main if it moves; do not rebase.
- Don't open separate Linear issues for adjacent data-quality fixes that surface during the work — fold them into the current PR per `feedback_fold_in_data_fixes`.
