---
route: /docs/cli/mcp
title: Docs - CLI MCP Setup
description: Configure Tiddly MCP servers from the CLI — tiddly mcp configure, status, and remove, plus token management, tool detection, config file locations, scopes, and flags.
---

# CLI MCP Setup

The `tiddly mcp` commands auto-detect installed AI tools and configure MCP servers with dedicated tokens. Supported tools: Claude Desktop, Claude Code, Codex, and Antigravity.

## tiddly mcp configure

Installs Tiddly MCP server entries into AI tool config files. Without arguments, it auto-detects all installed tools and installs both servers. Use `--servers` to choose which servers to install:

```
tiddly mcp configure                               # all tools, both servers
tiddly mcp configure --servers content              # bookmarks & notes server only
tiddly mcp configure --servers prompts              # prompts server only
tiddly mcp configure claude-code                    # specific tool, both servers
tiddly mcp configure claude-code --servers content  # specific tool + server
tiddly mcp configure claude-code codex              # multiple tools
```

### Servers

Tiddly exposes two MCP servers, each with its own set of tools:

- `tiddly_notes_bookmarks` (content server) — search, create, and edit bookmarks and notes
- `tiddly_prompts` (prompt server) — manage and render Jinja2 prompt templates

> [!info]
> **Codex and Prompts**
>
> Codex doesn't support MCP Prompts natively (the `/prompt-name` slash invocation available in Claude Code). Bookmarks and notes still work normally — Codex uses the MCP *tools* to search, read, and edit them just like Claude Code does. But to invoke a saved prompt directly, export it as a Codex Skill: open [Settings → AI Integration](/app/settings/ai-integration), pick Codex, and run the displayed `tiddly skills configure` command. It writes every prompt tagged `skill` as a `SKILL.md` file (default: `~/.agents/skills/`). Codex then surfaces those skills as `$skill-name` invocations — or auto-selects them based on task context. Same template behavior, different invocation surface. See [Skills](/docs/cli/skills).

> [!info]
> **Antigravity (Google)**
>
> Antigravity — Google's successor to Gemini CLI for individual-tier users — is configured with `tiddly mcp configure antigravity`. The `agy` CLI and the Antigravity IDE share one config file (`~/.gemini/config/mcp_config.json`), so configuring once covers both. Antigravity reads the file at startup, so quit and restart the IDE after configuring (the `agy` CLI picks up changes on its next run). Antigravity supports **user scope only**, and like Codex it's a tools-only MCP client (no MCP Prompts). Unlike Codex, it has no Tiddly skills integration, so your prompt templates are accessed through the prompt server's tools (`search_prompts`, `get_prompt_content`) rather than as slash commands or skills.

## tiddly mcp status

Shows MCP server configuration status for each supported tool:

```
tiddly mcp status
```

For each tool and scope, shows:

- **Not detected** — binary or config directory not found
- **Tiddly servers** — lists configured Tiddly MCP servers with their URLs
- **Other servers** — lists non-Tiddly MCP servers with their transport type (http/stdio)
- **No Tiddly servers configured** — shows an install hint

Reads config files directly — no API calls or subprocesses.

## tiddly mcp remove

Removes the CLI-managed entries (`tiddly_notes_bookmarks`, `tiddly_prompts`) from a tool's config file. Other entries pointing at Tiddly URLs under different names (e.g. `work_prompts`) are preserved. A CLI-managed entry is removed regardless of what URL it currently points at.

```
tiddly mcp remove claude-code
tiddly mcp remove claude-code --delete-tokens
```

### --delete-tokens

With `--delete-tokens` (requires OAuth auth), the CLI targets PATs attached to the CLI-managed entries only. PATs attached to other entries are never touched.

1. Reads PATs from the CLI-managed entries before removing them
2. Removes the CLI-managed entries from the config file
3. Revokes matching tokens from your account (matched by prefix and `cli-mcp-` name pattern)

If a CLI-managed PAT is also referenced by a preserved entry, the CLI warns that revoking will break the preserved binding and then proceeds. If a CLI-managed entry's PAT doesn't match any CLI-created server-side token, the CLI prints an informational note referencing that entry.

Without `--delete-tokens`, the CLI warns about potentially orphaned tokens (excluding any that are still in active use by a preserved entry).

