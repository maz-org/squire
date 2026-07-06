---
type: ADR
id: '0027'
title: 'knowledge_edges: one typed edge substrate for the whole knowledge space'
status: active
date: 2026-07-06
---

## Context

The knowledge tool contract (`inspect_sources` / `resolve` / `open` /
`search` / `neighbors`) presents one traversable knowledge space, but the
data honors it in only one corner: `book_references` holds typed edges for
scenario/section books, and `neighbors()` returns nothing for cards, rules
chunks, or game concepts. Cross-surface questions therefore pay serial
model round-trips — the epoch-2 baseline measured the resulting multi-hop
tail at up to 32s P95, and six multi-hop dev rows still fail after the
Phase 1 lane split.

The canonical ref scheme (`rules:<game>/<source>#chunk=N`,
`scenario:<game>/<id>`, `section:<game>/<id>`, `card:<game>/<type>/<id>`)
is already a working node-ID system spanning every content type.

## Decision

**Add a single `knowledge_edges` Postgres table — typed, directed edges
between canonical refs, with per-edge provenance — as the one substrate
`neighbors()` reads for every entity kind. `book_references` remains the
source of record for printed-book links and is mirrored into
`knowledge_edges` by the seed step; new edge families (concept, supersedes,
cross-surface) write to `knowledge_edges` directly via deterministic ingest
jobs with quality reports.**

Shape: `(game, from_kind, from_ref, edge_type, to_kind, to_ref, provenance,
metadata jsonb)`, unique on `(game, from_ref, edge_type, to_ref)`, indexed
for forward and reverse traversal. A `concept:<game>/<slug>` ref kind joins
the existing URI scheme for game-term nodes (SQR-402).

## Options considered

- **One generic edges table, book_references mirrored in (chosen):**
  `neighbors()` reads one substrate; printed-book extraction pipeline stays
  untouched; new edge families are additive ingest jobs. Cons: one-way
  mirror to keep consistent (enforced by seeding both in the same step and
  a parity test).
- **Extend book_references for all edge kinds (rejected):** overloads a
  printed-book-shaped table (raw_label/raw_context/sequence are meaningless
  for concept or supersedes edges) and couples every new edge family to the
  book import pipeline.
- **Per-family edge tables (rejected):** `neighbors()` becomes an N-way
  UNION that grows with every family; traversal indexes and dedup rules
  diverge.
- **Graph database (rejected):** the corpus is ~1,600 chunks and ~3,500
  records with point and local-multi-hop queries; Postgres already holds a
  working graph, and a second datastore is operational cost with no query
  we cannot express.

## Consequences

- `neighbors()` works on every entity kind, closing the gap between the
  tool contract and the data. Multi-hop questions can resolve in one or two
  traversal calls instead of search round-trips.
- Retrieval results can attach context bundles (the local subgraph) —
  SQR-403/404 build on this.
- The mirror adds a consistency obligation: seeding runs the mirror and a
  parity test guards drift between book_references and its mirrored edges.
- Edge quality is only as good as the ingest jobs; every family ships with
  a deterministic quality report (counts, unmatched entries) so gaps are
  visible rather than silent.
- Re-evaluate if edge volume or traversal patterns outgrow Postgres
  (unlikely at this corpus size) or if a future edge family needs weights
  or embeddings on edges.

## Advice

Brian approved the Phase 2 knowledge-graph substrate direction at the
Table Turnaround II Phase 1 checkpoint (2026-07-06). The epoch-2 baseline
and Phase 1 dev runs supplied the multi-hop evidence.
