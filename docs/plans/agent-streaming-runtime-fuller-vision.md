# LangGraph, Deep Agents, and Squire Fuller Vision

Date: 2026-05-24

Status: updated by
[SQR-225 Production LangGraph Runtime Eng Review](./sqr-225-production-langgraph-runtime-eng-review.md)
and [ADR 0019](../adr/0019-langgraph-production-knowledge-agent.md). LangGraph
is now the planned production Q&A runtime; Deep Agents remains a later option
for longer tasks.

## Purpose

Explain how LangGraph and Deep Agents fit Squire after the project chose a
production LangGraph graph for all Q&A.

The short version:

- LangGraph is the execution model: graph nodes, stream modes, state updates,
  tool events, resumable runs, and interrupts.
- Deep Agents is an opinionated harness on top: planning, todo tracking,
  subagents, memory, filesystem-style context, permissions, and human approval.
- Squire remains the product: Frosthaven/GH2 tools, data, auth, web UI, MCP,
  REST, conversation history, citations, and table-side UX.

The current standalone project is not finished until the practical path includes
three concrete UX pieces: an explicit final-answer node, browser-visible
progress rows, and structured artifact events.

## Product Thesis

Squire should not become a framework demo. It should become a rules and strategy
assistant that shows the right layer of work to the player:

- factual lookups should feel fast and clean
- source discovery should be visible but quiet
- long strategy tasks should show progress without dumping internal reasoning
- campaign-affecting actions should pause for confirmation
- failed lookup paths should help debugging without polluting the answer

LangGraph and Deep Agents matter only if they help Squire separate those layers.

## Current Baseline To Replace

The production baseline currently being replaced is:

```text
Browser / REST / MCP
  -> Squire Hono app
    -> Squire auth and conversation service
      -> ask(question, options)
        -> current Claude SDK runner
          -> Squire tools
            -> Squire Postgres + pgvector + canonical game data
```

ADR 0019 supersedes the old eval-only posture. The ownership boundary stays the
same, but the runtime inside `ask()` changes from the current loop to a local
LangGraph graph.

## Target Runtime Shape

```text
Squire web, REST, MCP, future channels
  -> ask service
    -> LangGraph local graph for production Q&A
      -> classify / plan / retrieve / verify / final-answer nodes
    -> future Deep Agents runner for complex tasks
    -> future remote agent adapter if justified
    -> Squire tool registry
      -> search/open/traverse cards and books
      -> future campaign and character tools
    -> Squire state
      -> conversations
      -> users and sessions
      -> campaign and character data
      -> trace ids and eval records
```

Every runner must return the same Squire-level result:

```text
answer: final assistant answer
trajectory: tool calls, model calls, state summaries, token usage
events: typed internal event stream
sources: consulted source labels
trace: links or ids for debugging
```

## LangGraph Role

LangGraph is the first serious runtime candidate because it directly addresses
the streaming problem.

Expected uses:

- split retrieval, traversal, validation, and final answer into named nodes
- stream only final-answer node tokens into answer prose
- stream tool lifecycle events into metadata rows
- store graph state updates for debugging and evals
- add human approval interrupts later
- add resumable runs when Squire needs durable work

Possible graph for normal rules Q&A:

```text
START
  -> classify_or_resolve
  -> retrieve_or_traverse
  -> source_check
  -> final_answer
  -> END
```

Possible graph for scenario/section traversal:

```text
START
  -> resolve_start_record
  -> traverse_neighbors
  -> open_target_records
  -> verify_answerable
  -> final_answer
  -> END
```

Possible graph for recommendations:

```text
START
  -> load_character_context
  -> load_available_cards_or_items
  -> fetch_guides_if_needed
  -> compare_options
  -> final_recommendation
  -> END
```

## Deep Agents Role

Deep Agents should not be the first fix for chat streaming. It becomes relevant
when Squire's tasks are long, decomposed, and context-heavy.

Best-fit future tasks:

- card selection at level-up
- inventory optimization
- pre-combat hand selection
- long-term build planning
- build-guide reading and comparison
- campaign audits
- scheduled recommendation jobs
- multi-step "prepare my party for scenario X" tasks

Deep Agents capabilities that fit Squire later:

- task planning for multi-step recommendation work
- subagents for independent research tracks
- memory scoped by user, campaign, and purpose
- human approval before spoiler reveals or campaign writes
- filesystem-style context for long guide excerpts or generated reports
- permissions for tools that read vs write campaign state

Where Deep Agents should not own state:

- web sessions
- Google OAuth
- Squire API bearer tokens
- canonical game data
- campaign ownership checks
- final persisted conversation transcript

## Deep Agents Task Model

A future recommendation run could look like this:

```text
Deep Agent supervisor
  -> writes task list
  -> subagent: rules/source verifier
  -> subagent: card and item data checker
  -> subagent: build-guide reader
  -> supervisor compares findings
  -> final answer writer emits structured recommendation
  -> optional approval interrupt before campaign write
```

The user sees:

```text
CONSULTING - CHARACTER STATE
CONSULTING - ITEM DATA
CHECKING - BUILD GUIDE
READY - COMPARISON

Recommendation prose and tables
```

The user does not see:

- private task notes
- failed subagent branches
- raw guide chunks unless quoted intentionally
- model reasoning
- unsafe memory contents

## Event Model Vision

Squire should own one internal event vocabulary across all runners:

