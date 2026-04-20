# CLI `mcp configure`: Additive Behavior for Non-Canonical Tiddly Entries

**Date:** 2026-04-20
**Status:** Planned
**Breaking change:** Yes — removes `--yes` flag, removes the interactive consolidation gate, and changes `mcp remove --delete-tokens` default semantics. No backwards-compatibility shim required.
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
- If a canonical entry already exists, it's updated in place — **validate-then-mint** semantics from the existing PR are preserved (validate the existing PAT via `/users/me`; reuse if valid, mint fresh if rejected).
- `tiddly mcp remove` becomes canonical-only by default — removes only `tiddly_notes_bookmarks` / `tiddly_prompts`. Non-canonical entries survive. `--delete-tokens` only revokes PATs attached to canonical entries.
- The consolidation gate, Y/N prompt, `--yes` flag, and `ErrConsolidation*` sentinels are removed entirely.

### What we keep from PR #117

Most of the PR's infrastructure is orthogonal to consolidation and stays:

- Timestamped backup writes with O_EXCL collision handling (`config_io.go`).
- Commit-phase failure revokes already-minted tokens (`revokeMintedTokens`, `withRevokeError`, detached `cleanupCtx`).
- Dry-run Bearer token redaction (`redactBearers`, `bearerRE`).
- `Configure`/`Remove` handler signatures returning `backupPath`.
- Partial-result contract (`ConfigureResult` surfaces what completed before a mid-run failure).
- `classifyServer` extraction and secondary-sort tiebreaker in `status.go` — needed to render multi-entry state correctly.
- `--help` text enumeration of the three supported tools.
- `AllTiddlyPATs` handler method (repurposed — see Milestone 3).
- Validate-then-mint fallback (repurposed — applies to the canonical entry only).

### What we delete from PR #117

- `cli/internal/mcp/consolidation.go` (entire file: `ConsolidationGroup`, `detectConsolidations`, `writeConsolidationWarning`, `survivorNameFor`, `canonicalNameForServerType`, `allServerTypes`).
- `cli/internal/mcp/consolidation_test.go` (entire file).
- `cli/internal/mcp/prompt.go` and `prompt_test.go` (Y/N TTY prompt — no prompt means no helper).
- `ErrConsolidationDeclined`, `ErrConsolidationNeedsConfirmation` in `configure.go`.
- `ConfigureOpts.AssumeYes`, `ConfigureOpts.Stdin`, `ConfigureOpts.IsInteractive`.
- `preflightedTool.consolidations`, `anyConsolidations`, `confirmConsolidations`, `detectConsolidations` call sites in `RunConfigure`.
- The "Consolidation required:" header emission in dry-run and commit paths.
- `--yes` / `-y` flag wiring and `translateConfigureError` in `cmd/mcp.go`.
- `PATExtraction.ContentName` and `PATExtraction.PromptName` fields (only `writeConsolidationWarning` consumed them).
- Consolidation-focused tests in `configure_test.go`: `TestRunConfigure__consolidation_prompt_proceeds_on_{yes,no}`, `__consolidation_non_interactive_errors_without_yes`, `__consolidation_declining_before_writes_*`, `__single_gate_across_multiple_tools`, `__oauth_multi_entry_proceed_reuses_surviving_pat`, `__consolidation_assume_yes_bypasses_prompt`, and the `dry_run_warns_about_multi_entry_consolidation` group. Handler-specific tests that assert "non-canonical entry is removed on configure" also go.
- Phase 4 of `cli/agent_testing_procedure.md` (T4.1/2/4/8/8b/9/9b/10/11).

---

## Open questions resolved

Per the request's "Open questions for the implementer" section — each is decided below so the agent does not default to prior behavior without a stated reason.

