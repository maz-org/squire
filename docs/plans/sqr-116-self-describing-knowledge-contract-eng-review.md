# SQR-116 Eng Review: Self-Describing Knowledge Tool Contract

**Issue:** SQR-116  
**Branch:** `bcm/sqr-116-design-the-self-describing-knowledge-tool-contract`  
**Date:** 2026-04-26  
**Status:** Clean, proceed to implementation

## Scope

Design the next knowledge-tool contract so Squire can expose discovery,
resolution, opening, search, and graph traversal without teaching the model a
long choreography prompt.

The implementation for this issue is documentation only:

- write the checked-in tool contract
- link it from architecture docs
- capture the contract decision in an ADR
- define eval questions for later implementation tickets

## Step 0: Scope Challenge

Scope accepted as-is.

The ticket should not implement tools yet. SQR-117 and SQR-118 are already
blocked by this issue and should consume the contract after it lands.

## Architecture Review

No blocking issues, moving on.

The right architecture is a versioned contract over the existing retrieval
surfaces:

```text
Ask-question entry point
/api/ask or in-process service call
  |
  v
Knowledge agent
  |
  v
self-describing internal tools
  |
  +-- inspect_sources()
  +-- schema(kind)
  +-- resolve_entity(...)
  +-- open_entity(ref)
  +-- search_knowledge(...)
  +-- neighbors(ref, ...)
  |
  v
existing adapters
  |
  +-- searchRules()
  +-- findScenario() / getScenario() / getSection() / followLinks()
  +-- searchCards() / listCardTypes() / listCards() / getCard()

Optional external MCP projection:
  inspect_sources() -> squire_inspect_sources()
  open_entity(ref) -> squire_open_entity(ref)
```

The contract should preserve ADR 0013: the current Hono, Postgres + pgvector,
Claude SDK loop, conversation service, SSE, MCP, REST, Langfuse, and
OpenTelemetry path remains the production baseline during the redesign.

Anthropic's agent-tool guidance changes the plan in four concrete ways:

- expose a few intent-grouped tools instead of mirroring every existing
  endpoint
- add `responseFormat`, `limit`, and truncation hints so search and traversal do
  not dump low-value context into the model
- return actionable validation errors, not bare error codes
- prove the contract with realistic multi-call evals, held-out prompts, and an
  A/B against the current production prompt before removing prompt choreography

Anthropic's MCP production guidance applies only to the optional external MCP
projection. It should not drive the internal agent tool names. If Squire exposes
the new tools directly over MCP, `squire_` names are reasonable there.

## Code Quality Review

No blocking issues, moving on.

The main quality requirement is to avoid duplicating schemas separately in
`src/agent.ts` and `src/mcp.ts` when implementation begins. SQR-117 should add
shared contract definitions once, then adapt both Anthropic tool schemas and MCP
schemas from the same source where practical.

The shared definitions must include the ref parser, active kind registry, and
relation registry. Tool input schemas should validate kind and relation strings
against `inspect_sources()` / `schema(kind)` rather than duplicating closed enum
lists across tools.

Tool descriptions should read like instructions to a new teammate: what the
tool does, when to use it, what inputs are valid, what comes back, and what to
try after a recoverable failure.

## Test Review

The review target is a documentation feature, but the implementation tickets
need test coverage for every contract path.

```text
CODE PATHS                                            USER FLOWS
[+] docs contract                                     [+] Agent asks "what can I inspect?"
  +-- [GAP] inspect_sources examples                    +-- [GAP] [->EVAL] discovers sources without prompt choreography
  +-- [GAP] schema(kind) examples                       +-- [GAP] [->EVAL] asks for scenario 61 and opens exact records
  +-- [GAP] resolve_entity examples                     +-- [GAP] [->EVAL] asks for a card by name and resolves sourceId
  +-- [GAP] open_entity examples                        +-- [GAP] [->EVAL] follows scenario conclusion links
  +-- [GAP] search_knowledge examples                   +-- [GAP] [->EVAL] mixes fuzzy rules search with exact refs
  +-- [GAP] neighbors examples                          +-- [GAP] [->EVAL] asks what can be inspected next

COVERAGE: 0/12 paths tested (0%) before implementation
QUALITY: gaps are expected because SQR-116 is the design source for SQR-117/SQR-118
```

SQR-116 must include multi-step eval questions in the contract doc. SQR-117 and
SQR-118 must turn those into actual eval cases, plus unit tests for shared
schemas, ref parsing, adapter dispatch, not-found behavior, dynamic
kind/relation validation, and MCP registration.

The eval harness should record answer correctness, tool-call count, tool errors,
runtime, and token use. It should avoid overfitting by keeping held-out prompts
that are not used while tuning descriptions. Before migration, it must compare
the current production prompt plus old tools against the shortened prompt plus
new contract tools and block removal of old choreography on any unexplained
answer-quality regression.

## Performance Review

No blocking issues, moving on.

The contract should keep result payloads bounded by default and make high-volume
expansion explicit:

- `search_knowledge` defaults to a small top-K result set.
- `open_entity` returns one entity by canonical ref, not arbitrary fan-out.
- `neighbors` returns relation summaries and refs, not full recursively opened
  entities.
- `inspect_sources` and `schema` are static or cheap metadata calls.
- high-volume tools accept `responseFormat: "concise" | "detailed"` and return
  `truncated: true` with a repair hint when output is capped.
- `search_knowledge` must define per-scope fan-out and latency budgets before
  implementation, because broad search crosses pgvector and Postgres FTS.

## NOT In Scope

- Implementing the new tools in `src/tools.ts`: deferred to SQR-117 and SQR-118.
- Replacing the production agent loop: forbidden by ADR 0013 until the Step 3
  eval report.
- Removing old tools from MCP: old names stay as adapters during migration.
- Campaign-state implementation: only reserve refs and kinds for future campaign
  records.
- UI changes to consulted-source chips: no user-visible web changes in SQR-116.

## What Already Exists

- `src/tools.ts` already contains data access primitives for rules passages,
  scenarios, sections, references, and card records.
- `src/mcp.ts` already exposes those primitives over MCP.
- `src/agent.ts` already exposes those primitives to the Claude SDK tool loop,
  but it carries too much routing logic in `AGENT_SYSTEM_PROMPT`.
- `docs/ARCHITECTURE.md` already describes atomic tools and the production
  baseline.
- `docs/adr/0013-phase-1-production-agent-baseline.md` already constrains this
  work to retrieval-surface changes, not runtime migration.

## Failure Modes

| Codepath           | Production failure                                          | Test?   | Handling?                                     | User impact                             |
| ------------------ | ----------------------------------------------------------- | ------- | --------------------------------------------- | --------------------------------------- |
| `resolve_entity`   | Ambiguous name resolves the wrong card or scenario          | SQR-117 | Must return candidates, not guess             | Wrong rule answer with false confidence |
| `open_entity`      | Unknown ref returns empty text instead of a structured miss | SQR-117 | Must return not-found with expected ref shape | Agent keeps searching blindly           |
| `neighbors`        | Recursive traversal explodes into too much context          | SQR-118 | Must cap and expose pagination or limits      | Slow answer, noisy prompt               |
| `schema`           | Tool schema drifts from runtime output                      | SQR-117 | Shared definitions plus tests                 | MCP callers parse stale docs            |
| `search_knowledge` | Search result lacks citations/source labels                 | SQR-118 | Result shape requires citations               | User cannot verify answer               |
| MCP projection     | Generic MCP names collide with another server's tools       | SQR-117 | Consider `squire_` only on MCP surface        | External agent picks the wrong source   |
| Ref parser         | Canonical and legacy refs parse differently across tools    | SQR-117 | One parser, explicit legacy allowlist         | Agent opens the wrong game/source       |
| Dynamic validation | New kinds or relations require editing multiple schemas     | SQR-117 | Validate against discovered registries        | Contract stops being self-describing    |

Critical silent gaps: none for this docs-only issue. The implementation tickets
must not ship with any silent not-found or ambiguous-resolution path.

## Worktree Parallelization Strategy

Sequential implementation, no parallelization opportunity for SQR-116.

Follow-on implementation can split:

| Step                               | Modules touched                                       | Depends on          |
| ---------------------------------- | ----------------------------------------------------- | ------------------- |
| SQR-117 source/schema/resolve/open | `src/tools.ts`, `src/mcp.ts`, `src/agent.ts`, `test/` | SQR-116             |
| SQR-118 search/neighbors           | `src/tools.ts`, `src/mcp.ts`, `src/agent.ts`, `test/` | SQR-117             |
| eval conversion                    | `eval/`, `test/fixtures/`                             | SQR-117 and SQR-118 |

Execution order: finish SQR-116, then SQR-117, then SQR-118 plus eval work.

## TODO Candidates

No separate `TODOS.md` items proposed. The work is already tracked by SQR-117
and SQR-118.

## Completion Summary

- Step 0: Scope Challenge: scope accepted as-is
- Architecture Review: 0 issues found
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 12 planned implementation gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps flagged for SQR-116 docs-only scope
- Outside voice: skipped
- Parallelization: sequential for SQR-116
- Lake Score: 1/1 recommendations chose complete option

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                        | Runs | Status  | Findings                                   |
| ------------- | --------------------- | -------------------------- | ---- | ------- | ------------------------------------------ |
| CEO Review    | `/plan-ceo-review`    | Scope and strategy         | 0    | not run | Not required for docs-only contract design |
| Codex Review  | `/codex review`       | Independent second opinion | 0    | not run | Not required before first draft            |
| Eng Review    | `/plan-eng-review`    | Architecture and tests     | 1    | clean   | Proceed with documentation implementation  |
| Design Review | `/plan-design-review` | UI/UX gaps                 | 0    | not run | No visual scope                            |
| DX Review     | `/plan-devex-review`  | Developer experience gaps  | 0    | not run | MCP/REST caller DX covered in contract     |

Plan status: eng review cleared.
