# Self-Describing Knowledge Tool Contract

**Status:** Draft contract for SQR-116  
**Applies to:** Squire's internal knowledge-agent tool set, with MCP and REST
compatibility projections  
**Related ADR:** [ADR 0014](adr/0014-self-describing-knowledge-tool-contract.md)

## Goal

Squire's user-facing entry point is still an ask-question task: the web channel,
REST callers, and future clients hand the knowledge agent a natural-language
question and expect a grounded answer.

This contract is for the tools inside that knowledge-agent loop. They should
describe the domain well enough that the agent can discover what exists, resolve
fuzzy user language into canonical refs, open exact records, search broad
knowledge, and traverse related records without a long routing prompt.

The prompt should explain role and answer quality. Tool names, schemas, and
outputs should explain tool choreography.

## Current Problem

The current tool set works, but it is shaped around known workflows:

- `search_rules`
- `search_cards`
- `list_card_types`
- `list_cards`
- `get_card`
- `find_scenario`
- `get_scenario`
- `get_section`
- `follow_links`

The agent prompt currently says when to use each one. That makes routing fragile:
new data types need prompt edits, exact lookups need special wording, and the
model has to remember that scenarios, sections, cards, and book passages all use
different lookup verbs.

## Contract Principles

1. **Refs are the stable address.** Every inspectable entity has a canonical ref.
2. **Discovery is a tool call, not a prompt paragraph.** Callers ask what sources
   and kinds exist.
3. **Resolution never silently guesses.** Ambiguous user text returns candidates
   with confidence and reasons.
4. **Opening is exact.** `open_entity(ref)` returns one record or a structured
   not-found result.
5. **Search finds, neighbors traverse.** Fuzzy search and graph traversal are
   separate operations.
6. **Tools group intent, not endpoints.** Each operation maps to how an agent
   works: discover, inspect schema, resolve, open, search, traverse.
7. **Results show the next move.** Outputs include citations, source labels,
   links, related refs, confidence, and inspectable refs.
8. **Responses are context-efficient by default.** Tools return concise, relevant
   context unless the caller asks for detail.
9. **Old tools can remain adapters.** The new contract changes the public shape,
   not the production baseline from ADR 0013.

These principles incorporate Anthropic's 2025 guidance on writing tools for
agents. The MCP guidance only applies when projecting the same contract to
external MCP callers:

- build a few high-impact tools around agent intent, not one tool per internal
  endpoint
- prefer meaningful names and source labels over opaque IDs, while still
  returning canonical refs for follow-up calls
- bound large responses with limits, filters, pagination, and truncation hints
- make validation errors tell the agent exactly how to repair the call
- evaluate tool use against realistic multi-step tasks, not toy prompts

## Layering

There are three separate surfaces:

1. **Ask-question entry point:** `/api/ask` and the in-process service call. This
   remains the product API for "answer my Frosthaven question."
2. **Agent tool contract:** the six operations in this document. These are the
   tools the knowledge agent uses while answering.
3. **External MCP projection:** the same operations exposed to MCP-capable
   clients that want direct tool access instead of Squire's full answer loop.

The contract is designed primarily for layer 2. MCP details must not force the
internal agent loop into awkward names or payloads.

## Tool Namespacing

The canonical operation names are short because they describe the internal
agent's work:

- `inspect_sources`
- `schema`
- `resolve_entity`
- `open_entity`
- `search_knowledge`
- `neighbors`

External MCP names may use a `squire_` prefix so they remain clear when a client
loads tools from many MCP servers:

| Agent operation    | Optional MCP projection   |
| ------------------ | ------------------------- |
| `inspect_sources`  | `squire_inspect_sources`  |
| `schema`           | `squire_schema`           |
| `resolve_entity`   | `squire_resolve_entity`   |
| `open_entity`      | `squire_open_entity`      |
| `search_knowledge` | `squire_search_knowledge` |
| `neighbors`        | `squire_neighbors`        |

If MCP names diverge from agent names, tests must prove both surfaces point at
the same shared contract definitions.

## Entity Kinds

