# Storage & Data Migration — Plan Review Checkpoint

**Session:** plan-eng-review on Linear project `Squire · Storage & Data Migration` (id `cc8f8006-d695-43b0-9913-9d1d739f1884`), target 2026-04-08, lead @bcm.
**Started:** 2026-04-07
**Reviewer:** Claude (Opus 4.6)
**Status:** Interactive decision walkthrough in progress.

This file exists so the review survives compaction or a crash. If you're a fresh
Claude session picking this up: read `docs/ARCHITECTURE.md`, `docs/SPEC.md`, `docs/SECURITY.md`,
`docs/DEVELOPMENT.md`, `docs/CONTRIBUTING.md`, this file, and the current Linear issues
(SQR-31..36), then continue from the "Next decision" line below.

---

## Project context (don't relitigate)

Initiative: **Squire · Phase 1: MVP Rules Q&A at the Table** (targetDate 2026-04-17).
Five projects in this initiative, sequenced:

1. **Storage & Data Migration** (this one) — Apr 7–8
2. **Web UI** — Apr 8–9
3. **User Accounts** (SQR-37..40 referenced in docs) — Apr 9–10
4. **Deployment** — Apr 10–11
5. **Production Readiness** — Apr 11–12

Target dates are based on Brian's agentic-coding velocity, not human-team velocity.
Take them at face value — this project ships tomorrow.

**Authoritative docs (read first, always):**

- `docs/ARCHITECTURE.md` — tech decisions (Drizzle, pgvector, Hono, etc.)
- `docs/SPEC.md` — product phases and scope
- `docs/SECURITY.md` — OAuth threat model (§2 is load-bearing for this project)
- `docs/DEVELOPMENT.md` — dev workflow
- `docs/CONTRIBUTING.md` — setup

**Existing Linear issues in this project:**

- **SQR-31** Design Postgres schema for all persistent state
- **SQR-32** Set up Postgres + pgvector for development
- **SQR-33** Migrate vector store from flat file to pgvector
- **SQR-34** Migrate extracted card data from JSON to Postgres
- **SQR-35** Update atomic tools to use SQL queries
- **SQR-36** Data import and seed scripts

**Decided at the arch-doc level (do not relitigate in this review):**

- ORM: **Drizzle** + drizzle-kit migrations (ARCHITECTURE.md §Stack/Database)
- Vector store: **pgvector** in the same Postgres instance
- Deployment host: **deferred** to Production Readiness project
- Sessions: server-side in Postgres, HttpOnly + Secure + SameSite=Strict cookies
- Google OAuth for web login lives in User Accounts project, not this one
- `/mcp` pre-auth exposure is tracked in User Accounts / SECURITY.md §6
- Conversation history → Postgres is Phase 3+, not this project

---

## User preferences captured this session (memory)

- **Long-lived OAuth bearer tokens** (days to weeks) — optimizing MCP/API client DX.
  Do NOT propose 15-min access + refresh rotation.
  Saved to `~/.claude/projects/-Users-bcm-Projects-maz-squire/memory/feedback_long_lived_tokens.md`.
- **Always read `docs/` before any review in this repo.**
  Saved to `~/.claude/projects/-Users-bcm-Projects-maz-squire/memory/feedback_read_docs_before_review.md`.

---

## Decisions resolved

### Decision 1 — auth.ts rewrite home — RESOLVED

**Q:** `src/auth.ts` currently stores OAuth clients/codes/tokens in in-memory `Map`s
(vanish on process restart). Doesn't match SECURITY.md §2 (SDK handlers, encryption at
rest, audit log). Which project owns the rewrite?

**Decision:** **Storage & Data Migration (this project).** Add a new issue for it.

**Rationale:** This project's core job is moving ephemeral state into Postgres;
`auth.ts` IS that ephemeral state. Putting it in User Accounts risks SQR-31's
`oauth_clients`/`oauth_tokens` tables shipping as dead code.

### Decision 2 — Auth hardening scope — RESOLVED

**Q:** Which SECURITY.md §2 requirements ship as part of the auth.ts rewrite?

**Decision:**

