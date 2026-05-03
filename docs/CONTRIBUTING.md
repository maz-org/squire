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
`prepare` script. The pre-commit hook is intentionally lightweight and runs
staged-file checks only; the full repo gate runs at ship time via
`npm run check`.

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
GOOGLE_REDIRECT_URI=http://localhost:4450/auth/google/callback
SESSION_SECRET=<random 32+ character string>
SQUIRE_ALLOWED_EMAILS=your-email@example.com

# Optional — for tracing and evals (ask @bcm for the shared project keys)
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASEURL=https://us.cloud.langfuse.com
LANGFUSE_PROJECT_ID=...
```

Generate `SESSION_SECRET` with:

```bash
openssl rand -base64 48
```

`GOOGLE_REDIRECT_URI` is the fallback callback for production and non-local
hosts. In local development, `/auth/google/start` and
`/auth/google/callback` reuse the current `localhost` origin so linked
worktrees can sign in on their own ports. Google still requires exact
redirect-URI matches, so every localhost callback port you use for browser QA
must be pre-registered in the OAuth client in Google Cloud Console. The
currently allowlisted localhost callback ports are `4450` and `5018`.

### Data files

The checked-in extracts under `data/extracted/` are seed inputs and inspection
artifacts, not the runtime store. At runtime, Postgres holds:

- `card_*` tables for GHS card data (`npm run seed:cards`)
- `scenario_book_scenarios`, `section_book_sections`, and `book_references`
  for exact scenario/section-book lookup (`npm run seed:scenario-section-books`)

The GHS card JSON files are refreshed automatically by the weekly CI workflow.

The Frosthaven book vector index lives in Postgres (pgvector), not on disk. On
a fresh clone, bring up the local DB and populate it before running the
server:

```bash
docker compose up -d
npm run db:migrate
npm run db:migrate:test   # if you plan to run the test suite in this checkout
npm run index        # chunks + embeds Frosthaven book PDFs into the embeddings table (~2 min)
npm run seed:dev     # seeds card_* tables, scenario/section-book tables, and a local dev user
```

Main checkout defaults to the `squire` / `squire_test` databases and port
`3000`. Linked worktrees derive checkout-local DB names and a preferred local
port, then coordinate within the managed `4000-5999` range so parallel agents
can run without manual port surgery. Trust `npm run serve` startup output for
the final port. If you need Google sign-in locally, prefer `PORT=4450` or
`PORT=5018`.

Fresh linked worktrees need that whole bootstrap, not just `npm run serve`.
In practice: install dependencies if this worktree does not have them yet, bring
up Docker, run the migrations, build the embeddings index, and run
`npm run seed:dev` so the checkout has card data, scenario/section-book data,
and the predictable `dev@squire.local` account. Also make sure `.env`
includes `SESSION_SECRET`.
Without it, the anonymous homepage can still load, but authenticated routes
and browser QA fail once session cookies or CSRF checks are exercised.

`npm run seed:dev` is the one-shot local bundle. It chains
`npm run seed` (the prod-relevant default, which runs both
`seed:cards` and `seed:scenario-section-books`) and
`npm run seed:dev-user` (inserts a predictable dev user for testing
authenticated paths; refuses to run when `NODE_ENV=production`).

`npm run index` is idempotent — re-running it skips PDFs that are
already in the `embeddings` table. `npm run seed:cards` is also
idempotent — it upserts on `(game, source_id)`, so stale rows get
overwritten in place. `npm run seed:scenario-section-books` is
idempotent too — it refreshes the scenario/section-book runtime tables
from the checked-in extract. If you change chunking logic, bump
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
`buildings`, `scenarios`, `tool-free`). Useful when you're working on a
specific part of the pipeline — e.g., run `--category=items` after fixing item
number extraction.

**Run a single question:**

```bash
npm run eval -- --id=rule-poison
```

Runs one specific eval case by ID (IDs are in `eval/dataset.json`). Useful for
debugging a single failure without waiting for the full suite.

**Run and compare a model matrix experiment:**

```bash
npm run eval -- --matrix --id=building-alchemist --name=sqr-133-before --local-report=/tmp/sqr-133-before.json
npm run eval -- --matrix --id=building-alchemist --name=sqr-133-after --tool-loop-limit=4 --broad-search-synthesis-threshold=2 --local-report=/tmp/sqr-133-after.json
npm run eval -- --compare-runs=/tmp/sqr-133-before.json,/tmp/sqr-133-after.json
```

Matrix reports include pass rate, score, latency, token use, estimated cost,
tool-call count, retry count, timeout rate, loop iterations, Langfuse trace
links, prompt/tool schema versions, and model knob values. The comparison
command prints deltas by provider/model and rejects comparisons when prompt or
tool schema versions differ; do not mix those runs, because a prompt or schema
change changes more than model tuning.

Tunable eval-only knobs:

- `--max-output-tokens=`
- `--reasoning-effort=`
- `--timeout-ms=`
- `--tool-loop-limit=`
- `--broad-search-synthesis-threshold=`
- `--anthropic-concurrency=` / `--openai-concurrency=`
- `--retry-count=`
- `--max-estimated-cost-usd=` with `--allow-estimated-cost`

## Pre-commit hooks

Git hooks are installed automatically when you run `npm install`. Squire pins
`core.hooksPath` to the checked-in `.husky` directory so linked worktrees use
their own repo-local hooks instead of depending on generated Husky shims from a
different checkout. If hook setup ever drifts in a worktree, repair it with
`npm run hooks:install`.

The pre-commit hook runs automatically on every commit:

1. Conditional `npm run agent:check` when staged files touch the shared
   agent/config surface (`CLAUDE.md`, `AGENTS.md`, `docs/agent/*`, `.mcp.json`,
   or the agent parity/export scripts)
2. `lint-staged` — ESLint + Prettier on staged `.ts`/`.js` files, stylelint +
   Prettier on staged `.css` files, Prettier on staged `.json`/`.yml`/`.yaml`
   files, markdownlint on staged `.md` files

If any step fails, the commit is blocked. Fix the issue and try again.

There is no pre-push hook. Before `/ship` or before a manual push that you
expect to survive CI, run `npm run check`, which is the local equivalent of the
main CI gate:

- `npm run typecheck`
- `npm run lint`
- `npm run lint:css`
- `npm run lint:md`
- `npm run format:check`
- `npm test`

## Submitting changes

1. Create a branch from `main`:

   ```bash
   git checkout -b feat/my-change
   ```

2. Make your changes and commit (the pre-commit hook will run staged-file checks).

3. Run the full local gate before pushing:

   ```bash
   npm run check
   ```

4. Push and open a pull request:

   ```bash
   git push -u origin feat/my-change
   gh pr create
   ```

   Before submitting, edit the PR body so it includes a `Fixes SQR-XX` or
   `Closes SQR-XX` line for the Linear issue you are shipping. That is how
   Linear links the PR back to the issue.

5. Wait for CI and [CodeRabbit](https://coderabbit.ai) review.

6. Address any review comments, then merge via squash.

### PR guidelines

- Keep PRs small and focused — one logical change per PR.
- PR bodies must include `Fixes SQR-XX` or `Closes SQR-XX` so Linear links the
  PR to the issue automatically.
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

- **2026-04-19:** SQR-103 documented the exact scenario/section-book layer. Contributor bootstrap now calls out `npm run seed` / `npm run seed:scenario-section-books`, and the data-files section now explains that Postgres holds both the GHS card tables and the scenario/section-book tables.
- **2026-04-09:** Clarified fresh linked-worktree bootstrap. Authenticated testing needs local dependencies installed plus the full local bootstrap (`npm install`, `docker compose up -d`, migrations, `npm run index`, `npm run seed:dev`) and `SESSION_SECRET`; otherwise the homepage can load while session-backed routes still fail.
- **2026-04-08:** SQR-36 — local bootstrap swapped from `npm run seed:cards` to `npm run seed:dev`, which now chains `npm run seed` and the new idempotent `seed:dev-user` helper (inserts a predictable `dev@squire.local` account for testing authenticated paths). `npm run seed` is the prod-relevant default. The dev-user CLI refuses to run with `NODE_ENV=production`.
- **2026-04-08:** SQR-56 — clarified that `data/extracted/*.json` is now a seed input, not the runtime store. Card data lives in Postgres `card_*` tables; `npm run seed:cards` is the bridge.
- **2026-04-07:** Final-pass cleanup. Removed stale Git LFS install step and `--recurse-submodules` clone flag — extracted card data and the vector index are committed as regular files (not LFS, no submodules) since PR #162.
- **2026-04-07:** Moved from repo root to `docs/CONTRIBUTING.md` as part of the docs consolidation. Added changelog. Updated project layout listing to include CONTRIBUTING alongside the other ALL_CAPS docs.
- **2026-04-07:** Updated project layout description for the SPEC v3.0 / ARCHITECTURE v1.0 docs split.
- **2026-04-07:** Updated to reflect PDF move to `data/pdfs/`.
- **2026-04-06:** Updated to reflect retirement of OCR pipeline and Worldhaven dependency (commit `34a26a1`).
- **2026-04-04:** Migrated data dependencies to git submodules (PR #146). Later replaced with committed extracted data + weekly CI refresh (PR #162).
- **2026-03-22:** Initial CONTRIBUTING guide added alongside Git LFS for data files and Langfuse improvements (PR #17).
