# AI Integration Settings & CLI Remove Improvements

## Overview

The Settings AI Integration page and `tiddly mcp remove` CLI command have several issues:

1. **Route mismatch**: Frontend uses `/settings/mcp` instead of `/settings/ai-integration`
2. **Missing scope selector in remove flow**: Users need scope to target the right config location
3. **No `cd` instructions**: Project/local scopes need cwd context, but the UI doesn't mention it
4. **Skills removal incomplete**: No destructive-action warning, no actual remove commands
5. **Bug — `--servers` flag unsupported on remove**: UI generates `--servers` for `mcp remove` but the CLI doesn't support it — remove always deletes all tiddly servers. Need to add the flag so users can selectively remove content or prompts.

---

## Milestone 1: CLI — Add `--servers` flag to `mcp remove`

### Goal & Outcome

Add `--servers` flag support to `tiddly mcp remove` so users can selectively remove content or prompts servers without removing both.

After this milestone:
- `tiddly mcp remove claude-code --servers content` removes only the content server, preserving prompts
- `tiddly mcp remove claude-code --servers prompts` removes only the prompts server, preserving content
- `tiddly mcp remove claude-code` (no flag) removes both (existing behavior)
- `tiddly mcp remove claude-code --servers content --delete-tokens` only revokes the content PAT, not the prompts PAT
- All existing tests still pass with updated signatures

### Implementation Outline

#### 1. Add `serverURLMatcher` utility

**File: `cli/internal/mcp/status.go`**

Add a new function that converts a `[]string` of server names into a URL predicate, reusing existing `isTiddlyURL` (line 82), `isTiddlyContentURL` (line 72), `isTiddlyPromptURL` (line 77).

```go
func serverURLMatcher(servers []string) func(string) bool {
    wantContent, wantPrompts := false, false
    for _, s := range servers {
        switch s {
        case "content":  wantContent = true
        case "prompts":  wantPrompts = true
        }
    }
    switch {
    case wantContent && wantPrompts: return isTiddlyURL
    case wantContent:                return isTiddlyContentURL
    case wantPrompts:                return isTiddlyPromptURL
    default:                         return func(string) bool { return false }
    }
}
```

Note: `tiddlyURLMatcher` in `configure.go:23` does the same thing keyed on PAT presence — both converge on the same three predicates. They serve different use cases (configure vs remove) so keeping them separate is fine.

#### 2. Change `ToolHandler.Remove` interface signature

**File: `cli/internal/mcp/handler.go:18`**

```go
Remove(rc ResolvedConfig, servers []string) error
```

#### 3. Update handler Remove implementations

Thread `servers` through each handler and swap `isTiddlyURL` for `serverURLMatcher(servers)`.

**Handler files** (add `servers []string` param to `Remove` method):
- `cli/internal/mcp/handler_claude_code.go:44` — pass to `removeClaudeCode(rc, servers)`
- `cli/internal/mcp/handler_claude_desktop.go:65` — pass to `removeClaudeDesktop(rc.Path, servers)` (note: desktop takes `configPath string`, not `ResolvedConfig` — keep existing pattern)
- `cli/internal/mcp/handler_codex.go:62` — pass to `removeCodex(rc, servers)`

**Internal remove functions** — change the `isTiddlyURL` call to `serverURLMatcher(servers)`:
- `cli/internal/mcp/claude_code.go:212` — `removeJSONServersByTiddlyURL(servers, isTiddlyURL)` → `removeJSONServersByTiddlyURL(servers, serverURLMatcher(serversList))`
- `cli/internal/mcp/claude_desktop.go:105` — same pattern
- `cli/internal/mcp/codex.go:132` — `removeCodexServersByTiddlyURL(config.MCPServers, isTiddlyURL)` → `removeCodexServersByTiddlyURL(config.MCPServers, serverURLMatcher(serversList))`

#### 4. Add `--servers` flag to remove command

**File: `cli/cmd/mcp.go:280-398`**

- Add `servers string` var alongside existing `deleteTokens` and `scope` (line 282)
- Register: `cmd.Flags().StringVar(&servers, "servers", "content,prompts", "Which servers to remove: content, prompts, or both")`
- Parse with existing `parseServersFlag(servers)` (line 219)
- Pass to `handler.Remove(rc, serverList)`

