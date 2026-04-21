# Worktree setup adapters

How Codex and Claude Code bootstrap a fresh linked worktree so it is ready for
development. The isolation design itself lives in the app — see below — so the
adapter's only job is to run the same handful of commands in a fresh checkout.

## Where isolation actually comes from

The **app** handles per-worktree isolation at startup, not the setup script.
[src/worktree-runtime.ts](../../src/worktree-runtime.ts) derives a stable slug
(`sha256(checkoutRoot).slice(0, 8)`) from the checkout path and uses it to
compute:

- Dev DB name: `squire_<slug>` (or bare `squire` for the main checkout)
- Test DB name: `squire_<slug>_test`
- Preferred port: `4000 + (slug_hex % 2000)` (3000 for main)
- Port claim file: `<PORT_CLAIM_DIR>/<port>.json`, created with `open(… 'wx')`
  for atomic lock semantics, with dead-pid cleanup on collision

The port claim directory defaults to `~/.codex/port-claims/squire/` and is
overridable via `SQUIRE_PORT_CLAIM_DIR`. The `~/.codex/` path is historical —
the registry is shared across every agent adapter and is not Codex-specific.

The user-facing view of this (env overrides, managed DB names, reset semantics)
lives in [DEVELOPMENT.md](../DEVELOPMENT.md#local-environment).

## What the setup script has to do

Given the app handles isolation, bootstrap is small:

1. Activate the project's Node version (`nvm use` against `.nvmrc`).
2. Symlink `.env` from the source tree so the worktree inherits secrets.
3. `npm install --ignore-scripts` (husky hooks would otherwise refuse to
   install into a linked worktree).
4. Bring up the **one** shared `squire-postgres` container.
5. Run `db:migrate` and `db:migrate:test` — both are worktree-aware and create
   `squire_<slug>` / `squire_<slug>_test` on first run.
6. `npm run seed:dev` — upsert card data, scenario/section book records, and
   the dev user used by the `/dev/login` preview-mode bypass. All three
   seed scripts are idempotent (targetless `ON CONFLICT DO NOTHING`), so
   re-running on subsequent startups no-ops.
7. `npm run index` — extract + embed the Frosthaven PDFs into the per-worktree
   dev DB's vector store. Hash-keyed per source file, so the first run takes a
   minute or two and subsequent runs are an instant "Skipping (already
   indexed)" sweep. **Best-effort:** the first run downloads
   `Xenova/all-MiniLM-L6-v2` (~40MB). Both adapters wrap the command so that a
   network failure doesn't block the dev server — `/chat` errors until
   `npm run index` succeeds, but the rest of the app comes up.

Steps 6 and 7 exist so `/chat` works immediately in a fresh worktree without
a separate manual seed pass. The test DB is intentionally **not** seeded or
indexed — test suites own their fixtures.

Step 4 is the only subtle one: `docker-compose.yml` hardcodes
`container_name: squire-postgres` and binds host port `5432:5432`, so every
checkout must share the same container. The setup script must run
`docker compose up -d` against the project name `squire`.

## Codex adapter

Defined in [`.codex/environments/environment.toml`](../../.codex/environments/environment.toml).
Codex runs `setup.script` on worktree creation.

```toml
[setup]
script = '''
source "$HOME/.nvm/nvm.sh"
nvm use
ln -sfn "$CODEX_SOURCE_TREE_PATH/.env" .env
npm install --ignore-scripts
docker compose up -d
npm run db:migrate
npm run db:migrate:test
npm run seed:dev
npm run index
'''
```

Codex worktrees live at `~/.codex/worktrees/<hash>/squire/` — the directory
basename is always `squire`, so Docker Compose auto-derives the project name
`squire` from cwd and converges on the shared `squire-postgres` container
without any explicit pinning.

Codex exposes `CODEX_SOURCE_TREE_PATH` and `CODEX_WORKTREE_PATH` to the
script.

## Claude Code adapter

Defined in [`.claude/hooks/worktree-setup.sh`](../../.claude/hooks/worktree-setup.sh)
and wired via `SessionStart` matcher `"startup"` in
[`.claude/settings.json`](../../.claude/settings.json). Claude Code does
expose a `WorktreeCreate` hook, but configuring it **replaces** Claude's
default `git worktree` flow — the hook becomes responsible for actually
producing the worktree and emitting its path. We want Claude's built-in
worktree creation, just with bootstrap on top, so we run the same
idempotent setup on the first `SessionStart` in the new worktree instead.
Subsequent startups are a ~2 s no-op (migrations are the only part that
runs every time).

Two intentional differences from the Codex script:

1. **Source-tree detection**. The hook derives `$source_tree` from
   `git rev-parse --git-common-dir` instead of relying on an injected
   `CODEX_SOURCE_TREE_PATH`. It no-ops in the main checkout (where
   `--git-dir` equals `--git-common-dir`).

2. **`COMPOSE_PROJECT_NAME=squire` is pinned explicitly**. Claude Code
   worktrees live at `.claude/worktrees/<random-name>/` — the basename is
   different for every worktree, so Compose would derive a different project
   name each time and try to stand up a second `squire-postgres` alongside
   the one from the source tree or another worktree. Pinning the project
   name forces every worktree onto the one shared container, matching
   Codex's implicit behavior.

Other than those two points, the commands are identical. Both adapters are
safe to run concurrently on the same machine: the port-claim registry in
`~/.codex/port-claims/squire/` cooperates across tools, and different
checkout paths produce different slugs, so the DB namespaces never collide.

## When to update both adapters

Changes to bootstrap commands (new `db:*` scripts, new services, new env
symlinks) must land in **both** the Codex TOML and the Claude shell script
in the same PR. Please update this doc's "What the setup script has to do"
section at the same time so the single source of truth for the bootstrap
contract stays in sync.

Changes to isolation mechanics (slug derivation, port range, claim
registry) belong in [src/worktree-runtime.ts](../../src/worktree-runtime.ts)
and its tests, not in the adapters.
