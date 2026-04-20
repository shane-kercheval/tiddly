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
- `AllTiddlyPATs` handler method (repurposed — see Milestone 2).
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

- `cli/internal/mcp/configure.go` — focus on `RunConfigure`, `preflightedTool`, `confirmConsolidations`, `resolveToolPATs`, `resolveServerPAT`, and the preflight `handler.Status` call.
- `cli/internal/mcp/consolidation.go` — entire file (being deleted).
- `cli/internal/mcp/prompt.go` — entire file (being deleted).
- `cli/internal/mcp/handler.go` — `TiddlyPAT`, `PATExtraction`, `ToolHandler` interface, `survivorsOfAllTiddlyPATs`.
- `cli/internal/mcp/claude_code.go`, `claude_desktop.go`, `codex.go` — `extractAll*TiddlyPATs` and `extract*PATs` pairs, plus the `removeJSONServersByTiddlyURL` / `removeCodexServersByTiddlyURL` call inside each `build*Config`.
- `cli/cmd/mcp.go` — `newMCPConfigureCmd`, `newMCPRemoveCmd`, `translateConfigureError`, `--yes` flag wiring.
- `cli/agent_testing_procedure.md` — Phase 4 overall shape (understand what's being deleted), Phase 1–3 to preserve, and the scattered `--yes` / consolidation references at lines 3, 954–955, 1015, 1017.
- `frontend/src/pages/docs/DocsCLIMCP.tsx` — current docs state.
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

---

## Milestones

### Milestone 1 — Additive `configure` (consolidation removed)

**Goal & outcome:**
`tiddly mcp configure` writes only canonical entries and leaves non-canonical Tiddly-URL entries untouched. Consolidation module, prompt helper, preflight `Status` call, and the gate are all removed in a single step. Validate-then-mint on the canonical entry's PAT is preserved. Tree stays green — no deliberately-broken intermediate.

- `configure` run with pre-existing `work_prompts` + `personal_prompts` → those entries survive unchanged; canonical entries are added/updated.
- `configure --servers content` when canonical `tiddly_prompts` exists → `tiddly_prompts` is byte-preserved.
- `configure` re-run when canonical is already present → canonical updated in place (same validate-then-mint); non-canonical untouched.
- Dry-run output shows only the canonical-entry diff; no "Consolidation required:" header.
- Commit-phase token revoke-on-failure behavior from PR #117 preserved.
- `make cli-verify` passes at the milestone boundary.

**Implementation outline:**

1. **Delete files:** `cli/internal/mcp/consolidation.go`, `consolidation_test.go`, `prompt.go`, `prompt_test.go`.

2. **`configure.go`**:
   - Delete `ErrConsolidationDeclined`, `ErrConsolidationNeedsConfirmation`.
   - Remove `ConfigureOpts.AssumeYes`, `.Stdin`, `.IsInteractive`.
   - Remove `preflightedTool.consolidations` field.
   - Remove `anyConsolidations`, `confirmConsolidations` functions and the Phase 2 gate call site.
   - **Remove the preflight `handler.Status` call entirely** (`configure.go:235-243`). Its only consumer was `detectConsolidations`; with that gone, the Status read — and its dry-run-tolerant vs. real-run fail-closed branching — serves no purpose. Preflight collapses to `ResolveToolConfig` + handler lookup. Config-read failures still surface naturally via the handler's own `Configure` / `DryRun` call in the commit loop.
   - In the commit loop, delete the `if len(pf.consolidations) > 0 { writeConsolidationWarning(...) }` branch in the dry-run output block and the "Consolidation required:" header emission in both paths.
   - Keep: `resolveToolPATs`, `resolveServerPAT` (validate-then-mint), `mintedToken`, `toolPATResolution`, `withRevokeError`, `revokeMintedTokens`, `cleanupTimeout`, `redactBearers`, `printDiff`, `BackupRecord`, `ConfigureResult`, `tiddlyURLMatcher` (still used by the remove path).

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

   - `AllTiddlyPATs` interface method stays — Milestone 2 repurposes its caller.

4. **Per-handler files (`claude_code.go`, `claude_desktop.go`, `codex.go`)**:
   - `extractAll*TiddlyPATs` functions stay (used by `AllTiddlyPATs` for status rendering and Milestone 2's remove path).
   - `extract*PATs` survivor variants simplify to: walk the config, return PATs from entries whose **key name is canonical** AND whose URL classifies as a matching Tiddly URL. No sorting needed once the filter is canonical-name-only.
   - **Delete the URL-based removal call inside each build path:**
     - `claude_code.go:190` — remove `removeJSONServersByTiddlyURL(servers, tiddlyURLMatcher(contentPAT, promptPAT))` from `buildClaudeCodeConfig`.
     - `claude_desktop.go:60` — remove the same call from `buildClaudeDesktopConfig`.
     - `codex.go:89` — remove `removeCodexServersByTiddlyURL(...)` from `buildCodexConfig`.

     **Rationale:** Go map assignment (`servers[serverNameContent] = ...`) overwrites the canonical key in place regardless of whether it pre-existed. Non-canonical entries are never referenced by that assignment and survive by default. No predicate to rewire, no `--servers` scope logic to encode in the delete step. The removal helpers themselves (`removeJSONServersByTiddlyURL`, `removeCodexServersByTiddlyURL`) stay — they're still used by the Remove path in Milestone 2.
   - `Remove` path changes deferred to Milestone 2.

**Testing strategy (`configure_test.go`):**

- **Delete:** all consolidation-prompt tests (`TestRunConfigure__consolidation_prompt_proceeds_on_yes`, `_on_no`, `_non_interactive_errors_without_yes`, `_declining_before_writes_*`, `_single_gate_across_multiple_tools`, `_oauth_multi_entry_proceed_reuses_surviving_pat`, `_consolidation_assume_yes_bypasses_prompt`); all `dry_run_warns_about_multi_entry_consolidation*` tests; **and `TestRunConfigure__status_error_aborts_non_dry_run`** — the behavior it tests (preflight fail-close on Status read error) is gone with the Status call itself.
- **Keep:** `TestPrintDiff__redacts_bearer_across_all_three_formats`, `TestRunConfigure__commit_phase_failure_preserves_earlier_writes`, `_oauth_commit_failure_revokes_minted_tokens`, `_oauth_commit_failure_with_revoke_failure_surfaces_orphans`, `_commit_phase_failure_surfaces_backup_path`, `_preflight_failure_returns_nil_result`, `TestRevokeMintedTokens__*`, `TestTiddlyURLMatcher__*`.
- **Add (core of the behavior change):**
  - `TestRunConfigure__additive_preserves_non_canonical_tiddly_entries`: configure with pre-existing `work_prompts` + `personal_prompts` pointing at Tiddly URLs. Assert both entries survive unchanged (key name, URL, headers/args including the original PAT). Assert canonical entries are added. Run once per handler (JSON, JSON, TOML).
  - `TestRunConfigure__reuses_canonical_pat_when_valid`: canonical entry already present with a valid PAT. Assert the PAT is reused (no mint call), the entry is rewritten in place with the same PAT, and non-canonical entries nearby are untouched.
  - `TestRunConfigure__mints_fresh_when_canonical_pat_invalid`: canonical entry already present with a stale PAT. Fake `validatePAT` to return `(false, nil)`. Assert a new token is minted, written to the canonical entry, and non-canonical entries are untouched.
  - `TestRunConfigure__does_not_reuse_pat_from_non_canonical_entry`: no canonical entry, but `work_prompts` exists with a valid PAT. Assert configure **mints** a fresh token instead of reusing the `work_prompts` PAT. Explicit behavior change from PR #117.
  - `TestRunConfigure__dry_run_shows_only_canonical_diff`: with non-canonical entries present, assert the dry-run output does not show `work_prompts` as a changed line. (The key may appear unchanged in `before`/`after` — what must NOT happen is a deletion line.)
  - `TestRunConfigure__servers_content_leaves_canonical_prompts_untouched`: pre-existing canonical `tiddly_prompts` entry. Run `configure --servers content`. Assert `tiddly_prompts` is byte-preserved. Regression guard against a future reintroduction of `removeJSONServersByTiddlyURL` in the build path with wrong scope filtering.
- **Per-handler tests** (`claude_code_test.go`, `claude_desktop_test.go`, `codex_test.go`):
  - Remove tests asserting `Configure` deletes non-canonical Tiddly-URL entries.
  - Add a direct handler-level test for each: given a config with a canonical entry + a non-canonical Tiddly-URL entry + unrelated non-Tiddly entries, calling `Configure` preserves the non-canonical Tiddly entry and the unrelated entries verbatim.
  - `ExtractPATs` tests: update to reflect `{ContentPAT, PromptPAT}` only (drop Name assertions) and canonical-name-only semantics (non-canonical entries no longer contribute).

**Docs:** None in this milestone — CLI help and doc pages update in Milestone 3.

---

### Milestone 2 — Canonical-only `mcp remove` (+ `--delete-tokens`)

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

4. **`CheckOrphanedTokens` doc-comment addition** (`configure.go:625`). This function matches server-side tokens by name prefix `cli-mcp-{tool}-{serverType}-`; it does **not** inspect config content. After this change, a user who pasted a CLI-minted PAT into a non-canonical entry (e.g. their `work_prompts`) will see that token flagged as "potentially orphaned" by `remove` without `--delete-tokens`, even though it's still in use. Acceptable (it's a warning, not destructive) but pin it down with a comment so a future maintainer doesn't elevate this result to automated revocation:

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

### Milestone 3 — CLI help, docs, and E2E test plan cleanup

**Goal & outcome:**
User-visible surface (help text, docs, test plan doc, frontend widget) reflects the additive semantics. No references to consolidation, `--yes`, or the Y/N prompt remain. Tiddly-facing `--scope` vocabulary is consistent across docs and widget.

- `tiddly mcp configure --help` and `tiddly mcp remove --help` are accurate.
- `frontend/src/pages/docs/DocsCLIMCP.tsx` explains the additive contract.
- `frontend/src/components/AISetupWidget.tsx` references the current Tiddly-facing `--scope` vocabulary.
- `cli/agent_testing_procedure.md` Phase 4 is removed; the scattered `--yes` / consolidation references in Phase 1/3 are also cleaned up.

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

3. **`frontend/src/components/AISetupWidget.tsx`**:
   - The `--scope local` → `--scope directory` description change around line 431 (the `getAffectedFiles` Claude Code case) aligns the widget's displayed CLI command with the Tiddly-facing flag vocabulary used everywhere else. This edit is already present on-branch — keep it and land it as part of this milestone's doc-consistency sweep.

4. **`cli/agent_testing_procedure.md`** (expanded scope — not just Phase 4):
   - **Delete entirely:** Phase 4 section and T4.1, T4.2, T4.4, T4.8, T4.8b, T4.9, T4.9b, T4.10, T4.11.
   - **Edit line 3** (intro sentence listing covered areas): drop "consolidation gate (prompt / `--yes` / decline)" from the list of covered behaviors.
   - **Edit lines 954–955** (Phase 3 test-coverage table): remove the `TestRunConfigure__consolidation_prompt_proceeds_on_yes` / `_aborts_on_no` rows — those tests no longer exist.
   - **Edit line 1015** (Phase 3 `--help` flag-list check): remove `--yes` / `-y` from the expected flag enumeration.
   - **Edit line 1017** (Phase 3 help-text content check): drop the requirement that help text mention consolidation / multi-entry / "work_prompts + personal_prompts" / "consolidate".
   - **Keep + reframe:** T4.6, T4.7 (canonical-only config doesn't trigger any gate — trivially true, but keep as regression guards that configure runs cleanly in simple cases). T5.4 (status rendering of multi-entry state — unchanged).
   - **Rewrite:** T6.8, T6.8b, T6.8c, T6.8d — reflect canonical-only `--delete-tokens` semantics. A user's non-canonical PAT is NOT revoked.
   - **Add:** a new short section (or append to Phase 3) with three E2E tests:
     - Configure preserves `work_prompts` + `personal_prompts`.
     - Configure re-run updates canonical in place; non-canonical untouched.
     - Remove with canonical + non-canonical present → canonical removed, non-canonical survives; `--delete-tokens` revokes only the canonical PAT.

5. **Project-level docs audit** (per `AGENTS.md` "Files to Keep in Sync"):
   - Search each of `README.md`, `frontend/public/llms.txt`, `frontend/src/pages/docs/DocsCLIReference.tsx`, `frontend/src/pages/docs/DocsKnownIssues.tsx`, and any marketing/landing copy for the strings "consolidate", "consolidation", "--yes", "work_prompts", **and "--scope local"** (the last one catches any place the old Claude-Code-native scope name leaked into Tiddly-facing docs). Edit or remove as needed. Likely zero hits outside `DocsCLIMCP.tsx` and `AISetupWidget.tsx` but confirm.

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
