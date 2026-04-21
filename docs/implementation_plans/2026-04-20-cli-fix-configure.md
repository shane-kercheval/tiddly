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

- `tiddly mcp configure` is **additive**: it writes or updates the two canonical entries only (`tiddly_notes_bookmarks`, `tiddly_prompts`, scoped by `--servers`). Non-canonical Tiddly-URL entries are left untouched — their keys, URLs, PATs, and headers are not modified.
- If a canonical entry already exists and points at the **correct Tiddly URL for its type**, it's updated in place — **validate-then-mint** semantics from the existing PR are preserved (validate the existing PAT via `/users/me`; reuse if valid, mint fresh if rejected).
- If a canonical entry exists but points at either a non-Tiddly URL OR the wrong-type Tiddly URL (e.g. `tiddly_prompts` pointing at the content server), configure **fails closed** with an actionable error listing the file path, key name, and current URL. The user can (a) hand-edit to rename the entry, preserving their custom setup, or (b) re-run with `--force` to overwrite with the CLI-managed entry. In a multi-tool run, preflight aggregates mismatches across all successfully-inspected tools (scoped to the `--servers` set) and presents a combined error — users fix all at once, not whack-a-mole.
- Mismatch detection is **scoped to the `--servers` set for the run**. A user running `configure --servers content` with a stale `tiddly_prompts` URL is not affected — `tiddly_prompts` is out of scope and won't be touched.
- `tiddly mcp configure --dry-run` **previews** what would happen. If a canonical URL mismatch exists, dry-run emits a per-entry stderr warning (`Warning: tiddly_prompts at https://example.com/... — real run will require --force`) alongside the normal diff output. Dry-run does not abort on mismatches — it commits nothing anyway; the preview plus warning is the correct UX. Real runs still fail closed without `--force`.
- `tiddly mcp configure --force` overrides the canonical-URL-mismatch refusal only. It does NOT override any other safety check (token revoke-on-failure still runs; non-canonical entries are still preserved). `--force` applies to every tool in a multi-tool run — a user who wants to force one tool but not another should invoke configure once per tool. There is no short form (`-f` deliberately not registered).
- `tiddly mcp remove` becomes **canonical-name-only, URL-agnostic** by default — deletes `tiddly_notes_bookmarks` / `tiddly_prompts` regardless of what URL they point at. Non-canonical entries (e.g. `work_prompts`) survive. A user who repurposed a canonical key for a non-Tiddly service will see it removed if they run `tiddly mcp remove`; `.bak.<timestamp>` recovery is the safety net.
- `tiddly mcp remove` reports accurately: if no canonical entries exist in the config, the CLI prints `No CLI-managed entries found in <tool>` rather than a false "Removed Tiddly MCP servers …" message. The handler returns a `RemoveResult` carrying the list of actually-removed entry names so the cmd layer can distinguish removed from no-op.
- `tiddly mcp remove --delete-tokens` only revokes PATs attached to canonical entries. A user's `work_prompts` PAT is not touched.
- When `--delete-tokens` is used and a canonical PAT is **also referenced by another retained Tiddly-URL entry on disk** (canonical at a Tiddly URL, or non-canonical at a Tiddly URL), the CLI warns before revoking — one consolidated line per canonical-entry-being-revoked, listing all retained entries that share the PAT. Revoking breaks those bindings.
- When `--delete-tokens` is used and the PAT on a canonical entry doesn't match any CLI-minted server-side token (name prefix `cli-mcp-`), the CLI prints a note referencing the specific canonical entry so an empty "Deleted tokens:" line isn't confusing.
- `mcp remove` without `--delete-tokens` surfaces an orphan-token warning based on server-side `cli-mcp-*` token names; this list is filtered to exclude tokens whose prefix matches a PAT still referenced by a retained Tiddly-URL entry on disk, so users don't see "potentially orphaned" warnings for tokens still in active use.
- `--delete-tokens` follows existing best-effort token-cleanup semantics, unchanged by this refactor: auth resolution prefers OAuth with PAT fallback; if resolution fails entirely the token-cleanup step is silently skipped (existing behavior, acknowledged UX rough edge); if resolution succeeds the cleanup is attempted regardless of auth type, with API errors surfaced as stderr warnings.
- The consolidation gate, Y/N prompt, `ErrConsolidation*` sentinels, and the `--yes` / `-y` flag are all removed entirely. No deprecation shim — pre-GA users with scripted `--yes` invocations will see Cobra's "unknown flag" error and should drop the flag from their scripts.
- After a successful configure, the summary tells the user which non-canonical Tiddly-URL entries were preserved, scoped to the server types managed by this run — so a multi-account user isn't left wondering whether the CLI noticed their other entries.

### Accepted limitation: repurposed canonical slots

A **repurposed canonical slot** is a config entry whose key name is canonical (`tiddly_notes_bookmarks` or `tiddly_prompts`) but whose URL is NOT a Tiddly URL — typically because the user hand-edited the config to point at a local dev fork or some unrelated service.

The plan's PAT-walk primitive (`AllTiddlyPATs`) is URL-based. It sees all Tiddly-URL entries (canonical or not); it does NOT see canonical-named entries that point elsewhere. The shared-PAT warning and orphan-subtraction filters are built on top of it, so they inherit that limitation.

Consequence: if a user has a repurposed canonical slot AND shares its PAT with another canonical entry being revoked, `remove --delete-tokens` won't warn before revoking. The repurposed slot's PAT gets revoked and that entry silently loses access. Similarly, the orphan-token warning may incorrectly flag a CLI-minted PAT that was pasted into a repurposed slot as "potentially orphaned."

This is accepted pre-GA. The scenario requires manual hand-editing of a canonical slot to a non-Tiddly URL AND specific PAT-sharing patterns — genuinely rare. If users report it, a follow-up PR can add a URL-agnostic `CanonicalSlotPATs` method and union its output into the retained-set computation. For now, the simpler URL-based model ships.

### What we keep from PR #117

Most of the PR's infrastructure is orthogonal to consolidation and stays:

- Timestamped backup writes with O_EXCL collision handling (`config_io.go`).
- Commit-phase failure revokes already-minted tokens (`revokeMintedTokens`, `withRevokeError`, detached `cleanupCtx`).
- Dry-run Bearer token redaction (`redactBearers`, `bearerRE`).
- `Configure` handler signature returns `backupPath`. `Remove` handler signature is changing (see below) to return `*RemoveResult` instead.
- Partial-result contract (`ConfigureResult` surfaces what completed before a mid-run failure).
- `classifyServer` extraction and secondary-sort tiebreaker in `status.go` — needed to render multi-entry state correctly AND used by preflight to detect canonical-key-URL-mismatch cases AND to derive preserved-entries lists (single source of truth). `OtherServer` gains a `URL` field so preflight can produce error messages naming the offending URL.
- `--help` text enumeration of the three supported tools.
- `AllTiddlyPATs` handler method — stays URL-based (any entry whose URL classifies as a Tiddly URL, canonical name or not). This is the single PAT-walk primitive; it's used by the remove path for both revoke targets and retained-set computation.
- Validate-then-mint fallback (repurposed — applies to the canonical entry only).
- **Preflight `handler.Status` call** (repurposed — see Milestone 1). Its purpose shifts from "read state to detect consolidation" to three concurrent jobs: (1) fail-closed parse probe before any server-side mutation, (2) detect canonical keys pointing at non-Tiddly URLs or wrong-type Tiddly URLs — scoped to the `--servers` set and aggregated across tools for multi-tool runs, (3) derive the preserved-non-canonical-entries list for the configure summary.

### What we delete from PR #117

- `cli/internal/mcp/consolidation.go` (entire file: `ConsolidationGroup`, `detectConsolidations`, `writeConsolidationWarning`, `survivorNameFor`, `canonicalNameForServerType`, `allServerTypes`).
- `cli/internal/mcp/consolidation_test.go` (entire file).
- `cli/internal/mcp/prompt.go` and `prompt_test.go` (Y/N TTY prompt — no prompt means no helper).
- `ErrConsolidationDeclined`, `ErrConsolidationNeedsConfirmation` in `configure.go`.
- `ConfigureOpts.AssumeYes`, `ConfigureOpts.Stdin`, `ConfigureOpts.IsInteractive`.
- `preflightedTool.consolidations`, `anyConsolidations`, `confirmConsolidations`, `detectConsolidations` call sites in `RunConfigure`.
- The "Consolidation required:" header emission in dry-run and commit paths.
- `translateConfigureError` in `cmd/mcp.go`.
- `--yes` / `-y` flag registration and the `assumeYes` variable in `cmd/mcp.go`.
- `PATExtraction.ContentName` and `PATExtraction.PromptName` fields (only `writeConsolidationWarning` consumed them).
- `tiddlyURLMatcher` in `configure.go` **and its four `TestTiddlyURLMatcher__*` tests** — the only callers were the three `build*Config` functions whose URL-based removal is being deleted; after M1 step 4 it has no non-test users.
- Consolidation-focused tests in `configure_test.go` (see full enumeration in Milestone 1 testing strategy).
- Phase 4 of `cli/agent_testing_procedure.md` (T4.1/2/4/8/8b/9/9b/10/11), plus the scattered `--yes`/consolidation references in Phase 1/3.

---

## Open questions resolved

Per the request's "Open questions for the implementer" section — each is decided below so the agent does not default to prior behavior without a stated reason.

1. **`--delete-tokens` semantics on `mcp remove`** — Canonical-only by default. `tiddly mcp remove claude-code --delete-tokens` revokes PATs from `tiddly_notes_bookmarks` / `tiddly_prompts` only. A user's `work_prompts` PAT is not touched. **Exception**: when a canonical PAT is also used by another retained Tiddly-URL entry on disk, the CLI warns before revoking. When a canonical entry's PAT doesn't match any CLI-minted server-side token (no `cli-mcp-` prefix match), the CLI prints an informational note referencing the specific entry. No opt-in flag for the old "nuke all Tiddly-URL PATs" behavior — if a user legitimately needs that, it's a follow-up feature.
2. **Status rendering** — Unchanged. `tiddly mcp status` continues to group every Tiddly-URL entry under "Tiddly servers" (canonical + custom). The `URL` field addition to `OtherServer` is backward-compatible with existing rendering.
3. **Dry-run output** — No "Consolidation required:" header. Dry-run shows the canonical-entry diff and emits per-entry stderr warnings when a canonical URL mismatch is present: `Warning: tiddly_prompts at https://example.com/... — real run will require --force`. Dry-run does NOT abort on mismatches — it commits nothing, so preview + warn is the right UX. Real runs still fail closed without `--force`. Mismatch detection (in both dry-run and real) is scoped to the `--servers` set.
4. **Deprecation / migration path** — None. The CLI is pre-GA; users whose scripts pass `--yes` will see Cobra's "unknown flag" error. Remediation is "drop the flag." Clean break is preferable to a deprecation shim.
5. **Obsolete tests** — Delete rather than rework. Listed explicitly in each milestone (test names verified against the file to prevent glob-misses).
6. **`survivorsOfAllTiddlyPATs` helper** — Reduced to "find the canonical entry's PAT, if any." Renamed to `canonicalEntryPATs`. `PATExtraction` collapses to `{ContentPAT, PromptPAT}` (Name fields deleted). The function only walks canonical entries — non-canonical PATs are no longer reuse candidates because `configure` doesn't touch those entries.
7. **Canonical key pointing at the wrong URL** — Fail closed with actionable error, overridable via `--force`. Two detection paths covering distinct sub-cases:
   - Canonical name at a **non-Tiddly URL** (e.g. `tiddly_prompts` → `https://example.com/my-prompts`): detected via `StatusResult.OtherServers` filtered to canonical names (requires the new `OtherServer.URL` field).
   - Canonical name at a **wrong-type Tiddly URL** (e.g. `tiddly_prompts` → content server URL): detected via `StatusResult.Servers` filtered to `MatchByName` entries whose `ServerType` doesn't match the expected type for the name.
   
   Both cases route through the same preflight error and `--force` escape hatch. Detection is scoped to `opts.Servers` — a canonical slot out of this run's scope is not checked. Multi-tool runs aggregate mismatches across all tools that successfully inspected (Status succeeded + mismatches detected). Hard errors (path resolution, parse failures, Status read errors) still fail early per their existing semantics — different class from "preflight succeeded and found a content problem."
8. **Fail-closed safety on malformed config** — Preserved via the existing preflight `handler.Status(rc)` call.
9. **Remove semantics for canonical entries with non-Tiddly URLs** — Delete them. `tiddly mcp remove claude-code` uses a canonical-name-only predicate regardless of URL. `.bak.<timestamp>` provides recovery. No `--force` flag on remove — it would be semantically empty.
10. **`--force` short form** — None. No `-f` alias.
11. **Preserved-entries list scoping under `--servers`** — Scoped to the server types managed by this run.
12. **Canonical-slot PATs at non-Tiddly URLs (repurposed slots)** — Not handled. `AllTiddlyPATs` is URL-based and does not see these entries. The remove path's shared-PAT warning and orphan-subtraction filter are built on `AllTiddlyPATs` alone. See "Accepted limitation" above. Rare scenario; acceptable pre-GA; revisit via a URL-agnostic `CanonicalSlotPATs` method if user reports arise.

