# CLI `mcp configure`: Additive Behavior for Non-Canonical Tiddly Entries

**Date:** 2026-04-20
**Status:** Planned
**Breaking change:** Yes — removes the consolidation gate, deletes the `--yes` flag entirely, adds a new `--force` flag on `mcp configure`, changes `mcp remove` default semantics (canonical-name-only, URL-agnostic), and changes two helper signatures (`DeleteTokensByPrefix` and `CheckOrphanedTokens`) to support structured per-entry attribution. Also extends `OtherServer` with a `URL` field and extends `AllTiddlyPATs` semantics to cover canonical-named entries regardless of URL. No backwards-compatibility shims. The CLI is pre-GA; users with scripted `--yes` invocations will see Cobra's "unknown flag" error and should drop the flag.
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
- If a canonical entry exists but points at either a non-Tiddly URL OR the wrong-type Tiddly URL (e.g. `tiddly_prompts` pointing at the content server), configure **fails closed** with an actionable error listing the file path, key name, and current URL. The user can (a) hand-edit to rename the entry, preserving their custom setup, or (b) re-run with `--force` to overwrite with the CLI-managed entry.
- `tiddly mcp configure --force` overrides the canonical-URL-mismatch refusal only. It does NOT override any other safety check (dry-run still previews; token revoke-on-failure still runs; non-canonical entries are still preserved). `--force` applies to every tool in a multi-tool run — a user who wants to force one tool but not another should invoke configure once per tool. There is no short form (`-f` deliberately not registered).
- `tiddly mcp remove` becomes **canonical-name-only, URL-agnostic** by default — deletes `tiddly_notes_bookmarks` / `tiddly_prompts` regardless of what URL they point at. Non-canonical entries (e.g. `work_prompts`) survive. A user who repurposed a canonical key for a non-Tiddly service will see it removed if they run `tiddly mcp remove`; `.bak.<timestamp>` recovery is the safety net.
- `tiddly mcp remove --delete-tokens` only revokes PATs attached to canonical entries. A user's `work_prompts` PAT is not touched.
- When `--delete-tokens` is used and a canonical PAT is **also referenced by another retained entry on disk** (canonical or non-canonical, regardless of URL classification), the CLI warns before revoking — one consolidated line per canonical-entry-being-revoked, listing all retained entries that share the PAT. Revoking breaks those bindings.
- When `--delete-tokens` is used and the PAT on a canonical entry doesn't match any CLI-minted server-side token (name prefix `cli-mcp-`), the CLI prints a note referencing the specific canonical entry so an empty "Deleted tokens:" line isn't confusing.
- `mcp remove` without `--delete-tokens` surfaces an orphan-token warning based on server-side `cli-mcp-*` token names; this list is filtered to exclude tokens whose prefix matches a PAT still referenced by a retained entry on disk, so users don't see "potentially orphaned" warnings for tokens that are still in active use.
- The consolidation gate, Y/N prompt, `ErrConsolidation*` sentinels, and the `--yes` / `-y` flag are all removed entirely. No deprecation shim — pre-GA users with scripted `--yes` invocations will see Cobra's "unknown flag" error and should drop the flag from their scripts.
- After a successful configure, the summary tells the user which non-canonical Tiddly-URL entries were preserved, scoped to the server types managed by this run — so a multi-account user isn't left wondering whether the CLI noticed their other entries.

### What we keep from PR #117

Most of the PR's infrastructure is orthogonal to consolidation and stays:

- Timestamped backup writes with O_EXCL collision handling (`config_io.go`).
- Commit-phase failure revokes already-minted tokens (`revokeMintedTokens`, `withRevokeError`, detached `cleanupCtx`).
- Dry-run Bearer token redaction (`redactBearers`, `bearerRE`).
- `Configure`/`Remove` handler signatures returning `backupPath`. (`Remove` signature is otherwise unchanged from today — no `--force` parameter is added; see Milestone 2.)
- Partial-result contract (`ConfigureResult` surfaces what completed before a mid-run failure).
- `classifyServer` extraction and secondary-sort tiebreaker in `status.go` — needed to render multi-entry state correctly AND used by preflight to detect canonical-key-URL-mismatch cases AND to derive preserved-entries lists (single source of truth). `OtherServer` gains a `URL` field so preflight can produce error messages naming the offending URL.
- `--help` text enumeration of the three supported tools.
- `AllTiddlyPATs` handler method (repurposed AND extended in semantics — see Milestone 2).
- Validate-then-mint fallback (repurposed — applies to the canonical entry only).
- **Preflight `handler.Status` call** (repurposed — see Milestone 1). Its purpose shifts from "read state to detect consolidation" to three concurrent jobs: (1) fail-closed parse probe before any server-side mutation, (2) detect canonical keys pointing at non-Tiddly URLs or wrong-type Tiddly URLs for fail-closed refusal (overridable via `--force`), (3) derive the preserved-non-canonical-entries list for the configure summary. One Status call per tool, three uses.

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