1. **`--delete-tokens` semantics on `mcp remove`** — Canonical-only by default. `tiddly mcp remove claude-code --delete-tokens` revokes PATs from `tiddly_notes_bookmarks` / `tiddly_prompts` only. A user's `work_prompts` PAT is not touched because it wasn't in a CLI-managed entry. No opt-in flag for the old "nuke all Tiddly-URL PATs" behavior in this change — if a user legitimately needs that, it's a follow-up feature.
2. **Status rendering** — Unchanged. `tiddly mcp status` continues to group every Tiddly-URL entry under "Tiddly servers" (canonical + custom). Informational; reflects the user's real setup.
3. **Dry-run output** — No "Consolidation required:" header. The dry-run diff shows only the canonical entry being added or updated; non-canonical entries appear in neither `before` nor `after` as diffs (they're unchanged).
4. **Deprecation / migration path** — None needed. The old consolidation behavior was gated on `--yes` or an interactive prompt, so no silent consolidation happened in the wild. Users whose scripts pass `--yes` today will get an "unknown flag" error after this change — acceptable, the CLI is pre-GA, and the remediation is "remove the flag."
5. **Obsolete tests** — Delete rather than rework. Listed explicitly in each milestone.
6. **`survivorsOfAllTiddlyPATs` helper** — Reduced to "find the canonical entry's PAT, if any." Renamed to `canonicalEntryPATs`. `PATExtraction` collapses to `{ContentPAT, PromptPAT}` (Name fields deleted). The function only walks canonical entries — non-canonical PATs are no longer reuse candidates because `configure` doesn't touch those entries.
7. **`--yes` flag** — Deleted, not kept as a no-op. No other confirmation point remains in `configure`. Flag surface removals are fine pre-GA.

---

## Architectural decision: refactor in place, don't revert

We keep commit `3d7a1b1` and surgically remove the consolidation layer. Rationale:

- The KEEP set touches every file in the PR. A revert-and-cherry-pick reapplies ~70% of the diff by hand.
- Signature changes (`Configure`/`Remove` → `backupPath`; `PATExtraction`) ripple through all three handlers and their tests.
- The `classifyServer` extraction and status secondary-sort tiebreaker are dependencies of "render multi-entry state correctly" — which the new request explicitly keeps.

---

## Reference reading for the agent

Before implementing, read these files to understand current structure and what's being removed:

- `cli/internal/mcp/configure.go` — focus on `RunConfigure`, `preflightedTool`, `confirmConsolidations`, `resolveToolPATs`, `resolveServerPAT`.
- `cli/internal/mcp/consolidation.go` — entire file (being deleted).
- `cli/internal/mcp/prompt.go` — entire file (being deleted).
- `cli/internal/mcp/handler.go` — `TiddlyPAT`, `PATExtraction`, `ToolHandler` interface, `survivorsOfAllTiddlyPATs`.
- `cli/internal/mcp/claude_code.go`, `claude_desktop.go`, `codex.go` — `extractAll*TiddlyPATs` and `extract*PATs` pairs.
- `cli/cmd/mcp.go` — `newMCPConfigureCmd`, `newMCPRemoveCmd`, `translateConfigureError`, `--yes` flag wiring.
- `cli/agent_testing_procedure.md` — Phase 4 overall shape (understand what's being deleted), Phase 1–3 to preserve.
- `frontend/src/pages/docs/DocsCLIMCP.tsx` — current docs state.

No external documentation URLs apply to this change.

---

## Agent behavior (global)

- Complete each milestone fully (code + tests + docs) before moving to the next. Stop and request human review at the end of each milestone.
- Run `make cli-verify` at the end of each milestone; it must pass before proceeding (exception: Milestone 1 deliberately leaves the package broken — see its test strategy).
- Ask for clarification when requirements are ambiguous. Do not assume.
- Remove legacy code rather than leaving dead paths. Breaking changes are acceptable.
- Prefer deleting obsolete tests outright over reworking them into something weaker.
- Type hints and clear naming as per `cli/` Go conventions already in use.

---

## Milestones

### Milestone 1 — Delete the consolidation module and prompt helper

**Goal & outcome:**
Remove the consolidation concept at the lowest layer (no consumers yet updated). After this milestone the package won't compile — that's expected; Milestone 2 fixes it.

- `consolidation.go`, `consolidation_test.go`, `prompt.go`, `prompt_test.go` no longer exist.
- The two sentinel errors are gone from the package.

**Implementation outline:**

1. Delete `cli/internal/mcp/consolidation.go` and `cli/internal/mcp/consolidation_test.go`.
2. Delete `cli/internal/mcp/prompt.go` and `cli/internal/mcp/prompt_test.go`.
3. In `configure.go`, delete `ErrConsolidationDeclined`, `ErrConsolidationNeedsConfirmation`.
4. Do NOT touch `RunConfigure` or `ConfigureOpts` yet — that's Milestone 2. This milestone deliberately leaves the package in a broken state to keep the diffs reviewable.

**Testing strategy:**
Build will fail (`confirmConsolidations`, `detectConsolidations`, `writeConsolidationWarning`, `promptYesNo`, `defaultIsInteractive`, `ConsolidationGroup`, `PATExtraction.{Content,Prompt}Name`, `ErrConsolidation*` all become undefined). Agent should confirm the expected compile errors exist and move to Milestone 2 without "fixing" them in isolation. This is a deliberate checkpoint so the reviewer sees the removal diff cleanly before the refactor diff lands on top.

**Docs:** None in this milestone.

---

### Milestone 2 — Simplify `RunConfigure` to additive semantics

**Goal & outcome:**
`tiddly mcp configure` writes only canonical entries and leaves non-canonical Tiddly-URL entries untouched. The consolidation gate, preflight consolidation detection, and all phase-2 logic are removed. Validate-then-mint on the canonical entry's PAT still works. Handler-level "write canonical entries, preserve others" semantics are enforced.

- `configure` run with pre-existing `work_prompts` + `personal_prompts` → those entries survive unchanged; canonical entries are added/updated.
- `configure` re-run when canonical is already present → canonical updated in place (same validate-then-mint); non-canonical untouched.
- Dry-run output shows only the canonical-entry diff; no "Consolidation required:" header.
- Commit-phase token revoke-on-failure behavior from PR #117 preserved.

**Implementation outline:**

1. **`configure.go`**:
   - Remove `ConfigureOpts.AssumeYes`, `ConfigureOpts.Stdin`, `ConfigureOpts.IsInteractive`.
   - Remove `preflightedTool.consolidations` field.
   - Remove `anyConsolidations`, `confirmConsolidations`, and the Phase 2 gate call in `RunConfigure`.
   - In `RunConfigure`, delete the preflight block that populates `groups` / `SurvivorName` via `detectConsolidations` and `handler.ExtractPATs`. Preflight still reads `handler.Status` (dry-run tolerates read errors; real-run fail-closes on status errors — that behavior stays).
   - In the commit loop, delete the `if len(pf.consolidations) > 0 { writeConsolidationWarning(...) }` branch in dry-run output. The diff alone is the preview.
   - Delete the "Consolidation required:" header emission in both dry-run and non-dry-run paths.
   - Keep: `resolveToolPATs`, `resolveServerPAT` (validate-then-mint), `mintedToken`, `toolPATResolution`, `withRevokeError`, `revokeMintedTokens`, `cleanupTimeout`, `redactBearers`, `printDiff`, `BackupRecord`, `ConfigureResult`.

2. **`handler.go`**:
   - Collapse `PATExtraction` to `{ContentPAT, PromptPAT}` — delete the two `Name` fields.
   - Rename `survivorsOfAllTiddlyPATs` → `canonicalEntryPATs`. Update its semantics: only match canonical-named entries (`tiddly_notes_bookmarks` / `tiddly_prompts`) rather than "first PAT per type from a canonical-first-sorted list." This is the key behavior change — non-canonical entries are no longer considered for PAT reuse. The doc comment must state this explicitly.
   - `AllTiddlyPATs` interface method stays — Milestone 3 repurposes its caller.

   ```go
   // canonicalEntryPATs extracts the Bearer tokens from entries whose config
   // key matches the canonical names (tiddly_notes_bookmarks, tiddly_prompts).
   // Non-canonical Tiddly-URL entries (e.g. work_prompts) are deliberately
   // excluded — configure never touches them, so their PATs are not reuse
   // candidates.
   func canonicalEntryPATs(all []TiddlyPAT) PATExtraction { /* ... */ }
   ```

3. **Per-handler files (`claude_code.go`, `claude_desktop.go`, `codex.go`)**:
   - `extractAll*TiddlyPATs` functions stay (used by `AllTiddlyPATs` for status rendering and Milestone 3's remove path).
   - `extract*PATs` functions (the survivor-picking variants) are simplified: walk the config, find entries whose **key name is canonical** AND whose URL classifies as a matching Tiddly URL, return their PATs. No sorting, no "first match" semantics needed once the filter is canonical-name-only.
   - **Key invariant for `Configure`**: the JSON/TOML write path must preserve non-canonical entries (keys, values, ordering where the format preserves ordering). Claude Code and Claude Desktop use structured reads/writes that already preserve unrelated keys; verify. Codex (TOML) needs the same verification.
   - **Search each handler's `Configure` for URL-based delete logic** introduced by PR #117. Any "remove all Tiddly-URL entries before writing canonical ones" step must become "remove canonical-named entries before rewriting them; leave URL-matching-but-non-canonical-named entries alone." This is the most important substantive change in this milestone — easy to miss, easy to regress.
   - `Remove` path changes deferred to Milestone 3.

**Testing strategy (`configure_test.go`):**

- **Delete:** all consolidation-prompt tests (`TestRunConfigure__consolidation_prompt_proceeds_on_yes`, `_on_no`, `_non_interactive_errors_without_yes`, `_declining_before_writes_*`, `_single_gate_across_multiple_tools`, `_oauth_multi_entry_proceed_reuses_surviving_pat`, `_consolidation_assume_yes_bypasses_prompt`); all `dry_run_warns_about_multi_entry_consolidation*` tests.
- **Keep:** `TestPrintDiff__redacts_bearer_across_all_three_formats`, `TestRunConfigure__commit_phase_failure_preserves_earlier_writes`, `_oauth_commit_failure_revokes_minted_tokens`, `_oauth_commit_failure_with_revoke_failure_surfaces_orphans`, `_commit_phase_failure_surfaces_backup_path`, `_preflight_failure_returns_nil_result`, `TestRevokeMintedTokens__*`, `_status_error_aborts_non_dry_run`.
- **Add (core of the behavior change):**
  - `TestRunConfigure__additive_preserves_non_canonical_tiddly_entries`: configure with pre-existing `work_prompts` + `personal_prompts` pointing at Tiddly URLs. Assert both entries survive unchanged (key name, URL, headers/args including the original PAT). Assert canonical entries are added. Run once per handler (JSON, JSON, TOML).
  - `TestRunConfigure__reuses_canonical_pat_when_valid`: canonical entry already present with a valid PAT. Assert the PAT is reused (no mint call), the entry is rewritten in place with the same PAT, and non-canonical entries nearby are untouched.
  - `TestRunConfigure__mints_fresh_when_canonical_pat_invalid`: canonical entry already present with a stale PAT. Fake `validatePAT` to return `(false, nil)`. Assert a new token is minted, written to the canonical entry, and non-canonical entries are untouched.
  - `TestRunConfigure__does_not_reuse_pat_from_non_canonical_entry`: no canonical entry, but `work_prompts` exists with a valid PAT. Assert configure **mints** a fresh token instead of reusing the `work_prompts` PAT. This is the explicit behavior change from PR #117.
  - `TestRunConfigure__dry_run_shows_only_canonical_diff`: with non-canonical entries present, assert the dry-run output does not show `work_prompts` as a changed line. (The key may appear unchanged in `before`/`after` — what must NOT happen is a deletion line.)
- **Per-handler tests** (`claude_code_test.go`, `claude_desktop_test.go`, `codex_test.go`):
  - Remove tests asserting `Configure` deletes non-canonical Tiddly-URL entries.
  - Add a direct handler-level test for each: given a config with a canonical entry + a non-canonical Tiddly-URL entry + unrelated non-Tiddly entries, calling `Configure` preserves the non-canonical Tiddly entry and the unrelated entries verbatim.
  - `ExtractPATs` tests: update to reflect `{ContentPAT, PromptPAT}` only (drop Name assertions) and canonical-name-only semantics (non-canonical entries no longer contribute).

**Docs:** None in this milestone — CLI help and doc pages update in Milestone 4.

---

### Milestone 3 — Canonical-only `mcp remove` (+ `--delete-tokens`)

**Goal & outcome:**
`tiddly mcp remove` only removes canonical entries by default. Non-canonical Tiddly-URL entries survive. `--delete-tokens` revokes only PATs attached to canonical entries.

- `tiddly mcp remove claude-code` with canonical + non-canonical entries present → canonical removed, non-canonical survives.
- `tiddly mcp remove claude-code --delete-tokens` → revokes PATs for canonical entries only; `work_prompts` PAT is untouched server-side.
- Orphan-token warning (`CheckOrphanedTokens`) scans canonical-named `cli-mcp-*` tokens only (already name-based, so it's correct — just confirm).

**Implementation outline:**

1. **Per-handler `Remove` method**: change the deletion predicate from "any entry matching a Tiddly URL" to "entry whose key name is canonical AND URL classifies as matching Tiddly." The URL check is a belt-and-suspenders guard against a user who reassigned `tiddly_notes_bookmarks` to a non-Tiddly URL; we don't touch that. For `--servers content` / `--servers prompts`, filter by canonical name for the requested type.

2. **`cmd/mcp.go` — `newMCPRemoveCmd`**:
   - The PAT-collection block (around lines 372–411) currently uses `handler.AllTiddlyPATs(rc)` and filters by server type only. Add a canonical-name filter. Options: walk `AllTiddlyPATs` and skip non-canonical names, or introduce a `handler.CanonicalPATs(rc)` that walks canonical entries directly. The agent should pick based on code simplicity — if it's a two-line filter inline, prefer that over a new interface method.
   - The "Warning: token is shared with X server (still configured)" check becomes: only fire if the retained **canonical** server's PAT equals one of the revoke-targets. Since both operands are now canonical-only, the warning only fires when the user ran canonical content and canonical prompts with the **same** PAT and only removed one.

3. **`AllTiddlyPATs` interface method** — stays. Used by:
   - Status rendering (unchanged).
   - Potentially nothing else after this milestone. If the agent prefers to rename it to reflect narrower usage (e.g. `AllTiddlyServerPATs`), acceptable but not required.

**Testing strategy (`cmd/mcp_test.go` and per-handler tests):**

- **Delete:** `TestTranslateConfigureError__*` (all four — the sentinels are gone).
- **Modify:** `TestMCPRemove__delete_tokens_multi_entry_revokes_all` → rename to `..._revokes_canonical_only` and assert non-canonical PATs are NOT in the DELETE call set.
- **Keep:** `TestMCPRemove__delete_tokens_dedups_shared_pat` (still valid — canonical content + canonical prompts can share a PAT), `TestMCPConfigure__dry_run_surfaces_pat_auth_warning`.
- **Add:**
  - `TestMCPRemove__preserves_non_canonical_entries`: per-handler, given canonical + `work_prompts` (Tiddly URL, different PAT), assert remove deletes only the canonical entry and leaves `work_prompts` byte-preserved.
  - `TestMCPRemove__delete_tokens_ignores_non_canonical_pats`: as above, plus `--delete-tokens`, assert the revoke set contains only the canonical entry's PAT.
  - `TestMCPRemove__shared_pat_warning_fires_on_canonical_split`: canonical content and canonical prompts share a PAT; `--servers content --delete-tokens`; assert warning fires.
  - `TestMCPRemove__shared_pat_warning_silent_when_non_canonical_shares`: canonical prompts shares a PAT with non-canonical `work_prompts`; `--delete-tokens`; assert warning does NOT fire (non-canonical isn't a retained-by-CLI binding).

**Docs:** None in this milestone.

---

### Milestone 4 — CLI help, docs, and E2E test plan cleanup

**Goal & outcome:**
User-visible surface (help text, docs, test plan doc) reflects the additive semantics. No references to consolidation, `--yes`, or the Y/N prompt remain.

- `tiddly mcp configure --help` and `tiddly mcp remove --help` are accurate.
- `frontend/src/pages/docs/DocsCLIMCP.tsx` explains the additive contract.
- `cli/agent_testing_procedure.md` Phase 4 is removed; related sections reflect the new semantics.

**Implementation outline:**

1. **`cmd/mcp.go` — Long strings**:
   - `newMCPConfigureCmd`: remove paragraphs describing consolidation and `--yes`. Replace with a sentence like: "Non-canonical Tiddly-URL entries (e.g. `work_prompts`) are not touched by configure — the CLI only manages entries under canonical names (`tiddly_notes_bookmarks`, `tiddly_prompts`)."
   - Remove the `--yes` flag registration (`cmd.Flags().BoolVarP(&assumeYes, "yes", "y", ...)`) and the `AssumeYes: assumeYes` field in `opts`.
   - Remove the `assumeYes` local variable.
   - Remove `translateConfigureError`. Call site (`return translateConfigureError(err)`) becomes `return err`.
   - Remove the `errors` import if no longer used.
   - `newMCPRemoveCmd`: note in the Long string that remove is canonical-only — non-canonical Tiddly-URL entries survive.

2. **`frontend/src/pages/docs/DocsCLIMCP.tsx`**:
   - Add a short section describing the additive contract. One paragraph, no header required if it fits naturally. Suggested copy: "`tiddly mcp configure` manages only two canonical entries: `tiddly_notes_bookmarks` and `tiddly_prompts`. Any other entries pointing at Tiddly URLs (for example, `work_prompts` or `personal_prompts` if you set up multiple accounts in one tool) are left alone by both `configure` and `remove`. You can run configure safely on a multi-account setup — it won't touch the entries you added."
   - Remove any existing mention of consolidation, `--yes`, or the Y/N prompt if present (likely none — the request notes that section was reverted previously).

3. **`cli/agent_testing_procedure.md`**:
   - **Delete entirely:** Phase 4 section and T4.1, T4.2, T4.4, T4.8, T4.8b, T4.9, T4.9b, T4.10, T4.11.
   - **Keep + reframe:** T4.6, T4.7 (canonical-only config doesn't trigger any gate — trivially true, but keep as regression guards that configure runs cleanly in simple cases). T5.4 (status rendering of multi-entry state — unchanged).
   - **Rewrite:** T6.8, T6.8b, T6.8c, T6.8d — reflect canonical-only `--delete-tokens` semantics. A user's non-canonical PAT is NOT revoked.
   - **Add:** a new short section (or append to Phase 3) with three E2E tests:
     - Configure preserves `work_prompts` + `personal_prompts`.
     - Configure re-run updates canonical in place; non-canonical untouched.
     - Remove with canonical + non-canonical present → canonical removed, non-canonical survives; `--delete-tokens` revokes only the canonical PAT.

4. **Project-level docs audit** (per `AGENTS.md` "Files to Keep in Sync"):
   - Search each of `README.md`, `frontend/public/llms.txt`, `frontend/src/pages/docs/DocsCLIReference.tsx`, `frontend/src/pages/docs/DocsKnownIssues.tsx`, and any marketing/landing copy for the strings "consolidate", "consolidation", "--yes", "work_prompts". Edit or remove as needed. Likely zero hits outside `DocsCLIMCP.tsx` but confirm.

**Testing strategy:**

- After help-text edits, run the CLI and paste `tiddly mcp configure --help` and `tiddly mcp remove --help` output into the PR description for reviewer eyeball.
- `make frontend-verify` must pass (the DocsCLIMCP change is a small JSX edit — minimal blast radius).
- No unit tests for doc prose. The E2E procedure doc is reviewer-checked; the agent should not try to execute it.

**Docs:** Everything in this milestone is a doc change.

---

## Definition of done (global)

- `make cli-verify` passes.
- `make frontend-verify` passes (DocsCLIMCP edit).
- Agent provides a summary of what was deleted vs. kept vs. modified, cross-referenced against this plan's milestones.
- Agent pastes the new `configure --help` and `remove --help` output in the PR description so the reviewer can eyeball the user-facing copy.
- No unresolved references to `consolidation`, `--yes`, `ConsolidationGroup`, `ErrConsolidation*`, or `promptYesNo` in the `cli/` tree or frontend docs.
- Non-canonical Tiddly-URL entries are demonstrably preserved across configure and remove, per the new tests.

## Out of scope

- PAT lifecycle semantics (mint/revoke flow, expiration handling) beyond what's already in `configure.go`.
- URL-based classification (`classifyServer`, `isTiddlyURL`, etc.) — correct as-is, used by status rendering.
- Skills (`tiddly skills configure/remove`) — unrelated surface.
- Any opt-in "revoke all Tiddly-URL PATs" flag for `remove`. If useful, a separate ticket.
- The `mcp status` multi-entry grouping — informational, unchanged.