---

## Architectural decision: refactor in place, don't revert

We keep commit `3d7a1b1` and surgically remove the consolidation layer. Rationale:

- The KEEP set touches every file in the PR. A revert-and-cherry-pick reapplies ~70% of the diff by hand.
- Signature changes (`Configure` → `backupPath`; `PATExtraction`) ripple through all three handlers and their tests.
- The `classifyServer` extraction and status secondary-sort tiebreaker are dependencies of "render multi-entry state correctly."

---

## Reference reading for the agent

Before implementing, read these files to understand current structure and what's being removed:

- `cli/internal/mcp/configure.go` — focus on `RunConfigure`, `preflightedTool`, `confirmConsolidations`, `resolveToolPATs`, `resolveServerPAT`, the preflight `handler.Status` call, and the two helpers whose signatures are changing: `DeleteTokensByPrefix` (around line 564) and `CheckOrphanedTokens` (around line 625).
- `cli/internal/mcp/consolidation.go` — entire file (being deleted).
- `cli/internal/mcp/prompt.go` — entire file (being deleted).
- `cli/internal/mcp/handler.go` — `TiddlyPAT`, `PATExtraction`, `ToolHandler` interface, `survivorsOfAllTiddlyPATs`, and `AllTiddlyPATs`. The `Remove` method's return type is changing to `*RemoveResult`.
- `cli/internal/mcp/status.go` — `classifyServer`, `StatusResult`, `MatchByName` / `MatchByURL`, `OtherServer` (gains a URL field).
- `cli/internal/mcp/claude_code.go`, `claude_desktop.go`, `codex.go` — existing `extractAll*TiddlyPATs` and `extract*PATs` pairs, and the per-handler `remove*` functions whose return type is changing.
- `cli/cmd/mcp.go` — `newMCPConfigureCmd`, `newMCPRemoveCmd`, `translateConfigureError`, `--yes` flag wiring, and the two `Long:` strings at lines 62-85 and 301-319 whose URL-based-replace wording contradicts the new contract. Also the PAT-collection block around line 372 and the orphan-token warning emission around line 440.
- `cli/agent_testing_procedure.md` — Phase 4 overall shape, Phase 1–3 to preserve, the scattered references at lines 3, 954-955, 1015, 1017, and **T8.4/T8.5 at lines 2228-2238** (these intentionally invoke `--scope local` / `--scope project` to verify rejection; do not alter them under the `--scope local` sweep).
- `frontend/src/pages/docs/DocsCLIMCP.tsx` — "Server Identification" block at lines 124-141 whose URL-based "replace on configure / remove by URL" prose contradicts the new additive contract.
- `docs/ai-integration.md` — line 108 has `--scope local` as part of a legitimate Tiddly→Claude Code scope-mapping table. Preserve the cross-reference.
- `frontend/src/components/AISetupWidget.tsx` — the `getAffectedFiles` Claude Code description around line 431 (already edited on-branch).

---

## Agent behavior (global)

- This is a **single PR** with **one commit per milestone**. Do not combine multiple milestones into one commit; do not split a milestone across multiple commits.
- Complete each milestone fully (code + tests + docs) before moving to the next. Stop and request human review at the end of each milestone before committing.
- Run `make cli-verify` at the end of every milestone; it must pass before proceeding.
- Ask for clarification when requirements are ambiguous. Do not assume.
- Remove legacy code rather than leaving dead paths. Breaking changes are acceptable.
- Prefer deleting obsolete tests outright over reworking them into something weaker.
- Type hints and clear naming as per `cli/` Go conventions already in use.
- Line numbers in the plan are anchors that may have drifted — always locate code by surrounding function names, not line number alone.

---

## Milestones

### Milestone 1 — Additive `configure` (consolidation removed; `--force` added; preflight URL-mismatch detection)

**Goal & outcome:**
`tiddly mcp configure` writes only canonical entries and leaves non-canonical Tiddly-URL entries untouched. Consolidation module, prompt helper, and the gate are all removed. The preflight `handler.Status` call is preserved and now serves three purposes: fail-closed parse probe, canonical-URL-mismatch detection (scoped to `--servers`; aggregated across tools in multi-tool runs), and preserved-entries derivation. `--force` overrides the canonical-URL-mismatch refusal only. Dry-run previews + warns on mismatches (does not abort). Validate-then-mint on the canonical entry's PAT is preserved. The configure summary lists preserved non-canonical entries (scoped to the server types managed by this run).

- `configure` with pre-existing `work_prompts` + `personal_prompts` → those entries survive unchanged; canonical entries added/updated; summary lists them as preserved.
- `configure --servers content` with non-canonical `work_content` + `work_prompts` → canonical content written, canonical prompts untouched (out of scope), summary lists only `work_content`.
- `configure --servers content` when canonical `tiddly_prompts` has a URL mismatch → **does NOT fail** (prompts is out of scope); configure succeeds for content; prompts canonical entry is untouched.
- `configure --servers content` when canonical `tiddly_notes_bookmarks` has a URL mismatch → fails with the aggregated error (content IS in scope).
- `configure` re-run when canonical is already present at the correct Tiddly URL → canonical updated in place (same validate-then-mint); non-canonical untouched.
- `configure` run when canonical `tiddly_prompts` exists but its URL is not a Tiddly URL (and prompts is in scope) → non-zero exit with actionable error naming the file path, key name, and current URL. No server-side token mint.
- `configure` run when canonical `tiddly_prompts` points at the content Tiddly URL (cross-wired, prompts in scope) → same fail-closed behavior.
- `configure` run against two auto-detected tools, each with an in-scope canonical URL mismatch → single aggregated error listing both tools and their mismatches; no mints for either.
- `configure --force` with any in-scope mismatch type → proceeds; prints `Forcing overwrite of tiddly_prompts (currently <url>)` to stderr (non-dry-run only); writes the CLI-managed entry.
- `configure --dry-run` with an in-scope mismatch → shows the diff AND emits per-entry stderr warnings (`Warning: ... — real run will require --force`). Exit code 0. User can preview without running `--force`.
- `configure --dry-run --force` → previews the overwrite via the diff; warnings suppressed (the diff IS the answer).
- Commit-phase token revoke-on-failure preserved.
- Malformed config → fail closed in preflight before any mint.
- `--yes` is deleted; passing it produces Cobra's "unknown flag" error.
- `make cli-verify` passes at milestone boundary.

**Sample output (multi-account user running configure against Claude Code):**

```
$ tiddly mcp configure claude-code
Created tokens: cli-mcp-claude-code-content-abc123, cli-mcp-claude-code-prompts-def456
Configured: claude-code
Backed up claude-code config to /Users/alice/.claude.json.bak.2026-04-20T14-33-02Z
Preserved non-CLI-managed entries in claude-code: work_prompts, personal_prompts
```

