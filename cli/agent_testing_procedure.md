# CLI Agent Testing Procedure

A structured checklist for an AI agent to systematically test all CLI command, tool, and scope combinations after making CLI changes. This verifies config file correctness, expected output, and no side effects.

## Prerequisites

- [ ] CLI is built: `make cli-build` (verify `bin/tiddly` exists)
- [ ] Authenticated via OAuth: `bin/tiddly login` (required — token creation/deletion tests need OAuth)
- [ ] API is reachable: `bin/tiddly status` shows API status "ok"
- [ ] Note platform-specific config paths:
  - **Linux** (assumed): `~/.config/Claude/claude_desktop_config.json`, `~/.claude.json`, `~/.codex/config.toml`
  - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`, `~/.claude.json`, `~/.codex/config.toml`

## Setup

**NOTE**: the configuration files referenced and tested are the actual files used by the underlying agent platforms and the user. We cannot permanently modify/corrupt the files.

```bash
# Record which tools are detected
bin/tiddly mcp status

# Back up existing config files
BACKUP_DIR=$(mktemp -d)
echo "Backup dir: $BACKUP_DIR"
cp ~/.config/Claude/claude_desktop_config.json "$BACKUP_DIR/" 2>/dev/null || true
cp ~/.claude.json "$BACKUP_DIR/" 2>/dev/null || true
cp ~/.codex/config.toml "$BACKUP_DIR/" 2>/dev/null || true

# Create temp project directory for project/local scope tests
TEST_PROJECT=$(mktemp -d)
echo "Test project dir: $TEST_PROJECT"
```

---

## Test Group 1: Help & Basic Commands

### T1.1 — Root help
```bash
bin/tiddly --help
```
**Verify:**
- [ ] Exit code 0
- [ ] Shows subcommands: `login`, `logout`, `auth`, `status`, `mcp`, `skills`
- [ ] Shows global flags: `--token`, `--api-url`, `--format`

### T1.2 — MCP help
```bash
bin/tiddly mcp --help
```
**Verify:**
- [ ] Exit code 0
- [ ] Shows subcommands: `install`, `status`, `uninstall`

### T1.3 — MCP install help
```bash
bin/tiddly mcp install --help
```
**Verify:**
- [ ] Exit code 0
- [ ] Shows flags: `--dry-run`, `--scope`, `--expires`, `--servers`
- [ ] Shows valid args: `claude-desktop`, `claude-code`, `codex`

### T1.4 — Skills help
```bash
bin/tiddly skills --help
```
**Verify:**
- [ ] Exit code 0
- [ ] Shows subcommands: `install`, `list`

### T1.5 — Status overview
```bash
bin/tiddly status
```
**Verify:**
- [ ] Exit code 0
- [ ] Output includes: `Tiddly CLI v`, `Authentication:`, `API:`, `MCP Servers:`
- [ ] Shows detection status for each tool (claude-desktop, claude-code, codex)

```bash
bin/tiddly status --scope project
```
**Verify:**
- [ ] Exit code 0
- [ ] MCP Servers section reflects project-level config

---

## Test Group 2: Authentication

### T2.1 — Auth status (when logged in)
```bash
bin/tiddly auth status
```
**Verify:**
- [ ] Exit code 0
- [ ] Output contains `Auth method:` (one of: `pat`, `oauth`, `flag`, `env`)
- [ ] Output contains `API URL:`

### T2.2 — Login with invalid PAT format
```bash
bin/tiddly login --token "invalid_no_prefix"
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `invalid token format: must start with 'bm_'`

