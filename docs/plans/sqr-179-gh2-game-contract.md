# GH2 Game Contract

Finalized for Phase 2 implementation by SQR-178 and SQR-179.

This is the repo copy of the Gloomhaven (2nd Edition) contract. The Linear document is
useful for project planning, but implementation agents should be able to work
from checked-in context without depending on tracker history.

## Contract Status

This is the Phase 2 source of truth for GH2 naming, source boundaries,
canonical refs, and downstream adoption expectations. Later implementation
issues should treat these choices as fixed unless a new decision issue
explicitly changes the contract.

## Game IDs

| Meaning                                  | Canonical value | Notes                              |
| ---------------------------------------- | --------------- | ---------------------------------- |
| Frosthaven                               | `frosthaven`    | Existing value. Do not rename.     |
| Gloomhaven (2nd Edition) / Gloomhaven 2e | `gloomhaven-2e` | Canonical internal id for Phase 2. |

Use `gloomhaven-2e` everywhere Squire needs a stable machine id:

- database `game` values
- vector-store filters
- card, scenario, and section lookup filters
- canonical refs
- eval metadata
- Langfuse trace metadata
- LangSmith trace metadata
- API payloads
- local source metadata

## Accepted Aliases

Inputs may accept these aliases and normalize them to `gloomhaven-2e`:

- `gloomhaven-2e`
- `gloomhaven-2`
- `gloomhaven2`
- `gloomhaven 2`
- `gloomhaven 2.0`
- `gloomhaven second edition`
- `gloomhaven 2nd edition`
- `gh2`
- `gh2e`

`gh2e` is also the upstream Gloomhaven Secretariat folder name. It is not
Squire's canonical game id.

## Display Labels

Use these user-facing labels:

- `Frosthaven`
- `Gloomhaven (2nd Edition)`

Avoid showing `gloomhaven-2e`, `gloomhaven2`, or `gh2e` in ordinary UI copy.

## Source Naming

Recommended local source prefixes:

- `fh-*` maps to `frosthaven`.
- `gh2-*` maps to `gloomhaven-2e`.

Examples:

- `fh-rule-book.pdf`
- `gh2-rule-book.pdf`
- `gh2-faq.md`
- `gh2-errata.md`

The `gh2-*` prefix is intentionally short and file-friendly. Source metadata
should still carry `game: "gloomhaven-2e"`.

## Approved Phase 2 Source Inventory

Verified on 2026-05-22.

