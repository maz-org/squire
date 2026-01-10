# Frosthaven Assistant Agent - Product Specification

**Version:** 1.0
**Date:** 2026-01-10
**Status:** Planning Phase

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
- Auto-discover popular class guides from r/Gloomhaven subreddit
- Parse Google Docs to extract level-by-level recommendations
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
   - Google Docs from r/Gloomhaven
   - Auto-discover and parse popular guides
   - Extract level-by-level card recommendations
   - Identify build archetypes and strategies

4. **Frosthaven rulebook** (game rules)
   - Official PDF or structured text
   - Indexed for semantic search
   - All rules, clarifications, examples

### Authentication & Access
**frosthaven-storyline.com:**
- Uses sharing URL system (not username/password)
- User generates sharing URL from website
- Agent receives URL and needs to persist session
- Requires handling cookies or browser local storage
- Session may need periodic refresh

**Sync Strategy:**
- Session-based caching
- Fetch character data once at conversation start
- Cache for duration of session
- User can manually trigger refresh if needed
- Display last sync timestamp

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
1. **Voice Input**
   - Browser speech recognition API
   - Primary input method for mobile
   - Fallback to text if unsupported

2. **Text Input**
   - Standard chat interface
   - Keyboard input for detailed questions
   - Fallback for situations where voice isn't appropriate

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
**Problem:** Frosthaven has locked classes, hidden scenarios, and campaign unlocks

**Solution:**
- Track user's campaign progress via frosthaven-storyline.com
- Only show content user has unlocked
- Hide locked class information until revealed
- Don't spoil future scenario or event outcomes
- Allow user to override (e.g., "I know about class X, show me anyway")

**Implementation:**
- Spoiler level flags in database
- Filter queries based on user's campaign progress
- Explicit spoiler warnings before revealing optional content

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
- **Scraping:** Playwright or Puppeteer (for frosthaven-storyline.com)
- **Data Parsing:** Cheerio (for HTML), pdf-parse (for rulebook)

**Database:**
- **Primary DB:** PostgreSQL (hosted on Railway/Vercel Postgres)
- **Vector DB:** pgvector (extension) OR Pinecone
- **ORM:** Prisma or Drizzle

**LLM:**
- **Provider:** Anthropic Claude API
- **Model:** Claude 3.5 Sonnet (or latest)
- **Capabilities:** Long context, tool use, vision (for future card image analysis)
- **Cost Estimation:** ~$0.03 per query average

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
- Scrape frosthaven-storyline.com on session start
- Parse HTML to extract structured data
- Cache in user's session/database record
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
  }
  ```

**Build Guides:**
- Scrape Google Docs from known r/Gloomhaven links
- Parse into structured format:
  ```typescript
  {
    guideId: string
    className: string
    buildName: string
    description: string
    levelRecommendations: {
      [level: number]: {
        recommendedCards: string[]
        reasoning: string
        alternatives: string[]
      }
    }
  }
  ```
- Store in PostgreSQL
- Periodically refresh (weekly cron job)

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
   - Load cached character state OR trigger fresh scrape
   - Load relevant build guide if identified
   - Retrieve conversation history
3. **Tool Use:** Claude with available tools:
   - `getCharacterState(characterName)` → current stats, cards, items
   - `queryCards(className, level, filters)` → available cards
   - `queryItems(prosperity, filters)` → available items
   - `searchBuildGuide(className, buildName)` → guide recommendations
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

### Phase 1: Foundation & Data Setup
**Goal:** Get core infrastructure and data working

**Tasks:**
- Set up Next.js project with TypeScript
- Design PostgreSQL schema (users, characters, cards, items, guides)
- Ingest worldhaven data into database
- Build scraper for frosthaven-storyline.com
  - Test with sharing URL auth
  - Parse character data accurately
  - Handle session persistence
- Create basic web UI (chat interface)
- Integrate Claude API with simple conversation

**Deliverable:** Can chat with agent and it can fetch character data

### Phase 2: Card Selection Feature
**Goal:** First core use case working end-to-end

**Tasks:**
- Build card recommendation logic
- Scrape and parse first set of build guides
- Implement build guide matching (detect which guide user follows)
- Design card comparison UI (images, tables, explanations)
- Test with real level-up scenarios

**Deliverable:** User can ask "I just hit level 4, which card should I pick?" and get useful answer

### Phase 3: Inventory & Rules
**Goal:** Expand to other major features

**Tasks:**
- Implement inventory optimization logic
- Add item comparison UI
- Build RAG system for rulebook
- Ingest rulebook into vector database
- Implement rules search and retrieval
- Test accuracy of rules answers

**Deliverable:** User can ask about items and rules

### Phase 4: Advanced Features
**Goal:** Combat advice, build planning, scenario guidance

**Tasks:**
- Implement pre-combat hand selection
- Build long-term build planning views
- Add scenario/event guidance
- Improve build guide coverage (more classes, more guides)

**Deliverable:** Full feature set working

### Phase 5: Polish & Additional Requirements
**Goal:** Make it production-ready

**Tasks:**
- Implement spoiler protection system
- Build offline capability (PWA, caching)
- Add share/export features
- Improve mobile UX (voice input, responsive design)
- Add user authentication
- Optimize performance and costs
- Testing and bug fixes

**Deliverable:** Production-ready application

### Phase 6: Launch & Iterate
**Goal:** Real users, feedback, improvements

**Tasks:**
- Deploy to production
- User testing with real Frosthaven campaigns
- Gather feedback
- Fix issues
- Add quality-of-life improvements
- Monitor costs and optimize

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
1. **frosthaven-storyline.com scraping reliability**
   - Site may change structure, breaking scraper
   - Mitigation: Build resilient parsing, alert on failures, maintain fallback to manual entry

2. **Build guide quality and maintenance**
   - Community guides may be outdated or low quality
   - Mitigation: Curate list of trusted guides, allow user to specify guide, periodic review

3. **Claude API costs**
   - Usage could exceed budget if popular
   - Mitigation: Implement caching, optimize prompts, rate limiting, consider smaller model for simple queries

4. **Character state parsing complexity**
   - May be difficult to extract all needed data accurately
   - Mitigation: Start with core data (level, cards, items), expand gradually, user can correct errors

### Product Risks
1. **User adoption**
   - Frosthaven players might prefer forums/guides
   - Mitigation: Focus on convenience (voice, mobile), personalized advice, faster than searching

2. **Spoiler management**
   - Users might want different spoiler preferences
   - Mitigation: Make spoiler settings configurable, default to safe

3. **Rules accuracy**
   - Agent might give wrong rules interpretations
   - Mitigation: Always cite rulebook page numbers, allow user feedback on wrong answers, improve RAG

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
