# CLI Terminology & Settings UI Cleanup

Resolves inconsistencies between our CLI/UI scope terminology and upstream tool conventions. Also improves the Settings > AI Integration UX.

Background research and official tool documentation: [docs/ai-integration.md](../ai-integration.md)

## Decisions

### D1: Rename skills `--scope global` to `--scope user`

Both Claude Code and Codex use "user" terminology for the user-level scope. Claude Code explicitly renamed `global` → `user`. Codex calls it "User-level" (MCP) and `USER` (skills). We are the only ones using "global."

**Change**: `tiddly skills configure --scope global` → `tiddly skills configure --scope user`

### D2: Merge MCP and Skills scope selectors into one

The Settings UI currently shows two separate scope selectors (MCP Scope and Skills Scope). This adds cognitive overhead for every user to serve the rare case of wanting different scopes for MCP vs skills. Users who need that can run two separate CLI commands.

**Change**: Replace both selectors with a single "Scope" selector. Options: `User`, `Local` (Claude Code only), `Project`. The selected scope applies to both MCP and skills.

Edge case: when scope is `local` (Claude Code MCP-only concept), skills default to `user` scope since `local` has no skills equivalent. Show an inline note in the UI when this occurs.

### D3: Consistent UI label — "User" everywhere

Current state: MCP shows "User (global)", skills shows "Global". Both mean the same thing.

**Change**: Use "User" as the label for the user-level scope. Drop "(global)" parenthetical and "Global" label entirely.

### D4: Add collapsible file details below generated command

Users have no visibility into which files are actually modified. This is useful for debugging and builds trust.

**Change**: Add a collapsible section below the generated command showing the files that will be created or modified, along with the upstream tool's own terminology. Example:

```
~/.claude.json            Claude Code MCP (user scope)
~/.codex/config.toml      Codex MCP (user-level)
~/.claude/skills/         Claude Code skills (personal)
~/.agents/skills/         Codex skills (USER scope)
```

### D5: Add "tiddly status" tip above Action selector

**Change**: Add a subtle info callout above the Action selector:

> Want to view your current setup? Install the CLI and run `tiddly status`.

Light styling (info, not warning). Discoverable without being intrusive.

### D6: Rename `tiddly upgrade` to `tiddly update`

"Upgrade" implies a subscription tier change (and we may add `tiddly upgrade` for that purpose later). What the command actually does is update the CLI binary.

**Change**: Rename `upgrade` → `update` across CLI, frontend docs, and install instructions. No backwards-compatible alias — small beta user base, prioritize clean code.

### D7: Codex skills path correction

Our CLI currently writes Codex skills to `~/.codex/skills/` and `.codex/skills/`, but Codex's official docs say skills live at `$HOME/.agents/skills` (USER scope) and `$CWD/.agents/skills` (REPO scope).

**Change**: Update CLI to write Codex skills to `~/.agents/skills/` (user scope) and `.agents/skills/` (project scope). Update the remove flow's `rm -rf` paths accordingly.

---

## Milestone 1: CLI Renames (D1, D6, D7)

### Goal & Outcome

Align CLI command names and scope terminology with upstream conventions.

After this milestone:
- `tiddly update` replaces `tiddly upgrade` for updating the CLI binary
- `tiddly skills configure --scope user` replaces `--scope global`
- Codex skills are written to `~/.agents/skills/` (user) and `.agents/skills/` (project) matching official Codex docs
- All CLI help text and error messages reflect the new terminology

### Implementation Outline

