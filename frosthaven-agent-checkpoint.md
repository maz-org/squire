# Frosthaven Agent - Planning Checkpoint

**Session Date:** 2026-01-10
**Status:** Initial Planning Phase

## Project Overview

Building a deep agent to assist with complex Frosthaven gameplay tasks including:

- Character leveling decisions (card selection)
- Inventory optimization
- Build recommendations
- Integration with frosthaven-storyline.com for character/campaign state
- Access to game rules and databases
- Primary interface: Mobile (voice + text)

## Questions & Answers

### Round 1 - Core Approach

**Q: How should agent see character/campaign state?**
A: Agent scrapes frosthaven-storyline.com

- Need to handle authentication
- Need to parse character data from the website
- Should be resilient to site changes

**Q: What should agent optimize for?**
A: Agent should review popular class guides (Google Docs from Gloomhaven subreddit)

- Understand which build guide user is following
- Remember if user deviates from guide
- Understand user's intentions
- Make incremental recommendations with full context
- Synergize with chosen build path

**Q: Interface preference?**
A: Web app (mobile-first)

- Voice input via browser APIs
- Can show card images and detailed comparisons
- Works on any device

**Q: Additional features priority?**
A: ALL of these are important:

- Rules lookup and clarification
- Combat tactics and strategy
- Long-term build planning
- Scenario/event guidance

---

## Key Design Decisions

### Data Sources

1. frosthaven-storyline.com (character/campaign state via scraping)
2. Popular class guides from r/Gloomhaven (Google Docs)
3. Game rules database (TBD - need to source)
4. Cards/items/abilities database (TBD - need to source)

### Intelligence Layer

- Must understand build guides and track which one user follows
- Memory/context persistence across sessions
- Ability to detect and remember deviations from build guide
- Infer user intentions from choices

### Round 2 - Technical Details

**Q: Structured Frosthaven data source?**
A: Use data files from <https://github.com/any2cards/worldhaven>

- Community-maintained card/item/ability data
- Agent scrapes character/campaign from frosthaven-storyline.com

**Q: Authentication approach?**
A: Sharing URL system

- User generates sharing URL from frosthaven-storyline.com
- Agent needs to persist cookies or browser local storage
- Session management required to keep access

**Q: Data refresh strategy?**
A: Session-based caching

- Fetch character data once at session start
- Use cached data throughout conversation
- User can request manual refresh if needed

**Q: MVP scope?**
A: Full featured from start

- Card selection recommendations
- Inventory optimization
- Rules lookup
- Combat tactics
- Build planning
- Scenario guidance

## Technical Architecture Notes

### Data Layer

- **Static Game Data**: any2cards/worldhaven GitHub repo
  - Cards, items, abilities, events
  - Need to parse and load into searchable format
- **Character State**: Scrape from frosthaven-storyline.com
  - Handle sharing URL auth
  - Parse HTML to extract character data (level, XP, gold, items, cards, perks, etc.)
  - Persist session cookies/storage
- **Build Guides**: Google Docs from r/Gloomhaven
  - Need to discover, parse, and index popular guides
  - Extract build recommendations per level
- **Rules Database**: Frosthaven rulebook
  - Need PDF or structured rules text
  - RAG system for semantic search

### Round 3 - Technical Stack

**Q: LLM Provider?**
A: Claude (Anthropic)

- Best reasoning and long context
- Excellent tool use capabilities
- Higher quality for complex game mechanics

**Q: Memory/history persistence?**
A: User account with database

- Full persistence across devices
- Store preferences and conversation history
- Track build guide alignment and deviations

**Q: Recommendation presentation?**
A: Multi-modal approach (all three):

- Show card images (visual reference)
- Detailed comparison tables (stats, synergies)
- Natural language explanations (reasoning)

**Q: Hosting/deployment?**
A: Cloud platform (Vercel/Railway)

- Easy deployment and scaling
- HTTPS included
- ~$10-20/month cost acceptable

### Technical Stack Summary

- **Frontend**: Web app (React/Next.js likely for Vercel)
  - Mobile-first responsive design
  - Voice input via browser APIs
  - Image display for cards/items
