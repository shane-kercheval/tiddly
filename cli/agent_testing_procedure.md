# CLI Agent Testing Procedure

End-to-end verification of the `tiddly` CLI. Structured for an AI agent to execute, but every step is readable by a human. Covers command surface, scope variants, multi-entry safety, consolidation gate (prompt / `--yes` / decline), timestamped backups, remove flows including `--delete-tokens`, skills, error handling, and auth.

**Before running anything:** read [§ CRITICAL: Never Echo Token Values](#critical-never-echo-token-values), [§ Reporting Protocol](#reporting-protocol-read-this-second), and [§ Safety Model](#safety-model). Recommendation: run against a dedicated test account.

---

## CRITICAL: Never Echo Token Values

The agent MUST NOT run any command that prints Bearer token values, full Authorization headers, or unredacted config file contents to the transcript. These files contain the user's **original production tokens** — the strict concern. Test tokens minted during the run (`cli-mcp-*`) have limited blast radius, but the same hygiene applies.

**Prohibited on config files (`$CLAUDE_DESKTOP_CONFIG`, `$CLAUDE_CODE_CONFIG`, `$CODEX_CONFIG`):**
- `cat`, `head`, `tail`, `less`, `more` — print full file contents including Bearer values
- `jq -r '.path.to.Authorization'` — prints the plaintext value
- `grep -o 'Bearer .*'` — captures the value into output
- Any shell assignment that lets the value surface in subsequent `echo`/`printf` calls

**Permitted patterns for presence and structural checks:**
- `jq -e 'path exists' PATH >/dev/null` — exit code is the assertion, no value printed
- `jq -e '.x | type == "string"' PATH >/dev/null` — type check without value
- `jq -e '.x | startswith("Bearer bm_")' PATH >/dev/null` — prefix check, still no value leak
- Hash-compare via temp files: `diff <(printf ... | SHA256) <(jq -r ... PATH | SHA256)` — only the hashes surface, and only a pass/fail diff result

**`bin/tiddly tokens list` output is safe to display** — it shows ID, name, and first-12 prefix only (never plaintext). Its stdout can be grep'd/printed freely.

**If a Bearer value appears in your transcript at any point, STOP and report it before continuing.** Treat it as a plan-bug finding; the plan must never emit a path that exposes tokens.

---

## Reporting Protocol (read this second)

The agent running this plan MUST stop and report when observed behavior does not match what a test expects — whether the mismatch comes from a bug in the product OR a bug in this plan. Silent adaptation in either direction is forbidden. This protocol applies AFTER the Prime Directive above: a token leak is always cause to stop, regardless of whether a test assertion was triggered.

### When to stop

Stop immediately and report on any of the following:

1. **Expected output not present.** An assertion in `**Verify:**` says output must contain X and it doesn't.
2. **Unexpected output present.** An assertion says output must NOT contain Y and it does (e.g. "must not contain `Configured:` in dry-run").
3. **Unexpected exit code.** Plan expects 0; got non-zero (or vice versa).
4. **File state mismatch.** A config file wasn't modified when expected, was modified when not expected, or has different structure than the plan describes.
5. **Plan steps that are impossible to execute.** A command fails to parse, a helper isn't defined, an env var isn't set, a path doesn't exist that the plan assumed.
6. **Format/UX drift.** The plan describes output wording that's close but not identical to reality (e.g. plan says `PAT from X will be reused` but output says `PAT from entry 'X' will be reused`). Treat verbatim string checks as exact; treat prose explanations as close-match and report the drift.
7. **Anything that feels wrong.** If output makes a claim that seems to contradict reality (e.g. "Deleted tokens: Y" but Y still shows in `tokens list`), stop and report even if no explicit assertion covers it.

### How to report

For each mismatch, produce a short structured report:

```
MISMATCH at [TEST_ID]
  Plan expected: <verbatim from the plan's Verify: bullet>
  Actual observed: <verbatim from the command output, stderr, or filesystem state>
  Category: [product-bug | plan-bug | ambiguous]
  Evidence: <exact command that was run; excerpt of its output; relevant file contents>
  Hypothesis: <one-sentence guess at cause, optional>
```

**Category guidance:**
- **product-bug** — the code's behavior is clearly wrong (doesn't match the feature spec, contradicts other tests, leaks state, etc.).
- **plan-bug** — the plan's expectation is wrong (typo, stale wording, wrong file path, outdated command).
- **ambiguous** — not clear which is wrong; needs human judgment.

### Do NOT do any of these

- **Don't "fix" the plan** by silently updating your expectations mid-run. Both the plan and the code are under review; either could be the source of the discrepancy.
- **Don't "fix" the code** to match the plan. Product changes go through code review, not testing.
- **Don't skip ahead** to the next test. Later tests often depend on earlier state (a configure for a remove, a minted token for a revoke). Running past a failure usually produces cascading noise.
- **Don't run cleanup early** unless the mismatch is severe enough that the EXIT trap needs to fire. In most cases, pausing with state intact is more useful — it lets the human inspect the exact filesystem and token state the failing test observed.

### What to do instead

1. Stop executing the plan.
2. Produce the mismatch report (one per distinct issue).
3. Wait for human discussion.
4. After discussion, either (a) the plan will be updated and you'll resume from the updated instructions, (b) the code will be changed and you'll re-run from a suitable earlier step, or (c) the human will instruct you to continue past the issue with a specific acknowledgment.

If multiple mismatches look related (e.g. three tests all show the same output difference), batch them into one report rather than producing three separate ones. Note the relationship in the `Hypothesis:` line.

### Edge cases

- **Flaky environment.** If a test fails due to an obviously environmental issue (local API down, disk full, OAuth expired), report but don't categorize as product-bug. Category: `ambiguous` or a new `environment`.
- **Order-dependent tests that fail on rerun.** Some tests mutate state in ways that affect subsequent runs (e.g. T6.5 removes entries that T6.6 expects to exist). If you're resuming mid-plan after a previous failure, suspect order dependency first and re-read the phase header.
- **Timing-sensitive assertions.** Backup filename timestamps change every second. If the plan expects an exact filename and the actual has a different timestamp, that's not a mismatch — the plan should be using glob patterns for timestamps (e.g. `<path>.bak.*`). Report as plan-bug if the plan hardcodes a timestamp.

---

## Live Run Report

The agent maintains a running markdown report at `$BACKUP_DIR/test-report.md` throughout the run. The engineer can `tail -f` it to follow progress in real time; on clean success, Phase 10 copies it to `cli/test-run-<UTC-ts>.md` for post-run inspection. The report starts blank and grows append-only.

### What goes in the report

- Run header (start time, platform, git branch/SHA, auth mode) — written once at Phase 0.
- Phase banners as phases begin — `## Phase N: <name>` headings.
- Per-test outcome lines — `PASS` / `FAIL` / `SKIP` / `NOTE` with the test ID and a short detail.
- **Mismatch reports** (full structured form from the Reporting Protocol) — inlined when they happen, not batched at the end.
- Anomalies, environmental notes, decisions made mid-run.
- Final summary (counts per status, tests skipped and why, any manual checks still needed).

### What must NOT go in the report

Same hygiene as the transcript: **no token values, no raw config contents, no Bearer headers.** Safe content: pass/fail outcomes, hash comparison results (match/differ), exit codes, token *names* (e.g. `cli-mcp-claude-code-prompts-a1b2c3`), and first-12 `TokenPrefix` strings. If you catch yourself writing a full token value to the report, stop and treat it as a plan-bug finding.

### Why live-update instead of end-of-run

The engineer is reading as work happens. They care about failures or anomalies as they surface — not buried in a wall of text after a 30-minute run completes. Real-time updates also mean an aborted run still produces partial findings on disk.

---

## Safety Model

**The config files this procedure reads and writes are the REAL files your Claude Desktop / Claude Code / Codex installations use.** We do not synthesize sandbox copies. Instead:

1. Every destructive test is preceded by a timestamped backup handled by the CLI itself (`.bak.<UTC-ts>` sibling files) AND by this procedure's Phase 0 snapshot into `$BACKUP_DIR` (mode 0700).
2. An `EXIT` trap always fires, attempting config restore + token cleanup, even on test abort. On clean success, `$BACKUP_DIR` is auto-deleted to minimize secret residue on disk. On failure, it's preserved with a warning so manual recovery is possible.
3. Tokens created during this run are identified by diffing the initial `cli-mcp-*` ID list against the post-run list. Cleanup deletes **only** the additions. Pre-existing `cli-mcp-*` tokens from prior runs or earlier configures are **not** touched. This requires Phase 0's `cli-mcp-ids-before.txt` snapshot to exist; if it's missing, cleanup refuses to delete anything rather than guess.
4. **Strongly recommended:** run against a dedicated test Tiddly account. `--delete-tokens` and the diff-based cleanup have been hardened, but account isolation is the best defense against agent mistakes.

If you cannot use a test account, the procedure is still safe to run, but review the `cli-mcp-*` tokens it creates against your token list before and after.

---

## Prerequisites