**Note:** the shared-PAT warning and orphan-token filter look only at entries whose URL still points at a Tiddly MCP server. If a CLI-managed key has been hand-edited to a non-Tiddly URL, its PAT is invisible to these safeguards.

## Reference

### Token Management

**OAuth users:** The CLI creates a dedicated PAT per tool per server (e.g., Claude Code gets separate tokens for the content and prompt servers). Tokens are named `cli-mcp-{tool}-{server}-{hex}` (e.g., `cli-mcp-claude-code-content-a1b2c3`).

**Re-installs** are safe — the CLI reads existing PATs from config files, validates them, and only creates new tokens when needed.

**PAT users:** The CLI reuses your login PAT for both servers since it cannot create new tokens via the API when authenticated with a PAT. A warning is displayed.

### CLI-managed entries

The CLI creates and manages exactly two entries per tool: `tiddly_notes_bookmarks` (content server) and `tiddly_prompts` (prompt server). These are the only entries `configure` and `remove` will ever touch.

On **configure**, any other entry pointing at a Tiddly URL under a different key name (e.g. a `work_prompts` entry you set up for a second account) is left alone. The summary at the end of a run lists preserved non-CLI-managed entries so you can see what was left unchanged.

**Mismatch safety.** If a CLI-managed key already exists but points at a URL that's not the expected Tiddly URL for its type (e.g. someone hand-edited the entry to a local dev fork), `configure` refuses by default and names the offending entry. Either rename it in the config file to preserve your custom setup, or re-run with `--force` to overwrite. Dry-run previews either path without committing.

On **remove**, the CLI-managed entries are deleted by key name regardless of the URL they currently point at. Other entries — including custom-named entries at Tiddly URLs — are preserved. The prior config is saved to `<path>.bak.<timestamp>` before any write.

> [!info]
> **I have multiple Tiddly entries — what happens on configure?**
>
> Multi-account setups are supported. If you already have entries like `work_prompts` and `personal_prompts` pointing at the Tiddly prompts server with distinct PATs, `tiddly mcp configure` adds the CLI-managed `tiddly_prompts` entry alongside them. Your custom entries keep their PATs and stay bound to the accounts they're already using.

### Tool Detection

| Tool | Detection Method |
| --- | --- |
| Claude Desktop | Config directory exists + `npx` in PATH |
| Claude Code | `claude` binary in PATH |
| Codex | `codex` binary in PATH or `~/.codex/` exists |
| Antigravity | `agy` binary in PATH, or `~/.gemini/antigravity-cli/` / `~/.gemini/antigravity/` exists |

### Config Files Written

| Tool | Config File | Format |
| --- | --- | --- |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) / `%APPDATA%\Claude\claude_desktop_config.json` (Windows) / `~/.config/Claude/claude_desktop_config.json` (Linux) | JSON |
| Claude Code | `~/.claude.json` | JSON |
| Codex | `~/.codex/config.toml` | TOML |
| Antigravity | `~/.gemini/config/mcp_config.json` (shared by the agy CLI and IDE) | JSON |

Config files are written atomically (write-to-temp + rename). Existing config keys and server entries are preserved. Malformed files are backed up to `.bak` before overwriting.

### Scopes

Use `--scope` to control which config level is written. Support varies by tool:

- **user** (default) — available everywhere for the user. Stored in your home directory.
- **directory** — configuration only applies when running tools from a specific directory.

| Scope | Claude Desktop | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- | --- |
| `user` (default) | Global config | `~/.claude.json` top-level | `~/.codex/config.toml` | `~/.gemini/config/mcp_config.json` |
| `directory` | Not supported | `~/.claude.json` under project key | `.codex/config.toml` in cwd | Not supported |

### All Flags

| Flag | Description |
| --- | --- |
| `--servers content,prompts` | Install only specific servers (default: both) |
| `--scope user\|directory` | Config scope (default: user) |
| `--dry-run` | Preview config changes without writing files or creating tokens |
| `--force` | Overwrite a CLI-managed entry that currently points at a non-Tiddly URL or the wrong-type Tiddly URL |
| `--expires` | PAT expiration in days (1-365, or 0 for no expiration) |
