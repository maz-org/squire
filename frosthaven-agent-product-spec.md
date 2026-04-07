# Squire — Frosthaven Knowledge Agent Product Specification

**Version:** 2.1
**Date:** 2026-04-07
**Last Refreshed:** 2026-04-07
**Status:** Phase 1 in progress, MVP scoped. GH2 content expansion (Phase 2) deadline ~mid-2026.

## Executive Summary

Squire is a deep game-knowledge agent for Gloomhaven and Frosthaven. It answers rules questions, looks up cards, items, monsters, and scenarios, and (longer term) makes personalized recommendations for character building, inventory, and gameplay strategy.

Squire is **the agent**, not a specific app. It's reachable through multiple **channels** — primarily its own web UI today, with MCP-capable agent harnesses (Claude Code, Claude Desktop) as a second channel, and Discord / iMessage clients planned for the far future. All channels talk to the same underlying knowledge agent.

**MVP (Phase 1):** A mobile-friendly web chat where Brian can pull out his phone at the table, log in with Google, and ask any Frosthaven rules question. Hosted publicly behind Cloudflare WAF. The agent answers using a rulebook RAG pipeline and a generalized atomic-tools API over Gloomhaven Secretariat (GHS) structured game data.

**Long-term product (Phases 2–6):** Multiplayer campaign and character state, the recommendation engine (card selection at level-up, inventory optimization, pre-combat hand selection, long-term build planning), character state ingestion from frosthaven-storyline.com, build guide integration, and polish (voice input, share/export, additional channels).

**Primary Use Cases:**

- **Rules lookup and clarification** (MVP — at the table, on a phone)
- Card, item, monster, and scenario lookup (MVP)
- Card selection when leveling up (future)
- Inventory optimization (future)
- Pre-combat hand selection (future)
- Long-term build planning (future)
- Scenario and event guidance (future)

**Target User (MVP):** Brian, sitting at the table mid-session, pulling out a phone or iPad to check a rule without breaking flow. Text input only — voice handled externally via iOS speech-to-text apps like Monologue. Future channels and users come later.

---

## Core Features

### 1. Card Selection Recommendations

**When:** Character levels up and must choose between two new cards

**Requirements:**

- Fetch character's current level, class, and existing cards from frosthaven-storyline.com
- Query worldhaven database for available cards at new level
- Identify which build guide (if any) user is following
- Analyze synergy with existing cards and build direction
- Present recommendation with:
  - Card images (both options)
  - Side-by-side comparison table (stats, effects, synergies)
  - Natural language explanation of pros/cons
  - Explicit recommendation with reasoning

**Build Guide Integration:**

- Maintain curated list of popular class guides from r/Gloomhaven community
- Agent fetches guides on-demand using web search/fetch capabilities
- No parsing or pre-processing required - Claude reads guides directly
- Track which guide user is following (inferred from choices)
- Remember deviations from guide and understand user intentions
- Provide recommendations that align with chosen build path OR explain alternative paths

### 2. Inventory Optimization

**When:** User has gold to spend, unlocks new prosperity, or questions current items

**Requirements:**

- Comprehensive inventory advice covering:
  1. Items that synergize with current build
  2. Best purchases for current gold and prosperity level
  3. Long-term items to save for at higher prosperity
  4. Suggestions to sell/replace outdated items
- Access to all available items from worldhaven database
- Filter by user's current prosperity and gold
- Consider item slots and current equipment
- Show item images and detailed stats
- Explain why each item helps the build

### 3. Pre-Combat Hand Selection

**When:** Before entering a scenario/battle

**Requirements:**

- User describes scenario type (boss, mob-heavy, etc.)
- Agent recommends which cards to bring from available deck
- Consider:
  - Scenario requirements (AOE, single-target, mobility, etc.)
  - Party composition (what teammates are bringing)
  - Build guide recommendations for combat
- Present optimal hand with reasoning
- NOT turn-by-turn advice during combat

### 4. Rules Lookup & Clarification

**When:** Mid-game rules questions

**Requirements:**

- RAG system over Frosthaven rulebook
- Fast semantic search for rules queries
- Return relevant rule sections with page references
- Handle ambiguous questions with clarifying questions
- Provide examples when helpful

### 5. Long-Term Build Planning

**When:** Planning character progression

**Requirements:**

- Show recommended card picks from current level to level 9
- Identify key cards to work toward
- Explain build philosophy and synergies
- Suggest alternative branches if user wants different playstyle
- Update plan based on cards already chosen

### 6. Scenario & Event Guidance

**When:** Encountering scenario choices or campaign events

**Requirements:**

- Provide context on event outcomes (where appropriate)
- Suggest optimal choices based on campaign goals
- Respect spoiler protection (see below)
- Help with scenario setup questions

---

## Character State Management

Squire's MVP (Phase 1) does not track any character or campaign state. The agent answers rules questions using a generalized knowledge layer over the rulebook RAG and GHS static game data.

Character and campaign state lands in **Phase 4 (Campaign & character state)** with a Postgres data model and manual entry. **Phase 6 (Character state ingestion)** adds automated state ingestion from a third-party source — see that phase for the five ingestion options under consideration (browser extension, JSON export, sync protocol, Claude Vision on screenshots, or reading directly from a campaign tracker like GHS).

### Data Sources (current)

