# SQR-103 Traversal-First Research Agent — Eng Review Checkpoint

**Session:** `plan-eng-review` preparation for Linear issue `SQR-103`
**Started:** 2026-04-18
**Branch:** `bcm/sqr-103-make-scenario-section-books-first-class-in-retrieval`
**Reviewer:** Codex using the gstack `plan-eng-review` workflow
**Status:** Eng review complete, synthesized into tech spec

This file is the durable review record for SQR-103.

If a later session picks this up, read:

- `docs/agent/planning-artifacts.md`
- `docs/plans/sqr-103-traversal-research-agent-tech-spec.md`
- this file

Then continue from **Next checkpoint** below.

---

## Durability protocol

This review is being hardened against context compaction on purpose.

From this point on, after **every eng-review answer**, update this file with:

1. the question/decision just resolved
2. the chosen direction
3. any new risks or open questions
4. the next checkpoint the following session should resume from

Do not rely on chat history alone.

---

## Approved design summary

The approved design direction is:

- traversal-first research agent
- sparse explicit reference artifact, not a full graph platform
- deterministic traversal tools for scenarios and sections
- semantic search as fallback, not primary planner
- game-scoped shape so Gloomhaven 2.0 can be added later

The motivating failure is the scenario 61 conclusion question, which currently
times out and forces manual PDF chain-following.

---

## Facts already established

### 1. Existing exact lookup primitives already exist

The repo already has:

- DB-backed extracted loading in `src/extracted-data.ts`
- exact scenario/card lookup via `listCards()` and `getCard()` in `src/tools.ts`
- canonical scenario IDs such as `gloomhavensecretariat:scenario/061`

### 2. The current gap is structured traversal

`src/import-scenarios.ts` imports useful scenario metadata but does not expose
section-link chains. There is no deterministic way today to go from:

- scenario -> conclusion section
- section -> next section

### 3. Current agent behavior is too fuzzy

`src/agent.ts` has a good tool loop but currently relies too heavily on freeform
search and model inference for multi-hop traversal.

### 4. Scope should stay boring

The design should not become a general GraphRAG system. The right-sized version
is a sidecar reference artifact plus traversal tools.

---

## Pre-review concerns

These are the main risks to challenge during eng review:

1. Overbuilding a new storage/model layer when a generated artifact is enough
2. Underbuilding by leaving too much chain-following inside the model
3. Failing to define clean test coverage for chained traversal
4. Forgetting the Gloomhaven 2.0 extension seam while optimizing for Frosthaven

---

## Answer log

### 2026-04-18 12:00 ET — Setup checkpoint

- Approved repo-side source of truth:
  - tech spec in `docs/plans/sqr-103-traversal-research-agent-tech-spec.md`
  - this review checkpoint file
- Decision:
  commit the approved design into the repo before resuming eng review
- Known unrelated worktree changes left unstaged:
  - `src/agent.ts`
  - `test/agent.test.ts`
    These were not included in the docs commit.

### 2026-04-18 12:34 ET — Docs commit landed

- Commit:
  `e63a6b1` `docs(plans): checkpoint sqr-103 traversal design`
- Result:
  approved design is now durable inside the repo, not just in `~/.gstack/`
- Worktree state after commit:
  only `src/agent.ts` and `test/agent.test.ts` remain modified, and they are
  still intentionally excluded from the docs checkpoint commit
- Resume rule:
  after each future eng-review answer, append another entry here before moving
  on

### 2026-04-18 12:36 ET — User resumed eng review

- User direction:
  continue from Step 0 after the docs checkpoint commit
- Active unresolved decision:
  whether to reduce the approved design to a generated sidecar reference
  artifact plus deterministic traversal tools, or keep a broader graph-shaped
  implementation frame

### 2026-04-18 12:42 ET — Step 0 scope reduction accepted

- User choice:
  reduce scope to a generated sidecar reference artifact plus deterministic
  traversal tools
- Scope is now locked:
  do not re-argue for broader graph infrastructure during later sections unless
  a new blocker appears
- Practical consequence:
  architecture review should assume:
  - explicit reference artifact
  - deterministic traversal helpers
  - semantic search only as fallback
- Next live architecture question:
  where the reference artifact should live and how it should be generated so
  traversal stays deterministic, testable, and consistent with existing repo
  patterns

