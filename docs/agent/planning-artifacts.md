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