**Sample output (fail-closed with canonical-URL mismatch, single tool, no `--force`):**

```
$ tiddly mcp configure claude-code
Error: 1 canonical entry in /Users/alice/.claude.json points at a non-Tiddly URL:
  - tiddly_prompts → https://example.com/my-prompts

Options:
  - Preserve it: edit the file to rename the entry, then re-run.
  - Replace it:  re-run with --force.
```

**Sample output (multi-tool aggregated fail-closed):**

```
$ tiddly mcp configure
Error: canonical URL mismatches in 2 tools:

claude-code (/Users/alice/.claude.json):
  - tiddly_prompts → https://example.com/my-prompts

codex (/Users/alice/.codex/config.toml):
  - tiddly_notes_bookmarks → http://localhost:8001/mcp

Options:
  - Preserve them: edit each file to rename the mismatched entries, then re-run.
  - Replace them:  re-run with --force (applies to all tools in this run).
```

**Sample output (dry-run with in-scope mismatch):**

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

Pluralizes cleanly; each affected tool's mismatches are listed before its diff.

**Implementation outline:**

1. **Delete files:** `cli/internal/mcp/consolidation.go`, `consolidation_test.go`, `prompt.go`, `prompt_test.go`.

2. **`status.go`**: add `URL string` field to the `OtherServer` struct. Update `classifyServer`'s default branch from `&OtherServer{Name: name, Transport: transport}` to `&OtherServer{Name: name, URL: urlStr, Transport: transport}`. No changes needed in the three per-handler status builders — they already route through `classifyServer`. Existing `tiddly mcp status` rendering doesn't print the URL; backward-compatible addition.

3. **`configure.go`**:
   - Delete `ErrConsolidationDeclined`, `ErrConsolidationNeedsConfirmation`.
   - Remove `ConfigureOpts.AssumeYes`, `.Stdin`, `.IsInteractive`. Add `ConfigureOpts.Force bool`.
   - Remove `preflightedTool.consolidations` field. Add two new named types for preflight aggregation:

     ```go
     // canonicalMismatch describes a canonical key whose current URL doesn't
     // match the expected Tiddly URL for its type. Used by preflight's URL-
     // mismatch detector, by the --force-overwrite stderr log, and by the
     // dry-run warning emission.
     type canonicalMismatch struct {
         Name string // canonical key name (serverNameContent or serverNamePrompts)
         URL  string // current URL on disk (non-matching)
     }

     // toolMismatches aggregates canonicalMismatch entries per tool for
     // multi-tool preflight error reporting. The combined preflight error
     // carries []toolMismatches and formats each section with the tool heading
     // and config path.
     type toolMismatches struct {
         ToolName   string
         ConfigPath string
         Entries    []canonicalMismatch
     }
     ```

   - Add `preflightedTool.preservedNames []string` and `preflightedTool.forceOverwrites []canonicalMismatch`.
   - Remove `anyConsolidations`, `confirmConsolidations` functions and the Phase 2 gate call site.
   - **Keep the preflight `handler.Status(rc)` call**. New role is threefold:
     1. **Parse probe / fail-closed.** Existing dry-run-tolerant vs. real-run fail-closed branching stays — read error on a real run still aborts before any mint.
     2. **Canonical-URL-mismatch detection, scoped and aggregated.** After a successful Status, build a `[]canonicalMismatch` list for the tool from two sources:
        - `sr.OtherServers` entries whose `Name == serverNameContent || Name == serverNamePrompts` AND whose inferred server type is in `opts.Servers` (via `opts.wantServer()`). URL comes from the new `OtherServer.URL` field.
        - `sr.Servers` entries where `MatchMethod == MatchByName`, `ServerType` doesn't match the name's expected type, AND that expected type is in `opts.Servers`.
        
        Append each tool's mismatches to a run-level `[]toolMismatches` if its Entries list is non-empty. After the preflight loop completes:
        - If the run-level list is empty → no mismatch handling, proceed normally.
        - Else if `opts.DryRun == true` → emit per-entry stderr warnings (format: `Warning: <name> at <url> — real run will require --force`) and continue to the commit loop so the diff is still produced. Do NOT return an error.
        - Else if `opts.Force == false` → return the combined aggregated error (before `resolveToolPATs` for ANY tool runs), so no server-side token mint happens.
        - Else (`opts.Force == true`, non-dry-run) → copy each tool's mismatches into its `preflightedTool.forceOverwrites` for the commit loop to log.
     3. **Preserved-entries derivation.** Filter `sr.Servers` to entries where `MatchMethod == MatchByURL` AND `ServerType` is in `opts.Servers` (or all types if no filter). Those are non-canonical-named entries of in-scope server types whose URLs classify as Tiddly. Stash sorted names on `preflightedTool.preservedNames`.
   - In the commit loop, delete the consolidation-warning branches and "Consolidation required:" emission.
   - In the commit loop, after successful `handler.Configure`, copy `pf.preservedNames` into `result.PreservedEntries[pf.tool.Name]`.
   - **Force-overwrite stderr log.** Non-dry-run runs with `opts.Force == true` and a non-empty `pf.forceOverwrites` emit one line per overwritten entry to `opts.ErrOutput` BEFORE `handler.Configure` is called: `Forcing overwrite of <key> (currently <url>)`. Dry-run runs do NOT emit this.
   - **Delete `tiddlyURLMatcher`** (function at configure.go:25-38).
   - **Change `DeleteTokensByPrefix` signature** to accept `[]TokenRevokeRequest` and return `[]TokenRevokeResult`:

     ```go
     type TokenRevokeRequest struct {
         EntryLabel string // free-form caller label, typically canonical entry name
         PAT        string
     }

     type TokenRevokeResult struct {
         EntryLabel   string
         DeletedNames []string // cli-mcp-* tokens revoked for this request's PAT (empty if none matched)
         Err          error    // per-request error (post-list-tokens), or nil
     }

     // DeleteTokensByPrefix revokes server-side tokens matching any request
     // PAT and the cli-mcp- name prefix. Returns one result per input request,
     // preserving order and labels. Top-level error covers only list-tokens
     // failure; per-request errors are surfaced inside results.
     //
     // Requests sharing a PAT are deduped internally: one server-side
     // deletion pass per unique PAT. The resulting DeletedNames and Err are
     // mirrored into every result whose PAT matches, so callers never see
     // duplicate deletions or false "nothing matched" for shared PATs.
     //
     // For PATs shorter than tokenPrefixLen, DeletedNames is empty and Err is
     // nil — treated as "nothing matched."
     func DeleteTokensByPrefix(ctx context.Context, client *api.Client, reqs []TokenRevokeRequest) ([]TokenRevokeResult, error)
     ```

   - **Change `CheckOrphanedTokens` return type** to `[]api.TokenInfo` (or a minimal `{Name, TokenPrefix}` struct) so the caller can cross-reference prefixes against retained PATs.
   - Keep: `resolveToolPATs`, `resolveServerPAT`, `mintedToken`, `toolPATResolution`, `withRevokeError`, `revokeMintedTokens`, `cleanupTimeout`, `redactBearers`, `printDiff`, `BackupRecord`.
   - Add `ConfigureResult.PreservedEntries` — `map[string][]string` keyed by tool name.