### 2026-04-18 12:49 ET — Architecture Issue 1 accepted

- User choice:
  generate the reference layer as a checked-in artifact under
  `data/extracted/`
- Chosen direction:
  keep reference extraction in the import pipeline and load it through
  deterministic server/tool code, instead of hiding it in runtime indexing or
  DB bootstrap
- Why this matters:
  it matches the repo's existing extracted-data pattern, keeps the traversal
  layer inspectable, and avoids coupling this fix to pgvector/index setup
- New open question:
  what the artifact shape should be:
  - narrow shortcuts only
  - purpose-built scenario/section records with typed links
  - a more generic node/edge graph shape

### 2026-04-18 12:55 ET — Architecture Issue 2 accepted

- User choice:
  use a purpose-built domain artifact with scenario records, section records,
  and typed links
- Chosen direction:
  prefer domain-shaped traversal data over shortcut maps or a generic
  node/edge graph
- Why this matters:
  it matches the actual user job of repeated section chasing, keeps tools
  explicit, and still avoids building abstract graph infrastructure
- New open question:
  whether canonical section text should live inside the new artifact too, or
  whether the artifact should only carry links and rely on the vector store to
  retrieve exact prose later

### 2026-04-18 13:02 ET — Architecture Issue 3 accepted

- User choice:
  put canonical full section text directly into generated section records
- Chosen direction:
  section text becomes deterministic extracted data, not something recovered
  later from similarity search
- Why this matters:
  the user job is exact section retrieval; delegating the final text hop to the
  vector store would preserve the main failure mode under a fancier wrapper
- New open question:
  how to lay out the new traversal data:
  - extend existing `scenarios.json`
  - add separate `sections.json`
  - or introduce a dedicated combined traversal artifact that keeps the new
    research layer separate from the existing card/scenario data contract

### 2026-04-18 13:07 ET — Architecture Issue 4 clarified before decision

- Clarification captured:
  the review was talking about generated extracted artifacts as the source of
  truth, not ruling out Postgres-backed runtime serving
- Restated framing:
  the real Issue 4 decision is layout and contract shape for the new traversal
  layer; runtime storage can still become Postgres-backed later if that proves
  useful
- Decision status:
  still unresolved

### 2026-04-18 13:14 ET — Architecture Issue 4 accepted

- User choice:
  keep the new traversal layer as one dedicated combined contract with both
  scenario and section records together
- Chosen direction:
  do not mutate the existing scenario/card contract into a second job; give the
  research layer its own loader/tools boundary
- Why this matters:
  it isolates the new traversal concerns, preserves compatibility for existing
  scenario consumers, and still leaves runtime Postgres serving available later
- New open question:
  which import path should own generation of the traversal artifact:
  - extend `import-scenarios.ts`
  - build a dedicated traversal importer that joins multiple sources
  - or piggyback on the PDF indexing pipeline

### 2026-04-18 13:20 ET — Architecture Issue 5 accepted

- User choice:
  build a dedicated traversal importer that joins the needed sources and emits
  the traversal contract
- Chosen direction:
  keep traversal generation separate from both `import-scenarios.ts` and the
  PDF embedding/indexing pipeline
- Why this matters:
  it preserves the repo's focused import-script pattern and gives the research
  layer one clean place to merge scenario metadata, section bodies, and typed
  links
- New open question:
  what source hierarchy the traversal importer should use when constructing the
  contract:
  - PDFs only
  - GHS only where available
  - or a hybrid with explicit precedence rules

### 2026-04-18 13:28 ET — Architecture Issue 6 accepted

- User choice:
  use a hybrid source hierarchy with explicit precedence rules
- Chosen direction:
  let GHS own canonical scenario identity and structured scenario metadata,
  while the printed PDFs own canonical section text and printed section-level
  links; surface mismatches during generation instead of hiding them
- Why this matters:
  the traversal importer needs both stable identity and exact printed prose,
  and those come from different places
- New open question:
  how the runtime should serve the new traversal layer:
  - direct in-process reads from the generated artifact
  - seeded Postgres tables
  - or a staged hybrid with one as source-of-truth and the other as optional
    runtime materialization

