# SQR-103 Traversal-First Research Agent — Tech Spec

**Issue:** `SQR-103`
**Produced by:** `/office-hours` on 2026-04-18
**Status:** approved for eng review
**Companion docs (read first):** `docs/ARCHITECTURE.md`, `docs/SPEC.md`, `docs/DEVELOPMENT.md`
**Companion checkpoint:** `docs/plans/sqr-103-traversal-research-agent-review-checkpoint.md`
**Source design artifact:** `/Users/bcm/.gstack/projects/maz-org-squire/bcm-bcmsqr-103-make-scenario-section-books-first-class-in-retrieval-design-20260418-122922.md`

---

## Goal

Make Squire reliably answer chained Frosthaven scenario and section questions by
using a traversal-first research agent instead of relying on one-pass semantic
search.

The motivating failure is:

- User question: `show the full text of the section to read at the conclusion of scenario 61`
- Current answer: `I was unable to produce an answer within the allowed number of steps.`

The user then had to manually trace through multiple PDFs, follow section links,
read intermediary passages, infer the next hop, and keep going until the target
section was found. This is the job Squire is supposed to eliminate.

---

## Non-goals

- Building a general-purpose GraphRAG platform
- Replacing semantic search entirely
- Solving every cross-document reasoning problem in one PR
- Shipping Gloomhaven 2.0 support in this issue

This issue should solve the Frosthaven chain-traversal job cleanly and leave a
clear extension seam for later games.

---

## Existing building blocks

The codebase already has useful pieces:

- `data/extracted/scenarios.json`
  Scenario metadata with canonical `sourceId`, `index`, `name`,
  `scenarioGroup`, and `flowChartGroup`
- `src/extracted-data.ts`
  DB-backed loading and exact lookup by canonical `sourceId`
- `src/tools.ts`
  Existing tools: `searchRules`, `searchCards`, `listCards`, `getCard`
- `src/agent.ts`
  Tool-using research loop with fallback iteration limit
- Vector-backed book search
  Useful as fallback, but weak for explicit multi-hop chains

What is missing is explicit section-link structure and deterministic traversal.

---

## User job

There are two related jobs:

1. **Specialized case**
   Start from a scenario, find its success/conclusion section, and return the
   full text to read.
2. **General case**
   Find a section, read that text, infer the next explicit section or scenario
   reference, follow it, and repeat until the answer is grounded.

The second case is the real product frame. The first is just an especially
common instance of it.

---

## Architectural decision

Use a **multi-tool research agent** with a **sparse explicit reference layer**.

That means:

- exact entity resolution for scenarios and sections
- deterministic traversal of explicit links
- exact section text fetch
- semantic search only when the trail becomes fuzzy

Do **not** ask the model to invent the chain from scratch when the books already
contain explicit references.

---

## Recommended implementation shape

### 1. Add a sparse reference artifact

Generate a game-scoped artifact containing explicit references such as:

- `scenario -> section`
- `section -> section`
- `section -> scenario`

This can be a checked-in/generated data artifact, not a new storage subsystem.
Keep it boring.

### 2. Add deterministic traversal tools

Add tools shaped around the real job:

- `find_scenario({ game, query })`
  Resolve scenario by number, exact name, or close alias
- `get_scenario_links({ game, scenarioId })`
  Return explicit structured links from the scenario
- `get_section({ game, sectionId })`
  Fetch the full text of a section
- `get_section_links({ game, sectionId })`
  Return explicit outbound references from a section

Keep `search_rules` as the fuzzy fallback, not the first hop.

### 3. Update the agent prompt and behavior

Teach the agent to do this in order:

1. resolve exact scenario/section entities
2. traverse explicit links
3. fetch full text
4. use semantic search only if deterministic traversal cannot continue
5. answer with evidence chain

### 4. Keep game scope explicit

Every new artifact and tool should be game-scoped from day one so Gloomhaven 2.0
can slot in later without rewriting the model.

---

## Data flow

```text
User question
    |
    v
Research agent
    |
    +--> exact scenario or section resolution
    |      |
    |      +--> canonical ID
    |
    +--> explicit reference traversal
    |      |
    |      +--> scenario -> section
    |      +--> section -> next section
    |
    +--> full text fetch
    |
    +--> fallback semantic search if the chain goes fuzzy
    |
    v
Grounded answer + evidence chain
```

---

## Scope reduction choice

The approved shape is **not** a full graph storage layer. The right-sized first
implementation is:

- a sidecar explicit-reference artifact
- deterministic traversal tools
- updated agent behavior
- regression tests

This keeps the diff smaller and still solves the real user pain.

---

## Test requirements

Minimum required coverage:

1. Exact scenario resolution:
   - `61` resolves to `gloomhavensecretariat:scenario/061`
   - wrong field names / wrong zero-padding regressions stay dead
2. Scenario-to-section traversal:
   - scenario 61 conclusion question returns the correct section text
3. General chained traversal:
   - at least one test where section text leads to another explicit section and
     the agent follows it correctly
4. Failure states:
   - unknown scenario
   - unknown section
   - ambiguous scenario match
   - broken chain
5. Agent behavior:
   - explicit traversal is attempted before semantic search for explicit-link
     questions
   - the question does not hit `MAX_AGENT_ITERATIONS`

---

## Success criteria

- `show the full text of the section to read at the conclusion of scenario 61`
  returns the correct section text
- the answer includes enough evidence to show the chain used
- the agent resolves the scenario correctly on the first hop
- semantic search becomes support, not the main planner, for explicit-link
  questions
- the design leaves a clean extension seam for Gloomhaven 2.0

---

## Open questions for eng review

1. Where should the explicit-reference artifact be generated from:
   existing PDFs, GHS data, or a hybrid?
2. Should section-link extraction happen at build/index time or request time?
3. How much chain reasoning should remain in the model versus deterministic
   helpers?
4. Is there an ADR-worthy decision once the traversal artifact format is chosen?