4. **`handler.go`**:
   - Collapse `PATExtraction` to `{ContentPAT, PromptPAT}` — delete Name fields.
   - Rename `survivorsOfAllTiddlyPATs` → `canonicalEntryPATs`. Semantics: only match canonical-named entries.
   - `AllTiddlyPATs` stays URL-based (contract unchanged from today). Doc comment updated:

     ```go
     // AllTiddlyPATs returns every extractable Bearer token in the tool's
     // config from entries whose URL classifies as a Tiddly URL, in
     // canonical-first order. Used by `remove --delete-tokens`: the canonical
     // subset supplies revoke targets; the full output feeds the retained-
     // PAT set used for shared-PAT warnings and orphan-subtraction.
     //
     // Known limitation: a canonical-named entry whose URL is NOT a Tiddly
     // URL (a repurposed slot) is not returned by this method. Such entries
     // do not participate in shared-PAT warnings or orphan-subtraction. This
     // is an accepted pre-GA limitation; see plan document for context.
     AllTiddlyPATs(rc ResolvedConfig) []TiddlyPAT
     ```

   - **Change `Remove` return type** to `(*RemoveResult, error)`:

     ```go
     // RemoveResult describes the outcome of a remove operation.
     // RemovedEntries lists the canonical key names actually deleted from
     // the config file (empty slice if nothing matched the predicate — e.g.
     // the file had only non-canonical entries). BackupPath is the
     // timestamped backup file created before the write (empty if no prior
     // file existed or nothing was changed).
     type RemoveResult struct {
         RemovedEntries []string
         BackupPath     string
     }

     Remove(rc ResolvedConfig, servers []string) (*RemoveResult, error)
     ```

5. **Per-handler files (`claude_code.go`, `claude_desktop.go`, `codex.go`)**:
   - `extractAll*TiddlyPATs` stays URL-based (unchanged).
   - `extract*PATs` survivor variants derive from `canonicalEntryPATs`.
   - **Delete the URL-based removal call inside each build path:**
     - `claude_code.go` around line 190 — remove the `removeJSONServersByTiddlyURL(servers, tiddlyURLMatcher(...))` line.
     - `claude_desktop.go` around line 60 — remove the same call.
     - `codex.go` around line 89 — remove `removeCodexServersByTiddlyURL(...)`.

     The removal helpers stay — they're still used by the Remove path in Milestone 2.
   - **Do NOT add canonical-URL validation in `build*Config`.** The check lives in preflight.
   - `Remove` path per-handler changes deferred to Milestone 2 (where the signature change lands with the behavior change).

6. **`cmd/mcp.go` — `--yes` removal and `--force` addition**:
   - Delete `cmd.Flags().BoolVarP(&assumeYes, "yes", "y", ...)`, the `assumeYes` variable, and the `AssumeYes: assumeYes` field.
   - Add `--force` on `newMCPConfigureCmd`: `cmd.Flags().BoolVar(&force, "force", false, "Overwrite canonical entries that point at non-Tiddly URLs or wrong-type Tiddly URLs")`. Long-form only.
   - Plumb to `ConfigureOpts.Force`.
   - Update the configure `Long:` string to document `--force`: "Use `--force` to overwrite a canonical entry whose URL doesn't match the expected Tiddly URL for that type."

**Testing strategy (`configure_test.go`):**

- **Delete:**
  - `TestRunConfigure__consolidation_prompt_proceeds_on_yes` (line ~1174)
  - `TestRunConfigure__consolidation_prompt_aborts_on_no` (line ~1208)
  - `TestRunConfigure__consolidation_non_interactive_errors_without_yes` (line ~1238)
  - `TestRunConfigure__declining_before_writes_creates_no_server_tokens` (line ~1266)
  - `TestRunConfigure__non_interactive_decline_creates_no_server_tokens` (line ~1303)
  - `TestRunConfigure__consolidation_assume_yes_bypasses_prompt` (line ~1885)
  - `TestRunConfigure__dry_run_warns_about_multi_entry_consolidation` (line ~1013)
  - `TestRunConfigure__dry_run_no_warning_when_single_entries` (line ~1072)
  - `TestRunConfigure__dry_run_servers_flag_scopes_warning` (line ~1104)
  - `TestRunConfigure__no_prompt_when_single_entries` (line ~1918)
  - `TestRunConfigure__single_gate_across_multiple_tools` (if present)
  - `TestRunConfigure__oauth_multi_entry_proceed_reuses_surviving_pat` (if present)
  - `TestTiddlyURLMatcher__both_pats`, `__content_only`, `__prompts_only`, `__neither_pat_matches_nothing`.
  - All `TestWriteConsolidationWarning__*` tests.
  - Handler-specific tests that assert `Configure` **deletes** a non-canonical Tiddly-URL entry.
- **Keep:**
  - `TestPrintDiff__redacts_bearer_across_all_three_formats`
  - `TestRunConfigure__commit_phase_failure_preserves_earlier_writes`
  - `TestRunConfigure__oauth_commit_failure_revokes_minted_tokens`
  - `TestRunConfigure__oauth_commit_failure_with_revoke_failure_surfaces_orphans`
  - `TestRunConfigure__commit_phase_failure_surfaces_backup_path`
  - `TestRunConfigure__preflight_failure_returns_nil_result`
  - `TestRunConfigure__status_error_aborts_non_dry_run`
  - `TestRunConfigure__malformed_config_returns_parse_error` (if present)
  - `TestRevokeMintedTokens__*`