- **Backend**: Node.js/Python
  - API endpoints for agent interactions
  - Web scraping for frosthaven-storyline.com
  - Session management
- **Database**: PostgreSQL or similar
  - User accounts and auth
  - Conversation history
  - Cached character state
  - Build guide tracking
- **LLM**: Claude API (Anthropic)
  - Tool use for querying databases
  - RAG for rules lookup
  - Context management for build understanding
- **Data Storage**:
  - Vector DB for rules/guides (Pinecone/Weaviate/pgvector)
  - Static game data from worldhaven repo
  - Card images (CDN or local assets)

### Round 4 - Usage Patterns & Scope

**Q: When is agent used during gameplay?**
A: Three primary contexts:

- Between game sessions (planning, leveling)
- During active gameplay (mid-session help)
- Before starting scenarios (setup, card selection)
- NOT during combat rounds (no real-time tactical advice while selecting cards)

**Q: Multiple character handling?**
A: Infer from conversation context

- Agent should detect character name from conversation
- e.g., "My Drifter just hit level 4" → knows to check Drifter
- Must track multiple characters per user account

**Q: Support other Gloomhaven games?**
A: Frosthaven only for now

- Focus scope on single game
- Can expand later if desired

**Q: Developer's technical background?**
A: TypeScript/JavaScript

- Comfortable with modern web stack
- React, Next.js, Node.js all in comfort zone
- **Decision**: Use TypeScript full-stack

### Round 5 - Feature Details

**Q: Combat tactics detail level?**
A: Pre-combat hand selection

- Help choosing which cards to bring into battle from deck
- Strategic advice, not turn-by-turn
- Considers scenario type, expected enemies, party composition

**Q: How to access build guides?**
A: Auto-discover popular guides

- Agent scrapes/searches r/Gloomhaven
- Indexes popular class guides automatically
- Parses Google Docs for build recommendations
- Challenge: quality control, keeping guides updated

**Q: Inventory optimization priorities?**
A: All four (comprehensive approach):

1. Maximize power for current build (synergy focus)
2. Best use of current gold/resources (what to buy now)
3. Long-term planning (future prosperity items)
4. Suggest when to sell/change items (retirement/upgrade advice)

**Q: Agent personality?**
A: Functional assistant

- Clear, concise, professional tone
- Focus on data and recommendations
- No unnecessary fluff or roleplay

### Round 6 - Constraints & Final Requirements

**Q: Budget constraints?**
A: Moderate budget OK

- $50-100/month acceptable
- Don't over-optimize at expense of features
- Use quality services where appropriate

**Q: Timeline expectations?**
A: Flexible, no rush

- Focus on quality over speed
- Build it right rather than fast
- No hard deadlines

**Q: Additional requirements?**
A: Three critical additions:

1. **Spoiler protection**
   - Hide locked classes, unplayed scenarios, unrevealed content
   - Respect campaign progress
   - Don't reveal future unlocks
2. **Offline capability**
   - Basic functionality without internet
   - Cached game data and rules
   - Graceful degradation when offline
3. **Share/export recommendations**
   - Generate shareable links
   - Screenshot/export agent advice
   - Show recommendations to party members

## Product Specification Complete

**Full specification:** See `frosthaven-agent-product-spec.md`

### Summary

- 6 rounds of Q&A completed
- All major features defined
- Technical architecture planned
- Development phases outlined
- Success metrics established
- Risks and open questions documented

### Key Decisions Made

1. **Platform:** Web app (Next.js + TypeScript)
2. **LLM:** Claude (Anthropic)
3. **Data:** worldhaven GitHub + frosthaven-storyline.com scraping
4. **Deployment:** Vercel/Railway (~$30-90/month)
5. **Scope:** Full-featured MVP (ambitious but comprehensive)
6. **Timeline:** Flexible, quality over speed

### Critical Features

- Card selection with build guide integration
- Inventory optimization (4-way: synergy, current gold, long-term, replacements)
- Pre-combat hand selection
- Rules lookup (RAG)
- Long-term build planning
- Scenario/event guidance
- Spoiler protection
- Offline capability
- Share/export recommendations

### Next Actions

1. Review specification document
2. Set up development environment
3. Begin Phase 1: Foundation & Data Setup
