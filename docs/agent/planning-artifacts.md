<!-- Indexed from CLAUDE.md — see the routing table there. -->

# Planning artifacts

Plan reviews and tech specs follow a hybrid lifecycle:

1. **During implementation** — tech specs and decision checkpoints live in
   `docs/plans/<project-slug>-tech-spec.md` and
   `docs/plans/<project-slug>-review-checkpoint.md`. Implementing agents read
   them directly from the repo. Linear issues link to them.
2. **Post-merge** — promote load-bearing content (architectural decisions, data
   lifecycle, patterns) into `docs/ARCHITECTURE.md` (or `SECURITY.md` /
   `SPEC.md` as appropriate) as permanent sections, then **delete** the
   `docs/plans/` files. Git history preserves them. `docs/plans/` is a
   staging area, not a graveyard.
3. **For interactive decision logs only (no implementer-facing content)** —
   prefer Linear project documents. They auto-archive when the project closes.

Plan-eng-review and similar review skills should write to `docs/plans/` by
default, and surface this lifecycle to the user in the final summary so the
post-merge cleanup doesn't get forgotten.

**Decisions that come out of a plan review** belong in ADRs, not in
`docs/plans/`. `docs/plans/` artifacts are implementer-facing and get
deleted; ADRs are the permanent home for the _why_. See
[adrs.md](adrs.md).

## Markdown formatting

The pre-commit hook runs staged Markdown fixers (`prettier --write` then
`markdownlint-cli2 --fix`) on staged `.md` files, so table spacing and most
style issues are auto-corrected at commit time.

One thing the hook cannot auto-fix: **MD040 (fenced-code-language).**
Always specify a language on fenced code blocks. Use `text` for ASCII
diagrams, test lists, and non-executable blocks. Bare ` ``` ` will
fail the hook and require a manual edit.

This applies to generated artifacts too (plan docs, review docs, design
docs, test plans). External artifacts written to `~/.gstack/projects/`
that are later copied into the repo should also follow this rule.