- **Add (core of the behavior change):**
  - `TestRunConfigure__additive_preserves_non_canonical_tiddly_entries` (per handler).
  - `TestRunConfigure__reuses_canonical_pat_when_valid`
  - `TestRunConfigure__mints_fresh_when_canonical_pat_invalid`
  - `TestRunConfigure__does_not_reuse_pat_from_non_canonical_entry`
  - `TestRunConfigure__dry_run_shows_only_canonical_diff`: with non-canonical entries present, assert the dry-run output does not show `work_prompts` as a *changed or removed* line. The key may appear identically in both `before` and `after` blocks — that's expected.
  - `TestRunConfigure__servers_content_leaves_canonical_prompts_structurally_preserved`
  - `TestRunConfigure__refuses_to_overwrite_canonical_key_with_non_tiddly_url`: `tiddly_prompts` at `https://example.com/whatever`. Error non-nil; message contains file path, key name, URL. **`opts.Client.CreateToken` NOT called.** No config write.
  - `TestRunConfigure__refuses_when_canonical_name_has_wrong_type_tiddly_url`: `tiddly_prompts` at content Tiddly URL. Same assertions.
  - `TestRunConfigure__does_not_refuse_on_out_of_scope_mismatch`: `tiddly_prompts` has non-Tiddly URL, run with `--servers content`. Assert configure succeeds (content is written; prompts mismatch is out of scope).
  - `TestRunConfigure__dry_run_warns_on_mismatch_but_shows_diff`: real-run-equivalent bad state + `opts.DryRun = true`. Assert stderr contains the per-entry warning AND the diff output is produced AND exit is success-path (no error returned).
  - `TestRunConfigure__aggregates_mismatches_across_multiple_tools`: two tools, each with in-scope canonical URL mismatch. Single combined error; no mints for either. Output matches the multi-tool sample.
  - `TestRunConfigure__does_not_aggregate_hard_errors_with_url_mismatches`: one tool with parse error, one with URL mismatch. Parse error surfaces alone (fail-early).
  - `TestRunConfigure__force_overwrites_canonical_with_non_tiddly_url` (per handler).
  - `TestRunConfigure__force_overwrites_cross_wired_canonical`
  - `TestRunConfigure__force_with_dry_run_shows_overwrite_in_diff_without_warning_line`
  - `TestRunConfigure__force_is_no_op_when_no_canonical_url_mismatch`
  - `TestRunConfigure__reports_preserved_non_canonical_entries`
  - `TestRunConfigure__preserved_entries_scoped_to_requested_servers`
  - `TestRunConfigure__preserves_non_canonical_entry_with_malformed_authorization`
- **Per-handler tests**:
  - Remove tests asserting `Configure` deletes non-canonical Tiddly-URL entries.
  - Add: given a canonical + non-canonical Tiddly-URL entry + unrelated non-Tiddly entries, `Configure` preserves the non-canonical Tiddly entry and the unrelated entries structurally.
  - `ExtractPATs` tests: update for `{ContentPAT, PromptPAT}` only and canonical-name-only semantics.
  - `AllTiddlyPATs` tests: reaffirm URL-based semantics.

**Docs:** None in this milestone.

---

### Milestone 2 — Canonical-name-only `mcp remove` (+ structured `--delete-tokens` reporting; `Remove` signature change)

**Goal & outcome:**
`tiddly mcp remove` deletes canonical-named entries regardless of URL. Non-canonical entries survive. `Remove` handler signature returns `*RemoveResult`, enabling the cmd layer to distinguish "removed X entries" from "nothing to remove." `--delete-tokens` revokes only PATs attached to canonical entries, warns before revoking a PAT also referenced by a retained Tiddly-URL entry, and emits a per-entry note when a canonical PAT doesn't match any CLI-minted server-side token. Orphan-token warning (no `--delete-tokens`) is filtered to exclude tokens whose prefix matches a retained PAT.

- `tiddly mcp remove claude-code` with canonical + non-canonical entries → canonical removed, non-canonical structurally preserved, output lists removed names.
- `tiddly mcp remove claude-code` when config has only non-canonical entries → output: `No CLI-managed entries found in claude-code.` Non-canonical entries untouched.
- `tiddly mcp remove claude-code` when canonical `tiddly_prompts` points at a non-Tiddly URL → canonical entry deleted. `.bak.<timestamp>` provides recovery.
- `tiddly mcp remove claude-code --delete-tokens` → revokes PATs for canonical entries only.
- **`--delete-tokens` when canonical `tiddly_prompts` PAT equals non-canonical `work_prompts` PAT** → consolidated warning: `Warning: token from tiddly_prompts is also used by work_prompts (still configured); revoking will break those bindings.`
- **`--delete-tokens` when the canonical entry's PAT doesn't match any `cli-mcp-*` server-side token** → `Note: no CLI-created token matched the token attached to tiddly_prompts; nothing was revoked. Manage tokens at https://tiddly.me/settings.` One note per affected canonical entry.
- **`--delete-tokens` with two canonical entries sharing a PAT** → internal dedup produces ONE server-side deletion; both result records get the same `DeletedNames`; neither gets a false "no CLI-created token matched" note.
- Orphan-token warning (no `--delete-tokens`) excludes tokens whose prefix matches a PAT still referenced by a retained Tiddly-URL entry on disk.

**Implementation outline:**

1. **Per-handler `Remove` method**: change the deletion predicate from "any entry matching a Tiddly URL" to **"entry whose key name is canonical"** — URL-agnostic. Drop the belt-and-suspenders URL check. For `--servers content` / `--servers prompts`, filter by canonical name for the requested type.
   
   Also change the return type: each handler's `Remove` now returns `(*RemoveResult, error)` — populate `RemovedEntries` with the actual canonical key names deleted (empty slice if none matched) and `BackupPath` with the backup path. If nothing would be written, still return a valid `*RemoveResult` with empty `RemovedEntries` and empty `BackupPath`. `ToolHandler.Remove` interface signature matches.

2. **`cmd/mcp.go` — `newMCPRemoveCmd` rewrite**:
   - No new flag.
   - Call `result, err := handler.Remove(rc, serverList)`. Based on `result.RemovedEntries`:
     - If empty: print `No CLI-managed entries found in <tool>.` Skip the token-cleanup path (nothing was removed, so nothing to clean up, and the orphan-warning also has no predicate to check against).
     - If non-empty: print `Removed from <tool>: <names>.` and `Backed up previous config to <path>.` if `BackupPath` is non-empty.
   - **PAT collection** — two passes:
     1. **Revoke targets**: iterate canonical entries via `canonicalEntryPATs` (or an inline canonical-name filter over `AllTiddlyPATs`), filtered to server types being removed this invocation. Each target is a `TokenRevokeRequest{EntryLabel: <canonical-name>, PAT: <pat>}`.
     2. **Retained PATs after write**: compute as `handler.AllTiddlyPATs(rc)` (URL-Tiddly entries), minus canonical entries this invocation is about to delete (by name). The subtraction avoids a second `handler.Status` re-read.
   - **Shared-PAT warning**: for each revoke target, collect retained entries whose PAT equals the target's PAT. If any matches, emit ONE line per canonical-entry-being-revoked: `Warning: token from <canonical-name> is also used by <retained-name-1>, <retained-name-2>, ... (still configured); revoking will break those bindings.`
   - **Call revoke helper**: `results, err := mcp.DeleteTokensByPrefix(cmd.Context(), client, reqs)`.
   - **Per-entry note derivation**: for each result with empty `DeletedNames` and nil `Err`: `Note: no CLI-created token matched the token attached to <EntryLabel>; nothing was revoked. Manage tokens at https://tiddly.me/settings.`
   - **Successful deletions**: dedupe `DeletedNames` across results, print the `Deleted tokens:` line.
   - **Per-entry errors**: non-nil `Err` results surface as per-entry warnings.
   - **Auth semantics (unchanged)**: `ResolveToken(flagToken, preferOAuth=true)` still gates the token-cleanup block. Silent skip on auth failure is preserved (acknowledged rough edge, tracked separately).
   - The existing "Warning: token is shared with X server (still configured)" message is superseded.