| Kind            | Meaning                                                                                              | Current source                              | Ref examples                                            |
| --------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| `source`        | A knowledge source such as a rulebook, section book, card database, or future campaign record store  | Source metadata                             | `source:frosthaven/rulebook`, `source:frosthaven/cards` |
| `rules_passage` | A semantic book-search passage from indexed PDFs                                                     | `searchRules()`                             | `rules:frosthaven/fh-rule-book.pdf#chunk=123`           |
| `scenario`      | A scenario-book scenario record                                                                      | `findScenario()`, `getScenario()`           | `scenario:frosthaven/061`                               |
| `section`       | A section-book section record                                                                        | `getSection()`                              | `section:frosthaven/67.1`                               |
| `card_type`     | A category of structured GHS card data                                                               | `listCardTypes()`                           | `card-type:frosthaven/items`                            |
| `card`          | A structured card, item, monster, event, building, scenario, ability, battle goal, or personal quest | `searchCards()`, `listCards()`, `getCard()` | `card:frosthaven/items/gloomhavensecretariat:item/1`    |
| `campaign`      | Future campaign state                                                                                | Future Phase 4 data                         | `campaign:frosthaven/<campaign-id>`                     |
| `character`     | Future character state                                                                               | Future Phase 4 data                         | `character:frosthaven/<character-id>`                   |
| `party`         | Future party state                                                                                   | Future Phase 4 data                         | `party:frosthaven/<party-id>`                           |

Refs are URL-safe strings with this formal shape:

```text
<kind>:<game>/<path>[#<fragment>]
```

Rules:

- `kind` is one of the active kinds returned by `inspect_sources()`.
- `game` is one of the active games returned by `inspect_sources()`.
- `path` is one or more slash-separated segments. Segment values may contain
  letters, numbers, dots, underscores, hyphens, and colons. This allows GHS
  source IDs such as `gloomhavensecretariat:item/1` to remain recognizable.
- `fragment` is optional and uses query-like key/value pairs for sub-record
  locators, for example `chunk=123`.
- Parsers must split at the first `:`, the first `/` after that colon, and the
  first `#`. They must not split `path` on later colons.
- `open_entity` accepts a closed legacy-ref allowlist during migration, but
  returns the canonical new ref in the result.

Legacy refs allowed during migration:

| Legacy shape                           | Interpreted as                           | Removal gate                                        |
| -------------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| `gloomhavensecretariat:scenario/<nnn>` | `scenario:frosthaven/<nnn>`              | Remove after SQR-117 and SQR-118 eval parity passes |
| `<section>.<variant>`                  | `section:frosthaven/<section>.<variant>` | Remove after SQR-117 and SQR-118 eval parity passes |

Bare legacy refs are Frosthaven-only. Callers that know the game must send the
canonical ref.

## Shared Result Shapes

### Entity Ref

```json
{
  "kind": "section",
  "ref": "section:frosthaven/67.1",
  "title": "Section 67.1",
  "sourceLabel": "Section Book 62-81"
}
```

### Citation

```json
{
  "sourceRef": "source:frosthaven/section-book-62-81",
  "sourceLabel": "Section Book 62-81",
  "locator": "section 67.1",
  "quote": "Short excerpt, when useful"
}
```

### Related Entity

```json
{
  "relation": "conclusion",
  "target": {
    "kind": "section",
    "ref": "section:frosthaven/67.1",
    "title": "Section 67.1",
    "sourceLabel": "Section Book 62-81"
  },
  "reason": "Scenario conclusion points to this section"
}
```

### Failure

Every tool returns structured failures instead of plain text errors:

```json
{
  "ok": false,
  "error": {
    "code": "not_found",
    "message": "No section found for section:frosthaven/999.9",
    "retryable": false
  }
}
```

Allowed error codes:

- `invalid_ref`
- `unknown_kind`
- `not_found`
- `ambiguous`
- `invalid_filter`
- `unsupported_relation`
- `source_unavailable`
- `internal_error`

