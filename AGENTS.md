# Squire Project

## Required first read

Before doing any repo work, read the shared baseline:

- [docs/agent/agent-baseline.md](docs/agent/agent-baseline.md)

Do not start task-specific workflows, including `/ship`, `/review`, code
changes, or repo investigation, until you have read that baseline and then
loaded any task-specific docs it routes to.

This file only records Codex-specific adapter details.

## Codex-specific notes

- Machine-level MCP like Linear belongs in `~/.codex/config.toml`, not in this
  repo.
- Codex supports skills in this environment, but not the Claude-style
  `/skill-name` command convention. When repo guidance references a `gstack`
  skill, interpret it as the canonical workflow intent, then use the nearest
  Codex-native equivalent if exact slash-command invocation is unavailable.
- Claude-specific hooks and permissions config in `.claude/` do not carry over
  automatically into Codex.
