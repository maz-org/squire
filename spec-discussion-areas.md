# Product Spec Discussion Areas

**Date:** 2026-01-11
**Status:** Under Review

This document captures detailed concerns about the Frosthaven Assistant Agent product specification that need decisions before implementation.

---

## 1. Scraping frosthaven-storyline.com

**The Core Problem:**
The spec describes using a sharing URL system with session/cookie persistence. This has several technical challenges:

**Concern A: Session Management Complexity**
- The sharing URL likely works by setting cookies in the browser when you visit it
- Your backend scraper (Playwright/Puppeteer) needs to:
  1. Visit the sharing URL to establish session
  2. Store the cookies/local storage
  3. Reuse those credentials for future requests
  4. Detect when session expires and re-authenticate
- This is fragile because:
  - Sessions may expire unpredictably (timeout, server-side invalidation)
  - Site updates could change auth mechanism
  - Each user needs their own session context (can't share across users)

**Concern B: Performance & Resource Usage**
- Running a headless browser (Playwright/Puppeteer) for every character data fetch is expensive:
  - Memory: Each browser instance uses 50-100MB RAM
  - CPU: Rendering pages, executing JavaScript
  - Latency: 2-5 seconds per request vs milliseconds for API calls
- If you have 10 concurrent users asking about characters, you need 10 browser instances

**Concern C: Scraping Reliability**
- HTML structure changes will break your parsers
- No API contract means any site update could break functionality
- Error handling becomes complex (is it auth? parsing? network?)
- Testing is difficult (need mock HTML responses, hard to cover edge cases)

**Concern D: Rate Limiting & Detection**
- Websites may detect automated scraping and block or throttle
- No clear terms of service around programmatic access
- Could get your IP blocked

**Alternatives to Consider:**
1. **Manual data entry fallback**: Users paste their character data or enter it manually
2. **Browser extension approach**: Extension runs in user's browser, extracts data, sends to your API
3. **Contact site owners**: Ask if API access is possible or if they'd support your use case
4. **Proxy through user's browser**: Have frontend fetch and send data to backend (avoids server-side scraping)

**What I need from you:**
- Are you comfortable with the fragility and maintenance burden of scraping?
- Should we plan for manual entry as primary with scraping as convenience feature?
- Do you want to reach out to frosthaven-storyline.com owners first?
- What's the fallback plan when scraping breaks?

---

## 2. 100% Test Coverage Requirement

**The Core Problem:**
Your CLAUDE.md requires 100% test coverage, but this project has several components that are extremely difficult to test comprehensively:

**Concern A: LLM Non-Determinism**
- Claude API responses are non-deterministic
- Testing "does the agent give good card recommendations" requires:
  - Mocking Claude API (loses test value - you're testing your mock)
  - OR using real Claude API (expensive, slow, non-deterministic)
- Example test challenge:
  ```typescript
  test('recommends correct card for level 4 Drifter', async () => {
    const recommendation = await agent.recommendCard(...)
    expect(recommendation).toBe(???) // What exactly do we assert?
  })
  ```

**Concern B: Scraping Components**
- Testing HTML parsers requires:
  - Fixture HTML files (brittle, need updating when site changes)
  - Mock browser contexts
  - Edge case coverage (what if field is missing? malformed? different format?)
- Can achieve coverage but tests might pass while real scraping fails

**Concern C: Integration Points**
- Voice recognition (browser API - can't test in Node)
- PWA service workers (complex testing environment)
- Browser local storage/IndexedDB
- External API calls (worldhaven GitHub, Claude API, etc.)

**Concern D: Cost vs. Value**
- Getting 100% coverage on a RAG pipeline or LLM agent wrapper might mean:
  - Mocking every LLM call (not testing real behavior)
  - Complex test fixtures that are maintenance burdens
  - Tests that pass but don't catch actual bugs
- Is 100% coverage of lines meaningful if you're not testing real behavior?

**Possible Approaches:**
1. **Tiered coverage requirements:**
   - 100% for core business logic (card comparison, filtering, scoring)
   - 80% for integration layers (API clients, scrapers)
   - E2E tests for LLM agent behavior (not counted in coverage)

2. **Mock external services but test integration logic:**
   - Mock Claude API but test prompt construction, tool use, response parsing
   - Mock frosthaven-storyline but test data extraction logic
   - Test deterministic parts thoroughly

3. **Separate unit vs integration tests:**
   - Unit tests: pure functions, business logic, data transformations (100% coverage)
   - Integration tests: real APIs, scrapers, LLM (focus on critical paths, not coverage %)
   - E2E tests: full flows with mocked external services

**What I need from you:**
- Should we relax 100% coverage for certain module types (integrations, LLM wrappers)?
- Are you okay with extensive mocking, or do you want real API tests?
- How do you want to handle non-deterministic LLM testing?
- Should we define coverage tiers by module type?

---

## 3. Build Guide Parsing

**The Core Problem:**
The spec says "auto-discover popular class guides from r/Gloomhaven subreddit" and "parse Google Docs" - this is highly fragile.

**Concern A: Google Docs Parsing**
- Google Docs aren't designed for programmatic access
- Exporting options:
  1. **HTML export**: Complex markup, inconsistent structure, changes with doc formatting
  2. **Plain text export**: Loses structure (tables, headings, lists)
  3. **PDF export**: Text extraction is messy
- Each guide author formats differently:
  - Some use tables, some use bullet lists
  - Different heading styles, abbreviations, terminology
  - Images vs text for card names

**Concern B: Reddit Discovery**
- Reddit API has rate limits
- Posts might be scattered across multiple subreddits
- Link rot (guides deleted, moved, made private)
- How do you identify "popular" and "quality" guides?
- How often do you re-scan?

**Concern C: Content Variability**
- Example level 4 recommendation variations:
  - "Take Card A" (simple)
  - "Card A is better for most builds, but if you're going melee-heavy take Card B" (conditional)
  - "I prefer Card A, but both are viable" (opinion)
  - "50% Card A, 50% Card B" (ambiguous)
- How do you parse conditional logic, alternatives, and nuance?

**Concern D: Maintenance Burden**
- Each parser breaks when author updates formatting
- Need to monitor for broken parsers
- Manual curation likely required anyway

**Alternatives:**
1. **Manual curation:**
   - Maintain curated list of 2-3 trusted guides per class
   - Manually transcribe into structured format (JSON/database)
   - Update quarterly or when major guides are published
   - Pro: Reliable, testable, quality-controlled
   - Con: Manual work, slower to add new guides

2. **Community contribution:**
   - Build tool for users to submit/structure guides
   - Crowdsource guide data entry
   - Voting/rating system for quality
   - Pro: Scales with community
   - Con: Requires moderation, UI development

3. **Hybrid approach:**
   - Start with 1-2 manually entered guides per class
   - Build parser for specific popular guides (tested with fixtures)
   - Add auto-discovery as enhancement later
   - Accept that some classes may not have guides initially

4. **No build guides initially:**
   - Start with raw card data and LLM reasoning only
   - Add build guide integration in Phase 2/3 once data model is proven
   - Less scope for MVP

**What I need from you:**
- Manual curation vs automated parsing preference?
- Acceptable number of guides per class for MVP (1? 3? 10?)
- Willing to manually transcribe guides, or must be automated?
- Is this a Phase 1 feature or can it wait until Phase 2/3?

---

## 4. Voice Input on Mobile

**The Core Problem:**
The spec says "Browser speech recognition API" as primary input method, but this has significant limitations.

**Concern A: Browser Support**
- Web Speech API support varies:
  - **Chrome/Edge (mobile & desktop)**: Good support
  - **Safari (iOS)**: Partial support, requires user interaction to start
  - **Firefox**: No support (as of 2024/early 2025)
  - **Other browsers**: Spotty
- Users on unsupported browsers get degraded experience

**Concern B: Privacy & Permissions**
- Requires microphone permission (scary permission prompt for some users)
- Some users uncomfortable with voice in public/group settings
- Privacy-conscious users may refuse permission

**Concern C: Accuracy & Context**
- Speech recognition struggles with:
  - Frosthaven terminology (character names, card names, game terms)
  - Background noise (typical gaming environment)
  - Accents, speech patterns
- Example: "I'm playing Drifter" might be heard as "I'm playing grifter/drifting/etc."
- Custom vocabulary isn't easily added to Web Speech API

**Concern D: User Experience**
- Need visual feedback (listening indicator, transcription display)
- Correction mechanism when recognition is wrong
- Push-to-talk vs continuous listening?
- Handling partial/incomplete sentences

**Reality Check:**
- Voice is a convenience feature, not core functionality
- Most users will likely default to text (faster, more precise, private)
- Voice might be 10-20% of actual usage even if implemented well

**Options:**
1. **Text-only for MVP:**
   - Focus on excellent text chat experience
   - Add voice in Phase 4/5 as enhancement
   - Reduces scope and testing complexity
   - Ensures works for all users

2. **Voice as progressive enhancement:**
   - Implement voice but treat as optional feature
   - Graceful fallback to text
   - Don't optimize for voice-first UX
   - Test primarily with text input

3. **Full voice commitment:**
   - Implement custom wake word, push-to-talk
   - Build terminology dictionary
   - Extensive testing across devices
   - Accept higher development cost

**What I need from you:**
- Is voice input must-have for MVP, or can it be Phase 2+?
- If must-have, are you okay with limited browser support?
- Text-first with voice as enhancement acceptable?
- How much dev time is voice worth vs other features?

---

## 5. Spoiler Protection Complexity

**The Core Problem:**
Frosthaven has locked classes, hidden events, secret scenarios - spoiler protection is architecturally complex.

**Concern A: Tracking Granularity**
You need to track:
- Which classes user has unlocked (starting 6 vs locked classes)
- Which scenarios completed (affects future unlocks)
- Which events seen (some reveal info about classes/items)
- Prosperity level (affects item availability)
- Personal quest progress (unlocks classes)
- Campaign achievements (unlock story content)

**Concern B: Data Model Complexity**
Every piece of content needs spoiler metadata:
```typescript
{
  classId: "locked-class-1",
  spoilerLevel: "requires-scenario-45", // Or "requires-class-unlock-2"
  name: "???", // Hidden until unlocked
  cards: [...] // Hidden until unlocked
}
```

- Worldhaven data doesn't include spoiler metadata by default
- You need to manually tag everything with unlock conditions
- Miss one tag and you've spoiled content

**Concern C: LLM Prompt Complexity**
- Claude needs to know what NOT to mention:
  - "Don't mention class names the user hasn't unlocked"
  - "Don't reference scenario 45 outcomes"
  - "Don't suggest items from prosperity 4 if user is prosperity 2"
- System prompt becomes complex and fragile
- Claude might accidentally hint at locked content despite instructions
- Hard to test comprehensively

**Concern D: User Experience Edge Cases**
- User: "What's the best tank class?"
  - If they haven't unlocked the best tank, do you:
    - Recommend available options only?
    - Say "there's a better option you haven't unlocked yet"?
    - Ask permission to spoil?
- Friend tells user about locked class, now user wants info:
  - How do they override spoiler protection?
  - Do you verify they actually unlocked it in-game?

**Concern E: Maintenance**
- Every new scenario/event/class needs spoiler tagging
- Errata and rule changes might affect unlock conditions
- Community discovers new interactions/unlocks
- You need to stay current with all content

**Options:**
1. **No spoiler protection for MVP:**
   - Warn users "This tool contains spoilers for all Frosthaven content"
   - Users self-regulate what they ask about
   - Add spoiler protection in Phase 5 once core features work
   - Pro: Dramatically simpler, faster to ship
   - Con: Could spoil content for users

2. **Simple spoiler protection:**
   - Only protect locked classes (biggest spoiler risk)
   - Ignore scenario/event spoilers (user discretion)
   - Binary: "show locked classes" checkbox in settings
   - Pro: 80% benefit, 20% complexity
   - Con: Still possible to get spoiled on locked classes

3. **Full spoiler protection:**
   - Implement as specified (track unlocks, filter content, LLM guards)
   - Accept development cost and complexity
   - Make it a core feature from Phase 1
   - Pro: Best user experience
   - Con: High implementation cost, ongoing maintenance

4. **Community-driven approach:**
   - Users manually mark what they've unlocked in settings
   - Honor system rather than tracking from frosthaven-storyline
   - Reduces dependency on scraping campaign state
   - Pro: Simpler, user control
   - Con: Relies on user honesty/accuracy

**What I need from you:**
- How critical is spoiler protection for MVP launch?
- Acceptable to launch with warning + user discretion?
- Full implementation vs simple (locked classes only)?
- Manual user settings vs automated tracking?

---

## Decisions

### 1. Scraping frosthaven-storyline.com - DECIDED

**Approach: Screenshot-based data extraction using Claude Vision API**

**Implementation:**
- User captures ~5 screenshots from known pages on frosthaven-storyline.com
- Screenshots cover: character sheet, inventory, cards, campaign progress, etc.
- Handle vertical scrolling (multiple captures per page if needed)
- User uploads screenshots via web UI (manual for MVP)
- Backend sends screenshots to Claude API with structured extraction prompt
- Claude returns structured JSON with character data
- Backend validates and caches results
- Display "Last synced: X hours ago" in UI

**Sync Strategy:**
- User-initiated refresh (button in UI: "Sync Character Data")
- Frequency: 1-2x per week (after play sessions)
- Not automatic - user controls when to update

**MVP vs Future:**
- **Phase 1 (MVP)**: Manual screenshot upload via web form
  - Validates Claude can reliably extract data structure
  - Simpler to build and test
  - User takes screenshots, uploads them
- **Phase 2+**: Browser extension for automated capture
  - Extension auto-captures from known pages
  - One-click sync experience
  - Better UX once extraction proven

**Fallback:**
- Manual data entry form always available
- If screenshot extraction fails, user can manually enter key data (class, level, gold, prosperity)

**Cost:**
- ~$0.15-0.30 per character sync (5 screenshots × vision API cost)
- Acceptable for 1-2x/week frequency per user

---

### 2. 100% Test Coverage Requirement - DECIDED

**Approach: Tiered coverage requirements using test pyramid**

**Coverage Tiers:**
- **Core business logic** (card comparison, filtering, scoring, data transformations): **100% coverage required**
- **Integration layers** (API clients, data extraction, parsers): **80-90% coverage target**
- **LLM wrappers** (prompt construction, response parsing): **Test deterministic parts, mock LLM responses**

**Testing Strategy:**

**Unit Tests (majority of tests):**
- Pure functions, business logic, data transformations
- 100% coverage requirement
- Fast, deterministic
- All external services mocked
- Run on every commit

**Integration Tests (moderate number):**
- API client logic, data extraction flows
- External services mocked (Claude API, GitHub API, etc.)
- Test error handling, retries, data validation
- 80-90% coverage target
- Run on every commit

**E2E Tests (small number):**
- Full user flows with real third-party API calls
- Include real Claude API calls for screenshot extraction and recommendations
- **LLM-as-judge approach** for evaluating agent outputs
  - Another LLM call evaluates if agent's response meets quality criteria
  - Handles non-deterministic outputs gracefully
- NOT counted in coverage metrics
- Run on **daily schedule in CI**, not on every commit (to control API costs)

**Test Pyramid Distribution:**
- ~70% unit tests (mocked, fast, 100% coverage)
- ~25% integration tests (mocked external APIs, 80-90% coverage)
- ~5% E2E tests (real APIs, daily CI, LLM-as-judge)

**Mocking Strategy:**
- Mock Claude API responses in unit/integration tests
- Create realistic fixtures for common responses
- Test prompt construction and response parsing separately from LLM behavior
- Real API calls reserved for daily E2E validation

---

### 3. Build Guide Parsing - DECIDED

**Approach: On-demand web fetch, no parsing required**

**Implementation:**
- Maintain curated list of known build guide URLs (Google Docs, Reddit posts, etc.)
- Agent uses web search/fetch tool to read guides on-demand
- No scraping, parsing, or structured data extraction needed
- Claude reads and understands guides in their native format
- Store guide URLs and metadata (class, build archetype, author) in database

**MVP Approach:**
- **Phase 1**: Web search/fetch for guide access
  - Agent fetches guide when user asks for build advice
  - Reads content directly, no pre-processing
  - Simple, leverages Claude's document understanding

**Fallback/Enhancement:**
- **If web fetch performance is insufficient**: Add RAG system
  - Export guides to PDF
  - Chunk and embed guide content
  - Vector search for relevant guide sections
  - Only implement if web fetch proves too slow or unreliable

**Guide Curation:**
- Manually curate list of quality guides per class
- Store URLs, not content
- Update list when new popular guides emerge
- No automated discovery needed - finite, known set of guides

**Advantages:**
- No brittle parsing logic
- No maintenance burden when guides update
- Leverages Claude's native document understanding
- Simple to implement and test

---

### 4. Voice Input on Mobile - DECIDED

**Approach: Must-have for Phase 1, progressive enhancement**

**Priority:**
- Voice input is **required for Phase 1**
- Core use case: voice during gameplay, text before/after sessions
- Both input modes should be equally polished and functional

**Browser Support Strategy:**
- **Chrome/Edge**: Primary target, ensure excellent experience
- **Safari**: Support where Web Speech API works, accept limitations
- **Firefox**: Graceful degradation to text-only (no voice support)
- Progressive enhancement - feature detection, fallback to text

**Implementation:**
- Web Speech API for voice recognition
- Clear visual feedback (listening indicator, live transcription)
- Easy toggle between voice and text input
- Both input methods accessible and well-designed
- Handle recognition errors gracefully (show what was heard, allow correction)

**Acceptance Criteria:**
- Voice works reliably in Chrome (primary browser)
- Text input always available as alternative
- Clear indication when voice is/isn't available
- Smooth UX switching between input modes
- Handles Frosthaven terminology reasonably well (accept some errors, user can correct)

---

### 5. Spoiler Protection Complexity - DECIDED

**Approach: Skip for MVP, add later if needed**

**Phase 1 (MVP):**
- **No spoiler protection implemented**
- Display clear warning: "This tool may contain spoilers for Frosthaven content including locked classes, scenarios, and events"
- User discretion - users self-regulate what they ask about
- Focus development effort on core recommendation features

**Future Enhancement (Phase 2+):**
- If spoiler protection becomes important, can be added later
- Screenshot extraction already captures unlock state (character progress, prosperity, completed scenarios)
- Data is available for filtering if needed in the future
- Low priority compared to core functionality

**Rationale:**
- Reduces MVP complexity significantly
- Most users likely playing through campaign and comfortable with seeing all content
- Can add sophisticated filtering later if user feedback indicates it's valuable
- Screenshot data already supports future implementation
