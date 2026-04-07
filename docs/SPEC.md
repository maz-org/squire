# Squire — Frosthaven Knowledge Agent Product Specification

**Version:** 3.0
**Date:** 2026-04-07
**Last Refreshed:** 2026-04-07
**Owner:** Product (PM)
**Companion doc:** [docs/ARCHITECTURE.md](ARCHITECTURE.md) — architect-owned tech spec (how / with-what / where)
**Status:** Phase 1 in progress, MVP scoped. GH2 content expansion (Phase 2) deadline ~mid-2026.

This document is the **product spec** — what Squire is, why it exists, who it's for, and when each capability lands. Technical architecture (stack, data layer, agent design, deployment, observability, tech risks) lives in the companion [ARCHITECTURE.md](ARCHITECTURE.md).

## Executive Summary

Squire is a deep game-knowledge agent for Gloomhaven and Frosthaven. It answers rules questions, looks up cards, items, monsters, and scenarios, and (longer term) makes personalized recommendations for character building, inventory, and gameplay strategy.

Squire is **the agent**, not a specific app. It's reachable through multiple **channels** — primarily its own web UI today, with MCP-capable agent harnesses (Claude Code, Claude Desktop) as a second channel, and Discord / iMessage clients planned for the far future. All channels talk to the same underlying knowledge agent.

**MVP (Phase 1):** A mobile-friendly web chat where Brian can pull out his phone at the table, log in with Google, and ask any Frosthaven rules question. Hosted publicly behind Cloudflare WAF. The agent answers using a rulebook RAG pipeline and a generalized atomic-tools API over Gloomhaven Secretariat (GHS) structured game data.

**Long-term product (Phases 2–8):** Gloomhaven 2.0 content expansion, multi-user platform, campaign and character state, the recommendation engine (card selection at level-up, inventory optimization, pre-combat hand selection, long-term build planning), character state ingestion, polish (voice input, share/export, spoiler protection), and additional channels (Discord, iMessage).

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
- Query GHS data for available cards at new level
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
- Access to all available items from GHS data
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

The full technical architecture — stack choices, data layer, agent loop, atomic tools, MCP server, observability, deployment, and tech risks — lives in [docs/ARCHITECTURE.md](ARCHITECTURE.md).

Quick pointers for product readers:

