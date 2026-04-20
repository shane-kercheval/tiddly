# CLI `mcp configure`: Additive Behavior for Non-Canonical Tiddly Entries

**Date:** 2026-04-20
**Status:** Planned
**Breaking change:** Yes — removes the consolidation gate, deletes the `--yes` flag entirely, adds a new `--force` flag on `mcp configure`, and changes `mcp remove` default semantics (canonical-name-only, URL-agnostic). No backwards-compatibility shims. The CLI is pre-GA; users with scripted `--yes` invocations will see Cobra's "unknown flag" error and should drop the flag.
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
- If a canonical entry already exists and points at a matching Tiddly URL, it's updated in place — **validate-then-mint** semantics from the existing PR are preserved (validate the existing PAT via `/users/me`; reuse if valid, mint fresh if rejected).
- If a canonical entry exists but points at a **non-Tiddly URL** (e.g. user pasted some unrelated MCP server under `tiddly_prompts`), configure **fails closed** with an actionable error listing the file path, key name, and current URL. The user can (a) hand-edit to rename the entry, preserving their custom setup, or (b) re-run with `--force` to overwrite with the CLI-managed entry.
- `tiddly mcp configure --force` overrides the canonical-URL-mismatch refusal only. It does NOT override any other safety check (dry-run still previews; token revoke-on-failure still runs; non-canonical entries are still preserved). There is no short form (`-f` deliberately not registered).
- `tiddly mcp remove` becomes **canonical-name-only, URL-agnostic** by default — deletes `tiddly_notes_bookmarks` / `tiddly_prompts` regardless of what URL they point at. Non-canonical entries (e.g. `work_prompts`) survive. A user who repurposed a canonical key for a non-Tiddly service will see it removed if they run `tiddly mcp remove`; `.bak.<timestamp>` recovery is the safety net.
- `tiddly mcp remove --delete-tokens` only revokes PATs attached to canonical entries. A user's `work_prompts` PAT is not touched.
- When `--delete-tokens` is used and a canonical PAT is **also referenced by a non-canonical entry still on disk**, the CLI warns before revoking — revoking breaks the non-canonical binding too.
- When `--delete-tokens` is used and a PAT on a canonical entry doesn't match any CLI-minted server-side token (name prefix `cli-mcp-`), the CLI prints a note to the user so an empty "Deleted tokens:" line isn't confusing. This behavior is independent of any flag and fires whenever `--delete-tokens` encounters a non-CLI-minted token on a managed entry.
- The consolidation gate, Y/N prompt, `ErrConsolidation*` sentinels, and the `--yes` / `-y` flag are all removed entirely. No deprecation shim — pre-GA users with scripted `--yes` invocations will see Cobra's "unknown flag" error and should drop the flag from their scripts.
- After a successful configure, the summary tells the user which non-canonical Tiddly-URL entries were preserved — so a multi-account user isn't left wondering whether the CLI noticed their other entries.

### What we keep from PR #117

Most of the PR's infrastructure is orthogonal to consolidation and stays:

- Timestamped backup writes with O_EXCL collision handling (`config_io.go`).
- Commit-phase failure revokes already-minted tokens (`revokeMintedTokens`, `withRevokeError`, detached `cleanupCtx`).
- Dry-run Bearer token redaction (`redactBearers`, `bearerRE`).
- `Configure`/`Remove` handler signatures returning `backupPath`. (`Remove` signature is otherwise unchanged from today — no `--force` parameter is added; see Milestone 2.)
- Partial-result contract (`ConfigureResult` surfaces what completed before a mid-run failure).
- `classifyServer` extraction and secondary-sort tiebreaker in `status.go` — needed to render multi-entry state correctly AND used by preflight to detect canonical-key-non-Tiddly-URL cases AND to derive preserved-entries lists (single source of truth).
- `--help` text enumeration of the three supported tools.
- `AllTiddlyPATs` handler method (repurposed — see Milestone 2).
- Validate-then-mint fallback (repurposed — applies to the canonical entry only).
- **Preflight `handler.Status` call** (repurposed — see Milestone 1). Its purpose shifts from "read state to detect consolidation" to three concurrent jobs: (1) fail-closed parse probe before any server-side mutation, (2) detect canonical keys pointing at non-Tiddly URLs for fail-closed refusal (overridable via `--force`), (3) derive the preserved-non-canonical-entries list for the configure summary. One Status call per tool, three uses.

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

