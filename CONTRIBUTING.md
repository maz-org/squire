# Contributing

This guide walks you through setting up the Squire development environment on a
fresh macOS install (Tahoe or later). By the end you'll be able to run the RAG
pipeline, execute tests, and submit pull requests.

## Prerequisites

### Homebrew

Open Terminal and install [Homebrew](https://brew.sh):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the on-screen instructions to add Homebrew to your PATH. Close and reopen
Terminal, then verify:

```bash
brew --version
```

### Git

macOS Tahoe includes Apple Git. That works fine, but if you want a newer version:

```bash
brew install git
```

### Node.js (via nvm)

This project requires Node.js 24. We use [nvm](https://github.com/nvm-sh/nvm)
to manage Node versions:

```bash
brew install nvm
```

Add nvm to your shell profile. For zsh (the macOS default):

```bash
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc
source ~/.zshrc
```

Install the project's Node version:

```bash
nvm install    # reads .nvmrc → installs Node 24.14.0
nvm use
node --version # should print v24.14.0
```

### GitHub CLI

Used for working with pull requests and issues:

```bash
brew install gh
gh auth login
```

## Getting started

### Clone the repo

```bash
git clone https://github.com/maz-org/squire.git
cd squire
```

### Clone the worldhaven game data

[Worldhaven](https://github.com/any2cards/worldhaven) provides card images and
item data used by the extraction pipeline:

```bash
git clone https://github.com/any2cards/worldhaven.git data/worldhaven
```

### Install dependencies

```bash
npm install
```

This also sets up [Husky](https://typicode.github.io/husky/) git hooks via the
`prepare` script. The pre-commit hook runs typechecking, linting, and tests
automatically.

### Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```text
ANTHROPIC_API_KEY=sk-ant-...
```

**Getting an Anthropic API key:**

1. Sign up at [console.anthropic.com](https://console.anthropic.com/)
2. Go to **Settings → API Keys**
3. Click **Create Key**, give it a name, and copy the key
4. You'll need to add credits to your account — the query pipeline uses Claude
   Opus and the extraction pipeline uses Claude Haiku

**Getting Langfuse keys (optional — for tracing and evals):**

1. Sign up at [cloud.langfuse.com](https://cloud.langfuse.com/)
2. Create a new project
3. Go to **Settings → API Keys** and create a key pair
4. Add all three values to `.env`:

```text
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASEURL=https://us.cloud.langfuse.com
```

### Index the rulebooks

This chunks and embeds the Frosthaven PDFs into a vector index. Takes a few
minutes on first run:

```bash
npm run index
```

### Extract card data (optional)

OCR-extracts structured data from card images using Claude Haiku. Takes ~30
minutes and costs a few dollars in API usage:

```bash
npm run extract
```

You only need to run this if you're working on the extraction pipeline or want
fresh card data.

## Development

### Running the query pipeline

```bash
npm run query "What does the Poison condition do?"
```

### Running tests

```bash
npm test              # run once
npm run test:watch    # watch mode
```

### Type checking

```bash
npm run typecheck
```

### Linting and formatting

```bash
npm run lint          # ESLint
npm run lint:md       # markdownlint
npm run format        # Prettier (auto-fix)
npm run format:check  # Prettier (check only)
```

### Running evaluations

The eval framework measures RAG answer quality using LLM-as-judge scoring. Each
question is sent through the full RAG pipeline, then a separate Claude call
grades the answer against expected results on a 1–5 scale. Results are tracked
in Langfuse so you can compare runs over time.

Requires Langfuse credentials in `.env`.

**Seed the dataset (first time only):**

```bash
npm run eval -- --seed
```

Uploads the 15 question/answer pairs from `eval/dataset.json` to your Langfuse
project. You only need to do this once, or again if you add new eval cases.

**Run all eval cases:**

```bash
npm run eval -- --name="baseline"
```

Runs every question through the pipeline and grades it. Use `--name` to label
the run — this is how you'll find it in the Langfuse UI. Run this before and
after making changes to measure impact (e.g., `--name="before chunking fix"` and
`--name="after chunking fix"`).

**Run a single category:**

```bash
npm run eval -- --category=rulebook
```

Only runs questions in that category (`rulebook`, `monster-stats`, `items`,
`buildings`, `scenarios`). Useful when you're working on a specific part of the
pipeline — e.g., run `--category=items` after fixing item number extraction.

**Run a single question:**

```bash
npm run eval -- --id=rule-poison
```

Runs one specific eval case by ID (IDs are in `eval/dataset.json`). Useful for
debugging a single failure without waiting for the full suite.

## Pre-commit hooks

The pre-commit hook runs automatically on every commit:

1. `tsc --noEmit` — type checking
2. `lint-staged` — ESLint + Prettier on staged `.ts`/`.js` files, markdownlint
   on staged `.md` files
3. `npm test` — full test suite

If any step fails, the commit is blocked. Fix the issue and try again.

## Submitting changes

1. Create a branch from `main`:

   ```bash
   git checkout -b feat/my-change
   ```

2. Make your changes and commit (pre-commit hooks will validate).

3. Push and open a pull request:

   ```bash
   git push -u origin feat/my-change
   gh pr create
   ```

4. Wait for CI and [CodeRabbit](https://coderabbit.ai) review. CodeRabbit
   auto-approves clean PRs.

5. Address any review comments, then merge via squash.

### PR guidelines

- Keep PRs small and focused — one logical change per PR.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit
  messages (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`).
- All CI checks must pass before merging.

## Project layout

```text
src/           TypeScript source (runs natively on Node 24)
test/          Unit tests (vitest)
eval/          Evaluation framework and dataset
docs/          Frosthaven PDFs (rulebook, scenario/section books)
data/          Game data and generated artifacts (mostly gitignored)
.github/       CI workflows, Dependabot config
```