1. **`--delete-tokens` semantics on `mcp remove`** — Canonical-only by default. `tiddly mcp remove claude-code --delete-tokens` revokes PATs from `tiddly_notes_bookmarks` / `tiddly_prompts` only. A user's `work_prompts` PAT is not touched because it wasn't in a CLI-managed entry. **Exception**: when a canonical PAT is also used by another retained entry still on disk, the CLI warns before revoking (revoking would break the other binding). When a canonical entry's PAT doesn't match any CLI-minted server-side token (no `cli-mcp-` prefix match), the CLI prints an informational note referencing the specific entry so the user understands why no revoke happened. No opt-in flag for the old "nuke all Tiddly-URL PATs" behavior — if a user legitimately needs that, it's a follow-up feature.
2. **Status rendering** — Unchanged. `tiddly mcp status` continues to group every Tiddly-URL entry under "Tiddly servers" (canonical + custom). Informational; reflects the user's real setup. The `URL` field addition to `OtherServer` is backward-compatible with existing rendering.
3. **Dry-run output** — No "Consolidation required:" header. The dry-run diff shows only the canonical entry being added or updated; non-canonical entries appear in neither `before` nor `after` as diffs (they're unchanged). When `--force` is passed, the existing diff's `before` block already shows the non-Tiddly URL being overwritten; no additional log line is printed in dry-run mode.
4. **Deprecation / migration path** — None. The CLI is pre-GA; users whose scripts pass `--yes` will see Cobra's "unknown flag" error. Remediation is "drop the flag." Clean break is preferable to a deprecation shim that stops meaning anything after one release.
5. **Obsolete tests** — Delete rather than rework. Listed explicitly in each milestone (test names verified against the file to prevent glob-misses).
6. **`survivorsOfAllTiddlyPATs` helper** — Reduced to "find the canonical entry's PAT, if any." Renamed to `canonicalEntryPATs`. `PATExtraction` collapses to `{ContentPAT, PromptPAT}` (Name fields deleted). The function only walks canonical entries — non-canonical PATs are no longer reuse candidates because `configure` doesn't touch those entries.
7. **Canonical key pointing at the wrong URL** — Fail closed with actionable error, overridable via `--force`. Two detection paths covering distinct sub-cases:
   - Canonical name at a **non-Tiddly URL** (e.g. `tiddly_prompts` → `https://example.com/my-prompts`): detected via `StatusResult.OtherServers` filtered to canonical names.
   - Canonical name at a **wrong-type Tiddly URL** (e.g. `tiddly_prompts` → content server URL): detected via `StatusResult.Servers` filtered to `MatchByName` entries whose `ServerType` doesn't match the expected type for the name.
   Both cases route through the same preflight error and the same `--force` escape hatch. The user has three paths: (a) edit the file to rename the entry and preserve it, (b) re-run with `--force` to overwrite, or (c) abandon the configure. Silent overwrite contradicts the plan's "never destroy user state" premise; `--force` provides the explicit opt-in.
8. **Fail-closed safety on malformed config** — Preserved via the existing preflight `handler.Status(rc)` call. Its consolidation-detection role is removed, but the parse-probe semantics are exactly what we need to prevent a malformed config from proceeding to token mint. Keeping the call is the smallest possible fix — no new code, no new test surface.
9. **Remove semantics for canonical entries with non-Tiddly URLs** — Delete them. `tiddly mcp remove claude-code` uses a canonical-name-only predicate regardless of URL. Rationale: "remove means remove"; the user's request is explicit; `.bak.<timestamp>` provides recovery; the configure-path `--force` escape hatch + remove-path always-delete forms a coherent model (configure protects ambiguous state, remove executes explicit requests). No `--force` flag on remove — it would be semantically empty.
10. **`--force` short form** — None. No `-f` alias. Short forms on destructive operations invite accidental use, and `-f` collides with common short flags elsewhere (`--file`, `--format`). Long-form only.
11. **Preserved-entries list scoping under `--servers`** — Scoped to the server types managed by this run. Under `--servers content`, the preserved list contains only non-canonical entries of `ServerType == ServerContent`. This matches the user's mental model: "under the scope I asked for, these custom entries survived." A canonical prompts entry under `--servers content` is trivially "not modified" but isn't reported — it's simply out of scope for this invocation.
12. **`AllTiddlyPATs` contract extension** — Includes entries where (URL classifies as a Tiddly URL) OR (key name is canonical), regardless of the URL. For canonical-named entries at non-Tiddly URLs, `ServerType` is inferred from the name (`tiddly_notes_bookmarks` → `ServerContent`, `tiddly_prompts` → `ServerPrompts`). This is required for correct shared-PAT warnings and orphan-token subtraction when a user has manually repurposed a canonical slot — the machinery needs to see these entries to warn before revoking a shared PAT.

---

## Architectural decision: refactor in place, don't revert

We keep commit `3d7a1b1` and surgically remove the consolidation layer. Rationale:

- The KEEP set touches every file in the PR. A revert-and-cherry-pick reapplies ~70% of the diff by hand.
- Signature changes (`Configure`/`Remove` → `backupPath`; `PATExtraction`) ripple through all three handlers and their tests.
- The `classifyServer` extraction and status secondary-sort tiebreaker are dependencies of "render multi-entry state correctly" — which the new request explicitly keeps.

---

## Reference reading for the agent

Before implementing, read these files to understand current structure and what's being removed:

- `cli/internal/mcp/configure.go` — focus on `RunConfigure`, `preflightedTool`, `confirmConsolidations`, `resolveToolPATs`, `resolveServerPAT`, the preflight `handler.Status` call, and the two helpers whose signatures are changing: `DeleteTokensByPrefix` (around line 564) and `CheckOrphanedTokens` (around line 625).
- `cli/internal/mcp/consolidation.go` — entire file (being deleted).
- `cli/internal/mcp/prompt.go` — entire file (being deleted).
- `cli/internal/mcp/handler.go` — `TiddlyPAT`, `PATExtraction`, `ToolHandler` interface, `survivorsOfAllTiddlyPATs`, and the `AllTiddlyPATs` method's doc comment and contract.
- `cli/internal/mcp/status.go` — `classifyServer`, `StatusResult`, `MatchByName` / `MatchByURL`, `OtherServer` (gains a URL field). Preflight leans on these heavily after the refactor.
- `cli/internal/mcp/claude_code.go`, `claude_desktop.go`, `codex.go` — `extractAll*TiddlyPATs` and `extract*PATs` pairs (contract extends to include canonical-named entries regardless of URL), plus the `removeJSONServersByTiddlyURL` / `removeCodexServersByTiddlyURL` call inside each `build*Config`.
- `cli/cmd/mcp.go` — `newMCPConfigureCmd`, `newMCPRemoveCmd`, `translateConfigureError`, `--yes` flag wiring, and the two `Long:` strings at lines 62-85 and 301-319 whose URL-based-replace wording contradicts the new contract. Also the PAT-collection block around line 372 and the orphan-token warning emission around line 440.
- `cli/agent_testing_procedure.md` — Phase 4 overall shape (understand what's being deleted), Phase 1–3 to preserve, the scattered `--yes` / consolidation references at lines 3, 954-955, 1015, 1017, and **T8.4/T8.5 at lines 2228-2238** (these intentionally invoke `--scope local` and `--scope project` to verify rejection; do not alter them under the `--scope local` sweep).
- `frontend/src/pages/docs/DocsCLIMCP.tsx` — current docs state, specifically the "Server Identification" block at lines 124-141 whose URL-based "replace on configure / remove by URL" prose contradicts the new additive contract.
- `docs/ai-integration.md` — line 108 has `--scope local` as part of a legitimate Tiddly→Claude Code scope-mapping table. The `--scope local` reference is describing Claude Code's own flag, not Tiddly's. Preserve the cross-reference; don't blanket-delete.
- `frontend/src/components/AISetupWidget.tsx` — the `getAffectedFiles` Claude Code description around line 431 (already edited on-branch to switch `--scope local` → `--scope directory`; see Milestone 3).

No external documentation URLs apply to this change.

---

## Agent behavior (global)

- Complete each milestone fully (code + tests + docs) before moving to the next. Stop and request human review at the end of each milestone.
- Run `make cli-verify` at the end of every milestone; it must pass before proceeding. Every milestone boundary leaves the tree green — no deliberately-broken intermediate checkpoints.
- Ask for clarification when requirements are ambiguous. Do not assume.
- Remove legacy code rather than leaving dead paths. Breaking changes are acceptable.
- Prefer deleting obsolete tests outright over reworking them into something weaker.
- Type hints and clear naming as per `cli/` Go conventions already in use.
- When the plan references line numbers, treat them as anchors that may have drifted by a few lines — always locate the right code by the surrounding function names and comments, not line number alone.

---

## Milestones

### Milestone 1 — Additive `configure` (consolidation removed; `--force` added; preflight URL-mismatch detection)

**Goal & outcome:**
`tiddly mcp configure` writes only canonical entries and leaves non-canonical Tiddly-URL entries untouched. Consolidation module, prompt helper, and the gate are all removed. The preflight `handler.Status` call is preserved and now serves three purposes: fail-closed parse probe, canonical-URL-mismatch detection (both non-Tiddly URLs and wrong-type Tiddly URLs), and preserved-entries derivation. `--force` overrides the canonical-URL-mismatch refusal only. Validate-then-mint on the canonical entry's PAT is preserved. The configure summary lists preserved non-canonical entries (scoped to the server types managed by this run).

- `configure` run with pre-existing `work_prompts` + `personal_prompts` → those entries survive unchanged; canonical entries are added/updated; summary lists `work_prompts` and `personal_prompts` as preserved.
- `configure --servers content` with non-canonical `work_content` + `work_prompts` present → canonical content written, canonical prompts untouched (out of scope), summary lists only `work_content` (the in-scope preserved entry).
- `configure --servers content` when canonical `tiddly_prompts` exists → `tiddly_prompts` is structurally preserved (re-parse and compare as maps).
- `configure` re-run when canonical is already present at the correct Tiddly URL → canonical updated in place (same validate-then-mint); non-canonical untouched.
- `configure` run when canonical `tiddly_prompts` exists but its URL is not a Tiddly URL → configure exits non-zero with an actionable error naming the file path, key name, and current URL. **No server-side token mint happens.**
- `configure` run when canonical `tiddly_prompts` exists but points at the **content** Tiddly URL (cross-wired) → same fail-closed behavior, same error format. No mint.
- `configure --force` with either mismatch type → proceeds; prints `Forcing overwrite of tiddly_prompts (currently <url>)` to stderr (non-dry-run only); writes the CLI-managed entry.
- `configure --dry-run --force` → preview only; the diff's `before` block shows the mismatched URL being overwritten. No additional stderr log line (would be redundant with the diff).
- Dry-run output shows only the canonical-entry diff; no "Consolidation required:" header.
- Commit-phase token revoke-on-failure behavior from PR #117 preserved.
- A malformed config file causes configure to fail closed in preflight, before any server-side token mint.
- `--yes` is deleted; passing it produces Cobra's "unknown flag" error.
- `make cli-verify` passes at the milestone boundary.

**Sample output (multi-account user running configure against Claude Code):**

```
$ tiddly mcp configure claude-code
Created tokens: cli-mcp-claude-code-content-abc123, cli-mcp-claude-code-prompts-def456
Configured: claude-code
Backed up claude-code config to /Users/alice/.claude.json.bak.2026-04-20T14-33-02Z
Preserved non-CLI-managed entries in claude-code: work_prompts, personal_prompts
```

**Sample output (fail-closed with canonical-URL mismatch, no `--force`):**

```
$ tiddly mcp configure claude-code
Error: 1 canonical entry in /Users/alice/.claude.json points at a non-Tiddly URL:
  - tiddly_prompts → https://example.com/my-prompts

Options:
  - Preserve it: edit the file to rename the entry, then re-run.
  - Replace it:  re-run with --force.
```

Pluralizes to "N canonical entries" when multiple are mismatched (e.g. both canonical names cross-wired or at non-Tiddly URLs). Each offending entry is listed on its own bullet.

**Implementation outline:**

1. **Delete files:** `cli/internal/mcp/consolidation.go`, `consolidation_test.go`, `prompt.go`, `prompt_test.go`.

2. **`status.go`**: add `URL string` field to the `OtherServer` struct. Update `classifyServer`'s default branch from `&OtherServer{Name: name, Transport: transport}` to `&OtherServer{Name: name, URL: urlStr, Transport: transport}`. No changes needed in the three per-handler status builders — they already route through `classifyServer`. The existing `tiddly mcp status` rendering doesn't print the `OtherServer.URL`; backward-compatible addition.

3. **`configure.go`**:
   - Delete `ErrConsolidationDeclined`, `ErrConsolidationNeedsConfirmation`.
   - Remove `ConfigureOpts.AssumeYes`, `.Stdin`, `.IsInteractive`. Add `ConfigureOpts.Force bool`.
   - Remove `preflightedTool.consolidations` field. Add `preflightedTool.preservedNames []string` (derived from the preflight Status result; see below) and `preflightedTool.forceOverwrites []canonicalMismatch` (populated when `opts.Force` is true and mismatches exist, used for the stderr overwrite log).
   - Remove `anyConsolidations`, `confirmConsolidations` functions and the Phase 2 gate call site.
   - **Keep the preflight `handler.Status(rc)` call**. Its new role is threefold:
     1. **Parse probe / fail-closed.** Existing dry-run-tolerant vs. real-run fail-closed branching stays — a read error on a real run still aborts before any mint.
     2. **Canonical-URL-mismatch detection.** After a successful Status, build a `canonicalMismatch {Name, URL string}` list from two sources:
        - `sr.OtherServers` entries whose `Name == serverNameContent || Name == serverNamePrompts` — these are canonical names at non-Tiddly URLs. The URL comes from the new `OtherServer.URL` field.
        - `sr.Servers` entries where `MatchMethod == MatchByName` AND the `ServerType` doesn't match the name's expected type — `tiddly_notes_bookmarks` expects `ServerContent`; `tiddly_prompts` expects `ServerPrompts`. These are cross-wired canonical entries (canonical name at the wrong-type Tiddly URL).
        
        If the combined list is non-empty AND `opts.Force` is false, return the preflight error formatted as shown in the "Sample output" block — before `resolveToolPATs` is called, so no server-side token mint happens. If `opts.Force` is true, stash the list on `preflightedTool.forceOverwrites` for the commit loop to log.
     3. **Preserved-entries derivation.** Filter `sr.Servers` to entries where `MatchMethod == MatchByURL` AND `ServerType` is in the requested `--servers` set (or all types if no `--servers` filter). Those are non-canonical-named entries of in-scope server types whose URLs classify as Tiddly — the user's custom entries that this run leaves alone. Stash their names (sorted) on `preflightedTool.preservedNames`.
   - In the commit loop, delete the `if len(pf.consolidations) > 0 { writeConsolidationWarning(...) }` branch in the dry-run output block and the "Consolidation required:" header emission in both paths.
   - In the commit loop, after successful `handler.Configure`, copy `pf.preservedNames` into `result.PreservedEntries[pf.tool.Name]`.
   - **Force-overwrite stderr log.** Non-dry-run runs with `opts.Force == true` and a non-empty `pf.forceOverwrites` list emit one line per overwritten entry to `opts.ErrOutput` BEFORE `handler.Configure` is called: `Forcing overwrite of <key> (currently <url>)`. Dry-run runs do NOT emit this — the diff's `before` block already shows it. The log fires before `handler.Configure`; if a later commit-phase step fails, the end-of-run error disambiguates and the earlier log line remains accurate as a statement of attempted intent.
   - **Delete `tiddlyURLMatcher`** (function at configure.go:25-38). The function has no non-test users once step 4 below removes the three `build*Config` callers. Matching `TestTiddlyURLMatcher__*` tests in `configure_test.go` are also deleted.
   - **Change `DeleteTokensByPrefix` signature** (called from `cmd/mcp.go`, spec'd here for M1 staging but the caller change lands in M2):
   
     ```go
     // TokenRevokeRequest is one (label, PAT) tuple to revoke against. The label
     // is a free-form caller-owned string used for attribution in the result —
     // typically a canonical config-entry name like "tiddly_prompts".
     type TokenRevokeRequest struct {
         EntryLabel string
         PAT        string
     }
     
     // TokenRevokeResult is one per-request outcome. DeletedNames holds the
     // cli-mcp-*-named server-side tokens that were actually revoked for the
     // request's PAT (empty slice if nothing matched — caller uses this to emit
     // per-entry "no CLI-created token matched" notes). Err is non-nil if the
     // per-PAT revoke hit a network or server error after list-tokens already
     // succeeded.
     //
     // For PATs shorter than tokenPrefixLen, DeletedNames is empty and Err is
     // nil — the short-PAT case is treated as "nothing matched," so the caller
     // still emits the note consistently for garbled-PAT entries.
     type TokenRevokeResult struct {
         EntryLabel   string
         DeletedNames []string
         Err          error
     }
     
     // DeleteTokensByPrefix revokes server-side tokens matching any request PAT
     // and the cli-mcp- name prefix. Returns one result per input request,
     // preserving order and labels. The top-level error covers only list-tokens
     // failure; per-request errors are surfaced inside the individual results.
     func DeleteTokensByPrefix(ctx context.Context, client *api.Client, reqs []TokenRevokeRequest) ([]TokenRevokeResult, error)
     ```
   - **Change `CheckOrphanedTokens` return type** to `[]api.TokenInfo` (or a minimal `{Name, TokenPrefix}` struct) so the caller can cross-reference prefixes against retained PATs. Doc comment updated: the function returns server-side tokens matching the `cli-mcp-{tool}-{serverType}-` name pattern; the caller is responsible for filtering against retained PATs.
   - Keep: `resolveToolPATs`, `resolveServerPAT` (validate-then-mint), `mintedToken`, `toolPATResolution`, `withRevokeError`, `revokeMintedTokens`, `cleanupTimeout`, `redactBearers`, `printDiff`, `BackupRecord`.
   - Add `ConfigureResult.PreservedEntries` — `map[string][]string` keyed by tool name, value is sorted slice of non-canonical Tiddly-URL entry names (scoped to `--servers`). `printConfigureSummary` emits one line per tool with preserved entries: `Preserved non-CLI-managed entries in <tool>: <name1>, <name2>`.

4. **`handler.go`**:
   - Collapse `PATExtraction` to `{ContentPAT, PromptPAT}` — delete the two `Name` fields.
   - Rename `survivorsOfAllTiddlyPATs` → `canonicalEntryPATs`. Semantics change: only match canonical-named entries. Doc comment:
   
     ```go
     // canonicalEntryPATs extracts the Bearer tokens from entries whose config
     // key matches the canonical names (tiddly_notes_bookmarks, tiddly_prompts).
     // Non-canonical Tiddly-URL entries (e.g. work_prompts) are deliberately
     // excluded — configure never touches them, so their PATs are not reuse
     // candidates.
     func canonicalEntryPATs(all []TiddlyPAT) PATExtraction { /* ... */ }
     ```
   
   - **Extend `AllTiddlyPATs` contract**. Semantics: returns entries where (URL classifies as a Tiddly URL) OR (key name is canonical — `tiddly_notes_bookmarks` or `tiddly_prompts`). For canonical-named entries at non-Tiddly URLs, `ServerType` is inferred from the name: `tiddly_notes_bookmarks` → `ServerContent`, `tiddly_prompts` → `ServerPrompts`. Entries without an extractable PAT are still filtered out.

     Updated doc comment:
     
     ```go
     // AllTiddlyPATs returns every extractable Bearer token in the tool's
     // config from entries that either (a) point at a Tiddly URL, or (b)
     // occupy a canonical config slot (key name tiddly_notes_bookmarks or
     // tiddly_prompts, regardless of what URL they point at). For (b), the
     // ServerType field is inferred from the canonical name. Returned in
     // canonical-first order.
     //
     // Used by `remove --delete-tokens`: the canonical subset supplies revoke
     // targets, and the full set (canonical + non-canonical + canonical-at-
     // wrong-URL) is consulted to warn when a revoke would break any still-
     // configured binding. Also used by the orphan-token subtraction so
     // tokens attached to retained entries are not misreported as orphaned.
     AllTiddlyPATs(rc ResolvedConfig) []TiddlyPAT
     ```
   
   - **Do NOT add a `NonCanonicalTiddlyEntries` interface method.** The earlier draft proposed one; it duplicates `classifyServer` logic. Preserved-entries derivation reuses `StatusResult.Servers` filtered to `MatchByURL` (see configure.go step).

5. **Per-handler files (`claude_code.go`, `claude_desktop.go`, `codex.go`)**:
   - Extend `extractAll*TiddlyPATs` implementations to match the new `AllTiddlyPATs` contract: in each handler's walk, include canonical-named entries regardless of URL classification, tagging `ServerType` from the name. Entries without an extractable PAT still filter out. The existing per-handler PAT extraction code (Authorization header for Claude Code/Codex; `--header` arg for Claude Desktop) is reused unchanged — the only change is the gating condition.
   - `extract*PATs` survivor variants derive from `canonicalEntryPATs` (renamed from `survivorsOfAllTiddlyPATs`). They now return PATs only from canonical-named entries — this logic was already correct; just the function rename.
   - **Delete the URL-based removal call inside each build path:**
     - `claude_code.go` around line 190 — remove the `removeJSONServersByTiddlyURL(servers, tiddlyURLMatcher(...))` line from `buildClaudeCodeConfig`.
     - `claude_desktop.go` around line 60 — remove the same call from `buildClaudeDesktopConfig`.
     - `codex.go` around line 89 — remove `removeCodexServersByTiddlyURL(...)` from `buildCodexConfig`.

     **Rationale:** Go map assignment (`servers[serverNameContent] = ...`) overwrites the canonical key in place regardless of whether it pre-existed. Non-canonical entries are never referenced by that assignment and survive by default. The removal helpers themselves (`removeJSONServersByTiddlyURL`, `removeCodexServersByTiddlyURL`) stay — they're still used by the Remove path in Milestone 2.
   - **Do NOT add canonical-URL validation in `build*Config`.** The check lives in preflight (step 3).
   - `Remove` path changes deferred to Milestone 2.

6. **`cmd/mcp.go` — `--yes` flag removal and `--force` flag addition**:
   - Delete the `cmd.Flags().BoolVarP(&assumeYes, "yes", "y", ...)` registration, the `assumeYes` local variable, and the `AssumeYes: assumeYes` field in the `opts` literal. Users passing `--yes` get Cobra's "unknown flag" error.
   - Add `--force` flag on `newMCPConfigureCmd`: `cmd.Flags().BoolVar(&force, "force", false, "Overwrite canonical entries that point at non-Tiddly URLs or wrong-type Tiddly URLs")`. Long-form only — do NOT register `-f`.
   - Plumb to `ConfigureOpts.Force`.
   - Update the configure `Long:` string to document `--force` (separate from the URL-replace rewrite in Milestone 3): "Use `--force` to overwrite a canonical entry (`tiddly_notes_bookmarks` or `tiddly_prompts`) whose URL doesn't match the expected Tiddly URL for that type."

**Testing strategy (`configure_test.go`):**

- **Delete** (verified names against current file):
  - `TestRunConfigure__consolidation_prompt_proceeds_on_yes` (line ~1174)
  - `TestRunConfigure__consolidation_prompt_aborts_on_no` (line ~1208)
  - `TestRunConfigure__consolidation_non_interactive_errors_without_yes` (line ~1238)
  - `TestRunConfigure__declining_before_writes_creates_no_server_tokens` (line ~1266) — real name has no `consolidation_` prefix
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
  - **`TestRunConfigure__status_error_aborts_non_dry_run`** — the preflight Status call is preserved.
  - `TestRunConfigure__malformed_config_returns_parse_error` (if present).
  - `TestRevokeMintedTokens__*`.
- **Add (core of the behavior change):**
  - `TestRunConfigure__additive_preserves_non_canonical_tiddly_entries` (per handler): configure with pre-existing `work_prompts` + `personal_prompts`. Assert structural equality post-run. Canonical entries added.
  - `TestRunConfigure__reuses_canonical_pat_when_valid`
  - `TestRunConfigure__mints_fresh_when_canonical_pat_invalid`
  - `TestRunConfigure__does_not_reuse_pat_from_non_canonical_entry`
  - `TestRunConfigure__dry_run_shows_only_canonical_diff`: with non-canonical entries present, assert the dry-run output does not show `work_prompts` as a *changed or removed* line. The key may appear identically in both `before` and `after` blocks — that's expected and correct; the failing case is a deletion or modification line, not an unchanged one.
  - `TestRunConfigure__servers_content_leaves_canonical_prompts_structurally_preserved`
  - `TestRunConfigure__refuses_to_overwrite_canonical_key_with_non_tiddly_url`: pre-existing `tiddly_prompts` at `https://example.com/whatever`. Assert error is non-nil, message contains file path + key name + current URL, **`opts.Client.CreateToken` was NOT called** (fail-before-mint), no config write happened.
  - `TestRunConfigure__refuses_when_canonical_name_has_wrong_type_tiddly_url`: `tiddly_prompts` at the content Tiddly URL (cross-wired). Same assertions as the non-Tiddly case — same fail-closed code path.
  - `TestRunConfigure__force_overwrites_canonical_with_non_tiddly_url` (per handler): same setup with `opts.Force = true`. Assert configure succeeds, CLI-managed entry written, stderr contains `Forcing overwrite of tiddly_prompts (currently https://example.com/whatever)`.
  - `TestRunConfigure__force_overwrites_cross_wired_canonical`: `tiddly_prompts` at content URL, `Force = true`. Assert configure writes the CLI-managed entry at the prompts URL, stderr log names the prior content URL.
  - `TestRunConfigure__force_with_dry_run_shows_overwrite_in_diff_without_stderr_log`
  - `TestRunConfigure__force_is_no_op_when_no_canonical_url_mismatch`
  - `TestRunConfigure__reports_preserved_non_canonical_entries`
  - `TestRunConfigure__preserved_entries_scoped_to_requested_servers`: two non-canonical entries (`work_content` at content URL, `work_prompts` at prompts URL). Run `configure --servers content`. Assert `PreservedEntries["claude-code"]` lists only `work_content`.
  - `TestRunConfigure__preserves_non_canonical_entry_with_malformed_authorization`: derivation walks `StatusResult.Servers` (URL-based, doesn't inspect headers), so malformed-auth entries still appear.
- **Per-handler tests**:
  - Remove tests asserting `Configure` deletes non-canonical Tiddly-URL entries.
  - Add a direct handler-level test for each: given a canonical + non-canonical Tiddly-URL entry + unrelated non-Tiddly entries, `Configure` preserves the non-canonical Tiddly entry and the unrelated entries structurally.
  - `ExtractPATs` tests: update for `{ContentPAT, PromptPAT}` only and canonical-name-only semantics.
  - `AllTiddlyPATs` tests: add cases for canonical entries at non-Tiddly URLs and wrong-type Tiddly URLs — assert they appear in the result with ServerType inferred from name.

**Docs:** None in this milestone — CLI help and doc pages update in Milestone 3.

---

### Milestone 2 — Canonical-name-only `mcp remove` (+ structured `--delete-tokens` reporting)

**Goal & outcome:**
`tiddly mcp remove` deletes canonical-named entries (`tiddly_notes_bookmarks` / `tiddly_prompts`) regardless of URL. Non-canonical entries survive. `--delete-tokens` revokes only PATs attached to canonical entries, warns before revoking a PAT also referenced by any retained entry on disk (canonical or non-canonical, regardless of URL classification), and emits a per-entry note when a canonical PAT doesn't match any CLI-minted server-side token. Orphan-token warning (no `--delete-tokens`) is filtered to exclude tokens whose prefix matches a retained PAT.

- `tiddly mcp remove claude-code` with canonical + non-canonical entries present → canonical removed, non-canonical structurally preserved.
- `tiddly mcp remove claude-code` when canonical `tiddly_prompts` points at a non-Tiddly URL → canonical entry deleted. `.bak.<timestamp>` provides recovery.
- `tiddly mcp remove claude-code --delete-tokens` → revokes PATs for canonical entries only.
- **`tiddly mcp remove claude-code --delete-tokens` when canonical `tiddly_prompts` PAT equals non-canonical `work_prompts` PAT** → consolidated warning fires: `Warning: token from tiddly_prompts is also used by work_prompts (still configured); revoking will break those bindings.` Single line, retained names comma-joined.
- **`tiddly mcp remove claude-code --servers content --delete-tokens` when canonical `tiddly_prompts` has a non-Tiddly URL and shares a PAT with canonical `tiddly_notes_bookmarks`** → consolidated warning fires naming `tiddly_prompts` as a retained binding (even though its URL is non-Tiddly). This is the edge case that motivated the extended `AllTiddlyPATs` contract.
- **`tiddly mcp remove claude-code --delete-tokens` when the canonical entry's PAT doesn't match any `cli-mcp-*` server-side token** → `Note: no CLI-created token matched the token attached to tiddly_prompts; nothing was revoked. Manage tokens at https://tiddly.me/settings.` One note per affected canonical entry.
- Orphan-token warning (`mcp remove` without `--delete-tokens`) excludes tokens whose prefix matches a PAT still referenced by a retained entry on disk — no more misleading "potentially orphaned" on tokens in active use by non-canonical entries.

**Implementation outline:**

1. **Per-handler `Remove` method**: change the deletion predicate from "any entry matching a Tiddly URL" to **"entry whose key name is canonical"** — URL-agnostic. The belt-and-suspenders URL check from the pre-plan code is removed: `.bak.<timestamp>` covers accidental destruction. For `--servers content` / `--servers prompts`, filter by canonical name for the requested type. `ToolHandler.Remove` signature UNCHANGED — no `force` parameter is added.

2. **`cmd/mcp.go` — `newMCPRemoveCmd` rewrite**:
   - No new flag. Surface unchanged except for semantic shift.
   - **PAT collection**. Build two sets:
     1. **Revoke targets**: iterate canonical entries via `canonicalEntryPATs` (or an inline canonical-name filter over `AllTiddlyPATs`), filtered to server types being removed by this invocation (`--servers`). Each target is a `TokenRevokeRequest{EntryLabel: <canonical-name>, PAT: <pat>}`. Dedup is handled downstream by the structured return — duplicate PATs produce one request per canonical entry, so per-entry notes fire correctly.
     2. **Retained PATs after write**: pre-compute via `handler.AllTiddlyPATs(rc)` — which (post-Milestone-1 contract extension) includes canonical and non-canonical entries, with canonical entries covered regardless of URL classification. Then **subtract the canonical entries that this invocation is about to delete** (by name) to produce the retained set. Rationale: the user's intent is "remove these specific canonical entries"; anything else that's still on disk after remove is retained. This subtraction avoids a second `handler.Status` re-read after `handler.Remove` — we already know what we're about to delete.
   - **Shared-PAT warning**. For each revoke target, collect retained entries whose PAT equals the target's PAT. If any matches, emit ONE line per canonical-entry-being-revoked, listing all matching retained entry names alphabetically: `Warning: token from <canonical-name> is also used by <retained-name-1>, <retained-name-2>, ... (still configured); revoking will break those bindings.`
   - **Call revoke helper**. `results, err := mcp.DeleteTokensByPrefix(cmd.Context(), client, reqs)`. Handle top-level `err` (list-tokens failure) as a soft warning matching today's behavior.
   - **Per-entry note derivation**. For each result with empty `DeletedNames` and nil `Err`: `Note: no CLI-created token matched the token attached to <EntryLabel>; nothing was revoked. Manage tokens at https://tiddly.me/settings.`
   - **Successful deletions**. Dedupe `DeletedNames` across all results, join with commas for the `Deleted tokens:` line as before.
   - **Per-entry errors**. For each result with non-nil `Err`, surface as a per-entry warning.
   - The existing "Warning: token is shared with X server (still configured)" message is superseded by the consolidated shared-PAT warning above.

3. **Orphan-token warning filtering** (no `--delete-tokens` path, `cmd/mcp.go` around line 440):
   - `CheckOrphanedTokens` now returns token `{Name, TokenPrefix}` pairs. Compute retained-PAT prefixes from pre-remove `handler.AllTiddlyPATs(rc)` minus the canonical entries being deleted (same subtraction as step 2). Filter the orphan candidate set to exclude any token whose `TokenPrefix` is in the retained-prefix set. Emit the orphan warning only for the filtered result.
   - The function's doc comment gains: the caller is responsible for subtracting retained PATs; raw output is "server-side tokens matching the name pattern," not "orphaned tokens."

4. **`AllTiddlyPATs` contract stays as extended in Milestone 1**. This method is the single source of truth for "PATs that matter to remove" — canonical and non-canonical entries, with canonical entries included regardless of URL classification (that's precisely what the M2 edge cases need).

5. **`CheckOrphanedTokens`** — signature change from `[]string` to `[]api.TokenInfo` (or equivalent `{Name, TokenPrefix}` struct). Doc comment notes:

   ```go
   // NOTE: Returns server-side tokens matching the cli-mcp-{tool}-{serverType}-
   // name pattern. The caller must subtract tokens whose TokenPrefix matches
   // a PAT still referenced by a retained entry on disk before presenting
   // the result as "potentially orphaned" — otherwise tokens in active use
   // by non-canonical entries would be misreported.
   ```

**Testing strategy (`cmd/mcp_test.go` and per-handler tests):**

- **Delete:** `TestTranslateConfigureError__*` (all four).
- **Modify:**
  - `TestMCPRemove__delete_tokens_multi_entry_revokes_all` → rename to `..._revokes_canonical_only`; assert non-canonical PATs are NOT in the DELETE set.
  - Any test using the old `DeleteTokensByPrefix([]string)` signature → update to `[]TokenRevokeRequest` input and iterate the structured result.
- **Keep:**
  - `TestMCPRemove__delete_tokens_dedups_shared_pat` (update to structured form; canonical content + canonical prompts sharing a PAT still produces correct behavior).
  - `TestMCPConfigure__dry_run_surfaces_pat_auth_warning`.
- **Add:**
  - `TestMCPRemove__preserves_non_canonical_entries` (per handler).
  - `TestMCPRemove__deletes_canonical_entry_with_non_tiddly_url` (per handler): canonical `tiddly_prompts` at `https://example.com/foo` → deleted, backup created. Regression guard against re-introducing the URL check.
  - `TestMCPRemove__delete_tokens_ignores_non_canonical_pats`.
  - `TestMCPRemove__shared_pat_warning_fires_on_canonical_split`.
  - `TestMCPRemove__shared_pat_warning_fires_when_non_canonical_retains_pat`: canonical + non-canonical share a PAT, `--delete-tokens`, assert warning fires (critical correctness test).
  - `TestMCPRemove__shared_pat_warning_fires_when_retained_canonical_has_non_tiddly_url`: canonical `tiddly_prompts` at non-Tiddly URL, canonical `tiddly_notes_bookmarks` at content Tiddly URL, both share a PAT, `--servers content --delete-tokens` → warning fires naming `tiddly_prompts` as retained. Locks in the extended `AllTiddlyPATs` contract.
  - `TestMCPRemove__shared_pat_warning_consolidates_multiple_retained_entries`: one canonical PAT matches three non-canonical entries → one warning line listing all three names comma-separated.
  - `TestMCPRemove__no_warning_when_no_retained_pat_shares`.
  - `TestMCPRemove__servers_prompts_only_warns_when_retained_content_shares_pat`.
  - `TestMCPRemove__non_cli_token_note_fires_per_unmatched_entry`: two canonical entries, one with user-pasted PAT, one with CLI-minted PAT → one note + one "Deleted tokens" line.
  - `TestMCPRemove__non_cli_token_note_fires_once_per_entry`: one canonical with user-pasted PAT → one note.
  - `TestMCPRemove__non_cli_token_note_fires_for_short_or_garbled_pat`: canonical entry with a PAT shorter than `tokenPrefixLen` → note fires (DeletedNames empty, Err nil).
  - `TestMCPRemove__non_cli_token_note_does_not_fire_for_cli_tokens`.
  - `TestMCPRemove__orphan_warning_excludes_tokens_used_by_non_canonical_entries`: user has canonical `tiddly_prompts` with CLI-minted token AND pasted the same CLI-minted PAT under `work_prompts`. Run `remove` (no `--delete-tokens`). Assert no orphan warning fires for that token.
  - `TestMCPRemove__orphan_warning_fires_for_unreferenced_cli_tokens`: canonical CLI-minted token with no retained reference → warning fires.

**Docs:** None in this milestone.

---

### Milestone 3 — CLI help, docs, and E2E test plan cleanup

**Goal & outcome:**
User-visible surface (help text, docs, test plan doc, frontend widget) reflects the additive semantics. No references to consolidation, `--yes`, or the Y/N prompt remain in user-facing copy. The new `--force` flag is documented. Tiddly-facing `--scope` vocabulary is consistent. Users of multi-account setups have clear documentation for both preserve-by-default behavior and manual cleanup of custom entries.

- `tiddly mcp configure --help` and `tiddly mcp remove --help` accurately describe additive behavior; configure help documents `--force`.
- `frontend/src/pages/docs/DocsCLIMCP.tsx` explains the additive contract, documents `--force`, and includes a FAQ-style block for multi-account users.
- `frontend/src/components/AISetupWidget.tsx` references current Tiddly-facing `--scope` vocabulary.
- `cli/agent_testing_procedure.md` Phase 4 is removed; scattered `--yes`/consolidation references in Phase 1/3 are cleaned up; T8.4/T8.5 preserved intact.
- User-facing copy avoids "canonical" — uses "CLI-managed entries" or names the keys directly.

**Implementation outline:**

1. **`cmd/mcp.go` — Long strings**:
   - `newMCPConfigureCmd` Long string: remove the paragraph about consolidation and `--yes`. Rewrite the second paragraph:

     > Configure writes two CLI-managed entries: `tiddly_notes_bookmarks` (content server) and `tiddly_prompts` (prompt server). These are the only entries the CLI creates or modifies. If you have other entries pointing at Tiddly URLs under different names (for example, `work_prompts` and `personal_prompts` for multiple accounts), configure leaves them alone — it doesn't claim ownership of entries you created yourself. After a run, configure lists any preserved non-CLI-managed entries so you can see what was left unchanged.
     >
     > If a CLI-managed entry already exists but points at a URL that's not the expected Tiddly URL for its type (for example, you repurposed `tiddly_prompts` for a local dev server, or `tiddly_prompts` accidentally points at the content URL), configure refuses by default and tells you which entry is mismatched. Either rename the entry in the config file to preserve it, or re-run with `--force` to overwrite.

   - Remove `translateConfigureError` and its call site in `RunE`; the call site becomes `return err`. Remove the `errors` import if no other code uses it (grep first).
   - `--yes` is already deleted in Milestone 1.
   - `--force` is registered in Milestone 1; confirm it appears in `--help` output with a clear description.
   - `newMCPRemoveCmd` Long string: replace the URL-based paragraph with:

     > Remove deletes the CLI-managed entries (`tiddly_notes_bookmarks`, `tiddly_prompts`) from the tool's config file. Other entries pointing at Tiddly URLs under different names are preserved. A canonical-named entry is removed regardless of what URL it points at. The prior config is saved to `<path>.bak.<timestamp>` before the write.
     >
     > With `--delete-tokens`, only the PATs attached to CLI-managed entries are revoked; PATs used by preserved entries are left alone. If a CLI-managed PAT is also referenced by a preserved entry, the CLI warns before revoking. If a CLI-managed entry's PAT doesn't match any CLI-created server-side token, the CLI prints an informational note referencing that entry.

2. **`frontend/src/pages/docs/DocsCLIMCP.tsx`**:
   - **Rewrite the "Server Identification" section** at lines 124-141:

     > The CLI writes two managed entries: `tiddly_notes_bookmarks` (content server) and `tiddly_prompts` (prompt server). These are the only entries `configure` and `remove` touch.
     >
     > If you run multiple Tiddly accounts in one tool — for example, `work_prompts` and `personal_prompts` both pointing at the Tiddly prompt server with different tokens — the CLI leaves those entries alone. You can run `configure` safely on a multi-account setup; the CLI updates its own two entries and reports which of your custom entries it preserved.
     >
     > If a CLI-managed entry already exists but points at a URL that's not the expected Tiddly URL for its type, `configure` refuses by default and asks you to either rename the entry or re-run with `--force` to overwrite. `remove` always deletes CLI-managed entries regardless of URL — use this if you want to clear a repurposed slot.
     >
     > `status` still recognizes any entry pointing at a Tiddly URL regardless of key name, so you can see the full picture of what's configured.

   - **Add `--force` to the Flags table**: new row with description "Overwrite CLI-managed entries that point at URLs not matching the expected Tiddly URL for their type."
   - **Add a short FAQ-style block** titled "I have multiple Tiddly entries — what happens on configure?".
   - Replace any lingering use of the word "canonical" in user-facing text.

3. **`frontend/src/components/AISetupWidget.tsx`**:
   - `--scope local` → `--scope directory` description change around line 431. Already edited on-branch; keep.

4. **`cli/agent_testing_procedure.md`**:
   - Delete entirely: Phase 4 and T4.1, T4.2, T4.4, T4.8, T4.8b, T4.9, T4.9b, T4.10, T4.11.
   - Edit line 3, lines 954-955, line 1015, line 1017 per prior version of this plan. Add `--force` to the flag-list check (replacing `--yes`).
   - Keep T4.6, T4.7 (reframe), T5.4.
   - Rewrite T6.8, T6.8b, T6.8c, T6.8d for canonical-only `--delete-tokens` semantics. Add sub-tests for: shared-PAT warning, non-CLI-token note, orphan-warning filter against retained PATs.
   - Do NOT modify T8.4/T8.5.
   - Add five E2E tests to Phase 3: additive preservation, canonical update-in-place, fail-closed on URL mismatch (both types), `--force` overwrite, canonical-only remove with `--delete-tokens` warnings.

5. **Project-level docs audit** per `AGENTS.md` "Files to Keep in Sync":
   - Search `README.md`, `frontend/public/llms.txt`, `frontend/src/pages/docs/DocsCLIReference.tsx`, `frontend/src/pages/docs/DocsKnownIssues.tsx`, `docs/ai-integration.md` for: "consolidate", "consolidation", "--yes", "work_prompts", "migrations from manual setups safe", and (with exceptions) "--scope local".
   - **`--scope local` exceptions — preserve these:**
     - `cli/agent_testing_procedure.md` T8.4/T8.5 (rejection-test fixtures).
     - `docs/ai-integration.md` line 108 (Tiddly→Claude Code scope-mapping cross-reference).
   - Rewrite any "migrations from manual setups safe" prose to describe the new additive safety.

**Testing strategy:**

- After help-text edits, paste `tiddly mcp configure --help` and `tiddly mcp remove --help` output into the PR description for reviewer eyeball.
- `make frontend-verify` must pass.
- No unit tests for doc prose.

**Docs:** Everything in this milestone is a doc change.

---

## Definition of done (global)

- `make cli-verify` passes.
- `make frontend-verify` passes.
- Agent provides a summary of what was deleted vs. kept vs. modified, cross-referenced against this plan's milestones.
- Agent pastes the new `configure --help` and `remove --help` output in the PR description.
- Agent confirms (with grep output) that no unresolved references to `consolidation`, `ConsolidationGroup`, `ErrConsolidation*`, `promptYesNo`, `AssumeYes`, `detectConsolidations`, or `writeConsolidationWarning` remain in the `cli/` tree or frontend docs.
- Agent confirms (with grep output) that `--yes` / `assumeYes` is not registered anywhere in `cli/cmd/` or `cli/internal/` source (this is the regression guard — a behavioral Cobra test is redundant with the grep and is not required).
- Agent confirms (with grep output) that the word "canonical" no longer appears in user-facing copy under `frontend/src/pages/docs/` or `cli/cmd/*.go` Long strings (internal code comments may still use it).
- Non-canonical Tiddly-URL entries are demonstrably preserved across configure and remove, per the new tests.
- Preserved-entries list is scoped to the server types managed by this run, per the new test.
- Shared-PAT warning fires correctly when a canonical PAT is also referenced by a retained non-canonical entry OR a retained canonical entry with a non-Tiddly URL, per the new tests.
- Shared-PAT warning consolidates multiple retained entries into one line, per the new test.
- Non-CLI-token note fires correctly (including for short/garbled PATs), per the new tests.
- Orphan-token warning excludes tokens referenced by retained entries, per the new test.
- Canonical-key-on-non-Tiddly-URL AND cross-wired canonical name trigger fail-closed error in preflight (before any token mint), per the new tests.
- `--force` on configure overrides the fail-closed refusal for both mismatch types and emits the `Forcing overwrite of …` line to stderr in non-dry-run mode only.
- `tiddly mcp remove` deletes canonical-named entries regardless of URL, per the new test.
- `AllTiddlyPATs` returns entries where (URL classifies as Tiddly) OR (key name is canonical), per the new tests.
- `DeleteTokensByPrefix` returns one structured `TokenRevokeResult` per input request, preserving entry labels.
- `CheckOrphanedTokens` returns token prefixes so the caller can filter against retained PATs.

## Out of scope

- PAT lifecycle semantics (mint/revoke flow, expiration handling) beyond what's already in `configure.go`.
- URL-based classification (`classifyServer`, `isTiddlyURL`, etc.) — correct as-is, just extended with `OtherServer.URL`.
- Skills (`tiddly skills configure/remove`) — unrelated surface.
- Any opt-in "revoke all Tiddly-URL PATs" flag for `remove`. If useful, a separate ticket.
- The `mcp status` multi-entry grouping — informational, unchanged.
- A guided CLI flow for removing user-custom non-canonical entries. Documented as a manual file-edit for now.
- Normalizing the handler-signature asymmetry between `buildClaudeDesktopConfig(configPath, ...)` and the other two (`rc ResolvedConfig`). Pre-existing cosmetic inconsistency.
- Codex deprecated skills path (`~/.codex/skills/`) — tracks an external tool's (OpenAI Codex's) own path migration, not Tiddly backwards-compat.
- Redesigning the `--delete-tokens` error flow (best-effort cleanup after config write vs. fail-fast before). Current behavior is preserved. If fail-fast semantics are desired, separate ticket.
