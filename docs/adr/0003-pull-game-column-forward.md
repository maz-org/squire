---
type: ADR
id: "0003"
title: "Ship the game column in Phase 1, filter in Phase 2"
status: active
date: 2026-04-07
---

## Context

Squire is Phase-1 scoped to Frosthaven rules Q&A, but `docs/SPEC.md` Phase 2
adds a second game (Gloomhaven 2). `docs/ARCHITECTURE.md` §Game Dimension
originally planned to add a `game` column and filter logic together in
Phase 2.

During the storage migration plan review (2026-04-07) the question came up:
add `game text not null default 'frosthaven'` now, in the Phase-1 schema, or
defer the column entirely? Adding it later means a migration that backfills
every `card_*` and `embeddings` row; adding it now is free and commits us to
the shape.

## Decision

**The `game` column ships in Phase 1 on every `card_*` table and on
`embeddings`, defaulting to `'frosthaven'`, with an index on `(game)`.** Phase-1
atomic tools ignore the column. Phase 2 turns on the per-tool `game` filter
and the per-session game selector without touching schema.

## Options considered

- **Option A** (chosen): Ship column now, default `'frosthaven'`, no filter in
  tools yet. Cheap schema change today, zero migration pain at the Phase-1/2
  boundary, and the column shape is locked in before card data is seeded.
- **Option B**: Defer to Phase 2 per the original ARCHITECTURE.md plan. Forces
  a large backfill migration later (every row in every card table and the
  embeddings table) and re-opens the schema shape discussion at exactly the
  wrong time — when Phase 2 is trying to ship features, not schema.
- **Option C**: Ship the column AND turn on filtering in Phase 1 tools. Extra
  work for no benefit — there's only one game's data to filter.

## Consequences

- **Easier:** Phase 2 becomes purely additive (wire the filter, add the
  selector); no data migration; card tables get a uniform shape early;
  `(game, source_id)` uniqueness (ADR-0006) has its `game` half in place.
- **Harder:** nothing material. A default-valued column costs one line per
  table.
- **Re-evaluate if:** Phase 2 discovers a reason the column should live
  somewhere else (e.g., separate schema per game), which would be a new
  decision superseding this one.

## Advice

Decided during `plan-eng-review` on 2026-04-07 (Decision 4 in
`docs/plans/storage-migration-review-checkpoint.md`). `docs/ARCHITECTURE.md`
§Game Dimension and `docs/SPEC.md` §Phase 2 were updated to match.