- ✅ Switch to `@modelcontextprotocol/sdk` auth handlers (drop hand-rolled code)
- ✅ Hash tokens at rest (SHA-256, store hash as primary key, compare hash-to-hash)
- ✅ Audit log table (`oauth_audit_log`) + writes on every register/authorize/token/verify/revoke event
- ❌ **Long-lived tokens stay — no 15-min + refresh rotation.** DX preference: MCP/API
  clients would hate 15-min tokens. SECURITY.md §2 to be updated to reflect this.
- ❌ Auth code expiry (~60s) — **still needs to be fixed**, but folded into the rewrite
  regardless (it's a 5-line addition alongside the SDK handler swap)

**Doc updates required:** `docs/SECURITY.md` §2 — replace "15-min access tokens with
refresh token rotation" with "long-lived access tokens (TTL TBD, likely 30 days) chosen
for MCP/API client DX; revisit if threat model changes." Keep all other §2 mitigations.

### Decision 3 — Client registration rate limiting — RESOLVED

**Q:** SECURITY.md §2 wants "10/hour per IP" rate limit on `/register`. Where does it land?

**Decision:** **Defer to Production Readiness project (Apr 11–12).** Track with a new
issue in that project so it isn't forgotten. That project already owns Cloudflare WAF +
edge rate limiting + in-app rate limits on expensive endpoints; `/register` belongs with
them. Tiny window of exposure between Storage landing and Prod Readiness landing, on a
non-public dev environment.

### Decision 4 — `game` column in Phase 1 — RESOLVED

**Q:** Pull `game` column forward into SQR-31, or defer to Phase 2 per SPEC.md and
ARCHITECTURE.md?

**Decision:** **Pull forward.** Add `game text not null default 'frosthaven'` to every
card table and the `embeddings` table in SQR-31. Add `CREATE INDEX ON <table> (game)`
on each. Atomic tools ignore the column in Phase 1 (no filter parameter yet); Phase 2
turns the filter on.

**Doc updates required:**

- `docs/ARCHITECTURE.md` §Game Dimension — change "added in Phase 2" to "schema includes
  `game` column from Phase 1 (default 'frosthaven'); atomic tools start filtering in Phase 2."
- `docs/SPEC.md` §Phase 2 tasks — remove "Tag each card record with a `game` field" from
  Phase 2 (already done in Phase 1); keep the rest (rule chunks still get tagged via
  filename prefix; tools gain the filter; system prompt gains the selector).

### Decision 5 — campaigns/players in SQR-31 — RESOLVED

**Q:** SQR-31 lists `campaigns` and `players` tables with FKs. SPEC.md Phase 4 owns
campaign/character state. SECURITY.md §3 says data isolation design must come first.
Ship now or defer?

**Decision:** **Defer.** Drop `campaigns` and `players` from SQR-31. They land in the
Phase 4 project alongside the data isolation design they depend on.

**SQR-31 final table list (after decisions 1–5):**

- `users` (id, google_sub, email, name, created_at) — **empty** in Phase 1 (no login
  code yet); populated once User Accounts lands a day later
- `sessions` (id, user_id, expires_at, created_at, ...) — same
- `oauth_clients` (per MCP SDK handler requirements)
- `oauth_tokens` (hashed token as PK, client_id, user_id nullable for pre-user-accounts
  tokens, scope, expires_at, created_at)
- `oauth_authorization_codes` (code, client_id, user_id nullable, redirect_uri,
  code_challenge, expires_at)
- `oauth_audit_log` (id, event_type, client_id, user_id nullable, ip, user_agent,
  outcome, metadata jsonb, created_at)
- `embeddings` (id, source, chunk_index, text, embedding vector(384), game text not null
  default 'frosthaven')
- 10 card tables: `card_monster_stats`, `card_monster_abilities`,
  `card_character_abilities`, `card_character_mats`, `card_items`, `card_events`,
  `card_battle_goals`, `card_buildings`, `card_scenarios`, `card_personal_quests` —
  each with `game text not null default 'frosthaven'` and an index on `(game)`. Plus
  each one's natural ID field as a unique constraint scoped by `(game, <id_field>)`.

---

### Decision 6 — Hash authorization codes too — RESOLVED

**Q:** Hash `oauth_authorization_codes` at rest with SHA-256 the same way we're
hashing `oauth_tokens`?

**Decision:** **Yes.** Same pattern, ~5 lines in the Drizzle schema. Closes the brief
DB-read window between issuance and consumption.

### Decision 7 — `data/index.json` post-migration — RESOLVED

**Q:** Delete `data/index.json` (11MB) from git, keep as seed artifact, or keep as
canonical export?

**Decision:** **Delete from git after SQR-33 lands.** New-dev bootstrap becomes
`docker-compose up && npm run index && npm run seed:cards` (~2 min). Removes 11MB of
churn from every clone/pull.

**Doc updates required:**

- `docs/DEVELOPMENT.md` §Data management — remove "the vector index is committed as a
  regular file" language; update the `npm run index` section to describe the new flow.
- `docs/CONTRIBUTING.md` §Data files — same.
- `.github/workflows/refresh-data.yml` — remove the `data/index.json` refresh path; keep
  the extracted card data refresh path.

### Decision 8 — `data/extracted/*.json` post-migration — RESOLVED

**Q:** Keep committed as the import-pipeline output, or delete in favor of DB as source
of truth?

**Decision:** **Keep committed.** Flow: GHS upstream → weekly CI refresh → JSON files →
git commit → seed script loads into Postgres on deploy. The human-reviewable weekly PR
is the whole point of committing the JSON — it's how you audit what upstream GHS
changes before they hit your DB.

### Decision 9 — Data lifecycle architecture — RESOLVED

**Q (reformulated after discussion):** Where does the "data is independent of image"
architecture land?

**Decision:** **This project owns schema + local dev story + seed scripts + the
`embedding_version` guardrail column. GitHub Actions workflows for data lifecycle land
in the Deployment project.**

**What the architecture looks like:**

- Image is stateless. No embeddings, no card data baked in.
- Postgres is the source of runtime truth.
- `data/pdfs/*.pdf` stays in git as build input for the reindexer (164MB — acceptable;
  git-lfs if it grows).
- `data/extracted/*.json` stays in git as the human-auditable upstream-GHS change log
  (Decision 8).
- `data/index.json` is deleted (Decision 7).
- `embeddings` table gets an `embedding_version text not null` column. Value set at
  insert time from a constant in `index-docs.ts`. Server startup runs a sanity check:
  "does the DB's most recent `embedding_version` match the code's current value?" —
  log a loud warning if not. Prevents silent code-data drift.
- Seed scripts are idempotent upserts by natural key.
- Four data-change workflows (all in the Deployment project, new issues):
  1. **GHS refresh** — already exists (`.github/workflows/refresh-data.yml`), needs
     update to drop index.json handling.
  2. **Card re-seed** — new `seed-cards.yml`, triggers on merge to `main` with changes
     under `data/extracted/**`, runs `npm run seed:cards` against prod DB.
  3. **PDF re-index** — new `reindex-pdfs.yml`, triggers on merge to `main` with
     changes under `data/pdfs/**` or `src/index-docs.ts`, runs `npm run index` against
     prod DB. Diff-friendly (skips already-indexed sources). Adds a `rebuild: true`
     workflow_dispatch input for full rebuilds (after chunking logic changes).
  4. **Embedding model change** — handled as a drizzle migration (vector dimension
     change) + a post-migration data step. Pattern TBD in the Deployment project but
     flagged here.

**Diff vs rebuild decision tree:**

| Change | Diff-able? | Recovery |
| --- | --- | --- |
| New PDF added | Yes | `index-docs.ts` skip-by-source |
| Existing PDF changed | Partial | delete rows for that source + reindex |
| PDF removed | Yes | `DELETE FROM embeddings WHERE source = $1` |
| Chunking logic changed | No | full reindex (manual `rebuild: true`) |
| Embedding model changed | No | schema migration + full reindex |
| GHS card data updated | Yes | idempotent upsert by `(game, natural_id)` |
| Card schema changed | Yes | drizzle migration + upsert-all |

**Doc updates required:**

- `docs/ARCHITECTURE.md` — add a new "Data Lifecycle" section capturing the above.
  Should also update the storage strategy table to be explicit that embeddings and
  card data are DB-only at runtime but have on-disk import artifacts in git.
- `docs/DEVELOPMENT.md` — the new 2-minute local bootstrap (`docker-compose up && npm
  run index && npm run seed:cards`).
- `docs/RUNBOOK.md` (new, post-MVP) — "restore prod from scratch" procedure.

---

### Decision 10 — Test strategy — RESOLVED

**Q:** Full integration against a test DB, or thin unit layer + integration, or
hexagonal repo interface with in-memory + Postgres implementations?

**Decision:** **Full integration against a test DB for all tool tests.** `tools.test.ts`,
`extracted-data.test.ts`, `vector-store.test.ts`, `mcp-in-process.test.ts` all run
against a real Postgres via the CI services container (added in SQR-32). Each test
gets a transaction that rolls back, or truncates affected tables in `beforeEach`.
Matches CLAUDE.md. No mocking of drizzle. Slower suite (~5–10s vs ~2s today) is
acceptable.

---

## All 10 decisions resolved — moving to execution

---

## New issues I will create at the end

- **[NEW]** "Rewrite src/auth.ts to persist OAuth state in Postgres and align with
  SECURITY.md §2" — in this project (from Decision 1). Deliverables: SDK handlers,
  token/code hashing, audit log, auth code expiry fix.
- **[NEW, in Production Readiness project]** "Rate limit dynamic client registration
  (10/hour/IP)" — from Decision 3.

## Linear issue edits I will make

- **SQR-31** — drop campaigns/players (Decision 5); add `game` column on all card/embedding
  tables (Decision 4); add `oauth_audit_log` table (Decision 2); hash-as-PK on
  oauth_tokens/oauth_authorization_codes (Decisions 2 + 6 pending); explicit user_id
  columns; reference arch doc for Drizzle/pgvector instead of reopening the decision.
- **SQR-32** — add GitHub Actions Postgres+pgvector service container as a deliverable;
  reference Drizzle decision in arch doc; add `src/db.ts` pool factory with CLI vs
  server modes; pin pgvector version.
- **SQR-33** — pgvector distance→similarity sign conversion; `(source, chunk_index)`
  uniqueness for idempotent reindex; regression test vs. flat file for top-k parity;
  replace "fallback" language with "transitional, deleted in the next PR"; preserve the
  `game` column on embeddings via filename-prefix inference.
- **SQR-34** — load(type) + searchExtracted parity regression tests as critical; consider
  Postgres `tsvector` + `ts_rank` to replace the keyword scorer; keep import scripts
  writing JSON (seed scripts bridge to Postgres); replace "fallback" language.
- **SQR-35** — async ripple list (mcp.ts, agent.ts, service.ts + tests); replace
  "fallback" language; reference new auth.ts-rewrite issue as a sibling, not a dependency.
- **SQR-36** — idempotency test; clarify npm run index runs locally then seeds via script;
  update `.github/workflows/refresh-data.yml` to target the new import pipeline;
  clarify which tables get seeded (not users/campaigns/players).

## Tech spec I will write at project level

Per Brian's request: a detailed tech spec at the Linear project level that the agents
implementing each issue can read alongside the repo docs. Will include the schema in
full Drizzle DSL, execution order across issues, integration test fixture plan, and the
parallelization lanes across the 7 issues (6 existing + 1 new auth.ts rewrite).

## Doc updates queued

- `docs/SECURITY.md` §2 — replace short-lived-token mitigation with long-lived-for-DX
  rationale; keep all other mitigations
- `docs/ARCHITECTURE.md` §Game Dimension — note `game` column ships in Phase 1
- `docs/SPEC.md` §Phase 2 — remove "tag each card record with a `game` field" from Phase 2
- (Possibly) `docs/ARCHITECTURE.md` storage strategy table — split user/session/oauth
  (Phase 1) from campaigns/players/character (Phase 4)
