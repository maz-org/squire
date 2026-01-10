# Squire Project

This project uses **beads (bd)** for persistent issue tracking across sessions.

## Issue Tracking with Beads

Track ALL work in bd - never use markdown TODOs or comment-based task lists.

**Quick Reference:**
```bash
bd prime                              # Load complete workflow context
bd ready                              # Show issues ready to work (no blockers)
bd list --status=open                 # List all open issues
bd show <id>                          # View issue details with dependencies
bd create --title="..." --type=task --priority=2  # Create new issue
bd update <id> --status=in_progress   # Claim work
bd close <id>                         # Mark complete
bd close <id1> <id2> ...              # Close multiple (more efficient)
bd dep add <issue> <depends-on>       # Add dependency
bd sync --from-main                   # Sync beads from main (ephemeral branches)
```

**Issue Types:** `bug`, `feature`, `task`, `epic`, `chore`

**Priorities:** `0` (critical) to `4` (backlog) - use numbers, NOT "high"/"medium"/"low"

## Session Completion Protocol

**MANDATORY steps before ending session:**

1. **Check what changed**
   ```bash
   git status
   ```

2. **Stage code changes**
   ```bash
   git add <files>
   ```

3. **Sync beads from main** (for ephemeral branches)
   ```bash
   bd sync --from-main
   ```

4. **Commit code changes**
   ```bash
   git commit -m "..."
   ```

**Note:** This is an ephemeral branch workflow. Code changes are merged to main locally, not pushed to remote.

## Workflow

1. Find work: `bd ready` or `bd list --status=open`
2. Review details: `bd show <id>` (shows dependencies)
3. Claim work: `bd update <id> --status=in_progress`
4. Do the work
5. Complete: `bd close <id>`
6. Sync at session end: `bd sync --from-main`

## Creating Issues

- Use `bd create` for multi-session work, dependencies, or discovered tasks
- Use TodoWrite for simple single-session execution tracking
- When in doubt, prefer bd - persistence you don't need beats lost context
- For bulk creation, use parallel subagents for efficiency

## Dependencies

```bash
bd dep add <issue> <depends-on>   # Issue depends on depends-on (depends-on blocks issue)
bd blocked                         # Show all blocked issues
```

## Context Loading

Run `bd prime` for complete AI-optimized workflow documentation. Git hooks auto-inject this context at session start and before compaction.

For more details: `bd --help` or `bd workflow`