3. **Orphan-token warning filtering** (no `--delete-tokens` path):
   - `CheckOrphanedTokens` now returns token `{Name, TokenPrefix}` pairs. Compute retained-PAT prefixes from `handler.AllTiddlyPATs(rc)` minus canonical entries just deleted. Filter the orphan candidate set to exclude any token whose `TokenPrefix` is in the retained-prefix set. Emit the warning only for the filtered result.

4. **`CheckOrphanedTokens`** — signature change from `[]string` to `[]api.TokenInfo`. Doc comment:

   ```go
   // NOTE: Returns server-side tokens matching the cli-mcp-{tool}-{serverType}-
   // name pattern. The caller must subtract tokens whose TokenPrefix matches
   // a PAT still referenced by a retained entry on disk before presenting
   // the result as "potentially orphaned" — otherwise tokens in active use
   // by non-canonical entries would be misreported.
   //
   // Known limitation: does not see repurposed canonical slots (canonical
   // names at non-Tiddly URLs). A CLI-minted PAT pasted into such an entry
   // may be reported as "potentially orphaned" here even though it's still
   // in use. Accepted pre-GA; see plan document.
   ```

**Testing strategy (`cmd/mcp_test.go` and per-handler tests):**

- **Delete:** `TestTranslateConfigureError__*` (all four).
- **Modify:**
  - `TestMCPRemove__delete_tokens_multi_entry_revokes_all` → rename to `..._revokes_canonical_only`; assert non-canonical PATs NOT in DELETE set. Update for new `Remove` return.
  - Any test using the old `DeleteTokensByPrefix([]string)` signature → update to `[]TokenRevokeRequest`.
  - Any test asserting the old `Remove` return → update for `*RemoveResult`.
- **Keep:**
  - `TestMCPRemove__delete_tokens_dedups_shared_pat` (update to structured form).
  - `TestMCPConfigure__dry_run_surfaces_pat_auth_warning`.
- **Add:**
  - `TestMCPRemove__preserves_non_canonical_entries` (per handler).
  - `TestMCPRemove__deletes_canonical_entry_with_non_tiddly_url` (per handler): canonical `tiddly_prompts` at `https://example.com/foo` → deleted, backup created.
  - `TestMCPRemove__reports_nothing_removed_when_no_canonical_entries_present`: config has only `work_prompts`, run remove. Assert `RemovedEntries` is empty; cmd output is `No CLI-managed entries found …`; token-cleanup path skipped.
  - `TestMCPRemove__delete_tokens_ignores_non_canonical_pats`.
  - `TestMCPRemove__shared_pat_warning_fires_on_canonical_split`.
  - `TestMCPRemove__shared_pat_warning_fires_when_non_canonical_retains_pat` (critical correctness).
  - `TestMCPRemove__shared_pat_warning_consolidates_multiple_retained_entries`.
  - `TestMCPRemove__no_warning_when_no_retained_pat_shares`.
  - `TestMCPRemove__servers_prompts_only_warns_when_retained_content_shares_pat`.
  - `TestMCPRemove__non_cli_token_note_fires_per_unmatched_entry`.
  - `TestMCPRemove__non_cli_token_note_fires_once_per_entry`.
  - `TestMCPRemove__non_cli_token_note_fires_for_short_or_garbled_pat`.
  - `TestMCPRemove__non_cli_token_note_does_not_fire_for_cli_tokens`.
  - `TestMCPRemove__shared_pat_revoke_dedups_at_helper_level`: two canonical entries with the same PAT, one matching CLI-minted server-side token. Assert only ONE deletion happens server-side; both result records show the same (non-empty) `DeletedNames`; no false "nothing matched" note.
  - `TestMCPRemove__orphan_warning_excludes_tokens_used_by_non_canonical_entries`.
  - `TestMCPRemove__orphan_warning_fires_for_unreferenced_cli_tokens`.
- **Helper-level tests** (`configure_test.go` or a dedicated file):
  - `TestDeleteTokensByPrefix__shared_pat_fans_out_single_deletion`: two `TokenRevokeRequest` with the same PAT, one matching server-side token. Assert exactly one `client.DeleteToken` call; both results have the same `DeletedNames`.
  - `TestDeleteTokensByPrefix__short_pat_returns_empty_not_error`: request with a PAT shorter than `tokenPrefixLen`. Assert result has empty `DeletedNames` and nil `Err`.

**Docs:** None in this milestone.

---

### Milestone 3 — CLI help, docs, and E2E test plan cleanup

**Goal & outcome:**
User-visible surface (help text, docs, test plan doc, frontend widget) reflects the additive semantics. No references to consolidation, `--yes`, or the Y/N prompt remain in user-facing copy. `--force` is documented. Tiddly-facing `--scope` vocabulary is consistent.

- `tiddly mcp configure --help` and `tiddly mcp remove --help` accurately describe additive behavior; configure help documents `--force`.
- `frontend/src/pages/docs/DocsCLIMCP.tsx` explains the additive contract, documents `--force`, and includes a FAQ-style block.
- `frontend/src/components/AISetupWidget.tsx` references current Tiddly-facing `--scope` vocabulary.
- `cli/agent_testing_procedure.md` Phase 4 is removed; scattered references cleaned up; T8.4/T8.5 preserved.
- User-facing copy avoids "canonical".

**Implementation outline:**

