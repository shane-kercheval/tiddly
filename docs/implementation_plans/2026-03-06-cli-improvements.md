# CLI Improvements — Implementation Plan

Based on AI code review feedback, evaluated and prioritized on 2026-03-06.

Branch: `cli-improvements` (or new branch from `main` depending on merge state)

## Overview

Three tiers of work:

1. **Milestone 1 — Quick wins** (this PR): 7 small fixes, each independently correct
2. **Milestone 2 — Small tasks** (this PR or next): UserHomeDir error propagation, scope pre-validation
3. **Milestone 3 — Export worker pool** (separate PR)
4. **Milestone 4 — ToolHandler interface** (triggered by adding tool #4, not scheduled)

---

## Milestone 1: Quick Wins

**Goal**: Fix 7 small issues that are low-risk, low-effort, and independently mergeable.

**Outcome**:
- `CheckOrphanedTokens` only reports tokens for the tool being uninstalled
- Redundant "not logged in" error wrapping removed
- Redundant scope handling in `buildClaudeCodeConfig` and `UninstallClaudeCode` removed
- `parseTags` filters out empty strings from trailing commas
- Tar and zip extraction explicitly skip non-regular file types
- URL matching normalizes trailing slashes

### 1a. CheckOrphanedTokens scoped to tool name

**File**: `cli/internal/mcp/install.go`

**What**: `CheckOrphanedTokens` currently returns ALL `cli-mcp-*` tokens. It should filter by tool name since token names follow the pattern `cli-mcp-{tool}-{server}-{suffix}` (see `generateTokenName`).

**Change**: Add `toolName` parameter, filter by `fmt.Sprintf("%s%s-", tokenNamePrefix, toolName)`.

**Caller**: `cli/cmd/mcp.go` — update the uninstall command to pass `toolName`.

**Tests**:
- Existing tests updated for new signature
- New test: tokens for multiple tools exist, uninstalling one tool only reports that tool's tokens
- Edge case: no tokens match the tool name — returns empty slice

### 1b. Remove duplicated "not logged in" wrapping

**Files**: `cli/cmd/mcp.go`, `cli/cmd/skills.go`, any other command files with the pattern

**What**: Every command wraps `auth.ErrNotLoggedIn` with `fmt.Errorf("not logged in. Run 'tiddly login' first")`, but `ErrNotLoggedIn` already contains essentially the same message (`"not logged in. Run 'tiddly login' to authenticate"`). The wrapping adds no value and creates two slightly different messages.

**Change**: Replace all `if errors.Is(err, auth.ErrNotLoggedIn) { return fmt.Errorf(...) }` blocks with just `return err`.

**Tests**: Update any tests that assert on the exact error string. The sentinel error's message should be the canonical one.

### 1c. Remove redundant scope handling in claude_code.go

**File**: `cli/internal/mcp/claude_code.go`

**What**: In `buildClaudeCodeConfig` (lines 196-199) and `UninstallClaudeCode` (lines 252-255), there's a special case `if rc.Scope == "project"` that does `config["mcpServers"] = servers`. But `setMCPServersMap` already handles non-"local" scopes identically (line 114: `config["mcpServers"] = servers`). The special case is dead code that makes it look like there are three distinct storage paths when really "user" and "project" share the same slot.

**Change**: Remove both `if rc.Scope == "project"` branches. The `setMCPServersMap` call handles all scopes correctly.

**Tests**: Existing tests should pass unchanged — behavior is identical.

### 1d. parseTags filters empty strings

**File**: `cli/cmd/skills.go`

**What**: `parseTags("skill,")` produces `["skill", ""]` because trailing commas create empty strings after `TrimSpace`. Compare with `parseServersFlag` in `mcp.go` which correctly skips empties.

**Change**:
```go
func parseTags(csv string) []string {
    if csv == "" {
        return nil
    }
    parts := strings.Split(csv, ",")
    var result []string
    for _, t := range parts {
        t = strings.TrimSpace(t)
        if t != "" {
            result = append(result, t)
        }
    }
    if len(result) == 0 {
        return nil
    }
    return result
}
```

**Tests**:
- `"skill,"` -> `["skill"]`
- `","` -> `nil`
- `""` -> `nil`
- `"skill"` -> `["skill"]` (existing behavior preserved)
- `" skill , test "` -> `["skill", "test"]` (existing behavior preserved)

### 1e. Skip non-regular files in tar and zip extraction

**File**: `cli/internal/skills/install.go`

**What**: `extractTarGz` skips directories but doesn't explicitly reject symlinks (`tar.TypeSymlink`, `tar.TypeLink`). Currently safe because `writeFile` uses `os.Create`, but the security guarantee is accidental. Same issue in `extractZip` — it checks `IsDir()` but doesn't skip symlinks.

**Change in extractTarGz**: Replace the directory skip with:
```go
if header.Typeflag != tar.TypeReg {
    continue
}
```

**Change in extractZip**: Replace the `IsDir()` check with a check for regular files:
```go
if !f.FileInfo().Mode().IsRegular() {
    continue
}
```
This covers directories AND symlinks AND other special types in a single check.

**Tests**:
- Existing tests pass
- New test for tar: archive containing a symlink entry — verify it's skipped (not extracted)
- New test for zip: archive containing a non-regular entry — verify it's skipped
- Use `cli/internal/testutil/archive.go` helpers if they exist, or create test archives inline

### 1f. URL trailing slash normalization

**File**: `cli/internal/mcp/status.go`

**What**: `urlPrefix` returns `scheme + "://" + host + path` without normalizing trailing slashes. A manually edited config with `http://localhost:8001/mcp/` wouldn't match `http://localhost:8001/mcp`.

**Change**: Use `strings.TrimSuffix` (NOT `strings.TrimRight` — that would strip multiple slashes):
```go
func urlPrefix(rawURL string) string {
    u, err := url.Parse(rawURL)
    if err != nil || u.Host == "" {
        return rawURL
    }
    return u.Scheme + "://" + u.Host + strings.TrimSuffix(u.Path, "/")
}
```

**Tests**:
- `http://localhost:8001/mcp/` matches `http://localhost:8001/mcp`
- `http://localhost:8001/mcp` still matches itself
- `http://localhost:8001/` matches `http://localhost:8001` (root path)
- Existing status tests still pass

---

## Milestone 2: Small Tasks

**Goal**: Fix two issues that require slightly more effort — UserHomeDir error propagation and scope pre-validation for explicit tool lists.

**Outcome**:
- Config path functions return errors instead of silently producing invalid paths
- `tiddly mcp install claude-code codex --scope local` fails upfront instead of partially applying

### 2a. UserHomeDir error propagation

**Files**: `cli/internal/mcp/detect.go`, `cli/internal/mcp/claude_code.go`

**What**: `ClaudeCodeConfigPath()`, `ClaudeDesktopConfigPath()`, and `CodexConfigPath()` all discard the error from `os.UserHomeDir()` with `home, _ := os.UserHomeDir()`. In contrast, `skills/install.go:toolPath()` correctly returns the error. The inconsistency is sloppy and could produce paths like `/.claude.json` in containers.

**Change**: Change all three functions to return `(string, error)`. Propagate through callers:
- `DetectTools` / `detect*` functions: treat home dir error as tool-not-detected (mark `Installed: false`)
- `ResolvedConfigPath()`: change return to `(string, error)`
- `ResolveToolConfig()`: propagate error from path resolution
- All callers of these functions need updating

This is a larger ripple than it looks — trace all callers carefully. The `skills/install.go` pattern (returning error from `toolPath`) is the model to follow.

**Tests**:
- Mock `os.UserHomeDir` failure (or use a helper that wraps it) and verify tools are marked as not-installed rather than producing garbage paths
- Existing tests should pass with updated signatures

### 2b. Pre-validate scope for explicit tool lists

**File**: `cli/cmd/mcp.go`

**What**: When explicit tools are passed (`tiddly mcp install claude-code codex --scope local`), scope validation happens inside `RunInstall` per-tool. If claude-code succeeds and codex fails (doesn't support local scope), claude-code's config is already written. The auto-detect path correctly pre-filters.

**Change**: After building `targetTools` from explicit args (around line 96-110 in `mcp.go`), validate scope support for each tool before calling `RunInstall`:
```go
// Pre-validate scope for all explicit tools
if len(args) > 0 {
    var unsupported []string
    for _, t := range targetTools {
        supported := mcp.ToolSupportedScopes(t.Name)
        scopeOK := false
        for _, s := range supported {
            if s == scope {
                scopeOK = true
                break
            }
        }
        if !scopeOK {
            unsupported = append(unsupported, fmt.Sprintf("%s (valid: %s)", t.Name, strings.Join(supported, ", ")))
        }
    }
    if len(unsupported) > 0 {
        return fmt.Errorf("--scope %s is not supported by: %s", scope, strings.Join(unsupported, "; "))
    }
}
```

**Tests**:
- `install claude-code codex --scope local` returns error mentioning codex, no config files modified
- `install claude-code --scope local` still works (claude-code supports local)
- `install codex --scope local` returns error (codex doesn't support local)
- Auto-detect with `--scope local` still skips unsupported tools gracefully (existing behavior)

---

## Milestone 3: Export Worker Pool (separate PR)

**Goal**: Make `tiddly export` faster for large collections by fetching item content concurrently.

**Outcome**:
- Export uses a bounded worker pool (3-5 concurrent fetches) instead of sequential requests
- Output ordering is preserved
- No behavioral changes visible to the user beyond speed

**File**: `cli/internal/export/export.go`

**What**: `exportType` (line 91-100) fetches each item's full content individually with `client.GetContent`. For hundreds of items, this means hundreds of sequential HTTP requests.

**Implementation outline**:
- Use a worker pool pattern with a bounded channel (e.g., 5 workers)
- Collect results into an indexed slice to preserve output order
- Write items in order after all fetches for a page complete
- Keep the streaming JSON structure (don't buffer everything in memory)
- Consider per-page parallelism: fetch all items in a page concurrently, write them in order, then move to the next page

**Tests**:
- Existing export tests pass
- Test with mock API that tracks concurrent request count — verify it doesn't exceed the pool size
- Test output ordering is preserved regardless of which fetches complete first
- Test error handling: one fetch fails mid-batch, error is reported, partial results are not written

---

## Milestone 4: ToolHandler Interface

**Goal**: Replace per-operation switch statements with a `ToolHandler` interface and handler registry, so adding a new tool requires implementing one interface and registering it — no scattered switch updates.

**Outcome**:
- All 7 tool-dispatch switch statements replaced with handler method calls
- Adding a new tool = implement `ToolHandler` + register in `DefaultHandlers()`
- `configPathOverrides` global mutable test state eliminated
- Claude Desktop functions normalized to `ResolvedConfig` (same as claude-code and codex)

### Current state — 7 switch dispatch points to eliminate

| Location | Function | What it dispatches |
|----------|----------|--------------------|
| `resolve.go:17` | `ToolSupportedScopes` | tool name → supported scopes |
| `resolve.go:65` | `ResolveToolConfig` | tool name → config path resolution |
| `install.go:208` | `ExtractPATsFromTool` | tool name → PAT extraction |
| `install.go:254` | `installTool` | tool name → install + warnings |
| `install.go:286` | `dryRunTool` | tool name → dry-run diff |
| `cmd/status.go:356` | `getToolStatus` | tool name → status check |
| `cmd/mcp.go:328` | uninstall switch | tool name → uninstall |

Additionally, `detect.go` has 3 separate `detect*` functions called from a hardcoded list in `DetectTools`.

### Signature asymmetry to resolve

Claude Desktop functions take `configPath string` while claude-code/codex take `ResolvedConfig`. The interface normalizes everything to `ResolvedConfig`:

- `InstallClaudeDesktop(configPath, contentPAT, promptPAT string)` → `Install(rc ResolvedConfig, ...)`
- `UninstallClaudeDesktop(configPath string)` → `Uninstall(rc ResolvedConfig)`
- `StatusClaudeDesktop(configPath string)` → `Status(rc ResolvedConfig)`
- `DryRunClaudeDesktop(configPath, ...)` → `DryRun(rc ResolvedConfig, ...)`
- `ExtractClaudeDesktopPATs(configPath string)` → `ExtractPATs(rc ResolvedConfig)`

Each Claude Desktop method just uses `rc.Path` internally — the change is mechanical.

### Sub-milestones

This is broken into two sub-milestones to keep each review focused:

- **4a**: Define interface, implement handler structs, create registry. Purely additive — existing switch-based code continues to work.
- **4b**: Rewire all dispatch points to use handlers, eliminate old dispatch functions and `configPathOverrides` global state.

---

### Milestone 4a: Interface + Handlers + Registry

**Goal**: Define the `ToolHandler` interface, implement three handler structs, and create an ordered handler registry. This is purely additive — existing code still works.

**Outcome**:
- `ToolHandler` interface defined with all methods needed to eliminate switches
- `ClaudeDesktopHandler`, `ClaudeCodeHandler`, `CodexHandler` structs implement it
- `DefaultHandlers()` returns an ordered slice of handlers
- `GetHandler(name)` looks up a handler by name
- Claude Desktop methods normalized to `ResolvedConfig` signatures
- All existing tests pass unchanged

#### Interface

```go
// ToolHandler encapsulates all tool-specific behavior for MCP server management.
type ToolHandler interface {
    Name() string
    SupportedScopes() []string
    Detect(looker ExecLooker) DetectedTool
    ResolvePath(configPath, scope, cwd string) (string, error)
    Install(rc ResolvedConfig, contentPAT, promptPAT string, tool DetectedTool) (warnings []string, err error)
    Uninstall(rc ResolvedConfig) error
    Status(rc ResolvedConfig) (StatusResult, error)
    DryRun(rc ResolvedConfig, contentPAT, promptPAT string) (before, after string, err error)
    ExtractPATs(rc ResolvedConfig) (contentPAT, promptPAT string)
}
```

`Install` returns `([]string, error)` where `[]string` contains tool-specific warnings (HasNpx, plaintext token path, restart reminders). This keeps install + warnings in a single method call — no coordination required between separate methods.

#### Handler structs

Each handler struct wraps the existing per-tool functions as methods. The struct has a `ConfigPathOverride` field for test injection (replaces `configPathOverrides` global map):

```go
type ClaudeDesktopHandler struct {
    ConfigPathOverride string // set by tests; empty in production
}

func (h *ClaudeDesktopHandler) Name() string { return "claude-desktop" }
func (h *ClaudeDesktopHandler) SupportedScopes() []string { return []string{"user"} }
func (h *ClaudeDesktopHandler) Detect(looker ExecLooker) DetectedTool { ... }
// etc.
```

The `Detect` method uses `h.ConfigPathOverride` instead of looking up `configPathOverrides[toolName]`. The existing per-tool functions (`InstallClaudeDesktop`, `StatusClaudeDesktop`, etc.) become unexported and get called by the handler methods.

#### Registry

```go
// DefaultHandlers returns the production handler list.
// Order determines display order in CLI output (status, help, validation messages).
func DefaultHandlers() []ToolHandler {
    return []ToolHandler{
        &ClaudeDesktopHandler{},
        &ClaudeCodeHandler{},
        &CodexHandler{},
    }
}

// GetHandler finds a handler by name in the given slice.
func GetHandler(handlers []ToolHandler, name string) (ToolHandler, bool) {
    for _, h := range handlers {
        if h.Name() == name {
            return h, true
        }
    }
    return nil, false
}
```

Key design decisions:
- **Slice, not map**: Preserves display order for `tiddly status` and `tiddly mcp status`
- **`DefaultHandlers()` function, not global var**: Returns fresh instances, avoids shared mutable state
- **`GetHandler` takes a slice parameter**: No hidden global — callers pass the handler list they're using
- **No registration/deregistration API**: Three tools don't need runtime registration. `DefaultHandlers()` is the single source of truth.

#### File organization

- **`cli/internal/mcp/handler.go`** (new): Interface definition, `DefaultHandlers()`, `GetHandler()`
- **`cli/internal/mcp/handler_claude_desktop.go`** (new): `ClaudeDesktopHandler` struct + methods
- **`cli/internal/mcp/handler_claude_code.go`** (new): `ClaudeCodeHandler` struct + methods
- **`cli/internal/mcp/handler_codex.go`** (new): `CodexHandler` struct + methods

The handler methods delegate to the existing per-tool functions. Do NOT move the existing function bodies into handler methods yet — that creates a massive diff. Instead, handler methods are thin wrappers. Example:

```go
func (h *ClaudeDesktopHandler) Install(rc ResolvedConfig, contentPAT, promptPAT string, tool DetectedTool) ([]string, error) {
    if err := InstallClaudeDesktop(rc.Path, contentPAT, promptPAT); err != nil {
        return nil, err
    }
    var warnings []string
    if !tool.HasNpx {
        warnings = append(warnings, "Claude Desktop requires Node.js...")
    }
    warnings = append(warnings, fmt.Sprintf("Tokens are stored in plaintext in %s...", rc.Path))
    warnings = append(warnings, "Restart Claude Desktop to apply changes.")
    return warnings, nil
}
```

`Install` takes `DetectedTool` as a parameter to make the dependency explicit — `HasNpx` is needed by Claude Desktop's install. This avoids hidden temporal coupling between `Detect` and `Install` that would arise from caching state on the handler struct.

The existing exported functions (`InstallClaudeDesktop`, etc.) become unexported (`installClaudeDesktop`) in 4b when the callers are rewired.

#### Testing strategy for 4a

Since this milestone is purely additive, the primary tests verify:

- Each handler implements `ToolHandler` (compile-time check via `var _ ToolHandler = (*ClaudeDesktopHandler)(nil)`)
- `DefaultHandlers()` returns all 3 handlers in order
- `GetHandler()` finds by name, returns false for unknown names
- Each handler's `Name()` and `SupportedScopes()` return correct values
- Handler `Detect` with `ConfigPathOverride` works (set override, detect, verify `ConfigPath` matches)
- All existing tests still pass

---

### Milestone 4b: Rewire Dispatch + Eliminate Global State

**Goal**: Replace all switch-based dispatch with handler method calls, inject handlers through `appDeps`, and eliminate `configPathOverrides`.

**Outcome**:
- All 7 switch dispatch points replaced with handler lookups
- `DetectTools(looker)` replaced with `DetectAll(handlers, looker)` — takes handler list
- `configPathOverrides` map and `SetConfigPathOverride` removed entirely
- `AppDeps` carries the handler list; tests inject handlers with `ConfigPathOverride` set
- Old dispatch functions (`installTool`, `dryRunTool`, `ExtractPATsFromTool`) removed
- Old exported per-tool functions unexported (callers go through handlers)
- `validTools` list in `cmd/mcp.go` derived from handlers, not hardcoded

#### Changes to `AppDeps`

```go
type AppDeps struct {
    // ... existing fields ...
    ExecLooker   mcp.ExecLooker
    ToolHandlers []mcp.ToolHandler // NEW — replaces ExecLooker for tool detection
}
```

Production init:
```go
appDeps = &AppDeps{
    // ...
    ExecLooker:   &realExecLooker{},
    ToolHandlers: mcp.DefaultHandlers(),
}
```

`ExecLooker` stays on `AppDeps` because other code uses it (e.g., skills). Tool detection becomes:
```go
tools := mcp.DetectAll(appDeps.ToolHandlers, appDeps.ExecLooker)
```

#### Rewiring dispatch — example transformations

**`resolve.go`** — `ToolSupportedScopes` and `ResolveToolConfig`:

`ResolveToolConfig` keeps its current primitive-based signature — it remains a pure validation/resolution function. Callers that have a handler use `handler.SupportedScopes()` and `handler.ResolvePath()` directly. `ToolSupportedScopes(toolName)` can remain as a convenience that looks up the handler, or be removed if all callers have a handler available.

**`install.go`** — `installTool`, `dryRunTool`, `ExtractPATsFromTool`:

These become handler method calls in `RunInstall`:
```go
// Before:
if err := installTool(opts, tool, rc, contentPAT, promptPAT, result); err != nil { ... }

// After:
handler, ok := GetHandler(opts.Handlers, tool.Name)
if !ok {
    return nil, fmt.Errorf("no handler for tool %q", tool.Name)
}
warnings, err := handler.Install(rc, contentPAT, promptPAT, tool)
if err != nil { ... }
result.Warnings = append(result.Warnings, warnings...)
```

`InstallOpts` gets a `Handlers []ToolHandler` field.

**`cmd/mcp.go`** — uninstall switch:
```go
// Before:
switch toolName {
case "claude-desktop": mcp.UninstallClaudeDesktop(rc.Path)
// ...

// After:
handler, ok := mcp.GetHandler(appDeps.ToolHandlers, toolName)
if !ok {
    return fmt.Errorf("unknown tool %q", toolName)
}
if err := handler.Uninstall(rc); err != nil { ... }
```

**`cmd/status.go`** — `getToolStatus`:
```go
// Before:
switch tool.Name {
case "claude-desktop": return mcp.StatusClaudeDesktop(rc.Path)
// ...

// After:
handler, ok := mcp.GetHandler(appDeps.ToolHandlers, tool.Name)
if !ok {
    return mcp.StatusResult{}, fmt.Errorf("no handler for tool %q", tool.Name)
}
return handler.Status(rc)
```

**`cmd/mcp.go`** — `validTools`:
```go
// Before:
var validTools = []string{"claude-desktop", "claude-code", "codex"}

// After: derive from handlers
func validToolNames(handlers []mcp.ToolHandler) []string {
    names := make([]string, len(handlers))
    for i, h := range handlers {
        names[i] = h.Name()
    }
    return names
}
```

#### Eliminating `configPathOverrides`

The `configPathOverrides` global map and `SetConfigPathOverride` function are deleted. Tests that previously called `SetConfigPathOverride` instead construct handlers with overrides:

```go
// Before:
cleanup := mcp.SetConfigPathOverride("claude-code", configPath)
defer cleanup()

// After:
handlers := []mcp.ToolHandler{
    &mcp.ClaudeDesktopHandler{ConfigPathOverride: "/nonexistent"},
    &mcp.ClaudeCodeHandler{ConfigPathOverride: configPath},
    &mcp.CodexHandler{ConfigPathOverride: "/nonexistent"},
}
SetDeps(&AppDeps{
    // ...
    ToolHandlers: handlers,
})
```

This is more explicit and eliminates the global mutable state. Tests that only need one tool can construct a minimal handler list.

#### What gets unexported

Once all callers go through handlers, the following become unexported (lowercase):
- `InstallClaudeDesktop` → `installClaudeDesktop`
- `UninstallClaudeDesktop` → `uninstallClaudeDesktop`
- `StatusClaudeDesktop` → `statusClaudeDesktop`
- `DryRunClaudeDesktop` → `dryRunClaudeDesktop`
- `ExtractClaudeDesktopPATs` → `extractClaudeDesktopPATs`
- Same pattern for claude-code and codex variants
- `InstallClaudeCode`, `UninstallClaudeCode`, `StatusClaudeCode`, `DryRunClaudeCode`, `ExtractClaudeCodePATs`
- `InstallCodex`, `UninstallCodex`, `StatusCodex`, `DryRunCodex`, `ExtractCodexPATs`
- `DetectTools` → replaced by `DetectAll`

Functions that remain exported:
- `DefaultHandlers()`, `GetHandler()`, `DetectAll()`
- `ResolveToolConfig()` (signature changes to take handler)
- `RunInstall()` (signature changes: `InstallOpts` gets `Handlers` field)
- `IsScopeSupported()` (convenience, takes handler or remains as-is)
- The `ToolHandler` interface and handler struct types (public so tests can construct them)

#### Testing strategy for 4b

- **All ~50+ existing cmd and mcp tests must pass** — this is a refactor, not a behavior change
- Test that `DetectAll` returns tools in handler order
- Test that `GetHandler` returns `false` for unknown tool name
- Verify `configPathOverrides` and `SetConfigPathOverride` no longer exist (compile error if referenced)
- Tests that previously used `SetConfigPathOverride` work correctly with handler-injected overrides
- Test that `validToolNames()` derives from handlers (no hardcoded list)
- Test "unknown handler" error path for each top-level dispatch (install, status, uninstall) — these become real code paths when switches are replaced with `GetHandler` lookups

---

## Summary Table

| Milestone | Scope | Items | Status |
|-----------|-------|-------|--------|
| 1 | Quick wins | #5, #7, #8, #11, #12, #14 | Complete |
| 2 | Small tasks | #2, #13 | Complete |
| 3 | Export worker pool | #9 | Complete |
| 4a | ToolHandler interface + handlers + registry | #1, #4 | Complete |
| 4b | Rewire dispatch + eliminate global state | #1, #4 | Not started |