### T2.3 — Login with bad token
```bash
bin/tiddly login --token "bm_definitely_not_valid_token"
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `token verification failed`

---

## Test Group 3: MCP Install

### Coverage Matrix

| Tool | user | local | project |
|------|------|-------|---------|
| claude-code | T3.1 | T3.5 | T3.4 |
| claude-desktop | T3.8 | unsupported (T9.5a) | unsupported (T9.5b) |
| codex | T3.6 | unsupported (T9.4) | T3.7 |

### T3.1 — Claude Code, user scope (default)
```bash
bin/tiddly mcp install claude-code
```
**Verify:**
- [ ] Exit code 0
- [ ] Output contains `Configured: claude-code`
- [ ] `~/.claude.json` contains `mcpServers.tiddly_notes_bookmarks` with:
  - `"type": "http"`
  - `"url": "https://content-mcp.tiddly.me/mcp"`
  - `"headers"` with `"Authorization": "Bearer bm_..."` (token starts with `bm_`)
- [ ] `~/.claude.json` contains `mcpServers.tiddly_prompts` with:
  - `"url": "https://prompts-mcp.tiddly.me/mcp"`
- [ ] No other tiddly entries added outside `mcpServers`
- [ ] Existing non-tiddly entries in `~/.claude.json` preserved

### T3.2 — Claude Code, user scope, content only
```bash
bin/tiddly mcp install claude-code --servers content
```
**Verify:**
- [ ] Exit code 0
- [ ] `~/.claude.json` contains `mcpServers.tiddly_notes_bookmarks`
- [ ] `~/.claude.json` does NOT contain `mcpServers.tiddly_prompts` (unless from prior test)

### T3.3 — Claude Code, user scope, prompts only
```bash
bin/tiddly mcp install claude-code --servers prompts
```
**Verify:**
- [ ] Exit code 0
- [ ] `~/.claude.json` contains `mcpServers.tiddly_prompts`
- [ ] `tiddly_notes_bookmarks` from T3.2 is still present (install merges, doesn't delete)

### T3.4 — Claude Code, project scope
```bash
cd "$TEST_PROJECT" && bin/tiddly mcp install claude-code --scope project
```
**Verify:**
- [ ] Exit code 0
- [ ] `$TEST_PROJECT/.mcp.json` exists (new file)
- [ ] Contains `mcpServers.tiddly_notes_bookmarks` and `mcpServers.tiddly_prompts`
- [ ] `~/.claude.json` was NOT modified by this command

### T3.5 — Claude Code, local scope
```bash
cd "$TEST_PROJECT" && bin/tiddly mcp install claude-code --scope local
```
**Verify:**
- [ ] Exit code 0
- [ ] `~/.claude.json` contains `projects["$TEST_PROJECT"].mcpServers.tiddly_notes_bookmarks`
- [ ] `~/.claude.json` contains `projects["$TEST_PROJECT"].mcpServers.tiddly_prompts`
- [ ] Top-level `mcpServers` in `~/.claude.json` is NOT modified

### T3.6 — Codex, user scope
```bash
bin/tiddly mcp install codex
```
**Verify:**
- [ ] Exit code 0
- [ ] `~/.codex/config.toml` contains `[mcp_servers.tiddly_notes_bookmarks]` with:
  - `url = "https://content-mcp.tiddly.me/mcp"`
  - `[mcp_servers.tiddly_notes_bookmarks.http_headers]` with `Authorization = "Bearer bm_..."`
- [ ] `~/.codex/config.toml` contains `[mcp_servers.tiddly_prompts]` with:
  - `url = "https://prompts-mcp.tiddly.me/mcp"`
- [ ] Existing non-tiddly sections preserved

### T3.7 — Codex, project scope
```bash
cd "$TEST_PROJECT" && bin/tiddly mcp install codex --scope project
```
**Verify:**
- [ ] Exit code 0
- [ ] `$TEST_PROJECT/.codex/config.toml` exists
- [ ] Contains `[mcp_servers.tiddly_notes_bookmarks]` and `[mcp_servers.tiddly_prompts]`
- [ ] `~/.codex/config.toml` was NOT modified

### T3.8 — Claude Desktop, user scope
```bash
bin/tiddly mcp install claude-desktop
```
**Verify:**
- [ ] Exit code 0
- [ ] Config file contains `mcpServers.tiddly_notes_bookmarks` with:
  - `"command": "npx"`
  - `"args"` array containing `"mcp-remote"`, `"https://content-mcp.tiddly.me/mcp"`, `"--header"`, `"Authorization: Bearer bm_..."`
- [ ] Config file contains `mcpServers.tiddly_prompts` with:
  - `"args"` containing `"https://prompts-mcp.tiddly.me/mcp"`
- [ ] Stderr contains `Restart Claude Desktop to apply changes.`
- [ ] Existing non-tiddly entries preserved

### T3.9 — Install with --expires flag
```bash
bin/tiddly mcp install claude-code --expires 30
```
**Verify:**
- [ ] Exit code 0
- [ ] Output contains `Created tokens:` with names matching pattern `cli-mcp-claude-code-*`
- [ ] Config file updated with valid tokens

### T3.10 — Auto-detect install (no tool argument)
```bash
bin/tiddly mcp install
```
**Verify:**
- [ ] Exit code 0
- [ ] Output `Configured:` lists all detected tools
- [ ] Each detected tool's config file is updated

---

## Test Group 4: MCP Install --dry-run

### T4.1 — Dry-run, Claude Code user scope
```bash
bin/tiddly mcp install claude-code --dry-run
```
**Verify:**
- [ ] Exit code 0
- [ ] Output contains `--- claude-code ---`
- [ ] Output contains `File: ` followed by config path
- [ ] Output contains `Before:` and `After:` sections (or `(new file)` if no prior config)
- [ ] `After:` section shows `tiddly_notes_bookmarks` and `tiddly_prompts` entries
- [ ] `~/.claude.json` was NOT modified (compare checksum before/after)

### T4.2 — Dry-run, new file scenario
```bash
cd "$TEST_PROJECT" && rm -f .mcp.json && bin/tiddly mcp install claude-code --scope project --dry-run
```
**Verify:**
- [ ] Output contains `(new file)`
- [ ] `$TEST_PROJECT/.mcp.json` does NOT exist after command

### T4.3 — Dry-run, placeholder tokens
```bash
bin/tiddly mcp install claude-code --dry-run
```
**Verify:**
- [ ] `After:` section shows `<new-token-would-be-created>` as the token value
- [ ] No tokens were actually created on the server

### T4.4 — Dry-run, Codex
```bash
bin/tiddly mcp install codex --dry-run
```
**Verify:**
- [ ] Output contains `--- codex ---`
- [ ] Shows TOML format in Before/After
- [ ] `~/.codex/config.toml` was NOT modified

### T4.5 — Dry-run, Claude Desktop
```bash
bin/tiddly mcp install claude-desktop --dry-run
```
**Verify:**
- [ ] Output contains `--- claude-desktop ---`
- [ ] Shows JSON format with `npx` and `mcp-remote` in After section
- [ ] Config file was NOT modified

---

## Test Group 5: MCP Status

### T5.1 — Status, user scope (default)
```bash
bin/tiddly mcp status
```
**Verify:**
- [ ] Exit code 0
- [ ] Each tool shows one of: `Not detected`, `Not configured`, `Configured (tiddly_notes_bookmarks, tiddly_prompts)`
- [ ] Configured tools show correct server names

### T5.2 — Status, local scope
```bash
cd "$TEST_PROJECT" && bin/tiddly mcp status --scope local
```
**Verify:**
- [ ] Exit code 0
- [ ] claude-code shows local scope status (may differ from user scope)
- [ ] Other tools show user-scope status (local scope falls through to user for tools that don't support it — or shows error)

### T5.3 — Status, project scope
```bash
cd "$TEST_PROJECT" && bin/tiddly mcp status --scope project
```
**Verify:**
- [ ] Exit code 0
- [ ] claude-code shows project scope status from `.mcp.json`
- [ ] codex shows project scope status from `.codex/config.toml`

---

## Test Group 6: MCP Uninstall

### T6.1 — Uninstall Claude Code, user scope
```bash
bin/tiddly mcp install claude-code  # ensure configured first
bin/tiddly mcp uninstall claude-code
```
**Verify:**
- [ ] Exit code 0
- [ ] Output contains `Removed Tiddly MCP servers from claude-code.`
- [ ] `~/.claude.json` no longer contains `tiddly_notes_bookmarks` or `tiddly_prompts` in top-level `mcpServers`
- [ ] Other non-tiddly entries in `~/.claude.json` preserved
- [ ] Stderr may contain orphaned token warning

### T6.2 — Uninstall Claude Code, project scope
```bash
cd "$TEST_PROJECT" && bin/tiddly mcp install claude-code --scope project
cd "$TEST_PROJECT" && bin/tiddly mcp uninstall claude-code --scope project
```
**Verify:**
- [ ] `$TEST_PROJECT/.mcp.json` no longer contains tiddly server entries
- [ ] `~/.claude.json` was NOT modified

### T6.3 — Uninstall Codex
```bash
bin/tiddly mcp install codex
bin/tiddly mcp uninstall codex
```
**Verify:**
- [ ] Output contains `Removed Tiddly MCP servers from codex.`
- [ ] `~/.codex/config.toml` no longer contains `tiddly_notes_bookmarks` or `tiddly_prompts`

### T6.4 — Uninstall Claude Desktop
```bash
bin/tiddly mcp install claude-desktop
bin/tiddly mcp uninstall claude-desktop
```
**Verify:**
- [ ] Output contains `Removed Tiddly MCP servers from claude-desktop.`
- [ ] Stderr contains `Restart Claude Desktop to apply changes.`
- [ ] Config file no longer contains tiddly entries

### T6.5 — Uninstall with --delete-tokens

**IMPORTANT:** Only use `--delete-tokens` immediately after a fresh install with no
other changes in between. This ensures it only deletes the tokens just created and not
any pre-existing tokens. Never run `--delete-tokens` against a config that contains
tokens you didn't just create in the same test sequence.

```bash
# Clean install so we know exactly which tokens exist
bin/tiddly mcp uninstall claude-code 2>/dev/null  # remove entries (ignore orphan warning)
bin/tiddly mcp install claude-code                # creates fresh tokens — note the token names
bin/tiddly mcp uninstall claude-code --delete-tokens
```
**Verify:**
- [ ] Install output contains `Created tokens:` — note the exact names
- [ ] Uninstall output contains `Deleted tokens:` listing those same token names
- [ ] Config entries removed

### T6.6 — Uninstall without --delete-tokens (orphan warning)
```bash
bin/tiddly mcp install claude-code  # creates tokens
bin/tiddly mcp uninstall claude-code
```
**Verify:**
- [ ] Stderr contains `Warning: PATs created for MCP servers still exist: cli-mcp-`
- [ ] Stderr contains `Run 'tiddly mcp uninstall <tool> --delete-tokens' to revoke`

### T6.7 — Uninstall idempotent (already uninstalled)
```bash
bin/tiddly mcp uninstall claude-code  # already uninstalled from T6.1
```
**Verify:**
- [ ] Exit code 0
- [ ] Output contains `Removed Tiddly MCP servers from claude-code.`
- [ ] No crash or error (idempotent)

---

## Test Group 7: Skills Install

### T7.1 — Skills install, Claude Code, global scope (default)
```bash
bin/tiddly skills install claude-code
```
**Verify:**
- [ ] Exit code 0
- [ ] Output contains either `claude-code: Installed N skill(s) to ~/.claude/skills` or `claude-code: No skills to install.`

### T7.2 — Skills install, Claude Code, project scope
```bash
cd "$TEST_PROJECT" && bin/tiddly skills install claude-code --scope project
```
**Verify:**
- [ ] Exit code 0
- [ ] If skills exist: output contains `claude-code: Installed N skill(s) to .claude/skills`
- [ ] Skills extracted to `$TEST_PROJECT/.claude/skills/`

### T7.3 — Skills install, Codex, global scope
```bash
bin/tiddly skills install codex
```
**Verify:**
- [ ] Exit code 0
- [ ] Output references `~/.codex/skills`

### T7.4 — Skills install, Codex, project scope
```bash
cd "$TEST_PROJECT" && bin/tiddly skills install codex --scope project
```
**Verify:**
- [ ] Skills extracted to `$TEST_PROJECT/.agents/skills/`

### T7.5 — Skills install, Claude Desktop, global scope
```bash
bin/tiddly skills install claude-desktop
```
**Verify:**
- [ ] Exit code 0
- [ ] If skills exist: output contains `claude-desktop: N skill(s) exported to /tmp/tiddly-skills-*.zip`
- [ ] Output contains `Upload this file to Claude Desktop via Settings > Skills.`

### T7.6 — Skills install with --tags filter
```bash
bin/tiddly skills install claude-code --tags python,skill
```
**Verify:**
- [ ] Exit code 0
- [ ] Only prompts matching both tags are installed (default `--tag-match all`)

### T7.7 — Skills install with --tags and --tag-match any
```bash
bin/tiddly skills install claude-code --tags python,skill --tag-match any
```
**Verify:**
- [ ] Exit code 0
- [ ] Prompts matching either tag are installed

### T7.8 — Skills install auto-detect (no tool argument)
```bash
bin/tiddly skills install
```
**Verify:**
- [ ] Exit code 0
- [ ] Installs for all detected tools
- [ ] Output line per tool

### T7.9 — Skills install with invalid scope
```bash
bin/tiddly skills install --scope invalid
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `invalid scope "invalid". Valid scopes: global, project`