- [ ] CLI is built: `make cli-build` (verify `bin/tiddly` exists)
- [ ] Local API and MCP servers are running (tests run against local services, not production)
- [ ] Authenticated via OAuth — see [§ Auth](#auth-engineer-must-do-this-manually) (human step, must happen before the agent starts)
- [ ] API is reachable: `bin/tiddly status` shows API status `ok`

---

## Platform Detection & Setup

Run this block once at the top of the agent session. It sets env vars, detects platform-specific paths, creates backups, and installs the EXIT trap. Every subsequent command inherits this state.

```bash
set -euo pipefail

# -- Platform-specific config paths -----------------------------------------
case "$OSTYPE" in
  darwin*)
    CLAUDE_DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
    ;;
  linux*)
    CLAUDE_DESKTOP_CONFIG="$HOME/.config/Claude/claude_desktop_config.json"
    ;;
  *)
    echo "Unsupported OS: $OSTYPE" >&2
    exit 1
    ;;
esac
CLAUDE_CODE_CONFIG="$HOME/.claude.json"
CODEX_CONFIG="$HOME/.codex/config.toml"
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
CODEX_SKILLS_DIR="$HOME/.agents/skills"

echo "Platform: $OSTYPE"
echo "Claude Desktop config: $CLAUDE_DESKTOP_CONFIG"
echo "Claude Code config:    $CLAUDE_CODE_CONFIG"
echo "Codex config:          $CODEX_CONFIG"

# -- Local services (not production) ----------------------------------------
export TIDDLY_API_URL=http://localhost:8000
export TIDDLY_CONTENT_MCP_URL=http://localhost:8001/mcp
export TIDDLY_PROMPT_MCP_URL=http://localhost:8002/mcp
# Dev Auth0 tenant (must match the local API's .env VITE_AUTH0_*)
export TIDDLY_AUTH0_DOMAIN=kercheval-dev.us.auth0.com
export TIDDLY_AUTH0_CLIENT_ID=upLOqYelIdJIv7yZ8AnULA6VGklzak18
export TIDDLY_AUTH0_AUDIENCE=bookmarks-api

# -- Helper: portable sha256 (macOS lacks sha256sum by default) -------------
if command -v sha256sum >/dev/null 2>&1; then
  SHA256() { sha256sum "$@"; }
else
  SHA256() { shasum -a 256 "$@"; }
fi

# -- Helper: checksum a file for "did it change?" tests ---------------------
sha_of() {
  if [ -e "$1" ]; then SHA256 "$1" | awk '{print $1}'; else echo "MISSING"; fi
}

# -- Helper: portable file-mode read (stat syntax differs by platform) ------
if stat -c '%a' /dev/null >/dev/null 2>&1; then
  file_mode() { stat -c '%a' "$1"; }                # Linux / GNU coreutils
else
  file_mode() { stat -f '%OLp' "$1"; }              # BSD / macOS (octal, no filetype bits)
fi

# -- Helper: assert file unchanged after an op ------------------------------
assert_unchanged() {
  local label="$1" path="$2" before="$3"
  local after
  after=$(sha_of "$path")
  if [ "$before" != "$after" ]; then
    echo "FAIL [$label]: $path changed (before=$before after=$after)"
    return 1
  fi
  echo "OK   [$label]: $path unchanged"
}

# -- Helper: assert auth still works (run between phases) -------------------
# IMPORTANT: `tiddly auth status` exits 0 whether logged in or not — it's
# explicitly designed as a "read-only, never errors" helper. We must grep
# the output instead of trusting the exit code. See cli/cmd/auth.go.
assert_auth_still_working() {
  local out
  out=$(bin/tiddly auth status 2>&1)
  if echo "$out" | grep -q "Not logged in"; then
    echo "FATAL: auth lost mid-test — cleanup cannot run. Aborting." >&2
    exit 1
  fi
}

# -- Helper: safe backup/restore (uses -p to preserve mode/owner/timestamps)
# These configs hold PATs at 0600 — a restore that loosens mode is a real
# leak. Every cp is -p (files) or -rp (dirs).
backup_file() {
  local src="$1" dest="$2"
  if [ -e "$src" ]; then
    cp -p "$src" "$dest" || { echo "FATAL: failed to back up $src"; exit 1; }
    echo "Backed up: $src"
  else
    echo "Skipped (does not exist): $src"
  fi
}
backup_dir() {
  local src="$1" dest="$2"
  if [ -d "$src" ]; then
    cp -rp "$src" "$dest" || { echo "FATAL: failed to back up $src"; exit 1; }
    echo "Backed up: $src"
  else
    echo "Skipped (does not exist): $src"
  fi
}
restore_file() {
  local src="$1" dest="$2"
  if [ -e "$src" ]; then
    cp -p "$src" "$dest" && echo "Restored: $dest" || echo "WARNING: failed to restore $dest"
  else
    # Source wasn't backed up (didn't exist originally). Remove any file we
    # may have created so state returns to "didn't exist."
    rm -f "$dest" 2>/dev/null && echo "Removed (no original): $dest"
  fi
}
restore_dir() {
  local src="$1" dest="$2"
  if [ -d "$src" ]; then
    rm -rf "$dest" && cp -rp "$src" "$dest" && echo "Restored: $dest" || echo "WARNING: failed to restore $dest"
  else
    rm -rf "$dest" 2>/dev/null && echo "Removed (no original): $dest"
  fi
}

# -- Helper: print a phase banner -------------------------------------------
phase() {
  echo
  echo "=========================================="
  echo "$1"
  echo "=========================================="
}

# -- Helper: delete only cli-mcp-* tokens MINTED DURING THIS RUN ------------
# We snapshot the pre-existing cli-mcp-* IDs in Phase 0 (below) and diff-exclude
# them here, so a prior run's leftover cli-mcp-* tokens stay untouched. This
# is the cleanup the Safety Model claims — NOT "delete every cli-mcp-* token."
cleanup_cli_mcp_tokens() {
  echo "Cleaning up cli-mcp-* tokens created during THIS run…"
  local preexisting="$BACKUP_DIR/cli-mcp-ids-before.txt"
  if [ ! -f "$preexisting" ]; then
    echo "  WARNING: pre-run snapshot missing; skipping cleanup to avoid deleting pre-existing tokens."
    return 0
  fi
  local current new_ids
  current=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-/ {print $1}' | sort)
  # Delete only IDs not in the pre-run snapshot.
  new_ids=$(comm -13 "$preexisting" <(echo "$current"))
  if [ -z "$new_ids" ]; then
    echo "  (no new cli-mcp-* tokens to delete)"
    return 0
  fi
  while read -r id; do
    [ -n "$id" ] || continue
    bin/tiddly tokens delete "$id" --force 2>/dev/null && echo "  deleted: $id"
  done <<< "$new_ids"
}

# -- Backups ----------------------------------------------------------------
# BACKUP_DIR holds copies of real token-bearing configs for the duration of
# this run ONLY. It's chmod 0700 so no other user can read it, and Phase 10
# deletes it on clean success. On failure, the EXIT trap preserves it and
# prints its path with a warning — manual cleanup required.
BACKUP_DIR=$(mktemp -d)
chmod 0700 "$BACKUP_DIR"
echo "Backup dir: $BACKUP_DIR (mode 0700, deleted on clean success)"

# -- Live report ------------------------------------------------------------
# Append-only markdown report the engineer can tail during the run. Same
# no-token-echoing rules as the transcript apply — never write secrets here.
REPORT="$BACKUP_DIR/test-report.md"
: > "$REPORT"
chmod 0600 "$REPORT"
REPORT_PASS=0; REPORT_FAIL=0; REPORT_SKIP=0; REPORT_NOTE=0

# Header (written once, up front).
{
  echo "# CLI Test Run Report"
  echo
  printf '**Start (UTC):** %s\n' "$(date -u +'%Y-%m-%d %H:%M:%SZ')"
  printf '**Platform:** %s\n' "$OSTYPE"
  if git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    printf '**Git branch:** %s\n' "$(git -C "$git_root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    printf '**Git SHA:** %s\n'    "$(git -C "$git_root" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  fi
  printf '**API URL:** %s\n' "${TIDDLY_API_URL:-production}"
  printf '**Auth mode:** %s\n' "$(bin/tiddly auth status 2>&1 | awk -F': ' '/^Auth method/ {print $2; exit}' | tr -d '[:space:]')"
  echo
  echo "Progress is appended below. Failures include a detailed mismatch block."
} > "$REPORT"

echo "Live report: $REPORT  (tail -f to follow)"

# --- Report helpers ---

# Append a timestamped line to the report.
report_append() {
  printf '%s  %s\n' "$(date -u +%H:%M:%SZ)" "$1" >> "$REPORT"
}

# Phase banner — also prints to stdout via the existing phase() helper.
report_phase() {
  {
    echo
    printf '## %s\n\n' "$1"
  } >> "$REPORT"
  phase "$1"
}

# Single-line test outcome. Status: PASS | FAIL | SKIP | NOTE.
#   report_test PASS "T1.1 — Root help"
#   report_test FAIL "T5.1 — Status" "stderr missing expected banner"
report_test() {
  local status="$1" test="$2" detail="${3:-}"
  local icon
  case "$status" in
    PASS) REPORT_PASS=$((REPORT_PASS+1)); icon="✓" ;;
    FAIL) REPORT_FAIL=$((REPORT_FAIL+1)); icon="✗" ;;
    SKIP) REPORT_SKIP=$((REPORT_SKIP+1)); icon="-" ;;
    NOTE) REPORT_NOTE=$((REPORT_NOTE+1)); icon="•" ;;
    *)    icon="?" ;;
  esac
  if [ -n "$detail" ]; then
    report_append "$icon **$status** — $test — $detail"
  else
    report_append "$icon **$status** — $test"
  fi
}

# Full mismatch report — use for anything that matches the Reporting Protocol's
# "stop and report" category. Writes a structured block; also exits non-zero
# so the EXIT trap fires.
#   report_mismatch T5.1 "Not configured" "No Tiddly servers configured" plan-bug "Plan string predates CLI update"
report_mismatch() {
  local test="$1" expected="$2" actual="$3" category="$4" hypothesis="${5:-}"
  REPORT_FAIL=$((REPORT_FAIL+1))
  {
    echo
    printf '### ⚠ MISMATCH at %s\n\n' "$test"
    printf -- '- **Plan expected:** %s\n' "$expected"
    printf -- '- **Actual observed:** %s\n' "$actual"
    printf -- '- **Category:** %s\n' "$category"
    [ -n "$hypothesis" ] && printf -- '- **Hypothesis:** %s\n' "$hypothesis"
    echo
  } >> "$REPORT"
  echo "MISMATCH at $test — see $REPORT"
  # Per Reporting Protocol, stop and wait for human discussion.
  exit 1
}

# End-of-run summary (call from Phase 10 before final cleanup).
report_summary() {
  {
    echo
    echo "## Run Summary"
    echo
    printf -- '- **End (UTC):** %s\n' "$(date -u +'%Y-%m-%d %H:%M:%SZ')"
    printf -- '- **Passed:** %d\n' "$REPORT_PASS"
    printf -- '- **Failed:** %d\n' "$REPORT_FAIL"
    printf -- '- **Skipped:** %d\n' "$REPORT_SKIP"
    printf -- '- **Notes:** %d\n' "$REPORT_NOTE"
    if [ "$REPORT_FAIL" -eq 0 ]; then
      echo
      echo '**Result:** clean run — no mismatches surfaced.'
    else
      echo
      echo '**Result:** **FAILED** — see mismatch blocks above.'
    fi
  } >> "$REPORT"
}

backup_file "$CLAUDE_DESKTOP_CONFIG" "$BACKUP_DIR/claude_desktop_config.json"
backup_file "$CLAUDE_CODE_CONFIG"    "$BACKUP_DIR/.claude.json"
backup_file "$CODEX_CONFIG"          "$BACKUP_DIR/config.toml"
backup_dir  "$CLAUDE_SKILLS_DIR"     "$BACKUP_DIR/claude-skills"
backup_dir  "$CODEX_SKILLS_DIR"      "$BACKUP_DIR/codex-skills"

# Snapshot the IDs of pre-existing cli-mcp-* tokens so cleanup can diff them
# out. This list contains IDs only (no plaintext tokens, no secrets).
bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-/ {print $1}' | sort \
  > "$BACKUP_DIR/cli-mcp-ids-before.txt" || true

# -- Temp project dir for directory-scope tests -----------------------------
TEST_PROJECT=$(mktemp -d)
echo "Test project dir: $TEST_PROJECT"

# -- EXIT trap: always attempt cleanup, even on failure ---------------------
# On clean exit (rc=0), removes $BACKUP_DIR after restore to minimize secret
# residue on disk. On failure, preserves $BACKUP_DIR with a clear warning so
# the engineer can manually recover.
on_exit() {
  local rc="${1:-$?}"
  echo
  phase "Cleanup (exit code: $rc)"
  # Try token cleanup first; needs auth to work.
  cleanup_cli_mcp_tokens || true
  # Restore every config + skills dir (harmless if already correct).
  restore_file "$BACKUP_DIR/claude_desktop_config.json" "$CLAUDE_DESKTOP_CONFIG"
  restore_file "$BACKUP_DIR/.claude.json"               "$CLAUDE_CODE_CONFIG"
  restore_file "$BACKUP_DIR/config.toml"                "$CODEX_CONFIG"
  restore_dir  "$BACKUP_DIR/claude-skills"              "$CLAUDE_SKILLS_DIR"
  restore_dir  "$BACKUP_DIR/codex-skills"               "$CODEX_SKILLS_DIR"
  rm -rf "$TEST_PROJECT" 2>/dev/null || true

  if [ "$rc" -eq 0 ]; then
    # Copy the live report out to a retained location BEFORE deleting the
    # backup dir, so the engineer has a record post-run. The retained copy
    # contains only pass/fail/hash-comparison content — no secrets.
    local retained_report
    retained_report="$(dirname "$REPORT")/../test-run-$(date -u +%Y%m%dT%H%M%SZ).md"
    # Fall back to cwd if the above resolution lands somewhere weird.
    if ! cp -p "$REPORT" "$retained_report" 2>/dev/null; then
      retained_report="$PWD/test-run-$(date -u +%Y%m%dT%H%M%SZ).md"
      cp -p "$REPORT" "$retained_report" 2>/dev/null || retained_report=""
    fi
    rm -rf "$BACKUP_DIR"
    echo "Backup dir removed after successful restore (no secret residue on disk)."
    [ -n "$retained_report" ] && echo "Report retained: $retained_report"
  else
    echo
    echo "WARNING: backup dir preserved at $BACKUP_DIR due to non-zero exit ($rc)."
    echo "It contains copies of your real config files including Bearer tokens."
    echo "The live report is at: $REPORT"
    echo "Verify the restored configs are correct, then: rm -rf '$BACKUP_DIR'"
  fi
  exit "$rc"
}
trap 'on_exit $?' EXIT
```

### Auth (engineer must do this manually)

The agent **cannot** complete the OAuth device flow — it requires opening a browser and entering a code. Auth must be set up BEFORE the agent starts.

**IMPORTANT:** The env-var exports and `tiddly login` **must** run in the same terminal session that launches Claude Code. The agent's Bash tool inherits the shell environment from that launcher.

Engineer:

1. Exit/stop any running Claude Code session.
2. In a fresh terminal, run:

```bash
export TIDDLY_API_URL=http://localhost:8000
export TIDDLY_CONTENT_MCP_URL=http://localhost:8001/mcp
export TIDDLY_PROMPT_MCP_URL=http://localhost:8002/mcp
export TIDDLY_AUTH0_DOMAIN=kercheval-dev.us.auth0.com
export TIDDLY_AUTH0_CLIENT_ID=upLOqYelIdJIv7yZ8AnULA6VGklzak18
export TIDDLY_AUTH0_AUDIENCE=bookmarks-api
bin/tiddly login
```

3. Resume Claude Code from the same terminal.

The agent verifies:

```bash
bin/tiddly auth status            # Auth method: oauth, User: <email>
bin/tiddly tokens list            # Exits 0 (may say "No tokens found" — fine)
```

If `auth status` shows "Session expired" or `tokens list` errors 401, the Auth0 env vars don't match the local API's `.env`. Ask the engineer to verify `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`.

---

## Deferred / not-covered-here

The following behaviors are verified by Go unit tests, not this E2E procedure. They're listed so the agent knows they're intentionally skipped:

| Behavior | Covered by |
|---|---|
| OAuth tokens revoked after commit-phase write failure | `TestRunConfigure__oauth_commit_failure_revokes_minted_tokens` |
| Revoke failure lists orphan names + first-12 prefix | `TestRunConfigure__oauth_commit_failure_with_revoke_failure_surfaces_orphans` |
| Cleanup context detached from cancelled caller context | `TestRevokeMintedTokens__cancelled_context_fails_every_delete` + `__fresh_context_revokes_cleanly` |
| Backup path surfaced when write fails | `TestRunConfigure__commit_phase_failure_surfaces_backup_path` |
| Backup O_EXCL collision retry preserves both files | `TestBackupConfigFile__collision_retry_preserves_both` |
| Non-EEXIST OpenFile errors surface directly | `TestBackupConfigFile__non_collision_openfile_errors_surface_directly` |
| Partial-result contract (commit-phase vs. preflight) | `TestRunConfigure__commit_phase_failure_preserves_earlier_writes` + `__preflight_failure_returns_nil_result` |
| classifyServer security invariant (URL wins over name) | `TestClassifyServer__routes_by_url` |
| Survivor wording honestly describes validate-then-mint | `TestWriteConsolidationWarning__oauth_notes_validate_then_mint_fallback` |
| Interactive prompt: decline via `n` → ErrConsolidationDeclined, no writes, no mints | `TestRunConfigure__consolidation_prompt_aborts_on_no` |
| Interactive prompt: accept via `y` → proceeds with consolidation | `TestRunConfigure__consolidation_prompt_proceeds_on_yes` |

Run `make cli-verify` before this procedure to confirm those cover their invariants.

---

## How to use the report helpers

Every phase should start with `report_phase` (which also prints the stdout banner). Every test should end with either `report_test PASS|SKIP|NOTE ...` or `report_mismatch ...`. Pattern:

```bash
report_phase "Phase 1: Read-only"

# T1.1
out=$(bin/tiddly --help 2>&1)
if echo "$out" | grep -q "Usage:"; then
  report_test PASS "T1.1 — Root help"
else
  report_mismatch "T1.1" "output contains 'Usage:'" "output was: $(echo "$out" | head -1)" plan-bug "Plan assumes cobra-style usage banner"
fi
```

`report_mismatch` writes a structured block to the report AND exits non-zero, which fires the EXIT trap. Per the Reporting Protocol, this is the correct response — stop and wait for the engineer to look at the report. Don't try to recover and continue.

For tests that are environmentally skipped (e.g. T8.8 when all tools are detected), use `report_test SKIP "T8.8 — ..." "tool was detected; skip not applicable"`.

For narrative notes that aren't pass/fail (e.g. T4.4 recording which of the two acceptable outcomes fired), use `report_test NOTE "T4.4 — ..." "Path taken: reused survivor PAT"`.

---

## Phase 1: Read-only verification (no mutations)

`phase "Phase 1: Read-only"` at the start. Nothing here writes to disk or touches server state.

### [T1.1] Root help
```bash
bin/tiddly --help
```
**Verify:**
- [ ] Exit 0
- [ ] Subcommands listed: `login`, `logout`, `auth`, `status`, `mcp`, `skills`, `tokens`
- [ ] Global flags: `--token`, `--api-url`

### [T1.2] MCP help
```bash
bin/tiddly mcp --help
```
**Verify:**
- [ ] Exit 0
- [ ] Subcommands: `configure`, `status`, `remove`

### [T1.3] MCP configure help — new content must be present
```bash
bin/tiddly mcp configure --help
```
**Verify:**
- [ ] Exit 0
- [ ] Flags listed: `--dry-run`, `--scope`, `--expires`, `--servers`, `--yes` (with `-y` short form)
- [ ] Valid args: `claude-desktop`, `claude-code`, `codex`
- [ ] Help text mentions consolidation / multi-entry (e.g. "work_prompts + personal_prompts" or "consolidate")
- [ ] Help text mentions `.bak.<timestamp>` backups
- [ ] Help text does **not** contain the old misleading sentence "migrations from manual setups are safe"

### [T1.4] Skills help
```bash
bin/tiddly skills --help
```
**Verify:**
- [ ] Exit 0
- [ ] Subcommands: `configure`, `list`

### [T1.5] Status overview — config-key display invariant
```bash
# Ensure there's at least one configured tool to exercise the row format.
# (If none of your tools are configured yet, this assertion is vacuous; come
# back to it after Phase 2.)
bin/tiddly status
```
**Verify:**
- [ ] Exit 0
- [ ] Sections present: `Tiddly CLI v`, `Authentication:`, `API:`, `MCP Servers:`, `Skills:`
- [ ] Header is `MCP Servers:` (no `(path:)` when no `--path`)
- [ ] Each detected tool shown; undetected tools say `Not detected`
- [ ] For any configured Tiddly row, output matches `- <label>   <URL>  (<config_key_name>)` with the config key in parens

```bash
bin/tiddly status --path "$TEST_PROJECT"
```
**Verify:**
- [ ] Exit 0
- [ ] Header is `MCP Servers (path: $TEST_PROJECT):`

```bash
bin/tiddly status --path /nonexistent/path
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error contains `does not exist`

### [T1.6] Auth status
```bash
bin/tiddly auth status
```
**Verify:**
- [ ] Exit 0
- [ ] Output contains `Auth method:` (one of `pat`, `oauth`, `flag`, `env`)
- [ ] Output contains `API URL:`

```bash
assert_auth_still_working
```

---

## Phase 2: Configure happy paths

`phase "Phase 2: Configure"`. Begins mutating config files. All writes are preceded by CLI-taken `.bak.<ts>` backups; Phase 0 also snapshotted everything into `$BACKUP_DIR`.

### [T2.1] Claude Code — user scope (default)
```bash
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
out=$(bin/tiddly mcp configure claude-code 2>&1)
echo "$out"

# Capture the EXACT backup path from output (not a glob match on stale files).
backup_path=$(echo "$out" | sed -n 's/.*Backed up claude-code config to \(.*\)$/\1/p' | head -1)
```
**Verify (structural checks only — never echo header values):**
- [ ] Exit 0
- [ ] Output contains `Configured: claude-code`
- [ ] If `pre_sha != MISSING`: `$backup_path` is non-empty AND `[ -f "$backup_path" ]`
- [ ] If backup was taken: `[ "$pre_sha" = "$(sha_of "$backup_path")" ]` — backup contents match pre-command state
- [ ] If backup was taken: `[ "$(file_mode "$CLAUDE_CODE_CONFIG")" = "$(file_mode "$backup_path")" ]` — permissions preserved
- [ ] `jq -e '.mcpServers.tiddly_notes_bookmarks.type == "http"' "$CLAUDE_CODE_CONFIG" >/dev/null` — content entry present with HTTP type
- [ ] `jq -e '.mcpServers.tiddly_notes_bookmarks.url == env.TIDDLY_CONTENT_MCP_URL' "$CLAUDE_CODE_CONFIG" >/dev/null` — URL matches
- [ ] `jq -e '.mcpServers.tiddly_notes_bookmarks.headers.Authorization | startswith("Bearer bm_")' "$CLAUDE_CODE_CONFIG" >/dev/null` — Authorization well-formed (no value printed)
- [ ] `jq -e '.mcpServers.tiddly_prompts.url == env.TIDDLY_PROMPT_MCP_URL' "$CLAUDE_CODE_CONFIG" >/dev/null` — prompts entry present
- [ ] `jq -e '.mcpServers.tiddly_prompts.headers.Authorization | startswith("Bearer bm_")' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] Non-Tiddly server entries preserved (if any existed pre-command, their keys still exist): record `jq -r '.mcpServers | keys[]' "$CLAUDE_CODE_CONFIG"` before/after and diff key sets; tiddly_* keys are added but nothing else removed

