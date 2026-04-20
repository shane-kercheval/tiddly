# CLI Agent Testing Procedure

End-to-end verification of the `tiddly` CLI. Structured for an AI agent to execute, but every step is readable by a human. Covers command surface, scope variants, multi-entry safety, consolidation gate (prompt / `--yes` / decline), timestamped backups, remove flows including `--delete-tokens`, skills, error handling, and auth.

## Runs against LOCAL test services ONLY

This procedure is scoped to a local development environment:

- `TIDDLY_API_URL=http://localhost:8000`
- `TIDDLY_CONTENT_MCP_URL=http://localhost:8001/mcp`
- `TIDDLY_PROMPT_MCP_URL=http://localhost:8002/mcp`
- Dev Auth0 tenant (see [Auth](#auth-engineer-must-do-this-manually))

It MUST NOT be run against production. The Phase 0 setup aborts if these env vars aren't set. Tokens minted during the run are test tokens against the local/dev account only; they never touch production state.

The Phase 0 setup also **wipes user Tiddly entries from the real config files** (after backup) so every subsequent test operates on test tokens only, never on the user's real tokens. The user's real tokens stay alive on the local dev server (untouched) and get restored when the config files are restored in Phase 10.

**Before running anything:** read [§ CRITICAL: Never Echo Token Values](#critical-never-echo-token-values), [§ Reporting Protocol](#reporting-protocol-read-this-second), and [§ Safety Model](#safety-model). Recommendation: run against a dedicated test account on your local dev server.

---

## CRITICAL: Never Echo Token Values

After Phase 0's sanitize step, the config files contain only test tokens minted during this run. The hygiene rule still applies, but the stakes are bounded: a leaked test token is a credential for the local dev account that gets revoked at Phase 10 anyway. The rule exists for defense-in-depth and to keep terminal history / transcripts / telemetry clean of credential material even when that material has limited blast radius.

**The rule:** do not echo, print, or capture Bearer token values via any command whose output lands in the transcript, except the explicit token-display path (`tokens create`, which must show the plaintext once).

**Prohibited on config files (`$CLAUDE_DESKTOP_CONFIG`, `$CLAUDE_CODE_CONFIG`, `$CODEX_CONFIG`):**
- `cat`, `head`, `tail`, `less`, `more` — print full file contents including Bearer values
- `jq -r '.path.to.Authorization'` outside of a piped hash-compare — prints the plaintext value
- `grep -o 'Bearer .*'` — captures the value into output
- `set -x` — echoes every variable assignment including captured PATs

**Permitted patterns for presence and structural checks:**
- `jq -e 'path exists' PATH >/dev/null` — exit code is the assertion, no value printed
- `jq -e '.x | type == "string"' PATH >/dev/null` — type check without value
- `jq -e '.x | startswith("Bearer bm_")' PATH >/dev/null` — prefix check, no value leak
- Hash-compare via temp files: `diff <(printf ... | SHA256) <(jq -r ... PATH | SHA256)` — only the hashes surface

**Plaintext PATs captured from `tokens create`:**
- Treat as write-only shell variables. Use ONCE as heredoc/jq input; `unset` at the earliest point after last use.
- Never include in `report_test` detail strings or `report_mismatch` `actual` arguments.
- Never `echo`, `printf`, or pipe into any command whose output is captured for display.

**`bin/tiddly tokens list` output is safe to display** — it shows ID, name, and first-12 prefix only (never plaintext). Its stdout can be grep'd/printed freely.

**`mcp configure --dry-run` output is also safe** — `printDiff` redacts every `Bearer bm_<token>` to `Bearer bm_REDACTED` before emitting. Still don't use it as a token-display surface; it isn't one.

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
6. **Format/UX drift.** The plan describes output wording that's close but not identical to reality (e.g. plan says `PAT from X will be reused` but output says `PAT from entry 'X' will be reused`). **Convention:** text inside backticks in a `Verify:` bullet is a **verbatim substring** — require an exact `grep -F` match. Unquoted prose is interpretive — match the spirit, not the letter, and report the drift if phrasing shifts in a way that changes meaning.
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

**Evidence field MUST honor the hygiene rules above:** never include Bearer values, raw config contents, or any `bm_<plaintext>` token. Use hashes, sha256 comparison outcomes, token *names*, first-12 prefixes, or paraphrased excerpts. If the evidence you want to cite is itself a token-bearing blob, that's the finding — report the leak as a plan-bug rather than transcribing it.

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

The agent maintains a running markdown report at `$BACKUP_DIR/test-report.md` throughout the run. The engineer can `tail -f` it to follow progress in real time; on clean success, Phase 10 (and `on_exit` on failure) copies it to `<repo-root>/test-run-<UTC-ts>.md` for post-run inspection. The path is anchored via `git rev-parse --show-toplevel`, falling back to `$PWD` if that fails. The report starts blank and grows append-only.

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

1. Every destructive test is preceded by a timestamped backup handled by the CLI itself (`.bak.<UTC-ts>` sibling files next to the live configs) AND by this procedure's Phase 0 snapshot into `$BACKUP_DIR` (mode 0700). User-scope configs (`~/.claude.json`, Claude Desktop, Codex) plus project-scope `.mcp.json` in the CWD are all covered.
2. An `EXIT` trap always fires, attempting config restore + token cleanup + sibling-backup sweep, even on test abort. On clean success, `$BACKUP_DIR` is auto-deleted AND the CLI-emitted `.bak.<ts>` siblings are removed post-restore. On failure, `$BACKUP_DIR` is preserved with a warning so manual recovery is possible.
3. Tokens created during this run are identified by diffing the initial `cli-mcp-*` ID list against the post-run list. Cleanup deletes **only** the additions. Pre-existing `cli-mcp-*` tokens from prior runs or earlier configures are **not** touched. Two gates protect this: the Phase 0 `tokens list` must succeed (fail-closed FATAL otherwise), and cleanup requires `SNAPSHOT_EXPECTED=1` + a live OAuth session — if either is missing, cleanup refuses to delete rather than fail-open.
4. **Strongly recommended:** run against a dedicated test Tiddly account. `--delete-tokens` and the diff-based cleanup have been hardened, but account isolation is the best defense against agent mistakes.

If you cannot use a test account, the procedure is still safe to run, but review the `cli-mcp-*` tokens it creates against your token list before and after.

---

## Prerequisites

- [ ] CLI is built: `make cli-build` (verify `bin/tiddly` exists)
- [ ] Local API and MCP servers are running (tests run against local services, not production)
- [ ] **Backend `VITE_DEV_MODE` is `false`.** Dev mode short-circuits all Bearer validation (PATs and JWTs alike resolve to a shared dev user), which silently breaks any test that depends on server-side token validation — most visibly T4.10's validate-then-mint fallback and T4.4's mint-path branch. Phase 0 runs a probe that FATALs if dev mode is detected.
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
# Project-scope (`--scope project`) reads/writes .mcp.json in the CWD. If the
# engineer has one at the repo root, Phase 0 backs it up and sanitizes it just
# like the user-scope configs; otherwise all references to it are no-ops.
PROJECT_MCP_CONFIG="$PWD/.mcp.json"

echo "Platform: $OSTYPE"
echo "Claude Desktop config: $CLAUDE_DESKTOP_CONFIG"
echo "Claude Code config:    $CLAUDE_CODE_CONFIG"
echo "Codex config:          $CODEX_CONFIG"
echo "Project MCP config:    $PROJECT_MCP_CONFIG (backed up only if present)"

# -- Local services (not production) ----------------------------------------
# This procedure must only run against a local dev environment. If these
# env vars are missing or point at non-localhost URLs, abort before any
# destructive step runs.
export TIDDLY_API_URL=http://localhost:8000
export TIDDLY_CONTENT_MCP_URL=http://localhost:8001/mcp
export TIDDLY_PROMPT_MCP_URL=http://localhost:8002/mcp
# Dev Auth0 tenant (must match the local API's .env VITE_AUTH0_*)
export TIDDLY_AUTH0_DOMAIN=kercheval-dev.us.auth0.com
export TIDDLY_AUTH0_CLIENT_ID=upLOqYelIdJIv7yZ8AnULA6VGklzak18
export TIDDLY_AUTH0_AUDIENCE=bookmarks-api

# Fail closed if we somehow ended up pointing at anything non-local.
case "$TIDDLY_API_URL" in
  http://localhost:*|http://127.0.0.1:*) ;;
  *)
    echo "FATAL: TIDDLY_API_URL is not localhost ($TIDDLY_API_URL). This procedure is for local dev only." >&2
    exit 1
    ;;
esac

# -- Dev-mode probe ---------------------------------------------------------
# When the backend runs with VITE_DEV_MODE=true, the auth middleware accepts
# ANY Bearer value and resolves it to a shared dev user. That silently
# disables server-side PAT validation, which breaks several tests in this
# plan (notably T4.10's validate-then-mint fallback and T4.4's mint-path
# branch) without producing a visible failure. Abort before Phase 0 commits
# to any destructive work.
#
# Probe: hit /users/me with a deliberately-bogus Bearer. In dev mode the
# middleware short-circuits to the dev user → 200. In production-mode the
# bogus bm_ token fails validation → 401. Curl is used directly (not the
# CLI) so this runs before auth is required on the CLI side.
devmode_rc=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Authorization: Bearer bm_devmode_probe_deliberately_invalid' \
  "$TIDDLY_API_URL/users/me" || echo "000")
case "$devmode_rc" in
  401|403)
    echo "Dev-mode probe: OK (backend rejects bogus tokens as expected)."
    ;;
  200)
    echo "FATAL: backend appears to be in DEV_MODE (accepted a bogus Bearer)." >&2
    echo "       Dev mode bypasses PAT validation; T4.10's validate-then-mint"  >&2
    echo "       fallback and T4.4's mint path cannot fire under these"         >&2
    echo "       conditions. Set VITE_DEV_MODE=false in backend/.env and"       >&2
    echo "       restart the API, then re-run this procedure."                  >&2
    exit 1
    ;;
  *)
    echo "FATAL: dev-mode probe got unexpected HTTP $devmode_rc from $TIDDLY_API_URL/users/me." >&2
    echo "       API may be down or mis-configured. Cannot safely proceed."                     >&2
    exit 1
    ;;