- **Static game data:** Gloomhaven Secretariat (GHS) structured data — see Data Architecture section. Imported via dedicated `src/import-*.ts` scripts.
- **Rulebook:** the official Frosthaven rulebook PDF, chunked and embedded into pgvector for retrieval. Gloomhaven 2.0 rulebook ingestion lands in Phase 2.

### Data Sources (future, by phase)

- **User's character and campaign state** (Phase 4 manual entry, Phase 6 automated ingestion): character class, level, XP, gold, owned/active cards, items, prosperity, campaign progress, party composition. Source TBD per Phase 6.
- **Community build guides** (Phase 5 with the recommendation engine): curated URL list, agent fetches on-demand, no pre-parsing.

### Multiple Characters

A user may have multiple characters across multiple campaigns. From Phase 4 onward, Squire models character ↔ user ↔ campaign relationships explicitly. The agent infers which character a question is about from conversation context (e.g., "my Drifter just hit level 4" → check the user's Drifter). Explicit character switching is available when ambiguous.

---

## User Interface & Experience

### Platform

Mobile-responsive web app, server-rendered (Hono JSX + HTMX + Tailwind via CDN). Accessible via any modern mobile or desktop browser. No app installation, no PWA, no service worker.

### Input Methods

**Phase 1 MVP:** text input only. Brian uses iOS speech-to-text apps like Monologue externally when he wants to talk instead of type — no native voice input is wired up.

**Phase 7 (Polish):** Web Speech API voice input lands as a Phase 7 enhancement, Chrome-first with progressive enhancement and graceful fallback to text. Voice is one input *method* within the web channel, not a separate product surface.

### Output Format

**Phase 1 MVP:** conversational text answers with source citations and visible tool calls. The agent shows what it's looking up (no silent actions) and links every claim back to its source.

**Future phases:** as the recommendation engine (Phase 5) lands, output expands to include card and item images, side-by-side comparison tables, and explicit recommendations with reasoning. These are not part of MVP.

### Agent Persona

Functional assistant — clear, concise, professional. Focus on data and actionable answers. No roleplay, no fluff. Optimized for mobile reading at the table.

### Conversation Flow

Context-aware chat with bounded conversation history (older messages summarized to keep the context window from growing unbounded). Within a session, the agent remembers what's been asked and answered. Cross-session memory of decisions and context arrives with campaign state in Phase 4.

---

## Non-Functional Requirements

### Spoiler Protection

**Status:** deferred to post-MVP.

Phase 1 displays a clear warning: "This tool may contain spoilers for Frosthaven (and Gloomhaven 2.0) content including locked classes, scenarios, and events." Users self-regulate what they ask. This dramatically reduces MVP complexity and lets development effort focus on core features.

If user feedback indicates spoiler protection is valuable, it can be added in Phase 7 (Polish) once campaign state is available to drive filtering. The data model already exists from Phase 4 (campaign progress, prosperity, completed scenarios).

### Share & Export

Phase 7 (Polish) adds shareable links to specific recommendations and PDF/markdown export. Not part of MVP. See the Phases section for details.

### Offline Capability

Squire is an online-only web app. No PWA, no service worker, no offline mode, no client-side storage. Earlier versions of the spec called for these and they were removed in v2.0 — they don't fit a server-rendered Hono stack and the use case (rules Q&A at the table over Wi-Fi or cellular) doesn't justify the engineering cost.

---

## Technical Architecture

### Stack

**Language:** TypeScript end-to-end. Node 24, ESM modules.

**Web channel (frontend + server):**

- **Server framework:** Hono (`@hono/node-server`)
- **UI rendering:** Hono JSX (server-rendered) + HTMX for interactivity + Tailwind CSS via CDN
- **Build pipeline:** none — no bundler, no client-side build step

  *Rationale: chosen to keep the stack simple and lightweight — single language end-to-end, no bundler, no client build step. Secondary goal: learn new application tech (already deeply familiar with React SPAs).*

**Database:**

- **Primary DB:** PostgreSQL (planned — currently flat JSON files)
- **Vector DB:** pgvector extension on the same Postgres instance
- **ORM:** Drizzle

  *Rationale for Drizzle: first-class pgvector support (Prisma's is preview-only and forces raw SQL fallbacks), TypeScript-native schema (no DSL, no codegen step — fits the no-build-step theme), lightweight runtime, generates readable SQL. drizzle-kit handles migrations.*

**Embeddings:**

- **Current:** `@xenova/transformers` running in-process. Model `Xenova/all-MiniLM-L6-v2` (384 dimensions, mean-pooled, normalized). See `src/embedder.ts`.

  *Rationale: chosen for simplicity getting started — no API key, no network roundtrip during indexing, no per-token cost.*

- **Upgrade path:** if retrieval quality doesn't hold up at production scale, swap to **Voyage AI** (purpose-built for retrieval, strong benchmark performance, integrates cleanly with Anthropic-based stacks). The vector store (pgvector) is independent and doesn't change.

  *Note: embedding model and vector store are two independent choices that can evolve separately.*

**LLM:**

- **Provider:** Anthropic Claude API (`@anthropic-ai/sdk`)
- **Current model:** Claude Sonnet 4.6 (`claude-sonnet-4-6`) — single-model setup. See `src/agent.ts:155`.
- **Future tiering** (when justified by cost or quality):
  - Sonnet 4.6 — default agent loop
  - Haiku 4.5 — cheap/fast cases (simple lookups, classification)
  - Opus 4.6 — complex reasoning only when Sonnet falls short
- **Capabilities used:** long context, tool use, structured JSON output. Vision is reserved for the future character-state ingestion path (Phase 6) and is not part of the current architecture.

**Document parsing:**

- **Rulebook ingestion:** `pdf-parse` for the Frosthaven rulebook PDF, chunked and embedded into pgvector

**Authentication:**

- **Approach:** custom Hono middleware. Google OAuth as the only identity provider (extends the existing OAuth infrastructure already built for the MCP layer). Server-side sessions stored in Postgres. HttpOnly + Secure + SameSite=Strict cookies. CSRF tokens for mutating endpoints.

  *Rationale: avoid SaaS vendor dependency in the auth path, no per-MAU pricing, reuses code that already exists for MCP. Single IdP keeps the surface area tiny.*

**Edge layer:**

- **Cloudflare** in front of the hosted app as a WAF. Provides DDoS protection, edge rate limiting, and bot mitigation. Application-level rate limiting on expensive endpoints (`/api/ask`, `/mcp`) still lives in-app for per-user cost budgets.

### Data Architecture

**Static Game Data — Gloomhaven Secretariat (GHS):**

Squire imports static game data directly from **Gloomhaven Secretariat (GHS)** — an open-source Gloomhaven/Frosthaven companion app maintained by Lurkars on GitHub: <https://github.com/Lurkars/gloomhavensecretariat>. GHS maintains structured data in its `data/` subfolder, community-maintained and auto-formatted on commit.

Squire has dedicated import scripts in `src/import-*.ts` for each card type:

- `import-battle-goals.ts`
- `import-buildings.ts`
- `import-character-abilities.ts`
- `import-character-mats.ts`
- `import-events.ts`
- `import-items.ts`
- `import-monster-abilities.ts`
- `import-monster-stats.ts`
- `import-personal-quests.ts`
- `import-scenarios.ts`

GHS is comprehensive enough for Phase 1 (rules Q&A) and most of the long-term recommendation engine. If gaps emerge later, the plan is:

1. First, contribute upstream to GHS to fill the gap
2. Failing that, spin up an OCR pipeline as a last resort

*Historical note: an earlier version of Squire used the worldhaven repository plus an OCR pipeline. Both were retired (commit `34a26a1`) once GHS proved sufficient.*

**Rules Database:**

- Extract text from the Frosthaven rulebook PDF using `pdf-parse`
- Chunk into semantic sections (`src/index-docs.ts`)
- Generate embeddings via the local Xenova model (see Embeddings in Stack)
- Store in pgvector
- RAG retrieval via `searchRules()` (see Agent Architecture)

**Character State:** *Phase 6 / future. See "Character State Ingestion" in the Phases section.*

**Build Guides:** *Phase 5 / future. See "Recommendation Engine" in the Phases section.*

**User Conversations:**

- Store conversation history in Postgres, scoped to user
- Bounded context window via summarization of older messages
- Used as context for future turns

### Agent Architecture

**Core Agent Loop:**

1. **Input:** User message (text)
2. **Context Gathering:** Load conversation history (with bounded summarization), identify caller identity from session
3. **Tool Use:** Claude calls atomic tools (see below) to retrieve relevant rules, cards, items, monsters, or scenarios
4. **Reasoning:** Claude synthesizes a response from tool results
5. **Response:** Stream back to the channel (web UI via SSE, MCP via protocol response)
6. **Memory:** Persist conversation turn for future context

**Atomic Tools (current — `src/tools.ts`):**

Squire exposes a **generalized atomic-tools API** that works across all GHS card types — monsters, items, events, buildings, scenarios, character abilities, character mats, battle goals, personal quests. The same handful of tools handle every card type via parameter, rather than one tool per feature.

| Tool | Purpose |
| --- | --- |
| `searchRules(query, topK)` | Vector search over the rulebook RAG index |
| `searchCards(query, topK)` | Keyword search across all card types |
| `listCardTypes()` | Discovery — returns all GHS data types with record counts |
| `listCards(type, filter)` | List records of a given type with field-level AND filter |
| `getCard(type, id)` | Exact lookup by natural ID (name, number, cardId, etc.) |

**Generalization principle:** per-feature operations are *invocations*, not new tools. For example, "show me all level-4 character abilities for Drifter" is `listCards('character-abilities', { class: 'drifter', level: 4 })` — not a dedicated `queryCards()` tool. This keeps the tool surface tiny and the agent's choices simple.

**Future tools** (added as later phases land):

- `getCharacterState(characterId)` — Phase 4, campaign state
- `getPartyInfo(campaignId)` — Phase 4, campaign state
- `fetchBuildGuide(url)` — Phase 5, recommendation engine
- `extractCharacterFromScreenshots(images[])` — Phase 6, character state ingestion (only if the screenshot path is chosen over the browser-extension or GHS-as-tracker alternatives)

**Implementation:**

- Each tool is a TypeScript function in `src/tools.ts`
- Queries the in-memory data layer today, Postgres + pgvector after the storage migration
- Returns structured JSON to Claude
- Claude decides which tools to call and interprets results

### MCP Server

Squire exposes its atomic knowledge tools via the **Model Context Protocol** over a `/mcp` endpoint (`src/mcp.ts`). This makes Squire's Frosthaven knowledge accessible to any MCP-capable agent harness — Claude Code, Claude Desktop, or other AI tools — without going through Squire's own conversation UI.

**Use cases:**

- Brian uses Claude Code with Squire's MCP tools mounted to ask rules questions during development
- Future end users may opt to mount Squire as an MCP server in their own agent of choice (treated like a public API surface, with auth)
- Other AI tools in the *haven ecosystem could compose Squire's knowledge tools into larger workflows

**Architectural note:** an earlier design considered using internal MCP between Squire's own conversation agent and a separate knowledge agent. That split has been dropped for simplicity — Squire's conversation agent calls the atomic tools directly (in-process), and MCP is purely an external surface for other agents.

**Auth on `/mcp`:** the same OAuth infrastructure used by the web channel protects the MCP endpoint. No anonymous access in production.

**Channel framing:** MCP-capable agents are a **third channel type** alongside the web UI (primary today) and future Discord/iMessage clients. All channels talk to the same underlying knowledge agent.

### Observability

Squire emits OpenTelemetry traces from the agent loop, tool calls, and HTTP handlers via `@opentelemetry/sdk-node`. Initialization lives in `src/instrumentation.ts`.

**LLM observability and evals: Langfuse.** Trace exports flow into Langfuse via `@langfuse/otel` and `@langfuse/tracing`, where each conversation, tool call, and model call is captured as a structured trace. Langfuse's built-in LLM-as-judge eval templates grade production traces (planned). Langfuse was chosen specifically for its eval system, which is more capable than alternatives for LLM-as-judge workflows.

**APM and RUM: open.** General application metrics (request latency, error rates, DB query performance) and real-user monitoring on the web channel are not yet wired up. **Datadog** is a candidate one-stop shop for both, but a previous evaluation found that Datadog's LLM observability API has limitations that make Langfuse a better fit for evals — so even if Datadog is adopted for APM/RUM, Langfuse stays for LLM-specific observability.

### Deployment

**Hosting (open, decision deferred):**

- **Fly.io** — VM-based, global regions, good Postgres story (Fly Postgres), Docker-native
- **Railway** — simple deploys from a Dockerfile, included Postgres add-on, $5/mo hobby tier
- **Render** — managed services + Postgres, similar to Railway, free tier for hobby
- **Self-hosted VPS** (Hetzner, DigitalOcean) — most control, most ops work

All four work with the Docker-first deployment plan. Cloudflare WAF sits in front regardless of host choice.

**Estimated monthly cost (Phase 1 MVP):**

- Hosting: $0–10 (free tiers on Fly/Railway/Render, or hobby plan)
- Postgres: $0–10 (included in host's free tier or hobby add-on)
- Cloudflare WAF: $0 (free tier)
- Claude API (Sonnet 4.6): ~$10–30 depending on chat volume
- **Total: ~$10–50/month** for a single user with moderate usage

Vision API costs (~$0.15–0.30 per character sync) are deferred to Phase 6 when screenshot extraction lands, and only apply if that path is chosen over the browser-extension or GHS-as-tracker alternatives.

**CI/CD:**

- GitHub repository
- Automatic deploys on push to main (Vercel/Railway integration)
- Staging environment for testing

---

## Development Phases

The phases below reflect the **resequenced plan** as of the 2026-04-07 spec refresh. The original spec was organized around the recommendation engine as the centerpiece. The new sequencing puts **rules Q&A at the table** as MVP and treats character state, recommendations, and channel expansion as later phases.

---

### Phase 1: MVP — Rules Q&A at the table

**Goal:** Brian can pull out his phone at the table, log in with Google, and ask Squire any Frosthaven rules question via a mobile-friendly web chat. Hosted publicly behind Cloudflare WAF.

**Status as of 2026-04-07:** rules RAG pipeline, GHS imports, atomic tools, MCP server, and Discord-callable query are all built. The main remaining work is the web channel + auth + deployment.

**Tasks:**

- Hono JSX + HTMX web chat UI (mobile-friendly, no SPA, no build step)
- Streaming responses via Server-Sent Events
- Tool call visibility in the UI (no silent actions)
- Source citations under each answer
- Google OAuth web login (extends existing MCP OAuth infrastructure)
- Server-side sessions in Postgres
- CSRF protection on mutating endpoints
- Storage migration: flat files → Postgres + pgvector
- Drizzle schema and migrations (`drizzle-kit`)
- Docker containerization
- CI/CD pipeline
- Production health checks and readiness
- Cloudflare WAF in front of the deployed app
- Hosting platform decision (Fly / Railway / Render / VPS)

**Out of scope for Phase 1:**

- Voice input (Brian uses iOS Monologue externally for speech-to-text)
- Multi-user (single user, but auth is real so it's not bypassable)
- Any campaign or character state
- Any recommendations beyond rules answers
- Discord, iMessage, or other channels beyond the web UI and MCP

**Deliverable:** Brian can pull out his phone at the table, log in with Google, and ask Squire any Frosthaven rules question via a mobile-friendly web chat. The agent answers using the rulebook RAG pipeline and the GHS atomic tools (`searchRules`, `searchCards`, `listCards`, `getCard`). Hosted publicly behind Cloudflare WAF. Test suite passing.

---

### Phase 2: Gloomhaven 2.0 content expansion

**Goal:** Brian can pull out his phone at the GH2 table the day his group transitions and Squire works for the new game.

**Deadline-driven:** Brian's group has roughly 3–4 months left in their Frosthaven campaign before transitioning to Gloomhaven 2.0 (~mid-2026). Squire needs to be useful at the GH2 table when that happens. This is the only phase in the plan with a hard external deadline, which is why it sits right after MVP and ahead of multi-user.

**Tasks:**

- Ingest the Gloomhaven 2.0 rulebook PDFs into `data/pdfs/` and reindex (`npm run index`)
- Add GH2 data import scripts mirroring the existing GHS Frosthaven imports (`import-character-abilities.ts`, `import-items.ts`, `import-monster-stats.ts`, etc.). Gloomhaven Secretariat already supports Gloomhaven 2nd Edition, so the import path is unblocked.
- **Add a `game` dimension to the data layer** so the agent doesn't mix Frosthaven and GH2 rules in the same answer:
  - Tag each card record with a `game` field (`'frosthaven' | 'gloomhaven-2'`)
  - Rule chunks are already implicitly tagged via filename prefix (`fh-rule-book.pdf` vs `gh2-rule-book.pdf` etc.)
  - Atomic tools accept an optional `game` filter parameter
- Update the agent system prompt to know which game the user is asking about (per-session game selector for MVP; inferred from campaign once Phase 4 lands)
- Smoke test: ask both a Frosthaven and a Gloomhaven 2.0 rules question in the same session and verify no cross-contamination

**Risks:**

- **frosthaven-storyline.com may not support Gloomhaven 2.0.** Brian uses storyline as his canonical campaign tracker for Frosthaven today. If storyline doesn't support GH2 by transition time, his current campaign-tracking workflow breaks for the new game and the future Phase 6 ingestion path needs to be re-evaluated for GH2 specifically. Mitigation: confirm storyline GH2 support before this phase begins; if absent, consider switching campaign management to GHS itself for the GH2 campaign (GHS is also a campaign tracker, not just a data source — see Phase 6 ingestion options).
- **Action item for Brian:** before this phase begins, verify that frosthaven-storyline.com (or its successor) supports Gloomhaven 2nd Edition. If not, plan the GH2 campaign-tracking workflow accordingly.

**Out of scope:** original Gloomhaven (1st Edition), Jaws of the Lion, Crimson Scales, Forgotten Circles. Those stay in Future Enhancements.

**Deliverable:** When Brian's group sits down for their first Gloomhaven 2.0 scenario, Squire answers GH2 rules questions correctly, never mixes them up with Frosthaven rules, and works from the same phone-at-the-table workflow as the MVP.

---

### Phase 3: Multi-user platform

**Goal:** Other people can use Squire without stepping on each other.

**Tasks:**

- Production hardening: rate limiting (per-user, on top of Cloudflare edge rate limiting)
- Daily LLM cost budget with circuit breaker
- Prompt injection resistance test suite (E2E, daily CI)
- SAST scanning (Semgrep / CodeQL free tier)
- Langfuse eval templates wired to production traces
- Browser E2E tests for web UI user journeys (Playwright)
- REST API integration tests (daily CI with real Claude API, LLM-as-judge)

**Deliverable:** Squire is safe to share. Multiple users can sign in, ask rules questions, and not interfere with each other. Costs are bounded.

---

### Phase 4: Campaign & character state

**Goal:** Squire knows who you are, what your party looks like, and what character you're playing.

**Tasks:**

- Postgres data model for campaigns and players
- Identity propagation via request context (caller identity from session/OAuth token)
- **Data isolation design (must come first):** the player entity enforces campaign membership on every request; the agent's LLM context is scoped to the requesting player's data plus shared campaign state; never load other players' private fields (personal quest, battle goals) into context
- Campaign CRUD (create, invite, join, leave, list, details)
- Player CRUD (create character, update items/level/perks/etc.)
- Manual character entry — no screenshot pipeline yet
- New atomic tools: `getCampaign`, `updateCampaign`, `getCharacterState`, `getPartyInfo`
- User profile and settings

**Deliverable:** A player can sign in, create or join a campaign, manually enter their character, and Squire's answers reflect that context (e.g., "what items can I afford?" knows their gold and prosperity).

---

### Phase 5: Recommendation engine

**Goal:** The actual product the original spec was designed around — personalized recommendations.

**Tasks:**

- Card selection at level-up: `listCards('character-abilities', { class, level })` + comparison logic + reasoning
- Inventory optimization: `listCards('items', { prosperity })` filtered by gold + build synergy
- Pre-combat hand selection (scenario type + party composition awareness)
- Long-term build planning (level 2 → 9 progression)
- Scenario and event guidance
- Build guide system:
  - Curated list of guide URLs and metadata in Postgres
  - `fetchBuildGuide(url)` tool fetches and reads guides on-demand (no parsing — Claude reads native format)
  - RAG fallback if web fetch proves unreliable
- Card / item comparison UI components

**Risks (specific to this phase):**

- **Build guide web fetch reliability.** Google Docs and Reddit posts can be slow to fetch (2–5s) or rate-limited. Link rot: guides get deleted, moved, made private. Mitigation: cache fetched guides server-side, maintain archived copies of curated guides, implement RAG fallback if fetch proves unreliable.
- **Build guide content nuance.** Even with on-demand fetch (no parsing), Claude still has to interpret guide content with conditional logic, alternatives, and opinion. Pure recommendations are rare — most guides say things like "Card A is better for most builds, but if you're going melee-heavy take Card B" or "I prefer Card A, but both are viable." The agent needs to surface this nuance, not flatten it into a single answer.

**Deliverable:** Squire can answer "I just hit level 4 on my Drifter, which card should I pick?" with a side-by-side comparison, build guide context, and a reasoned recommendation.

---

### Phase 6: Character state ingestion

**Goal:** Stop typing your character sheet in by hand. Pull state from frosthaven-storyline.com automatically.

**Background:** frosthaven-storyline.com (also reached as gloomhaven-storyline.com) stores all campaign + character data in **browser local storage**. The server component only exists to sync state between browsers — it's a relay, not a data store. There is no public API.

**Ingestion options (decision deferred):**

1. **Browser extension** — read localStorage on the storyline site, push to Squire (cleanest of the storyline-based options, structured, no Vision cost)
2. **Manual JSON export → upload** — user exports localStorage, uploads to Squire (lo-fi, no extension to maintain)
3. **Sync via the storyline server protocol** — reverse-engineer the websocket sync to make Squire look like another client (fragile, unsupported)
4. **Screenshot → Claude Vision** — original spec approach. Image preprocessing via Sharp (resize, normalize, compress) before sending to Claude Vision API. Cost ~$0.15–0.30 per character sync. Kept as a fallback for users who can't install an extension.
5. **GHS as the campaign tracker** — Brian (or the user) uses **Gloomhaven Secretariat** as the campaign tracker instead of frosthaven-storyline.com, and Squire reads campaign state directly from GHS. Squire already imports static GHS data — extending it to read live user state is a much smaller jump than reverse-engineering a third-party site. Especially compelling for the **Gloomhaven 2.0** campaign (Phase 2), since storyline.com may not support GH2 at all. Tradeoff: requires Brian to switch his campaign-tracking workflow from storyline to GHS, which only happens if he likes GHS as a tracker.

**Risks:**

- **Browser-extension fragility (options 1 and 2).** The browser-extension and JSON-export approaches inherit the same class of risk as the original scraping concerns — site DOM/localStorage shape can change without notice and break extraction silently. localStorage schema is undocumented and not a stable contract. No SLA from the storyline maintainers. Mitigation: keep manual entry as a permanent fallback; pin the extension to a known schema version with a clear "site updated, extension needs work" error.
- **storyline.com may not support Gloomhaven 2.0.** All four storyline-based options (1–4) become non-viable for the GH2 campaign if storyline doesn't support GH2. Mitigation: option 5 (GHS-as-tracker) sidesteps this entirely. Confirm storyline GH2 support before this phase begins; if absent, GH2 must use option 5.

**Tasks (once approach is chosen):**

- Implement chosen ingestion path
- Validation and caching
- "Last synced: X ago" UX
- Manual data entry remains as a permanent fallback

**Deliverable:** Brian can keep using frosthaven-storyline.com as his canonical source of campaign and character truth, and Squire stays in sync without manual re-entry.

---

### Phase 7: Polish

**Goal:** UX refinements, additional features, broader reach within the web channel.

**Tasks:**

- **Voice input** via Web Speech API (Chrome-first, progressive enhancement, graceful fallback to text). Voice is one input method within the web channel, not a separate product surface.
- Share & export: shareable links to recommendations, export as PDF / markdown
- Spoiler protection (if user feedback indicates it's valuable — currently a clear warning suffices)
- Performance and cost optimization
- Comprehensive E2E test coverage expansion

**Deliverable:** Squire feels polished. Voice works. You can share an answer with a teammate.

---

### Phase 8: Additional channels (far future)

**Goal:** Reach Squire from outside the web UI.

**Tasks:**

- Discord client
- iMessage client
- Any other channel where it makes sense

All channels talk to the same underlying knowledge agent via the same atomic tools. Channel work is mostly UX glue — the agent doesn't change.

**Deliverable:** Brian can ask Squire a rules question from Discord or iMessage and get the same answer he'd get from the web UI.

---

## Success Metrics

### Phase 1 (MVP)

- Brian uses Squire at the table during a real Frosthaven session
- Rules lookup answers are accurate enough that Brian doesn't have to re-check the rulebook
- Average response time < 5 seconds end-to-end (cold start excluded)
- Mobile UI is readable and usable on a phone without zooming
- Uptime > 99% for the hosted service

### Long-term (Phases 2+)

- User agrees with the agent's recommendation > 70% of the time
- Users find recommendations helpful (qualitative feedback)
- Build guide matching accuracy > 85%
- Character state ingestion success rate > 95% (whichever path is chosen in Phase 6)
- Monthly costs within budget (currently ~$10–50 single-user; revisit when Phase 3 multi-user lands)

---

## Open Questions & Risks

### Technical Risks

1. **Rules answer accuracy.** The agent might give wrong rules interpretations. Mitigation: always cite rulebook source passages so the user can verify, allow user feedback on wrong answers, expand the daily E2E suite, tune the RAG chunking and retrieval parameters as needed.

2. **Embedding quality.** The local Xenova model is chosen for simplicity, not for retrieval quality. If RAG accuracy isn't good enough, the planned upgrade is Voyage AI. The vector store (pgvector) doesn't change. Mitigation: monitor retrieval quality via Langfuse evals, swap embeddings if scores drop.

3. **Testing LLM behavior.** Non-deterministic outputs make traditional testing difficult. Mitigation: tiered testing strategy (per `CLAUDE.md`) — mock LLMs in unit tests, LLM-as-judge for E2E, focus coverage on deterministic logic.

4. **Browser-extension fragility (Phase 6).** The browser-extension and JSON-export approaches for character state ingestion inherit the same class of risk as classic web scraping — site DOM/localStorage shape can change without notice and break extraction silently. localStorage schema is undocumented and not a stable contract. No SLA from the storyline maintainers. Mitigation: keep manual entry as a permanent fallback; pin the extension to a known schema version with a clear "site updated, extension needs work" error.

5. **Build guide web fetch reliability (Phase 5).** Google Docs and Reddit posts can be slow to fetch (2–5s) or rate-limited. Link rot: guides get deleted, moved, made private. Mitigation: cache fetched guides server-side, maintain archived copies of curated guides, implement RAG fallback if web fetch proves unreliable.

6. **Build guide content nuance (Phase 5).** Even with on-demand fetch (no parsing), Claude has to interpret guide content with conditional logic, alternatives, and opinion. Pure recommendations are rare. The agent needs to surface this nuance, not flatten it into a single answer.

7. **Claude API costs at scale.** Phase 1 cost is small. Once multi-user (Phase 3+) and the recommendation engine (Phase 5) ship, per-user cost increases. Mitigation: per-user daily budget circuit breakers, cache aggressively, monitor via Langfuse, model tiering (Haiku for cheap cases) when justified.

8. **frosthaven-storyline.com may not support Gloomhaven 2.0 (Phase 2 / Phase 6).** Brian uses storyline as his canonical campaign tracker for Frosthaven today. If storyline doesn't support GH2 by transition time, his current campaign-tracking workflow breaks for the new game. All four storyline-based ingestion options in Phase 6 become non-viable for GH2. Mitigation: option 5 in Phase 6 (GHS-as-tracker) sidesteps this entirely. Action: confirm storyline GH2 support before Phase 2 begins.

### Product Risks

1. **User adoption.** Frosthaven players might prefer forums and existing guide PDFs. Mitigation: focus on convenience (mobile, fast, no flipping through 100-page rulebooks), personalized context, integration with the campaign tools they already use.

2. **Rules edge cases and errata.** Frosthaven has complex interactions and ongoing errata. The agent might give answers that are correct per the rulebook PDF but outdated per official errata. Mitigation: cite sources, allow user feedback, plan for an errata-update workflow eventually.

3. **Spoiler concerns.** MVP has no spoiler protection. Users may be concerned about being spoiled on locked classes, scenarios, or events. Mitigation: clear warning on first use; add spoiler protection in Phase 7 (Polish) if user feedback indicates it's valuable.

### Open Questions

- **Errata and FAQ updates.** How does Squire stay current with official rules errata and FAQ updates? Manual reindexing? Watching for community-maintained errata documents?
- **Monetization.** If the user base grows, how does Squire cover its API costs? (No urgency — single-user today.)
- **APM / RUM stack.** Datadog as a one-stop shop for application metrics and real-user monitoring (with Langfuse staying for LLM-specific observability), or stay Langfuse-only and skip APM until volume demands it?
- **Hosting platform.** Fly.io vs Railway vs Render vs self-hosted VPS — defer until Phase 1 deployment work begins.
- **Character state ingestion path (Phase 6).** Browser extension vs JSON export vs storyline sync protocol vs screenshot+Vision vs GHS-as-tracker — defer until Phase 6 begins. The GH2 campaign may force this decision earlier than the Frosthaven one.
- **Storyline GH2 support (Phase 2 prerequisite).** Confirm whether frosthaven-storyline.com supports Gloomhaven 2.0. If not, Brian's GH2 campaign-tracking workflow needs to switch (most likely to GHS).

---

## Future Enhancements (Out of Scope)

- **Turn-by-turn combat advice** (real-time during battle)
- **Support for other Gloomhaven games** (original Gloomhaven, Jaws of the Lion, Crimson Scales, Forgotten Circles)
- **Native mobile apps** (iOS / Android)
- **Party coordination features** (sync with teammates' characters in real time)
- **Automated campaign tracking** (fully sync with frosthaven-storyline events automatically, beyond character state)
- **Custom build creator** (let users design and save their own builds)
- **Community features** (share builds, rate recommendations, discuss strategies)
- **Video / streaming integration** (embed in Twitch / YouTube for content creators)
- **Gloomhaven Manager integration** (alternative to frosthaven-storyline.com)

---

## Conclusion

Squire is a deep Gloomhaven / Frosthaven knowledge agent. The MVP is small on purpose: rules Q&A at the table, on a phone, behind real auth. Everything else — campaigns, characters, recommendations, voice, additional channels — is sequenced after the walking skeleton ships. The product spec is a living document and will be refreshed every 1–2 months to reflect what Squire actually is, not what it was originally imagined to be.

---

## Changelog

- **2026-04-07 (v2.1):** GH2 phase + cleanup of stale sections missed in v2.0.
  - **New Phase 2: Gloomhaven 2.0 content expansion.** Deadline-driven (Brian's group transitions to GH2 in ~mid-2026, ~3–4 months from now). Adds GH2 rulebook ingestion, GHS GH2 import scripts, and a `game` dimension to the data layer to prevent cross-contamination of FH and GH2 rules. Confirmed via web search that GHS supports Gloomhaven 2nd Edition.
  - **Phases renumbered:** old Phases 2–7 shifted down to 3–8. Eight phases total now. All in-document phase number cross-references updated.
  - **Phase 6 (Character state ingestion) gains a fifth option: GHS-as-tracker.** Brian uses GHS as the campaign tracker instead of frosthaven-storyline.com, and Squire reads campaign state directly from GHS. Especially compelling for the GH2 campaign since storyline.com may not support GH2.
  - **New Risk 8:** frosthaven-storyline.com may not support Gloomhaven 2.0. Action item to confirm before Phase 2 begins; if absent, GH2 must use the GHS-as-tracker ingestion path.
  - **Cleanup of three stale mid-document sections** that were missed in v2.0 and contradicted the v2.0 phase decisions:
    - **Character State Management** — was still describing worldhaven and screenshot/Vision extraction as the current architecture. Replaced with a brief pointer to Phase 4 (manual entry) and Phase 6 (automated ingestion).
    - **User Interface & Experience** — was still saying "Voice required for Phase 1" and "Progressive Web App for offline capability." Both directly contradicted v2.0 decisions. Rewritten to describe MVP reality (Hono JSX + HTMX, mobile-responsive, text only, no PWA) with forward references to Phases 5 and 7 for richer output and voice.
    - **Critical Non-Functional Requirements** — Spoiler Protection kept (deferred), Offline Capability dropped entirely (PWA / IndexedDB / service worker — none of which fit a server-rendered Hono stack), Share & Export reframed as a Phase 7 forward reference.

- **2026-04-07 (v2.0):** Major refresh after the first month of real building.
  - **Product reframe:** Squire is the agent, not an app. Reachable via multiple channels (web UI today, MCP, future Discord / iMessage). Stopped conflating "personal assistant chatbot" with "*haven game-knowledge agent" — Squire is only the latter.
  - **MVP redefined:** rules Q&A at the table, on a phone, with Google login behind Cloudflare WAF. Recommendation engine, screenshot extraction, voice, PWA, multi-user — all moved to later phases.
  - **Stack updates:** Hono JSX + HTMX + Tailwind CDN (no React, no Next.js, no build step). Drizzle (no Prisma). pgvector (no Pinecone). Custom Google OAuth (no NextAuth / Clerk). Sonnet 4.6. Local Xenova embeddings (`Xenova/all-MiniLM-L6-v2`) with Voyage AI as the planned upgrade path. Cloudflare WAF as edge layer.
  - **Game data:** Worldhaven and OCR pipeline retired (commit `34a26a1`). Replaced with Gloomhaven Secretariat (GHS) structured data — 10 import scripts in `src/import-*.ts`.
  - **Tools:** Reframed as a generalized atomic-tools API in `src/tools.ts` (`searchRules`, `searchCards`, `listCardTypes`, `listCards`, `getCard`) that works across all GHS card types. Per-feature operations are invocations, not new tools.
  - **MCP server:** Added as a first-class architectural fact. Treated as a third channel type alongside web UI and future Discord / iMessage. Internal MCP between conversation and knowledge agents was considered and dropped for simplicity.
  - **Observability:** Added Langfuse + OpenTelemetry section. APM / RUM stack is open.
  - **Hosting:** Vercel dropped (doesn't fit a long-running Hono Node server). Fly / Railway / Render / VPS as the open shortlist.
  - **Phases resequenced:** 7 phases instead of 6. Phase 1 = MVP rules Q&A; Phase 2 = multi-user platform; Phase 3 = campaign + character state (manual entry); Phase 4 = recommendation engine + build guides; Phase 5 = character state ingestion (browser extension preferred over Vision); Phase 6 = polish (voice + share/export); Phase 7 = additional channels.
  - **Voice and PWA:** Voice moved out of Phase 1 to Phase 6 (Brian uses iOS Monologue externally for now). PWA / IndexedDB / offline mode dropped entirely — Squire is a mobile-responsive web app, not a PWA.
  - **frosthaven-storyline.com:** Still the canonical character state source, but the technical reality (browser localStorage, no API) was discovered later. Four ingestion options now documented; decision deferred to Phase 5.
  - **Cost rewrite:** ~$10–50/month for current Phase 1 single-user state. Vision costs deferred to Phase 5.
  - **Risks:** Pulled forward valid risks from the (now-deleted) `spec-discussion-areas.md`: browser-extension fragility (Phase 5), build guide fetch reliability (Phase 4), build guide content nuance (Phase 4).
  - **Stale companion docs:** `frosthaven-agent-checkpoint.md` and `spec-discussion-areas.md` deleted as part of this refresh — load-bearing content folded into the spec.

- **2026-01-11 (v1.1):** Updated specification with finalized technical decisions:
  - Screenshot-based character data extraction using Claude Vision API
  - On-demand web fetch for build guides (no parsing)
  - Tiered test coverage requirements (100% for business logic, 80-90% for integrations, E2E with LLM-as-judge)
  - Voice input as must-have for Phase 1 (Chrome-focused, progressive enhancement)
  - Spoiler protection deferred to post-MVP

- **2026-01-10 (v1.0):** Initial specification based on Q&A session.

---

*This spec is refreshed every 1–2 months. Next refresh expected: ~2026-06.*
