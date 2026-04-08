---
type: ADR
id: "0006"
title: "Unify card tables on (game, source_id) as the natural key"
status: active
date: 2026-04-07
---

## Context

The original SQR-31 schema gave each of the 10 card types its own per-type
natural key — `(game, event_type, number)` for events, `(game, monster_type,
card_name)` for monster abilities, and so on. Implementors were asked to
"double-check the per-type natural keys against `src/schemas.ts` and
`data/extracted/*.json` before building."

Doing that during SQR-31 turned up four collisions and three latent data-quality
bugs:

| Card type | Original key | Collisions | Root cause |
| --- | --- | --- | --- |
| `events` | `(game, event_type, number)` | 114 | Outpost summer/winter share numbering |
| `monster-abilities` | `(game, monster_type, card_name)` | 32 | Boss deck is a template; no per-scenario namespace field |
| `buildings` | `(game, building_number, level)` | 4 | Walls have no building number |
| `scenarios` | `(game, index)` | 17 | Solo scenarios share `index` values with main campaign |

Each collision could be patched with a per-type fix (add a `season` field, add
a `scenarioGroup` namespace, etc.), but that meant designing four different
fixes and still leaving future card types in Phase 2 guessing about their own
natural keys.

Every imported record already carries a `_source` field — the GHS source
identifier, e.g. `gloomhavensecretariat:battle-goal/1301`. It's derived from
the upstream filename, stable across reimports, and globally unique within a
game.

## Decision

**Every card table uses `(game, source_id)` as its uniqueness constraint.**
`source_id` is promoted from an import-only `_source` metadata field to a
real `sourceId` field in each Zod schema in `src/schemas.ts`. Per-type
natural-key fields (`name`, `level_range`, `number`, `card_id`, etc.) remain
as regular indexed columns for query/filter/`getCard` lookups but are **not**
unique. `getCard(type, id)` resolves `id` against `source_id`, not against
the per-type natural key — the `ID_FIELDS` map that previously held per-type
key names is removed.

## Options considered

- **Option A** (chosen): Unify on `(game, source_id)`. One rule, zero
  per-type guessing, zero collisions. New Phase-2 card types get a clean
  convention to follow.
- **Option B**: Patch each per-type key individually. Four separate domain
  model decisions (how to namespace Boss deck cards, how to handle walls with
  no building number, how to distinguish solo from main scenarios). Future
  card types face the same question each time.
- **Option C**: Synthetic UUID primary key with no uniqueness constraint.
  Rejected: loses idempotent upsert semantics; reseeding a table would create
  duplicates rather than updating existing rows.

## Consequences

- **Easier:** idempotent upserts key uniformly on `(game, source_id)`;
  seed scripts have one conflict target; `getCard` has one lookup rule;
  Phase-2 card types get a known convention; template-instantiated cards
  (Boss deck) work without inventing namespace fields.
- **Harder:** `source_id` strings are less human-readable than, say, a
  battle goal name. Mitigated because they show up in URLs and tool
  responses, not in UI text. Three data-quality bugs surfaced by this
  decision were fixed in the same PR rather than deferred (Exploding
  Ammunition duplicate, walls with no building number, scenario index
  cross-namespace overlap).
- **Re-evaluate if:** a card type appears whose upstream source doesn't
  produce stable, globally-unique identifiers, or if `source_id` churn
  across reimports starts breaking idempotent upserts.

## Advice

Decided during SQR-31 implementation on 2026-04-07. The collision
discovery came from following the "verify natural keys against real data"
instruction rather than trusting the schema on paper. Full details and
collision counts are in the "Natural key verification" section of
`docs/plans/storage-migration-tech-spec.md`.
