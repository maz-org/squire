---
type: ADR
id: "0004"
title: "Data is independent of the image"
status: active
date: 2026-04-07
---

## Context

Pre-migration Squire baked its runtime data into the repo: the Xenova rulebook
embeddings were committed as `data/index.json` (~11MB of churn on every
reindex), card data was flat `data/extracted/*.json` files loaded into a
process-level `Map`, and OAuth state lived in in-memory `Map`s in `src/auth.ts`.
Every data change meant rebuilding and redeploying the image.

This couples three things that should be independent:

1. **Code changes** (a feature, a bug fix)
2. **Data changes** (new PDF, GHS upstream update, chunking logic change,
   embedding model change)
3. **Image builds** (redeploy)

A reindex shouldn't require a redeploy. An upstream GHS data update shouldn't
require a redeploy. And an image should be able to boot against an existing
database without carrying its own copy of the data.

## Decision

**Postgres is the source of runtime truth. The image is stateless.** Data-change
events are handled by dedicated, repeatable workflows that read from committed
sources and write to the DB, not by rebuilding the image. Three supporting
mechanisms make this safe:

1. **`embeddings.embedding_version` drift guard.** The `embeddings` table carries
   an `embedding_version text not null` column set from an `EMBEDDING_VERSION`
   constant in `src/index-docs.ts`. On startup, `src/service.ts` asserts the DB's
   active versions include the current code version; mismatch logs a loud
   warning. Prevents silent code-data drift after a chunking change that wasn't
   paired with a reindex.
2. **Idempotent upserts keyed on natural keys.** Seed and reindex scripts use
   `ON CONFLICT (game, source_id) DO UPDATE` (cards) or `(source, chunk_index)`
   (embeddings) so re-running them converges to a known state.
3. **No on-disk runtime fallback.** If the DB is unreachable, `load()` and
   `searchExtracted()` throw a clear error. No transparent file fallback that
   could mask a disconnected deployment.

Committed source artifacts stay in git as **inputs** to the data workflows, not
as runtime storage: `data/pdfs/*.pdf` as reindex input, `data/extracted/*.json`
as the human-reviewable upstream-GHS change log (see ADR-0005). `data/index.json`
is removed (ADR-0005).

## Options considered

- **Option A** (chosen): Postgres as runtime truth; git as source inputs;
  image stateless; drift guard on embeddings; no fallback. Decouples the three
  axes above; enables diff-vs-rebuild (see table in
  `storage-migration-tech-spec.md`).
- **Option B**: Keep data files committed and loaded at startup (status quo
  plus auth persistence). Rejected: doesn't solve the core coupling, keeps
  11MB of churn, and auth state still needs Postgres anyway.
- **Option C**: Runtime truth in Postgres but keep a transparent file fallback
  for outages. Rejected: silent fallback would mask exactly the operational
  bugs we want to detect (disconnected DB, missing migration, wrong env).

## Consequences

- **Easier:** reindex without redeploy; GHS data refresh without redeploy;
  moving hosting providers; scaling horizontally (image has no state);
  restoring from scratch (docker-compose up + seed scripts).
- **Harder:** local dev bootstrap is now a two-step (`docker-compose up &&
  npm run index && npm run seed:cards`) instead of an implicit file load.
  Mitigated by the target: under 3 minutes on a clean clone.
- **Re-evaluate if:** a use case appears where a transparent file fallback is
  genuinely safer than a loud failure; or if operational data workflows become
  painful enough that coupling data to the image becomes attractive again.

## Advice

Decided during `plan-eng-review` on 2026-04-07 (Decision 9 in
`docs/plans/storage-migration-review-checkpoint.md`). The `embedding_version`
drift guard was added in the same review as a response to the "what if a
chunking change ships without a reindex" failure mode. `docs/ARCHITECTURE.md`
gained a "Data Lifecycle" section capturing the diff-vs-rebuild table.
