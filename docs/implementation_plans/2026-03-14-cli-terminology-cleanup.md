# CLI Terminology & Settings UI Cleanup

Resolves inconsistencies between our CLI/UI scope terminology and upstream tool conventions. Also improves the Settings > AI Integration UX.

**Terminology consistency applies to all Tiddly-owned code** — not just user-facing strings. CLI flags, UI labels, user-facing messages, our own constants and abstractions (e.g., `ScopeGlobal`, `ScopeProject`, `SkillsScopeType`), test names, inline comments, and documentation must all use the new `user`/`directory` terminology.

**Exception: handler-internal code that maps to upstream API values.** The MCP handlers (`handler_claude_code.go`, `handler_codex.go`, etc.) pass scope values directly to upstream tools. These must keep the upstream-native values — e.g., `ClaudeCodeHandler.SupportedScopes()` returns `["user", "local"]` because those are the actual `claude mcp add --scope` values. The translation from Tiddly's `directory` → upstream `local`/`project` happens at the command boundary (in `cli/cmd/mcp.go` and `cli/cmd/skills.go`), not inside handlers. This is the standard integration pattern: preserve provider-native semantics inside adapters, expose friendlier terms at the UX edge.

Background research and official tool documentation: [docs/ai-integration.md](../ai-integration.md)

## Decisions

### D1: Simplify to two scopes — `user` and `directory`

Both Claude Code and Codex support exactly two relevant scope levels: user-wide and per-directory. We simplify our scope model to match:

- **`user`** — available everywhere for the user
- **`directory`** — scoped to the directory the command is run in

This replaces the previous three-way `user`/`local`/`project` split for MCP and the `global`/`project` split for skills. Both upstream tools support both scopes for both MCP and skills, so no per-tool scope filtering, scope warnings, or auto-reset logic is needed.

Claude Code's `--scope project` (team-shared `.mcp.json`) is intentionally not supported — Tiddly is not a team tool. Document as a known limitation.

**Mapping:**

| Tiddly scope | Claude Code MCP | Claude Code Skills | Codex MCP | Codex Skills |
|---|---|---|---|---|
| `user` | `--scope user` | `~/.claude/skills/` | `~/.codex/config.toml` | `~/.agents/skills/` |
| `directory` | `--scope local` | `.claude/skills/` | `.codex/config.toml` | `.agents/skills/` |

### D2: Merge MCP and Skills scope selectors into one

The Settings UI currently shows two separate scope selectors. Since both scopes map cleanly to both MCP and skills for all tools, replace them with a single "Scope" selector.

### D3: UI labels — "User" and "Directory"

- **"User"** — replaces "User (global)" and "Global"
- **"Directory"** — replaces "Local" and "Project". Unambiguous: literally the directory you run the command in.

Tooltip for "Directory": "Configuration only applies when running tools from a specific directory." (Note: for Claude Code MCP, the config is stored in `~/.claude.json` under a project-path key, not in the working directory itself. The file details disclosure shows the actual storage paths.)

### D4: Add collapsible file details below generated command

Users have no visibility into which files are actually modified. Add a collapsible section below the generated command showing affected files with upstream terminology. Example for `user` scope:

```
~/.claude.json            Claude Code MCP (--scope user)
~/.codex/config.toml      Codex MCP (user-level config)
~/.claude/skills/         Claude Code skills (personal)
~/.agents/skills/         Codex skills (USER scope)
```

### D5: Add "tiddly status" tip above Action selector

Add a subtle info callout above the Action selector:

> Want to view your current setup? Install the CLI and run `tiddly status`.

Light styling (info, not warning). Discoverable without being intrusive.

### D6: Rename `tiddly upgrade` to `tiddly update`

"Upgrade" implies a subscription tier change (and we may add `tiddly upgrade` for that purpose later). What the command actually does is update the CLI binary.

Rename `upgrade` → `update` across CLI, frontend docs, and install instructions. No backwards-compatible alias — small beta user base, prioritize clean code.

### D7: Codex skills path correction

