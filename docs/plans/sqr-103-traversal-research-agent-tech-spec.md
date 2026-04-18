# SQR-103 Traversal-First Research Agent — Tech Spec

**Issue:** `SQR-103`
**Produced by:** `/office-hours` on 2026-04-18
**Expanded by:** `/plan-eng-review` on 2026-04-18
**Status:** approved after eng review
**Companion docs (read first):** `docs/ARCHITECTURE.md`, `docs/SPEC.md`, `docs/DEVELOPMENT.md`
**Companion checkpoint:** `docs/plans/sqr-103-traversal-research-agent-review-checkpoint.md`
**Source design artifact:** `/Users/bcm/.gstack/projects/maz-org-squire/bcm-bcmsqr-103-make-scenario-section-books-first-class-in-retrieval-design-20260418-122922.md`

---

## Goal

Make Squire reliably answer chained Frosthaven scenario and section questions by
using deterministic traversal over explicit references instead of relying on
semantic search to invent the chain.

The motivating failure is:

- User question: `show the full text of the section to read at the conclusion of scenario 61`
- Current answer: `I was unable to produce an answer within the allowed number of steps.`

The user then had to manually trace multiple PDFs, follow section references,
read intermediate text, infer the next hop, and repeat until the target section
was found. That manual research loop is the product failure this issue fixes.

---

## User jobs

There are two related jobs:

1. **Common case**
   Start from a scenario, identify the relevant success or conclusion section,
   and return the exact text to read.
2. **General case**
   Find a section, read it, infer the next explicit section or scenario
   reference, follow it, and repeat until the answer is grounded.

The second case is the real frame. The first is just the most obvious symptom.

---

## Non-goals

- Building a general-purpose GraphRAG platform
- Replacing semantic search entirely
- Encoding a huge relationship ontology
- Shipping Gloomhaven 2.0 support in this issue
- Solving every cross-document reasoning problem in one pass

This issue should solve Frosthaven scenario/section traversal cleanly and leave
a clean seam for future games.

---

## Existing building blocks

The repo already has useful primitives:

- `data/extracted/scenarios.json`
  canonical scenario metadata with `sourceId`, `index`, `name`,
  `scenarioGroup`, and `flowChartGroup`
- `src/extracted-data.ts`
  DB-backed exact lookup by canonical `sourceId`
- `src/tools.ts`
  existing search and exact card lookup tools
- `src/agent.ts`
  tool-using research loop with iteration cap
- `src/index-docs.ts`
  local PDF parsing and indexing pipeline
- vector-backed retrieval in Postgres
  useful for fuzzy support, weak for explicit multi-hop chains

The missing capability is explicit, deterministic traversal over scenario and
section references.

---

## Approved outcome summary

The approved plan is:

- traversal-first research path
- dedicated traversal importer
- hybrid source precedence:
  GHS for canonical scenario identity and structured metadata, PDFs for
  canonical section text and printed section links
- generated combined traversal extract as source material
- Postgres-backed runtime from day one
- dedicated traversal schema:
  scenarios, sections, links
- canonical endpoint refs plus endpoint kinds in links
- small controlled link vocabulary plus raw source context
- concrete initial traversal tools:
  `find_scenario`, `get_scenario`, `get_section`, `follow_links`
- model-led routing:
  no app-side heuristic router
- tiered mismatch policy during import
- full-path test floor
- one branch, delivered in clear slices

---

## Architectural decision

Use a **multi-tool research agent** with a **small explicit traversal layer**.

That means:

- exact scenario resolution
- exact section fetch
- deterministic explicit-link traversal
- semantic search as fallback support, not primary planner

Do **not** ask the model to invent the chain when the books already contain
explicit references.

Also do **not** drift into GraphRAG theater. This design is intentionally
boring and specific.

---

## Source pipeline

### Dedicated traversal importer

Build a dedicated importer for traversal data instead of:

- bloating `src/import-scenarios.ts`
- hiding traversal generation in `src/index-docs.ts`

The importer should join multiple sources on purpose and emit a single combined
traversal extract under `data/extracted/` for seeding and inspection.

### Source precedence

The importer uses a hybrid source model with explicit precedence:

- **GHS owns**
  - canonical scenario identity
  - scenario numbering and grouping
  - structured scenario metadata where trustworthy
- **Printed PDFs own**
  - canonical section text
  - printed section-level links
  - printed scenario/section prose context

When those sources disagree:

- stop the import if the disagreement would make traversal wrong
- warn and continue for softer discrepancies that do not break navigation

Examples:

- **hard fail**
  a scenario points to the wrong next section, a target section is missing, or
  a canonical reference cannot be resolved
- **warn**
  minor text/context differences that do not affect the actual next hop

---

## Runtime storage

Runtime should be Postgres-backed immediately.

The generated traversal extract is still the source material for seeding and
inspection, but production reads should come from dedicated traversal tables,
not direct flat-file reads.

This keeps the traversal path aligned with the repo's broader DB-backed
direction and avoids maintaining a second read path in production.

---

## Schema shape

Use three dedicated traversal tables:

1. **Traversal scenarios**
   canonical scenario records for traversal-focused lookup
2. **Traversal sections**
   canonical section records including full exact section text
3. **Traversal links**
   normalized edges between scenarios and sections

Use `jsonb` only for nested metadata that is not itself the navigation
primitive.

### Link endpoint model

Links should identify endpoints by canonical refs plus endpoint kinds, not by:

- polymorphic nullable foreign-key gymnastics
- a proliferation of per-relation tables

Example shape:

- `from_kind`
- `from_ref`
- `to_kind`
- `to_ref`
- `link_type`
- optional raw label/context

This keeps seeding, debugging, and test fixtures simple.

### Link semantics

Use a **small controlled vocabulary** for `link_type`, plus optional raw source
context.

Examples of the intended scale:

- `conclusion`
- `section_link`
- `unlock`
- `read_now`
- `cross_reference`

This is intentionally a small practical vocabulary, not a broad ontology.

---

## Tool surface

The approved initial traversal tool set is:

- `find_scenario`
- `get_scenario`
- `get_section`
- `follow_links`

### Tool responsibilities

- `find_scenario(query, game?)`
  resolve ambiguous human input like `scenario 61`
- `get_scenario(ref, game?)`
  fetch a specific exact scenario record once the canonical ref is known
- `get_section(ref, game?)`
  fetch the exact section body and metadata for a known section ref
- `follow_links(from_kind, from_ref, game?, link_type?)`
  retrieve explicit outbound links from a known scenario or section

### Tool generality boundary

Do **not** add a universal `find_reference` tool in v1.

Instead:

- keep the first tools concrete and obvious
- make the underlying ref model and `follow_links` behavior generic enough that
  a broader finder can be added later without a rewrite

This keeps the initial API understandable without overfitting it to scenario 61
or prematurely abstracting it into mush.

---

## Agent behavior and routing

Routing should remain **model-led**.

Do **not** add:

- an app-side query-shape router
- prompt-level heuristics that try to outsmart the model

Instead:

- rewrite the system prompt and tool descriptions so the traversal tools are the
  obvious choice for exact scenario/section lookups
- keep `search_rules` and `search_cards` available for fuzzy or open-ended
  discovery

The fix should come from better tool affordances and a clearer prompt, not from
hidden routing logic outside the model.

---

## Data flow

```text
User question
    |
    v
Research agent
    |
    +--> find_scenario (if needed)
    |      |
    |      +--> canonical scenario ref
    |
    +--> get_scenario / get_section
    |
    +--> follow_links
    |      |
    |      +--> next explicit scenario/section refs
    |
    +--> repeat as needed
    |
    +--> fallback search_rules / search_cards only when the path is fuzzy
    |
    v
Grounded answer + evidence chain
```

---

## Test floor

The minimum acceptable coverage is:

1. **Importer tests**
   - canonical scenario resolution artifacts are generated correctly
   - section records contain exact text
   - explicit links are extracted correctly
   - mismatch policy behaves correctly

2. **DB seed/load tests**
   - traversal extract seeds into the new tables correctly
   - canonical refs are queryable after seed

3. **Tool tests**
   - `find_scenario` resolves exact and ambiguous inputs correctly
   - `get_scenario` and `get_section` return exact records
   - `follow_links` returns the expected typed edges

4. **Agent-level behavior**
   - at least one test proves the agent uses the new traversal path for a
     scenario/section lookup instead of wandering into search first

This is not just a data-pipeline change. The end-to-end research path must be
proven.

---

## Delivery slices

Implement on one branch, but in clear internal slices:

1. traversal schema + seed/load
2. dedicated traversal importer
3. traversal tools + MCP exposure
4. agent prompt/tool updates
5. tests + docs + learnings

This keeps the branch reviewable without turning the work into unnecessary
multi-PR bureaucracy.

---

## Success criteria

- `show the full text of the section to read at the conclusion of scenario 61`
  returns the correct section text
- the agent resolves the scenario correctly instead of burning turns on fuzzy
  search
- the answer is grounded in explicit traversal, not a lucky retrieval guess
- chained section-following works for at least one non-trivial multi-hop test
- the question does not hit `MAX_AGENT_ITERATIONS`
- the data model and tool surface leave a clean seam for future games and
  broader entity discovery

---

## Rejected alternatives and guardrails

Explicitly rejected:

- full GraphRAG platform work
- giant relationship taxonomy
- one orchestration-heavy meta tool
- app-side heuristic routing
- search-first routing for exact scenario/section questions
- denormalized blob storage for traversal
- polymorphic nullable-FK gymnastics for links
- multi-PR theater for this issue

Guardrails:

- keep traversal semantics small and practical
- keep the model in charge of tool choice
- keep the runtime path deterministic for exact scenario/section queries
- keep future extensibility in the ref model, not in vague first-pass tools

---

## Remaining non-blocking details

No blocking architecture questions remain from eng review.

Implementation can still choose final names for:

- the generated traversal extract file
- the exact Postgres table names
- the exact link vocabulary labels

Those are execution details, not unresolved architecture.