**Important — filter `ExtractPATs` when `--delete-tokens`**: Currently lines 346-353 extract both content and prompt PATs unconditionally. Gate on `serverList` contents to avoid revoking the wrong PAT:

```go
contentPAT, promptPAT := handler.ExtractPATs(rc)
if deleteTokens {
    wantContent := contains(serverList, "content")
    wantPrompts := contains(serverList, "prompts")
    if wantContent && contentPAT != "" {
        extractedPATs = append(extractedPATs, contentPAT)
    }
    if wantPrompts && promptPAT != "" && promptPAT != contentPAT {
        extractedPATs = append(extractedPATs, promptPAT)
    }
}
```

### Testing Strategy

**Update all `.Remove(` call sites** — add `[]string{"content", "prompts"}` param. Find all sites via `rg '\.Remove\(' cli/internal/mcp cli/cmd/mcp.go`. Known call sites:
- `cli/cmd/mcp.go:356` — the remove command handler
- `cli/internal/mcp/handler_test.go:176` — `TestClaudeCodeHandler__configure_and_remove`
- `cli/internal/mcp/configure_test.go:946` — backup test
- All `TestRemoveClaudeCode__*` tests in `cli/internal/mcp/claude_code_test.go`
- All `TestRemoveClaudeDesktop__*` tests in `cli/internal/mcp/claude_desktop_test.go`
- All `TestRemoveCodex__*` tests in `cli/internal/mcp/codex_test.go`

**New unit tests for `serverURLMatcher`** in `cli/internal/mcp/status_test.go`:
- `["content"]` — matches content URL, not prompts URL
- `["prompts"]` — matches prompts URL, not content URL
- `["content", "prompts"]` — matches both
- Empty slice — matches nothing
- Non-tiddly URL — never matches