Our CLI currently writes Codex user-scope skills to `~/.codex/skills/`. Per the [Codex source code](https://github.com/openai/codex/blob/main/codex-rs/core/src/skills/loader.rs), this path is explicitly marked as **"Deprecated user skills location, kept for backward compatibility."** The canonical path per docs and source is `$HOME/.agents/skills/`. Codex currently scans both locations, but we should write to the canonical path.

The directory-scope path (`.agents/skills/`) is already correct in our CLI — no change needed there.

Update CLI to write user-scope Codex skills to `~/.agents/skills/` (was `~/.codex/skills/`). Update the remove flow's `rm -rf` paths accordingly.

---

## Milestone 1: CLI Renames (D1, D6, D7)

### Goal & Outcome

Align CLI command names, scope terminology, and file paths with upstream conventions.

After this milestone:
- `tiddly update` replaces `tiddly upgrade` for updating the CLI binary
- `tiddly skills configure` accepts `--scope user` and `--scope directory` (replaces `--scope global` and `--scope project`)
- `tiddly mcp configure` accepts `--scope user` and `--scope directory` (replaces `--scope user`/`--scope local`/`--scope project`)
- Codex skills are written to `~/.agents/skills/` (user) and `.agents/skills/` (directory) matching official Codex docs
- All CLI help text and error messages reflect the new terminology
- `tiddly status` output uses new scope names and scans the correct Codex skills path

### Implementation Outline

**Read first:**
- [docs/ai-integration.md](../ai-integration.md) for the upstream terminology research and mapping table
- [Codex Skills docs](https://developers.openai.com/codex/skills) for official skills paths
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) for scope flag reference

**1. Rename `upgrade` → `update` (D6)**

- Rename `cli/cmd/upgrade.go` → `cli/cmd/update.go`, `cli/cmd/upgrade_test.go` → `cli/cmd/update_test.go`
- Update cobra command: `Use: "update"`, `Short: "Update Tiddly CLI to the latest version"`
- Update `cli/cmd/root.go` to register the renamed command
- Update `cli/cmd/update_check.go`:
  - The background update checker prints "run `tiddly upgrade`" (line 88); change to `tiddly update`
  - The `shouldCheckForUpdates` function (line 27) skips update checks for `case "upgrade"` — must change to `"update"`, otherwise `tiddly update` would show "a new version is available" while already updating
- Grep for any remaining "upgrade" references in `cli/` and update (README, internal strings, etc.)

**2. Simplify scopes to `user`/`directory` (D1)**

- The CLI accepts `--scope user` and `--scope directory` as public-facing values. Translation to upstream-native values happens at the command boundary:
  - MCP: `user` → Claude Code `--scope user` / Codex user config; `directory` → Claude Code `--scope local` / Codex project config
  - Skills: `user` → user-level skill directories; `directory` → CWD-relative skill directories
- In `cli/cmd/mcp.go` and `cli/cmd/skills.go`: accept `user`/`directory`, translate to handler-native values before calling handlers
- In `cli/internal/skills/configure.go:19-25`: rename `ScopeGlobal`/`ScopeProject` to `ScopeUser`/`ScopeDirectory` (these are Tiddly-owned constants)
- Handler-internal code keeps upstream values — e.g., `ClaudeCodeHandler.SupportedScopes()` keeps returning `["user", "local"]`; `CodexHandler.SupportedScopes()` keeps returning `["user", "project"]`
- Remove Claude Code `--scope project` / `.mcp.json` support from the command layer
- Update help text, validation, and error messages
- Ensure the default scope for both MCP and skills is `user`. The frontend omits `--scope` when `user` is selected since it's the default.
- Invalid scope errors should list valid options clearly: `invalid scope "local". Valid scopes: user, directory`

**3. Fix Codex skills user-scope path (D7)**

- Find where Codex skills directory paths are defined (see `cli/internal/skills/configure.go:48-52`)
- Change user-scope path only: `~/.codex/skills/` → `~/.agents/skills/`
- Directory-scope path (`.agents/skills/`) is already correct — no change needed
- For the remove/cleanup flow: clean **both** `~/.codex/skills/` and `~/.agents/skills/` when removing user-scope Codex skills, since users may have skills at the old path from before this change

**4. Update `tiddly status` and `tiddly mcp status` to use new terminology and paths**

- `cli/cmd/status.go`: Update help text (line 37: "all scopes" → "user and directory scopes", line 42: "local/project scopes" → "directory scope")
- `cli/cmd/mcp.go`: Update `mcp status` help text (line 259: "local/project scopes" → "directory scope")
- Rename `--project-path` flag to `--path` in **both** `status.go` (line 122) and `mcp.go` (line 280)
- `cli/internal/skills/scan.go`: Update `ScopeGlobal`/`ScopeProject` references to use new scope names, update Codex user-scope scan path from `~/.codex/skills/` to `~/.agents/skills/`
- Add deprecated path detection: if skills are found at `~/.codex/skills/`, display them in status output with a "(deprecated path)" label. E.g., `8 skills   ~/.codex/skills/ (deprecated path)`. Only show this line if skills actually exist at the old path.
- Update any status output formatting that displays scope names

**5. Update `cli/agent_testing_procedure.md`**

- Update all scope references: `global` → `user`, `local`/`project` → `directory`
- Update all path references: `~/.codex/skills/` → `~/.agents/skills/`, `--project-path` → `--path`
- Update `tiddly upgrade` → `tiddly update`
- Update test checklists to reflect the simplified two-scope model (remove `--scope local`, `--scope project`, `--scope global` test cases; add `--scope user` and `--scope directory`)
- Verify backup/restore helpers reference correct paths

### Testing Strategy

All tests are automated Go unit tests. Update existing tests in `cli/cmd/upgrade_test.go` (renamed), `cli/cmd/update_check_test.go`, `cli/cmd/skills_test.go`, `cli/cmd/mcp_test.go`, `cli/cmd/status_test.go`, `cli/internal/skills/configure_test.go`, and `cli/internal/skills/scan_test.go`.

- **`tiddly update` command**: Existing upgrade tests adapted to new name; verify command registers and runs
- **`tiddly update` in update checker message**: Verify background update check message says `tiddly update`
- **`tiddly update` suppresses update check**: Verify `shouldCheckForUpdates` returns false when running `tiddly update`
- **MCP `--scope user`**: Verify maps to Claude Code `--scope user` and Codex `~/.codex/config.toml`
- **MCP `--scope directory`**: Verify maps to Claude Code `--scope local` and Codex `.codex/config.toml`
- **Skills `--scope user`**: Verify writes to `~/.claude/skills/` (Claude Code) and `~/.agents/skills/` (Codex)
- **Skills `--scope directory`**: Verify writes to `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex)
- **Old scopes rejected**: Verify `--scope project`, `--scope global`, and `--scope local` are not accepted; error message lists valid options
- **Help text**: Verify help output shows `user` and `directory` as the only scope options
- **`tiddly status` output**: Verify scope names in status output use new terminology
- **`tiddly status` scans correct paths**: Verify Codex user-scope skills scan uses `~/.agents/skills/`
- **`tiddly status --path`**: Verify renamed flag works (old `--project-path` should not exist)
- **`tiddly mcp status --path`**: Verify renamed flag works here too
- **Deprecated path detection in status**: Verify `tiddly status` shows skills at `~/.codex/skills/` with "(deprecated path)" label when they exist, and omits the line when they don't
- **Remove cleans both Codex paths**: Verify remove flow cleans both `~/.codex/skills/` and `~/.agents/skills/` for user-scope Codex skills
- **No old terminology in Tiddly-owned code**: Grep the `cli/` directory for `ScopeGlobal`, `ScopeProject`, `"global"` (in scope contexts), `"project-path"`, `"upgrade"` to confirm no remnants. Note: `"local"` and `"project"` will still appear in handler-internal code that maps to upstream values — this is expected.

---

## Milestone 2: Frontend — Unified Scope & Labels (D2, D3)

### Goal & Outcome

Simplify the Settings > AI Integration UI to a single scope selector with clear, consistent terminology.

After this milestone:
- One "Scope" selector with two options: "User" and "Directory"
- Both options always available for Claude Code and Codex — no per-tool filtering or auto-reset logic
- Scope applies to both MCP and skills commands
- Claude Desktop + "Directory" scope shows an error and hides steps (Claude Desktop only supports user scope for both MCP and skills)
- All `SCOPE_SUPPORT` matrices, `getAvailableScopes()`, `getScopeWarnings()`, and auto-reset `useMemo`/effective-scope logic removed

### Implementation Outline

**Read first:**
- Current `AISetupWidget.tsx` — understand the existing dual-scope architecture and all the filtering/warning machinery
- Current `SettingsMCP.test.tsx` — understand existing test patterns

**1. Simplify scope types and state**

In `AISetupWidget.tsx`:
- Remove `SkillsScopeType`, `skillsScope`, `removeSkillsScope` state
- Replace `McpScopeType` with `ScopeType = 'user' | 'directory'`
- Single `scope` state for configure, single `removeScope` state for remove
- Remove `MCP_SCOPE_SUPPORT`, `SKILLS_SCOPE_SUPPORT`, `getAvailableMcpScopes`, `getAvailableSkillsScopes`, `getMcpScopeWarnings`, `getSkillsScopeWarnings`
- Remove all `effective*Scope`, `active*Scope`, `availableMcpScopes`, `availableSkillsScopes`, `selectedToolsKey` computed values
- Remove the `useMemo` calls for scope filtering

**2. Update command generation**

- `generateCLICommands`: Accepts a single `scope: ScopeType`. Maps `directory` → `--scope directory` for both MCP and skills. Omits `--scope` when `user` is selected (it's the default).
- `generateRemoveCommands`: Same single scope. For skills removal:
  - `user` → `~/.claude/skills/`, `~/.agents/skills/`
  - `directory` → `.claude/skills/`, `.agents/skills/`
- `needsCd` is true when scope is `directory`

**3. Update UI**

- Replace both "MCP Scope" and "Skills Scope" selector rows with a single "Scope" row in both configure and remove flows
- Two pill options: "User" and "Directory"
- Section label: "Scope"
- Tooltip on "Directory": "Configuration only applies when running tools from a specific directory."
- Remove the Claude Code "Note: Claude Code defaults to local (per-project) scope..." message — no longer relevant with simplified scopes

**4. Simplify scope options**

- Static options, no filtering:
  ```typescript
  const scopeOptions: PillOption<ScopeType>[] = [
    { value: 'user', label: 'User' },
    { value: 'directory', label: 'Directory' },
  ]
  ```

**5. Claude Desktop + Directory scope error**

- Claude Desktop only supports user scope for both MCP and skills (the CLI returns `"claude-desktop does not support --scope project"`)
- When Claude Desktop is the **only** selected tool and scope is "Directory", show an error message and hide the steps/command. E.g., "Claude Desktop only supports User scope. Select User scope, or add another tool."
- When Claude Desktop is selected alongside other tools and scope is "Directory", skip Claude Desktop in the generated commands — the other tools will still work. No warning needed since Claude Desktop is not a CLI tool and this is the expected behavior.

### Testing Strategy

All tests are automated Vitest tests in `frontend/src/pages/settings/SettingsMCP.test.tsx`. Update existing tests and add new ones. Remove tests for separate Skills Scope selector, scope filtering, scope warnings, and auto-reset logic.

- **Single scope selector visible**: Verify one "Scope" selector appears (not "MCP Scope" + "Skills Scope")
- **Two options only**: Verify "User" and "Directory" pills, no "Local", "Project", "User (global)", or "Global"
- **Both always shown**: Select any combination of tools → both scope options always visible
- **No warnings**: No scope warning text ever appears (no unsupported tool/scope pairs)
- **Scope applies to both commands**: Select "Directory" with MCP + skills → both `tiddly mcp configure --scope directory` and `tiddly skills configure --scope directory` appear
- **`cd` prepended for directory scope**: "Directory" selected → `cd /path/to/your/project` prepended
- **No `cd` for user scope**: "User" selected → no `cd` line
- **Remove flow**: Single scope selector in remove flow
- **Skills removal paths — user scope**: `rm -rf ~/.claude/skills/` and `rm -rf ~/.agents/skills/`
- **Skills removal paths — directory scope**: `rm -rf .claude/skills/` and `rm -rf .agents/skills/`
- **No Codex old paths**: Verify no references to `~/.codex/skills/` or `.codex/skills/` anywhere in generated commands
- **Default scope**: "User" is selected by default
- **Configure command join**: User scope → commands joined with `&&`. Directory scope → `cd` prepended, commands joined with newlines.
- **Claude Desktop only + Directory scope**: Shows error message, hides steps/command
- **Claude Desktop only + User scope**: Works normally
- **Claude Desktop + other tools + Directory scope**: Generates commands for other tools, Claude Desktop silently excluded from CLI commands (Claude Desktop is a GUI tool, not a CLI tool)

---

## Milestone 3: Frontend — File Details & Status Tip (D4, D5)

### Goal & Outcome

Add transparency about what files the CLI modifies, and make `tiddly status` discoverable.

After this milestone:
- A collapsible "Files modified" section below the generated command shows exactly which config files and skill directories will be created/updated, with upstream terminology
- An info callout above the Action selector tells users about `tiddly status`
- The docs page references `tiddly update` instead of `tiddly upgrade`

### Implementation Outline

**1. File details disclosure (D4)**

In `AISetupWidget.tsx`:
- Add a function `getAffectedFiles(selectedTools, scope, hasMcpServers, installSkills)` returning `Array<{ path: string; description: string }>`.
- The list varies based on selected tools and scope. For example, with Claude Code + Codex at user scope with both MCP + skills:
  ```
  ~/.claude.json            Claude Code MCP (--scope user)
  ~/.codex/config.toml      Codex MCP (user-level config)
  ~/.claude/skills/         Claude Code skills (personal)
  ~/.agents/skills/         Codex skills (USER scope)
  ```
- For directory scope:
  ```
  ~/.claude.json            Claude Code MCP (--scope local)
  .codex/config.toml        Codex MCP (project-scoped config)
  .claude/skills/           Claude Code skills (project)
  .agents/skills/           Codex skills (REPO scope)
  ```
- Note: Claude Code MCP with `--scope local` still writes to `~/.claude.json` (under the project path key), not a local file. The details section should show the actual file path.
- Render as a `<details><summary>Files modified</summary>` below the command `<pre>` block.
- Style the file list as a compact, monospace table. Use subtle colors (gray text).
- Show for both configure and remove flows.

**2. Status tip (D5)**

In `AISetupWidget.tsx`:
- Add an info-styled div above the "Action" section divider.
- Light blue/gray background, small text, rounded corners.
- Content: "Want to view your current setup? Install the CLI and run `tiddly status`."
- `tiddly status` in a `<code>` element.

**3. Upgrade → Update in docs (D6 frontend)**

In `DocsCLIHub.tsx`:
- Change `tiddly upgrade` reference to `tiddly update`.

### Testing Strategy

All tests are automated Vitest tests in `frontend/src/pages/settings/SettingsMCP.test.tsx` (for AISetupWidget) and `frontend/src/pages/docs/DocsAIHub.test.tsx` (for DocsCLIHub).

- **File details visible when command shown**: Verify `<details>` element renders when there are selections and a command is generated
- **File details hidden when no command**: Verify details section is absent when nothing is selected
- **File details content varies by tool**: Claude Code only → only Claude Code files listed. Codex only → only Codex files. Both → both sets.
- **File details content varies by scope**: User scope → home-directory paths. Directory scope → relative paths (except Claude Code MCP which still shows `~/.claude.json`).
- **Status tip always visible**: Verify the "tiddly status" callout is present in the CLI setup section
- **Status tip contains code element**: Verify `tiddly status` is in a `<code>` element
- **Docs page**: Verify DocsCLIHub references `tiddly update` not `tiddly upgrade`

---

## Milestone 4: Documentation Updates

### Goal & Outcome

Ensure `docs/ai-integration.md` reflects all changes and serves as the single source of truth for scope terminology.

After this milestone:
- `docs/ai-integration.md` reflects the simplified two-scope model (`user`/`directory`)
- Codex skills paths are corrected
- Known limitations are documented
- The test file header comment in `SettingsMCP.test.tsx` reflects the new architecture

### Implementation Outline

In `docs/ai-integration.md`:
- Verify the "Tiddly CLI Scope Mapping" and "Frontend UI" sections match what was implemented
- Verify "Known Limitations" section accurately reflects what was dropped and why

In `SettingsMCP.test.tsx`:
- Update the scenario matrix comment at top of file to reflect the simplified scope model

### Testing Strategy

No automated tests — documentation only. Manual review for accuracy.