Errors should include an actionable repair hint when the caller can recover:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_ref",
    "message": "Expected ref shape <kind>:<game>/<id>, got 67-1",
    "retryable": false,
    "hint": "Use section:frosthaven/67.1 or call resolve_entity(\"67.1\", [\"section\"]) first"
  }
}
```

### Response Format

Large tools accept a response format parameter:

```json
{
  "responseFormat": "concise"
}
```

Allowed values:

- `concise`: enough title, snippet, ref, source label, confidence, and next refs
  for the agent to decide the next step
- `detailed`: full record fields, citations, links, related records, and raw
  metadata needed for answer synthesis or follow-up calls

Default behavior:

- discovery and schema tools return detailed metadata because they are already
  small
- resolve and search default to `concise`
- open defaults to `detailed`
- neighbors defaults to `concise`

Precedence rule:

- `include` controls which optional groups may be returned.
- `responseFormat` controls how much detail each returned group contains.
- If `responseFormat: "concise"` and `include` asks for `raw`, the tool returns
  `invalid_filter` with a hint to use `responseFormat: "detailed"`.
- If `responseFormat: "detailed"` omits a group from `include`, that group is
  omitted even though detailed mode could have returned it.

## Tool Contract

### `inspect_sources()`

Discover the knowledge sources and entity kinds Squire can inspect.

Input schema:

```json
{
  "type": "object",
  "properties": {}
}
```

Output schema:

```json
{
  "ok": true,
  "games": [
    {
      "id": "frosthaven",
      "label": "Frosthaven",
      "default": true
    }
  ],
  "sources": [
    {
      "ref": "source:frosthaven/rulebook",
      "label": "Frosthaven Rulebook",
      "kinds": ["rules_passage"],
      "searchable": true,
      "openable": false,
      "relations": []
    }
  ],
  "defaultGame": "frosthaven"
}
```

Example:

```json
{
  "ok": true,
  "games": [
    {
      "id": "frosthaven",
      "label": "Frosthaven",
      "default": true
    }
  ],
  "sources": [
    {
      "ref": "source:frosthaven/rulebook",
      "label": "Frosthaven Rulebook",
      "kinds": ["rules_passage"],
      "searchable": true,
      "openable": false,
      "relations": []
    },
    {
      "ref": "source:frosthaven/scenario-section-books",
      "label": "Scenario and Section Books",
      "kinds": ["scenario", "section"],
      "searchable": true,
      "openable": true,
      "relations": ["conclusion", "read_now", "section_link", "unlock", "cross_reference"]
    },
    {
      "ref": "source:frosthaven/cards",
      "label": "GHS Card Data",
      "kinds": ["card_type", "card"],
      "searchable": true,
      "openable": true,
      "relations": ["belongs_to_type"]
    }
  ],
  "defaultGame": "frosthaven"
}
```

Failure behavior:

- Returns `source_unavailable` if the metadata store cannot be read.
- Returns partial source metadata with `warnings` when one source is down but
  static sources are still known.

### `schema(kind)`

Inspect the shape, filters, and examples for an entity kind.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "kind": {
      "type": "string",
      "description": "Entity kind returned by inspect_sources()."
    }
  },
  "required": ["kind"]
}
```

Output schema:

```json
{
  "ok": true,
  "kind": "card",
  "refPattern": "card:<game>/<card-type>/<source-id>",
  "fields": [{ "name": "name", "type": "string", "description": "Display name" }],
  "filterFields": ["type", "name", "level", "class", "prosperity"],
  "relations": ["belongs_to_type"],
  "examples": [
    {
      "label": "Open item 1",
      "ref": "card:frosthaven/items/gloomhavensecretariat:item/1"
    }
  ]
}
```

Example for `section`:

```json
{
  "ok": true,
  "kind": "section",
  "refPattern": "section:<game>/<section-number>.<variant>",
  "fields": [
    { "name": "text", "type": "string", "description": "Section prose" },
    { "name": "sourcePage", "type": "number", "description": "Printed PDF page" }
  ],
  "filterFields": ["sectionNumber", "sectionVariant"],
  "relations": ["read_now", "section_link", "unlock", "cross_reference"],
  "examples": [{ "label": "Open section 67.1", "ref": "section:frosthaven/67.1" }]
}
```

Failure behavior:

- `unknown_kind` when `kind` is not returned by `inspect_sources()`.
- `source_unavailable` when a dynamic schema source cannot be inspected.

### `resolve_entity(query, kinds?)`