### 2026-04-18 13:34 ET — Architecture Issue 7 accepted

- User choice:
  serve the traversal layer from dedicated Postgres tables now
- Chosen direction:
  stop treating Postgres as a hypothetical future optimization; design the
  traversal runtime around seeded DB tables from the start
- Why this matters:
  it keeps the new research path consistent with the repo's existing
  DB-backed extracted-data direction and avoids a second storage model for
  production reads
- New open question:
  what table shape should back the traversal layer:
  - one denormalized blob table
  - scenario/section records plus a normalized links table
  - or some mixed jsonb-heavy compromise

### 2026-04-18 13:40 ET — Architecture Issue 8 accepted

- User choice:
  model traversal as dedicated scenario and section tables plus a normalized
  links table
- Chosen direction:
  keep traversal relational; use `jsonb` only for nested metadata that is not
  itself the navigation primitive
- Why this matters:
  the runtime jobs are exact lookup and exact link-following, which fit real
  tables better than blobs
- New open question:
  how links should identify their endpoints:
  - canonical text refs plus entity kind
  - internal row IDs with polymorphic nullable FKs
  - or multiple per-relationship link tables

### 2026-04-18 13:46 ET — Architecture Issue 9 accepted

- User choice:
  identify link endpoints by canonical refs plus endpoint kinds
- Chosen direction:
  make the links table deterministic and easy to seed/debug without
  polymorphic-FK gymnastics
- Why this matters:
  the traversal importer already has canonical scenario IDs and section refs,
  and those are the same handles humans will inspect when something goes wrong
- New open question:
  how rich the link typing should be:
  - one generic link type
  - a small controlled vocabulary plus optional raw label/context
  - or a large exhaustive taxonomy that mirrors every printed heading and
    scenario edge case

### 2026-04-18 13:51 ET — Architecture Issue 10 accepted

- User choice:
  use a small controlled link vocabulary plus optional raw label/context
- Chosen direction:
  keep just enough semantics to distinguish meaningful traversal edges without
  inventing a broad ontology
- Scope guardrail reaffirmed:
  do not drift into GraphRAG-style taxonomy work; link typing stays pragmatic
  and small
- Why this matters:
  the agent needs to tell obvious edge classes apart, but the product does not
  need a dissertation on relationship semantics
- New open question:
  what the initial tool surface should be over the new traversal tables:
  - many tiny primitives
  - a few opinionated research tools
  - or one orchestration-heavy meta tool

### 2026-04-18 13:57 ET — Architecture Issue 11 accepted

- User choice:
  expose a few opinionated traversal tools rather than many tiny primitives or
  one orchestration-heavy meta tool
- Chosen direction:
  keep the agent on rails with a small, purpose-built tool set that still
  leaves reasoning in the agent rather than hiding it in a single mega-tool
- Why this matters:
  the existing tool surface is already quite atomic; the new traversal layer
  should reduce turn burn, not create another pile of micro-calls
- New open question:
  what the initial traversal tool set should be:
  - scenario resolution plus direct section fetch plus guided link following
  - scenario-only convenience with generic section tools
  - or a fatter combined context tool

### 2026-04-18 14:03 ET — Architecture Issue 12 accepted

- User choice:
  start with an explicit 4-tool traversal set:
  - `find_scenario`
  - `get_scenario`
  - `get_section`
  - `follow_links`
- Chosen direction:
  keep the initial tools concrete and understandable while preserving enough
  structure for broader future research queries
- Scope guardrail reaffirmed:
  do not overfit the tools to the scenario-61 conclusion workflow, but also do
  not prematurely generalize into a single universal reference-discovery API
- Why this matters:
  the agent needs exact resolution and exact fetch primitives first; future
  adaptability should come from the data model and the generic `follow_links`
  behavior more than from vague tool names
- New open question:
  how generic the tool surface should be from day one:
  - keep entity-specific resolver/getters for current entities
  - add a generic reference/entity finder immediately
  - or ship the concrete tools now while designing the traversal layer so a
    generic finder can be added later without breaking callers

### 2026-04-18 14:08 ET — Architecture Issue 13 accepted

- User choice:
  ship the concrete traversal tools now, but keep the underlying ref model and
  traversal behavior generic enough that a broader finder can be added later