1. **`cmd/mcp.go` — Long strings**:
   - `newMCPConfigureCmd` Long string: remove the paragraph about consolidation and `--yes`. Rewrite the second paragraph:

     > Configure writes two CLI-managed entries: `tiddly_notes_bookmarks` (content server) and `tiddly_prompts` (prompt server). These are the only entries the CLI creates or modifies. If you have other entries pointing at Tiddly URLs under different names (for example, `work_prompts` and `personal_prompts` for multiple accounts), configure leaves them alone. After a run, configure lists any preserved non-CLI-managed entries so you can see what was left unchanged.
     >
     > If a CLI-managed entry already exists but points at a URL that's not the expected Tiddly URL for its type, configure refuses by default and tells you which entry is mismatched. Either rename the entry in the config file to preserve it, or re-run with `--force` to overwrite. Use `--dry-run` to preview either path without committing.

   - Remove `translateConfigureError` and its call site; becomes `return err`. Remove the `errors` import if unused.
   - `--yes` already deleted in Milestone 1.
   - `--force` registered in Milestone 1; confirm in `--help`.
   - `newMCPRemoveCmd` Long string: replace the URL-based paragraph:

     > Remove deletes the CLI-managed entries (`tiddly_notes_bookmarks`, `tiddly_prompts`) from the tool's config file. Other entries pointing at Tiddly URLs under different names are preserved. A canonical-named entry is removed regardless of what URL it points at. The prior config is saved to `<path>.bak.<timestamp>` before the write. If no CLI-managed entries exist, remove reports so and exits cleanly.
     >
     > With `--delete-tokens`, only the PATs attached to CLI-managed entries are revoked; PATs used by preserved entries are left alone. If a CLI-managed PAT is also referenced by a preserved entry, the CLI warns before revoking. If a CLI-managed entry's PAT doesn't match any CLI-created server-side token, the CLI prints an informational note referencing that entry.

2. **`frontend/src/pages/docs/DocsCLIMCP.tsx`**:
   - Rewrite the "Server Identification" section at lines 124-141.
   - Add `--force` to the Flags table.
   - Add a short FAQ block: "I have multiple Tiddly entries — what happens on configure?"
   - Replace "canonical" in user-facing text.

3. **`frontend/src/components/AISetupWidget.tsx`**: `--scope local` → `--scope directory` already edited; keep.

4. **`cli/agent_testing_procedure.md`**:
   - Delete entirely: Phase 4 and T4.1, T4.2, T4.4, T4.8, T4.8b, T4.9, T4.9b, T4.10, T4.11.
   - Edit line 3, lines 954-955, line 1015 (replace `--yes` with `--force`), line 1017.
   - Keep T4.6, T4.7 (reframe), T5.4.
   - Rewrite T6.8, T6.8b, T6.8c, T6.8d for canonical-only `--delete-tokens`. Add sub-tests: shared-PAT warning, non-CLI-token note, orphan-warning filter, shared-PAT helper dedup.
   - Do NOT modify T8.4/T8.5.
   - Add five E2E tests to Phase 3: additive preservation, canonical update-in-place, fail-closed on URL mismatch (both types, with multi-tool aggregation), `--force` overwrite, canonical-only remove with `--delete-tokens` warnings.

5. **Project-level docs audit** per `AGENTS.md`:
   - Search for: "consolidate", "consolidation", "--yes", "work_prompts", "migrations from manual setups safe", and (with exceptions) "--scope local".
   - `--scope local` exceptions — preserve: `cli/agent_testing_procedure.md` T8.4/T8.5; `docs/ai-integration.md` line 108.

**Testing strategy:**

- After help-text edits, paste `tiddly mcp configure --help` and `tiddly mcp remove --help` output into PR description.
- `make frontend-verify` must pass.

**Docs:** Everything in this milestone is a doc change.

---

## Definition of done (global)

- `make cli-verify` passes.
- `make frontend-verify` passes.
- Agent provides a summary of what was deleted vs. kept vs. modified, cross-referenced against this plan's milestones.
- Agent pastes new `configure --help` and `remove --help` output in the PR description.
- Agent confirms (with grep output) that no unresolved references to `consolidation`, `ConsolidationGroup`, `ErrConsolidation*`, `promptYesNo`, `AssumeYes`, `detectConsolidations`, or `writeConsolidationWarning` remain.
- Agent confirms (with grep output) that `--yes` / `assumeYes` is not registered anywhere in `cli/cmd/` or `cli/internal/` source.
- Agent confirms (with grep output) that "canonical" no longer appears in user-facing copy under `frontend/src/pages/docs/` or `cli/cmd/*.go` Long strings.
- Non-canonical Tiddly-URL entries are demonstrably preserved across configure and remove.
- Preserved-entries list is scoped to the `--servers` set for this run.
- Mismatch detection is scoped to `--servers`: a mismatch on an out-of-scope canonical slot does NOT block configure.
- Dry-run with a mismatch produces per-entry warnings AND the normal diff, no error return.
- Real run with a mismatch and no `--force` fails closed with the aggregated error; no token mint for any tool.
- Shared-PAT warning fires in the two supported cases: canonical-content vs canonical-prompts share; canonical vs non-canonical-at-Tiddly-URL share. (Repurposed-slot case is an accepted limitation.)
- Shared-PAT warning consolidates multiple retained entries into one line per canonical revoke.
- `DeleteTokensByPrefix` deduplicates by PAT internally; tests cover the shared-PAT-fans-out-single-deletion case.
- Non-CLI-token note fires correctly (including for short/garbled PATs).
- Orphan-token warning excludes tokens referenced by retained Tiddly-URL entries.
- `--force` emits `Forcing overwrite of …` to stderr in non-dry-run mode only.
- `tiddly mcp remove` reports `No CLI-managed entries found in <tool>` when no canonical entries exist; token-cleanup path is skipped in that case.
- `tiddly mcp remove` deletes canonical-named entries regardless of URL.
- `AllTiddlyPATs` returns only entries whose URL classifies as a Tiddly URL.
- `ToolHandler.Remove` returns `(*RemoveResult, error)`.
- `DeleteTokensByPrefix` returns one structured `TokenRevokeResult` per input request, preserving entry labels.
- `CheckOrphanedTokens` returns token prefixes.

## Out of scope

- PAT lifecycle semantics beyond what's in `configure.go`.
- URL-based classification — correct as-is, just extended with `OtherServer.URL`.
- Skills — unrelated surface.
- Opt-in "revoke all Tiddly-URL PATs" flag for remove.
- `mcp status` multi-entry grouping.
- A guided CLI flow for removing user-custom non-canonical entries.
- Normalizing the handler-signature asymmetry between `buildClaudeDesktopConfig(configPath, ...)` and the other two.
- Codex deprecated skills path.
- Redesigning the `--delete-tokens` error flow / silent-skip on auth-resolution failure.
- **Repurposed canonical slots** (canonical names at non-Tiddly URLs) participating in shared-PAT warnings or orphan-subtraction. `AllTiddlyPATs` is URL-based and doesn't see these entries. If user reports arise, a follow-up PR can add a URL-agnostic `CanonicalSlotPATs` method and union its output into the retained-set computation.