Turn user language into canonical candidate refs.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string" },
    "kinds": {
      "type": "array",
      "items": {
        "type": "string",
        "description": "Entity kind returned by inspect_sources()."
      },
      "description": "Optional kind filter. Omit to search all active kinds."
    },
    "mode": {
      "type": "string",
      "enum": ["candidates", "single"],
      "default": "candidates",
      "description": "Use candidates for normal resolution. Use single only when the caller needs exactly one ref."
    },
    "game": { "type": "string", "default": "frosthaven" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 6 },
    "responseFormat": {
      "type": "string",
      "enum": ["concise", "detailed"],
      "default": "concise"
    }
  },
  "required": ["query"]
}
```

Output schema:

```json
{
  "ok": true,
  "query": "scenario 61",
  "candidates": [
    {
      "entity": {
        "kind": "scenario",
        "ref": "scenario:frosthaven/061",
        "title": "Life and Death",
        "sourceLabel": "Scenario Book 62-81"
      },
      "confidence": 0.99,
      "matchReason": "Exact scenario number"
    }
  ]
}
```

`include` field meanings:

- `citations` returns source attribution for facts in `entity.data`.
- `links` returns explicit refs found in the opened record, such as scenario
  conclusions, unlocks, anchors, or source-authored cross references.
- `related` returns inferred nearby entities from indexes or relationship
  expansion. It is useful for exploration, but answers should not treat it as a
  source-authored link unless a follow-up `open_entity()` call provides
  citations.
- `raw` returns implementation metadata needed for debugging or migration, not
  normal answer synthesis.

`neighbors()` traverses the same explicit relationship graph exposed through
`links`, but starts from a ref and can filter by relation without opening the
full entity payload.

Example:

```json
{
  "ok": true,
  "query": "scenario 61",
  "candidates": [
    {
      "entity": {
        "kind": "scenario",
        "ref": "scenario:frosthaven/061",
        "title": "Life and Death",
        "sourceLabel": "Scenario Book 62-81"
      },
      "confidence": 0.99,
      "matchReason": "Exact scenario number"
    }
  ]
}
```

Failure behavior:

- Empty `candidates` is a successful miss, not an error.
- `ambiguous` is only used when `mode: "single"` and multiple candidates are
  plausible enough that auto-opening would be unsafe.
- `invalid_filter` when `kinds` contains a kind not returned by
  `inspect_sources()`.

Confidence policy:

- `0.95-1.0`: exact canonical ref, exact scenario/section number, or exact
  source ID match. The agent may open the top candidate without asking.
- `0.75-0.94`: strong name match, but not exact. The agent may open when the
  user phrasing clearly names one entity.
- `0.50-0.74`: plausible candidate. The agent should inspect candidates or ask
  a clarification before opening.
- `<0.50`: weak match. The agent should search or ask a clarification.

`mode: "single"` returns the entity directly only for the first two bands. It
returns `ambiguous` with candidates for ties or low-confidence matches.

### `open_entity(ref)`

Open one exact inspectable entity.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "ref": { "type": "string" },
    "include": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["citations", "links", "related", "raw"]
      },
      "default": ["citations", "links", "related"]
    },
    "responseFormat": {
      "type": "string",
      "enum": ["concise", "detailed"],
      "default": "detailed"
    }
  },
  "required": ["ref"]
}
```

Output schema:

```json
{
  "ok": true,
  "entity": {
    "kind": "section",
    "ref": "section:frosthaven/67.1",
    "title": "Section 67.1",
    "sourceLabel": "Section Book 62-81",
    "data": {}
  },
  "citations": [],
  "links": [],
  "related": []
}
```

Example:

```json
{
  "ok": true,
  "entity": {
    "kind": "section",
    "ref": "section:frosthaven/67.1",
    "title": "Section 67.1",
    "sourceLabel": "Section Book 62-81",
    "data": {
      "text": "Section text...",
      "sectionNumber": 67,
      "sectionVariant": 1
    }
  },
  "citations": [
    {
      "sourceRef": "source:frosthaven/section-book-62-81",
      "sourceLabel": "Section Book 62-81",
      "locator": "section 67.1"
    }
  ],
  "links": [
    {
      "relation": "unlock",
      "target": {
        "kind": "scenario",
        "ref": "scenario:frosthaven/116",
        "title": "Scenario 116",
        "sourceLabel": "Scenario Book"
      }
    }
  ],
  "related": []
}
```

Failure behavior:

- `invalid_ref` when the string cannot be parsed.
- `not_found` when the ref parses but no record exists.
- Legacy refs such as `gloomhavensecretariat:scenario/061` and `67.1` are
  accepted during migration and normalized in the returned `entity.ref`.

### `search_knowledge(query, scope?, filters?)`

Search broad knowledge across one or more sources.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string" },
    "scope": {
      "type": "array",
      "items": {
        "type": "string",
        "description": "Searchable kind returned by inspect_sources()."
      },
      "default": ["rules_passage", "scenario", "section", "card"]
    },
    "filters": {
      "type": "object",
      "additionalProperties": true
    },
    "game": { "type": "string", "default": "frosthaven" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 6 },
    "responseFormat": {
      "type": "string",
      "enum": ["concise", "detailed"],
      "default": "concise"
    }
  },
  "required": ["query"]
}
```

Output schema:

```json
{
  "ok": true,
  "query": "loot action",
  "results": [
    {
      "entity": {
        "kind": "rules_passage",
        "ref": "rules:frosthaven/fh-rule-book.pdf#chunk=42",
        "title": "Loot action",
        "sourceLabel": "Rulebook"
      },
      "score": 0.92,
      "snippet": "Loot action text...",
      "citations": [],
      "nextRefs": []
    }
  ]
}
```

Example:

```json
{
  "ok": true,
  "query": "what does brittle do",
  "results": [
    {
      "entity": {
        "kind": "rules_passage",
        "ref": "rules:frosthaven/fh-rule-book.pdf#chunk=88",
        "title": "Brittle",
        "sourceLabel": "Rulebook"
      },
      "score": 0.89,
      "snippet": "A figure with Brittle doubles the next source of damage...",
      "citations": [
        {
          "sourceRef": "source:frosthaven/rulebook",
          "sourceLabel": "Rulebook",
          "locator": "rulebook passage"
        }
      ],
      "nextRefs": [
        {
          "kind": "rules_passage",
          "ref": "rules:frosthaven/fh-rule-book.pdf#chunk=88",
          "title": "Brittle",
          "sourceLabel": "Rulebook"
        }
      ]
    }
  ]
}
```

Failure behavior:

- Empty `results` is a successful miss.
- `invalid_filter` when `scope` contains a searchable kind not returned by
  `inspect_sources()`.
- `invalid_filter` when filters do not apply to the chosen scope.
- `source_unavailable` when the requested source cannot be queried.
- If output is truncated, return `truncated: true` with a hint telling the agent
  which filter, limit, or exact ref to use next.

Fan-out and budget rules:

- `limit` is a global result limit. Each searched scope gets at most
  `ceil(limit / scope.length) + 1` provisional hits before final ranking.
- Broad default search may query rules, scenarios, sections, and cards in
  parallel, but each scope must have an independent timeout and error entry so
  one slow store does not hide useful results from another.
- `truncated: true` is global, and `truncatedScopes` lists which scopes had more
  available hits.
- SQR-118 must set concrete latency budgets in tests before implementation. The
  default broad search target is p95 under 2 seconds in local test fixtures and
  must not exceed the current `searchRules + searchCards` eval path by more than
  25% without an explicit follow-up decision.

### `neighbors(ref, relation?)`

Traverse known relationships from one entity.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "ref": { "type": "string" },
    "relation": {
      "type": "string",
      "description": "Relation advertised by inspect_sources() or schema(kind)."
    },
    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 20 },
    "responseFormat": {
      "type": "string",
      "enum": ["concise", "detailed"],
      "default": "concise"
    }
  },
  "required": ["ref"]
}
```

Output schema:

```json
{
  "ok": true,
  "from": {
    "kind": "scenario",
    "ref": "scenario:frosthaven/061",
    "title": "Life and Death",
    "sourceLabel": "Scenario Book 62-81"
  },
  "neighbors": [
    {
      "relation": "conclusion",
      "target": {
        "kind": "section",
        "ref": "section:frosthaven/67.1",
        "title": "Section 67.1",
        "sourceLabel": "Section Book 62-81"
      },
      "reason": "Conclusion link"
    }
  ]
}
```

Example:

```json
{
  "ok": true,
  "from": {
    "kind": "scenario",
    "ref": "scenario:frosthaven/061",
    "title": "Life and Death",
    "sourceLabel": "Scenario Book 62-81"
  },
  "neighbors": [
    {
      "relation": "conclusion",
      "target": {
        "kind": "section",
        "ref": "section:frosthaven/67.1",
        "title": "Section 67.1",
        "sourceLabel": "Section Book 62-81"
      },
      "reason": "Printed scenario conclusion"
    }
  ]
}
```

Failure behavior:

- `invalid_ref` when the origin ref cannot be parsed.
- `not_found` when the origin ref parses but does not exist.
- `unsupported_relation` when the relation is not advertised by
  `inspect_sources()` or is not available for the origin kind according to
  `schema(kind).relations`.
- Empty `neighbors` is a successful no-neighbor result.

## Migration Map

| Old tool          | New public path                                                                                       | Adapter expectation                                |
| ----------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `search_rules`    | `search_knowledge(query, scope: ["rules_passage"])`                                                   | Remains an internal adapter over `searchRules()`   |
| `search_cards`    | `search_knowledge(query, scope: ["card"])`                                                            | Remains an internal adapter over `searchCards()`   |
| `list_card_types` | `inspect_sources()` and `schema("card_type")`                                                         | Remains an internal adapter over `listCardTypes()` |
| `list_cards`      | `search_knowledge(query, scope: ["card"], filters)` or `open_entity(card-type ref)` for type browsing | Remains an internal adapter over `listCards()`     |
| `get_card`        | `open_entity(card ref)`                                                                               | Remains an internal adapter over `getCard()`       |
| `find_scenario`   | `resolve_entity(query, kinds: ["scenario"])`                                                          | Remains an internal adapter over `findScenario()`  |
| `get_scenario`    | `open_entity(scenario ref)`                                                                           | Remains an internal adapter over `getScenario()`   |
| `get_section`     | `open_entity(section ref)`                                                                            | Remains an internal adapter over `getSection()`    |
| `follow_links`    | `neighbors(ref, relation)`                                                                            | Remains an internal adapter over `followLinks()`   |

Migration sequence:

1. Add shared contract types and ref parsing.
2. Add new tools beside old tools in agent and MCP surfaces.
3. Update the agent prompt to prefer the new contract and remove routing
   choreography.
4. Keep old tools registered until evals show parity.
5. Hide or retire old public names only after MCP and REST callers have a
   compatibility window.

## MCP and REST Compatibility

MCP:

- MCP may expose `squire_*` names beside old tools during migration.
- Output stays JSON text content for MCP clients, but the JSON payload follows
  the schemas above.
- `isError` is reserved for transport or execution errors. Domain misses return
  `ok: false` inside the JSON payload so the agent can reason about them.
- Tool descriptions should point callers to `inspect_sources()` and `schema()`
  instead of embedding long source lists in every description.
- Tool descriptions should read like instructions to a new teammate: what the
  tool does, when to use it, what inputs are valid, and what to do after common
  failures.
- The production MCP endpoint remains remote and OAuth-protected, but MCP is a
  secondary direct-tool channel. The primary product entry point remains the
  ask-question agent path.

REST:

- REST callers can use the same contract through future `/api/knowledge/*`
  routes or through `/api/ask` indirectly.
- REST responses should use the same JSON shapes as MCP payloads.
- Old REST endpoints stay stable unless a later issue explicitly replaces them.

Claude SDK agent loop:

- Anthropic tool schemas should be generated from, or at least tested against,
  the same contract definitions used by MCP registration.
- `AGENT_SYSTEM_PROMPT` should stop listing tool order rules once the new tools
  are available.

Client context efficiency:

- Future MCP clients should load Squire tool definitions on demand when client
  tool search is available.
- Complex result filtering should happen in code when the caller has a code
  sandbox, with only the final relevant refs and snippets returned to model
  context.
- Squire may later ship a companion skill for MCP clients that explains common
  Frosthaven workflows, but the tool contract itself must stand without that
  skill.

## Shorter Prompt Target

Target prompt shape:

```text
You answer Frosthaven questions from Squire's knowledge sources.

Use the knowledge tools to inspect available sources, resolve user language into
canonical refs, open exact records, search broadly when the question is fuzzy,
and traverse related records when an opened entity points somewhere else.

Ground claims in retrieved data. Cite sources. Say when Squire does not have
enough information. Do not invent rules, stats, item numbers, or scenario text.
```