- Chosen direction:
  avoid premature generic tool design while preserving a clean extension seam
  for future entity discovery
- Why this matters:
  the current failure is in deterministic resolution and traversal, not in the
  absence of a universal search surface
- New open question:
  how the agent should choose between the new traversal tools and the existing
  `search_rules` / `search_cards` tools:
  - traversal-first
  - search-first
  - or a mixed policy based on query shape

### 2026-04-18 14:14 ET — Architecture Issue 14 reframed

- User correction:
  do not try to outsmart the model with clever prompt-level routing rules; if
  routing fails, that points to bad prompt/tool design on our side
- Direction change:
  move away from heuristic-heavy "anchored query" routing guidance and
  reframe the decision around how much explicit bias or external routing we
  want at all
- Scope guardrail reaffirmed:
  no brittle query-shape router hidden in the system prompt
- Decision status:
  still unresolved

### 2026-04-18 14:19 ET — Architecture Issue 14 accepted

- User choice:
  keep routing model-led with clear tool descriptions and modest prompt
  guidance
- Chosen direction:
  do not add an app-side or prompt-side heuristic router; make the traversal
  tools the obvious choice for exact lookups through clear naming and prompt
  guidance only
- Why this matters:
  the failure should be fixed by better tool affordances and system prompt
  clarity, not by hiding brittle query-shape logic outside the model
- New open question:
  what the mismatch/error policy should be when the traversal importer sees
  disagreements between GHS-derived structure and PDF-derived structure/text:
  - hard fail
  - warn and keep partial data
  - or use a tiered policy by mismatch severity

### 2026-04-18 14:22 ET — Architecture Issue 15 clarification requested

- User feedback:
  the mismatch-policy question was too jargon-heavy and needs a plain-English
  restatement before a decision
- Decision status:
  still unresolved
- Rewrite rule:
  describe the choice in terms of "stop the import" versus "log it and keep
  going," with concrete examples

### 2026-04-18 14:24 ET — Architecture Issue 15 accepted

- User choice:
  stop the import only when a disagreement would make traversal wrong; log and
  continue for smaller discrepancies
- Chosen direction:
  use a tiered failure policy for the traversal importer
- Why this matters:
  bad navigation data should never quietly ship, but minor source quirks should
  not block the entire pipeline
- New open question:
  how much dedicated test coverage to require for the new traversal path before
  implementation is considered complete:
  - importer only
  - importer plus tools
  - or importer, DB seed/load, tools, and one agent-level behavior test

### 2026-04-18 14:26 ET — Architecture Issue 16 accepted

- User choice:
  require the full reasonable floor:
  importer tests, DB seed/load tests, tool tests, and one agent-level behavior
  test
- Chosen direction:
  do not treat this as only a data-pipeline feature; the plan is incomplete if
  the agent path itself is not proven
- Why this matters:
  the original failure was end-to-end behavior, not just bad extracted data
- New open question:
  whether rollout should be done as one integrated branch or staged in smaller
  steps with intermediate non-user-visible commits/checkpoints

### 2026-04-18 14:28 ET — Architecture Issue 17 accepted

- User choice:
  deliver in one branch, but build it in clear slices
- Chosen direction:
  implement in sane checkpoints:
  - traversal schema + seed/load
  - importer
  - tools + MCP
  - agent prompt/tool updates
  - tests + docs
- Why this matters:
  it keeps the work reviewable and debuggable without unnecessary multi-PR
  process overhead
- Review status:
  interactive eng review decisions are complete
- Next checkpoint:
  synthesize the approved execution plan and turn it into an implementation
  checklist

### 2026-04-18 14:33 ET — Tech spec synthesis completed

- Action taken:
  folded the full approved eng-review outcome back into
  `docs/plans/sqr-103-traversal-research-agent-tech-spec.md`
- Result:
  the tech spec is now the primary implementation document rather than a
  pre-review sketch with stale open questions
- Additional housekeeping:
  added a durable learning about disk-backed checkpoints for long interactive
  plan reviews in Codex

---

## Next checkpoint

Resume at **Implementation kickoff**.

The next live decision is:

- no new plan-review decision required; implementation can start from
  `docs/plans/sqr-103-traversal-research-agent-tech-spec.md`