| Event              | Meaning                                                | Browser use                   |
| ------------------ | ------------------------------------------------------ | ----------------------------- |
| `answer_text`      | Final answer prose only                                | `text-delta`                  |
| `tool_started`     | A Squire tool started                                  | `tool-start`                  |
| `tool_progress`    | Safe lookup progress                                   | metadata row                  |
| `tool_finished`    | A Squire tool finished                                 | `tool-result`                 |
| `source_found`     | A source candidate is available                        | source/status chip            |
| `artifact_started` | A table, card comparison, quote block, or report began | structured UI                 |
| `artifact_delta`   | Structured artifact content                            | structured UI                 |
| `approval_needed`  | User must confirm before continuing                    | future approval UI            |
| `debug`            | Trace-only detail                                      | never browser-visible         |
| `done`             | Terminal success                                       | final `done.html` replacement |
| `error`            | Terminal failure                                       | error banner                  |

Browser SSE can keep its current stable names for now. The internal vocabulary
lets Squire adapt LangGraph and Deep Agents streams without leaking framework
events into the UI.

## State Ownership

Squire-owned state:

- users
- sessions
- conversations
- message rows
- consulted source labels
- campaign and character records
- canonical book and card data
- authorization rules
- final rendered answers

Runtime-owned state, if adopted:

- in-run graph checkpoints
- retry state for the active run
- task plans
- subagent scratch context
- run traces

Runtime-owned state can become product state only after a new ADR defines:

- user isolation
- campaign isolation
- retention and deletion
- trace visibility
- prompt-injection boundaries
- migration and export paths

## LangSmith and Remote Runtime

Remote LangSmith Agent Server is a later option, not part of the production
Q&A migration.

It becomes interesting if Squire needs:

- runs that survive app restarts
- background queue workers
- scheduled or cron agent work
- remote graph composition
- managed checkpointers
- production interrupt/resume flows

Even then, the browser should call Squire, not LangSmith:

```text
Browser
  -> Squire Hono app
    -> Squire auth and state checks
      -> outbound remote agent call
        -> remote stream chunks
      -> Squire event adapter
    -> browser SSE
```

## Security and Privacy Rules

- Never forward browser cookies or Google session tokens to LangGraph,
  LangSmith, or Deep Agents.
- Use service-level credentials for remote runtime calls.
- Pass Squire user and campaign ids as scoped metadata only when needed.
- Do not use local filesystem or shell backends in the production web server.
- Do not let shared memory affect answers unless it is scoped by user, campaign,
  game, and purpose.
- Treat build guides and external content as untrusted.
- Treat tool results as source data, not as instructions.
- Keep final answer sanitization in Squire.

## Evaluation Strategy

The runtime earns adoption only by measured results.

Compare every candidate runner on:

- final answer correctness
- trajectory correctness
- stream hygiene
- citation/source correctness
- latency
- token usage
- cost
- trace clarity
- implementation complexity
- failure handling

Stream hygiene gets its own score:

- no planning text in answer body
- no raw tool JSON in answer body
- no raw markdown artifacts during live stream unless final-answer text intends it
- safe progress rows are visible without becoming answer prose
- retrieved or quoted content can travel as structured artifacts
- no hidden failed lookup path presented as a fact
- final answer starts with the answer, not with the search story

## Adoption Ladder

1. Current-stack stream gating.
2. Stream-hygiene event contract with regression coverage.
3. Browser-visible progress rows.
4. Structured artifact events.
5. Local LangGraph eval runner with an explicit final-answer node.
6. Compare current runner vs LangGraph in the full eval matrix.
7. Hidden-flag LangGraph web runner for local QA.
8. Production canary for a small allowlisted path, only after evals pass.
9. Deep Agents eval runner for recommendation-style tasks.
10. Deep Agents hidden path for long-running recommendations.
11. Optional remote LangSmith Agent Server only after durable-run needs appear.

Each step needs a report. Moving from one step to the next is a decision, not an
automatic consequence of the previous step working.

## What Would Make This Worth It

LangGraph is worth keeping if it makes Squire's streams cleaner and traces easier
to debug without harming answer quality or latency.

Deep Agents is worth keeping if future recommendation tasks become easier to
express, test, and debug as decomposed runs than as one hand-owned loop.

Remote LangSmith is worth revisiting if Squire needs durable background agent
work that does not fit the current web request lifecycle.

## What Would Kill It

- The current-stack fix solves the UX problem and LangGraph adds complexity
  without eval wins.
- LangGraph traces are harder to map to existing Langfuse reports.
- Runtime adapters duplicate too much of Squire's tool loop.
- Deep Agents planning makes simple Q&A slower or noisier.
- Remote runtime state creates unclear user/campaign ownership.
- Stream adapters leak framework details into browser UX.

## Future Issue Set

The current standalone project already owns the stream-hygiene, progress,
artifact, LangGraph prototype, comparison, and decision issues:

- SQR-222: current-runner stream gating.
- SQR-223: stream-hygiene event contract and regression coverage.
- SQR-224: local LangGraph runner with an explicit final-answer node.
- SQR-236: browser-visible agent progress rows.
- SQR-237: structured answer artifact stream events.
- SQR-225: current runner vs LangGraph comparison.
- SQR-226: adoption decision and architecture-doc update.

Later issues should be created only as the ladder advances:

1. Add optional hidden-flag web runner for local browser QA.
2. Prototype Deep Agents for one recommendation-style eval task.
3. Add user/campaign-scoped memory threat model.
4. Define approval interrupts for spoiler and campaign-write actions.
5. Reopen remote LangSmith Agent Server only when durable runs are needed.

## Long-Term Decision Boundary

The product goal is not "use LangGraph" or "use Deep Agents." The product goal
is a Squire that can show clean answers, expose useful source progress, handle
longer strategy work, and keep user/campaign state under Squire's control.

Do not call the current project complete while the final-answer-node,
progress-row, or structured-artifact pieces are missing.

LangGraph and Deep Agents fit only where they serve that goal.