---

## Test Group 8: Skills List

### T8.1 — List all skills
```bash
bin/tiddly skills list
```
**Verify:**
- [ ] Exit code 0
- [ ] Output starts with `Available skills (N prompts):` or `No prompts found.`
- [ ] Each prompt shows name and description

### T8.2 — List with tag filter
```bash
bin/tiddly skills list --tags python
```
**Verify:**
- [ ] Exit code 0
- [ ] Only prompts with the `python` tag are listed

---

## Test Group 9: Error Handling

### T9.1 — Invalid tool name (install)
```bash
bin/tiddly mcp install invalid-tool
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `unknown tool "invalid-tool". Valid tools: claude-desktop, claude-code, codex`

### T9.2 — Invalid tool name (uninstall)
```bash
bin/tiddly mcp uninstall invalid-tool
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `unknown tool "invalid-tool". Valid tools: claude-desktop, claude-code, codex`

### T9.3 — Invalid scope (typo)
```bash
bin/tiddly mcp install claude-code --scope bad-scope
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `invalid scope "bad-scope". Valid scopes: user, local, project`

### T9.4 — Unsupported scope: Codex + local
```bash
bin/tiddly mcp install codex --scope local
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `scope "local" is not supported by codex (valid: user, project)`

### T9.5a — Unsupported scope: Claude Desktop + local
```bash
bin/tiddly mcp install claude-desktop --scope local
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `scope "local" is not supported by claude-desktop (valid: user)`

### T9.5b — Unsupported scope: Claude Desktop + project
```bash
bin/tiddly mcp install claude-desktop --scope project
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `scope "project" is not supported by claude-desktop (valid: user)`

