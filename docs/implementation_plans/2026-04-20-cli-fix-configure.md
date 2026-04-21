# CLI `mcp configure`: Additive Behavior for Non-Canonical Tiddly Entries

**Date:** 2026-04-20
**Status:** Planned
**Breaking change:** Yes — removes the consolidation gate, deletes the `--yes` flag entirely, adds a new `--force` flag on `mcp configure`, changes `mcp remove` default semantics (canonical-name-only, URL-agnostic), and changes three helper/interface signatures: `DeleteTokensByPrefix` and `CheckOrphanedTokens` (structured per-entry attribution) and `ToolHandler.Remove` (returns `*RemoveResult` instead of `(backupPath, err)`). Also extends `OtherServer` with a `URL` field. No backwards-compatibility shims. The CLI is pre-GA; users with scripted `--yes` invocations will see Cobra's "unknown flag" error and should drop the flag.
**Supersedes:** portions of KAN-112 (PR #117, commit `3d7a1b1`).

---

## Background

PR #117 (KAN-112) added a **consolidation** workflow to `tiddly mcp configure`. When a user had multiple MCP entries pointing at Tiddly URLs under non-canonical key names (e.g. `work_prompts` + `personal_prompts` pointing at the Tiddly prompts server with two different PATs / accounts), `configure`:

1. Detected these as a "ConsolidationGroup".
2. Required a Y/N confirmation (interactive) or `--yes` flag (non-interactive) to proceed.
3. On confirmation, wrote the canonical entry (`tiddly_notes_bookmarks` / `tiddly_prompts`) using one survivor's PAT and **deleted the other entries** from the config file.

That behavior is wrong. MCP fully supports multiple entries pointing at the same URL with distinct PATs (distinct account contexts). The CLI's job is to manage **its own canonical entries**, not to claim ownership over any Tiddly-URL entry the user created. A user who deliberately set up `work_prompts` + `home_prompts` has a legitimate working configuration; `tiddly mcp configure` must not destroy it.

### Desired behavior

- `tiddly mcp configure` is **additive**: it writes or updates the two canonical entries only (`tiddly_notes_bookmarks`, `tiddly_prompts`, scoped by `--servers`). Non-canonical Tiddly-URL entries are left untouched.
- If a canonical entry already exists and points at the **correct Tiddly URL for its type**, it's updated in place — **validate-then-mint** semantics are preserved.
- If a canonical entry exists but points at either a non-Tiddly URL OR the wrong-type Tiddly URL (e.g. `tiddly_prompts` pointing at the content server), configure **fails closed** with an actionable error listing the file path, key name, and current URL. The user can (a) hand-edit to rename the entry, preserving their custom setup, or (b) re-run with `--force` to overwrite. In a multi-tool run, preflight aggregates mismatches across all successfully-inspected tools (scoped to the `--servers` set).
- Mismatch detection is **scoped to the `--servers` set for the run**. A user running `configure --servers content` with a stale `tiddly_prompts` URL is not affected — `tiddly_prompts` is out of scope.
- `tiddly mcp configure --dry-run` **previews** what would happen. If a canonical URL mismatch exists and `--force` is NOT set, dry-run emits a per-entry stderr warning alongside the normal diff. With `--force`, dry-run suppresses the warning — the diff is the full answer. Dry-run does not abort on mismatches. Real runs still fail closed without `--force`.
- `tiddly mcp configure --force` overrides the canonical-URL-mismatch refusal only. It does NOT override any other safety check. `--force` applies to every tool in a multi-tool run. No short form (`-f` deliberately not registered).
- `tiddly mcp remove` becomes **canonical-name-only, URL-agnostic** by default. Non-canonical entries survive. A user who repurposed a canonical key will see it removed; `.bak.<timestamp>` is the recovery net.
- `tiddly mcp remove` reports accurately: if no canonical entries exist, prints `No CLI-managed entries found in <tool>` rather than a false "Removed..." message.
- `tiddly mcp remove --delete-tokens` revokes PATs for canonical entries only. Non-canonical PATs untouched.
- When `--delete-tokens` is used and a canonical PAT is **also referenced by another retained Tiddly-URL entry on disk**, the CLI warns before revoking — one consolidated line per canonical-entry-being-revoked, listing all retained entries that share the PAT.
- When `--delete-tokens` is used and a canonical PAT doesn't match any CLI-minted server-side token (name prefix `cli-mcp-`), the CLI prints a note referencing the specific entry.
- `mcp remove` without `--delete-tokens` surfaces an orphan-token warning filtered to exclude tokens whose prefix matches a PAT still referenced by a retained Tiddly-URL entry.
- `--delete-tokens` token-cleanup auth handling is unchanged from today: OAuth preferred with PAT fallback; silent skip on auth-resolution failure (acknowledged UX rough edge, tracked separately).
- The consolidation gate, Y/N prompt, `ErrConsolidation*` sentinels, and the `--yes` / `-y` flag are all removed entirely.
- After a successful configure, the summary tells the user which non-canonical Tiddly-URL entries were preserved (scoped to the server types managed by this run).

### Accepted limitation: repurposed canonical slots

A **repurposed canonical slot** is a config entry whose key name is canonical but whose URL is NOT a Tiddly URL — typically user hand-edited to a local dev fork.

The PAT-walk primitive (`AllTiddlyPATs`) is URL-based. It sees all Tiddly-URL entries (canonical or not); it does NOT see canonical-named entries that point elsewhere. The shared-PAT warning and orphan-subtraction filters inherit this limitation.

Consequence: if a user has a repurposed canonical slot AND shares its PAT with another canonical being revoked, `remove --delete-tokens` won't warn before revoking. The repurposed slot silently loses access. Similarly, the orphan-token warning may incorrectly flag a CLI-minted PAT pasted into a repurposed slot as "potentially orphaned."

Accepted pre-GA. The scenario requires manual hand-editing of a canonical slot to a non-Tiddly URL AND specific PAT-sharing patterns. Rare. If users report, a follow-up PR can add a URL-agnostic `CanonicalSlotPATs` method.

### What we keep from PR #117

- Timestamped backup writes with O_EXCL collision handling.
- Commit-phase failure revokes already-minted tokens (`revokeMintedTokens`, `withRevokeError`, detached `cleanupCtx`).
- Dry-run Bearer token redaction (`redactBearers`, `bearerRE`).
- `Configure` handler signature returns `backupPath`. `Remove` handler signature is changing.
- Partial-result contract (`ConfigureResult`).
- `classifyServer` extraction and secondary-sort tiebreaker. `OtherServer` gains a `URL` field so preflight can name the offending URL.
- `--help` text enumeration of three supported tools.
- `AllTiddlyPATs` handler method — stays URL-based.
- Validate-then-mint fallback (applies to canonical entry only).
- **Preflight `handler.Status` call** (repurposed). New role: (1) parse probe / fail-closed, (2) URL-mismatch detection scoped to `--servers` and aggregated across tools, (3) preserved-entries derivation.

### What we delete from PR #117

- `cli/internal/mcp/consolidation.go` (entire file).
- `cli/internal/mcp/consolidation_test.go` (entire file).
- `cli/internal/mcp/prompt.go` and `prompt_test.go`.
- `ErrConsolidationDeclined`, `ErrConsolidationNeedsConfirmation` in `configure.go`.
- `ConfigureOpts.AssumeYes`, `ConfigureOpts.Stdin`, `ConfigureOpts.IsInteractive`.
- `preflightedTool.consolidations`, `anyConsolidations`, `confirmConsolidations`, `detectConsolidations` call sites.
- The "Consolidation required:" header emission.
- `translateConfigureError` in `cmd/mcp.go`.
- `--yes` / `-y` flag registration and `assumeYes` variable.
- `PATExtraction.ContentName` and `PATExtraction.PromptName` fields.
- `tiddlyURLMatcher` in `configure.go` + its four `TestTiddlyURLMatcher__*` tests.
- Consolidation-focused tests in `configure_test.go` (see M1 testing strategy).
- Phase 4 of `cli/agent_testing_procedure.md` (T4.1/2/4/8/8b/9/9b/10/11), plus `--yes`/consolidation references in Phase 1/3.

---

## Open questions resolved

1. **`--delete-tokens` semantics** — Canonical-only by default. When a canonical PAT is also used by another retained Tiddly-URL entry, the CLI warns before revoking. When a canonical PAT doesn't match any `cli-mcp-*` server-side token, the CLI prints an informational note.
2. **Status rendering** — Unchanged. `OtherServer.URL` addition is backward-compatible.
3. **Dry-run output** — No "Consolidation required:" header. Dry-run previews the diff; with URL mismatch + no `--force`, emits per-entry stderr warnings. With `--force`, suppresses the warnings (the diff is the answer). Dry-run does NOT abort on mismatches. Real runs fail closed without `--force`. Mismatch detection scoped to `--servers`.
4. **Deprecation / migration path** — None. CLI is pre-GA; `--yes` users get Cobra's "unknown flag" error.
5. **Obsolete tests** — Delete rather than rework. Listed explicitly.
6. **`survivorsOfAllTiddlyPATs` helper** — Renamed to `canonicalEntryPATs`. Only walks canonical entries. `PATExtraction` collapses to `{ContentPAT, PromptPAT}`.
7. **Canonical key at the wrong URL** — Fail closed with actionable error, overridable via `--force`. Two detection paths (non-Tiddly URL via `OtherServers`; wrong-type Tiddly URL via `Servers` with `MatchByName` + mismatched `ServerType`). Both route through the same preflight error and `--force` escape. Scoped to `opts.Servers`. Multi-tool runs aggregate mismatches.
8. **Fail-closed on malformed config** — Preserved via preflight `handler.Status(rc)` call.
9. **Remove semantics for canonical entries with non-Tiddly URLs** — Delete them. URL-agnostic predicate. `.bak.<timestamp>` provides recovery. No `--force` on remove.
10. **`--force` short form** — None.
11. **Preserved-entries scoping under `--servers`** — Scoped to the server types managed by this run. **Out-of-scope canonical-slot mismatches are silent**; considered a passing advisory note but rejected as scope expansion (user can run configure without `--servers` to surface it). This decision is not re-litigated in future reviews absent new evidence.
12. **Canonical-slot PATs at non-Tiddly URLs** — Not handled. `AllTiddlyPATs` is URL-based; repurposed-slot case is an accepted limitation (see above).

---

## Architectural decision: refactor in place, don't revert

We keep commit `3d7a1b1` and surgically remove the consolidation layer. The KEEP set touches every file; revert-and-cherry-pick reapplies ~70% by hand.

---

## Reference reading for the agent

- `cli/internal/mcp/configure.go` — `RunConfigure`, `preflightedTool`, `confirmConsolidations`, `resolveToolPATs`, `resolveServerPAT`, preflight `handler.Status` call, `DeleteTokensByPrefix` (around line 564), `CheckOrphanedTokens` (around line 625).
- `cli/internal/mcp/consolidation.go` — entire file (being deleted).
- `cli/internal/mcp/prompt.go` — entire file (being deleted).
- `cli/internal/mcp/handler.go` — `TiddlyPAT`, `PATExtraction`, `ToolHandler` interface, `survivorsOfAllTiddlyPATs`, `AllTiddlyPATs`. `Remove` method's return type is changing to `*RemoveResult`.
- `cli/internal/mcp/status.go` — `classifyServer`, `StatusResult`, `MatchByName` / `MatchByURL`, `OtherServer` (gains a URL field).
- `cli/internal/mcp/claude_code.go`, `claude_desktop.go`, `codex.go` — `extractAll*TiddlyPATs`, `extract*PATs` pairs, per-handler `remove*` and `build*Config` functions.
- `cli/cmd/mcp.go` — `newMCPConfigureCmd`, `newMCPRemoveCmd`, `translateConfigureError`, `--yes` flag wiring, `Long:` strings at lines 62-85 and 301-319, PAT-collection block around line 372, orphan-token warning around line 440.
- `cli/internal/mcp/classify_test.go` — current tests assert only `Name` and `Transport` on `OtherServer`. Need to add `URL` assertion.
- `cli/agent_testing_procedure.md` — Phase 4, Phase 1-3, references at lines 3, 954-955, 1015, 1017. **T8.4/T8.5 at lines 2228-2238** preserve intact.
- `frontend/src/pages/docs/DocsCLIMCP.tsx` — "Server Identification" block at lines 124-141.
- `docs/ai-integration.md` — line 108 `--scope local` reference is a cross-reference to Claude Code's own flag; preserve.
- `frontend/src/components/AISetupWidget.tsx` — `getAffectedFiles` around line 431 (already edited).

---

## Agent behavior (global)

- Single PR with one commit per milestone.
- Complete each milestone fully before moving to the next. Stop for human review at each milestone boundary before committing.
- `make cli-verify` must pass at every milestone boundary.
- **Before committing each milestone**, grep the `cli/` tree for call-sites of changed signatures (especially `PATExtraction.ContentName`, `PATExtraction.PromptName`, and the old `Remove(ResolvedConfig, []string) (string, error)` signature). Update every site found, even those not in the explicit test list in this plan.
- Ask for clarification when ambiguous. Do not assume.
- Remove legacy code rather than leaving dead paths.
- Prefer deleting obsolete tests outright over reworking into something weaker.
- Line numbers are anchors that may have drifted; locate code by surrounding function names.

---

## Milestones

### Milestone 1 — Additive `configure` (consolidation removed; `--force` added; preflight URL-mismatch detection)

**Goal & outcome:**
`tiddly mcp configure` writes only canonical entries; non-canonical Tiddly-URL entries untouched. Consolidation module, prompt helper, and gate removed. Preflight `handler.Status` preserved with three roles. `--force` overrides URL-mismatch refusal. Dry-run previews + warns (suppresses warnings under `--force`). Validate-then-mint preserved. Summary lists preserved non-canonical entries scoped to `--servers`.

- `configure` with pre-existing `work_prompts` + `personal_prompts` → entries survive; canonical entries added/updated; summary lists them.
- `configure --servers content` with non-canonical `work_content` + `work_prompts` → canonical content written, canonical prompts untouched, summary lists only `work_content`.
- `configure --servers content` when canonical `tiddly_prompts` has a URL mismatch → **does NOT fail**; configure succeeds for content; prompts canonical entry untouched.
- `configure --servers content` when canonical `tiddly_notes_bookmarks` has a URL mismatch → fails with aggregated error.
- `configure` re-run when canonical present at correct Tiddly URL → updated in place; non-canonical untouched.
- `configure` when canonical `tiddly_prompts` has non-Tiddly URL (in scope) → non-zero exit with unified error. No mint.
- `configure` when canonical `tiddly_prompts` at content Tiddly URL (cross-wired, in scope) → same fail-closed behavior.
- `configure` against two auto-detected tools, each with in-scope mismatches → single aggregated error listing both. No mints.
- `configure --force` with any in-scope mismatch type → proceeds; prints `Forcing overwrite of <key> (currently <url>)` to stderr (non-dry-run only); writes the CLI-managed entry.
- `configure --dry-run` with an in-scope mismatch → shows the diff AND emits per-entry stderr warnings (`Warning: ... — real run will require --force`). Exit code 0.
- `configure --dry-run --force` → shows the diff with the overwrite applied; warnings **suppressed** (the diff is the full answer).
- Malformed config → fail closed in preflight before any mint.
- `--yes` deleted; returns Cobra's "unknown flag" error.
- `make cli-verify` passes at milestone boundary.

**Error format (unified for both sub-cases):**

Single-tool (N mismatches on one tool):
```
Error: <N> CLI-managed entr<y|ies> in <path> <has|have> an unexpected URL:
  - <name> → <url>
  ...

Options:
  - Preserve <it|them>: edit the file to rename the entr<y|ies>, then re-run.
  - Replace <it|them>:  re-run with --force.
```

Multi-tool (mismatches in 2+ tools):
```
Error: unexpected URLs on CLI-managed entries in <N> tools:

<tool-name-1> (<config-path-1>):
  - <name> → <url>

<tool-name-2> (<config-path-2>):
  - <name> → <url>

Options:
  - Preserve them: edit each file to rename the mismatched entries, then re-run.
  - Replace them:  re-run with --force (applies to all tools in this run).
```

**Format-selection rules:**
- `len(toolMismatches) == 1` → single-tool format.
- `len(toolMismatches) >= 2` → multi-tool format.
- Within single-tool: pluralize based on entry count (`N == 1` → "1 … entry … has"; `N > 1` → "N … entries … have"); preserve/replace verb matches ("it"/"them").
- The word "canonical" does NOT appear in error output (user-facing copy uses "CLI-managed entry" or names the keys directly).

**Sample outputs:**

Normal multi-account configure:
```
$ tiddly mcp configure claude-code
Created tokens: cli-mcp-claude-code-content-abc123, cli-mcp-claude-code-prompts-def456
Configured: claude-code
Backed up claude-code config to /Users/alice/.claude.json.bak.2026-04-20T14-33-02Z
Preserved non-CLI-managed entries in claude-code: work_prompts, personal_prompts
```

Single-tool, one mismatch:
```
$ tiddly mcp configure claude-code
Error: 1 CLI-managed entry in /Users/alice/.claude.json has an unexpected URL:
  - tiddly_prompts → https://example.com/my-prompts

Options:
  - Preserve it: edit the file to rename the entry, then re-run.
  - Replace it:  re-run with --force.
```

Single-tool, two mismatches:
```
$ tiddly mcp configure claude-code
Error: 2 CLI-managed entries in /Users/alice/.claude.json have an unexpected URL:
  - tiddly_notes_bookmarks → http://localhost:8001/mcp
  - tiddly_prompts → https://example.com/my-prompts

Options:
  - Preserve them: edit the file to rename the entries, then re-run.
  - Replace them:  re-run with --force.
```

Multi-tool aggregated:
```
$ tiddly mcp configure
Error: unexpected URLs on CLI-managed entries in 2 tools:

claude-code (/Users/alice/.claude.json):
  - tiddly_prompts → https://example.com/my-prompts

codex (/Users/alice/.codex/config.toml):
  - tiddly_notes_bookmarks → http://localhost:8001/mcp

Options:
  - Preserve them: edit each file to rename the mismatched entries, then re-run.
  - Replace them:  re-run with --force (applies to all tools in this run).
```

Dry-run with in-scope mismatch (no `--force`):
```
$ tiddly mcp configure claude-code --dry-run
Warning: tiddly_prompts at https://example.com/my-prompts — real run will require --force

--- claude-code ---
File: /Users/alice/.claude.json
Before:
  ...
After:
  ...
```

Dry-run with `--force` (warnings suppressed):
```
$ tiddly mcp configure claude-code --dry-run --force

--- claude-code ---
File: /Users/alice/.claude.json
Before:
  ... (shows tiddly_prompts at https://example.com/my-prompts)
After:
  ... (shows tiddly_prompts at the Tiddly prompts URL with the dry-run placeholder token)
```

**Implementation outline:**

1. **Delete files:** `cli/internal/mcp/consolidation.go`, `consolidation_test.go`, `prompt.go`, `prompt_test.go`.

2. **`status.go`**: add `URL string` field to `OtherServer`. Update `classifyServer`'s default branch to `&OtherServer{Name: name, URL: urlStr, Transport: transport}`. Handlers already route through `classifyServer`; no per-handler changes needed. Backward-compatible — existing rendering doesn't print the URL.

3. **`configure.go`**:
   - Delete `ErrConsolidationDeclined`, `ErrConsolidationNeedsConfirmation`.
   - Remove `ConfigureOpts.AssumeYes`, `.Stdin`, `.IsInteractive`. Add `ConfigureOpts.Force bool`.
   - Remove `preflightedTool.consolidations`. Add two new named types:

     ```go
     // canonicalMismatch describes a CLI-managed-named key whose current URL
     // doesn't match the expected Tiddly URL for its type (covers BOTH the
     // non-Tiddly URL sub-case and the wrong-type Tiddly URL sub-case).
     type canonicalMismatch struct {
         Name string // serverNameContent or serverNamePrompts
         URL  string // current on-disk URL
     }

     type toolMismatches struct {
         ToolName   string
         ConfigPath string
         Entries    []canonicalMismatch
     }
     ```

   - Add `preflightedTool.preservedNames []string` and `preflightedTool.forceOverwrites []canonicalMismatch`.
   - Remove `anyConsolidations`, `confirmConsolidations` functions and Phase 2 gate call site.
   - Add helper:

     ```go
     // expectedServerTypeForName maps a CLI-managed key name to its expected
     // server type. Used by preflight mismatch detection at both sub-case
     // sites (Servers wrong-type check and OtherServers inferred-type check).
     // Returns (type, true) for known canonical names, ("", false) otherwise.
     func expectedServerTypeForName(name string) (string, bool) {
         switch name {
         case serverNameContent:
             return ServerContent, true
         case serverNamePrompts:
             return ServerPrompts, true
         default:
             return "", false
         }
     }
     ```

   - **Keep the preflight `handler.Status(rc)` call**. Three roles:
     1. **Parse probe / fail-closed.** Existing dry-run-tolerant vs. real-run fail-closed branching stays.
     2. **URL-mismatch detection — scoped and aggregated.** After successful Status, build `[]canonicalMismatch` for the tool from two sources, both filtered by `opts.wantServer(<expected type from name>)`:
        - `sr.OtherServers` entries where `expectedServerTypeForName(Name)` returns a known type.
        - `sr.Servers` entries where `MatchMethod == MatchByName` AND `ServerType` doesn't match `expectedServerTypeForName(Name)`.
        
        Append each tool's mismatches to run-level `[]toolMismatches`. After the preflight loop:
        
        **Control flow (Force-first, then DryRun):**
        ```
        if len(run-level mismatches) == 0:
            proceed
        else if opts.Force:
            for each tool, copy mismatches into preflightedTool.forceOverwrites
            (commit loop logs the "Forcing overwrite of ..." lines only when !opts.DryRun)
            proceed
        else if opts.DryRun:
            emit per-entry stderr warnings (format: "Warning: <name> at <url> — real run will require --force")
            proceed to the commit loop so the diff is still produced
        else:
            return the aggregated error (before resolveToolPATs for ANY tool)
        ```

        Hard errors (path resolution, parse, Status read) still fail-early per their existing semantics — they're a different class than content mismatches. When a hard error is encountered on tool N, any mismatches accumulated from tools 0..N-1 are discarded; users fixing the hard error and re-running will then see mismatches from all tools.
     3. **Preserved-entries derivation.** Filter `sr.Servers` to entries where `MatchMethod == MatchByURL` AND `ServerType` is in `opts.Servers`. Stash sorted names on `preflightedTool.preservedNames`.
   - In the commit loop, delete consolidation-warning branches and "Consolidation required:" emission.
   - After successful `handler.Configure`, copy `pf.preservedNames` into `result.PreservedEntries[pf.tool.Name]`.
   - **Force-overwrite stderr log**: non-dry-run runs with `opts.Force == true` and non-empty `pf.forceOverwrites` emit one line per overwritten entry to `opts.ErrOutput` BEFORE `handler.Configure`: `Forcing overwrite of <key> (currently <url>)`. Dry-run does NOT emit this.
   - **Delete `tiddlyURLMatcher`** and its four `TestTiddlyURLMatcher__*` tests.
   - **Change `DeleteTokensByPrefix` signature**:

     ```go
     type TokenRevokeRequest struct {
         EntryLabel string // free-form caller label (typically canonical entry name)
         PAT        string
     }

     type TokenRevokeResult struct {
         EntryLabel   string   // mirrors input
         DeletedNames []string // cli-mcp-* tokens revoked (empty if nothing matched)
         Err          error
     }

     // DeleteTokensByPrefix revokes server-side tokens matching any request
     // PAT and the cli-mcp- name prefix. Returns one result per input
     // request in input order, preserving labels. Top-level error covers
     // only list-tokens failure; per-request errors are surfaced inside
     // results.
     //
     // Requests sharing a PAT are deduped internally: one server-side
     // deletion pass per unique PAT. The resulting DeletedNames and Err
     // are mirrored into every result whose PAT matches. Callers never see
     // duplicate deletions or false "nothing matched" for shared PATs.
     //
     // For PATs shorter than tokenPrefixLen, DeletedNames is empty and Err
     // is nil — treated as "nothing matched" so the caller can emit a
     // per-entry note consistently.
     func DeleteTokensByPrefix(ctx context.Context, client *api.Client, reqs []TokenRevokeRequest) ([]TokenRevokeResult, error)
     ```

   - **Change `CheckOrphanedTokens` return type** to `[]api.TokenInfo` (or minimal `{Name, TokenPrefix}` struct).
   - Keep: `resolveToolPATs`, `resolveServerPAT`, `mintedToken`, `toolPATResolution`, `withRevokeError`, `revokeMintedTokens`, `cleanupTimeout`, `redactBearers`, `printDiff`, `BackupRecord`.
   - Add `ConfigureResult.PreservedEntries map[string][]string` keyed by tool name.

4. **`handler.go`**:
   - Collapse `PATExtraction` to `{ContentPAT, PromptPAT}` — delete Name fields.
   - Rename `survivorsOfAllTiddlyPATs` → `canonicalEntryPATs`. Only match canonical-named entries.
   - `AllTiddlyPATs` stays URL-based. Doc comment:

     ```go
     // AllTiddlyPATs returns every extractable Bearer token in the tool's
     // config from entries whose URL classifies as a Tiddly URL, in
     // canonical-first order. Used by `remove --delete-tokens`: the
     // canonical subset supplies revoke targets; the full output feeds
     // the retained-PAT set used for shared-PAT warnings and
     // orphan-subtraction.
     //
     // Known limitation: a canonical-named entry whose URL is NOT a Tiddly
     // URL (a repurposed slot) is not returned by this method. Such entries
     // do not participate in shared-PAT warnings or orphan-subtraction.
     // Accepted pre-GA limitation; see plan document for context.
     AllTiddlyPATs(rc ResolvedConfig) []TiddlyPAT
     ```

   - **Change `Remove` return type** to `(*RemoveResult, error)`:

     ```go
     // RemoveResult describes the outcome of a remove operation.
     // RemovedEntries lists canonical key names actually deleted from the
     // config file. Empty slice if nothing matched (file had only
     // non-canonical entries, or no matching canonical for the --servers
     // scope). BackupPath is the timestamped backup file created before
     // the write, empty if no prior file existed.
     //
     // On write failure AFTER the backup was taken, the handler returns
     // (&RemoveResult{RemovedEntries: nil, BackupPath: path}, err) — NEVER
     // (nil, err) — so the cmd layer can surface the recovery artifact.
     type RemoveResult struct {
         RemovedEntries []string
         BackupPath     string
     }

     Remove(rc ResolvedConfig, servers []string) (*RemoveResult, error)
     ```

5. **Per-handler files (`claude_code.go`, `claude_desktop.go`, `codex.go`)**:
   - `extractAll*TiddlyPATs` stays URL-based.
   - `extract*PATs` survivor variants derive from `canonicalEntryPATs`.
   - **Delete the URL-based removal call inside each build path:**
     - `claude_code.go` around line 190 — remove `removeJSONServersByTiddlyURL(servers, tiddlyURLMatcher(...))`.
     - `claude_desktop.go` around line 60 — same call.
     - `codex.go` around line 89 — remove `removeCodexServersByTiddlyURL(...)`.
     
     The removal helpers `removeJSONServersByTiddlyURL` and `removeCodexServersByTiddlyURL` STAY — they're still used by the Remove path through M1. They'll be deleted in M2 after the Remove predicate switches to canonical-name-only.
   - **Do NOT add canonical-URL validation in `build*Config`.** The check lives in preflight.
   - `Remove` per-handler changes deferred to M2 (where signature change lands with behavior change).

6. **`cmd/mcp.go`**:
   - Delete `cmd.Flags().BoolVarP(&assumeYes, "yes", "y", ...)`, the `assumeYes` variable, and the `AssumeYes: assumeYes` field.
   - Add `--force`: `cmd.Flags().BoolVar(&force, "force", false, "Overwrite CLI-managed entries that point at non-Tiddly URLs or wrong-type Tiddly URLs")`. Long-form only.
   - Plumb to `ConfigureOpts.Force`.
   - Update configure `Long:` string to document `--force`.
   - **Extend `printConfigureSummary`**: emit one line per tool with preserved entries: `Preserved non-CLI-managed entries in <tool>: <sorted-comma-joined-names>`. Inherits the existing dry-run gate (summary is not rendered in dry-run). **Note:** the preserved-entries line therefore does not appear in dry-run output; the diff already reflects the additive contract (non-canonical entries don't appear as changed lines). If this is confusing in practice, a follow-up can relax it.

**Testing strategy (`configure_test.go`):**

- **Delete:**
  - `TestRunConfigure__consolidation_prompt_proceeds_on_yes` (~1174), `_aborts_on_no` (~1208), `_consolidation_non_interactive_errors_without_yes` (~1238), `_declining_before_writes_creates_no_server_tokens` (~1266), `_non_interactive_decline_creates_no_server_tokens` (~1303), `_consolidation_assume_yes_bypasses_prompt` (~1885).
  - `TestRunConfigure__dry_run_warns_about_multi_entry_consolidation` (~1013), `_dry_run_no_warning_when_single_entries` (~1072), `_dry_run_servers_flag_scopes_warning` (~1104), `_no_prompt_when_single_entries` (~1918).
  - `TestRunConfigure__single_gate_across_multiple_tools`, `_oauth_multi_entry_proceed_reuses_surviving_pat` (if present).
  - `TestTiddlyURLMatcher__both_pats`, `_content_only`, `_prompts_only`, `_neither_pat_matches_nothing`.
  - All `TestWriteConsolidationWarning__*`.
  - Per-handler tests asserting `Configure` deletes non-canonical Tiddly-URL entries.
- **Keep:**
  - `TestPrintDiff__redacts_bearer_across_all_three_formats`, `TestRunConfigure__commit_phase_failure_preserves_earlier_writes`, `_oauth_commit_failure_revokes_minted_tokens`, `_oauth_commit_failure_with_revoke_failure_surfaces_orphans`, `_commit_phase_failure_surfaces_backup_path`, `_preflight_failure_returns_nil_result`, `_status_error_aborts_non_dry_run`, `_malformed_config_returns_parse_error` (if present), `TestRevokeMintedTokens__*`.
- **Add (core behavior):**
  - `TestRunConfigure__additive_preserves_non_canonical_tiddly_entries` (per handler).
  - `TestRunConfigure__reuses_canonical_pat_when_valid`
  - `TestRunConfigure__mints_fresh_when_canonical_pat_invalid`
  - `TestRunConfigure__does_not_reuse_pat_from_non_canonical_entry`
  - `TestRunConfigure__dry_run_shows_only_canonical_diff`
  - `TestRunConfigure__servers_content_leaves_canonical_prompts_structurally_preserved`
  - `TestRunConfigure__refuses_to_overwrite_canonical_key_with_non_tiddly_url`: assert error, `Client.CreateToken` NOT called, no write.
  - `TestRunConfigure__refuses_when_canonical_name_has_wrong_type_tiddly_url`: same error template as non-Tiddly case.
  - `TestRunConfigure__does_not_refuse_on_out_of_scope_mismatch`: `tiddly_prompts` bad, `--servers content`. Configure succeeds.
  - `TestRunConfigure__servers_scope_refuses_only_on_in_scope_mismatch_when_both_mismatched`: BOTH canonicals have URL mismatches; `--servers content` → error mentions content but NOT prompts; prompts still mismatched after run.
  - `TestRunConfigure__error_format_single_tool_one_mismatch`: assert "1 CLI-managed entry ... has an unexpected URL"; "Preserve it"; "Replace it".
  - `TestRunConfigure__error_format_single_tool_multiple_mismatches`: two mismatches → "2 CLI-managed entries ... have an unexpected URL"; "Preserve them"; "Replace them".
  - `TestRunConfigure__error_format_does_not_use_canonical_word`: assert error output does NOT contain "canonical".
  - `TestRunConfigure__dry_run_warns_on_mismatch_but_shows_diff`: dry-run + in-scope mismatch. Stderr has warning; stdout has diff; exit success.
  - `TestRunConfigure__force_with_dry_run_shows_overwrite_in_diff_without_warning_line`: dry-run + force. Stderr does NOT have the warning; diff shows the overwrite. Verifies Force-before-DryRun branch order.
  - `TestRunConfigure__aggregates_mismatches_across_multiple_tools`: two tools each with in-scope mismatch. Single aggregated error.
  - `TestRunConfigure__hard_error_on_second_tool_discards_first_tool_mismatch`: tool A has in-scope mismatch (accumulated), tool B hits Status parse error. Hard error surfaces alone; tool A's mismatch discarded from output.
  - `TestRunConfigure__hard_error_on_first_tool_short_circuits_second_tool_scan`: tool A has parse error, tool B has in-scope mismatch. Parse error surfaces; tool B never scanned.
  - `TestRunConfigure__force_overwrites_canonical_with_non_tiddly_url` (per handler).
  - `TestRunConfigure__force_overwrites_cross_wired_canonical`
  - `TestRunConfigure__force_is_no_op_when_no_canonical_url_mismatch`
  - `TestRunConfigure__reports_preserved_non_canonical_entries`
  - `TestRunConfigure__preserved_entries_scoped_to_requested_servers`
  - `TestRunConfigure__preserves_non_canonical_entry_with_malformed_authorization`
  - `TestPrintConfigureSummary__emits_preserved_entries_line`: direct printer-level test asserting `printConfigureSummary` writes the expected line when `PreservedEntries` has data.
- **Per-handler tests**: remove "Configure deletes non-canonical" tests; add structural-preservation tests; update `ExtractPATs` tests for Name-field removal; reaffirm `AllTiddlyPATs` URL-based semantics.
- **`classify_test.go`**: update existing cases to assert `OtherServer.URL == tc.url` for non-Tiddly entries. Add one case covering a CLI-managed key name routed into `OtherServers` (verifying URL is preserved end-to-end).

**Docs:** None in this milestone.

---

### Milestone 2 — Canonical-name-only `mcp remove` (+ structured `--delete-tokens` reporting; `Remove` signature change)

**Goal & outcome:**
`tiddly mcp remove` deletes canonical-named entries regardless of URL. Non-canonical entries survive. `Remove` returns `*RemoveResult`. `--delete-tokens` revokes only canonical PATs, warns before revoking a PAT also referenced by a retained Tiddly-URL entry, emits per-entry note when a canonical PAT doesn't match any CLI-minted token. Orphan-token warning filters by retained PATs. URL-based removal helpers deleted as dead code after predicate switch.

- `tiddly mcp remove claude-code` with canonical + non-canonical → canonical removed, non-canonical preserved; output lists removed names.
- `tiddly mcp remove claude-code` when config has only non-canonical → `No CLI-managed entries found in claude-code.` Non-canonical untouched.
- `tiddly mcp remove claude-code` when canonical `tiddly_prompts` at non-Tiddly URL → canonical deleted; `.bak.<timestamp>` preserves it.
- `tiddly mcp remove claude-code --delete-tokens` → revokes canonical PATs only.
- `--delete-tokens` when canonical `tiddly_prompts` PAT equals non-canonical `work_prompts` PAT → consolidated warning fires.
- `--delete-tokens` when canonical PAT doesn't match any `cli-mcp-*` token → per-entry note: `Note: no CLI-created token matched the token attached to tiddly_prompts; nothing was revoked. Manage tokens at https://tiddly.me/settings.`
- `--delete-tokens` with two canonical entries sharing a PAT → internal dedup; ONE server-side deletion; both results get same `DeletedNames`; neither gets false "nothing matched" note.
- Write failure with backup taken → output includes `Backed up previous config to <path>` before the error.
- Orphan-token warning (no `--delete-tokens`) excludes tokens referenced by retained Tiddly-URL entries.

**Implementation outline:**

1. **Per-handler `Remove` method**: change predicate from "any entry matching a Tiddly URL" to **"entry whose key name is canonical"** — URL-agnostic. Drop belt-and-suspenders URL check. For `--servers content` / `--servers prompts`, filter by canonical name for requested type.
   
   Return type changes to `(*RemoveResult, error)`:
   - On success: `RemovedEntries` is the slice of actual canonical key names deleted (empty if none matched); `BackupPath` is the backup path (empty if no prior file existed).
   - On write failure after backup: return `&RemoveResult{RemovedEntries: nil, BackupPath: path}` alongside the error — NEVER `(nil, err)`.
   - On "nothing to delete": return valid `*RemoveResult` with empty `RemovedEntries` and empty `BackupPath`, nil error.
   
   **Delete as dead code** after the predicate switch:
   - `removeJSONServersByTiddlyURL` in `status.go` (or wherever it currently lives).
   - `removeCodexServersByTiddlyURL` in `codex.go`.
   - `serverURLMatcher` in `status.go` (around line 159).
   
   Confirm via grep that no callers remain in the `cli/` tree.

2. **`cmd/mcp.go` — `newMCPRemoveCmd` rewrite**:

   **Explicit decision tree (follow in order):**
   
   1. **Collect revoke targets and retained-PATs from pre-remove config** (via `handler.AllTiddlyPATs(rc)`) BEFORE calling `handler.Remove`. This ensures the shared-PAT warning and orphan-filter see the state as it was before the write.
      - Revoke targets: canonical entries, filtered to server types in `opts.Servers`. One `TokenRevokeRequest{EntryLabel: <canonical-name>, PAT: <pat>}` per canonical entry.
      - Retained PATs: everything in `AllTiddlyPATs(rc)` output MINUS the canonical entries about to be deleted (identified by name).
   2. **Call `result, err := handler.Remove(rc, serverList)`.**
   3. **Branch on the result:**
      - `err != nil`:
        - If `result != nil && result.BackupPath != ""`: print `Backed up previous config to <path>`.
        - Return err to the caller.
      - `err == nil && len(result.RemovedEntries) == 0`:
        - Print `No CLI-managed entries found in <tool>.`
        - Skip token cleanup (nothing was removed → nothing to clean up; orphan-warning has no predicate to check).
      - `err == nil && len(result.RemovedEntries) > 0`:
        - Print `Removed <comma-joined-names> from <tool>.`
        - If `result.BackupPath != ""`: print `Backed up previous config to <path>.`
        - Proceed to token cleanup using the pre-remove revoke targets and retained PATs.
   4. **Shared-PAT warning** (token cleanup path): for each revoke target, find retained entries whose PAT equals the target's PAT. If any match, emit one line per canonical-entry-being-revoked: `Warning: token from <canonical-name> is also used by <retained-name-1>, <retained-name-2>, ... (still configured); revoking will break those bindings.` Retained names comma-joined, sorted alphabetically.
   5. **Call `results, err := mcp.DeleteTokensByPrefix(ctx, client, reqs)`.**
   6. **Per-entry note**: for each result with empty `DeletedNames` AND nil `Err`: `Note: no CLI-created token matched the token attached to <EntryLabel>; nothing was revoked. Manage tokens at https://tiddly.me/settings.`
   7. **Successful deletions**: dedupe `DeletedNames` across results, print `Deleted tokens: <names>` line.
   8. **Per-entry errors**: non-nil `Err` results surface as per-entry warnings.
   
   **Auth semantics unchanged**: `ResolveToken(flagToken, preferOAuth=true)` still gates the token-cleanup block. Silent skip on auth failure preserved (acknowledged rough edge, tracked separately).
   
   The existing "Warning: token is shared with X server (still configured)" message is superseded by the consolidated shared-PAT warning.

3. **Orphan-token warning filtering** (no `--delete-tokens` path):
   - `CheckOrphanedTokens` returns `{Name, TokenPrefix}` pairs. Compute retained-PAT prefixes from pre-remove `AllTiddlyPATs(rc)` minus canonicals being deleted. Filter orphan candidates to exclude tokens whose `TokenPrefix` is in retained-prefix set. Emit warning only for filtered result.

4. **`CheckOrphanedTokens`**: signature change. Doc comment:

   ```go
   // NOTE: Returns server-side tokens matching the cli-mcp-{tool}-{serverType}-
   // name pattern. The caller must subtract tokens whose TokenPrefix matches
   // a PAT still referenced by a retained entry on disk before presenting
   // as "potentially orphaned" — otherwise tokens in active use by
   // non-canonical entries would be misreported.
   //
   // Known limitation: does not see repurposed canonical slots (canonical
   // names at non-Tiddly URLs). A CLI-minted PAT pasted into such an entry
   // may be reported as "potentially orphaned" even though it's still in
   // use. Accepted pre-GA; see plan document.
   ```

**Testing strategy (`cmd/mcp_test.go` and per-handler tests):**

- **Delete:** `TestTranslateConfigureError__*` (all four).
- **Modify:**
  - `TestMCPRemove__delete_tokens_multi_entry_revokes_all` → rename to `..._revokes_canonical_only`; update for new signatures.
  - All tests using old `DeleteTokensByPrefix([]string)` signature → update to `[]TokenRevokeRequest`.
  - All tests asserting old `Remove` return → update for `*RemoveResult`.
- **Keep:**
  - `TestMCPRemove__delete_tokens_dedups_shared_pat` (update to structured form).
  - `TestMCPConfigure__dry_run_surfaces_pat_auth_warning`.
- **Add:**
  - `TestMCPRemove__preserves_non_canonical_entries` (per handler).
  - `TestMCPRemove__deletes_canonical_entry_with_non_tiddly_url` (per handler).
  - `TestMCPRemove__reports_nothing_removed_when_no_canonical_entries_present`: `RemovedEntries` empty; output `No CLI-managed entries found…`; token-cleanup skipped.
  - `TestMCPRemove__write_failure_prints_backup_path`: force write failure after backup taken. Assert output contains `Backed up previous config to <path>`; err propagated; `result` is non-nil with `BackupPath` populated and `RemovedEntries` nil.
  - `TestMCPRemove__pat_collection_uses_pre_remove_state`: canonical entries with distinct PATs. Assert revoke targets include ALL canonical PATs (not just those surviving the remove); shared-PAT warning correctly sees pre-remove state.
  - `TestMCPRemove__delete_tokens_ignores_non_canonical_pats`.
  - `TestMCPRemove__shared_pat_warning_fires_on_canonical_split`.
  - `TestMCPRemove__shared_pat_warning_fires_when_non_canonical_retains_pat`.
  - `TestMCPRemove__shared_pat_warning_consolidates_multiple_retained_entries`.
  - `TestMCPRemove__no_warning_when_no_retained_pat_shares`.
  - `TestMCPRemove__servers_prompts_only_warns_when_retained_content_shares_pat`.
  - `TestMCPRemove__non_cli_token_note_fires_per_unmatched_entry`.
  - `TestMCPRemove__non_cli_token_note_fires_once_per_entry`.
  - `TestMCPRemove__non_cli_token_note_fires_for_short_or_garbled_pat`.
  - `TestMCPRemove__non_cli_token_note_does_not_fire_for_cli_tokens`.
  - `TestMCPRemove__shared_pat_revoke_dedups_at_helper_level`.
  - `TestMCPRemove__orphan_warning_excludes_tokens_used_by_non_canonical_entries`.
  - `TestMCPRemove__orphan_warning_fires_for_unreferenced_cli_tokens`.
- **Helper-level tests** (in `configure_test.go` or a dedicated file):
  - `TestDeleteTokensByPrefix__shared_pat_fans_out_single_deletion`: two requests, same PAT, one matching server-side token. One `DeleteToken` call; both results have same `DeletedNames`.
  - `TestDeleteTokensByPrefix__preserves_order_and_labels_with_mixed_shared_and_unique_pats`: three requests `[{A, pat1}, {B, pat2}, {C, pat1}]`. Results come back as `[A, B, C]` in order; A and C share `DeletedNames`; B has independent result.
  - `TestDeleteTokensByPrefix__short_pat_returns_empty_not_error`: request with PAT shorter than `tokenPrefixLen`. Result has empty `DeletedNames`, nil `Err`.

**Docs:** None in this milestone.

---

### Milestone 3 — CLI help, docs, and E2E test plan cleanup

**Goal & outcome:**
User-visible surface reflects the additive semantics. No references to consolidation, `--yes`, or Y/N prompt in user-facing copy. `--force` documented. Tiddly-facing `--scope` vocabulary consistent. User-facing copy does NOT use "canonical".

**Implementation outline:**

1. **`cmd/mcp.go` — Long strings**:
   - `newMCPConfigureCmd` Long string rewrite (second paragraph):

     > Configure writes two CLI-managed entries: `tiddly_notes_bookmarks` (content server) and `tiddly_prompts` (prompt server). These are the only entries the CLI creates or modifies. If you have other entries pointing at Tiddly URLs under different names (for example, `work_prompts` and `personal_prompts` for multiple accounts), configure leaves them alone. After a run, configure lists any preserved non-CLI-managed entries so you can see what was left unchanged.
     >
     > If a CLI-managed entry already exists but points at a URL that's not the expected Tiddly URL for its type, configure refuses by default and tells you which entry is mismatched. Either rename the entry in the config file to preserve it, or re-run with `--force` to overwrite. Use `--dry-run` to preview either path without committing (without `--force`, dry-run shows the diff plus warnings; with `--force`, dry-run shows the diff with the overwrite applied).

   - Remove `translateConfigureError` and its call site; becomes `return err`. Remove `errors` import if unused.
   - `--yes` already deleted in M1.
   - `--force` registered in M1; confirm in `--help`.
   - `newMCPRemoveCmd` Long string rewrite:

     > Remove deletes the CLI-managed entries (`tiddly_notes_bookmarks`, `tiddly_prompts`) from the tool's config file. Other entries pointing at Tiddly URLs under different names are preserved. A CLI-managed entry is removed regardless of what URL it points at. The prior config is saved to `<path>.bak.<timestamp>` before the write. If no CLI-managed entries exist, remove reports so and exits cleanly.
     >
     > With `--delete-tokens`, the CLI only targets PATs attached to CLI-managed entries. If one of those PATs is also referenced by a preserved entry, the CLI warns that revoking will break the preserved binding and then proceeds. If a CLI-managed entry's PAT doesn't match any CLI-created server-side token, the CLI prints an informational note referencing that entry.

2. **`frontend/src/pages/docs/DocsCLIMCP.tsx`**:
   - Rewrite "Server Identification" section at lines 124-141.
   - Add `--force` to Flags table.
   - Add FAQ block: "I have multiple Tiddly entries — what happens on configure?"
   - Replace "canonical" in user-facing text with "CLI-managed" or the explicit key names.

3. **`frontend/src/components/AISetupWidget.tsx`**: `--scope local` → `--scope directory` already edited; keep.

4. **`cli/agent_testing_procedure.md`**:
   - Delete: Phase 4 and T4.1, T4.2, T4.4, T4.8, T4.8b, T4.9, T4.9b, T4.10, T4.11.
   - Edit line 3, lines 954-955, line 1015 (replace `--yes` with `--force`), line 1017.
   - Keep T4.6, T4.7 (reframe), T5.4.
   - Rewrite T6.8, T6.8b, T6.8c, T6.8d for canonical-only `--delete-tokens`. Add sub-tests: shared-PAT warning, non-CLI-token note, orphan-warning filter, shared-PAT helper dedup.
   - Do NOT modify T8.4/T8.5.
   - Add five E2E tests to Phase 3: additive preservation, canonical update-in-place, fail-closed on URL mismatch (both sub-cases, with multi-tool aggregation and pluralization), `--force` overwrite, canonical-only remove with `--delete-tokens` warnings.

5. **Project-level docs audit** per `AGENTS.md`:
   - Search for: "consolidate", "consolidation", "--yes", "work_prompts", "migrations from manual setups safe", and (with exceptions) "--scope local".
   - `--scope local` exceptions: `cli/agent_testing_procedure.md` T8.4/T8.5; `docs/ai-integration.md` line 108.

**Testing strategy:**

- After help-text edits, paste `tiddly mcp configure --help` and `tiddly mcp remove --help` into PR description.
- `make frontend-verify` must pass.

**Docs:** Everything in this milestone is a doc change.

---

## Definition of done (global)

- `make cli-verify` passes.
- `make frontend-verify` passes.
- Agent provides summary of deleted vs. kept vs. modified, cross-referenced against milestones.
- Agent pastes new `configure --help` and `remove --help` output in PR description.
- Agent confirms (grep) no unresolved references to `consolidation`, `ConsolidationGroup`, `ErrConsolidation*`, `promptYesNo`, `AssumeYes`, `detectConsolidations`, or `writeConsolidationWarning`.
- Agent confirms (grep) `--yes` / `assumeYes` not registered anywhere in `cli/cmd/` or `cli/internal/` source.
- Agent confirms (grep) "canonical" does NOT appear in: user-facing copy under `frontend/src/pages/docs/`, `cli/cmd/*.go` Long strings, or the stderr/stdout output emitted by configure and remove. Internal code comments may still use "canonical".
- Agent confirms (grep) that `PATExtraction.ContentName`, `PATExtraction.PromptName`, `tiddlyURLMatcher`, `removeJSONServersByTiddlyURL`, `removeCodexServersByTiddlyURL`, and `serverURLMatcher` have no remaining callers in the `cli/` tree.
- Agent confirms (grep) that no call sites of the old `Remove(ResolvedConfig, []string) (string, error)` signature remain — all updated to `(*RemoveResult, error)`.
- Non-canonical Tiddly-URL entries demonstrably preserved across configure and remove.
- Preserved-entries list scoped to `--servers` set.
- Mismatch detection scoped to `--servers`: mismatch on out-of-scope canonical slot does NOT block configure.
- Dry-run with mismatch (no `--force`) produces per-entry warnings AND the normal diff, no error.
- Dry-run with `--force` produces the diff, NO warning lines.
- Real run with mismatch and no `--force` fails closed with aggregated error; no token mint for any tool.
- Error output uses "CLI-managed entry/entries" wording, covers both sub-cases (non-Tiddly URL AND wrong-type Tiddly URL) through the same template, pluralizes correctly (1 vs. N entries per tool; 1 vs. N tools).
- Shared-PAT warning fires in the two supported cases (canonical-content vs canonical-prompts share; canonical vs non-canonical-at-Tiddly-URL share). Repurposed-slot case is an accepted limitation (documented).
- Shared-PAT warning consolidates multiple retained entries into one line per canonical revoke.
- `DeleteTokensByPrefix` deduplicates by PAT internally; tests cover shared-PAT-fans-out and mixed-shared-unique cases.
- Non-CLI-token note fires correctly (including for short/garbled PATs).
- Orphan-token warning excludes tokens referenced by retained Tiddly-URL entries.
- `--force` emits `Forcing overwrite of …` to stderr in non-dry-run mode only.
- `tiddly mcp remove` reports `No CLI-managed entries found in <tool>` when no canonical entries exist; token-cleanup path is skipped.
- `tiddly mcp remove` write-failure-after-backup returns `*RemoveResult` with populated `BackupPath`; cmd layer surfaces the backup line before propagating the error.
- `tiddly mcp remove` PAT collection uses the pre-remove config state (not a re-read of the post-remove file).
- `tiddly mcp remove` deletes canonical-named entries regardless of URL.
- `AllTiddlyPATs` returns only entries whose URL classifies as a Tiddly URL.
- `OtherServer.URL` is populated by `classifyServer` (asserted in `classify_test.go`) and consumed by preflight mismatch detection.
- `ToolHandler.Remove` returns `(*RemoveResult, error)`.
- `DeleteTokensByPrefix` returns one structured `TokenRevokeResult` per input request in input order, preserving labels.
- `CheckOrphanedTokens` returns token prefixes.

## Out of scope

- PAT lifecycle semantics beyond what's in `configure.go`.
- URL-based classification (`classifyServer`, `isTiddlyURL`) — correct as-is, just extended with `OtherServer.URL`.
- Skills — unrelated surface.
- Opt-in "revoke all Tiddly-URL PATs" flag for remove.
- `mcp status` multi-entry grouping.
- A guided CLI flow for removing user-custom non-canonical entries.
- Normalizing the handler-signature asymmetry between `buildClaudeDesktopConfig(configPath, ...)` and the other two.
- Codex deprecated skills path.
- Redesigning `--delete-tokens` error flow / silent-skip on auth-resolution failure.
- **Repurposed canonical slots** participating in shared-PAT warnings or orphan-subtraction.
- Preserved-entries rendering in dry-run output (inherits the existing dry-run gate on `printConfigureSummary`).
- Out-of-scope canonical-slot mismatch detection (user can run configure without `--servers` to surface it).