**Read first:**
- [docs/ai-integration.md](../ai-integration.md) for the upstream terminology research
- [Codex Skills docs](https://developers.openai.com/codex/skills) for official skills paths

**1. Rename `upgrade` → `update` (D6)**

- Rename `cli/cmd/upgrade.go` → `cli/cmd/update.go`, `cli/cmd/upgrade_test.go` → `cli/cmd/update_test.go`
- Update cobra command: `Use: "update"`, `Short: "Update Tiddly CLI to the latest version"`
- Update `cli/cmd/root.go` to register the renamed command
- Update `cli/cmd/update_check.go` — the background update checker likely prints "run `tiddly upgrade`"; change to `tiddly update`
- Grep for any remaining "upgrade" references in `cli/` and update (README, internal strings, etc.)

**2. Rename skills `--scope global` → `--scope user` (D1)**

- Find where skills scope values are defined (likely `cli/cmd/skills.go` or a shared scope constants file)
- Change the accepted scope value from `global` to `user`
- Update all path-resolution logic that maps scope → directory (e.g., `global` → `~/.claude/skills/` becomes `user` → `~/.claude/skills/`)
- Update help text and validation error messages

**3. Fix Codex skills paths (D7)**

- Find where Codex skills directory paths are defined
- Change user-scope path: `~/.codex/skills/` → `~/.agents/skills/`
- Change project-scope path: `.codex/skills/` → `.agents/skills/`

### Testing Strategy

- **`tiddly update` command**: Test that the command registers and runs (existing upgrade tests adapted to new name)
- **`tiddly update` in update checker**: Test that the background update check message says "tiddly update" not "tiddly upgrade"
- **Skills scope `user`**: Test that `--scope user` writes to the correct user-level directories for both Claude Code and Codex
- **Skills scope `user` for Codex paths**: Test that Codex user-scope skills go to `~/.agents/skills/`, not `~/.codex/skills/`
- **Skills scope `project` for Codex paths**: Test that Codex project-scope skills go to `.agents/skills/`, not `.codex/skills/`
- **Claude Code paths unchanged**: Verify Claude Code paths (`~/.claude/skills/`, `.claude/skills/`) are not affected

---

## Milestone 2: Frontend — Merge Scopes & Rename Labels (D2, D3)

### Goal & Outcome

Simplify the Settings > AI Integration UI to use a single scope selector with consistent terminology.

After this milestone:
- One "Scope" selector applies to both MCP and skills (no separate MCP Scope / Skills Scope)
- Scope options labeled "User", "Local", "Project" (no more "User (global)" or "Global")
- When `local` scope is selected and skills are enabled, an inline note explains skills default to user scope
- Scope options are still filtered by selected tools (e.g., `local` hidden when only Codex selected)
- Scope auto-resets when the selected scope becomes unavailable

### Implementation Outline

**Read first:**
- Current `AISetupWidget.tsx` — understand the existing dual-scope architecture
- Current `SettingsMCP.test.tsx` — understand existing test patterns

**1. Remove `SkillsScopeType` and merge state**

In `AISetupWidget.tsx`:
- Remove `skillsScope`, `removeSkillsScope`, `SkillsScopeType` state and type
- Use `McpScopeType` (renamed to `ScopeType`) as the single scope type: `'user' | 'local' | 'project'`
- Derive the effective skills scope from the unified scope:
  - `user` or `local` → skills scope `user`
  - `project` → skills scope `project`
- Update `SKILLS_SCOPE_SUPPORT` to use `user` instead of `global`

**2. Update command generation**

- `generateCLICommands`: Remove `skillsScope` parameter. Derive skills `--scope` from the unified scope. The CLI flag becomes `--scope user` (was `--scope global`).
- `generateRemoveCommands`: Same — derive skills scope from unified scope. Update Codex paths: `~/.agents/skills/` and `.agents/skills/`.

**3. Update UI**

- Remove the separate "Skills Scope" selector row from both configure and remove flows
- Rename "MCP Scope" label → "Scope"
- Rename "User (global)" pill → "User"
- Remove "Global" pill entirely
- Remove `getSkillsScopeWarnings` — scope warnings now only come from `getMcpScopeWarnings` (renamed to `getScopeWarnings`)
- When `local` is selected and skills are enabled, show an inline note: "Skills will be installed at User scope (Local scope only applies to MCP configuration)."

**4. Update scope filtering**

- `getAvailableMcpScopes` → `getAvailableScopes` (single function since scopes are unified)
- The scope filtering logic should consider both MCP and skills support. A scope is available if at least one selected tool supports it for MCP (when MCP servers are selected) or skills (when skills are enabled).

### Testing Strategy

- **Single scope selector visible**: Verify one "Scope" selector appears (not "MCP Scope" + "Skills Scope")
- **"User" label**: Verify "User" pill is present, "User (global)" and "Global" are gone
- **Scope applies to both MCP and skills commands**: Select scope "project" → verify both `tiddly mcp configure --scope project` and `tiddly skills configure --scope project` appear
- **Local scope + skills**: Select "Local" with skills enabled → verify skills command uses `--scope user` and inline note appears
- **Scope filtering still works**: Only Codex selected → "Local" hidden. Only Claude Desktop → only "User" shown.
- **Scope auto-reset**: Select "Local", deselect Claude Code → scope resets to "User", "Local" disappears
- **Scope warnings**: Claude Code + Codex selected, "Local" scope → warning that Codex will be skipped
- **Remove flow**: Single scope selector in remove flow, skills removal paths use `~/.agents/skills/` for Codex
- **Codex skills removal paths**: Verify `rm -rf` commands reference `.agents/skills/` (project) and `~/.agents/skills/` (user), not `.codex/skills/`/`~/.codex/skills/`
- **Configure command with unified scope**: User scope → commands joined with `&&`. Local/project scope → `cd` prepended, commands joined with newlines.

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
- Add a function `getAffectedFiles(action, selectedTools, scope, hasMcpServers, installSkills)` returning `Array<{ path: string; description: string }>`.
- The list varies based on selected tools and scope. For example, with Claude Code + Codex at user scope with both MCP + skills:
  ```
  ~/.claude.json            Claude Code MCP (--scope user)
  ~/.codex/config.toml      Codex MCP (user-level config)
  ~/.claude/skills/         Claude Code skills (personal)
  ~/.agents/skills/         Codex skills (USER scope)
  ```
- For project scope:
  ```
  .mcp.json                 Claude Code MCP (--scope project, shared)
  .codex/config.toml        Codex MCP (project-scoped config)
  .claude/skills/           Claude Code skills (project)
  .agents/skills/           Codex skills (REPO scope)
  ```
- Render as a `<details><summary>Files modified</summary>` below the command `<pre>` block.
- Style the file list as a compact, monospace table. Use subtle colors (gray text).

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
- **File details content varies by scope**: User scope → home-directory paths. Project scope → relative paths.
- **File details content varies by action**: Remove flow → shows same files but may indicate removal
- **Status tip always visible**: Verify the "tiddly status" callout is present in the CLI setup section
- **Status tip contains code element**: Verify `tiddly status` is in a `<code>` element
- **Docs page**: Verify DocsCLIHub references `tiddly update` not `tiddly upgrade`

---

## Milestone 4: Documentation Updates

### Goal & Outcome

Ensure `docs/ai-integration.md` reflects all changes and serves as the single source of truth for scope terminology.

After this milestone:
- `docs/ai-integration.md` reflects the new `user` terminology for skills scopes
- Codex skills paths are corrected
- Known inconsistencies are resolved and noted as such
- The implementation plan is linked for historical context

### Implementation Outline

In `docs/ai-integration.md`:
- Update "Tiddly CLI Scope Mapping" tables: skills `--scope global` → `--scope user`
- Update Codex skills paths in mapping table: `~/.codex/skills/` → `~/.agents/skills/`, `.codex/skills/` → `.agents/skills/`
- Update "Frontend UI Scope Support Matrix" skills table: `global` → `user`
- Replace the "Known Inconsistencies" TODO section with a "Resolved Inconsistencies" section noting that items 1-5 were addressed by this plan (link to `implementation_plans/2026-03-14-cli-terminology-cleanup.md`)
- Update the test file header comment in `SettingsMCP.test.tsx` to reflect the new single-scope architecture

### Testing Strategy

No automated tests — this is documentation only. Manual review for accuracy and broken links.