### T9.6 — Invalid --servers flag
```bash
bin/tiddly mcp install claude-code --servers invalid
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `invalid server "invalid" in --servers flag. Valid values: content, prompts`

### T9.7 — Empty --servers flag
```bash
bin/tiddly mcp install claude-code --servers ""
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `--servers flag requires at least one value: content, prompts`

### T9.8 — Tool not installed
```bash
# Only testable if a tool is not actually installed
bin/tiddly mcp install claude-desktop  # if Claude Desktop is not detected
```
**Verify:**
- [ ] Exit code non-zero
- [ ] Error contains `claude-desktop is not installed on this system`

### T9.9 — Claude Desktop + skills --scope project
```bash
bin/tiddly skills install claude-desktop --scope project
```
**Verify:**
- [ ] Exit code non-zero (or error in output)
- [ ] Error contains `claude-desktop does not support --scope project`

---

## Test Group 10: Not Logged In

Run this group last — it logs out and requires re-authentication afterward.

### T10.1 — Logout and verify commands fail
```bash
bin/tiddly logout
bin/tiddly mcp install claude-code
bin/tiddly skills list
bin/tiddly skills install claude-code
```
**Verify:**
- [ ] `logout` exits 0 with `Logged out successfully.`
- [ ] `mcp install` exits non-zero with `not logged in. Run 'tiddly login' first`
- [ ] `skills list` exits non-zero with `not logged in. Run 'tiddly login' first`
- [ ] `skills install` exits non-zero with `not logged in. Run 'tiddly login' first`
- [ ] Re-login after: `bin/tiddly login` (OAuth) or `bin/tiddly login --token bm_<your-token>` (PAT)

