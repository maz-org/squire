# Contributing

This guide walks you through setting up the Squire development environment on
macOS. We strongly recommend **macOS Tahoe** (the latest version) on Apple
Silicon. These are the only instructions we maintain.

Linux users should be able to adapt these instructions — the toolchain (Node.js,
npm, git) is the same, but you'll use your system package manager instead of
Homebrew. Windows is not supported.

## Accounts you'll need

**GitHub (required)** — for cloning, pull requests, and issues:

Sign up at [github.com](https://github.com/signup) if you don't have an account.

**Anthropic (required)** — powers both Claude Code and the RAG pipeline:

1. Sign up at [claude.ai](https://claude.ai/) for a Claude account
2. Subscribe to **Claude Pro** ($20/mo) or **Claude Max** ($100/mo) — Claude
   Code is included with either plan
3. For API usage (running queries, extraction), you also need API credits. Go to
   [console.anthropic.com](https://console.anthropic.com/), navigate to
   **Settings → API Keys**, create a key, and add billing credits. This is the
   key that goes in your `.env` file as `ANTHROPIC_API_KEY`.

**CodeRabbit (optional)** — for running local code reviews before pushing:

1. Sign up at [coderabbit.ai](https://coderabbit.ai/) using your GitHub account
2. The free tier works for open-source repos

**Langfuse (optional)** — for tracing and evaluation experiments:

All developers share a single Langfuse project so experiment runs can be
compared against a common baseline. Ask
[@bcm](https://github.com/bcm) for the shared project API keys and add them to
your `.env` file.

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
nvm install    # reads .nvmrc → installs Node 24.x
nvm use
node --version # should print v24.x
```

### GitHub CLI

Used for working with pull requests and issues:

```bash
brew install gh
gh auth login
```

`gh auth login` is interactive. When prompted:

1. **Where do you use GitHub?** → `GitHub.com`
2. **Preferred protocol?** → `HTTPS`
3. **Authenticate Git with GitHub credentials?** → `Yes`
4. **How would you like to authenticate?** → `Login with a web browser`
5. It will show a one-time code — press Enter, paste the code in the browser
   window that opens, and authorize the GitHub CLI

### Claude Code

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) is the recommended
way to work on this project. It's an AI coding agent that runs in your terminal,
understands the full codebase, and follows the project conventions defined in
`CLAUDE.md`.

```bash
npm install -g @anthropic-ai/claude-code
```

Log in when you first launch it:

```bash
cd squire
claude
```

Claude Code will open a browser window to sign in with your claude.ai account
(the same one you subscribed to Pro or Max with — this is separate from the API
key in `.env`). Once logged in, it reads `CLAUDE.md` automatically for project-specific
instructions — coding standards, testing requirements, PR workflow, and
CodeRabbit integration.

### CodeRabbit CLI (optional)

[CodeRabbit](https://coderabbit.ai) reviews every PR automatically on GitHub.
You can also run reviews locally from within Claude Code before pushing, which
catches issues early.

```bash
curl -fsSL https://cli.coderabbit.ai/install.sh | sh
```

Authenticate:

```bash
coderabbit auth login
```

This opens a browser window to sign in with your CodeRabbit account. Once
authenticated, the CLI stores your credentials locally. You can verify it worked
with `coderabbit auth status`.

From within a Claude Code session, run the gstack `/review` skill before
pushing your branch. Claude Code will run a structural pre-landing review of
the diff, show you the results, and fix any issues it finds.

## Getting started

### Clone the repo

```bash
git clone https://github.com/maz-org/squire.git
cd squire
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

Edit `.env` and add your API keys (see "Accounts you'll need" above for how to
obtain these):

```text
ANTHROPIC_API_KEY=sk-ant-...

# Google OAuth (required for web UI login — see ADR 0009)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
SESSION_SECRET=<random 32+ character string>
SQUIRE_ALLOWED_EMAILS=your-email@example.com

# Optional — for tracing and evals (ask @bcm for the shared project keys)
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

### Data files

Extracted card data (`data/extracted/`) is committed to the repo as
regular JSON files. Since SQR-56 these are seed inputs only — the
runtime store is the `card_*` tables in Postgres, populated by
`npm run seed:cards`. The JSON files are refreshed automatically by
the weekly CI workflow from GHS upstream data.

The rulebook vector index lives in Postgres (pgvector), not on disk. On
a fresh clone, bring up the local DB and populate it before running the
server:

```bash
docker compose up -d
npm run db:migrate
npm run db:migrate:test   # if you plan to run the test suite in this checkout
npm run index        # chunks + embeds rulebook PDFs into the embeddings table (~2 min)
npm run seed:dev     # seeds card_* tables + a local dev user
```

Main checkout defaults to the `squire` / `squire_test` databases and port
`3000`. Linked worktrees derive checkout-local DB names and a preferred local
port, then coordinate within the managed `4000-5999` range so parallel agents
can run without manual port surgery. Trust `npm run serve` startup output for
the final port.

`npm run seed:dev` is the one-shot local bundle. It chains
`npm run seed:cards` (the prod-relevant default, also aliased as
`npm run seed`) and `npm run seed:dev-user` (inserts a predictable dev
user for testing authenticated paths; refuses to run when
`NODE_ENV=production`).

`npm run index` is idempotent — re-running it skips PDFs that are
already in the `embeddings` table. `npm run seed:cards` is also
idempotent — it upserts on `(game, source_id)`, so stale rows get
overwritten in place. If you change chunking logic, bump
`EMBEDDING_VERSION` in `src/vector-store.ts` and re-run after clearing
the affected sources.

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
npm run lint          # ESLint (src/ test/ scripts/)
npm run lint:css      # stylelint (src/web-ui/**/*.css, Tailwind v4 aware)
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

**Seed the eval dataset (maintainer only):**

```bash
npm run eval -- --seed
```

Uploads the eval dataset (`eval/dataset.json`) to the shared Langfuse project.
This is a one-time project setup step managed by
[@bcm](https://github.com/bcm). It needs to be re-run when eval cases are added
or changed. The command is idempotent — running it again upserts items rather
than duplicating them. Regular contributors don't need to run this.

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
2. `lint-staged` — ESLint + Prettier on staged `.ts`/`.js` files, stylelint +
   Prettier on staged `.css` files, Prettier on staged `.json`/`.yml`/`.yaml`
   files, markdownlint on staged `.md` files
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

4. Wait for CI and [CodeRabbit](https://coderabbit.ai) review.

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
docs/          Project documentation (SPEC, ARCHITECTURE, DEVELOPMENT, SECURITY, CONTRIBUTING)
data/          Game data and generated artifacts (mostly gitignored)
data/pdfs/     Frosthaven PDFs (rulebook, scenario/section books)
.github/       CI workflows, Dependabot config
```

## Changelog

- **2026-04-08:** SQR-36 — local bootstrap swapped from `npm run seed:cards` to `npm run seed:dev`, which chains `seed:cards` and the new idempotent `seed:dev-user` helper (inserts a predictable `dev@squire.local` account for testing authenticated paths). New `seed` alias targets `seed:cards` as the prod-relevant default. The dev-user CLI refuses to run with `NODE_ENV=production`.
- **2026-04-08:** SQR-56 — clarified that `data/extracted/*.json` is now a seed input, not the runtime store. Card data lives in Postgres `card_*` tables; `npm run seed:cards` is the bridge.
- **2026-04-07:** Final-pass cleanup. Removed stale Git LFS install step and `--recurse-submodules` clone flag — extracted card data and the vector index are committed as regular files (not LFS, no submodules) since PR #162.
- **2026-04-07:** Moved from repo root to `docs/CONTRIBUTING.md` as part of the docs consolidation. Added changelog. Updated project layout listing to include CONTRIBUTING alongside the other ALL_CAPS docs.
- **2026-04-07:** Updated project layout description for the SPEC v3.0 / ARCHITECTURE v1.0 docs split.
- **2026-04-07:** Updated to reflect PDF move to `data/pdfs/`.
- **2026-04-06:** Updated to reflect retirement of OCR pipeline and Worldhaven dependency (commit `34a26a1`).
- **2026-04-04:** Migrated data dependencies to git submodules (PR #146). Later replaced with committed extracted data + weekly CI refresh (PR #162).
- **2026-03-22:** Initial CONTRIBUTING guide added alongside Git LFS for data files and Langfuse improvements (PR #17).
