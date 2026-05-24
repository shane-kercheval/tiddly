---
route: /docs/cli/skills
title: Docs - CLI Skills
description: Export Tiddly prompt templates as agent skills (SKILL.md) — tiddly skills configure and list, per-client behavior, scopes, flags, client constraints, and usage.
---

# CLI Skills

Export your prompt templates as agent skills for AI tools. Skills are SKILL.md files following the [Agent Skills Standard](https://agentskills.io/). They let AI assistants auto-invoke your prompts based on context.

## tiddly skills configure

Installs your prompt templates as SKILL.md files for the target AI tool. By default, only prompts tagged "skill" are installed. Without arguments, it auto-detects all installed tools:

```
tiddly skills configure                                  # auto-detect tools, configure "skill"-tagged prompts
tiddly skills configure claude-code                      # configure for a specific tool
tiddly skills configure claude-code codex                # multiple tools
tiddly skills configure --tags python,skill --tag-match all  # prompts matching all tags (default)
tiddly skills configure --tags python,skill --tag-match any  # prompts matching any tag
tiddly skills configure --tags ""                         # configure all prompts (no tag filter)
tiddly skills configure --scope directory                  # configure to directory-level paths
```

### What happens per client

- **Claude Code:** extracts tar.gz to `~/.claude/skills/` (user) or `.claude/skills/` (directory)
- **Codex:** extracts tar.gz to `~/.agents/skills/` (user) or `.agents/skills/` (directory)
- **Claude Desktop:** saves zip to a temp file for manual upload via Settings → Capabilities

> [!tip]
> **Install Behavior**
>
> Installing is **additive**: new skills are added and existing skills are updated, but skills are never deleted. To remove a skill, manually delete its folder from the skills directory.

## tiddly skills list

Lists prompts eligible for export as skills, showing name and description:

```
tiddly skills list                       # list all available skills
tiddly skills list --tags python         # list skills filtered by tags
```

## Reference

### Scopes

Use `--scope` to control where skills are written:

| Scope | Claude Code | Codex | Claude Desktop |
| --- | --- | --- | --- |
| `user` (default) | `~/.claude/skills/` | `~/.agents/skills/` | N/A (zip download) |
| `directory` | `.claude/skills/` | `.agents/skills/` | Not supported |

### All Flags

| Flag | Commands | Description |
| --- | --- | --- |
| `--tags` | configure, list | Comma-separated tag filter (default: "skill") |
| `--tag-match` | configure, list | "all" (default) or "any" |
| `--scope` | configure | user (default) or directory |

### Client Constraints

| Constraint | Claude Code / Desktop | Codex |
| --- | --- | --- |
| Name max length | 64 chars | 100 chars |
| Description max length | 1024 chars | 500 chars |
| Multi-line description | Preserved | Collapsed to single line |

### Usage

- **Claude Code:** auto-invoked based on context, or trigger with `/skill-name`
- **Codex:** auto-selected based on task context, or invoke with `$skill-name`
- **Claude Desktop:** invoke via natural language (e.g. "use my X skill")

> [!tip]
> **See Also**
>
> For an overview of supported AI tools and connection methods, see the [AI Integration](/docs/ai) docs. For creating prompts to export as skills, see [Prompts & Templates](/docs/features/prompts).