---

## Cleanup

```bash
# Restore all config files from backup
cp "$BACKUP_DIR/claude_desktop_config.json" ~/.config/Claude/claude_desktop_config.json 2>/dev/null || true
cp "$BACKUP_DIR/.claude.json" ~/.claude.json 2>/dev/null || true
cp "$BACKUP_DIR/config.toml" ~/.codex/config.toml 2>/dev/null || true

# Remove temp directories
rm -rf "$TEST_PROJECT"
rm -rf "$BACKUP_DIR"

# Note: CLI-created test PATs (named cli-mcp-*) may remain on the server.
# Review with: bin/tiddly tokens list (if available)
# Or delete via the web UI at https://tiddly.me/settings/tokens
```

---

## User Verification Checklist

These items require human verification and cannot be automated by an agent:

- [ ] Claude Desktop actually connects to MCP servers after install
- [ ] MCP tools return real data (search items, get bookmarks, etc.)
- [ ] Prompts are accessible and renderable through the MCP server
- [ ] Skills appear and are invocable in Claude Code / Codex
- [ ] OAuth device flow works end-to-end (`tiddly login` without `--token`)
- [ ] Uploaded skills zip works in Claude Desktop (Settings > Skills)

---

## Reference: Config Formats

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "tiddly_notes_bookmarks": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://content-mcp.tiddly.me/mcp",
        "--header",
        "Authorization: Bearer bm_XXXXX"
      ]
    },
    "tiddly_prompts": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://prompts-mcp.tiddly.me/mcp",
        "--header",
        "Authorization: Bearer bm_XXXXX"
      ]
    }
  }
}
```

### Claude Code — user scope (`~/.claude.json`)
```json
{
  "mcpServers": {
    "tiddly_notes_bookmarks": {
      "type": "http",
      "url": "https://content-mcp.tiddly.me/mcp",
      "headers": {
        "Authorization": "Bearer bm_XXXXX"
      }
    },
    "tiddly_prompts": {
      "type": "http",
      "url": "https://prompts-mcp.tiddly.me/mcp",
      "headers": {
        "Authorization": "Bearer bm_XXXXX"
      }
    }
  }
}
```

### Claude Code — local scope (`~/.claude.json`)
```json
{
  "projects": {
    "/path/to/project": {
      "mcpServers": {
        "tiddly_notes_bookmarks": {
          "type": "http",
          "url": "https://content-mcp.tiddly.me/mcp",
          "headers": {
            "Authorization": "Bearer bm_XXXXX"
          }
        },
        "tiddly_prompts": {
          "type": "http",
          "url": "https://prompts-mcp.tiddly.me/mcp",
          "headers": {
            "Authorization": "Bearer bm_XXXXX"
          }
        }
      }
    }
  }
}
```

### Claude Code — project scope (`.mcp.json` in project root)
Same top-level structure as user scope (the `mcpServers` key is at the root of the file).

### Codex — user scope (`~/.codex/config.toml`)
```toml
[mcp_servers.tiddly_notes_bookmarks]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.tiddly_notes_bookmarks.http_headers]
Authorization = "Bearer bm_XXXXX"