esac
unset devmode_rc

# -- Tool preflight ---------------------------------------------------------
# The plan shells out to a handful of tools. Fail fast with a clear message
# rather than crashing partway through a phase. Python's tomllib (used by
# T4.9 / T6.8c verify steps) lives in the 3.11+ stdlib — older Python3 on
# macOS defaults will blow up late.
for tool in jq python3 openssl awk curl comm sort sed head grep; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "FATAL: required tool not found on PATH: $tool" >&2
    exit 1
  }
done
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
  echo "FATAL: python3 >= 3.11 required (need stdlib 'tomllib' for Codex verify steps)." >&2
  echo "       Current version: $(python3 --version 2>&1)" >&2
  exit 1
fi

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

# -- Helper: bail out if plaintext Bearer values appear in a blob -----------
# Call this BEFORE `echo "$out"` anywhere the blob could contain Bearer
# headers (dry-run output, configure/remove output that might regress to
# echo raw PATs). The product-side guard is `redactBearers` in
# cli/internal/mcp/configure.go; if it ever regresses, the next transcript
# line would leak the plaintext to the user's terminal history. This helper
# stops the run first.
#
# Only `bm_REDACTED` is acceptable after "Bearer "; any other bm_<value>
# triggers a FATAL that includes the test id but NOT the matched line.
assert_no_plaintext_bearers() {
  local blob="$1" test_id="$2"
  # Match "Bearer <whitespace> bm_<something>" where the <something> is not
  # exactly REDACTED. awk is more portable across sed/grep extensions than
  # pcre-style lookarounds.
  if echo "$blob" | awk '
      /Bearer[ \t]+bm_/ {
        # Capture every token after "Bearer " that starts with bm_
        while (match($0, /Bearer[ \t]+bm_[A-Za-z0-9_-]+/)) {
          tok = substr($0, RSTART, RLENGTH)
          gsub(/^Bearer[ \t]+/, "", tok)
          if (tok != "bm_REDACTED") { found = 1 }
          $0 = substr($0, RSTART + RLENGTH)
        }
      }
      END { exit (found ? 0 : 1) }
    '; then
    echo "FATAL [$test_id]: plaintext 'Bearer bm_*' value detected in output." >&2
    echo "       NOT showing the offending line (it contains a plaintext PAT)." >&2
    echo "       Product-side guard in cli/internal/mcp/configure.go#redactBearers has regressed," >&2
    echo "       or a new code path prints tokens without going through printDiff." >&2
    echo "       Stop here and report as a product-bug finding in the live report."   >&2
    exit 1
  fi
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

  # Gate 1: the snapshot file must exist AND be authoritative. Phase 0 sets
  # SNAPSHOT_EXPECTED=1 after successfully writing the file. If we're past
  # Phase 0 and either the flag or the file is missing, the diff set is
  # untrustworthy — refuse to delete anything rather than risk revoking
  # pre-existing tokens (fail-closed over fail-open).
  if [ -z "${SNAPSHOT_EXPECTED:-}" ]; then
    echo "  NOTE: SNAPSHOT_EXPECTED unset — Phase 0 did not complete; skipping token cleanup."
    return 0
  fi
  if [ ! -f "$preexisting" ]; then
    echo "  FATAL: SNAPSHOT_EXPECTED is set but pre-run snapshot file is missing: $preexisting" >&2
    echo "         Refusing to run diff-based cleanup — every current cli-mcp-* token would look 'new'" >&2
    echo "         and get revoked. Investigate why the snapshot was deleted, then clean up manually."  >&2
    return 1
  fi

  # Gate 2: auth must be alive. Phase 9 logs out before re-login; if the EXIT
  # trap fires between those, or Phase 10 runs without the re-login, the
  # unauthenticated `tokens list` below returns empty → diff-cleanup thinks
  # every pre-existing token was revoked elsewhere and finds no "new" tokens
  # to delete → every token minted during this run orphans silently.
  local auth_line auth_mode
  auth_line=$(bin/tiddly auth status 2>&1 | awk -F': ' '/^Auth method/ {print $2; exit}')
  auth_mode=$(echo "$auth_line" | tr -d '[:space:]')
  if [ "$auth_mode" != "oauth" ]; then
    echo "  FATAL: auth not alive (auth method = '${auth_mode:-<none>}')." >&2
    echo "         Diff-based cleanup needs OAuth to list tokens; without it every cli-mcp-* token" >&2
    echo "         created during this run would silently orphan server-side." >&2
    echo "         Re-run 'tiddly login' then manually diff the snapshot at:" >&2
    echo "           $preexisting" >&2
    echo "         against 'bin/tiddly tokens list' output to finish cleanup." >&2
    return 1
  fi

  local current new_ids
  # LC_ALL=C keeps byte-order sort stable across locales so `comm -13` below
  # never sees "unsorted" inputs (locale-aware sort can reorder UUIDs that
  # happen to share prefix bytes and silently break the exclusion set).
  current=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-/ {print $1}' | LC_ALL=C sort)
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

# Sweep CLI-emitted sibling backups (<config>.bak.<timestamp>) that every
# `mcp configure` / `mcp remove` creates next to the live file. Phase 10's
# restore puts the live configs back to their original state, but these
# siblings aren't touched by restore — they're pure residue at cleanup time.
# The first-round residue is the highest-value: it's Phase 0's sanitize
# remove, which backs up the user's REAL token-bearing configs to these
# siblings. Subsequent rounds hold test tokens (also worth removing, but
# lower severity). Called from both on_exit and Phase 10 post-restore.
cleanup_sibling_backups() {
  local cfg removed=0
  for cfg in "$CLAUDE_DESKTOP_CONFIG" "$CLAUDE_CODE_CONFIG" "$CODEX_CONFIG"; do
    # Guard against empty / unset vars before globbing — we don't want an
    # accidental `rm -f .bak.*` relative to $PWD.
    [ -n "$cfg" ] || continue
    for bak in "$cfg".bak.*; do
      [ -f "$bak" ] || continue
      rm -f "$bak" && removed=$((removed + 1))
    done
  done
  echo "Removed $removed CLI-emitted sibling backup(s) (<config>.bak.*)."
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
  printf '**API URL:** %s\n' "$TIDDLY_API_URL"
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

# Redact "Bearer bm_<plaintext>" to "Bearer bm_REDACTED" in any string before
# we paste it into the report. The hygiene rules already forbid quoting raw
# Bearer values, but defense-in-depth catches accidents: if a future test
# author passes `actual="$(cat "$CLAUDE_CODE_CONFIG")"` to report_mismatch,
# the redaction runs server-side here rather than trusting the call site.
redact_for_report() {
  echo "$1" | sed -E 's/Bearer[[:space:]]+bm_[A-Za-z0-9_-]+/Bearer bm_REDACTED/g'
}

# Full mismatch report — use for anything that matches the Reporting Protocol's
# "stop and report" category. Writes a structured block; also exits non-zero
# so the EXIT trap fires.
#   report_mismatch T5.1 "Not configured" "No Tiddly servers configured" plan-bug "Plan string predates CLI update"
# expected/actual/hypothesis strings are redacted through redact_for_report
# so accidentally-captured Bearer values never land in the retained report.
report_mismatch() {
  local test="$1" expected="$2" actual="$3" category="$4" hypothesis="${5:-}"
  REPORT_FAIL=$((REPORT_FAIL+1))
  local safe_expected safe_actual safe_hypothesis
  safe_expected=$(redact_for_report "$expected")
  safe_actual=$(redact_for_report "$actual")
  safe_hypothesis=$(redact_for_report "$hypothesis")
  {
    echo
    printf '### ⚠ MISMATCH at %s\n\n' "$test"
    printf -- '- **Plan expected:** %s\n' "$safe_expected"
    printf -- '- **Actual observed:** %s\n' "$safe_actual"
    printf -- '- **Category:** %s\n' "$category"
    [ -n "$safe_hypothesis" ] && printf -- '- **Hypothesis:** %s\n' "$safe_hypothesis"
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
# Only back up the project-scope config if it actually exists — we don't want
# to create a bogus empty backup for every repo that doesn't use this scope.
[ -f "$PROJECT_MCP_CONFIG" ] && backup_file "$PROJECT_MCP_CONFIG" "$BACKUP_DIR/project.mcp.json"
backup_dir  "$CLAUDE_SKILLS_DIR"     "$BACKUP_DIR/claude-skills"
backup_dir  "$CODEX_SKILLS_DIR"      "$BACKUP_DIR/codex-skills"

# Snapshot the IDs of pre-existing cli-mcp-* tokens so cleanup can diff them
# out. This list contains IDs only (no plaintext tokens, no secrets).
#
# `tokens list` MUST succeed here. If it fails silently (`|| true`) and the
# snapshot file is empty, cleanup later can't tell "no pre-existing tokens"
# from "list failed" — it would treat every current cli-mcp-* token as "new
# in this run" and revoke valid pre-existing tokens. Fail fast instead.
set +e
snapshot_out=$(bin/tiddly tokens list 2>&1); snapshot_rc=$?
set -e
if [ $snapshot_rc -ne 0 ]; then
  echo "FATAL: 'tokens list' failed during Phase 0 snapshot (rc=$snapshot_rc)." >&2
  echo "       Auth may not be set up, or the API is unreachable. Aborting." >&2
  echo "       stderr (token values redacted by CLI design, safe to show):"    >&2
  echo "$snapshot_out" | sed 's/bm_[A-Za-z0-9_]\{4,\}/bm_REDACTED/g'           >&2
  exit 1
fi
echo "$snapshot_out" | awk '/cli-mcp-/ {print $1}' | LC_ALL=C sort \
  > "$BACKUP_DIR/cli-mcp-ids-before.txt"
unset snapshot_out snapshot_rc
# Mark that the snapshot is authoritative. cleanup_cli_mcp_tokens checks this
# flag and refuses to run when it's unset (which would mean Phase 0 never
# completed — e.g. the EXIT trap fired mid-Phase-0). Without it, cleanup
# can't distinguish "Phase 0 never ran" from "Phase 0 ran and found zero
# pre-existing tokens" and would fail-open.
export SNAPSHOT_EXPECTED=1

# -- Sanitize: strip the user's Tiddly entries from real configs ------------
# With the originals safely backed up, wipe Tiddly-URL entries from the live
# configs so every subsequent test operates on test tokens only. Uses the
# CLI's own URL-based removal (no --delete-tokens, so server-side tokens
# stay alive). Non-Tiddly entries (github, filesystem, etc.) are preserved.
# Phase 10 restores the originals from backup — configs and server-side
# tokens line up again.
# Each call may legitimately exit non-zero when the tool has no Tiddly
# entries to remove (or no config file at all). But a real failure — malformed
# existing config, permissions, API unreachable — leaves the live config
# partially sanitized and every downstream test operates on mixed state.
# Log each result visibly. `|| true` would swallow real failures silently.
sanitize_one() {
  local tool="$1" out rc
  set +e
  out=$(bin/tiddly mcp remove "$tool" 2>&1); rc=$?
  set -e
  if [ $rc -ne 0 ]; then
    echo "WARNING: Phase 0 sanitize of $tool exited $rc: $out" >&2
  fi
}
sanitize_one claude-desktop
sanitize_one claude-code
sanitize_one codex
# Project-scope sanitize: strips Tiddly entries from $PWD/.mcp.json if present.
# claude-code's --scope project reads/writes this file.
if [ -f "$PROJECT_MCP_CONFIG" ]; then
  set +e
  project_sanitize_out=$(bin/tiddly mcp remove claude-code --scope project 2>&1); project_sanitize_rc=$?
  set -e
  if [ $project_sanitize_rc -ne 0 ]; then
    echo "WARNING: Phase 0 sanitize of project-scope .mcp.json exited $project_sanitize_rc: $project_sanitize_out" >&2
  fi
  unset project_sanitize_out project_sanitize_rc
fi
echo "Sanitized: user Tiddly entries removed from configs; originals preserved in \$BACKUP_DIR."

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
  # Project-scope (.mcp.json in cwd) was backed up by Phase 0 only if the
  # file existed at that time; restore if we have a backup for it.
  [ -f "$BACKUP_DIR/project.mcp.json" ] && restore_file "$BACKUP_DIR/project.mcp.json" "$PROJECT_MCP_CONFIG"
  restore_dir  "$BACKUP_DIR/claude-skills"              "$CLAUDE_SKILLS_DIR"
  restore_dir  "$BACKUP_DIR/codex-skills"               "$CODEX_SKILLS_DIR"
  # Sweep CLI-emitted sibling .bak.<ts> files post-restore — Phase 0's
  # remove-and-sanitize left the user's REAL-token backup as a sibling of
  # the live config; every subsequent configure/remove added more (with
  # test tokens). Restore already put the live files back; these siblings
  # are residue.
  cleanup_sibling_backups
  rm -rf "$TEST_PROJECT" 2>/dev/null || true

  if [ "$rc" -eq 0 ]; then
    # Copy the live report out to a retained location BEFORE deleting the
    # backup dir, so the engineer has a record post-run. The retained copy
    # contains only pass/fail/hash-comparison content — no secrets.
    # Anchor the retained path to the repo root (or PWD as fallback) so the
    # engineer actually finds it — $REPORT lives inside a mktemp dir, whose
    # parent is /tmp, not somewhere useful.
    local retained_dir retained_report
    retained_dir=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
    retained_report="$retained_dir/test-run-$(date -u +%Y%m%dT%H%M%SZ).md"
    cp -p "$REPORT" "$retained_report" 2>/dev/null || retained_report=""
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

**Before starting:** confirm `VITE_DEV_MODE=false` in the backend's `.env` (or is unset). Dev mode makes the backend accept any Bearer value as the dev user and silently breaks token-validation tests (T4.10, T4.4 mint path). Phase 0 has a probe that FATALs on detection, but checking here first saves a wasted run.

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

### Bearer-leak guard — call `assert_no_plaintext_bearers` before every `echo "$out"`

The plan relies on the product-side `redactBearers` helper (in `cli/internal/mcp/configure.go`) to scrub Bearer headers from dry-run output. If that helper regresses, the next `echo "$out"` prints plaintext PATs into the user's terminal history. `assert_no_plaintext_bearers` is the defense: it stops the run before the echo. Mandatory usage pattern:

```bash
out=$(bin/tiddly mcp configure ... 2>&1)
assert_no_plaintext_bearers "$out" "T<id>"   # FATAL if Bearer bm_<plaintext> found
echo "$out"                                   # safe to show
```

Call it in both dry-run AND non-dry-run tests. Configure/remove outputs under OAuth should only print `cli-mcp-*` token *names* (never plaintext), but the guard is cheap insurance against future leaks. The most critical spots — multi-entry dry-run tests (T4.1, T4.7, T4.11) and the cross-tool gate (T4.8) — have the helper wired in explicitly; extend that pattern to any new test that captures configure/remove output.

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

### [T1.7] `tokens list` output contract — header + column order

`cleanup_cli_mcp_tokens` and Phase 0's snapshot both do `awk '/cli-mcp-/ {print $1}'` on `tokens list` output, which assumes the ID is column 1. A silent column reorder or header rename would silently break cleanup. Lock the contract.

```bash
hdr=$(bin/tiddly tokens list 2>/dev/null | head -1)
```
**Verify:**
- [ ] `$hdr` contains `ID` — column 1 token is "ID"
- [ ] `$hdr` contains `NAME` before `PREFIX` (strict substring order, not exact)
- [ ] `$hdr` contains `EXPIRES` — T2.8 relies on this column existing

```bash
assert_auth_still_working
```

---

## Phase 2: Configure happy paths

`phase "Phase 2: Configure"`. Begins mutating config files. All writes are preceded by CLI-taken `.bak.<ts>` backups; Phase 0 also snapshotted everything into `$BACKUP_DIR`.

### [T2.1] Claude Code — user scope (default)
```bash
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
# Capture pre-run keys so we can prove no non-Tiddly server was evicted.
# Non-existent file → empty set (jq on missing file would error); fall back to "".
pre_keys=$(jq -r '.mcpServers // {} | keys[]' "$CLAUDE_CODE_CONFIG" 2>/dev/null | LC_ALL=C sort)
out=$(bin/tiddly mcp configure claude-code 2>&1)
assert_no_plaintext_bearers "$out" "T2.1"
echo "$out"

# Capture the EXACT backup path from output (not a glob match on stale files).
backup_path=$(echo "$out" | sed -n 's/.*Backed up claude-code config to \(.*\)$/\1/p' | head -1)
# Post-run key set for the diff assertion below.
post_keys=$(jq -r '.mcpServers // {} | keys[]' "$CLAUDE_CODE_CONFIG" 2>/dev/null | LC_ALL=C sort)
# Keys that existed before but are gone after (should be empty).
evicted=$(comm -23 <(echo "$pre_keys") <(echo "$post_keys"))
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
- [ ] `[ -z "$evicted" ]` — no pre-existing key disappeared (filter out `tiddly_*` from `$evicted` if the pre-run state had customs we intentionally replaced; in the common case Phase 0 already sanitized, so `$pre_keys` is either empty or contains only non-Tiddly servers and `$evicted` must be strictly empty)

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
- [ ] Stderr contains `Warning: Restart Claude Desktop to apply changes.` — **note the `Warning: ` prefix** (configure pushes the restart hint through `ConfigureResult.Warnings`, which `cmd/mcp.go` prefixes). This is asymmetric with `mcp remove claude-desktop` (T6.4), which prints the same sentence bare without the prefix — plan-side is matching actual product behavior, not a contract violation. Record as `report_test NOTE` if you're tempted to file it.
- [ ] Non-Tiddly server keys preserved (diff `jq -r '.mcpServers | keys[]'` before/after)

### [T2.8] --expires flag mints with expiration
```bash
bin/tiddly mcp remove claude-code --delete-tokens 2>/dev/null
bin/tiddly mcp configure claude-code --expires 30

# Parse the EXPIRES column for any cli-mcp-claude-code-* token and compute
# days-from-now. The date-math tool differs by platform (GNU `date -d` vs
# BSD `date -v`), so handle both.
expires_raw=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-claude-code-/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}/) {print $i; exit}}')
if [ -n "$expires_raw" ]; then
  # Take just the YYYY-MM-DD portion (strip any T..Z suffix)
  expires_date=${expires_raw%%T*}
  # Compute day delta — try GNU first, fall back to BSD.
  if days_until=$(date -d "$expires_date" +%s 2>/dev/null); then
    now_s=$(date -u +%s)
  elif days_until=$(date -j -f '%Y-%m-%d' "$expires_date" +%s 2>/dev/null); then
    now_s=$(date -u +%s)
  else
    days_until=""
  fi
  if [ -n "$days_until" ]; then
    delta_days=$(( (days_until - now_s) / 86400 ))
  fi
fi
```
**Verify:**
- [ ] Output `Created tokens: cli-mcp-claude-code-*` (not `Reused`)
- [ ] `[ -n "$expires_raw" ]` — the EXPIRES column is non-empty for the new token(s)
- [ ] `[ -n "$delta_days" ] && [ "$delta_days" -ge 29 ] && [ "$delta_days" -le 30 ]` — expiration is ~30 days out (±1 day to absorb clock skew)

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

**Also deferred to unit tests (not E2E'd in this phase):** commit-phase write failure / partial-result contract; backup-path surfacing on write failure; orphan-token first-12 prefix formatting; cleanup-context detachment from cancelled caller contexts. See the Deferred table above for the specific tests that own each invariant. Phase 4 does not attempt to induce write failures.

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

write_multi_entry_prompts_desktop() {
  # Claude Desktop analogue of write_multi_entry_prompts. Claude Desktop
  # uses stdio+npx+mcp-remote rather than HTTP headers, so the entry shape
  # differs — but the merge-preserving-others-and-strip-canonical contract
  # is identical. Used by T4.8's cross-tool gate test.
  local pat_work="$1" pat_personal="$2"
  local tmp
  tmp=$(mktemp)
  local src="$CLAUDE_DESKTOP_CONFIG"
  [ -f "$src" ] || echo "{}" > "$src"
  jq --arg url "$TIDDLY_PROMPT_MCP_URL" \
     --arg work "$pat_work" --arg personal "$pat_personal" \
     '.mcpServers = (.mcpServers // {})
      | .mcpServers.work_prompts = {
          command: "npx",
          args: ["mcp-remote", $url, "--header", ("Authorization: Bearer "+$work)]
        }
      | .mcpServers.personal_prompts = {
          command: "npx",
          args: ["mcp-remote", $url, "--header", ("Authorization: Bearer "+$personal)]
        }
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
probe_out=$(bin/tiddly tokens create "$probe_name" 2>&1) || { echo "FATAL: 'tokens create' failed during format probe — aborting (command stderr suppressed to avoid leaking plaintext PATs if the format contract has shifted)"; exit 1; }
probe_pat=$(echo "$probe_out" | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
# Drop the full plaintext container immediately. probe_pat is enough to
# validate the format contract; keeping probe_out in shell state during the
# subsequent list/delete commands widens the window where a trap/signal
# could leave the plaintext exposed to a child process.
unset probe_out
[ -n "$probe_pat" ] || { echo "FATAL: 'tokens create' output format unexpected (no 'bm_' token found in stdout). Plan must be updated to match actual format. Raw output NOT printed to avoid leaking plaintext PATs."; exit 1; }
# Immediately revoke the probe so it doesn't linger as a test artifact.
probe_id=$(bin/tiddly tokens list 2>/dev/null | awk -v n="$probe_name" '$0 ~ n {print $1; exit}')
[ -n "$probe_id" ] && bin/tiddly tokens delete "$probe_id" --force 2>/dev/null
unset probe_pat probe_id

# Now mint the two test tokens we'll use throughout Phase 4.
PAT_WORK=$(bin/tiddly tokens create "cli-mcp-test-multi-work-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
PAT_PERSONAL=$(bin/tiddly tokens create "cli-mcp-test-multi-personal-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
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
assert_no_plaintext_bearers "$out" "T4.1"
echo "$out"
```
**Verify:**
- [ ] Output contains `Bearer bm_REDACTED` at least once — positive confirmation that the redaction fired (negative-only checks can false-pass if the whole Before/After block is missing)
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
- [ ] Output does NOT contain `Created tokens:` — the post-mint summary line must never render when the commit phase never ran

> T4.3 and T4.5 are intentionally reserved — the numbering is preserved across revisions of this plan so the gap is meaningful, not a mistake. If you need a new table of checks in this phase, append a new T4.x rather than reusing these slots.

### [T4.4] `--yes` bypasses prompt, consolidation happens
```bash
write_multi_entry_prompts "$PAT_WORK" "$PAT_PERSONAL"
out=$(bin/tiddly mcp configure claude-code --yes < /dev/null 2>&1)
assert_no_plaintext_bearers "$out" "T4.4"
echo "$out"
```
**Verify:**
- [ ] Exit 0
- [ ] Output contains `Consolidation required:` + warning
- [ ] Output contains `Proceeding (--yes).`
- [ ] Output does NOT contain `Continue? [y/N]:` (prompt skipped). The positive "prompt appears under a TTY" direction is covered by the unit test `TestRunConfigure__consolidation_prompt_proceeds_on_yes` — see the Deferred table — so this NOT-contains assertion and the unit test form the pair.
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
    report_test NOTE "T4.4 — outcome path" "reused survivor PAT (personal_prompts)"
  else
    # In the mint case, verify a fresh cli-mcp-* token was created:
    if bin/tiddly tokens list 2>/dev/null | grep -q 'cli-mcp-claude-code-prompts-'; then
      report_test NOTE "T4.4 — outcome path" "minted fresh token (validate-then-mint fallback)"
    else
      report_mismatch "T4.4" "fresh cli-mcp-claude-code-prompts- token created after mint path" "no cli-mcp-claude-code-prompts- token found in tokens list" product-bug "Survivor hash mismatch implies mint path fired, but no matching token exists server-side"
    fi
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
assert_no_plaintext_bearers "$out" "T4.7"
```
**Verify:**
- [ ] Output does NOT contain `Consolidation required:` (only fires when warranted)
- [ ] Normal dry-run diff still shown

### [T4.8] Cross-tool gate — single header lists every affected tool

The interactive Y/N prompt requires a TTY on stdin, which piped shells can't supply — `term.IsTerminal` falls through to the non-interactive error path. Unit tests cover the prompt-reader itself (`TestRunConfigure__consolidation_prompt_proceeds_on_yes` / `__aborts_on_no`). This E2E locks in the cross-tool rendering under the non-interactive path: when BOTH claude-code and claude-desktop have multi-entry prompts, a single consolidation header names both tools, configure aborts without writes, and NO cli-mcp-* tokens are minted.

```bash
# Multi-entry on two tools simultaneously.
write_multi_entry_prompts         "$PAT_WORK" "$PAT_PERSONAL"
write_multi_entry_prompts_desktop "$PAT_WORK" "$PAT_PERSONAL"
pre_cc_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
pre_cd_sha=$(sha_of "$CLAUDE_DESKTOP_CONFIG")
before_ids=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-/ {print $1}' | LC_ALL=C sort)
# </dev/null ensures stdin is not a TTY — non-interactive path fires.
set +e
out=$(bin/tiddly mcp configure < /dev/null 2>&1); rc=$?
set -e
assert_no_plaintext_bearers "$out" "T4.8"
echo "$out"
echo "exit: $rc"
after_ids=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-/ {print $1}' | LC_ALL=C sort)
```
**Verify:**
- [ ] `rc != 0`
- [ ] Exactly ONE `Consolidation required:` header (single header across tools)
- [ ] Output lists BOTH `claude-code:` and `claude-desktop:` under that header
- [ ] Output contains `consolidation needs confirmation`
- [ ] Output contains `re-run with --yes to proceed, or --dry-run to preview`
- [ ] `assert_unchanged T4.8 "$CLAUDE_CODE_CONFIG"     "$pre_cc_sha"`
- [ ] `assert_unchanged T4.8 "$CLAUDE_DESKTOP_CONFIG"  "$pre_cd_sha"`
- [ ] `[ "$before_ids" = "$after_ids" ]` — gate ran BEFORE PAT resolution; no tokens minted

### [T4.8b] Cross-tool `--yes` happy path

T4.8 locks the non-interactive **failure** path (abort without `--yes`). T4.8b covers the success case: both tools have multi-entry prompts simultaneously, `--yes` flows through, both tools end up canonical-only. Catches a regression where `--yes` is honored for the first tool but silently drops through on subsequent tools.

```bash
PAT_WORK_48b=$(bin/tiddly tokens create "cli-mcp-test-t48b-work-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
PAT_PERSONAL_48b=$(bin/tiddly tokens create "cli-mcp-test-t48b-personal-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
[ -n "$PAT_WORK_48b" ] && [ -n "$PAT_PERSONAL_48b" ] || { echo "FATAL: T4.8b token mint failed"; exit 1; }

write_multi_entry_prompts         "$PAT_WORK_48b" "$PAT_PERSONAL_48b"
write_multi_entry_prompts_desktop "$PAT_WORK_48b" "$PAT_PERSONAL_48b"

out=$(bin/tiddly mcp configure --yes < /dev/null 2>&1)
assert_no_plaintext_bearers "$out" "T4.8b"
echo "$out"

unset PAT_WORK_48b PAT_PERSONAL_48b
```
**Verify:**
- [ ] Exit 0
- [ ] Exactly ONE `Consolidation required:` header
- [ ] Both `claude-code:` and `claude-desktop:` appear under that header
- [ ] Output contains `Proceeding (--yes).`
- [ ] claude-code: `jq -e '.mcpServers.tiddly_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null` — canonical written
- [ ] claude-code: customs gone: `jq -e '.mcpServers.work_prompts // empty | length == 0' "$CLAUDE_CODE_CONFIG" >/dev/null` AND `jq -e '.mcpServers.personal_prompts // empty | length == 0' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] claude-desktop: canonical written: `jq -e '.mcpServers.tiddly_prompts' "$CLAUDE_DESKTOP_CONFIG" >/dev/null`
- [ ] claude-desktop: customs gone (same jq pattern as claude-code)

### [T4.9] Codex multi-entry consolidation (TOML format)

The bug this branch fixes cuts symmetrically across all three detectors. Phase 4 through T4.8 only exercised the JSON-formatted detectors (claude-code, claude-desktop). This test covers the Codex handler's `AllTiddlyPATs` and consolidation warning under the TOML format.

```bash
# Mint two fresh test tokens for Codex multi-entry setup.
PAT_WORK_CODEX=$(bin/tiddly tokens create "cli-mcp-test-codex-work-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
PAT_PERSONAL_CODEX=$(bin/tiddly tokens create "cli-mcp-test-codex-personal-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
[ -n "$PAT_WORK_CODEX" ] && [ -n "$PAT_PERSONAL_CODEX" ] || { echo "FATAL: failed to mint codex test tokens"; exit 1; }

# Write a multi-entry Codex config by stripping any prior multi-entry tables
# and appending two fresh tables. Appending is safer than parse-and-re-emit —
# the prior Python approach lost non-string top-level keys (booleans, lists,
# numbers) on round-trip. This preserves the original file byte-for-byte
# except for the specific mcp_servers tables we replace.
[ -f "$CODEX_CONFIG" ] || echo '' > "$CODEX_CONFIG"
# Strip any pre-existing work_prompts / personal_prompts / canonical tiddly_*
# tables so we start from a clean state. The awk filter drops lines inside
# those tables until the next top-level [header].
awk '
  /^\[mcp_servers\.(work_prompts|personal_prompts|tiddly_notes_bookmarks|tiddly_prompts)(\.|\])/ { skip=1; next }
  /^\[/                                                                                           { skip=0 }
  !skip                                                                                           { print }
' "$CODEX_CONFIG" > "$CODEX_CONFIG.tmp" && mv "$CODEX_CONFIG.tmp" "$CODEX_CONFIG"
# Append the two multi-entry tables. Values are interpolated via the shell,
# so $PAT_WORK_CODEX / $PAT_PERSONAL_CODEX are the plaintext tokens — any
# subsequent dump of this file contains those tokens in cleartext.
cat >> "$CODEX_CONFIG" <<TOML

[mcp_servers.work_prompts]
url = "${TIDDLY_PROMPT_MCP_URL}"

[mcp_servers.work_prompts.http_headers]
Authorization = "Bearer ${PAT_WORK_CODEX}"

[mcp_servers.personal_prompts]
url = "${TIDDLY_PROMPT_MCP_URL}"

[mcp_servers.personal_prompts.http_headers]
Authorization = "Bearer ${PAT_PERSONAL_CODEX}"
TOML
chmod 0600 "$CODEX_CONFIG"

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

### [T4.9b] Codex non-interactive without `--yes` — symmetric abort (TOML parity for T4.2)

T4.2 locks the "error without `--yes`, no writes, no mints" contract for claude-code (JSON). T4.9b is its Codex analogue — the same contract must hold when the multi-entry config lives in TOML and the handler is Codex's.

```bash
PAT_WORK_CX2=$(bin/tiddly tokens create "cli-mcp-test-t49b-work-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
PAT_PERSONAL_CX2=$(bin/tiddly tokens create "cli-mcp-test-t49b-personal-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
[ -n "$PAT_WORK_CX2" ] && [ -n "$PAT_PERSONAL_CX2" ] || { echo "FATAL: T4.9b token mint failed"; exit 1; }

# Reinstate the multi-entry TOML (T4.9 consolidated it; need it again here).
[ -f "$CODEX_CONFIG" ] || echo '' > "$CODEX_CONFIG"
awk '
  /^\[mcp_servers\.(work_prompts|personal_prompts|tiddly_notes_bookmarks|tiddly_prompts)(\.|\])/ { skip=1; next }
  /^\[/                                                                                           { skip=0 }
  !skip                                                                                           { print }
' "$CODEX_CONFIG" > "$CODEX_CONFIG.tmp" && mv "$CODEX_CONFIG.tmp" "$CODEX_CONFIG"
cat >> "$CODEX_CONFIG" <<TOML

[mcp_servers.work_prompts]
url = "${TIDDLY_PROMPT_MCP_URL}"

[mcp_servers.work_prompts.http_headers]
Authorization = "Bearer ${PAT_WORK_CX2}"

[mcp_servers.personal_prompts]
url = "${TIDDLY_PROMPT_MCP_URL}"

[mcp_servers.personal_prompts.http_headers]
Authorization = "Bearer ${PAT_PERSONAL_CX2}"
TOML
chmod 0600 "$CODEX_CONFIG"

pre_sha=$(sha_of "$CODEX_CONFIG")
before_ids=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-/ {print $1}' | LC_ALL=C sort)

set +e
out=$(bin/tiddly mcp configure codex < /dev/null 2>&1); rc=$?
set -e
assert_no_plaintext_bearers "$out" "T4.9b"
echo "$out"
echo "exit: $rc"

after_ids=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-/ {print $1}' | LC_ALL=C sort)

unset PAT_WORK_CX2 PAT_PERSONAL_CX2
```
**Verify:**
- [ ] `rc != 0`
- [ ] Output contains `consolidation needs confirmation`
- [ ] Output contains `re-run with --yes to proceed, or --dry-run to preview`
- [ ] `assert_unchanged T4.9b "$CODEX_CONFIG" "$pre_sha"` — Codex handler also wrote nothing on abort
- [ ] `[ "$before_ids" = "$after_ids" ]` — no tokens minted (Codex gate runs BEFORE PAT resolution, same as claude-code)

### [T4.10] Validate-then-mint fallback fires when survivor PAT is invalid

T4.4 accepts either "reuse" or "mint" as valid outcomes. T4.10 deliberately forces the mint path by killing the would-be-survivor server-side, then proves the disclosure's "otherwise a fresh token will be minted" caveat actually fires.

```bash
# Rebuild multi-entry state (tokens from Phase 4 may have been consolidated).
PAT_WORK_T410=$(bin/tiddly tokens create "cli-mcp-test-t410-work-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
PAT_PERSONAL_T410=$(bin/tiddly tokens create "cli-mcp-test-t410-personal-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
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
PC1=$(bin/tiddly tokens create "cli-mcp-test-mixed-c1-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
PC2=$(bin/tiddly tokens create "cli-mcp-test-mixed-c2-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
PP1=$(bin/tiddly tokens create "cli-mcp-test-mixed-p1-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
PP2=$(bin/tiddly tokens create "cli-mcp-test-mixed-p2-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)

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

# Capture pre-state BEFORE the dry-run so assert_unchanged can compare later.
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")

out=$(bin/tiddly mcp configure claude-code --dry-run < /dev/null 2>&1)
assert_no_plaintext_bearers "$out" "T4.11"
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
- [ ] `assert_unchanged T4.11 "$CLAUDE_CODE_CONFIG" "$pre_sha"` — dry-run did nothing

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

Self-contained: mints its own fresh tokens so the test doesn't silently depend on Phase 4 having run first. If someone reorders phases, T5.4 still works.

```bash
PAT_WORK_54=$(bin/tiddly tokens create "cli-mcp-test-t54-work-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
PAT_PERSONAL_54=$(bin/tiddly tokens create "cli-mcp-test-t54-personal-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
[ -n "$PAT_WORK_54" ] && [ -n "$PAT_PERSONAL_54" ] || { echo "FATAL: T5.4 token mint failed"; exit 1; }

write_multi_entry_prompts "$PAT_WORK_54" "$PAT_PERSONAL_54"
out=$(bin/tiddly mcp status 2>&1)
```
**Verify:**
- [ ] Output contains TWO prompt rows under claude-code
- [ ] One is `- prompts  <url>  (work_prompts)`
- [ ] Other is `- prompts  <url>  (personal_prompts)`
- [ ] Neither appears under "Other servers"

```bash
# Restore canonical-only for subsequent phases and drop the plaintext.
bin/tiddly mcp configure claude-code --yes 2>/dev/null
unset PAT_WORK_54 PAT_PERSONAL_54
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
PAT_WORK_68=$(bin/tiddly tokens create "cli-mcp-test-6-8-work-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
PAT_PERSONAL_68=$(bin/tiddly tokens create "cli-mcp-test-6-8-personal-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
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

### [T6.8b] Shared-PAT partial remove — warning fires, retained binding loses access

Exercises the `cmd/mcp.go` branch where a single PAT backs BOTH content and prompts servers (common under PAT auth: one bm_* token, two canonical entries). Partial `--delete-tokens --servers prompts` revokes that PAT, which silently breaks the retained content binding — the warning exists specifically to surface this.

```bash
# Fresh shared-PAT install: one token backing both servers.
bin/tiddly mcp remove claude-code 2>/dev/null || true
PAT_SHARED=$(bin/tiddly tokens create "cli-mcp-test-shared-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
[ -n "$PAT_SHARED" ] || { echo "FATAL: token mint failed"; exit 1; }

# Configure under PAT auth with the shared token — both server headers carry it.
# Pass the token via the TIDDLY_TOKEN env var rather than --token, so the
# plaintext never lands in argv where `ps` can read it. The CLI reads this
# env var via internal/auth/token_manager.go (equivalent to --token for
# this call). `env -u` scrubs it immediately after so it doesn't leak into
# subsequent commands.
TIDDLY_TOKEN="$PAT_SHARED" bin/tiddly mcp configure claude-code >/dev/null

# Partial remove of the prompts server with --delete-tokens. Split capture
# so the stderr routing assertion is meaningful — merging with 2>&1 would
# hide a regression that accidentally printed the warning to stdout.
stderr_tmp=$(mktemp)
set +e
stdout=$(bin/tiddly mcp remove claude-code --servers prompts --delete-tokens 2>"$stderr_tmp"); rc=$?
set -e
stderr=$(cat "$stderr_tmp")
rm -f "$stderr_tmp"
assert_no_plaintext_bearers "$stdout" "T6.8b-stdout"
assert_no_plaintext_bearers "$stderr" "T6.8b-stderr"
echo "--- stdout ---"; echo "$stdout"
echo "--- stderr ---"; echo "$stderr"
echo "exit: $rc"

# Hash-compare only: we prove the content binding still references $PAT_SHARED
# without ever echoing it.
shared_hash=$(printf 'Bearer %s' "$PAT_SHARED" | SHA256 | awk '{print $1}')
content_hash=$(jq -r '.mcpServers.tiddly_notes_bookmarks.headers.Authorization // empty' "$CLAUDE_CODE_CONFIG" | SHA256 | awk '{print $1}')

unset PAT_SHARED
```
**Verify:**
- [ ] `rc == 0`
- [ ] `$stderr` contains `Warning: token is shared with content server (still configured); it will also lose access.` (channel-specific assertion — NOT `$stdout`)
- [ ] `$stdout` contains `Deleted tokens:` (the shared PAT was revoked as requested)
- [ ] Prompts gone: `jq -e '.mcpServers.tiddly_prompts // empty | length == 0' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] Content retained: `jq -e '.mcpServers.tiddly_notes_bookmarks' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] `[ "$shared_hash" = "$content_hash" ]` — the retained content entry still carries the now-revoked PAT, exactly the breakage the warning predicted

> NOTE: T6.8b intentionally leaves `$CLAUDE_CODE_CONFIG` with the content binding pointing at a revoked token. T6.8c operates on `$CODEX_CONFIG` and doesn't depend on claude-code state; T6.9 reconfigures claude-code from scratch before its assertions. Don't add tests between T6.8b and T6.9 that read the claude-code content binding without reconfiguring first.

### [T6.8c] Codex multi-entry `--delete-tokens` — symmetric regression guard

T6.8 covers the JSON handler (claude-code). Codex parses TOML; the orphan-leak bug lived in the TOML handler's single-PAT extract path too. This locks in parity.

```bash
# Fresh tokens for the Codex multi-entry setup.
PAT_WORK_68C=$(bin/tiddly tokens create "cli-mcp-test-6-8c-work-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
PAT_PERSONAL_68C=$(bin/tiddly tokens create "cli-mcp-test-6-8c-personal-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
[ -n "$PAT_WORK_68C" ] && [ -n "$PAT_PERSONAL_68C" ] || { echo "FATAL: token mint failed"; exit 1; }

# Write multi-entry Codex config using the same append-based pattern as T4.9.
[ -f "$CODEX_CONFIG" ] || echo '' > "$CODEX_CONFIG"
awk '
  /^\[mcp_servers\.(work_prompts|personal_prompts|tiddly_notes_bookmarks|tiddly_prompts)(\.|\])/ { skip=1; next }
  /^\[/                                                                                           { skip=0 }
  !skip                                                                                           { print }
' "$CODEX_CONFIG" > "$CODEX_CONFIG.tmp" && mv "$CODEX_CONFIG.tmp" "$CODEX_CONFIG"
cat >> "$CODEX_CONFIG" <<TOML

[mcp_servers.work_prompts]
url = "${TIDDLY_PROMPT_MCP_URL}"

[mcp_servers.work_prompts.http_headers]
Authorization = "Bearer ${PAT_WORK_68C}"

[mcp_servers.personal_prompts]
url = "${TIDDLY_PROMPT_MCP_URL}"

[mcp_servers.personal_prompts.http_headers]
Authorization = "Bearer ${PAT_PERSONAL_68C}"
TOML
chmod 0600 "$CODEX_CONFIG"

before=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-test-6-8c-/ {print $1}' | LC_ALL=C sort)
out=$(bin/tiddly mcp remove codex --servers prompts --delete-tokens 2>&1)
echo "$out"
after=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-test-6-8c-/ {print $1}' | LC_ALL=C sort)

unset PAT_WORK_68C PAT_PERSONAL_68C
```
**Verify:**
- [ ] Exit 0
- [ ] `out` contains `Deleted tokens:` — the pre-fix bug silently dropped one of the two under Codex too
- [ ] `[ -z "$after" ]` — BOTH multi-entry tokens gone server-side (not just the survivor)
- [ ] Codex config has no `work_prompts` / `personal_prompts` entries: `grep -E '^\[mcp_servers\.(work_prompts|personal_prompts)' "$CODEX_CONFIG"` exits non-zero

### [T6.8d] Codex shared-PAT partial remove — warning parity with T6.8b (JSON)

T6.8b locks the warning for JSON-handler tools. T6.8d is the Codex/TOML analogue: when one PAT backs both content and prompts entries (canonical names), partial `--delete-tokens --servers prompts` must warn that the retained content binding loses access, same as claude-code.

```bash
# Fresh shared-PAT install for Codex. Start from clean slate.
bin/tiddly mcp remove codex 2>/dev/null || true
PAT_SHARED_CX=$(bin/tiddly tokens create "cli-mcp-test-shared-codex-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_]+' | head -1)
[ -n "$PAT_SHARED_CX" ] || { echo "FATAL: T6.8d token mint failed"; exit 1; }

# Configure Codex under PAT auth with the shared token — both server headers carry it.
TIDDLY_TOKEN="$PAT_SHARED_CX" bin/tiddly mcp configure codex >/dev/null

# Partial remove of prompts with --delete-tokens. Split stdout/stderr so the
# routing assertion is meaningful.
stderr_tmp=$(mktemp)
set +e
stdout=$(bin/tiddly mcp remove codex --servers prompts --delete-tokens 2>"$stderr_tmp"); rc=$?
set -e
stderr=$(cat "$stderr_tmp")
rm -f "$stderr_tmp"
assert_no_plaintext_bearers "$stdout" "T6.8d-stdout"
assert_no_plaintext_bearers "$stderr" "T6.8d-stderr"
echo "--- stdout ---"; echo "$stdout"
echo "--- stderr ---"; echo "$stderr"
echo "exit: $rc"

unset PAT_SHARED_CX
```
**Verify:**
- [ ] `rc == 0`
- [ ] `$stderr` contains `Warning: token is shared with content server (still configured); it will also lose access.` (channel-specific; same wording as T6.8b because the warning is emitted before the handler dispatch)
- [ ] `$stdout` contains `Deleted tokens:`
- [ ] Codex prompts entry gone: `grep -q '^\[mcp_servers\.tiddly_prompts' "$CODEX_CONFIG"` exits non-zero
- [ ] Codex content entry retained: `grep -q '^\[mcp_servers\.tiddly_notes_bookmarks' "$CODEX_CONFIG"` exits 0

> NOTE: T6.8d leaves `$CODEX_CONFIG`'s content binding pointing at a revoked PAT — same deliberate broken state as T6.8b. T6.9 reconfigures claude-code but doesn't touch Codex; if you add a test here that depends on Codex content auth working, reconfigure first.

### [T6.9] Remove without `--delete-tokens` — orphan warning
```bash
bin/tiddly mcp configure claude-code
# Split capture so the stderr routing assertion is meaningful.
stderr_tmp=$(mktemp)
stdout=$(bin/tiddly mcp remove claude-code 2>"$stderr_tmp")
stderr=$(cat "$stderr_tmp")
rm -f "$stderr_tmp"
```
**Verify:**
- [ ] `$stderr` contains `Warning: PATs created for claude-code may still exist:` (followed by cli-mcp-* names — don't assert the exact names; channel-specific, must be stderr not stdout)
- [ ] `$stderr` contains `Run 'tiddly mcp remove claude-code --delete-tokens' to revoke` (actual tool name is interpolated, not a `<tool>` placeholder)

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

Asserts that `--tags a,b` (default match mode `all`) installs exactly the prompts the server-side filter would return. The verification compares the installed-skill directory listing against a client-side replay of the same filter, computed from `tiddly export --types prompt`. If the test environment has zero prompts matching both tags, the verification SKIPs rather than false-passing on an empty set.

```bash
# Wipe any prior skills install so residue from earlier tests doesn't
# contaminate the directory listing.
rm -rf "$CLAUDE_SKILLS_DIR" 2>/dev/null

bin/tiddly skills configure claude-code --tags python,skill >/dev/null 2>&1
rc=$?

# Compute the expected set via a client-side replay of the tag filter.
# `export --types prompt` streams each prompt's full metadata including tags.
export_json=$(mktemp)
bin/tiddly export --types prompt > "$export_json" 2>/dev/null
expected=$(jq -r '
  .prompts // []
  | map(select((.tags // []) as $t
               | ($t | index("python")) and ($t | index("skill"))))
  | map(.name)
  | .[]
' "$export_json" | LC_ALL=C sort)
rm -f "$export_json"

# The installed-skill names are the directory names under $CLAUDE_SKILLS_DIR
# (scan_test.go in internal/skills confirms directory names ARE the skill names).
installed=$(ls -1 "$CLAUDE_SKILLS_DIR" 2>/dev/null | LC_ALL=C sort)
```
**Verify:**
- [ ] `rc == 0`
- [ ] If `$expected` is empty → `report_test SKIP "T7.6" "no prompts in dev DB match both python+skill tags; cannot verify filter"`; otherwise both following checks apply:
- [ ] `[ "$expected" = "$installed" ]` — installed set equals the tag-AND filtered set (same names, same count)
- [ ] Every name in `$installed` is in `$expected` (no extra skill slipped in)

```bash
# Snapshot T7.6's installed set so T7.7 can prove "any" is a superset of "all".
t76_installed="$installed"
```

### [T7.7] `--tag-match any`

Mirrors T7.6 but for OR semantics: `--tag-match any` must install every prompt with AT LEAST ONE of the tags.

```bash
rm -rf "$CLAUDE_SKILLS_DIR" 2>/dev/null
bin/tiddly skills configure claude-code --tags python,skill --tag-match any >/dev/null 2>&1
rc=$?

export_json=$(mktemp)
bin/tiddly export --types prompt > "$export_json" 2>/dev/null
expected=$(jq -r '
  .prompts // []
  | map(select((.tags // []) as $t
               | ($t | index("python")) or ($t | index("skill"))))
  | map(.name)
  | .[]
' "$export_json" | LC_ALL=C sort)
rm -f "$export_json"

installed=$(ls -1 "$CLAUDE_SKILLS_DIR" 2>/dev/null | LC_ALL=C sort)
```
**Verify:**
- [ ] `rc == 0`
- [ ] If `$expected` is empty → `report_test SKIP "T7.7" "no prompts in dev DB match either tag; cannot verify filter"`
- [ ] `[ "$expected" = "$installed" ]` — installed set equals the tag-OR filtered set
- [ ] T7.7's `$installed` set is a **superset** of T7.6's set: `comm -23 <(echo "$t76_installed") <(echo "$installed")` is empty (capture T7.6's `$installed` into `$t76_installed` before this test runs; sanity check that "any" ⊇ "all")

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

```bash
# Phase 8 ends with two failed-login attempts. If either somehow mutated
# stored credentials, every subsequent test would run under the wrong
# identity. This assert catches that drift before Phase 9's logout makes
# the damage invisible.
assert_auth_still_working
```

---

## Phase 9: Auth / logout

`phase "Phase 9: Auth / logout"`. Runs at the end so earlier phases have auth available. Cleanup runs before logout.

### [T9.0] Cleanup tokens BEFORE logout
```bash
cleanup_cli_mcp_tokens
```

> INVARIANT: Between T9.0 here and Phase 10's explicit cleanup, **no new `cli-mcp-*` tokens must be minted.** The EXIT trap's cleanup will refuse to run unauthenticated (Gate 2), so anything minted after T9.1's `logout` but before T9.3's re-login would silently orphan. If you add a test between T9.0 and T9.3 that could mint a token, move it earlier or add a `cleanup_cli_mcp_tokens` call after it.

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
- [ ] Each exits non-zero with error `not logged in. Run 'tiddly login' to authenticate` (exact phrasing per `internal/auth/keyring.go`'s `ErrNotLoggedIn`)

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
[ -f "$BACKUP_DIR/project.mcp.json" ] && restore_file "$BACKUP_DIR/project.mcp.json" "$PROJECT_MCP_CONFIG"
restore_dir  "$BACKUP_DIR/claude-skills"              "$CLAUDE_SKILLS_DIR"
restore_dir  "$BACKUP_DIR/codex-skills"               "$CODEX_SKILLS_DIR"

# Sweep CLI-emitted sibling .bak.<ts> files post-restore. See on_exit for
# the full rationale.
cleanup_sibling_backups

# One more pass through cli-mcp-* tokens in case any reappeared.
cleanup_cli_mcp_tokens

# Unset local-service env vars.
unset TIDDLY_API_URL TIDDLY_CONTENT_MCP_URL TIDDLY_PROMPT_MCP_URL
unset TIDDLY_AUTH0_DOMAIN TIDDLY_AUTH0_CLIENT_ID TIDDLY_AUTH0_AUDIENCE
unset SNAPSHOT_EXPECTED

# Clear trap (we've explicitly cleaned up).
trap - EXIT
rm -rf "$TEST_PROJECT"

# Save the live report to a retained location OUTSIDE $BACKUP_DIR so the
# engineer has a post-run record, then delete the backup dir. This mirrors
# on_exit's clean-success branch so the policy is the same whether Phase 10
# runs or the trap fires: on success, NO secret residue on disk; the report
# (no secrets) survives. On failure, the trap preserves $BACKUP_DIR instead.
# Anchor the retained path to the repo root so the engineer actually finds
# it — $REPORT lives inside a mktemp dir, whose parent is /tmp.
retained_dir=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
retained_report="$retained_dir/test-run-$(date -u +%Y%m%dT%H%M%SZ).md"
cp -p "$REPORT" "$retained_report" 2>/dev/null || retained_report=""
rm -rf "$BACKUP_DIR"
echo "Backup dir removed after successful restore (no secret residue on disk)."
[ -n "$retained_report" ] && echo "Report retained: $retained_report"
echo "Done."
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