### [T2.2] Claude Code — --servers content (preserves prompts)
```bash
bin/tiddly mcp configure claude-code --servers content
```
**Verify:**
- [ ] Exit 0
- [ ] `jq -e '.mcpServers.tiddly_notes_bookmarks' "$CLAUDE_CODE_CONFIG" >/dev/null` — content present
- [ ] `jq -e '.mcpServers.tiddly_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null` — prompts from T2.1 preserved

### [T2.3] Claude Code — --servers prompts (preserves content)
```bash
bin/tiddly mcp configure claude-code --servers prompts
```
**Verify:**
- [ ] `jq -e '.mcpServers.tiddly_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] `jq -e '.mcpServers.tiddly_notes_bookmarks' "$CLAUDE_CODE_CONFIG" >/dev/null` — content from T2.2 preserved

### [T2.4] Claude Code — directory scope
```bash
cd "$TEST_PROJECT" && bin/tiddly mcp configure claude-code --scope directory
```
**Verify:**
- [ ] Exit 0
- [ ] `jq -e --arg p "$TEST_PROJECT" '.projects[$p].mcpServers.tiddly_notes_bookmarks' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] `jq -e --arg p "$TEST_PROJECT" '.projects[$p].mcpServers.tiddly_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] Top-level `mcpServers` NOT modified (compare `jq '.mcpServers' "$CLAUDE_CODE_CONFIG"` key set before/after — NEVER print values)

### [T2.5] Codex — user scope
```bash
pre_sha=$(sha_of "$CODEX_CONFIG")
out=$(bin/tiddly mcp configure codex 2>&1)
backup_path=$(echo "$out" | sed -n 's/.*Backed up codex config to \(.*\)$/\1/p' | head -1)
```
**Verify (use a TOML parser — `python3 -c` with `tomllib` on Python 3.11+, or `tomlq` if installed — for structural checks without echoing values):**
- [ ] Exit 0
- [ ] If `pre_sha != MISSING`: `[ -f "$backup_path" ]` and `[ "$pre_sha" = "$(sha_of "$backup_path")" ]`
- [ ] `python3 -c 'import tomllib,sys; c=tomllib.load(open(sys.argv[1],"rb")); assert c["mcp_servers"]["tiddly_notes_bookmarks"]["url"], "content URL missing"; assert c["mcp_servers"]["tiddly_notes_bookmarks"]["http_headers"]["Authorization"].startswith("Bearer bm_"), "content Auth malformed"' "$CODEX_CONFIG"` — structural check, no values printed
- [ ] Same for `tiddly_prompts`
- [ ] Existing non-Tiddly section keys preserved (record `python3 -c 'import tomllib,sys; print(sorted(tomllib.load(open(sys.argv[1],"rb")).keys()))' "$CODEX_CONFIG"` before/after — top-level key set unchanged)

### [T2.6] Codex — directory scope
```bash
cd "$TEST_PROJECT" && bin/tiddly mcp configure codex --scope directory
```
**Verify:**
- [ ] `[ -f "$TEST_PROJECT/.codex/config.toml" ]`
- [ ] Structural check (same pattern as T2.5) confirms both Tiddly entries exist under `mcp_servers`
- [ ] User-scope `$CODEX_CONFIG` NOT modified (compare `sha_of` before/after)

### [T2.7] Claude Desktop — user scope
```bash
pre_sha=$(sha_of "$CLAUDE_DESKTOP_CONFIG")
out=$(bin/tiddly mcp configure claude-desktop 2>&1)
backup_path=$(echo "$out" | sed -n 's/.*Backed up claude-desktop config to \(.*\)$/\1/p' | head -1)
```
**Verify:**
- [ ] Exit 0
- [ ] If `pre_sha != MISSING`: `[ -f "$backup_path" ]` and backup contents match pre-command state
- [ ] `jq -e '.mcpServers.tiddly_notes_bookmarks.command == "npx"' "$CLAUDE_DESKTOP_CONFIG" >/dev/null`
- [ ] `jq -e '.mcpServers.tiddly_notes_bookmarks.args | contains(["mcp-remote"])' "$CLAUDE_DESKTOP_CONFIG" >/dev/null`
- [ ] `jq -e --arg u "$TIDDLY_CONTENT_MCP_URL" '.mcpServers.tiddly_notes_bookmarks.args | contains([$u])' "$CLAUDE_DESKTOP_CONFIG" >/dev/null`
- [ ] `jq -e '.mcpServers.tiddly_notes_bookmarks.args | map(startswith("Authorization: Bearer bm_")) | any' "$CLAUDE_DESKTOP_CONFIG" >/dev/null` — one arg is the well-formed auth header; never printed
- [ ] Same assertions for `tiddly_prompts` with prompts URL
- [ ] Stderr contains `Restart Claude Desktop to apply changes.`
- [ ] Non-Tiddly server keys preserved (diff `jq -r '.mcpServers | keys[]'` before/after)

### [T2.8] --expires flag mints with expiration
```bash
bin/tiddly mcp remove claude-code --delete-tokens 2>/dev/null
bin/tiddly mcp configure claude-code --expires 30
```
**Verify:**
- [ ] Output `Created tokens: cli-mcp-claude-code-*` (not `Reused`)
- [ ] `bin/tiddly tokens list` shows those tokens with an expiration roughly 30 days out

### [T2.9] Auto-detect (no tool arg)
```bash
bin/tiddly mcp configure
```
**Verify:**
- [ ] Exit 0
- [ ] `Configured:` lists every detected tool
- [ ] Each tool's config updated

### [T2.10] Status after configure — row format correlates
```bash
bin/tiddly status
```
**Verify:**
- [ ] Each Tiddly row shows `(tiddly_notes_bookmarks)` or `(tiddly_prompts)` — the actual config key, matching what's on disk
- [ ] Multiple scopes render correctly per tool

```bash
assert_auth_still_working
```

---

## Phase 3: Dry-run

`phase "Phase 3: Dry-run"`. Nothing here mutates config files or server state.

### [T3.1] Dry-run — Claude Code user scope + PAT-auth advisory (if PAT auth)
```bash
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
bin/tiddly mcp configure claude-code --dry-run 2> /tmp/dry_run_stderr
```
**Verify:**
- [ ] Exit 0
- [ ] Stdout contains `--- claude-code ---`
- [ ] Contains `File: ` followed by config path
- [ ] Contains `Before:` and `After:` sections (or `(new file)`)
- [ ] `After:` section shows `tiddly_notes_bookmarks` and `tiddly_prompts`
- [ ] **If current auth is PAT (not OAuth):** `/tmp/dry_run_stderr` contains `Using your current token for MCP servers` — the PAT-auth advisory must fire in dry-run
- [ ] **If current auth is OAuth:** no such advisory expected
- [ ] `assert_unchanged T3.1 "$CLAUDE_CODE_CONFIG" "$pre_sha"`
- [ ] No new tokens created: `tokens list` count unchanged before/after

### [T3.2] Dry-run — directory scope
```bash
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
cd "$TEST_PROJECT" && bin/tiddly mcp configure claude-code --scope directory --dry-run
```
**Verify:**
- [ ] Diff shown under the project-path key
- [ ] `assert_unchanged T3.2 "$CLAUDE_CODE_CONFIG" "$pre_sha"`

### [T3.3] Dry-run — placeholder for would-be-new tokens
```bash
# Remove tokens first so there's nothing to reuse.
bin/tiddly mcp remove claude-code --delete-tokens 2>/dev/null || true
bin/tiddly mcp configure claude-code --dry-run
```
**Verify:**
- [ ] `After:` section shows `<new-token-would-be-created>` placeholder
- [ ] No tokens actually created (confirm via `tokens list`)

### [T3.4] Dry-run — Codex
```bash
pre_sha=$(sha_of "$CODEX_CONFIG")
bin/tiddly mcp configure codex --dry-run
```
**Verify:**
- [ ] Output contains `--- codex ---`
- [ ] TOML format in Before/After
- [ ] `assert_unchanged T3.4 "$CODEX_CONFIG" "$pre_sha"`

### [T3.5] Dry-run — Claude Desktop
```bash
pre_sha=$(sha_of "$CLAUDE_DESKTOP_CONFIG")
bin/tiddly mcp configure claude-desktop --dry-run
```
**Verify:**
- [ ] Output contains `--- claude-desktop ---`
- [ ] JSON with `npx` + `mcp-remote` in `After:`
- [ ] `assert_unchanged T3.5 "$CLAUDE_DESKTOP_CONFIG" "$pre_sha"`

### [T3.6] Dry-run does NOT list "Configured:" in real summary
```bash
out=$(bin/tiddly mcp configure claude-code --dry-run)
```
**Verify:**
- [ ] Output does NOT contain `Configured: claude-code` — the summary line is gated on non-dry-run. The `--- claude-code ---` banner and diff are the dry-run signal.

```bash
assert_auth_still_working
```

---

## Phase 4: Multi-entry consolidation gate (NEW — headline scope of this round)

`phase "Phase 4: Multi-entry consolidation gate"`. These tests exercise the preflight → gate → commit flow added in recent commits. They need a hand-crafted multi-entry config.

**Interactive prompt reading is NOT covered E2E** — piping `y`/`n` into a pipe trips the `term.IsTerminal` check and hits the non-interactive error path, never reaching the prompt reader. See `TestRunConfigure__consolidation_prompt_proceeds_on_yes` / `__aborts_on_no` for the interactive paths. The E2E tests below cover non-interactive behavior (error without `--yes`, `--yes` bypass, vacancy), which is what the CLI sees under typical scripted use.

### Setup helper — write a multi-entry Claude Code config

```bash
write_multi_entry_prompts() {
  # Merges two multi-entry prompt rows into the EXISTING $CLAUDE_CODE_CONFIG
  # via jq. Preserves any non-Tiddly MCP servers (github, filesystem, etc.)
  # and any other top-level keys the user has. Also strips any existing
  # canonical tiddly_* entries — they'd be redundant with the multi-entry
  # test setup.
  local pat_work="$1" pat_personal="$2"
  local tmp
  tmp=$(mktemp)
  # If the file doesn't exist yet, start from an empty object.
  local src="$CLAUDE_CODE_CONFIG"
  [ -f "$src" ] || echo "{}" > "$src"
  jq --arg url "$TIDDLY_PROMPT_MCP_URL" \
     --arg work "$pat_work" --arg personal "$pat_personal" \
     '.mcpServers = (.mcpServers // {})
      | .mcpServers.work_prompts     = {type:"http", url:$url, headers:{Authorization:("Bearer "+$work)}}
      | .mcpServers.personal_prompts = {type:"http", url:$url, headers:{Authorization:("Bearer "+$personal)}}
      | del(.mcpServers.tiddly_notes_bookmarks, .mcpServers.tiddly_prompts)' \
     "$src" > "$tmp" && mv "$tmp" "$src"
  chmod 0600 "$src"
}
```

Under OAuth, mint two real tokens you'll hand to the multi-entry config. First, a one-time format probe fails fast with a clear error if `tokens create` output isn't what we expect:

```bash
# Probe the 'tokens create' output format BEFORE committing to the real mints.
# Format contract: stdout contains a line starting with 'bm_' (the plaintext PAT).
# If this assumption ever breaks (e.g. output changes to JSON), fail here with a
# specific message rather than silently producing empty PAT variables.
probe_name="cli-mcp-test-probe-$(openssl rand -hex 3)"
probe_out=$(bin/tiddly tokens create "$probe_name" 2>&1) || { echo "FATAL: tokens create failed during format probe"; echo "$probe_out"; exit 1; }
probe_pat=$(echo "$probe_out" | awk '/^bm_/ {print $1; exit}')
[ -n "$probe_pat" ] || { echo "FATAL: 'tokens create' output format unexpected. Saw: $probe_out. Plan must be updated to match actual format."; exit 1; }
# Immediately revoke the probe so it doesn't linger as a test artifact.
probe_id=$(bin/tiddly tokens list 2>/dev/null | awk -v n="$probe_name" '$0 ~ n {print $1; exit}')
[ -n "$probe_id" ] && bin/tiddly tokens delete "$probe_id" --force 2>/dev/null
unset probe_pat probe_out probe_id   # don't let the plaintext linger