| Source                                | Approved Phase 2 use                                                                                                                                                                                | URL or local-source plan                                                                                                                                                                                                                                                                                                                                                 | Notes                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gloomhaven (2nd Edition) rulebook     | Ingest and cite as the primary printed-rules source.                                                                                                                                                | Source URL: [Cephalofair Gloomhaven page](https://cephalofair.com/pages/gloomhaven). Direct file linked there as [Read the Gloomhaven Rulebook](https://drive.google.com/file/d/16TmmCKa6zVVObj2qM-vIj9RcEAC3nfMT/view?usp=sharing). Local source: `gh2-rule-book.pdf`.                                                                                                  | Source metadata should include source type `rulebook`, game `gloomhaven-2e`, source URL, captured-at timestamp, and refresh notes.                                                                                                                                                                                 |
| Official Gloomhaven (2nd Edition) FAQ | Ingest and cite as the current-rulings source.                                                                                                                                                      | Source URL: [Gloomhaven: Second Edition FAQ](https://cephalofairgames.github.io/gloomhaven2e-faq/). Local source: `gh2-faq.md` or an equivalent normalized HTML/Markdown snapshot.                                                                                                                                                                                       | The page identifies itself as the official FAQ and showed `Last Updated 2026-04-19` at verification time. It also states that the document may not be used for model/LLM training. Phase 2 approval is for retrieval/citation indexing only, not fine-tuning or model training.                                    |
| Official errata                       | Ingest and cite as current-rule corrections.                                                                                                                                                        | Source URLs: [Gloomhaven: Second Edition FAQ](https://cephalofairgames.github.io/gloomhaven2e-faq/) section `1.0 Errata`; [Cephalofair Gloomhaven page](https://cephalofair.com/pages/gloomhaven) section `Major Errata`. Local source: `gh2-errata.md` derived from the official FAQ errata section, with the Cephalofair page used as corroborating discovery/summary. | No separate errata PDF was linked from the verified official page. Treat the FAQ errata section as the authoritative ingest target unless a later official errata file appears.                                                                                                                                    |
| Gloomhaven Secretariat `data/gh2e`    | Ingest as structured helper data for cards, monsters, scenarios, sections, events, items, personal quests, treasures, battle goals, labels, and campaign metadata where Phase 2 needs table lookup. | Source URL: [Lurkars/gloomhavensecretariat `data/gh2e`](https://github.com/Lurkars/gloomhavensecretariat/tree/main/data/gh2e). Local source prefix: `gh2-ghs-*` or source records tagged with upstream folder `gh2e` and game `gloomhaven-2e`.                                                                                                                           | This is not the official rules authority. Use it for structured lookup and link-following. Verified folder entries include `character`, `label`, `monster`, `scenarios`, `sections`, `base.json`, `battle-goals.json`, `campaign.json`, `events.json`, `items.json`, `personal-quests.json`, and `treasures.json`. |

## GH2 Scenario and Section Strategy

Use a hybrid strategy: GHS structured data is the Phase 2 table-lookup source,
while official sources remain the authority for rules prose, citations, and
corrections.

### What Ships In Phase 2

- GH2 `findScenario`, `getScenario`, `getSection`, and `followLinks` reuse the
  existing deterministic scenario/section tables and tool contracts, scoped by
  `game: "gloomhaven-2e"`.
- GH2 table lookup is seeded from Gloomhaven Secretariat `data/gh2e/scenarios`
  and `data/gh2e/sections` because no public official scenario book or section
  book PDF was found on the Cephalofair Gloomhaven page during SQR-176.
- Implementation should add a GHS-to-scenario-section extract path rather than
  forcing the current Frosthaven-only PDF parser to handle GH2 without official
  PDFs.
- The seed path should become game-aware: `frosthaven` keeps the existing
  PDF-derived extract, and `gloomhaven-2e` uses the GH2 extract.
  Replace-by-game seed semantics are still correct.
- Canonical public refs use `scenario:gloomhaven-2e/061` and
  `section:gloomhaven-2e/67.1`. Storage/source ids may preserve GHS ids such as
  `gloomhavensecretariat:scenario/061` and upstream section ids, as long as the
  tool surface returns canonical game-qualified refs.

### GHS Mapping Expectations

- Scenario records should map `index`, `name`, `flowChartGroup`, `unlocks`,
  `forcedLinks`, `monsters`, `objectives`, `rules`, and `rooms` into the
  existing scenario record plus metadata shape.
- Section records should map `index`, `name`, `parent`, `monsters`,
  `objectives`, `rules`, and `rooms` into the existing section record plus
  metadata shape.
- Scenario unlocks and forced links should become `book_references` where their
  meaning is clear. Suggested mapping: `unlocks` to `unlock`; `forcedLinks` to
  `section_link` or a better documented mapping if implementation confirms a
  more precise GHS meaning.
- Section `parent` relationships should create traversable relationships
  between the parent scenario and section. Use `section_link` unless the source
  gives enough context to classify the edge as `conclusion`, `read_now`, or
  `unlock`.
- Missing source-page fields are acceptable for GHS-derived records. Use source
  locator metadata such as upstream file path and source URL instead.

### Source Precedence

When sources overlap:

1. Official FAQ/errata wins for current-rule corrections.
2. Official scenario/section PDFs or other official files win for printed
   prose, section text, page locators, and citations if they are later provided.
3. GHS structured data wins for machine-readable scenario setup, room contents,
   monsters, objectives, unlock ids, and relationship scaffolding unless
   official errata contradicts it.
4. If official text and GHS structure disagree, answers should cite the
   official source and use GHS only as a lookup hint until the discrepancy is
   resolved.

### Unsupported Behavior Until Official Scenario/Section Sources Exist

- Squire should not claim it can quote or reproduce full GH2 scenario-book or
  section-book prose unless official scenario/section source files are supplied
  and ingested.
- `getSection` may return a structured section record, title/name, parent
  scenario, setup metadata, and source locator from GHS. It must not invent
  narrative text.
- Questions that ask for full section text, story text, conclusions, or flavor
  prose should get a clear unsupported-source answer plus the section/scenario
  locator when possible.
- Page-number citations for GH2 scenario/section records are unsupported until
  official page-bearing files are available.
- Bare legacy scenario/section refs remain Frosthaven-only until the caller
  supplies an explicit active game or the UI/runtime game routing work is
  complete.

## Source Refs And Canonical Refs

Canonical refs should use the canonical game id, not an alias.

Examples:

- `source:gloomhaven-2e/rulebook`
- `source:gloomhaven-2e/faq`
- `source:gloomhaven-2e/errata`
- `rules:gloomhaven-2e/gh2-rule-book.pdf#chunk=42`
- `scenario:gloomhaven-2e/001`
- `section:gloomhaven-2e/67.1`
- `card:gloomhaven-2e/items/gloomhavensecretariat:item/1`

Existing Frosthaven refs keep using `frosthaven`:

- `source:frosthaven/rulebook`
- `scenario:frosthaven/061`
- `section:frosthaven/67.1`

Bare legacy scenario/section refs remain Frosthaven-only until a caller supplies
an explicit active game.

## Source-Use Constraints

- Phase 2 source ingestion means retrieval/citation indexing for Squire answers
  and evals. It does not approve fine-tuning, model training, or use of source
  text as a training corpus.
- The FAQ source must carry a usage note because the official FAQ page denies
  permission for AI/LLM training.
- If implementation work concludes that vector indexing falls under a source's
  prohibited use language, the adapter should stop at source metadata plus URL
  citation until permission or a different source plan is resolved.
- All source records should retain URL, captured-at timestamp, source type, game
  id, and refresh notes.

## Downstream Contract Checklist

Use this checklist in implementation issue comments, PR descriptions, and
project closeout. A later issue does not need to satisfy every row; it should
name the row or rows it adopts.

| Checklist item                                                                                                                  | Expected proof                                                                                                                                        | Primary project owners                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Storage supports `gloomhaven-2e` without renaming `frosthaven`.                                                                 | Shared game id helper or schema path accepts `gloomhaven-2e`; unsupported ids fail clearly.                                                           | GH2 Game-Aware Data Foundation                                                                         |
| Alias parsing normalizes accepted GH2 aliases to `gloomhaven-2e`.                                                               | Tests cover `gh2`, `gh2e`, `gloomhaven-2`, `gloomhaven2`, `gloomhaven 2.0`, and second-edition variants.                                              | GH2 Game-Aware Data Foundation; Active Game UX and Runtime Routing                                     |
| Source metadata preserves game, source type, source URL, captured-at timestamp, and refresh notes.                              | GH2 rulebook/FAQ/errata/GHS records expose the metadata through source inspection or stored records.                                                  | GH2 Rules, FAQ, and Errata Corpus; GH2 GHS Structured Data Import                                      |
| Indexer assigns GH2 rules sources to `game: "gloomhaven-2e"`.                                                                   | Reindexing creates GH2 rulebook/FAQ/errata embeddings under the GH2 game id.                                                                          | GH2 Rules, FAQ, and Errata Corpus                                                                      |
| Vector search isolates Frosthaven and GH2.                                                                                      | Tests prove GH2 queries do not return Frosthaven passages unless the caller explicitly asks for a comparison.                                         | GH2 Game-Aware Data Foundation; GH2 Eval Suites and Trace Organization                                 |
| FAQ/errata are preferred for current-rule corrections.                                                                          | A GH2 FAQ- or errata-sensitive question cites FAQ/errata instead of relying only on printed rulebook text.                                            | GH2 Rules, FAQ, and Errata Corpus; GH2 Eval Suites and Trace Organization                              |
| GHS `data/gh2e` imports without changing Frosthaven import behavior.                                                            | Importer tests cover GH2 rows and existing Frosthaven parity tests still pass.                                                                        | GH2 GHS Structured Data Import                                                                         |
| GH2 scenario/section lookup uses deterministic tables under `game: "gloomhaven-2e"`.                                            | `findScenario`, `getScenario`, `getSection`, and `followLinks` work for GH2 refs backed by GHS structured data.                                       | GH2 GHS Structured Data Import; GH2 Game-Aware Data Foundation                                         |
| GH2 unsupported prose behavior is explicit.                                                                                     | Full section/story/conclusion prose requests return a clear unsupported-source answer plus locator when official prose is unavailable.                | GH2 GHS Structured Data Import; Active Game UX and Runtime Routing                                     |
| Canonical refs use `gloomhaven-2e`, not aliases.                                                                                | Expected outputs and API/tool responses use refs like `scenario:gloomhaven-2e/061`, `section:gloomhaven-2e/67.1`, and `card:gloomhaven-2e/items/...`. | GH2 Game-Aware Data Foundation; GH2 GHS Structured Data Import; GH2 Eval Suites and Trace Organization |
| UI shows `Gloomhaven (2nd Edition)` and hides internal ids.                                                                     | Game selector/runtime UI uses user-facing copy only.                                                                                                  | Active Game UX and Runtime Routing                                                                     |
| Runtime passes active game into chat/tool execution.                                                                            | GH2 chat turns route rules, cards, scenarios, sections, and eval traces with active game metadata.                                                    | Active Game UX and Runtime Routing; GH2 Game-Aware Data Foundation                                     |
| Evals include GH2 metadata and wrong-game boundary coverage.                                                                    | GH2 eval cases match Frosthaven breadth and include leakage checks.                                                                                   | GH2 Eval Suites and Trace Organization                                                                 |
| Langfuse traces include active game, source ids, source types, and canonical refs.                                              | Langfuse trace inspection can filter/debug GH2 runs by game/source/ref.                                                                               | GH2 Eval Suites and Trace Organization                                                                 |
| LangSmith traces include active game, source ids, source types, and canonical refs, unless main never landed LangSmith support. | LangSmith trace inspection can filter/debug GH2 runs by game/source/ref, or the issue records that LangSmith is not present on main.                  | GH2 Eval Suites and Trace Organization                                                                 |
| Docs explain source refresh and local commands.                                                                                 | Development or release docs list GH2 source inventory, reindexing, and seed commands.                                                                 | GH2 Production Refresh, Docs, and Table Readiness                                                      |
| Production refresh runs GH2 and Frosthaven data paths separately.                                                               | Refresh/check scripts prove GH2 rules, FAQ, errata, GHS structured lookup, game routing, and eval trace organization.                                 | GH2 Production Refresh, Docs, and Table Readiness                                                      |

## Project-To-Checklist Map

- GH2 Game-Aware Data Foundation: storage, alias parsing, source prefix
  derivation, vector isolation, canonical refs, active-game plumbing.
- GH2 Rules, FAQ, and Errata Corpus: official source ingestion, source metadata,
  vector indexing, FAQ/errata precedence, citation behavior.
- GH2 GHS Structured Data Import: `data/gh2e` importers, card/scenario/section
  structured lookup, GHS metadata preservation, unsupported prose behavior.
- Active Game UX and Runtime Routing: user-facing labels, active-game selector,
  chat/runtime routing, mixed-game guardrails.
- GH2 Eval Suites and Trace Organization: GH2 metadata, wrong-game evals,
  Langfuse organization, LangSmith organization, final table-readiness
  thresholds.
- GH2 Production Refresh, Docs, and Table Readiness: documented refresh
  commands, production reindex/reseed path, readiness checks, operator handoff.

## Out Of Scope For Phase 2

- Campaign tracking.
- Character-state sync.
- Recommendations.
- Original Gloomhaven, Jaws of the Lion, Forgotten Circles, Crimson Scales, and
  other editions.
- Community or unofficial FAQs, forum threads, Discord answers, Reddit posts,
  BoardGameGeek posts, house rules, build guides, strategy guides, and spoiler
  campaign-state exports.
- Storyline or companion-app campaign state as an ingestion source.
- Puzzle-book solution ingestion unless a later issue explicitly scopes it. The
  official hint guide is linked for reference only in Phase 2.
- Campaign sheet, component list, and crossover character sheets as ingestion
  sources unless a later issue explicitly scopes them.