[mcp_servers.tiddly_prompts]
url = "https://prompts-mcp.tiddly.me/mcp"

[mcp_servers.tiddly_prompts.http_headers]
Authorization = "Bearer bm_XXXXX"
```

### Codex — project scope (`.codex/config.toml` in project root)
Same TOML structure as user scope.

---

## Reference: Key Constants

| Constant | Value |
|----------|-------|
| Content server name | `tiddly_notes_bookmarks` |
| Prompts server name | `tiddly_prompts` |
| Content MCP URL | `https://content-mcp.tiddly.me/mcp` |
| Prompts MCP URL | `https://prompts-mcp.tiddly.me/mcp` |
| Token name pattern | `cli-mcp-<tool>-<server>-<6hex>` |
| Token prefix | `bm_` |
| Dry-run placeholder | `<new-token-would-be-created>` |
| Content MCP URL env override | `TIDDLY_CONTENT_MCP_URL` |
| Prompts MCP URL env override | `TIDDLY_PROMPT_MCP_URL` |

## Reference: Tool × Scope Support

| Tool | user | local | project |
|------|------|-------|---------|
| claude-desktop | yes | no | no |
| claude-code | yes | yes | yes |
| codex | yes | no | yes |

## Reference: Skills Extraction Paths

| Tool | global scope | project scope |
|------|-------------|---------------|
| claude-code | `~/.claude/skills/` | `.claude/skills/` (relative to cwd) |
| codex | `~/.codex/skills/` | `.agents/skills/` (relative to cwd) |
| claude-desktop | Saves zip to `/tmp/tiddly-skills-*.zip` | Not supported |