# Now mint the two test tokens we'll use throughout Phase 4.
PAT_WORK=$(bin/tiddly tokens create "cli-mcp-test-multi-work-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')
PAT_PERSONAL=$(bin/tiddly tokens create "cli-mcp-test-multi-personal-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')
[ -n "$PAT_WORK" ] && [ -n "$PAT_PERSONAL" ] || { echo "FATAL: failed to mint test tokens"; exit 1; }
# NOTE: do NOT run `echo "$PAT_WORK"` or similar at any point. The first-12
# prefix below matches the settings UI's TokenPrefix and is safe to display.
echo "Minted test PATs: work prefix=${PAT_WORK:0:12} personal prefix=${PAT_PERSONAL:0:12}"
```

> The full plaintext values are held in `PAT_WORK` / `PAT_PERSONAL` only for use inside the heredoc that writes the multi-entry config. They must never be echoed or appear in subsequent pipelines except as the input to hash-compares.

### [T4.1] Dry-run — warning + survivor disclosure + header
```bash
write_multi_entry_prompts "$PAT_WORK" "$PAT_PERSONAL"
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
out=$(bin/tiddly mcp configure claude-code --dry-run 2>&1)
echo "$out"
```
**Verify:**
- [ ] Stdout contains `Consolidation required:` (leading header that matches real-run gate)
- [ ] Contains `claude-code:` followed by `2 existing Tiddly prompts entries will be consolidated into tiddly_prompts`
- [ ] Both `personal_prompts` and `work_prompts` appear in the entry list
- [ ] Contains the line `PAT from "personal_prompts" will be reused for tiddly_prompts if still valid; otherwise a fresh token will be minted.` (canonical-first-else-alphabetical picks `personal_prompts`)
- [ ] `* ` marker next to `personal_prompts` in the entry list
- [ ] `assert_unchanged T4.1 "$CLAUDE_CODE_CONFIG" "$pre_sha"`
- [ ] `tokens list` shows no new cli-mcp-* tokens created by this run

### [T4.2] Non-interactive without `--yes` errors with actionable message
```bash
write_multi_entry_prompts "$PAT_WORK" "$PAT_PERSONAL"
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
before_ids=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-/ {print $1}' | sort)
# </dev/null ensures stdin is not a TTY — triggers the non-interactive path.
set +e
out=$(bin/tiddly mcp configure claude-code < /dev/null 2>&1); rc=$?
set -e
echo "$out"
echo "exit: $rc"
after_ids=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-/ {print $1}' | sort)
```
**Verify:**
- [ ] `rc != 0`
- [ ] Output contains `consolidation needs confirmation`
- [ ] Output contains `re-run with --yes to proceed, or --dry-run to preview`
- [ ] `assert_unchanged T4.2 "$CLAUDE_CODE_CONFIG" "$pre_sha"`
- [ ] `[ "$before_ids" = "$after_ids" ]` — no cli-mcp-* tokens were minted (critical: proves gate runs BEFORE PAT resolution under OAuth)

### [T4.4] `--yes` bypasses prompt, consolidation happens
```bash
write_multi_entry_prompts "$PAT_WORK" "$PAT_PERSONAL"
out=$(bin/tiddly mcp configure claude-code --yes < /dev/null 2>&1)
echo "$out"
```
**Verify:**
- [ ] Exit 0
- [ ] Output contains `Consolidation required:` + warning
- [ ] Output contains `Proceeding (--yes).`
- [ ] Output does NOT contain `Continue? [y/N]:` (prompt skipped)
- [ ] `jq -e '.mcpServers.tiddly_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null` — canonical written
- [ ] `jq -e '.mcpServers.work_prompts // empty | length == 0' "$CLAUDE_CODE_CONFIG" >/dev/null` — work key gone
- [ ] `jq -e '.mcpServers.personal_prompts // empty | length == 0' "$CLAUDE_CODE_CONFIG" >/dev/null` — personal key gone
- [ ] **Survivor value check via hash-compare only (neither value printed):**
  ```bash
  # The alphabetically-first entry (personal_prompts) wins under canonical-first-else-
  # alphabetical. Its PAT becomes the tiddly_prompts Authorization IFF validate-then-mint
  # reused it. If validation rejected it and a fresh token was minted, the survivor value
  # differs — both outcomes are acceptable per the disclosure wording. Record which path
  # fired for the agent to include in the run summary.
  expected=$(printf 'Bearer %s' "$PAT_PERSONAL" | SHA256 | awk '{print $1}')
  actual=$(jq -r '.mcpServers.tiddly_prompts.headers.Authorization' "$CLAUDE_CODE_CONFIG" | SHA256 | awk '{print $1}')
  if [ "$expected" = "$actual" ]; then
    echo "Path taken: reused survivor PAT (personal_prompts)"
  else
    echo "Path taken: minted fresh token (validate-then-mint fallback)"
    # In the mint case, verify a fresh cli-mcp-* token was created:
    bin/tiddly tokens list 2>/dev/null | grep -q 'cli-mcp-claude-code-prompts-' || { echo "FAIL: mint expected but no cli-mcp- prompts token created"; exit 1; }
  fi
  ```

### [T4.6] Canonical-only config — no gate fires
```bash
# Restore canonical-only state
bin/tiddly mcp configure claude-code --yes 2>/dev/null
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
out=$(bin/tiddly mcp configure claude-code < /dev/null 2>&1)
```
**Verify:**
- [ ] Exit 0
- [ ] Output does NOT contain `Consolidation required:` (no gate needed)
- [ ] Output does NOT contain `Continue? [y/N]:` or error about confirmation
- [ ] Normal `Configured: claude-code` summary appears

### [T4.7] Dry-run — no header when no consolidation
```bash
# (still canonical-only after T4.6)
out=$(bin/tiddly mcp configure claude-code --dry-run 2>&1)
```
**Verify:**
- [ ] Output does NOT contain `Consolidation required:` (only fires when warranted)
- [ ] Normal dry-run diff still shown

### [T4.8] Cross-tool gate — one prompt, multiple tools
```bash
# Multi-entry on two tools simultaneously.
write_multi_entry_prompts "$PAT_WORK" "$PAT_PERSONAL"
# Hand-craft matching multi-entry on claude-desktop too:
cat > "$CLAUDE_DESKTOP_CONFIG" <<JSON
{
  "mcpServers": {
    "work_prompts": {
      "command": "npx",
      "args": ["mcp-remote", "${TIDDLY_PROMPT_MCP_URL}", "--header", "Authorization: Bearer ${PAT_WORK}"]
    },
    "personal_prompts": {
      "command": "npx",
      "args": ["mcp-remote", "${TIDDLY_PROMPT_MCP_URL}", "--header", "Authorization: Bearer ${PAT_PERSONAL}"]
    }
  }
}
JSON
set +e
out=$(echo "n" | bin/tiddly mcp configure 2>&1); rc=$?
set -e
```
**Verify:**
- [ ] `rc != 0` (declined)
- [ ] Output lists BOTH `claude-code:` and `claude-desktop:` under the single `Consolidation required:` header
- [ ] Only ONE `Continue? [y/N]:` prompt in the output (not two)
- [ ] Both configs still have `work_prompts` + `personal_prompts` — atomic decline

### [T4.9] Codex multi-entry consolidation (TOML format)

The bug this branch fixes cuts symmetrically across all three detectors. Phase 4 through T4.8 only exercised the JSON-formatted detectors (claude-code, claude-desktop). This test covers the Codex handler's `AllTiddlyPATs` and consolidation warning under the TOML format.

```bash
# Mint two fresh test tokens for Codex multi-entry setup.
PAT_WORK_CODEX=$(bin/tiddly tokens create "cli-mcp-test-codex-work-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')
PAT_PERSONAL_CODEX=$(bin/tiddly tokens create "cli-mcp-test-codex-personal-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')
[ -n "$PAT_WORK_CODEX" ] && [ -n "$PAT_PERSONAL_CODEX" ] || { echo "FATAL: failed to mint codex test tokens"; exit 1; }

# Write a multi-entry Codex config via Python (tomllib + re-emit) rather than
# a heredoc, so non-Tiddly sections are preserved like the claude-code helper.
python3 <<PY
import tomllib, sys, os
path = os.environ["CODEX_CONFIG"]
try:
    with open(path, "rb") as f: cfg = tomllib.load(f)
except FileNotFoundError:
    cfg = {}
cfg.setdefault("mcp_servers", {})
# Remove any canonical tiddly_* entries (redundant with multi-entry test)
cfg["mcp_servers"].pop("tiddly_notes_bookmarks", None)
cfg["mcp_servers"].pop("tiddly_prompts", None)
cfg["mcp_servers"]["work_prompts"] = {
    "url": os.environ["TIDDLY_PROMPT_MCP_URL"],
    "http_headers": {"Authorization": f"Bearer {os.environ['PAT_WORK_CODEX']}"},
}
cfg["mcp_servers"]["personal_prompts"] = {
    "url": os.environ["TIDDLY_PROMPT_MCP_URL"],
    "http_headers": {"Authorization": f"Bearer {os.environ['PAT_PERSONAL_CODEX']}"},
}
# Emit TOML without a dependency: the CLI tolerates the format the Python
# json module produces if we re-read the file as TOML? No — we need a TOML
# writer. Use a minimal hand-emit that matches Codex's documented format.
def emit_table(prefix, tbl):
    lines = [f"[{prefix}]"]
    subtables = {}
    for k, v in tbl.items():
        if isinstance(v, dict): subtables[k] = v
        elif isinstance(v, str): lines.append(f'{k} = "{v}"')
    out = "\n".join(lines) + "\n"
    for k, v in subtables.items():
        out += "\n" + emit_table(f"{prefix}.{k}", v)
    return out
with open(path, "w") as f:
    # Preserve non-mcp_servers top-level keys in their current string form.
    for k, v in cfg.items():
        if k == "mcp_servers": continue
        if isinstance(v, str): f.write(f'{k} = "{v}"\n')
    for name, tbl in cfg["mcp_servers"].items():
        f.write("\n" + emit_table(f"mcp_servers.{name}", tbl))
os.chmod(path, 0o600)
PY
export PAT_WORK_CODEX PAT_PERSONAL_CODEX

out=$(bin/tiddly mcp configure codex --yes < /dev/null 2>&1)
echo "$out"
```
**Verify:**
- [ ] Exit 0
- [ ] Output contains `Consolidation required:` header
- [ ] Output contains `codex:` followed by `2 existing Tiddly prompts entries will be consolidated into tiddly_prompts`
- [ ] Output lists both `personal_prompts` and `work_prompts`
- [ ] Output contains `PAT from "personal_prompts" will be reused for tiddly_prompts if still valid`
- [ ] `python3 -c 'import tomllib,sys; c=tomllib.load(open(sys.argv[1],"rb")); assert "tiddly_prompts" in c["mcp_servers"]; assert "work_prompts" not in c["mcp_servers"]; assert "personal_prompts" not in c["mcp_servers"]' "$CODEX_CONFIG"` — canonical written, customs gone
- [ ] Unset the plaintext: `unset PAT_WORK_CODEX PAT_PERSONAL_CODEX`

### [T4.10] Validate-then-mint fallback fires when survivor PAT is invalid

T4.4 accepts either "reuse" or "mint" as valid outcomes. T4.10 deliberately forces the mint path by killing the would-be-survivor server-side, then proves the disclosure's "otherwise a fresh token will be minted" caveat actually fires.

```bash
# Rebuild multi-entry state (tokens from Phase 4 may have been consolidated).
PAT_WORK_T410=$(bin/tiddly tokens create "cli-mcp-test-t410-work-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')
PAT_PERSONAL_T410=$(bin/tiddly tokens create "cli-mcp-test-t410-personal-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')
write_multi_entry_prompts "$PAT_WORK_T410" "$PAT_PERSONAL_T410"

# Kill the would-be-survivor (personal_prompts — alphabetically first).
personal_id=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-test-t410-personal-/ {print $1; exit}')
[ -n "$personal_id" ] || { echo "FATAL: could not find personal_prompts test token"; exit 1; }
bin/tiddly tokens delete "$personal_id" --force 2>/dev/null

# Record prompts-related cli-mcp-* tokens BEFORE configure.
before_mints=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-claude-code-prompts-/ {print $1}' | sort)

# Configure — validate-then-mint should fire because personal's PAT is now 401.
out=$(bin/tiddly mcp configure claude-code --yes < /dev/null 2>&1)
echo "$out"

after_mints=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-claude-code-prompts-/ {print $1}' | sort)
new_mints=$(comm -13 <(echo "$before_mints") <(echo "$after_mints"))
```
**Verify:**
- [ ] Exit 0
- [ ] Output contains `Created tokens:` with a `cli-mcp-claude-code-prompts-*` entry — a fresh token was minted
- [ ] `[ -n "$new_mints" ]` — at least one new prompts token exists server-side
- [ ] `jq -e '.mcpServers.tiddly_prompts.headers.Authorization | startswith("Bearer bm_")' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] **Negative survivor check (hash-compare only):** the new Authorization value should NOT equal `Bearer $PAT_PERSONAL_T410` (the revoked token):
  ```bash
  rejected=$(printf 'Bearer %s' "$PAT_PERSONAL_T410" | SHA256 | awk '{print $1}')
  actual=$(jq -r '.mcpServers.tiddly_prompts.headers.Authorization' "$CLAUDE_CODE_CONFIG" | SHA256 | awk '{print $1}')
  [ "$rejected" != "$actual" ] || { echo "FAIL: survivor PAT was reused despite being invalid"; exit 1; }
  ```
- [ ] Unset plaintext: `unset PAT_WORK_T410 PAT_PERSONAL_T410`

### [T4.11] Mixed content + prompts multi-entry — both groups render under one header

Unit tests cover the code path; this locks in the E2E warning format when BOTH server types are multi-entry simultaneously.

```bash
# Mint four fresh tokens for the mixed-multi-entry setup.
PC1=$(bin/tiddly tokens create "cli-mcp-test-mixed-c1-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')
PC2=$(bin/tiddly tokens create "cli-mcp-test-mixed-c2-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')
PP1=$(bin/tiddly tokens create "cli-mcp-test-mixed-p1-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')
PP2=$(bin/tiddly tokens create "cli-mcp-test-mixed-p2-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')

# Write four entries via jq merge (preserves non-Tiddly entries).
tmp=$(mktemp)
[ -f "$CLAUDE_CODE_CONFIG" ] || echo "{}" > "$CLAUDE_CODE_CONFIG"
jq --arg curl "$TIDDLY_CONTENT_MCP_URL" --arg purl "$TIDDLY_PROMPT_MCP_URL" \
   --arg pc1 "$PC1" --arg pc2 "$PC2" --arg pp1 "$PP1" --arg pp2 "$PP2" \
   '.mcpServers = (.mcpServers // {})
    | del(.mcpServers.tiddly_notes_bookmarks, .mcpServers.tiddly_prompts)
    | .mcpServers.work_content     = {type:"http", url:$curl, headers:{Authorization:("Bearer "+$pc1)}}
    | .mcpServers.personal_content = {type:"http", url:$curl, headers:{Authorization:("Bearer "+$pc2)}}
    | .mcpServers.work_prompts     = {type:"http", url:$purl, headers:{Authorization:("Bearer "+$pp1)}}
    | .mcpServers.personal_prompts = {type:"http", url:$purl, headers:{Authorization:("Bearer "+$pp2)}}' \
   "$CLAUDE_CODE_CONFIG" > "$tmp" && mv "$tmp" "$CLAUDE_CODE_CONFIG"
chmod 0600 "$CLAUDE_CODE_CONFIG"

out=$(bin/tiddly mcp configure claude-code --dry-run < /dev/null 2>&1)
echo "$out"

# Tokens go in the normal Phase 10 cleanup (they all match cli-mcp-test-mixed-).
unset PC1 PC2 PP1 PP2
```
**Verify:**
- [ ] Exit 0
- [ ] Exactly ONE `Consolidation required:` header in the output (single header covers both groups)
- [ ] Output contains `2 existing Tiddly content entries will be consolidated into tiddly_notes_bookmarks`
- [ ] Output contains `2 existing Tiddly prompts entries will be consolidated into tiddly_prompts`
- [ ] All four entry names appear in the listing: `work_content`, `personal_content`, `work_prompts`, `personal_prompts`
- [ ] `assert_unchanged T4.11 "$CLAUDE_CODE_CONFIG" "$(sha_of "$CLAUDE_CODE_CONFIG")"` — dry-run did nothing

```bash
assert_auth_still_working
```

---

## Phase 5: Status

`phase "Phase 5: Status"`.

### [T5.1] Status all scopes (default path)
```bash
bin/tiddly mcp status
```
**Verify:**
- [ ] Exit 0
- [ ] Tree output per tool
- [ ] For scopes with no Tiddly entries: output contains `No Tiddly servers configured. Run '` followed by a hint (e.g. `tiddly mcp configure claude-code`)
- [ ] For scopes with Tiddly entries: server rows end with `(<config_key>)` suffix
- [ ] Header is `MCP Servers:`

### [T5.2] Status with explicit project path
```bash
bin/tiddly mcp status --path "$TEST_PROJECT"
```
**Verify:**
- [ ] Header: `MCP Servers (path: $TEST_PROJECT):`
- [ ] claude-code directory scope shows `~/.claude.json → projects[...]` annotation

### [T5.3] Status with invalid path
```bash
bin/tiddly mcp status --path /nonexistent/path
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error contains `does not exist`

### [T5.4] Multi-entry rendered as multiple rows (regression guard for KAN-112)
```bash
write_multi_entry_prompts "$PAT_WORK" "$PAT_PERSONAL"
out=$(bin/tiddly mcp status 2>&1)
```
**Verify:**
- [ ] Output contains TWO prompt rows under claude-code
- [ ] One is `- prompts  <url>  (work_prompts)`
- [ ] Other is `- prompts  <url>  (personal_prompts)`
- [ ] Neither appears under "Other servers"

```bash
# Restore canonical-only for subsequent phases.
bin/tiddly mcp configure claude-code --yes 2>/dev/null
assert_auth_still_working
```

---

## Phase 6: Remove

`phase "Phase 6: Remove"`.

### [T6.1] Remove Claude Code user scope
```bash
bin/tiddly mcp configure claude-code    # ensure configured
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
out=$(bin/tiddly mcp remove claude-code 2>&1)
echo "$out"
backup_path=$(echo "$out" | sed -n 's/.*Backed up previous config to \(.*\)$/\1/p' | head -1)
```
**Verify:**
- [ ] Exit 0
- [ ] Output contains `Removed Tiddly MCP servers from claude-code.`
- [ ] `[ -n "$backup_path" ]` and `[ -f "$backup_path" ]` — exact backup from this command exists
- [ ] `[ "$pre_sha" = "$(sha_of "$backup_path")" ]` — backup contains pre-remove state
- [ ] `jq -e '.mcpServers.tiddly_notes_bookmarks // empty | length == 0' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] `jq -e '.mcpServers.tiddly_prompts // empty | length == 0' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] Non-Tiddly keys preserved (diff `jq -r '.mcpServers | keys[]'` before-remove vs now; pre-remove had tiddly_*; now tiddly_* gone; everything else unchanged)
- [ ] Stderr may contain an orphan-token warning

### [T6.2] Remove Claude Code directory scope
```bash
cd "$TEST_PROJECT" && bin/tiddly mcp configure claude-code --scope directory
cd "$TEST_PROJECT" && bin/tiddly mcp remove claude-code --scope directory
```
**Verify:**
- [ ] `projects["$TEST_PROJECT"].mcpServers` has no Tiddly keys
- [ ] Top-level `mcpServers` NOT modified

### [T6.3] Remove Codex
```bash
bin/tiddly mcp configure codex
bin/tiddly mcp remove codex
```
**Verify:**
- [ ] Output: `Removed Tiddly MCP servers from codex.`
- [ ] `$CODEX_CONFIG` has no `tiddly_*` entries

### [T6.4] Remove Claude Desktop
```bash
bin/tiddly mcp configure claude-desktop
bin/tiddly mcp remove claude-desktop
```
**Verify:**
- [ ] Output: `Removed Tiddly MCP servers from claude-desktop.`
- [ ] Stderr: `Restart Claude Desktop to apply changes.`
- [ ] Config has no `tiddly_*` entries

### [T6.5] Remove `--servers content` (partial remove)
```bash
bin/tiddly mcp configure claude-code
bin/tiddly mcp remove claude-code --servers content
```
**Verify:**
- [ ] `tiddly_notes_bookmarks` removed
- [ ] `tiddly_prompts` still present

### [T6.6] Remove `--servers prompts` (partial remove)
```bash
bin/tiddly mcp configure claude-code
bin/tiddly mcp remove claude-code --servers prompts
```
**Verify:**
- [ ] `tiddly_prompts` removed
- [ ] `tiddly_notes_bookmarks` still present

### [T6.7] Remove with `--delete-tokens` (clean single-entry case)
```bash
# Clean install so we know exactly what was minted.
bin/tiddly mcp remove claude-code 2>/dev/null || true
out_configure=$(bin/tiddly mcp configure claude-code 2>&1)
echo "$out_configure"
out_remove=$(bin/tiddly mcp remove claude-code --delete-tokens 2>&1)
echo "$out_remove"
```
**Verify:**
- [ ] `out_configure` contains `Created tokens:` followed by `cli-mcp-claude-code-*` names
- [ ] `out_remove` contains `Deleted tokens:` listing those exact names
- [ ] `bin/tiddly tokens list` confirms those tokens are gone

### [T6.8] Remove `--delete-tokens` MULTI-ENTRY — HEADLINE REGRESSION GUARD

This test intentionally re-mints its own tokens in setup so it doesn't depend on Phase 4 state surviving intermediate phases.

```bash
# Fresh tokens scoped to this test only.
PAT_WORK_68=$(bin/tiddly tokens create "cli-mcp-test-6-8-work-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')
PAT_PERSONAL_68=$(bin/tiddly tokens create "cli-mcp-test-6-8-personal-$(openssl rand -hex 3)" 2>&1 | awk '/^bm_/ {print $1; exit}')
[ -n "$PAT_WORK_68" ] && [ -n "$PAT_PERSONAL_68" ] || { echo "FATAL: token mint failed"; exit 1; }

write_multi_entry_prompts "$PAT_WORK_68" "$PAT_PERSONAL_68"

# Capture the specific token IDs we just created (name match on the 6-8 suffix).
before=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-test-6-8-/ {print $1}' | sort)
echo "Tokens before remove: $before"

out=$(bin/tiddly mcp remove claude-code --servers prompts --delete-tokens 2>&1)
echo "$out"

after=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-test-6-8-/ {print $1}' | sort)
echo "Tokens after remove: $after"

# Unset the plaintext — no further use.
unset PAT_WORK_68 PAT_PERSONAL_68
```
**Verify:**
- [ ] Exit 0
- [ ] `out` contains `Deleted tokens:` listing BOTH `cli-mcp-test-6-8-*` token names (the pre-fix bug revoked only one)
- [ ] `[ -z "$after" ]` — both tokens actually gone from the server
- [ ] `jq -e '.mcpServers.work_prompts // empty | length == 0' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] `jq -e '.mcpServers.personal_prompts // empty | length == 0' "$CLAUDE_CODE_CONFIG" >/dev/null`

This is the test that would have failed before commit 4. If it passes, the multi-entry orphan bug is truly fixed end-to-end.

### [T6.9] Remove without `--delete-tokens` — orphan warning
```bash
bin/tiddly mcp configure claude-code
out=$(bin/tiddly mcp remove claude-code 2>&1)
```
**Verify:**
- [ ] Stderr contains `Warning: PATs created for claude-code may still exist:` (followed by cli-mcp-* names — don't assert the exact names)
- [ ] Stderr contains `Run 'tiddly mcp remove <tool> --delete-tokens' to revoke`

### [T6.10] Remove idempotent
```bash
bin/tiddly mcp remove claude-code  # already removed in T6.9
```
**Verify:**
- [ ] Exit 0
- [ ] `Removed Tiddly MCP servers from claude-code.`
- [ ] No crash

```bash
assert_auth_still_working
```

---

## Phase 7: Skills

`phase "Phase 7: Skills"`. No structural changes in this round, but included for completeness.

### [T7.1] Claude Code, user scope (default)
```bash
bin/tiddly skills configure claude-code
```
**Verify:**
- [ ] Exit 0
- [ ] Output contains either `claude-code: Configured N skill(s) to ~/.claude/skills` OR `claude-code: No skills to configure.`

### [T7.2] Claude Code, directory scope
```bash
cd "$TEST_PROJECT" && bin/tiddly skills configure claude-code --scope directory
```
**Verify:**
- [ ] Exit 0
- [ ] If skills exist: output contains `claude-code: Configured N skill(s) to <path>/.claude/skills` under `$TEST_PROJECT`

### [T7.3] Codex, user scope
```bash
bin/tiddly skills configure codex
```
**Verify:**
- [ ] Exit 0
- [ ] Output references `~/.agents/skills`

### [T7.4] Codex, directory scope
```bash
cd "$TEST_PROJECT" && bin/tiddly skills configure codex --scope directory
```
**Verify:**
- [ ] Skills extracted to `$TEST_PROJECT/.agents/skills/`

### [T7.5] Claude Desktop, user scope (exports zip)
```bash
bin/tiddly skills configure claude-desktop
```
**Verify:**
- [ ] Exit 0
- [ ] If skills exist: output `claude-desktop: N skill(s) exported to /tmp/tiddly-skills-*.zip`
- [ ] Output contains `Upload this file to Claude Desktop via Settings > Skills.`

### [T7.6] `--tags` filter (default all)
```bash
bin/tiddly skills configure claude-code --tags python,skill
```
**Verify:**
- [ ] Exit 0
- [ ] Only prompts tagged with BOTH `python` AND `skill` installed

### [T7.7] `--tag-match any`
```bash
bin/tiddly skills configure claude-code --tags python,skill --tag-match any
```
**Verify:**
- [ ] Prompts with either tag installed

### [T7.8] Auto-detect
```bash
bin/tiddly skills configure
```
**Verify:**
- [ ] Exit 0
- [ ] One line per detected tool

### [T7.9] Invalid scope
```bash
bin/tiddly skills configure --scope invalid
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error: `invalid scope "invalid". Valid scopes: user, directory`

### [T7.10] Skills list
```bash
bin/tiddly skills list
```
**Verify:**
- [ ] Exit 0
- [ ] `Available skills (N prompts):` or `No prompts found.`

### [T7.11] Skills list with tag filter
```bash
bin/tiddly skills list --tags python
```
**Verify:**
- [ ] Exit 0
- [ ] Only prompts with `python` tag listed

```bash
assert_auth_still_working
```

---

## Phase 8: Error handling

`phase "Phase 8: Error handling"`. Pure validation-failure cases; no side effects.

### [T8.1] Invalid tool — configure
```bash
bin/tiddly mcp configure invalid-tool
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error: `unknown tool "invalid-tool". Valid tools: claude-desktop, claude-code, codex`

### [T8.2] Invalid tool — remove
```bash
bin/tiddly mcp remove invalid-tool
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error: `unknown tool "invalid-tool". Valid tools: claude-desktop, claude-code, codex`

### [T8.3] Invalid scope
```bash
bin/tiddly mcp configure claude-code --scope bad-scope
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error: `invalid scope "bad-scope". Valid scopes: user, directory`

### [T8.4] Old scope `local` rejected
```bash
bin/tiddly mcp configure claude-code --scope local
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error: `invalid scope "local". Valid scopes: user, directory`

### [T8.5] Old scope `project` rejected
```bash
bin/tiddly mcp configure claude-code --scope project
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error: `invalid scope "project". Valid scopes: user, directory`

### [T8.6] Invalid `--servers`
```bash
bin/tiddly mcp configure claude-code --servers invalid
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error: `invalid server "invalid" in --servers flag. Valid values: content, prompts`

### [T8.7] Empty `--servers`
```bash
bin/tiddly mcp configure claude-code --servers ""
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error: `--servers flag requires at least one value: content, prompts`

### [T8.8] Tool not installed (skip if all tools detected)
```bash
bin/tiddly mcp configure claude-desktop   # only if claude-desktop is NOT detected
```
**Verify (only applies when tool missing):**
- [ ] Exit non-zero
- [ ] Error: `claude-desktop is not installed on this system`

### [T8.9] Claude Desktop + skills `--scope directory`
```bash
bin/tiddly skills configure claude-desktop --scope directory
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error contains `--scope directory is not supported by: claude-desktop`

### [T8.10] Login — invalid PAT format
```bash
bin/tiddly login --token "invalid_no_prefix"
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error: `invalid token format: must start with 'bm_'`

### [T8.11] Login — bad token
```bash
bin/tiddly login --token "bm_definitely_not_valid_token"
```
**Verify:**
- [ ] Exit non-zero
- [ ] Error: `token verification failed`

---

## Phase 9: Auth / logout

`phase "Phase 9: Auth / logout"`. Runs at the end so earlier phases have auth available. Cleanup runs before logout.

### [T9.0] Cleanup tokens BEFORE logout
```bash
cleanup_cli_mcp_tokens
```

### [T9.1] `mcp status` works without auth
```bash
bin/tiddly logout
bin/tiddly mcp status   # should succeed — status is read-only, doesn't need auth
```
**Verify:**
- [ ] `logout`: exit 0, `Logged out successfully.`
- [ ] `mcp status`: exit 0, MCP tree still rendered (reads local config files only)

### [T9.2] Destructive commands fail when logged out
```bash
bin/tiddly mcp configure claude-code
bin/tiddly skills list
bin/tiddly skills configure claude-code
```
**Verify:**
- [ ] Each exits non-zero with `not logged in. Run 'tiddly login' first`

### [T9.3] Re-login
Engineer runs this manually in the same terminal (agent cannot complete device flow):
```bash
bin/tiddly login
```
Agent then:
```bash
bin/tiddly auth status
```
**Verify:**
- [ ] `Auth method: oauth` + user email

---

## Phase 10: Final cleanup

`phase "Phase 10: Final cleanup"`. The EXIT trap will run this anyway; doing it explicitly here lets us observe success.

```bash
# Finalize the live report with run summary counters.
report_summary

# Restore configs (idempotent with trap).
restore_file "$BACKUP_DIR/claude_desktop_config.json" "$CLAUDE_DESKTOP_CONFIG"
restore_file "$BACKUP_DIR/.claude.json"               "$CLAUDE_CODE_CONFIG"
restore_file "$BACKUP_DIR/config.toml"                "$CODEX_CONFIG"
restore_dir  "$BACKUP_DIR/claude-skills"              "$CLAUDE_SKILLS_DIR"
restore_dir  "$BACKUP_DIR/codex-skills"               "$CODEX_SKILLS_DIR"

# One more pass through cli-mcp-* tokens in case any reappeared.
cleanup_cli_mcp_tokens

# Unset local-service env vars.
unset TIDDLY_API_URL TIDDLY_CONTENT_MCP_URL TIDDLY_PROMPT_MCP_URL
unset TIDDLY_AUTH0_DOMAIN TIDDLY_AUTH0_CLIENT_ID TIDDLY_AUTH0_AUDIENCE

# Clear trap (we've explicitly cleaned up).
trap - EXIT
rm -rf "$TEST_PROJECT"
# Intentionally keep $BACKUP_DIR for post-run inspection; remove manually when satisfied.
echo "Done. Backup dir (for inspection): $BACKUP_DIR"
```

---

## User Verification Checklist (manual — not automatable)

These require human judgment:

- [ ] Claude Desktop actually connects to MCP servers after install
- [ ] MCP tools return real data (search items, get bookmarks, etc.)
- [ ] Prompts are accessible/renderable through the prompt MCP server
- [ ] Skills appear and are invocable in Claude Code / Codex
- [ ] OAuth device flow works end-to-end (`tiddly login` without `--token`)
- [ ] Uploaded skills zip works in Claude Desktop (Settings > Skills)

---

## Reference: Config Formats

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "tiddly_notes_bookmarks": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://content-mcp.tiddly.me/mcp",
        "--header",
        "Authorization: Bearer bm_XXXXX"
      ]
    },
    "tiddly_prompts": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://prompts-mcp.tiddly.me/mcp",
        "--header",
        "Authorization: Bearer bm_XXXXX"
      ]
    }
  }
}
```

### Claude Code — user scope (`~/.claude.json`)
```json
{
  "mcpServers": {
    "tiddly_notes_bookmarks": {
      "type": "http",
      "url": "https://content-mcp.tiddly.me/mcp",
      "headers": {
        "Authorization": "Bearer bm_XXXXX"
      }
    },
    "tiddly_prompts": {
      "type": "http",
      "url": "https://prompts-mcp.tiddly.me/mcp",
      "headers": {
        "Authorization": "Bearer bm_XXXXX"
      }
    }
  }
}
```

### Claude Code — directory scope (`~/.claude.json` under project key)
```json
{
  "projects": {
    "/path/to/project": {
      "mcpServers": {
        "tiddly_notes_bookmarks": { "type": "http", "url": "...", "headers": { ... } },
        "tiddly_prompts":         { "type": "http", "url": "...", "headers": { ... } }
      }
    }
  }
}
```

### Codex — user scope (`~/.codex/config.toml`)
```toml
[mcp_servers.tiddly_notes_bookmarks]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.tiddly_notes_bookmarks.http_headers]
Authorization = "Bearer bm_XXXXX"