**New per-handler tests** (add to each handler's test file):
- Remove content only → prompts server preserved in config
- Remove prompts only → content server preserved in config

**New CLI flag tests** in `cli/cmd/mcp_test.go`:
- `--servers content` flag parsed correctly
- `--servers prompts` flag parsed correctly
- Default (no flag) removes both
- `--servers content --delete-tokens` only revokes content PAT

**Verification**: `cd cli && go test ./internal/mcp/... ./cmd/...`

---

## Milestone 2: Frontend — Route, Scope, CD, Skills Warning

### Goal & Outcome

Fix the frontend AI Integration page route and improve the remove flow UX.

After this milestone:
- Route is `/app/settings/ai-integration` instead of `/app/settings/mcp`
- Remove flow shows MCP scope selector (multi-select) so users can target specific scopes
- Amber callout appears when local/project scope is selected, reminding users to `cd` first
- Skills removal shows a destructive-action warning and actual `rm -rf` commands
- Generated remove commands include `--scope` when not default, and one command per tool per scope

### Implementation Outline

#### 1. Route rename: `/app/settings/mcp` → `/app/settings/ai-integration`

String replacement in these files:
- `frontend/src/App.tsx:159` — route path
- `frontend/src/App.tsx:200` — comment
- `frontend/src/components/sidebar/Sidebar.tsx:637` — sidebar nav link
- `frontend/src/components/CommandPalette.tsx:382` — command palette entry
- `frontend/src/routePrefetch.ts:42` — lazy-load prefetch key
- `frontend/src/routePrefetch.test.ts:46` — test assertion

No redirect needed — this is a settings page with no external links.

#### 2. MCP scope selector in remove flow

**File: `frontend/src/components/AISetupWidget.tsx`**

Add new state for remove scopes:
```ts
const [removeMcpScopes, setRemoveMcpScopes] = useState<Set<McpScopeType>>(new Set(['user']))
```

Restructure the remove Options section (currently lines 593-611 — only shows delete tokens):
- Single "Options" `<div>` containing:
  - **MCP Scope** — `PillToggleGroup` multi-select (user, local, project) — only shown when `isRemove && hasMcpServers`
  - **Delete Tokens** — existing yes/no toggle
- Show scope warnings per selected scope (reuse `getMcpScopeWarnings`, iterate over each scope in `removeMcpScopes`)
- Keep scope hidden when only skills are selected (no scope needed for `rm -rf`)

Update `generateRemoveCommands` signature to accept `mcpScopes: Set<McpScopeType>`:
- Generate one `tiddly mcp remove <tool>` command per tool per scope
- Add `--scope X` when scope is not `'user'`
- Add `--servers` when not both selected
- Add `--delete-tokens` when enabled

Update `generateCLICommands` to forward `removeMcpScopes`.

#### 3. `cd` instructions for project/local scopes

**File: `frontend/src/components/AISetupWidget.tsx`**

Add an amber callout (`data-testid="cd-note"`) below the command code block when:
- **Configure**: `mcpScope` is `'local'` or `'project'`, or `skillsScope` is `'project'`
- **Remove**: any scope in `removeMcpScopes` is `'local'` or `'project'`

Content:
```
Note: Local and project scopes are resolved from your current working directory.
Run `cd /path/to/your/project` before running the command above.
```

#### 4. Skills removal warning + commands

**File: `frontend/src/components/AISetupWidget.tsx`**

**Warning** (`data-testid="skills-remove-warning"`) when `isRemove && installSkills`:
> **Warning:** The CLI cannot distinguish Tiddly skills from other skills. The commands below will delete *all* skill files in the skills directories, including any non-Tiddly skills.

**Commands** in `generateRemoveCommands` — when `removeSkills` is true, generate actual executable commands per selected tool:

For Claude Code:
```sh
# Remove Claude Code skills (includes non-Tiddly skills)
rm -rf ~/.claude/skills/
```

For Codex:
```sh
# Remove Codex skills (includes non-Tiddly skills)
rm -rf ~/.codex/skills/
```

For Claude Desktop: `# Claude Desktop: manually remove skills from Settings → Capabilities`

When any remove scope includes `'local'` or `'project'`, also include project-level paths:
```sh
# Remove project-level Claude Code skills (includes non-Tiddly skills)
rm -rf .claude/skills/
# Remove project-level Codex skills (includes non-Tiddly skills)
rm -rf .codex/skills/
```

These replace the current comment-only output (lines 384-394).

**Future improvement**: A `tiddly skills remove` CLI command that only removes Tiddly-owned skill files (e.g., by naming convention or manifest) would be safer than `rm -rf`. Out of scope for this plan.

#### 5. Empty selection handling

The current `hasAnything` (line 485) checks servers/skills + tools but not scopes. When all remove scopes are deselected, `generateRemoveCommands` produces an empty string but `hasAnything` is still `true`, rendering an empty code block.

Update `hasAnything` to account for remove scopes:
```ts
const hasAnything = isRemove
  ? ((hasMcpServers && removeMcpScopes.size > 0) || installSkills) && selectedTools.size > 0
  : (hasMcpServers || installSkills) && selectedTools.size > 0
```

### Testing Strategy

**File: `frontend/src/pages/settings/SettingsMCP.test.tsx`**

Read the existing test file first to understand patterns, then add:

**Route rename tests:**
- Verify the route change works in `routePrefetch.test.ts` (update existing assertion)

**Remove flow scope tests:**
- Scope selector appears when action=remove and MCP servers selected
- Scope selector hidden when action=remove and only skills selected
- Selecting multiple scopes generates one command per tool per scope
- Scope warnings appear for unsupported tool/scope combinations
- Default scope is `user` only

**`cd` instruction tests:**
- `cd` note appears when configure with local scope
- `cd` note appears when configure with project scope
- `cd` note appears when remove with local/project scope in set
- `cd` note hidden when only user scope selected

**Skills removal tests:**
- Warning appears when action=remove and skills=yes
- Warning hidden when action=configure
- Actual `rm -rf` commands generated for skills removal
- Claude Desktop skills show manual instruction
- Project-level skill paths included when local/project scope selected

**Empty selection tests:**
- Deselecting all remove scopes hides the command block (no empty code block rendered)

**Verification**: `cd frontend && npx vitest run src/pages/settings/SettingsMCP.test.tsx`

---

## Review Notes

### Important Concerns

1. **`--delete-tokens` + `--servers` filtering (Milestone 1)**: `ExtractPATs` returns both `(contentPAT, promptPAT)`. Must gate extraction on `serverList` to avoid revoking the wrong PAT when only removing one server. This is the most critical correctness issue.

### Manual Verification

1. `tiddly mcp remove claude-code --servers content` removes only content server
2. `tiddly mcp remove claude-code --servers content --delete-tokens` revokes only content PAT
3. `tiddly mcp remove claude-code` removes both (backward compatible)
4. UI remove flow shows scope selector with multi-select
5. UI shows `cd` note when local/project scope selected
6. UI shows skills warning when removing skills