- **Stack and rationale:** [ARCHITECTURE.md → Stack](ARCHITECTURE.md#stack)
- **Game data sources (GHS, rulebook RAG):** [ARCHITECTURE.md → Data Architecture](ARCHITECTURE.md#data-architecture)
- **Agent design and atomic tools:** [ARCHITECTURE.md → Agent Architecture](ARCHITECTURE.md#agent-architecture)
- **MCP server (third channel type):** [ARCHITECTURE.md → MCP Server](ARCHITECTURE.md#mcp-server)
- **Observability and evals:** [ARCHITECTURE.md → Observability](ARCHITECTURE.md#observability)
- **Deployment and cost:** [ARCHITECTURE.md → Deployment](ARCHITECTURE.md#deployment)

---

## Development Phases

The phases below reflect the **resequenced plan** as of the 2026-04-07 spec refresh. The original spec was organized around the recommendation engine as the centerpiece. The new sequencing puts **rules Q&A at the table** as MVP and treats character state, recommendations, and channel expansion as later phases.

---

### Phase 1: MVP — Rules Q&A at the table

**Goal:** Brian can pull out his phone at the table, log in with Google, and ask Squire any Frosthaven rules question via a mobile-friendly web chat. Hosted publicly behind Cloudflare WAF.

**Status as of 2026-04-07:** rules RAG pipeline, GHS imports, atomic tools, and MCP server are all built. The main remaining work is the web channel + auth + deployment.

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
- **Turn on the `game` dimension** so the agent doesn't mix Frosthaven and GH2 rules in the same answer. The Storage & Data Migration project (Phase 1) ships the `game` column on every `card_*` table and the `embeddings` table with `default 'frosthaven'`, so existing rows are tagged correctly. The runtime code that *populates* and *filters* on the column is Phase 2 work — none of this exists today. Phase 2 will:
  - Update the GH2 import scripts to write `game: 'gloomhaven-2'` on each new row (the existing Frosthaven importers don't yet write a `game` field; they rely on the column default)
  - Add filename-prefix → `game` derivation in `src/index-docs.ts` so rule chunks from `fh-*.pdf` get `game: 'frosthaven'` and chunks from `gh2-*.pdf` get `game: 'gloomhaven-2'`. Today `IndexEntry` in `src/vector-store.ts` has no `game` field at all — Phase 2 adds it alongside the index-docs.ts changes.
  - Wire the optional `game` filter parameter on the atomic tools through to the agent system prompt and through every call site that knows the active game
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

**Goal:** Stop typing your character sheet in by hand. Pull state from a third-party campaign tracker (frosthaven-storyline.com today, GHS-as-tracker as a strong alternative for the GH2 campaign).

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

**Deliverable:** Brian's chosen campaign tracker (storyline.com or GHS) stays the canonical source of campaign and character truth, and Squire stays in sync without manual re-entry.

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

Tech risks (browser-extension fragility, build guide fetch reliability, embedding quality, Claude API costs, storyline GH2 support) and tech open questions (APM/RUM, hosting platform) live in [ARCHITECTURE.md → Tech Risks](ARCHITECTURE.md#tech-risks) and [ARCHITECTURE.md → Open Tech Questions](ARCHITECTURE.md#open-tech-questions).

### Product Risks

1. **User adoption.** Frosthaven players might prefer forums and existing guide PDFs. Mitigation: focus on convenience (mobile, fast, no flipping through 100-page rulebooks), personalized context, integration with the campaign tools they already use.

2. **Rules answer accuracy as a trust risk.** If Squire gives wrong rules interpretations, Brian stops trusting it at the table and the product dies. Mitigation: always cite rulebook source passages so the user can verify, allow user feedback on wrong answers, expand the daily E2E suite. (Underlying RAG quality work tracked in ARCHITECTURE.md.)

3. **Rules edge cases and errata.** Frosthaven has complex interactions and ongoing errata. The agent might give answers that are correct per the rulebook PDF but outdated per official errata. Mitigation: cite sources, allow user feedback, plan for an errata-update workflow eventually.

4. **Spoiler concerns.** MVP has no spoiler protection. Users may be concerned about being spoiled on locked classes, scenarios, or events. Mitigation: clear warning on first use; add spoiler protection in Phase 7 (Polish) if user feedback indicates it is valuable.

### Open Product Questions

- **Errata and FAQ updates.** How does Squire stay current with official rules errata and FAQ updates? Manual reindexing? Watching for community-maintained errata documents?
- **Monetization.** If the user base grows, how does Squire cover its API costs? (No urgency — single-user today.)

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

- **2026-04-07 (v3.0.1):** Final-pass cleanup. Fixed "Phases 2–6" → "Phases 2–8" in the executive summary (8 phases now). Broadened Phase 6 goal/deliverable beyond storyline.com to acknowledge GHS-as-tracker as a viable alternative for the GH2 campaign.

- **2026-04-07 (v3.0):** Split into product spec + tech spec.
  - SPEC.md is now the **product spec** (PM-owned): what / why / who / when. Owner: Product.
  - All technical architecture content moved to the new companion [ARCHITECTURE.md](ARCHITECTURE.md) (architect-owned): how / with-what / where.
  - Removed sections from SPEC: Stack, Data Architecture, Agent Architecture, MCP Server, Observability, Deployment, Cost. Replaced with cross-references.
  - Removed tech risks (embedding quality, browser-extension fragility, build guide fetch, Claude API costs, storyline GH2) and tech open questions (APM/RUM, hosting platform) — now in ARCHITECTURE.md.
  - Reframed "Rules answer accuracy" as a product trust risk; underlying RAG quality work lives in ARCHITECTURE.md.
  - Header updated: Version 3.0, Owner: Product (PM), companion-doc note added.

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
