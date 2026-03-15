# AI Integration: Scope Terminology & Support Matrix

This document records the official scope terminology used by each AI tool we integrate with, and documents our Tiddly CLI's mapping decisions.

For the decisions and rationale behind our scope simplification, see [implementation_plans/2026-03-14-cli-terminology-cleanup.md](implementation_plans/2026-03-14-cli-terminology-cleanup.md).

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

#### Skills

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

Per the [Codex source code](https://github.com/openai/codex/blob/main/codex-rs/core/src/skills/loader.rs), Codex scans **both** `$CODEX_HOME/skills/` (i.e., `~/.codex/skills/`) and `$HOME/.agents/skills/` for user-scope skills. The source explicitly marks `$CODEX_HOME/skills/` as **"Deprecated user skills location, kept for backward compatibility."** The canonical path per docs and source is `$HOME/.agents/skills/`.

Note: only the **skills** subdirectory moved from `~/.codex/` to `~/.agents/`. Codex config (`config.toml`, history, logs) still lives at `~/.codex/` — that is not deprecated.

`$HOME` is a standard OS environment variable present on all platforms. `$CODEX_HOME` is an optional override that defaults to `~/.codex` if not set. No platform-specific path variation between macOS, Linux, and Windows.

#### General Config Hierarchy

From the [Config Reference](https://developers.openai.com/codex/config-reference), Codex uses a two-level hierarchy:

- **"User-level configuration"**: `~/.codex/config.toml`
- **"Project-scoped overrides"**: `.codex/config.toml` (loaded only when project is trusted)

### Claude Desktop

Claude Desktop does not have a CLI or scope flags. MCP servers are configured via the GUI (Settings > Developer) which writes to a single config file. Skills are configured via Settings > Capabilities.

## Tiddly CLI Scope Mapping

Our CLI (`tiddly mcp configure`, `tiddly skills configure`) provides two scopes: `user` and `directory`. These map to both MCP and skills for all supported tools.

- **`user`** — available everywhere for the user
- **`directory`** — scoped to the directory the command is run in

### Unified Scope Mapping

| Tiddly scope  | Claude Code MCP                                | Claude Code Skills       | Codex MCP                                    | Codex Skills                              |
|---------------|------------------------------------------------|--------------------------|----------------------------------------------|-------------------------------------------|
| `user`        | `--scope user` (`~/.claude.json` top-level)    | `~/.claude/skills/`      | "User-level" (`~/.codex/config.toml`)        | `USER` scope (`~/.agents/skills/`)        |
| `directory`   | `--scope local` (`~/.claude.json` under project) | `.claude/skills/`      | "Project-scoped" (`.codex/config.toml`)      | `REPO` scope (`.agents/skills/`)          |

Claude Code and Codex support both scopes for both MCP and skills. Claude Desktop only supports `user` scope.

### Known Limitations

1. **Claude Code `--scope project` not supported**: Claude Code has a third MCP scope (`project`) that writes a shared `.mcp.json` file for team collaboration via version control. Tiddly does not support this because Tiddly is not a team tool. Users who need team-shared MCP config can run `claude mcp add --scope project` directly.

2. **No official scope flags for skills**: Neither Claude Code nor Codex have a `--scope` flag for skills — scope is determined by file placement. Our `tiddly skills configure --scope` flag is our own abstraction over directory placement.

3. **Codex MCP has no `--scope` flag**: Codex uses "user-level" and "project-scoped" terminology but does not have a CLI `--scope` flag. Our CLI maps our scope flags to writing the appropriate config file.

