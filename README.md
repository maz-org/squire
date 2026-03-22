# Squire

An AI-powered rules assistant for [Frosthaven](https://cephalofair.com/pages/frosthaven), the tactical dungeon-crawling board game. Ask it rules questions and get accurate, sourced answers.

## What it does

Squire uses retrieval-augmented generation (RAG) to answer Frosthaven rules questions. It searches across:

- **Rulebook** — the complete Frosthaven rule book
- **Scenario & section books** — all 166 scenarios and 197 sections
- **Card data** — 1,900+ cards extracted via OCR (monster stats, abilities, items, events, battle goals, buildings)

When you ask a question, Squire embeds it, searches the vector index and card database for relevant context, then sends everything to Claude for a grounded answer.

## How it works

```text
Question → Embed → Vector Search + Card Search → Claude → Answer
```

1. Your question is embedded using a local transformer model
2. The embedding is compared against ~2,100 indexed chunks from the Frosthaven PDFs
3. Extracted card data is keyword-searched in parallel
4. All retrieved context is sent to Claude, which produces an answer grounded in the source material

All queries are traced with [Langfuse](https://langfuse.com) for observability.

## Setup

Requires Node.js 24+ (uses native TypeScript execution).

```bash
# Clone the repo
git clone https://github.com/maz-org/squire.git
cd squire

# Clone the worldhaven game data (images, PDFs, item data)
git clone https://github.com/any2cards/worldhaven.git data/worldhaven

# Install dependencies
npm install

# Add your API keys
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY (and optionally LANGFUSE_* keys)

# Index the rulebooks (one-time, takes a few minutes)
npm run index

# Extract card data via OCR (one-time, uses Claude Haiku, takes ~30 min)
npm run extract
```

## Usage

### CLI

```bash
npm run query "What does the Poison condition do?"
npm run query "What are the stats of an elite Flame Demon at level 3?"
npm run query "How many small items can I bring into a scenario?"
```

### Discord bot

Squire can run as a Discord bot, answering rules questions from any user in the channel. See `CLAUDE.md` for configuration details.

## Evaluation

Squire includes an evaluation framework for measuring answer quality:

```bash
# Seed the eval dataset to Langfuse (first time)
npm run eval -- --seed

# Run all 15 eval cases
npm run eval -- --name="my experiment"

# Run a subset
npm run eval -- --category=rulebook
npm run eval -- --id=rule-poison
```

Results are tracked in Langfuse with LLM-as-judge scoring (1-5 scale). Current baseline: **73% pass rate, 3.8/5 avg score**.

## Acknowledgments

Game data (card images, PDFs, item databases) comes from [worldhaven](https://github.com/any2cards/worldhaven), a community-maintained collection of Gloomhaven/Frosthaven assets. Squire wouldn't be possible without their work.

## License

This project is for personal/educational use. Frosthaven is a trademark of Cephalofair Games. Game content belongs to its respective owners.
