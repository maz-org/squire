# Frosthaven Assistant Agent - Product Specification

**Version:** 1.1
**Date:** 2026-01-11
**Status:** Planning Phase - Decisions Finalized

## Executive Summary

An AI-powered assistant to help Frosthaven players make optimal decisions for character building, inventory management, and gameplay strategy. The agent provides personalized recommendations based on build guides, character state, and campaign progress.

**Primary Use Cases:**
- Card selection when leveling up
- Inventory optimization (buying, selling, upgrading items)
- Pre-combat hand selection
- Rules lookup and clarification
- Long-term build planning
- Scenario and event guidance

**Target User:** Mobile-first (phone), voice + text input, used between sessions, during gameplay prep, and mid-session

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

### Data Sources
1. **frosthaven-storyline.com** (user's character and campaign state)
   - Character class, level, XP, gold
   - Owned cards, active cards in deck
   - Current items and equipment
   - Campaign progress (prosperity, reputation, unlocks)
   - Party composition

2. **worldhaven GitHub repository** (static game data)
   - All cards by class and level
   - All items by prosperity
   - Abilities, effects, mechanics
   - Events and scenarios
   - Link: https://github.com/any2cards/worldhaven

3. **Community build guides** (strategy and recommendations)
   - Curated list of URLs to popular guides (Google Docs, Reddit posts, etc.)
   - Agent fetches guides on-demand via web search/fetch
   - Claude reads and understands guides in their native format
   - No parsing or structured extraction needed
   - RAG system available as fallback if web fetch proves insufficient

4. **Frosthaven rulebook** (game rules)
   - Official PDF or structured text
   - Indexed for semantic search
   - All rules, clarifications, examples

### Data Extraction & Access
**frosthaven-storyline.com (Screenshot-based extraction):**
- User captures ~5 screenshots from known pages (character sheet, inventory, cards, campaign progress, etc.)
- Screenshots uploaded to web UI (manual upload for MVP, browser extension in future)
- Backend sends screenshots to Claude Vision API with structured extraction prompt
- Claude returns structured JSON with character data (class, level, gold, cards, items, prosperity, campaign progress)
- Backend validates and caches extracted data
- Handle vertical scrolling by capturing multiple screenshots per page if needed

**Sync Strategy:**
- User-initiated refresh via "Sync Character Data" button
- Frequency: ~1-2x per week (after play sessions)
- Display "Last synced: X hours ago" timestamp
- Cache extracted data for session duration
- Manual data entry form always available as fallback
- Cost per sync: ~$0.15-0.30 (5 screenshots × Vision API cost)

### Multiple Characters
- User may have multiple characters
- Agent infers which character from conversation context
- Example: "My Drifter just hit level 4" → knows to check Drifter
- Must track multiple characters per user account
- Allow explicit character switching if ambiguous

---

## User Interface & Experience

### Platform
**Web App** (mobile-first responsive design)
- Accessible via mobile browser
- No app installation required
- Works on all devices (phone, tablet, desktop)
- Progressive Web App (PWA) for offline capability

### Input Methods
**Both voice and text are first-class input methods** - equally important and well-designed.

1. **Voice Input** (required for Phase 1)
   - Web Speech API for voice recognition
   - Primary input during gameplay (hands-free, mobile-friendly)
   - Chrome/Edge: Excellent support (primary target)
   - Safari: Partial support (best effort)
   - Firefox: Graceful degradation to text-only
   - Clear visual feedback (listening indicator, live transcription)
   - Easy correction when recognition errors occur
   - Progressive enhancement with feature detection

2. **Text Input** (required for Phase 1)
   - Standard chat interface
   - Keyboard input for detailed questions
   - Primary input before/after game sessions
   - Always available as fallback
   - Smooth toggle between voice and text modes

### Output Format
**Multi-modal recommendations:**
- **Card/Item Images**: Visual reference, familiar to players
- **Comparison Tables**: Side-by-side stats, effects, synergies
- **Natural Language**: Conversational explanations and reasoning
- **Scores/Rankings**: When comparing multiple options

### Agent Persona
**Functional Assistant**
- Clear, concise, professional tone
- Focus on data and actionable recommendations
- No unnecessary fluff or roleplay elements
- Efficient responses optimized for mobile reading

### Conversation Flow
- Context-aware chat interface
- Remembers conversation history within session
- Persists important decisions across sessions (which cards chosen, build guide followed, etc.)
- Can reference previous conversations
- Allows follow-up questions

---

## Critical Non-Functional Requirements

### 1. Spoiler Protection
**Status: DEFERRED TO POST-MVP**

**MVP Approach:**
- No spoiler protection implemented in Phase 1
- Display clear warning: "This tool may contain spoilers for Frosthaven content including locked classes, scenarios, and events"
- Users self-regulate what questions they ask
- Reduces MVP complexity significantly
- Focus development effort on core recommendation features

**Future Enhancement (Phase 2+):**
- Screenshot extraction already captures campaign progress data (unlocked classes, completed scenarios, prosperity)
- Can add spoiler filtering later if user feedback indicates it's valuable
- Implementation would include:
  - Spoiler level flags in database
  - Filter queries based on user's campaign progress
  - Explicit spoiler warnings before revealing optional content
  - User override option ("I know about class X, show me anyway")

### 2. Offline Capability
**Goal:** Basic functionality without internet connection

**Offline Features:**
- View cached character data
- Browse known cards and items
- Read cached rules sections
- Access conversation history

**Online-Required Features:**
- Fresh character data sync
- Build guide updates
- LLM-powered recommendations
- New rules searches

**Implementation:**
- Service worker for PWA
- IndexedDB for local data storage
- Queue actions for when online
- Clear offline/online status indicator

### 3. Share & Export
**Use Case:** Show recommendations to party members

**Features:**
- Generate shareable links to specific recommendations
- Screenshot/download agent responses as images
- Export build plans as PDF or markdown
- Share with party members who don't have accounts

**Implementation:**
- Unique URLs for each recommendation
- Render-friendly formatting for exports
- Public (non-authenticated) view for shared links

---

## Technical Architecture

### Stack
**Language:** TypeScript (full-stack)

**Frontend:**
- **Framework:** Next.js 14+ (React)
- **Styling:** Tailwind CSS
- **Voice:** Web Speech API
- **PWA:** next-pwa or custom service worker
- **State:** React Context or Zustand
- **Local Storage:** IndexedDB (Dexie.js)

**Backend:**
- **Runtime:** Node.js
- **Framework:** Next.js API routes or Express
- **Image Processing:** Sharp or similar (for screenshot handling)
- **Data Parsing:** pdf-parse (for rulebook), JSON parsing for worldhaven data

**Database:**
- **Primary DB:** PostgreSQL (hosted on Railway/Vercel Postgres)
- **Vector DB:** pgvector (extension) OR Pinecone
- **ORM:** Prisma or Drizzle

**LLM:**
- **Provider:** Anthropic Claude API
- **Model:** Claude 3.5 Sonnet or latest (Opus 4.5 for complex reasoning if needed)
- **Capabilities:** Long context, tool use, vision (for screenshot extraction and card image analysis)
- **Cost Estimation:**
  - Text queries: ~$0.03 per query average
  - Screenshot extraction: ~$0.15-0.30 per character sync (5 images)
  - Vision used for extracting structured data from frosthaven-storyline.com screenshots

**Authentication:**
- **User Auth:** NextAuth.js or Clerk
- **Session Management:** JWT or session cookies

### Data Architecture

**Static Game Data (worldhaven):**
- Fetch from GitHub on deploy
- Parse JSON files into PostgreSQL
- Index for fast queries
- Tables: cards, items, abilities, classes, scenarios

**Character State:**
- Extract from screenshots using Claude Vision API
- User uploads ~5 screenshots from frosthaven-storyline.com pages
- Claude Vision processes screenshots with structured extraction prompt
- Returns validated JSON data structure
- Cache extracted data in user's session/database record
- Schema:
  ```typescript
  {
    characterId: string
    className: string
    level: number
    xp: number
    gold: number
    ownedCards: string[]
    activeCards: string[]
    items: string[]
    prosperity: number
    campaignProgress: {
      unlockedClasses: string[]
      completedScenarios: string[]
      // etc.
    }
    lastSyncedAt: timestamp
    syncMethod: 'screenshot' | 'manual'
  }
  ```
- Manual data entry form available as fallback if screenshot extraction fails

**Build Guides:**
- Store curated list of guide URLs and metadata in PostgreSQL
- Agent fetches guides on-demand using web search/fetch tool
- No pre-processing or parsing required - Claude reads guides directly
- Schema for guide metadata:
  ```typescript
  {
    guideId: string
    url: string
    className: string
    buildName: string
    author: string
    description: string
    lastVerified: timestamp
  }
  ```
- RAG system (chunking, embeddings, vector search) available as fallback if web fetch proves too slow or unreliable
- Update guide list manually when new popular guides emerge

**Rules Database:**
- Extract text from Frosthaven rulebook PDF
- Chunk into semantic sections
- Generate embeddings (Claude API or OpenAI embeddings)
- Store in vector database (pgvector)
- RAG pipeline for retrieval

**User Conversations:**
- Store conversation history in PostgreSQL
- Link to user account
- Include: messages, recommendations, decisions made
- Use for context in future conversations

### Agent Architecture

**Core Agent Loop:**
1. **Input:** User message (voice → text or text directly)
2. **Context Gathering:**
   - Identify which character (from conversation or explicit)
   - Load cached character state OR prompt user to sync via screenshot upload
   - Retrieve conversation history
   - Identify relevant build guide URLs if needed
3. **Tool Use:** Claude with available tools:
   - `extractCharacterFromScreenshots(images[])` → parse screenshots to structured character data (Vision API)
   - `getCharacterState(characterName)` → current stats, cards, items (from cache/DB)
   - `queryCards(className, level, filters)` → available cards from worldhaven data
   - `queryItems(prosperity, filters)` → available items from worldhaven data
   - `fetchBuildGuide(url)` → retrieve and read build guide content
   - `searchRules(query)` → RAG over rulebook
   - `getPartyInfo()` → other characters in party
4. **Reasoning:** Claude analyzes data and generates recommendation
5. **Response:** Format multi-modal response (images, tables, text)
6. **Memory:** Save decision and context for future

**Tool Implementation:**
- Each tool is a TypeScript function
- Queries PostgreSQL or vector DB
- Returns structured data to Claude
- Claude decides which tools to call and interprets results

### Deployment

**Hosting:** Vercel or Railway
- Vercel: Best for Next.js, free tier generous, easy deploys
- Railway: Good for full-stack with Postgres, $5/month

**Cost Breakdown (estimated monthly):**
- Hosting: $0-20 (Vercel free tier or Railway hobby plan)
- Database: $0-10 (included in Railway or Vercel Postgres free tier)
- Claude API: $30-60 (depends on usage, ~1000-2000 queries/month)
- Vector DB: $0 (pgvector) or $10 (Pinecone free tier)
- **Total: ~$30-90/month** (within budget)

**CI/CD:**
- GitHub repository
- Automatic deploys on push to main (Vercel/Railway integration)
- Staging environment for testing

---

## Development Phases

### Phase 1: Foundation & Core Data
**Goal:** Get infrastructure, database, and worldhaven data working

**Tasks:**
- Set up Next.js project with TypeScript
- Configure testing infrastructure (Jest/Vitest, coverage reporting)
- Set up CI/CD pipeline with tiered testing (unit on every commit, E2E daily)
- Design PostgreSQL schema (users, characters, cards, items, guide_metadata)
- Ingest worldhaven data into database
  - Fetch from GitHub repository
  - Parse JSON files
  - Populate cards, items, abilities, classes tables
  - Write tests with 100% coverage for data ingestion logic
- Create basic web UI (chat interface, mobile-responsive)
- Integrate Claude API with simple conversation
- Set up test infrastructure with mocked Claude API responses

**Testing Focus:**
- Unit tests for data ingestion: 100% coverage
- Mocked database tests for schema validation
- Basic E2E test with real Claude API (daily CI)

**Deliverable:** Can chat with agent, worldhaven data queryable, test suite passing

---

### Phase 2: Screenshot Extraction & Character Data
**Goal:** Get character data extraction working via screenshots

**Tasks:**
- Build screenshot upload UI
  - File upload component (supports multiple images)
  - Preview uploaded screenshots
  - "Sync Character Data" button
  - Display "Last synced: X ago" timestamp
- Implement Claude Vision API integration for screenshot extraction
  - Design structured extraction prompt
  - Send screenshots to Claude Vision API
  - Parse and validate returned JSON
  - Handle extraction errors gracefully
- Build manual data entry form as fallback
  - Simple form for key fields (class, level, gold, prosperity, cards, items)
  - Save to same character schema
- Cache character data in PostgreSQL
- Write comprehensive tests
  - Unit tests for JSON validation: 100% coverage
  - Integration tests with mocked Claude Vision API responses
  - E2E test with real screenshots (daily CI, LLM-as-judge validates extraction quality)

**Testing Focus:**
- Mock Vision API responses in unit/integration tests
- Fixture screenshots for testing
- Validation logic at 100% coverage
- Daily E2E with real Vision API calls

**Deliverable:** User can upload screenshots and extract character data, or enter manually

---

### Phase 3: Card Selection Feature
**Goal:** First core use case working end-to-end

**Tasks:**
- Build card recommendation logic
  - Query available cards from database based on class/level
  - Compare card synergies and stats
  - Generate recommendation with reasoning
  - Write tests: 100% coverage for deterministic logic, mocked LLM calls
- Curate initial build guide list (URLs for 1-2 guides per starting class)
  - Store guide metadata in database
  - Implement web fetch tool for reading guides
- Implement `fetchBuildGuide(url)` tool
  - Fetch guide content on-demand
  - Pass to Claude for analysis
  - Test with mocked web responses and real guides (E2E)
- Design card comparison UI
  - Card images side-by-side
  - Comparison table (stats, effects, synergies)
  - Natural language explanation
  - Recommendation with reasoning
- Integrate voice input (Web Speech API)
  - Feature detection and browser compatibility
  - Visual feedback (listening indicator)
  - Transcription display
  - Toggle between voice and text
  - Test across Chrome, Safari, Firefox
- Test with real level-up scenarios

**Testing Focus:**
- Card comparison logic: 100% coverage (deterministic)
- Recommendation prompt construction: unit tested
- Mock build guide responses in integration tests
- E2E with real guides and LLM (daily CI, LLM-as-judge)
- Voice input: manual testing across browsers

**Deliverable:** User can ask "I just hit level 4, which card should I pick?" and get useful answer via voice or text

---

### Phase 4: Inventory & Rules
**Goal:** Expand to inventory optimization and rules lookup

**Tasks:**
- Implement inventory optimization logic
  - Query available items by prosperity level
  - Filter by gold budget
  - Analyze synergies with character build
  - Recommend purchases, upgrades, items to sell
  - Write tests: 100% coverage for item filtering/comparison logic
- Add item comparison UI
  - Item images
  - Stats tables
  - Synergy explanations
  - Purchase recommendations
- Build RAG system for rulebook
  - Extract text from Frosthaven rulebook PDF
  - Chunk into semantic sections
  - Generate embeddings (Claude or OpenAI)
  - Store in pgvector
  - Implement semantic search
  - Test with known rules queries
- Implement `searchRules(query)` tool
  - Query vector DB
  - Return relevant sections with page numbers
  - Test with mocked embeddings in unit tests
  - E2E with real rulebook queries (daily CI)

**Testing Focus:**
- Item filtering logic: 100% coverage
- RAG chunking and retrieval: integration tests with mocked embeddings
- Rules accuracy validation in E2E tests

**Deliverable:** User can ask about items and rules, get accurate answers

---

### Phase 5: Advanced Features & Polish
**Goal:** Combat advice, build planning, production readiness

**Tasks:**
- Implement pre-combat hand selection
  - Consider scenario type (boss, mob-heavy, etc.)
  - Party composition awareness
  - Recommend optimal card hand
- Build long-term build planning views
  - Show recommended progression from current level to level 9
  - Explain build philosophy
  - Identify key cards to work toward
- Add scenario/event guidance (no spoiler protection initially)
- Improve build guide coverage (add more guides to curated list)
- Polish mobile UX
  - Responsive design optimization
  - Voice input refinement
  - Loading states and error handling
- Build offline capability (PWA)
  - Service worker for caching
  - IndexedDB for offline data
  - Queue actions when offline
  - Offline/online status indicator
- Add share/export features
  - Shareable links to recommendations
  - Export as PDF/markdown
  - Screenshot downloads
- Add user authentication (NextAuth.js or Clerk)
- Optimize performance and costs
  - Caching strategies
  - Prompt optimization
  - Monitor API usage
- Comprehensive testing and bug fixes
  - Increase E2E test coverage
  - User acceptance testing
  - Performance testing

**Testing Focus:**
- All new features tested with tiered approach
- E2E suite expanded (still daily CI)
- Performance benchmarks
- Cost monitoring

**Deliverable:** Production-ready application with full feature set

---

### Phase 6: Launch & Iterate
**Goal:** Real users, feedback, improvements

**Tasks:**
- Deploy to production (Vercel or Railway)
- User testing with real Frosthaven campaigns
- Gather feedback
- Fix issues based on user reports
- Add quality-of-life improvements
- Monitor costs and optimize
- Consider adding:
  - Browser extension for automated screenshot capture
  - RAG for build guides if web fetch proves insufficient
  - Spoiler protection if users request it

**Deliverable:** Live application with active users

---

## Success Metrics

### User Experience
- Average response time < 3 seconds
- Voice recognition accuracy > 85%
- Mobile-friendly UI (responsive, readable)
- Session retention (users return for future levels/decisions)

### Recommendation Quality
- User agrees with agent recommendation > 70% of time
- User finds recommendations helpful (qualitative feedback)
- Build guide matching accuracy > 85%

### Technical
- Uptime > 99%
- Monthly costs within budget ($50-100)
- Character scraping success rate > 95%
- Rules lookup relevance (user doesn't need to re-ask)

---

## Open Questions & Risks

### Technical Risks
1. **Screenshot extraction accuracy**
   - Claude Vision may not perfectly extract all data from screenshots
   - Screenshots may have varying quality, resolution, or formatting
   - Mitigation: Provide manual data entry fallback, validate extracted data, allow user corrections, start with core fields and expand gradually

2. **Build guide web fetch reliability**
   - Google Docs or Reddit posts may be slow to fetch or unavailable
   - Links may break (deleted, moved, made private)
   - Mitigation: Cache fetched guides temporarily, maintain fallback list of archived guides, implement RAG system if web fetch proves insufficient

3. **Claude API costs**
   - Vision API calls for screenshot extraction add cost (~$0.15-0.30 per sync)
   - Usage could exceed budget if popular
   - Mitigation: User-initiated sync only (not automatic), implement caching, optimize prompts, monitor usage, rate limiting if needed

4. **Voice recognition accuracy**
   - Web Speech API may struggle with Frosthaven terminology
   - Browser support varies (good in Chrome, partial Safari, none Firefox)
   - Mitigation: Show transcription so user can verify, easy correction mechanism, text input always available, progressive enhancement

5. **Testing LLM behavior**
   - Non-deterministic outputs make traditional testing difficult
   - Mitigation: Tiered testing strategy, mock LLM in unit tests, LLM-as-judge for E2E validation, focus coverage on deterministic logic

### Product Risks
1. **User adoption**
   - Frosthaven players might prefer forums/guides
   - Mitigation: Focus on convenience (voice, mobile), personalized advice, faster than searching

2. **Spoiler concerns**
   - MVP has no spoiler protection - users may be concerned about spoilers
   - Mitigation: Clear warning on first use, add spoiler protection in Phase 6 if users request it, screenshot extraction already captures unlock data for future filtering

3. **Rules accuracy**
   - Agent might give wrong rules interpretations
   - Mitigation: Always cite rulebook page numbers, allow user feedback on wrong answers, improve RAG, E2E tests validate common rules queries

4. **Screenshot upload friction**
   - Users may find manual screenshot upload cumbersome
   - Mitigation: Build browser extension in Phase 6 for one-click capture, make upload UX as smooth as possible, manual entry always available

### Open Questions
- How to handle errata and FAQ updates to rules?
- Should agent support tracking party inventory/cards too?
- Monetization strategy if user base grows?
- How to handle multiple campaigns (one user, multiple active campaigns)?

---

## Future Enhancements (Out of Scope for MVP)

- **Turn-by-turn combat advice** (real-time during battle)
- **Support for other Gloomhaven games** (original, JOTL, Crimson Scales)
- **Native mobile apps** (iOS/Android)
- **Party coordination features** (sync with teammates' characters)
- **Automated campaign tracking** (fully sync with frosthaven-storyline, track events automatically)
- **Custom build creator** (let users design and save their own builds)
- **Community features** (share builds, rate recommendations, discuss strategies)
- **Video/streaming integration** (embed in Twitch/YouTube for content creators)
- **Gloomhaven Manager integration** (alternative to frosthaven-storyline.com)

---

## Conclusion

This specification defines a comprehensive AI assistant for Frosthaven players that provides personalized, context-aware recommendations for character building and gameplay strategy. The project leverages modern web technologies, Claude's advanced reasoning capabilities, and community resources to deliver a mobile-first experience that enhances the Frosthaven gameplay experience.

**Next Steps:**
1. Review and approve this specification
2. Set up development environment
3. Begin Phase 1 implementation
4. Iterate based on testing and feedback

---

**Document History:**
- 2026-01-10: Initial specification (v1.0) based on Q&A session
- 2026-01-11: Updated specification (v1.1) with finalized technical decisions:
  - Screenshot-based character data extraction using Claude Vision API
  - On-demand web fetch for build guides (no parsing)
  - Tiered test coverage requirements (100% for business logic, 80-90% for integrations, E2E with LLM-as-judge)
  - Voice input as must-have for Phase 1 (Chrome-focused, progressive enhancement)
  - Spoiler protection deferred to post-MVP
  - Revised development phases to reflect decisions
