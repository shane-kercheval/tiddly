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

## Milestone 4: ToolHandler Interface (triggered by tool #4)

**Goal**: Replace per-operation switch statements with a `ToolHandler` interface and handler registry.

**Trigger**: Do this refactor when adding a 4th tool (e.g., Cursor, Windsurf). Not scheduled independently.

**Outcome**:
- Adding a new tool requires implementing one interface and registering it
- No more switch statements scattered across 7+ locations
- Global mutable test state (`configPathOverrides`, `toolPathOverrides`) eliminated via dependency injection

**Sketch**:
```go
type ToolHandler interface {
    Name() string
    SupportedScopes() []string
    Detect(looker ExecLooker) DetectedTool
    ResolvePath(configPath, scope, cwd string) string
    Install(rc ResolvedConfig, contentPAT, promptPAT string) error
    Uninstall(rc ResolvedConfig) error
    Status(rc ResolvedConfig) (StatusResult, error)
    DryRun(rc ResolvedConfig, contentPAT, promptPAT string) (before, after string, err error)
    ExtractPATs(rc ResolvedConfig) (contentPAT, promptPAT string)
}
```

Registry:
```go
var handlers = map[string]ToolHandler{
    "claude-desktop": &ClaudeDesktopHandler{},
    "claude-code":    &ClaudeCodeHandler{},
    "codex":          &CodexHandler{},
}
```

**Bundled with**: Eliminating global mutable test state (#4 from review). Inject path resolution into the handler or via a `PathResolver` parameter rather than using package-level maps.

**Tests**: All existing tests should pass with updated call sites. Add a test that registering a handler with a duplicate name panics or errors.

---

## Summary Table

| Milestone | Scope | Items | Status |
|-----------|-------|-------|--------|
| 1 | Quick wins | #5, #7, #8, #11, #12, #14 | Complete |
| 2 | Small tasks | #2, #13 | Complete |
| 3 | Export worker pool | #9 | Not started (separate PR) |
| 4 | ToolHandler interface | #1, #4 | Deferred (trigger: tool #4) |
