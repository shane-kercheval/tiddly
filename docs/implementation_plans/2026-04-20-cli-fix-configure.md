# CLI `mcp configure`: Additive Behavior for Non-Canonical Tiddly Entries

**Date:** 2026-04-20
**Status:** Planned
**Breaking change:** Yes — removes the consolidation gate, deletes the `--yes` flag entirely, adds a new `--force` flag on `mcp configure`, changes `mcp remove` default semantics (canonical-name-only, URL-agnostic), and changes two helper signatures (`DeleteTokensByPrefix` and `CheckOrphanedTokens`) to support structured per-entry attribution. Also extends `OtherServer` with a `URL` field and adds a new `CanonicalSlotPATs` interface method (distinct from the existing URL-based `AllTiddlyPATs`) so shared-PAT warnings and orphan-subtraction can see canonical-named entries regardless of URL. No backwards-compatibility shims. The CLI is pre-GA; users with scripted `--yes` invocations will see Cobra's "unknown flag" error and should drop the flag.
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
- If a canonical entry exists but points at either a non-Tiddly URL OR the wrong-type Tiddly URL (e.g. `tiddly_prompts` pointing at the content server), configure **fails closed** with an actionable error listing the file path, key name, and current URL. The user can (a) hand-edit to rename the entry, preserving their custom setup, or (b) re-run with `--force` to overwrite with the CLI-managed entry. In a multi-tool run, preflight aggregates mismatches across all successfully-inspected tools and presents a combined error — users fix all at once, not whack-a-mole.
- `tiddly mcp configure --dry-run` fails on canonical URL mismatch identically to a real run. `tiddly mcp configure --dry-run --force` is the way to preview the overwrite without committing.
- `tiddly mcp configure --force` overrides the canonical-URL-mismatch refusal only. It does NOT override any other safety check (dry-run still previews; token revoke-on-failure still runs; non-canonical entries are still preserved). `--force` applies to every tool in a multi-tool run — a user who wants to force one tool but not another should invoke configure once per tool. There is no short form (`-f` deliberately not registered).
- `tiddly mcp remove` becomes **canonical-name-only, URL-agnostic** by default — deletes `tiddly_notes_bookmarks` / `tiddly_prompts` regardless of what URL they point at. Non-canonical entries (e.g. `work_prompts`) survive. A user who repurposed a canonical key for a non-Tiddly service will see it removed if they run `tiddly mcp remove`; `.bak.<timestamp>` recovery is the safety net.
- `tiddly mcp remove --delete-tokens` only revokes PATs attached to canonical entries. A user's `work_prompts` PAT is not touched.
- When `--delete-tokens` is used and a canonical PAT is **also referenced by another retained entry on disk** (canonical or non-canonical, regardless of URL classification), the CLI warns before revoking — one consolidated line per canonical-entry-being-revoked, listing all retained entries that share the PAT. Revoking breaks those bindings.
- When `--delete-tokens` is used and the PAT on a canonical entry doesn't match any CLI-minted server-side token (name prefix `cli-mcp-`), the CLI prints a note referencing the specific canonical entry so an empty "Deleted tokens:" line isn't confusing.
- `mcp remove` without `--delete-tokens` surfaces an orphan-token warning based on server-side `cli-mcp-*` token names; this list is filtered to exclude tokens whose prefix matches a PAT still referenced by a retained entry on disk, so users don't see "potentially orphaned" warnings for tokens that are still in active use.
- `--delete-tokens` follows existing best-effort token-cleanup semantics, unchanged by this refactor: auth resolution prefers OAuth with PAT fallback; if resolution fails entirely the token-cleanup step is silently skipped (existing behavior, acknowledged UX rough edge); if resolution succeeds the cleanup is attempted regardless of auth type, with API errors surfaced as stderr warnings.
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
- `AllTiddlyPATs` handler method — stays URL-based (any entry whose URL classifies as a Tiddly URL, canonical name or not). The caller for shared-PAT warnings and orphan-subtraction unions its output with a new `CanonicalSlotPATs` method (see Open Question #12).
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
3. **Dry-run output** — No "Consolidation required:" header. The dry-run diff shows only the canonical entry being added or updated; non-canonical entries appear in neither `before` nor `after` as diffs (they're unchanged). `--dry-run` fails on canonical URL mismatch identically to a real run; `--dry-run --force` previews the overwrite via the existing diff (no separate "Forcing overwrite of …" stderr line in dry-run — the diff's `before` block already shows the non-Tiddly URL).
4. **Deprecation / migration path** — None. The CLI is pre-GA; users whose scripts pass `--yes` will see Cobra's "unknown flag" error. Remediation is "drop the flag." Clean break is preferable to a deprecation shim that stops meaning anything after one release.
5. **Obsolete tests** — Delete rather than rework. Listed explicitly in each milestone (test names verified against the file to prevent glob-misses).
6. **`survivorsOfAllTiddlyPATs` helper** — Reduced to "find the canonical entry's PAT, if any." Renamed to `canonicalEntryPATs`. `PATExtraction` collapses to `{ContentPAT, PromptPAT}` (Name fields deleted). The function only walks canonical entries — non-canonical PATs are no longer reuse candidates because `configure` doesn't touch those entries.
7. **Canonical key pointing at the wrong URL** — Fail closed with actionable error, overridable via `--force`. Two detection paths covering distinct sub-cases:
   - Canonical name at a **non-Tiddly URL** (e.g. `tiddly_prompts` → `https://example.com/my-prompts`): detected via `StatusResult.OtherServers` filtered to canonical names (requires the new `OtherServer.URL` field).
   - Canonical name at a **wrong-type Tiddly URL** (e.g. `tiddly_prompts` → content server URL): detected via `StatusResult.Servers` filtered to `MatchByName` entries whose `ServerType` doesn't match the expected type for the name.
   
   Both cases route through the same preflight error and the same `--force` escape hatch. The user has three paths: (a) edit the file to rename the entry and preserve it, (b) re-run with `--force` to overwrite, or (c) abandon the configure. Silent overwrite contradicts the plan's "never destroy user state" premise; `--force` provides the explicit opt-in. In multi-tool runs, preflight aggregates mismatches across every tool that successfully inspected (Status succeeded + mismatches detected) and presents them together. Hard errors (path resolution, parse failures, Status read errors) still fail-early per their existing semantics — they're different class from "preflight succeeded and found a content problem."
8. **Fail-closed safety on malformed config** — Preserved via the existing preflight `handler.Status(rc)` call. Its consolidation-detection role is removed, but the parse-probe semantics are exactly what we need to prevent a malformed config from proceeding to token mint. Keeping the call is the smallest possible fix — no new code, no new test surface.
9. **Remove semantics for canonical entries with non-Tiddly URLs** — Delete them. `tiddly mcp remove claude-code` uses a canonical-name-only predicate regardless of URL. Rationale: "remove means remove"; the user's request is explicit; `.bak.<timestamp>` provides recovery; the configure-path `--force` escape hatch + remove-path always-delete forms a coherent model (configure protects ambiguous state, remove executes explicit requests). No `--force` flag on remove — it would be semantically empty.
10. **`--force` short form** — None. No `-f` alias. Short forms on destructive operations invite accidental use, and `-f` collides with common short flags elsewhere (`--file`, `--format`). Long-form only.
11. **Preserved-entries list scoping under `--servers`** — Scoped to the server types managed by this run. Under `--servers content`, the preserved list contains only non-canonical entries of `ServerType == ServerContent`. This matches the user's mental model: "under the scope I asked for, these custom entries survived." A canonical prompts entry under `--servers content` is trivially "not modified" but isn't reported — it's simply out of scope for this invocation.
12. **Canonical-slot PATs for retained/shared-PAT logic** — Add a NEW `CanonicalSlotPATs(rc) []TiddlyPAT` interface method that returns PATs from entries whose key name is canonical (`tiddly_notes_bookmarks`, `tiddly_prompts`), URL-agnostic. `ServerType` is inferred from the name. `AllTiddlyPATs` stays URL-based (unchanged contract). The remove-path call site composes both: retained-PAT set = union of `AllTiddlyPATs` output and `CanonicalSlotPATs` output, minus the canonical entries being deleted. Rationale: keeping two narrow methods with single responsibilities is less drift-prone than one overloaded method doing "URL-Tiddly OR canonical-name"; three handlers implement each cleanly, and the call-site composition makes the semantic explicit.

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
- `cli/internal/mcp/handler.go` — `TiddlyPAT`, `PATExtraction`, `ToolHandler` interface, `survivorsOfAllTiddlyPATs`, and `AllTiddlyPATs`. A new `CanonicalSlotPATs` method is added to the interface.
- `cli/internal/mcp/status.go` — `classifyServer`, `StatusResult`, `MatchByName` / `MatchByURL`, `OtherServer` (gains a URL field). Preflight leans on these heavily after the refactor.
- `cli/internal/mcp/claude_code.go`, `claude_desktop.go`, `codex.go` — existing `extractAll*TiddlyPATs` and `extract*PATs` pairs; a new `extract*CanonicalSlotPATs` helper is added per handler, plus the `removeJSONServersByTiddlyURL` / `removeCodexServersByTiddlyURL` call inside each `build*Config` is deleted.
- `cli/cmd/mcp.go` — `newMCPConfigureCmd`, `newMCPRemoveCmd`, `translateConfigureError`, `--yes` flag wiring, and the two `Long:` strings at lines 62-85 and 301-319 whose URL-based-replace wording contradicts the new contract. Also the PAT-collection block around line 372 and the orphan-token warning emission around line 440.
- `cli/agent_testing_procedure.md` — Phase 4 overall shape (understand what's being deleted), Phase 1–3 to preserve, the scattered `--yes` / consolidation references at lines 3, 954-955, 1015, 1017, and **T8.4/T8.5 at lines 2228-2238** (these intentionally invoke `--scope local` and `--scope project` to verify rejection; do not alter them under the `--scope local` sweep).
- `frontend/src/pages/docs/DocsCLIMCP.tsx` — current docs state, specifically the "Server Identification" block at lines 124-141 whose URL-based "replace on configure / remove by URL" prose contradicts the new additive contract.
- `docs/ai-integration.md` — line 108 has `--scope local` as part of a legitimate Tiddly→Claude Code scope-mapping table. The `--scope local` reference is describing Claude Code's own flag, not Tiddly's. Preserve the cross-reference; don't blanket-delete.
- `frontend/src/components/AISetupWidget.tsx` — the `getAffectedFiles` Claude Code description around line 431 (already edited on-branch to switch `--scope local` → `--scope directory`; see Milestone 3).

No external documentation URLs apply to this change.

---

## Agent behavior (global)

- This is a **single PR** with **one commit per milestone**. Do not combine multiple milestones into one commit; do not split a milestone across multiple commits. Milestone boundaries exist so each commit leaves the tree green and the diff reviewable in isolation.
- Complete each milestone fully (code + tests + docs) before moving to the next. Stop and request human review at the end of each milestone before committing.
- Run `make cli-verify` at the end of every milestone; it must pass before proceeding. Every milestone boundary leaves the tree green — no deliberately-broken intermediate checkpoints.
- Ask for clarification when requirements are ambiguous. Do not assume.
- Remove legacy code rather than leaving dead paths. Breaking changes are acceptable.
- Prefer deleting obsolete tests outright over reworking them into something weaker.
- Type hints and clear naming as per `cli/` Go conventions already in use.
- When the plan references line numbers, treat them as anchors that may have drifted by a few lines — always locate the right code by the surrounding function names and comments, not line number alone.

---

## Milestones

### Milestone 1 — Additive `configure` (consolidation removed; `--force` added; preflight URL-mismatch detection; `CanonicalSlotPATs` method added)

**Goal & outcome:**
`tiddly mcp configure` writes only canonical entries and leaves non-canonical Tiddly-URL entries untouched. Consolidation module, prompt helper, and the gate are all removed. The preflight `handler.Status` call is preserved and now serves three purposes: fail-closed parse probe, canonical-URL-mismatch detection (both non-Tiddly URLs and wrong-type Tiddly URLs, aggregated across tools in multi-tool runs), and preserved-entries derivation. `--force` overrides the canonical-URL-mismatch refusal only. Validate-then-mint on the canonical entry's PAT is preserved. The configure summary lists preserved non-canonical entries (scoped to the server types managed by this run). `CanonicalSlotPATs` interface method and implementations are added here so Milestone 2 can compose it with `AllTiddlyPATs` at the call site.

- `configure` run with pre-existing `work_prompts` + `personal_prompts` → those entries survive unchanged; canonical entries are added/updated; summary lists `work_prompts` and `personal_prompts` as preserved.
- `configure --servers content` with non-canonical `work_content` + `work_prompts` present → canonical content written, canonical prompts untouched (out of scope), summary lists only `work_content` (the in-scope preserved entry).
- `configure --servers content` when canonical `tiddly_prompts` exists → `tiddly_prompts` is structurally preserved (re-parse and compare as maps).
- `configure` re-run when canonical is already present at the correct Tiddly URL → canonical updated in place (same validate-then-mint); non-canonical untouched.
- `configure` run when canonical `tiddly_prompts` exists but its URL is not a Tiddly URL → configure exits non-zero with an actionable error naming the file path, key name, and current URL. **No server-side token mint happens.**
- `configure` run when canonical `tiddly_prompts` exists but points at the **content** Tiddly URL (cross-wired) → same fail-closed behavior, same error format. No mint.
- `configure` run against two auto-detected tools, both with canonical URL mismatches → single aggregated error listing both tools and their mismatches; no mints for either.
- `configure --force` with any mismatch type → proceeds; prints `Forcing overwrite of tiddly_prompts (currently <url>)` to stderr (non-dry-run only); writes the CLI-managed entry.
- `configure --dry-run` with a canonical URL mismatch → fails with the same error format as a real run. `configure --dry-run --force` → previews the overwrite via the existing diff (no additional stderr log line).
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

Pluralizes cleanly for N tools. Each tool's header names its config file path; each mismatch is bulleted underneath.

**Implementation outline:**

1. **Delete files:** `cli/internal/mcp/consolidation.go`, `consolidation_test.go`, `prompt.go`, `prompt_test.go`.

2. **`status.go`**: add `URL string` field to the `OtherServer` struct. Update `classifyServer`'s default branch from `&OtherServer{Name: name, Transport: transport}` to `&OtherServer{Name: name, URL: urlStr, Transport: transport}`. No changes needed in the three per-handler status builders — they already route through `classifyServer`. The existing `tiddly mcp status` rendering doesn't print the `OtherServer.URL`; backward-compatible addition.

3. **`configure.go`**:
   - Delete `ErrConsolidationDeclined`, `ErrConsolidationNeedsConfirmation`.
   - Remove `ConfigureOpts.AssumeYes`, `.Stdin`, `.IsInteractive`. Add `ConfigureOpts.Force bool`.
   - Remove `preflightedTool.consolidations` field. Add two new named types for preflight aggregation:

     ```go
     // canonicalMismatch describes a canonical key whose current URL doesn't
     // match the expected Tiddly URL for its type. Used by preflight's URL-
     // mismatch detector and by the --force-overwrite stderr log.
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
   - **Keep the preflight `handler.Status(rc)` call**. Its new role is threefold:
     1. **Parse probe / fail-closed.** Existing dry-run-tolerant vs. real-run fail-closed branching stays — a read error on a real run still aborts before any mint. These are "hard errors" that fail early and are NOT aggregated with canonical-URL mismatches.
     2. **Canonical-URL-mismatch detection.** After a successful Status, build a `[]canonicalMismatch` list for each tool from two sources:
        - `sr.OtherServers` entries whose `Name == serverNameContent || Name == serverNamePrompts` — canonical names at non-Tiddly URLs. URL comes from the new `OtherServer.URL` field.
        - `sr.Servers` entries where `MatchMethod == MatchByName` AND the `ServerType` doesn't match the name's expected type (`tiddly_notes_bookmarks` expects `ServerContent`; `tiddly_prompts` expects `ServerPrompts`). These are cross-wired canonical entries.
        
        If a tool has mismatches AND `opts.Force == false`, append a `toolMismatches` entry to a run-level list. After the preflight loop completes, if the run-level list is non-empty, return a single aggregated error formatted as shown in the multi-tool sample output — before `resolveToolPATs` runs for any tool. If `opts.Force == true`, each tool's mismatches go on its `preflightedTool.forceOverwrites` for the commit loop to log instead.
     3. **Preserved-entries derivation.** Filter `sr.Servers` to entries where `MatchMethod == MatchByURL` AND `ServerType` is in the requested `--servers` set (or all types if no filter). Those are non-canonical-named entries of in-scope server types whose URLs classify as Tiddly — the custom entries this run leaves alone. Stash sorted names on `preflightedTool.preservedNames`.
   - In the commit loop, delete the `if len(pf.consolidations) > 0 { writeConsolidationWarning(...) }` branch in the dry-run output block and the "Consolidation required:" header emission in both paths.
   - In the commit loop, after successful `handler.Configure`, copy `pf.preservedNames` into `result.PreservedEntries[pf.tool.Name]`.
   - **Force-overwrite stderr log.** Non-dry-run runs with `opts.Force == true` and a non-empty `pf.forceOverwrites` list emit one line per overwritten entry to `opts.ErrOutput` BEFORE `handler.Configure` is called: `Forcing overwrite of <key> (currently <url>)`. Dry-run runs do NOT emit this — the diff's `before` block already shows it. The log fires before `handler.Configure`; if a later commit-phase step fails, the end-of-run error disambiguates and the earlier log line remains accurate as a statement of attempted intent.
   - **Delete `tiddlyURLMatcher`** (function at configure.go:25-38). Matching `TestTiddlyURLMatcher__*` tests are also deleted.
   - **Change `DeleteTokensByPrefix` signature** to accept `[]TokenRevokeRequest` and return `[]TokenRevokeResult`:

     ```go
     // TokenRevokeRequest is one (label, PAT) tuple to revoke against. The
     // label is a free-form caller-owned string used for attribution in the
     // result — typically a canonical config-entry name like "tiddly_prompts".
     type TokenRevokeRequest struct {
         EntryLabel string
         PAT        string
     }

     // TokenRevokeResult is one per-request outcome. DeletedNames holds the
     // cli-mcp-*-named server-side tokens that were actually revoked for the
     // request's PAT (empty slice if nothing matched — caller uses this to
     // emit per-entry "no CLI-created token matched" notes). Err is non-nil
     // if the per-PAT revoke hit a network or server error after list-tokens
     // already succeeded.
     //
     // For PATs shorter than tokenPrefixLen, DeletedNames is empty and Err is
     // nil — the short-PAT case is treated as "nothing matched," so the
     // caller still emits the note consistently for garbled-PAT entries.
     type TokenRevokeResult struct {
         EntryLabel   string
         DeletedNames []string
         Err          error
     }

     // DeleteTokensByPrefix revokes server-side tokens matching any request
     // PAT and the cli-mcp- name prefix. Returns one result per input request,
     // preserving order and labels. The top-level error covers only list-
     // tokens failure; per-request errors are surfaced inside the individual
     // results.
     func DeleteTokensByPrefix(ctx context.Context, client *api.Client, reqs []TokenRevokeRequest) ([]TokenRevokeResult, error)
     ```

   - **Change `CheckOrphanedTokens` return type** to `[]api.TokenInfo` (or a minimal `{Name, TokenPrefix}` struct) so the caller can cross-reference prefixes against retained PATs. Doc comment updated: "Returns server-side tokens matching the `cli-mcp-{tool}-{serverType}-` name pattern. Caller is responsible for filtering against retained PAT prefixes before presenting as 'potentially orphaned' — otherwise tokens in active use by non-canonical entries would be misreported."
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

   - **`AllTiddlyPATs` stays URL-based.** Contract unchanged from today: returns PATs from entries whose URL classifies as a Tiddly URL (canonical or non-canonical name). Updated doc comment:

     ```go
     // AllTiddlyPATs returns every extractable Bearer token in the tool's
     // config from entries whose URL classifies as a Tiddly URL, in
     // canonical-first order. Used by `remove --delete-tokens`: the canonical
     // subset supplies revoke targets; the non-canonical subset feeds into
     // shared-PAT warnings.
     //
     // For entries whose key name is canonical but URL is NOT a Tiddly URL
     // (e.g. a user repurposed tiddly_prompts for a local dev server), use
     // CanonicalSlotPATs. The remove-path retained-set computation unions
     // both methods' output.
     AllTiddlyPATs(rc ResolvedConfig) []TiddlyPAT
     ```

   - **Add new `CanonicalSlotPATs` interface method**:

     ```go
     // CanonicalSlotPATs returns Bearer tokens from entries whose key name is
     // canonical (tiddly_notes_bookmarks, tiddly_prompts), regardless of the
     // entry's URL. ServerType is inferred from the name:
     // tiddly_notes_bookmarks → ServerContent, tiddly_prompts → ServerPrompts.
     // Entries without an extractable PAT are filtered out.
     //
     // Complements AllTiddlyPATs (which is URL-based). The remove-path
     // retained-set computation unions both methods' output so a canonical
     // slot repurposed for a non-Tiddly service still participates in shared-
     // PAT warnings and orphan-subtraction.
     CanonicalSlotPATs(rc ResolvedConfig) []TiddlyPAT
     ```

5. **Per-handler files (`claude_code.go`, `claude_desktop.go`, `codex.go`)**:
   - `extractAll*TiddlyPATs` stays URL-based (current behavior, unchanged).
   - Add `extract*CanonicalSlotPATs` per handler: walk the config, for each entry whose key name is `serverNameContent` or `serverNamePrompts`, extract the Bearer token. If present, append with `ServerType` inferred from the canonical name. Skip entries without an extractable PAT.
   - `extract*PATs` survivor variants derive from `canonicalEntryPATs` (renamed from `survivorsOfAllTiddlyPATs`).
   - **Delete the URL-based removal call inside each build path:**
     - `claude_code.go` around line 190 — remove the `removeJSONServersByTiddlyURL(servers, tiddlyURLMatcher(...))` line from `buildClaudeCodeConfig`.
     - `claude_desktop.go` around line 60 — remove the same call from `buildClaudeDesktopConfig`.
     - `codex.go` around line 89 — remove `removeCodexServersByTiddlyURL(...)` from `buildCodexConfig`.

     **Rationale:** Go map assignment (`servers[serverNameContent] = ...`) overwrites the canonical key in place regardless of whether it pre-existed. Non-canonical entries are never referenced by that assignment and survive by default. The removal helpers themselves stay — still used by the Remove path in Milestone 2.
   - **Do NOT add canonical-URL validation in `build*Config`.** The check lives in preflight (step 3).
   - `Remove` path changes deferred to Milestone 2.

6. **`cmd/mcp.go` — `--yes` flag removal and `--force` flag addition**:
   - Delete the `cmd.Flags().BoolVarP(&assumeYes, "yes", "y", ...)` registration, the `assumeYes` local variable, and the `AssumeYes: assumeYes` field in the `opts` literal. Users passing `--yes` get Cobra's "unknown flag" error.
   - Add `--force` flag on `newMCPConfigureCmd`: `cmd.Flags().BoolVar(&force, "force", false, "Overwrite canonical entries that point at non-Tiddly URLs or wrong-type Tiddly URLs")`. Long-form only.
   - Plumb to `ConfigureOpts.Force`.
   - Update the configure `Long:` string to document `--force`: "Use `--force` to overwrite a canonical entry (`tiddly_notes_bookmarks` or `tiddly_prompts`) whose URL doesn't match the expected Tiddly URL for that type."

**Testing strategy (`configure_test.go`):**

- **Delete** (verified names against current file):
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
  - `TestRunConfigure__status_error_aborts_non_dry_run` — preflight Status call is preserved.
  - `TestRunConfigure__malformed_config_returns_parse_error` (if present).
  - `TestRevokeMintedTokens__*`.
- **Add (core of the behavior change):**
  - `TestRunConfigure__additive_preserves_non_canonical_tiddly_entries` (per handler).
  - `TestRunConfigure__reuses_canonical_pat_when_valid`
  - `TestRunConfigure__mints_fresh_when_canonical_pat_invalid`
  - `TestRunConfigure__does_not_reuse_pat_from_non_canonical_entry`
  - `TestRunConfigure__dry_run_shows_only_canonical_diff`: with non-canonical entries present, assert the dry-run output does not show `work_prompts` as a *changed or removed* line. The key may appear identically in both `before` and `after` blocks — that's expected and correct; the failing case is a deletion or modification line, not an unchanged one.
  - `TestRunConfigure__servers_content_leaves_canonical_prompts_structurally_preserved`
  - `TestRunConfigure__refuses_to_overwrite_canonical_key_with_non_tiddly_url`: pre-existing `tiddly_prompts` at `https://example.com/whatever`. Error is non-nil; message contains file path, key name, current URL. **`opts.Client.CreateToken` NOT called** (fail-before-mint). No config write.
  - `TestRunConfigure__refuses_when_canonical_name_has_wrong_type_tiddly_url`: `tiddly_prompts` at the content Tiddly URL. Same assertions as the non-Tiddly case.
  - `TestRunConfigure__refuses_on_canonical_url_mismatch_in_dry_run`: `opts.DryRun = true`, same bad state, same error. Asserts dry-run doesn't silently tolerate URL mismatches.
  - `TestRunConfigure__aggregates_mismatches_across_multiple_tools`: two tools, each with a canonical URL mismatch. Single combined error; no mints for either tool. Output format matches the multi-tool sample block.
  - `TestRunConfigure__does_not_aggregate_hard_errors_with_url_mismatches`: one tool with a parse error, one tool with a URL mismatch. Parse error surfaces alone (fail-early); URL-mismatch aggregation doesn't happen.
  - `TestRunConfigure__force_overwrites_canonical_with_non_tiddly_url` (per handler).
  - `TestRunConfigure__force_overwrites_cross_wired_canonical`: `tiddly_prompts` at content URL, `Force = true`, canonical-managed entry written at the prompts URL; stderr log names the prior content URL.
  - `TestRunConfigure__force_with_dry_run_shows_overwrite_in_diff_without_stderr_log`
  - `TestRunConfigure__force_is_no_op_when_no_canonical_url_mismatch`
  - `TestRunConfigure__reports_preserved_non_canonical_entries`
  - `TestRunConfigure__preserved_entries_scoped_to_requested_servers`
  - `TestRunConfigure__preserves_non_canonical_entry_with_malformed_authorization`
- **Per-handler tests**:
  - Remove tests asserting `Configure` deletes non-canonical Tiddly-URL entries.
  - Add: given a canonical + non-canonical Tiddly-URL entry + unrelated non-Tiddly entries, `Configure` preserves the non-canonical Tiddly entry and the unrelated entries structurally.
  - `ExtractPATs` tests: update for `{ContentPAT, PromptPAT}` only and canonical-name-only semantics.
  - `AllTiddlyPATs` tests: reaffirm URL-based semantics. A canonical entry at a non-Tiddly URL does NOT appear in the result; a non-canonical entry at a Tiddly URL does.
  - `CanonicalSlotPATs` tests (new, per handler): canonical entry at Tiddly URL → appears with `ServerType` inferred from name. Canonical entry at non-Tiddly URL → also appears with `ServerType` from name. Non-canonical entry (any URL) → does NOT appear. Entry at canonical name with no extractable PAT → does NOT appear.

**Docs:** None in this milestone — CLI help and doc pages update in Milestone 3.

---

### Milestone 2 — Canonical-name-only `mcp remove` (+ structured `--delete-tokens` reporting)

**Goal & outcome:**
`tiddly mcp remove` deletes canonical-named entries regardless of URL. Non-canonical entries survive. `--delete-tokens` revokes only PATs attached to canonical entries, warns before revoking a PAT also referenced by any retained entry on disk (canonical or non-canonical, regardless of URL classification), and emits a per-entry note when a canonical PAT doesn't match any CLI-minted server-side token. Orphan-token warning (no `--delete-tokens`) is filtered to exclude tokens whose prefix matches a retained PAT.

- `tiddly mcp remove claude-code` with canonical + non-canonical entries present → canonical removed, non-canonical structurally preserved.
- `tiddly mcp remove claude-code` when canonical `tiddly_prompts` points at a non-Tiddly URL → canonical entry deleted. `.bak.<timestamp>` provides recovery.
- `tiddly mcp remove claude-code --delete-tokens` → revokes PATs for canonical entries only.
- **`tiddly mcp remove claude-code --delete-tokens` when canonical `tiddly_prompts` PAT equals non-canonical `work_prompts` PAT** → consolidated warning: `Warning: token from tiddly_prompts is also used by work_prompts (still configured); revoking will break those bindings.`
- **`tiddly mcp remove claude-code --servers content --delete-tokens` when canonical `tiddly_prompts` has a non-Tiddly URL and shares a PAT with canonical `tiddly_notes_bookmarks`** → consolidated warning fires naming `tiddly_prompts` as a retained binding (even though its URL is non-Tiddly — this is where `CanonicalSlotPATs` earns its keep).
- **`tiddly mcp remove claude-code --delete-tokens` when the canonical entry's PAT doesn't match any `cli-mcp-*` server-side token** → `Note: no CLI-created token matched the token attached to tiddly_prompts; nothing was revoked.` One note per affected canonical entry.
- Orphan-token warning (no `--delete-tokens`) excludes tokens whose prefix matches a PAT still referenced by a retained entry on disk.

**Implementation outline:**

1. **Per-handler `Remove` method**: change the deletion predicate from "any entry matching a Tiddly URL" to **"entry whose key name is canonical"** — URL-agnostic. Drop the belt-and-suspenders URL check. For `--servers content` / `--servers prompts`, filter by canonical name for the requested type. `ToolHandler.Remove` signature UNCHANGED — no `force` parameter added.

2. **`cmd/mcp.go` — `newMCPRemoveCmd` rewrite**:
   - No new flag. Surface unchanged except for semantic shift.
   - **PAT collection** — two passes:
     1. **Revoke targets**: iterate canonical entries via `canonicalEntryPATs` (or an inline canonical-name filter over `AllTiddlyPATs`), filtered to server types being removed this invocation (`--servers`). Each target is a `TokenRevokeRequest{EntryLabel: <canonical-name>, PAT: <pat>}`.
     2. **Retained PATs after write**: compute as the union of `handler.AllTiddlyPATs(rc)` (URL-Tiddly entries) and `handler.CanonicalSlotPATs(rc)` (canonical entries regardless of URL), then subtract the canonical entries this invocation is about to delete (by name). Rationale: the user's intent is "remove these specific canonical entries"; anything else that's still on disk after remove is retained. The subtraction avoids a second `handler.Status` re-read after `handler.Remove`. The `AllTiddlyPATs ∪ CanonicalSlotPATs` union is the ONLY place these two methods combine; each method stays narrow by itself.
   - **Shared-PAT warning**. For each revoke target, collect retained entries whose PAT equals the target's PAT. If any matches, emit ONE line per canonical-entry-being-revoked, listing all matching retained entry names alphabetically: `Warning: token from <canonical-name> is also used by <retained-name-1>, <retained-name-2>, ... (still configured); revoking will break those bindings.`
   - **Call revoke helper**: `results, err := mcp.DeleteTokensByPrefix(cmd.Context(), client, reqs)`.
   - **Per-entry note derivation**. For each result with empty `DeletedNames` and nil `Err`: `Note: no CLI-created token matched the token attached to <EntryLabel>; nothing was revoked. Manage tokens at https://tiddly.me/settings.`
   - **Successful deletions**. Dedupe `DeletedNames` across results, join for the `Deleted tokens:` line.
   - **Per-entry errors**. Non-nil `Err` results surface as per-entry warnings.
   - **Auth semantics (unchanged)**: `ResolveToken(flagToken, preferOAuth=true)` still gates the entire token-cleanup block. If auth resolution fails, cleanup is silently skipped (existing behavior, acknowledged UX rough edge — tracked separately per Out of Scope). If auth resolves (either OAuth or PAT), cleanup is attempted regardless of auth type; the new structured results/notes fire normally.
   - The existing "Warning: token is shared with X server (still configured)" message is superseded by the consolidated shared-PAT warning.

3. **Orphan-token warning filtering** (no `--delete-tokens` path):
   - `CheckOrphanedTokens` now returns token `{Name, TokenPrefix}` pairs. Compute retained-PAT prefixes from the same `AllTiddlyPATs ∪ CanonicalSlotPATs` union (minus the canonical entries just deleted). Filter the orphan candidate set to exclude any token whose `TokenPrefix` is in the retained-prefix set. Emit the orphan warning only for the filtered result.

4. **`AllTiddlyPATs` stays URL-based; `CanonicalSlotPATs` from Milestone 1 is the complementary URL-agnostic method.** Both are load-bearing here — neither alone captures the cases that need shared-PAT warnings.

5. **`CheckOrphanedTokens`** — signature change from `[]string` to `[]api.TokenInfo` (or equivalent `{Name, TokenPrefix}` struct). Doc comment notes the caller's filtering responsibility. Add the comment:

   ```go
   // NOTE: Returns server-side tokens matching the cli-mcp-{tool}-{serverType}-
   // name pattern. The caller must subtract tokens whose TokenPrefix matches
   // a PAT still referenced by a retained entry on disk before presenting
   // the result as "potentially orphaned" — otherwise tokens in active use
   // by non-canonical entries or repurposed canonical slots would be
   // misreported.
   ```

**Testing strategy (`cmd/mcp_test.go` and per-handler tests):**

- **Delete:** `TestTranslateConfigureError__*` (all four).
- **Modify:**
  - `TestMCPRemove__delete_tokens_multi_entry_revokes_all` → rename to `..._revokes_canonical_only`; assert non-canonical PATs NOT in DELETE set.
  - Any test using the old `DeleteTokensByPrefix([]string)` signature → update to `[]TokenRevokeRequest` input and iterate the structured result.
- **Keep:**
  - `TestMCPRemove__delete_tokens_dedups_shared_pat` (update to structured form).
  - `TestMCPConfigure__dry_run_surfaces_pat_auth_warning`.
- **Add:**
  - `TestMCPRemove__preserves_non_canonical_entries` (per handler).
  - `TestMCPRemove__deletes_canonical_entry_with_non_tiddly_url` (per handler).
  - `TestMCPRemove__delete_tokens_ignores_non_canonical_pats`.
  - `TestMCPRemove__shared_pat_warning_fires_on_canonical_split`.
  - `TestMCPRemove__shared_pat_warning_fires_when_non_canonical_retains_pat` (critical correctness test).
  - `TestMCPRemove__shared_pat_warning_fires_when_retained_canonical_has_non_tiddly_url`: canonical `tiddly_prompts` at non-Tiddly URL, canonical `tiddly_notes_bookmarks` at content Tiddly URL, both share a PAT, `--servers content --delete-tokens` → warning fires naming `tiddly_prompts`. Locks in `CanonicalSlotPATs` participation in retained-set composition.
  - `TestMCPRemove__shared_pat_warning_consolidates_multiple_retained_entries`: one canonical PAT matches three non-canonical entries → one warning line listing all three names comma-separated.
  - `TestMCPRemove__no_warning_when_no_retained_pat_shares`.
  - `TestMCPRemove__servers_prompts_only_warns_when_retained_content_shares_pat`.
  - `TestMCPRemove__non_cli_token_note_fires_per_unmatched_entry`.
  - `TestMCPRemove__non_cli_token_note_fires_once_per_entry`.
  - `TestMCPRemove__non_cli_token_note_fires_for_short_or_garbled_pat`.
  - `TestMCPRemove__non_cli_token_note_does_not_fire_for_cli_tokens`.
  - `TestMCPRemove__orphan_warning_excludes_tokens_used_by_non_canonical_entries`.
  - `TestMCPRemove__orphan_warning_excludes_tokens_used_by_repurposed_canonical_slot`: CLI-minted token pasted into canonical slot that was then repurposed to a non-Tiddly URL. Orphan warning should NOT fire for that token — `CanonicalSlotPATs` sees it, the retained-set includes it, the filter excludes it.
  - `TestMCPRemove__orphan_warning_fires_for_unreferenced_cli_tokens`.

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

   - Remove `translateConfigureError` and its call site; becomes `return err`. Remove the `errors` import if unused.
   - `--yes` already deleted in Milestone 1.
   - `--force` registered in Milestone 1; confirm it appears in `--help` with a clear description.
   - `newMCPRemoveCmd` Long string: replace the URL-based paragraph:

     > Remove deletes the CLI-managed entries (`tiddly_notes_bookmarks`, `tiddly_prompts`) from the tool's config file. Other entries pointing at Tiddly URLs under different names are preserved. A canonical-named entry is removed regardless of what URL it points at. The prior config is saved to `<path>.bak.<timestamp>` before the write.
     >
     > With `--delete-tokens`, only the PATs attached to CLI-managed entries are revoked; PATs used by preserved entries are left alone. If a CLI-managed PAT is also referenced by a preserved entry, the CLI warns before revoking. If a CLI-managed entry's PAT doesn't match any CLI-created server-side token, the CLI prints an informational note referencing that entry.

2. **`frontend/src/pages/docs/DocsCLIMCP.tsx`**:
   - Rewrite the "Server Identification" section at lines 124-141 to describe the additive contract (drop URL-based "replace" language).
   - Add `--force` to the Flags table.
   - Add a short FAQ block: "I have multiple Tiddly entries — what happens on configure?"
   - Replace "canonical" in user-facing text with "CLI-managed" or explicit key names.

3. **`frontend/src/components/AISetupWidget.tsx`**:
   - `--scope local` → `--scope directory` change around line 431. Already edited on-branch; keep.

4. **`cli/agent_testing_procedure.md`**:
   - Delete entirely: Phase 4 and T4.1, T4.2, T4.4, T4.8, T4.8b, T4.9, T4.9b, T4.10, T4.11.
   - Edit line 3, lines 954-955, line 1015, line 1017. Add `--force` to the flag-list check (replacing `--yes`).
   - Keep T4.6, T4.7 (reframe), T5.4.
   - Rewrite T6.8, T6.8b, T6.8c, T6.8d for canonical-only `--delete-tokens` semantics. Add sub-tests for: shared-PAT warning (including the repurposed-canonical-slot case), non-CLI-token note, orphan-warning filter against retained PATs.
   - Do NOT modify T8.4/T8.5.
   - Add five E2E tests to Phase 3: additive preservation, canonical update-in-place, fail-closed on URL mismatch (both types, including multi-tool aggregation), `--force` overwrite, canonical-only remove with `--delete-tokens` warnings.

5. **Project-level docs audit** per `AGENTS.md` "Files to Keep in Sync":
   - Search `README.md`, `frontend/public/llms.txt`, `frontend/src/pages/docs/DocsCLIReference.tsx`, `frontend/src/pages/docs/DocsKnownIssues.tsx`, `docs/ai-integration.md` for: "consolidate", "consolidation", "--yes", "work_prompts", "migrations from manual setups safe", and (with exceptions) "--scope local".
   - `--scope local` exceptions — preserve these:
     - `cli/agent_testing_procedure.md` T8.4/T8.5.
     - `docs/ai-integration.md` line 108.
   - Rewrite any "migrations from manual setups safe" prose.

**Testing strategy:**

- Run the CLI; paste `tiddly mcp configure --help` and `tiddly mcp remove --help` output into the PR description for reviewer eyeball.
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
- Agent confirms (with grep output) that `--yes` / `assumeYes` is not registered anywhere in `cli/cmd/` or `cli/internal/` source (regression guard — the behavioral Cobra test is not required).
- Agent confirms (with grep output) that the word "canonical" no longer appears in user-facing copy under `frontend/src/pages/docs/` or `cli/cmd/*.go` Long strings.
- Non-canonical Tiddly-URL entries are demonstrably preserved across configure and remove.
- Preserved-entries list is scoped to the server types managed by this run.
- Shared-PAT warning fires correctly in all three relevant cases: canonical-content vs canonical-prompts share; canonical vs non-canonical share; canonical vs canonical-repurposed-slot (non-Tiddly URL) share.
- Shared-PAT warning consolidates multiple retained entries into one line per canonical revoke.
- Non-CLI-token note fires correctly (including for short/garbled PATs).
- Orphan-token warning excludes tokens referenced by retained entries (canonical or non-canonical; Tiddly-URL or repurposed).
- Canonical-key-on-non-Tiddly-URL AND cross-wired canonical name trigger fail-closed error in preflight (before any token mint), both single-tool and multi-tool (aggregated).
- `--force` on configure overrides the fail-closed refusal for both mismatch types and emits the `Forcing overwrite of …` line to stderr in non-dry-run mode only.
- `--dry-run` fails on canonical URL mismatch identically to a real run; `--dry-run --force` previews the overwrite.
- `tiddly mcp remove` deletes canonical-named entries regardless of URL.
- `AllTiddlyPATs` returns only entries whose URL classifies as a Tiddly URL.
- `CanonicalSlotPATs` returns only entries whose key name is canonical, URL-agnostic, with `ServerType` inferred from name.
- `DeleteTokensByPrefix` returns one structured `TokenRevokeResult` per input request, preserving entry labels.
- `CheckOrphanedTokens` returns token prefixes so the caller can filter against retained PATs.

## Out of scope

- PAT lifecycle semantics (mint/revoke flow, expiration handling) beyond what's already in `configure.go`.
- URL-based classification (`classifyServer`, `isTiddlyURL`, etc.) — correct as-is, just extended with `OtherServer.URL`.
- Skills (`tiddly skills configure/remove`) — unrelated surface.
- Any opt-in "revoke all Tiddly-URL PATs" flag for `remove`. If useful, a separate ticket.
- The `mcp status` multi-entry grouping — informational, unchanged.
- A guided CLI flow for removing user-custom non-canonical entries.
- Normalizing the handler-signature asymmetry between `buildClaudeDesktopConfig(configPath, ...)` and the other two (`rc ResolvedConfig`). Pre-existing cosmetic inconsistency.
- Codex deprecated skills path (`~/.codex/skills/`) — tracks an external tool's own path migration.
- Redesigning the `--delete-tokens` error flow (best-effort cleanup after config write vs. fail-fast before; silent-skip on auth-resolution failure). Current behavior is preserved. Silent-skip on auth failure is an acknowledged UX rough edge; if fail-fast or explicit-warn semantics are desired, separate ticket.