The prompt should not need to say:

- use `find_scenario` before `get_scenario`
- use `follow_links` after scenario conclusions
- use `search_rules` for fuzzy book questions
- use `list_card_types` before browsing card records
- use `get_card` only after discovering a source ID

Those behaviors should be implied by the contract:

- resolve before exact open
- open exact refs
- search fuzzy text
- traverse neighbors
- inspect schemas when unsure

## Eval Questions

These should pass without route-specific prompt instructions once SQR-117 and
SQR-118 implement the contract. The suite must include both training prompts
used during tool-description tuning and held-out prompts that are not inspected
until the contract is ready for removal of old prompt choreography.

1. "What sources can you inspect for Frosthaven, and which ones can you open
   exactly?"
2. "Show the section I should read at the conclusion of scenario 61."
3. "Starting from section 103.1, follow the next two read-now links and tell me
   where I end up."
4. "What does item 1 do, and what source ID did you use to open it?"
5. "What are the rules for Brittle? Quote or cite the source you used."
6. "Find Algox Archer records, then open the best matching monster stat record."
7. "What scenarios or sections are directly related to scenario 61?"
8. "I know there is a locked scenario from section 66.2. What scenario ref does
   that section unlock?"
9. "For scenario 61, find the conclusion section, open it, and list any
   scenarios or sections it unlocks or points to next."
10. "A player asks about Brittle during scenario 61. Answer the rule question,
    cite the rule source, and mention whether the scenario/section books were
    needed."
11. "Find the Algox Archer monster stat record, then search for any ability or
    card records that mention Algox Archer and explain which records are exact
    data versus fuzzy matches."
12. "Resolve section 67.1 in Frosthaven and then try the same bare legacy ref
    with an explicit Gloomhaven 2 game. The second path should reject or require
    a canonical game-qualified ref."

Passing behavior:

- The agent calls discovery or schema tools when it does not know the source
  shape.
- The agent resolves user language into refs before opening exact records.
- The agent traverses neighbor refs instead of guessing links from prose.
- Answers include citations or source labels.
- Ambiguous names produce candidates or a clarification, not a silent guess.

Evaluation harness requirements:

- Run these as programmatic agent loops against the actual tool schemas, not as
  static prompt snapshots.
- Track answer correctness, tool calls, tool errors, runtime, and token use.
- Keep a held-out set so tool descriptions are not tuned only to these exact
  prompts.
- Include multi-step tasks that need several calls; single-call toy prompts are
  not enough to prove the contract works.
- Run an A/B before prompt choreography is removed:
  - A: current production prompt and old tools
  - B: shortened prompt and new contract tools
- B must match or beat A on answer correctness for existing production evals and
  the SQR-116 held-out set.
- B may use fewer or different tool calls, but it must not increase median tool
  errors or p95 runtime by more than 25%.
- The eval report must name every regression and either fix it before migration
  or file a blocking follow-up issue.
- Include parity cases for the current rules evals, including the
  `rule-looting-definition` class of questions that previously caught repeated
  broad-search behavior.

## Implementation Notes For SQR-117 And SQR-118

- Put contract definitions in a shared module before wiring MCP or Anthropic
  schemas.
- Implement one ref parser from the grammar in this document. Do not parse refs
  separately in individual tools.
- Add ref parsing and normalization tests first, including path segments that
  contain colons and slashes from GHS source IDs.
- Test legacy ref compatibility separately from canonical ref behavior, and keep
  the legacy allowlist closed.
- Implement one active kind/relation registry behind `inspect_sources()` and
  `schema(kind)`. Do not duplicate closed kind or relation enums in each tool.
- Keep old tool handlers as private adapters until evals pass.
- Decide MCP projected names separately from internal agent tool names.
- Add `responseFormat`, `limit`, and actionable error hints before broadening
  the result payloads.
- Define the broad-search fan-out and latency tests before implementing
  `search_knowledge`.
- Add parity tests that old-tool-backed data and new-tool outputs agree for
  scenario 61, section 67.1, item 1, and a rulebook search hit.
- Add eval cases from this document to the eval suite before removing prompt
  choreography.