1. **`--delete-tokens` semantics on `mcp remove`** — Canonical-only by default. `tiddly mcp remove claude-code --delete-tokens` revokes PATs from `tiddly_notes_bookmarks` / `tiddly_prompts` only. A user's `work_prompts` PAT is not touched because it wasn't in a CLI-managed entry. **Exception**: when a canonical PAT is also used by a non-canonical entry still on disk, the CLI warns before revoking (revoking would break the non-canonical binding). When a canonical entry's PAT doesn't match any CLI-minted server-side token (no `cli-mcp-` prefix match), the CLI prints an informational note so the user understands why no revoke happened. No opt-in flag for the old "nuke all Tiddly-URL PATs" behavior — if a user legitimately needs that, it's a follow-up feature.
2. **Status rendering** — Unchanged. `tiddly mcp status` continues to group every Tiddly-URL entry under "Tiddly servers" (canonical + custom). Informational; reflects the user's real setup.
3. **Dry-run output** — No "Consolidation required:" header. The dry-run diff shows only the canonical entry being added or updated; non-canonical entries appear in neither `before` nor `after` as diffs (they're unchanged). When `--force` is passed, the existing diff's `before` block already shows the non-Tiddly URL being overwritten; no additional log line is printed in dry-run mode.
4. **Deprecation / migration path** — None. The CLI is pre-GA; users whose scripts pass `--yes` will see Cobra's "unknown flag" error. Remediation is "drop the flag." Clean break is preferable to a deprecation shim that stops meaning anything after one release.
5. **Obsolete tests** — Delete rather than rework. Listed explicitly in each milestone (test names verified against the file to prevent glob-misses).
6. **`survivorsOfAllTiddlyPATs` helper** — Reduced to "find the canonical entry's PAT, if any." Renamed to `canonicalEntryPATs`. `PATExtraction` collapses to `{ContentPAT, PromptPAT}` (Name fields deleted). The function only walks canonical entries — non-canonical PATs are no longer reuse candidates because `configure` doesn't touch those entries.
7. **Canonical key pointing at non-Tiddly URL** — Fail closed with actionable error, overridable via `--force`. If `tiddly_prompts` exists but points at e.g. `https://example.com/my-prompts`, configure refuses and names the file path, key, and current URL. The user has three paths: (a) edit the file to rename the entry and preserve it, (b) re-run with `--force` to overwrite, or (c) abandon the configure. Silent overwrite contradicts the plan's "never destroy user state" premise; `--force` provides the explicit opt-in. Implementation is a filter on the preflight `StatusResult.OtherServers` — zero new infrastructure.
8. **Fail-closed safety on malformed config** — Preserved via the existing preflight `handler.Status(rc)` call. Its consolidation-detection role is removed, but the parse-probe semantics are exactly what we need to prevent a malformed config from proceeding to token mint. Keeping the call is the smallest possible fix — no new code, no new test surface.
9. **Remove semantics for canonical entries with non-Tiddly URLs** — Delete them. `tiddly mcp remove claude-code` uses a canonical-name-only predicate regardless of URL. Rationale: "remove means remove"; the user's request is explicit; `.bak.<timestamp>` provides recovery; the configure-path `--force` escape hatch + remove-path always-delete forms a coherent model (configure protects ambiguous state, remove executes explicit requests). No `--force` flag on remove — it would be semantically empty.
10. **`--force` short form** — None. No `-f` alias. Short forms on destructive operations invite accidental use, and `-f` collides with common short flags elsewhere (`--file`, `--format`). Long-form only.

---

## Architectural decision: refactor in place, don't revert

We keep commit `3d7a1b1` and surgically remove the consolidation layer. Rationale:

- The KEEP set touches every file in the PR. A revert-and-cherry-pick reapplies ~70% of the diff by hand.
- Signature changes (`Configure`/`Remove` → `backupPath`; `PATExtraction`) ripple through all three handlers and their tests.
- The `classifyServer` extraction and status secondary-sort tiebreaker are dependencies of "render multi-entry state correctly" — which the new request explicitly keeps.

---

## Reference reading for the agent

Before implementing, read these files to understand current structure and what's being removed:

- `cli/internal/mcp/configure.go` — focus on `RunConfigure`, `preflightedTool`, `confirmConsolidations`, `resolveToolPATs`, `resolveServerPAT`, and the preflight `handler.Status` call (around lines 234-243; line numbers may drift — anchor by function names).
- `cli/internal/mcp/consolidation.go` — entire file (being deleted).
- `cli/internal/mcp/prompt.go` — entire file (being deleted).
- `cli/internal/mcp/handler.go` — `TiddlyPAT`, `PATExtraction`, `ToolHandler` interface, `survivorsOfAllTiddlyPATs`.
- `cli/internal/mcp/status.go` — `classifyServer`, `StatusResult`, `MatchByName` / `MatchByURL` — preflight leans on these heavily after the refactor.
- `cli/internal/mcp/claude_code.go`, `claude_desktop.go`, `codex.go` — `extractAll*TiddlyPATs` and `extract*PATs` pairs, plus the `removeJSONServersByTiddlyURL` / `removeCodexServersByTiddlyURL` call inside each `build*Config`.
- `cli/cmd/mcp.go` — `newMCPConfigureCmd`, `newMCPRemoveCmd`, `translateConfigureError`, `--yes` flag wiring, and the two `Long:` strings at lines 62-85 and 301-319 whose URL-based-replace wording contradicts the new contract.
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

### Milestone 1 — Additive `configure` (consolidation removed; `--force` added)

**Goal & outcome:**
`tiddly mcp configure` writes only canonical entries and leaves non-canonical Tiddly-URL entries untouched. Consolidation module, prompt helper, and the gate are all removed. The preflight `handler.Status` call is preserved and now serves three purposes: fail-closed parse probe, canonical-URL-mismatch detection, and preserved-entries derivation. `--force` overrides the canonical-URL-mismatch refusal only. Validate-then-mint on the canonical entry's PAT is preserved. The configure summary lists preserved non-canonical entries so users can see what was left alone.

- `configure` run with pre-existing `work_prompts` + `personal_prompts` → those entries survive unchanged; canonical entries are added/updated; summary lists `work_prompts` and `personal_prompts` as preserved.
- `configure --servers content` when canonical `tiddly_prompts` exists → `tiddly_prompts` is structurally preserved (re-parse and compare as maps; byte-level equality depends on input canonical form and is not asserted).
- `configure` re-run when canonical is already present → canonical updated in place (same validate-then-mint); non-canonical untouched.
- `configure` run when canonical `tiddly_prompts` exists but its URL is not a Tiddly URL → configure exits non-zero with an actionable error naming the file path, key name (`tiddly_prompts`), and current URL. **No server-side token mint happens** — the check runs in preflight, before `resolveToolPATs`.
- `configure --force` with the same bad canonical entry → proceeds; prints `Forcing overwrite of tiddly_prompts (currently https://example.com/my-prompts)` to stderr (non-dry-run only); writes the CLI-managed entry.
- `configure --dry-run --force` → preview only; the diff's `before` block shows the non-Tiddly URL being overwritten. No additional stderr log line (would be redundant with the diff).
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

Pluralizes to "N canonical entries" when both `tiddly_notes_bookmarks` and `tiddly_prompts` are mismatched; each offending entry is listed on its own bullet under the intro line.

**Implementation outline:**

1. **Delete files:** `cli/internal/mcp/consolidation.go`, `consolidation_test.go`, `prompt.go`, `prompt_test.go`.

2. **`configure.go`**:
   - Delete `ErrConsolidationDeclined`, `ErrConsolidationNeedsConfirmation`.
   - Remove `ConfigureOpts.AssumeYes`, `.Stdin`, `.IsInteractive`. Add `ConfigureOpts.Force bool`.
   - Remove `preflightedTool.consolidations` field. Add `preflightedTool.preservedNames []string` (derived from the preflight Status result; see below).
   - Remove `anyConsolidations`, `confirmConsolidations` functions and the Phase 2 gate call site.
   - **Keep the preflight `handler.Status(rc)` call** (configure.go around lines 234-243). Its new role is threefold:
     1. **Parse probe / fail-closed.** Existing dry-run-tolerant vs. real-run fail-closed branching stays — a read error on a real run still aborts before any mint.
     2. **Canonical-URL-mismatch detection.** After a successful Status, iterate `sr.OtherServers`. Any entry whose `Name` equals `serverNameContent` or `serverNamePrompts` is a canonical-named entry classified as non-Tiddly-URL (because `classifyServer` routes non-Tiddly URLs to `OtherServers`). Collect these. If the collected list is non-empty AND `opts.Force` is false, return a preflight error formatted as shown in the "Sample output" block above — before `resolveToolPATs` is called, so no server-side token mint happens. If `opts.Force` is true, skip the error but record the list on `preflightedTool.forceOverwrites` (or equivalent) so the commit loop can log the overwrite to stderr (non-dry-run only).
     3. **Preserved-entries derivation.** Filter `sr.Servers` to entries where `MatchMethod == MatchByURL`. Those are non-canonical-named entries whose URL classifies as Tiddly — i.e. the user's custom Tiddly entries that configure is leaving alone. Stash their names (sorted) on `preflightedTool.preservedNames`. Timing note: this is captured pre-write, which is correct because configure is additive — non-canonical entries are not modified between pre and post.
   - In the commit loop, delete the `if len(pf.consolidations) > 0 { writeConsolidationWarning(...) }` branch in the dry-run output block and the "Consolidation required:" header emission in both paths.
   - In the commit loop, after successful `handler.Configure`, copy `pf.preservedNames` into `result.PreservedEntries[pf.tool.Name]`.
   - **Force-overwrite stderr log.** Non-dry-run runs with `opts.Force == true` and a non-empty `forceOverwrites` list emit one line per overwritten entry to `opts.ErrOutput` BEFORE `handler.Configure` is called: `Forcing overwrite of <key> (currently <url>)`. Dry-run runs do NOT emit this — the diff's `before` block already shows it.
   - **Delete `tiddlyURLMatcher`** (function at configure.go:25-38). The function has no non-test users once step 4 below removes the three `build*Config` callers. Matching `TestTiddlyURLMatcher__*` tests in `configure_test.go` are also deleted (see Testing strategy).
   - Keep: `resolveToolPATs`, `resolveServerPAT` (validate-then-mint), `mintedToken`, `toolPATResolution`, `withRevokeError`, `revokeMintedTokens`, `cleanupTimeout`, `redactBearers`, `printDiff`, `BackupRecord`.
   - Add `ConfigureResult.PreservedEntries` — `map[string][]string` keyed by tool name, value is sorted slice of non-canonical Tiddly-URL entry names. `printConfigureSummary` emits one line per tool with preserved entries: `Preserved non-CLI-managed entries in <tool>: <name1>, <name2>`.

3. **`handler.go`**:
   - Collapse `PATExtraction` to `{ContentPAT, PromptPAT}` — delete the two `Name` fields.
   - Rename `survivorsOfAllTiddlyPATs` → `canonicalEntryPATs`. Semantics change: only match canonical-named entries (`tiddly_notes_bookmarks` / `tiddly_prompts`). Non-canonical entries are no longer PAT-reuse candidates. Doc comment must state this explicitly:

   ```go
   // canonicalEntryPATs extracts the Bearer tokens from entries whose config
   // key matches the canonical names (tiddly_notes_bookmarks, tiddly_prompts).
   // Non-canonical Tiddly-URL entries (e.g. work_prompts) are deliberately
   // excluded — configure never touches them, so their PATs are not reuse
   // candidates.
   func canonicalEntryPATs(all []TiddlyPAT) PATExtraction { /* ... */ }
   ```

   - `AllTiddlyPATs` interface method stays. Its old rationale ("used by status rendering") was wrong — status uses `classifyServer` directly. The real caller is `remove --delete-tokens` (cmd/mcp.go); after Milestone 2 it's also consulted for the shared-PAT warning that needs to see non-canonical entries. Update the doc comment:

   ```go
   // AllTiddlyPATs returns every extractable Bearer token in the tool's
   // config that points at a Tiddly URL, in canonical-first order. Used by
   // `remove --delete-tokens`: the canonical subset supplies revoke targets,
   // and the non-canonical subset is consulted to warn when a revoke would
   // break a still-configured non-canonical binding.
   AllTiddlyPATs(rc ResolvedConfig) []TiddlyPAT
   ```

   - **Do NOT add a `NonCanonicalTiddlyEntries` interface method.** The earlier draft proposed one; it duplicates `classifyServer` logic. Preserved-entries derivation reuses `StatusResult.Servers` filtered to `MatchByURL` (see step 2).

4. **Per-handler files (`claude_code.go`, `claude_desktop.go`, `codex.go`)**:
   - `extractAll*TiddlyPATs` functions stay (used by `AllTiddlyPATs` for the remove path and the shared-PAT warning).
   - `extract*PATs` survivor variants derive from `canonicalEntryPATs` (renamed from `survivorsOfAllTiddlyPATs`). They now return PATs only from canonical-named entries.
   - **Delete the URL-based removal call inside each build path:**
     - `claude_code.go` around line 190 — remove the `removeJSONServersByTiddlyURL(servers, tiddlyURLMatcher(...))` line from `buildClaudeCodeConfig`.
     - `claude_desktop.go` around line 60 — remove the same call from `buildClaudeDesktopConfig`.
     - `codex.go` around line 89 — remove `removeCodexServersByTiddlyURL(...)` from `buildCodexConfig`.

     **Rationale:** Go map assignment (`servers[serverNameContent] = ...`) overwrites the canonical key in place regardless of whether it pre-existed. Non-canonical entries are never referenced by that assignment and survive by default. The removal helpers themselves (`removeJSONServersByTiddlyURL`, `removeCodexServersByTiddlyURL`) stay — they're still used by the Remove path in Milestone 2.
   - **Do NOT add canonical-URL validation in `build*Config`.** The earlier draft proposed this; it ran after `resolveToolPATs` and would have caused mint-then-revoke instead of fail-before-mint. The check lives in preflight now (step 2).
   - **Do NOT add `NonCanonicalTiddlyEntries` per-handler implementations.** Preserved-entries come from preflight Status.
   - `Remove` path changes deferred to Milestone 2.

5. **`cmd/mcp.go` — `--yes` flag removal and `--force` flag addition**:
   - Delete the `cmd.Flags().BoolVarP(&assumeYes, "yes", "y", ...)` registration, the `assumeYes` local variable, and the `AssumeYes: assumeYes` field in the `opts` literal. Users passing `--yes` get Cobra's "unknown flag" error.
   - Add `--force` flag on `newMCPConfigureCmd`: `cmd.Flags().BoolVar(&force, "force", false, "Overwrite canonical entries that point at non-Tiddly URLs")`. Long-form only — do NOT register `-f` (intentional; short forms on destructive operations invite accidents).
   - Plumb to `ConfigureOpts.Force`.
   - Update the configure `Long:` string to document `--force` (separate from the URL-replace rewrite in Milestone 3). One-sentence addition: "Use `--force` to overwrite a canonical entry (`tiddly_notes_bookmarks` or `tiddly_prompts`) whose URL is not a Tiddly URL — e.g. to replace a local dev fork with the CLI-managed entry."

**Testing strategy (`configure_test.go`):**

- **Delete** (verified names against current file):
  - `TestRunConfigure__consolidation_prompt_proceeds_on_yes` (line ~1174)
  - `TestRunConfigure__consolidation_prompt_aborts_on_no` (line ~1208)
  - `TestRunConfigure__consolidation_non_interactive_errors_without_yes` (line ~1238)
  - `TestRunConfigure__declining_before_writes_creates_no_server_tokens` (line ~1266) — note: real name has no `consolidation_` prefix
  - `TestRunConfigure__non_interactive_decline_creates_no_server_tokens` (line ~1303) — same
  - `TestRunConfigure__consolidation_assume_yes_bypasses_prompt` (line ~1885)
  - `TestRunConfigure__dry_run_warns_about_multi_entry_consolidation` (line ~1013)
  - `TestRunConfigure__dry_run_no_warning_when_single_entries` (line ~1072)
  - `TestRunConfigure__dry_run_servers_flag_scopes_warning` (line ~1104)
  - `TestRunConfigure__no_prompt_when_single_entries` (line ~1918)
  - `TestRunConfigure__single_gate_across_multiple_tools` (if present — check for `__single_gate_`)
  - `TestRunConfigure__oauth_multi_entry_proceed_reuses_surviving_pat` (if present)
  - `TestTiddlyURLMatcher__both_pats`, `__content_only`, `__prompts_only`, `__neither_pat_matches_nothing` — the function is being deleted in step 2.
  - All `TestWriteConsolidationWarning__*` tests.
  - Handler-specific tests in `claude_code_test.go` / `claude_desktop_test.go` / `codex_test.go` that assert `Configure` **deletes** a non-canonical Tiddly-URL entry.
- **Keep:**
  - `TestPrintDiff__redacts_bearer_across_all_three_formats`
  - `TestRunConfigure__commit_phase_failure_preserves_earlier_writes`
  - `TestRunConfigure__oauth_commit_failure_revokes_minted_tokens`
  - `TestRunConfigure__oauth_commit_failure_with_revoke_failure_surfaces_orphans`
  - `TestRunConfigure__commit_phase_failure_surfaces_backup_path`
  - `TestRunConfigure__preflight_failure_returns_nil_result`
  - **`TestRunConfigure__status_error_aborts_non_dry_run`** — the preflight `handler.Status` call is preserved, so the behavior this test locks in (fail closed on Status read error in real runs) is still valid.
  - `TestRunConfigure__malformed_config_returns_parse_error` (if present) — ditto.
  - `TestRevokeMintedTokens__*`.
- **Add (core of the behavior change):**
  - `TestRunConfigure__additive_preserves_non_canonical_tiddly_entries`: configure with pre-existing `work_prompts` + `personal_prompts` pointing at Tiddly URLs. Assert both entries survive (structural equality — re-parse the config map and compare key, URL, and headers/args). Assert canonical entries are added. Run once per handler (JSON, JSON, TOML).
  - `TestRunConfigure__reuses_canonical_pat_when_valid`: canonical entry already present with a valid PAT. Assert the PAT is reused (no mint call), the entry is rewritten in place with the same PAT, and non-canonical entries nearby are structurally preserved.
  - `TestRunConfigure__mints_fresh_when_canonical_pat_invalid`: canonical entry already present with a stale PAT. Fake `validatePAT` to return `(false, nil)`. Assert a new token is minted, written to the canonical entry, and non-canonical entries are untouched.
  - `TestRunConfigure__does_not_reuse_pat_from_non_canonical_entry`: no canonical entry, but `work_prompts` exists with a valid PAT. Assert configure **mints** a fresh token instead of reusing the `work_prompts` PAT. Explicit behavior change from PR #117.
  - `TestRunConfigure__dry_run_shows_only_canonical_diff`: with non-canonical entries present, assert the dry-run output does not show `work_prompts` as a *changed or removed* line. The key may appear identically in both `before` and `after` blocks — that's expected and correct; the failing case is a deletion or modification line, not an unchanged one.
  - `TestRunConfigure__servers_content_leaves_canonical_prompts_structurally_preserved`: pre-existing canonical `tiddly_prompts` entry. Run `configure --servers content`. Assert `tiddly_prompts` compares equal after re-parse (structural equality, not byte-level).
  - `TestRunConfigure__refuses_to_overwrite_canonical_key_with_non_tiddly_url`: pre-existing `tiddly_prompts` with URL `https://example.com/whatever`. Assert configure returns a non-nil error. Assert the error message contains the file path, the key name, and the current URL. **Assert `opts.Client.CreateToken` was NOT called** (this is the fail-before-mint contract — use the test client's call-tracking). Assert no config write happened. Single test at the `RunConfigure` level — the check lives in preflight, so handler-level duplication isn't needed.
  - `TestRunConfigure__force_overwrites_canonical_with_non_tiddly_url` (per handler): same setup, but pass `opts.Force = true`. Assert configure succeeds, the CLI-managed entry is written, and the stderr output contains `Forcing overwrite of tiddly_prompts (currently https://example.com/whatever)`.
  - `TestRunConfigure__force_with_dry_run_shows_overwrite_in_diff_without_stderr_log`: same setup with `Force = true` and `DryRun = true`. Assert the diff's `before` block contains the non-Tiddly URL, the `after` block contains the CLI-managed entry, and stderr does NOT contain the `Forcing overwrite of …` line (no duplication with the diff).
  - `TestRunConfigure__force_is_no_op_when_no_canonical_url_mismatch`: canonical entries already at Tiddly URLs. Run with `Force = true`. Assert behavior identical to `Force = false` (no stderr log, same writes, same summary).
  - `TestRunConfigure__reports_preserved_non_canonical_entries`: configure with `work_prompts` + `personal_prompts` present. Assert `ConfigureResult.PreservedEntries["claude-code"]` contains both names (sorted), and `printConfigureSummary` emits the `Preserved non-CLI-managed entries in claude-code: personal_prompts, work_prompts` line.
  - `TestRunConfigure__preserves_non_canonical_entry_with_malformed_authorization`: non-canonical entry exists with a garbled/missing Authorization header. Assert it's still reported in `PreservedEntries` (derivation walks `StatusResult.Servers` which uses `classifyServer` — URL-based, doesn't inspect headers).
- **Per-handler tests** (`claude_code_test.go`, `claude_desktop_test.go`, `codex_test.go`):
  - Remove tests asserting `Configure` deletes non-canonical Tiddly-URL entries.
  - Add a direct handler-level test for each: given a config with a canonical entry + a non-canonical Tiddly-URL entry + unrelated non-Tiddly entries, calling `Configure` preserves the non-canonical Tiddly entry and the unrelated entries structurally.
  - `ExtractPATs` tests: update to reflect `{ContentPAT, PromptPAT}` only (drop Name assertions) and canonical-name-only semantics (non-canonical entries no longer contribute).

**Docs:** None in this milestone — CLI help and doc pages update in Milestone 3.

---

### Milestone 2 — Canonical-name-only `mcp remove` (+ safe `--delete-tokens`)

**Goal & outcome:**
`tiddly mcp remove` deletes canonical-named entries (`tiddly_notes_bookmarks` / `tiddly_prompts`) from the tool's config, regardless of what URL those entries point at. Non-canonical Tiddly-URL entries survive. `--delete-tokens` revokes only PATs attached to canonical entries, warns before revoking a PAT also referenced by a retained non-canonical entry, and prints an informational note when a canonical entry's PAT doesn't match any CLI-minted server-side token.

- `tiddly mcp remove claude-code` with canonical + non-canonical entries present → canonical removed, non-canonical structurally preserved.
- `tiddly mcp remove claude-code` when canonical `tiddly_prompts` points at a non-Tiddly URL (e.g. user repurposed it) → canonical entry deleted. `.bak.<timestamp>` provides recovery.
- `tiddly mcp remove claude-code --delete-tokens` → revokes PATs for canonical entries only; `work_prompts` PAT is untouched server-side.
- **`tiddly mcp remove claude-code --delete-tokens` when canonical `tiddly_prompts` PAT == non-canonical `work_prompts` PAT → warning fires before revoke**: `Warning: token from tiddly_prompts is also used by work_prompts (still configured); revoking will break that binding.` User decides whether to proceed; current policy is "warn and proceed" (matches the existing cross-server-shared-PAT warning semantics).
- **`tiddly mcp remove claude-code --delete-tokens` when the canonical entry's PAT doesn't match any CLI-minted server-side token** (e.g. user-pasted token, or token minted outside the CLI): `Note: no CLI-created token matched the token attached to tiddly_prompts; nothing was revoked. Manage tokens at https://tiddly.me/settings.` This fires on any `--delete-tokens` run where a revoke target doesn't match the `cli-mcp-` name pattern — it's informational, not error.
- Orphan-token warning (`CheckOrphanedTokens`) scans canonical-named `cli-mcp-*` tokens only (already name-based, so it's correct — just confirm and add a clarifying comment).

**Implementation outline:**

1. **Per-handler `Remove` method**: change the deletion predicate from "any entry matching a Tiddly URL" to **"entry whose key name is canonical"** — URL-agnostic. The belt-and-suspenders URL check from the pre-plan code is removed: rationale is that "remove means remove," the user's explicit command signals intent, and `.bak.<timestamp>` covers accidental destruction (a user who repurposed `tiddly_prompts` and regrets removal can restore from the backup with a one-line `cp`). For `--servers content` / `--servers prompts`, filter by canonical name for the requested type. `ToolHandler.Remove` signature is UNCHANGED from today — no `force` parameter is added.

2. **`cmd/mcp.go` — `newMCPRemoveCmd`**:
   - No new flag. `tiddly mcp remove` surface is unchanged except for the semantic shift.
   - The PAT-collection block (around lines 372-411) currently uses `handler.AllTiddlyPATs(rc)` and filters by server type only. Restructure into two passes:
     1. **Revoke targets**: walk canonical entries only (via `canonicalEntryPATs` or an inline canonical-name filter over `AllTiddlyPATs`). These are the PATs that will be passed to `DeleteTokensByPrefix`. Dedup by PAT value.
     2. **Retained PATs after write**: walk **all remaining tiddly-URL entries** on disk after the remove — specifically, non-canonical entries (they survive) **plus** canonical entries for server types NOT being removed (when `--servers content` only removes the content canonical, the prompts canonical stays and its PAT is still live).
   - Before revoking, compare each revoke target against the retained-PATs set. If any match, print the warning: `Warning: token from <canonical-name> is also used by <retained-name> (still configured); revoking will break that binding.` Fire once per retained entry that matches (dedupe on retained-entry name).
   - The existing "Warning: token is shared with X server (still configured)" message (for the canonical-content + canonical-prompts shared-PAT case) is a subset of this new logic and is superseded. Replace it with the unified warning above.
   - **Non-CLI-token note**: after `DeleteTokensByPrefix` runs, compare the count of revoke targets to the count of actually-deleted tokens (from `DeleteTokensByPrefix`'s return). If any targets didn't produce a delete — because no server-side token matched both the PAT prefix AND the `cli-mcp-` name pattern — print one note per affected canonical entry: `Note: no CLI-created token matched the token attached to <canonical-name>; nothing was revoked. Manage tokens at https://tiddly.me/settings.` This note fires on any `--delete-tokens` run where the condition holds; it's not gated on any flag. Output channel: stdout (matches the "Deleted tokens:" line format).

3. **`AllTiddlyPATs` interface method** — stays, with updated doc comment (see Milestone 1 step 3).

4. **`CheckOrphanedTokens` doc-comment addition** (`configure.go` around line 625). This function matches server-side tokens by name prefix `cli-mcp-{tool}-{serverType}-`; it does **not** inspect config content. After this change, a user who pasted a CLI-minted PAT into a non-canonical entry (e.g. their `work_prompts`) will see that token flagged as "potentially orphaned" by `remove` without `--delete-tokens`, even though it's still in use. Acceptable (it's a warning, not destructive) but pin it down with a comment so a future maintainer doesn't elevate this result to automated revocation:

   ```go
   // NOTE: Matching by name prefix only — this function does not read the
   // tool's config to cross-check which tokens are still referenced. A
   // CLI-minted PAT that the user pasted into a non-canonical entry (e.g.
   // work_prompts) will be reported here as "potentially orphaned" after a
   // canonical-only remove, even though it's still in use. Safe for a
   // warning; do NOT promote the result to automated revocation without
   // reading actual config content.
   ```

   No code change, no new test.

**Testing strategy (`cmd/mcp_test.go` and per-handler tests):**

- **Delete:** `TestTranslateConfigureError__*` (all four — the sentinels are gone and `translateConfigureError` is deleted in Milestone 3's cmd cleanup).
- **Modify:**
  - `TestMCPRemove__delete_tokens_multi_entry_revokes_all` → rename to `..._revokes_canonical_only` and assert non-canonical PATs are NOT in the DELETE call set.
- **Keep:**
  - `TestMCPRemove__delete_tokens_dedups_shared_pat` (still valid — canonical content + canonical prompts can share a PAT).
  - `TestMCPConfigure__dry_run_surfaces_pat_auth_warning`.
- **Add:**
  - `TestMCPRemove__preserves_non_canonical_entries` (per handler): given canonical + `work_prompts` (Tiddly URL, different PAT), assert remove deletes only the canonical entry and leaves `work_prompts` structurally preserved (re-parse and compare).
  - `TestMCPRemove__deletes_canonical_entry_with_non_tiddly_url` (per handler): canonical `tiddly_prompts` with URL `https://example.com/foo`. Assert remove deletes the entry and produces a `.bak.<timestamp>` file. Regression guard against re-introducing the belt-and-suspenders URL check.
  - `TestMCPRemove__delete_tokens_ignores_non_canonical_pats`: canonical + non-canonical with distinct PATs, `--delete-tokens`, assert the revoke set contains only the canonical entry's PAT.
  - `TestMCPRemove__shared_pat_warning_fires_on_canonical_split`: canonical content and canonical prompts share a PAT; `--servers content --delete-tokens`; assert warning fires.
  - **`TestMCPRemove__shared_pat_warning_fires_when_non_canonical_retains_pat`**: canonical prompts shares a PAT with non-canonical `work_prompts`; `--delete-tokens`; assert warning DOES fire (non-canonical is a retained binding that revoke would break). This is the critical correctness test — it codifies the opposite of the behavior an earlier draft of this plan proposed.
  - `TestMCPRemove__no_warning_when_no_retained_pat_shares`: canonical entries with unique PATs, no non-canonical entries; `--delete-tokens`; assert no shared-PAT warning is printed.
  - `TestMCPRemove__servers_prompts_only_warns_when_retained_content_shares_pat`: canonical content and canonical prompts share a PAT; `--servers prompts --delete-tokens`; assert warning fires (canonical content is retained).
  - **`TestMCPRemove__non_cli_token_note_fires_when_no_cli_mcp_match`**: canonical `tiddly_prompts` with a user-pasted PAT (no `cli-mcp-` server-side token exists with the matching prefix). Run `--delete-tokens`. Assert stdout contains `Note: no CLI-created token matched the token attached to tiddly_prompts; nothing was revoked.`
  - `TestMCPRemove__non_cli_token_note_does_not_fire_for_cli_tokens`: canonical entry with a CLI-minted token. Run `--delete-tokens`. Assert no note line is printed; the normal "Deleted tokens:" line appears instead.

**Docs:** None in this milestone.

---

### Milestone 3 — CLI help, docs, and E2E test plan cleanup

**Goal & outcome:**
User-visible surface (help text, docs, test plan doc, frontend widget) reflects the additive semantics. No references to consolidation, `--yes`, or the Y/N prompt remain in user-facing copy. The new `--force` flag is documented. Tiddly-facing `--scope` vocabulary is consistent across docs and widget. Users of multi-account setups have clear documentation for both the CLI's preserve-by-default behavior AND how to manually clean up custom entries if they no longer want them.

- `tiddly mcp configure --help` and `tiddly mcp remove --help` accurately describe additive behavior; configure help documents `--force`.
- `frontend/src/pages/docs/DocsCLIMCP.tsx` explains the additive contract, documents `--force`, and includes a FAQ-style block for "I have multiple Tiddly entries — what now?"
- `frontend/src/components/AISetupWidget.tsx` references the current Tiddly-facing `--scope` vocabulary.
- `cli/agent_testing_procedure.md` Phase 4 is removed; the scattered `--yes`/consolidation references in Phase 1/3 are also cleaned up; T8.4/T8.5 are preserved intact.
- User-facing copy avoids the engineering term "canonical" — uses "CLI-managed entries" or names the keys directly.

**Implementation outline:**

1. **`cmd/mcp.go` — Long strings**:
   - `newMCPConfigureCmd` Long string (around lines 62-85): remove the paragraph about consolidation and `--yes`. Rewrite the second paragraph (which currently says "Servers are identified by URL, not by name. Any existing entry pointing to a Tiddly MCP URL is removed and replaced...") with:

     > Configure writes two CLI-managed entries: `tiddly_notes_bookmarks` (content server) and `tiddly_prompts` (prompt server). These are the only entries the CLI creates or modifies. If you have other entries pointing at Tiddly URLs under different names (for example, `work_prompts` and `personal_prompts` for multiple accounts), configure leaves them alone — it doesn't claim ownership of entries you created yourself. After a run, configure lists any preserved non-CLI-managed entries so you can see what was left unchanged.
     >
     > If a CLI-managed entry already exists but points at a non-Tiddly URL (for example, you repurposed `tiddly_prompts` for a local dev server), configure refuses by default and tells you which entry is mismatched. Either rename the entry in the config file to preserve it, or re-run with `--force` to overwrite.

   - Remove `translateConfigureError` and its call site in `RunE`; the call site becomes `return err`. Remove the `errors` import if no other code uses it (grep first).
   - `--yes` flag is already deleted in Milestone 1; nothing to do here.
   - `--force` flag is registered in Milestone 1; confirm it appears in `--help` output with a clear short description.
   - `newMCPRemoveCmd` Long string (around lines 301-319): replace "Servers are identified by URL, not by name. Any entry pointing to a Tiddly MCP URL is removed, even if the key name differs from the default." with:

     > Remove deletes the CLI-managed entries (`tiddly_notes_bookmarks`, `tiddly_prompts`) from the tool's config file. Other entries pointing at Tiddly URLs under different names are preserved. A canonical-named entry is removed regardless of what URL it points at — useful if you repurposed a CLI-managed key and want to clear it. The prior config is saved to `<path>.bak.<timestamp>` before the write.
     >
     > With `--delete-tokens`, only the PATs attached to the CLI-managed entries are revoked; PATs used exclusively by preserved entries are left alone. If a CLI-managed PAT is also referenced by a preserved entry, the CLI warns before revoking.

2. **`frontend/src/pages/docs/DocsCLIMCP.tsx`**:
   - **Rewrite the "Server Identification" section** at lines 124-141 (three paragraphs). The current prose says:
     - "The CLI identifies Tiddly MCP servers by URL, not by config key name. ... This applies to all operations: `configure`, `remove`, and `status`."
     - "On **configure**, existing entries pointing to Tiddly URLs are replaced with the canonical names..."
     - "On **remove**, any entry pointing to a Tiddly URL is removed, even if it was created manually with a different name."

     All three contradict the new additive contract. Replace with:

     > The CLI writes two managed entries: `tiddly_notes_bookmarks` (content server) and `tiddly_prompts` (prompt server). These are the only entries `configure` and `remove` touch.
     >
     > If you run multiple Tiddly accounts in one tool — for example, `work_prompts` and `personal_prompts` both pointing at the Tiddly prompt server with different tokens — the CLI leaves those entries alone. You can run `configure` safely on a multi-account setup; the CLI updates its own two entries and reports which of your custom entries it preserved.
     >
     > If a CLI-managed entry already exists but points at a non-Tiddly URL, `configure` refuses by default and asks you to either rename the entry or re-run with `--force` to overwrite. `remove` always deletes CLI-managed entries regardless of URL — use this if you want to clear a repurposed slot.
     >
     > `status` still recognizes any entry pointing at a Tiddly URL regardless of key name, so you can see the full picture of what's configured.

   - **Add `--force` to the Flags table** (around lines 254-282): new row for `--force` with description "Overwrite CLI-managed entries that point at non-Tiddly URLs."
   - **Add a short FAQ-style block** titled "I have multiple Tiddly entries — what happens on configure?" explaining:
     - Configure adds the two managed entries without touching custom ones.
     - The summary lists preserved entries so you know nothing was destroyed.
     - If you want to remove a custom entry like `work_prompts`, edit the tool's config file directly — the CLI's `remove` command only touches CLI-managed entries.
   - Replace any lingering use of the word "canonical" in user-facing text with "CLI-managed" or the explicit key names.

3. **`frontend/src/components/AISetupWidget.tsx`**:
   - The `--scope local` → `--scope directory` description change around line 431 (the `getAffectedFiles` Claude Code case) aligns the widget's displayed CLI command with the Tiddly-facing flag vocabulary used everywhere else. This edit is already present on-branch — keep it and land it as part of this milestone's doc-consistency sweep.

4. **`cli/agent_testing_procedure.md`**:
   - **Delete entirely:** Phase 4 section and T4.1, T4.2, T4.4, T4.8, T4.8b, T4.9, T4.9b, T4.10, T4.11.
   - **Edit line 3** (intro sentence listing covered areas): drop "consolidation gate (prompt / `--yes` / decline)" from the list of covered behaviors.
   - **Edit lines 954-955** (Phase 3 test-coverage table): remove the `TestRunConfigure__consolidation_prompt_proceeds_on_yes` / `_aborts_on_no` rows — those tests no longer exist.
   - **Edit line 1015** (Phase 3 `--help` flag-list check): remove `--yes` / `-y` from the expected flag enumeration, add `--force` to it. The flag is deleted outright — it should not appear in help output, and invoking `tiddly mcp configure --yes` returns Cobra's "unknown flag" error.
   - **Edit line 1017** (Phase 3 help-text content check): drop the requirement that help text mention consolidation / multi-entry / "work_prompts + personal_prompts" / "consolidate". Add a requirement that help text mentions `--force` and the CLI-managed-entry contract.
   - **Keep T4.6, T4.7 + reframe:** canonical-only config doesn't trigger any gate — trivially true, but keep as regression guards that configure runs cleanly in simple cases.
   - **Keep T5.4 unchanged:** status rendering of multi-entry state.
   - **Rewrite T6.8, T6.8b, T6.8c, T6.8d** to reflect canonical-only `--delete-tokens` semantics. A user's non-canonical PAT is NOT revoked. Add a sub-test for the shared-PAT warning path (canonical PAT matches a non-canonical PAT still on disk → warning fires) and the non-CLI-token note path (canonical entry with user-pasted PAT → note fires).
   - **Do NOT modify T8.4/T8.5** at lines 2228-2238. These intentionally invoke `--scope local` and `--scope project` to verify that the CLI rejects the old scope names. The `--scope local` sweep in step 5 below explicitly exempts them.
   - **Add:** a new short section (or append to Phase 3) with five E2E tests:
     - Configure preserves `work_prompts` + `personal_prompts` AND the summary line lists them.
     - Configure re-run updates canonical in place; non-canonical untouched.
     - Configure refuses when canonical key points at non-Tiddly URL; error names the file path and key; no token minted.
     - Configure `--force` with the same bad canonical entry proceeds and overwrites; stderr shows the `Forcing overwrite of …` line.
     - Remove with canonical + non-canonical present → canonical removed, non-canonical survives; `--delete-tokens` revokes only the canonical PAT; shared-PAT warning fires when canonical PAT matches a retained non-canonical PAT; non-CLI-token note fires when canonical PAT is user-pasted.

5. **`cmd/mcp_test.go` additions**:
   - `TestMCPConfigure__yes_flag_is_unknown_after_removal`: invoke `tiddly mcp configure --yes` (via the test CLI harness). Assert non-zero exit and error output contains Cobra's `unknown flag: --yes` message (or equivalent). Regression guard against accidentally re-introducing the flag. Lives in `cmd/mcp_test.go` (per `TestMCP*` naming convention), not `configure_test.go`.

6. **Project-level docs audit** (per `AGENTS.md` "Files to Keep in Sync"):
   - Search each of `README.md`, `frontend/public/llms.txt`, `frontend/src/pages/docs/DocsCLIReference.tsx`, `frontend/src/pages/docs/DocsKnownIssues.tsx`, `docs/ai-integration.md`, and any marketing/landing copy for the strings: "consolidate", "consolidation", "--yes", "work_prompts", "migrations from manual setups safe", and (with the exceptions below) "--scope local".
   - **`--scope local` exceptions — do not edit these legitimate references:**
     - `cli/agent_testing_procedure.md` T8.4/T8.5 (rejection-test fixtures).
     - `docs/ai-integration.md` line 108, which maps Tiddly's `directory` scope to Claude Code's native `--scope local` flag in a cross-reference table. The `--scope local` token is describing Claude Code's own API, not Tiddly's.
   - Rewrite any "migrations from manual setups safe" prose to describe the new additive safety instead (e.g. in `DocsCLIMCP.tsx` around the old line 136).

**Testing strategy:**

- After help-text edits, run the CLI and paste `tiddly mcp configure --help` and `tiddly mcp remove --help` output into the PR description for reviewer eyeball.
- `make frontend-verify` must pass (DocsCLIMCP changes are small JSX edits — minimal blast radius).
- `TestMCPConfigure__yes_flag_is_unknown_after_removal` must pass (regression guard for `--yes` removal).
- No unit tests for doc prose. The E2E procedure doc is reviewer-checked; the agent should not try to execute it.

**Docs:** Everything in this milestone is a doc change except the regression test in step 5.

---

## Definition of done (global)

- `make cli-verify` passes.
- `make frontend-verify` passes (DocsCLIMCP edit).
- Agent provides a summary of what was deleted vs. kept vs. modified, cross-referenced against this plan's milestones.
- Agent pastes the new `configure --help` and `remove --help` output in the PR description so the reviewer can eyeball the user-facing copy.
- Agent confirms (with grep output) that no unresolved references to `consolidation`, `ConsolidationGroup`, `ErrConsolidation*`, `promptYesNo`, `AssumeYes`, `detectConsolidations`, or `writeConsolidationWarning` remain in the `cli/` tree or frontend docs.
- Agent confirms (with grep output) that the word "canonical" no longer appears in user-facing copy under `frontend/src/pages/docs/` or `cli/cmd/*.go` Long strings (internal code comments may still use it).
- Non-canonical Tiddly-URL entries are demonstrably preserved across configure and remove, per the new tests.
- The shared-PAT warning fires correctly when a canonical PAT is also referenced by a retained non-canonical entry, per the new test.
- The non-CLI-token note fires correctly when a canonical entry's PAT doesn't match any `cli-mcp-`-named server-side token, per the new test.
- Canonical-key-on-non-Tiddly-URL triggers a fail-closed error in preflight (before any token mint), per the new test.
- `--force` on configure overrides the fail-closed refusal and emits the `Forcing overwrite of …` line to stderr in non-dry-run mode only, per the new tests.
- `tiddly mcp remove` deletes canonical-named entries regardless of URL, per the new test.

## Out of scope

- PAT lifecycle semantics (mint/revoke flow, expiration handling) beyond what's already in `configure.go`.
- URL-based classification (`classifyServer`, `isTiddlyURL`, etc.) — correct as-is, used by status rendering AND reused by preflight for canonical-URL-mismatch detection and preserved-entries derivation.
- Skills (`tiddly skills configure/remove`) — unrelated surface.
- Any opt-in "revoke all Tiddly-URL PATs" flag for `remove`. If useful, a separate ticket.
- The `mcp status` multi-entry grouping — informational, unchanged.
- A guided CLI flow for removing user-custom non-canonical entries (e.g. `tiddly mcp cleanup work_prompts`). Documented as a manual file-edit for now; a separate ticket can add this if user demand materializes.
- Normalizing the handler-signature asymmetry between `buildClaudeDesktopConfig(configPath, ...)` and the other two (`rc ResolvedConfig`). Pre-existing cosmetic inconsistency, unrelated to this plan's goals.
- Codex deprecated skills path (`~/.codex/skills/`) — that's tracking an external tool's (OpenAI Codex's) own path migration, not Tiddly backwards-compat. Not in scope here.