[mcp_servers.tiddly_prompts]
url = "https://prompts-mcp.tiddly.me/mcp"

[mcp_servers.tiddly_prompts.http_headers]
Authorization = "Bearer bm_XXXXX"
```

### Codex — directory scope (`.codex/config.toml` in project root)
Same TOML structure as user scope.

---

## Reference: Backup Filename Format

Every destructive configure/remove creates a timestamped sibling of the config file:

```
<config_path>.bak.<YYYYMMDDTHHMMSSZ>      # first backup this UTC second
<config_path>.bak.<YYYYMMDDTHHMMSSZ>.1    # collision: .1, .2, ... up to .1000
```

- Permissions match the source file (0600 for files holding PATs).
- Never overwritten — `os.O_EXCL` guarantees atomic claim; collisions get a numbered suffix.
- Stays on disk after the command exits; user removes manually when satisfied.

---

## Reference: Key Constants

| Constant | Value |
|----------|-------|
| Content server name | `tiddly_notes_bookmarks` |
| Prompts server name | `tiddly_prompts` |
| Content MCP URL (production) | `https://content-mcp.tiddly.me/mcp` |
| Content MCP URL (local) | `http://localhost:8001/mcp` |
| Prompts MCP URL (production) | `https://prompts-mcp.tiddly.me/mcp` |
| Prompts MCP URL (local) | `http://localhost:8002/mcp` |
| API URL (local) | `http://localhost:8000` |
| Token name pattern | `cli-mcp-<tool>-<server>-<6hex>` |
| Token prefix | `bm_` |
| Dry-run placeholder | `<new-token-would-be-created>` |
| Backup timestamp format | `YYYYMMDDTHHMMSSZ` (UTC, ISO 8601 basic) |
| Env override — content MCP URL | `TIDDLY_CONTENT_MCP_URL` |
| Env override — prompts MCP URL | `TIDDLY_PROMPT_MCP_URL` |
| Env override — API URL | `TIDDLY_API_URL` |

## Reference: Tool × Scope Support

| Tool | user | directory (Tiddly flag) | Native scope (if different) |
|------|:---:|:---:|:---:|
| claude-desktop | yes | no | user |
| claude-code | yes | yes | local |
| codex | yes | yes | project |

- The CLI accepts `--scope user` and `--scope directory`. Legacy values `local` and `project` are rejected at validation time.

## Reference: Skills Extraction Paths

| Tool | user scope | directory scope |
|------|-------------|---------------|
| claude-code | `~/.claude/skills/` | `.claude/skills/` (relative to cwd) |
| codex | `~/.agents/skills/` | `.agents/skills/` (relative to cwd, canonical per Codex docs) |
| claude-desktop | `/tmp/tiddly-skills-*.zip` | Not supported |
