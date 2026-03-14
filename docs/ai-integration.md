# AI Integration: Scope Terminology & Support Matrix

This document records the official scope terminology used by each AI tool we integrate with, and documents our Tiddly CLI's mapping decisions.

## Official Tool Documentation

### Claude Code

Source: [Claude Code MCP docs](https://code.claude.com/docs/en/mcp), [Claude Code Settings docs](https://code.claude.com/docs/en/settings), [Claude Code Skills docs](https://code.claude.com/docs/en/skills)

#### MCP Scopes

Claude Code uses three named scopes for MCP server configuration, set via `--scope`:

| Scope       | Storage location                                          | Description                          |
|-------------|-----------------------------------------------------------|--------------------------------------|
| **`local`** | `~/.claude.json` (under project path)                     | Default. Private to you, per-project |
| **`project`** | `.mcp.json` in project root                             | Shared with team via version control |
| **`user`**  | `~/.claude.json` (top-level `mcpServers`)                 | Available across all projects        |

From the docs:
> - `local` (default): Available only to you in the current project (was called `project` in older versions)
> - `project`: Shared with everyone in the project via `.mcp.json` file
> - `user`: Available to you across all projects (was called `global` in older versions)

Note: Claude Code explicitly renamed `global` → `user` for MCP scopes.

#### Skills Scopes

Claude Code does **not** have a `--scope` flag for skills. Scope is determined entirely by directory location:

| Location              | Path                                     | Applies to          |
|-----------------------|------------------------------------------|----------------------|
| **Personal**          | `~/.claude/skills/<skill-name>/SKILL.md` | All your projects    |
| **Project**           | `.claude/skills/<skill-name>/SKILL.md`   | This project only    |

There is no named scope system or CLI flag — you just place files in the appropriate directory.

#### General Settings Scopes

Claude Code's general settings use these scope names:

| Scope       | Location                          |
|-------------|-----------------------------------|
| **User**    | `~/.claude/` directory            |
| **Project** | `.claude/` in repository          |
| **Local**   | `.claude/settings.local.json`     |
| **Managed** | System-level managed settings     |

### Codex (OpenAI)

Source: [Codex MCP docs](https://developers.openai.com/codex/mcp), [Codex Skills docs](https://developers.openai.com/codex/skills), [Codex Config Reference](https://developers.openai.com/codex/config-reference)

#### MCP Configuration

Codex stores MCP configuration in `config.toml`. There is no `--scope` CLI flag, but the docs use explicit terminology for the two levels:

- **"User-level"**: `~/.codex/config.toml` — the default location
- **"Project-scoped"**: `.codex/config.toml` — loaded only for trusted projects

From the docs:
> "Codex stores MCP configuration in `config.toml` alongside other Codex configuration settings. By default this is `~/.codex/config.toml`, but you can also scope MCP servers to a project with `.codex/config.toml` (trusted projects only)."

#### Skills

Codex uses named scope levels for skills directories. There is no `--scope` CLI flag — scope is determined by file placement.

| Scope        | Path                           | Description                          |
|--------------|--------------------------------|--------------------------------------|
| **`USER`**   | `$HOME/.agents/skills`         | Personal skills, all repositories    |
| **`REPO`**   | `$REPO_ROOT/.agents/skills`    | Organization-wide within the repo    |
| **`REPO`**   | `$CWD/.agents/skills`          | Specific to current folder           |
| **`REPO`**   | `$CWD/../.agents/skills`       | Nested repository structures         |
| **`ADMIN`**  | `/etc/codex/skills`            | Machine/container-level shared       |
| **`SYSTEM`** | Bundled with Codex             | Built-in skills by OpenAI            |

Note: Codex skills use `$HOME/.agents/skills` (not `$HOME/.codex/skills`).

#### General Config Hierarchy

From the [Config Reference](https://developers.openai.com/codex/config-reference), Codex uses a two-level hierarchy:

- **"User-level configuration"**: `~/.codex/config.toml`
- **"Project-scoped overrides"**: `.codex/config.toml` (loaded only when project is trusted)

### Claude Desktop

Claude Desktop does not have a CLI or scope flags. MCP servers are configured via the GUI (Settings > Developer) which writes to a single config file. Skills are configured via Settings > Capabilities.

## Tiddly CLI Scope Mapping

Our CLI (`tiddly mcp configure`, `tiddly skills configure`) wraps these tools and introduces its own `--scope` flags. This section documents our current mapping and known inconsistencies.

### Current Implementation

#### `tiddly mcp configure --scope <scope>`

| Tiddly `--scope` | Claude Code              | Codex                                       | Claude Desktop |
|-------------------|--------------------------|----------------------------------------------|----------------|
| `user`            | `--scope user`           | "User-level" (`~/.codex/config.toml`)        | GUI config     |
| `local`           | `--scope local`          | N/A (not supported)                          | N/A            |
| `project`         | `--scope project`        | "Project-scoped" (`.codex/config.toml`)      | N/A            |

#### `tiddly skills configure --scope <scope>`

| Tiddly `--scope` | Claude Code                          | Codex                                        |
|-------------------|--------------------------------------|----------------------------------------------|
| `global`          | "Personal" (`~/.claude/skills/`)     | `USER` scope (`~/.codex/skills/`)            |
| `project`         | "Project" (`.claude/skills/`)        | `REPO` scope (`.codex/skills/`)              |

### Known Inconsistencies

> **TODO**: Review and resolve these.

1. **`user` vs `global` for the same concept**: Our MCP scope uses `--scope user` while our skills scope uses `--scope global`. Both mean "user-level, available across all projects." Claude Code explicitly renamed `global` → `user` for MCP. Codex calls this level "User-level" for MCP and `USER` for skills. Both upstream tools use "user" terminology — we are the only ones using "global."

2. **UI label mismatch**: The MCP scope selector shows "User (global)" while the skills scope selector shows "Global". These represent the same concept but use different labels.

3. **Codex skills path**: Our CLI writes skills to `~/.codex/skills/` and `.codex/skills/`, but Codex's official docs say skills live at `$HOME/.agents/skills` (USER scope) and `$CWD/.agents/skills` (REPO scope).

4. **No official scope flags for skills**: Neither Claude Code nor Codex have a `--scope` flag for skills — scope is determined by file placement. Our `tiddly skills configure --scope` flag is our own abstraction over directory placement.

5. **Codex MCP has no `--scope` flag**: Codex uses "user-level" and "project-scoped" terminology but does not have a CLI `--scope` flag. Our CLI maps our `--scope user` / `--scope project` flags to writing the appropriate config file.

## Frontend UI Scope Support Matrix

This is what the Settings > AI Integration page uses to determine which scope options to show for each tool. Scope options are filtered to only show scopes supported by at least one selected tool. If the selected scope becomes unavailable (e.g., deselecting the only tool that supports it), it auto-resets to the default. Warnings appear when some (but not all) selected tools support the chosen scope.

### MCP Scopes

| Tiddly scope | Claude Desktop | Claude Code                | Codex                                   |
|--------------|----------------|----------------------------|-----------------------------------------|
| `user`       | Yes (GUI)      | Yes (`--scope user`)       | Yes ("User-level", `~/.codex/config.toml`) |
| `local`      | —              | Yes (`--scope local`, default) | —                                   |
| `project`    | —              | Yes (`--scope project`)    | Yes ("Project-scoped", `.codex/config.toml`) |

### Skills Scopes

| Tiddly scope | Claude Desktop          | Claude Code                          | Codex                                    |
|--------------|-------------------------|--------------------------------------|------------------------------------------|
| `global`     | Yes (GUI: Capabilities) | Yes ("Personal", `~/.claude/skills/`) | Yes (`USER` scope, `~/.codex/skills/`)  |
| `project`    | —                       | Yes ("Project", `.claude/skills/`)   | Yes (`REPO` scope, `.codex/skills/`)     |
