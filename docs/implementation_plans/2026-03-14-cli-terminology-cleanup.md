# CLI Terminology & Settings UI Cleanup

Resolves inconsistencies between our CLI/UI scope terminology and upstream tool conventions. Also improves the Settings > AI Integration UX.

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

Tooltip for "Directory": "Configuration is stored in the current working directory and only applies when running tools from that location."

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

Our CLI currently writes Codex skills to `~/.codex/skills/` and `.codex/skills/`, but Codex's official docs say skills live at `$HOME/.agents/skills` (USER scope) and `$CWD/.agents/skills` (REPO scope).

Update CLI to write to `~/.agents/skills/` (user) and `.agents/skills/` (directory). Update the remove flow's `rm -rf` paths accordingly.

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

### Implementation Outline

**Read first:**
- [docs/ai-integration.md](../ai-integration.md) for the upstream terminology research and mapping table
- [Codex Skills docs](https://developers.openai.com/codex/skills) for official skills paths
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) for scope flag reference

**1. Rename `upgrade` → `update` (D6)**

- Rename `cli/cmd/upgrade.go` → `cli/cmd/update.go`, `cli/cmd/upgrade_test.go` → `cli/cmd/update_test.go`
- Update cobra command: `Use: "update"`, `Short: "Update Tiddly CLI to the latest version"`
- Update `cli/cmd/root.go` to register the renamed command
- Update `cli/cmd/update_check.go` — the background update checker likely prints "run `tiddly upgrade`"; change to `tiddly update`
- Grep for any remaining "upgrade" references in `cli/` and update (README, internal strings, etc.)

**2. Simplify scopes to `user`/`directory` (D1)**

- Find where scope values are defined for both MCP and skills (likely `cli/cmd/skills.go`, `cli/cmd/mcp.go`, or a shared scope constants file)
- Replace all scope values: `global` → `user`, `local` → `directory`, `project` → remove
- For MCP: `--scope user` maps to Claude Code `--scope user`, `--scope directory` maps to Claude Code `--scope local`
- For skills: `--scope user` maps to user-level skill directories, `--scope directory` maps to CWD-relative skill directories
- Remove any `project` scope handling (Claude Code `--scope project` / `.mcp.json`)
- Update help text, validation, and error messages

**3. Fix Codex skills paths (D7)**

- Find where Codex skills directory paths are defined
- Change user-scope path: `~/.codex/skills/` → `~/.agents/skills/`
- Change directory-scope path: `.codex/skills/` → `.agents/skills/`

### Testing Strategy

- **`tiddly update` command**: Existing upgrade tests adapted to new name; verify command registers and runs
- **`tiddly update` in update checker**: Verify background update check message says `tiddly update`
- **MCP `--scope user`**: Verify maps to Claude Code `--scope user` and Codex `~/.codex/config.toml`
- **MCP `--scope directory`**: Verify maps to Claude Code `--scope local` and Codex `.codex/config.toml`
- **Skills `--scope user`**: Verify writes to `~/.claude/skills/` (Claude Code) and `~/.agents/skills/` (Codex)
- **Skills `--scope directory`**: Verify writes to `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex)
- **`--scope project` rejected**: Verify `--scope project` and `--scope global` and `--scope local` are not accepted
- **Help text**: Verify help output shows `user` and `directory` as the only scope options

---

## Milestone 2: Frontend — Unified Scope & Labels (D2, D3)

### Goal & Outcome

Simplify the Settings > AI Integration UI to a single scope selector with clear, consistent terminology.

After this milestone:
- One "Scope" selector with two options: "User" and "Directory"
- Both options always available — no per-tool filtering, warnings, or auto-reset logic
- Scope applies to both MCP and skills commands
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

- `generateCLICommands`: Accepts a single `scope: ScopeType`. Maps `directory` → `--scope directory` for both MCP and skills. Maps `user` → default (no flag needed if user is the default, or `--scope user`).
- `generateRemoveCommands`: Same single scope. For skills removal:
  - `user` → `~/.claude/skills/`, `~/.agents/skills/`
  - `directory` → `.claude/skills/`, `.agents/skills/`
- `needsCd` is true when scope is `directory`

**3. Update UI**

- Replace both "MCP Scope" and "Skills Scope" selector rows with a single "Scope" row in both configure and remove flows
- Two pill options: "User" and "Directory"
- Section label: "Scope"
- Tooltip on "Directory": "Configuration is stored in the current working directory and only applies when running tools from that location."
- Remove the Claude Code "Note: Claude Code defaults to local (per-project) scope..." message — no longer relevant with simplified scopes

**4. Simplify scope options**

- Static options, no filtering:
  ```typescript
  const scopeOptions: PillOption<ScopeType>[] = [
    { value: 'user', label: 'User' },
    { value: 'directory', label: 'Directory' },
  ]
  ```

### Testing Strategy

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
