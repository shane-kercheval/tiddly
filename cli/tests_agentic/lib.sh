#!/usr/bin/env bash
# shellcheck shell=bash
#
# Shared helpers for cli/tests_agentic/agent_instructions.md.
#
# This file contains ONLY pure function definitions and platform-detection
# conditionals. Sourcing it never mutates state (no mktemp, no writes to
# disk, no token operations). Safe to source once or many times per shell.
#
# Contract: all functions assume Phase 0 has already run (see
# phase0_setup.sh). That run writes the runtime-state env file that makes
# $BACKUP_DIR, $REPORT, $TEST_PROJECT, $CLAUDE_CODE_CONFIG, etc. available
# to every subsequent shell that sources /tmp/tiddly-test-state.env.
#
# Under the Claude Code Bash tool's spawn-a-new-shell-per-call model,
# every test-running Bash call should start with per_call.sh which does:
#   set -euo pipefail
#   source cli/tests_agentic/lib.sh
#   source /tmp/tiddly-test-state.env
#   trap on_exit EXIT
#
# Nothing in this file contains tokens, session values, or any other
# secret — safe to commit.

# ---------------------------------------------------------------------------
# Portable platform helpers
# ---------------------------------------------------------------------------

# SHA256 wrapper — macOS lacks sha256sum by default, has shasum instead.
if command -v sha256sum >/dev/null 2>&1; then
    SHA256() { sha256sum "$@"; }
else
    SHA256() { shasum -a 256 "$@"; }
fi

# sha_of: hash a single file (or "MISSING" if absent).
sha_of() {
    if [ -e "$1" ]; then
        SHA256 "$1" | awk '{print $1}'
    else
        echo "MISSING"
    fi
}

# file_mode: portable octal-mode read. stat(1) syntax differs between
# Linux/GNU and BSD/macOS.
if stat -c '%a' /dev/null >/dev/null 2>&1; then
    file_mode() { stat -c '%a' "$1"; }                # Linux / GNU coreutils
else
    file_mode() { stat -f '%OLp' "$1"; }              # BSD / macOS (octal, no filetype bits)
fi

# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------

# assert_unchanged: verify file's hash matches a prior snapshot.
#   assert_unchanged "T4.1" "$PATH" "$pre_sha"
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

# assert_no_plaintext_bearers: FATAL if a blob contains "Bearer bm_<anything
# that isn't REDACTED>". Call before `echo "$out"` on any configure / remove /
# dry-run output. This is defense-in-depth for the in-process redactor in
# cli/internal/mcp/configure.go#redactBearers.
assert_no_plaintext_bearers() {
    local blob="$1" test_id="$2"
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

# assert_auth_still_working: verify OAuth session is alive between phases.
#
# IMPORTANT: `tiddly auth status` exits 0 regardless of login state. Grep the
# output; don't trust the exit code. See cli/cmd/auth.go.
#
# Four failure gates:
#   1. `Auth method: oauth` must be present
#   2. No `Session expired` / `API error` / `Not logged in`
#   3. `User:` line not `unknown` (credentialed but rejected)
#   4. API URL still localhost (catches mid-run env drift)
#
# On failure, do NOT echo $out — it contains the user's email. The FATAL
# message + manual `bin/tiddly auth status` invocation is enough for diagnosis.
#
# Uses $TIDDLY_BIN (absolute path set by phase0_setup.sh) rather than the
# relative bin/tiddly because this helper is reachable from the EXIT trap,
# which can fire from any cwd (including $TEST_PROJECT).
assert_auth_still_working() {
    local out
    out=$("$TIDDLY_BIN" auth status 2>&1)
    if ! echo "$out" | grep -qE '^Auth method:[[:space:]]+oauth'; then
        echo "FATAL: auth method is no longer 'oauth' — cleanup cannot run. Aborting." >&2
        echo "       Run 'bin/tiddly auth status' manually to inspect." >&2
        exit 1
    fi
    if echo "$out" | grep -qE 'Session expired|API error|Not logged in'; then
        echo "FATAL: OAuth session lost mid-test (expired or rejected by server)." >&2
        echo "       Diff-based cleanup needs a live session; aborting before it"  >&2
        echo "       can silently orphan cli-mcp-* tokens." >&2
        echo "       Run 'bin/tiddly auth status' manually to inspect." >&2
        exit 1
    fi
    if echo "$out" | grep -qE '^User:[[:space:]]+unknown'; then
        echo "FATAL: 'auth status' reports User: unknown — credentials rejected."  >&2
        echo "       Run 'bin/tiddly auth status' manually to inspect." >&2
        exit 1
    fi
    if ! echo "$out" | grep -qE '^API URL:[[:space:]]+http://(localhost|127\.0\.0\.1):'; then
        echo "FATAL: API URL drifted off localhost mid-run." >&2
        echo "       Run 'bin/tiddly auth status' manually to inspect." >&2
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Backup / restore
# ---------------------------------------------------------------------------
#
# Configs hold PATs at 0600. Every cp uses -p (files) or -rp (dirs) to
# preserve mode/owner/timestamps — a restore that loosened mode would be
# a real leak.

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

# restore_file / restore_dir: return 0 on success, non-zero on failure.
# A prior version swallowed cp failures via `cp && echo || echo` — which
# always returned 0 because the fallback echo succeeded. final_teardown
# now relies on the strict-return semantics to abort if any restore fails
# (otherwise it would delete $BACKUP_DIR while configs were only partially
# restored). on_exit's crash-recovery path calls these with `|| true` to
# keep going on partial failures; final_teardown does NOT, and aborts on
# the first failure.
restore_file() {
    local src="$1" dest="$2"
    if [ -e "$src" ]; then
        if cp -p "$src" "$dest"; then
            echo "Restored: $dest"
            return 0
        fi
        echo "WARNING: failed to restore $dest" >&2
        return 1
    fi
    # Source wasn't backed up (didn't exist originally). Remove any file
    # we may have created so state returns to "didn't exist."
    if rm -f "$dest" 2>/dev/null; then
        echo "Removed (no original): $dest"
        return 0
    fi
    echo "WARNING: failed to remove $dest" >&2
    return 1
}

restore_dir() {
    local src="$1" dest="$2"
    if [ -d "$src" ]; then
        if rm -rf "$dest" && cp -rp "$src" "$dest"; then
            echo "Restored: $dest"
            return 0
        fi
        echo "WARNING: failed to restore $dest" >&2
        return 1
    fi
    if rm -rf "$dest" 2>/dev/null; then
        echo "Removed (no original): $dest"
        return 0
    fi
    echo "WARNING: failed to remove $dest" >&2
    return 1
}

# ---------------------------------------------------------------------------
# Phase / test reporting
# ---------------------------------------------------------------------------

# Print a phase banner to stdout.
phase() {
    echo
    echo "=========================================="
    echo "$1"
    echo "=========================================="
}

# Append a timestamped line to the live report file ($REPORT).
report_append() {
    printf '%s  %s\n' "$(date -u +%H:%M:%SZ)" "$1" >> "$REPORT"
}

# Phase banner — also prints to stdout via phase().
report_phase() {
    {
        echo
        printf '## %s\n\n' "$1"
    } >> "$REPORT"
    phase "$1"
}

# Single-line test outcome. Status: PASS | FAIL | SKIP | NOTE.
#   report_test PASS "T1.1 — Root help"
#   report_test FAIL "T4.1 — Status" "stderr missing expected banner"
#
# CONVENTION: when retrying a test after fixing state, pass the SAME test ID
# (2nd arg) as the failing call. Put retry context in the DETAIL (3rd arg).
#   report_test FAIL "T5.8" "revoked token IDs mismatch"
#   report_test PASS "T5.8" "re-run after work_prompts PAT fix"       ← correct
#   report_test PASS "T5.8 (re-run after work_prompts PAT fix)" ""    ← WRONG
# report_summary() counts per-ID final state; renaming the ID on retry means
# awk sees them as two separate tests and the FAIL isn't superseded.
report_test() {
    # NOTE: using `test_status` (not `status`) because zsh treats $status as
    # a readonly magic variable holding the last command's exit code.
    local test_status="$1" test="$2" detail="${3:-}"
    local icon
    case "$test_status" in
        PASS) REPORT_PASS=$((REPORT_PASS+1)); icon="✓" ;;
        FAIL) REPORT_FAIL=$((REPORT_FAIL+1)); icon="✗" ;;
        SKIP) REPORT_SKIP=$((REPORT_SKIP+1)); icon="-" ;;
        NOTE) REPORT_NOTE=$((REPORT_NOTE+1)); icon="•" ;;
        *)    icon="?" ;;
    esac
    if [ -n "$detail" ]; then
        report_append "$icon **$test_status** — $test — $detail"
    else
        report_append "$icon **$test_status** — $test"
    fi
}

# Defense-in-depth: redact "Bearer bm_<plaintext>" in any string before it
# lands in the report.
redact_for_report() {
    echo "$1" | sed -E 's/Bearer[[:space:]]+bm_[A-Za-z0-9_-]+/Bearer bm_REDACTED/g'
}

# Full mismatch report. Writes a structured block and exits non-zero
# (triggering the EXIT trap).
#   report_mismatch T4.1 "Not configured" "No Tiddly servers configured" plan-bug "..."
# Bearer values in any field are redacted before writing.
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

# End-of-run summary (call from Phase 9 before final cleanup).
#
# Counts unique test IDs by final state — a later PASS for the same ID
# overrides an earlier FAIL. The raw REPORT_PASS/FAIL/SKIP counters
# accumulate every call to report_test(); without per-ID deduping, a
# retry-heavy run reports "Result: FAILED" even when every test ultimately
# passes. Awk-post-processing the report file is portable across zsh/bash
# and handles the retry-then-supersede pattern correctly.
#
# NOTE lines are counted independently (they annotate a test, not its
# outcome) — without this, a PASS followed by a NOTE for the same test ID
# would demote the test to "NOTE" in the final tally.
report_summary() {
    local stats unique_pass unique_fail unique_skip unique_note unique_total superseded
    stats=$(awk '
        /\*\*(PASS|FAIL|SKIP)\*\*/ {
            n = split($0, parts, /\*\*/)
            if (n < 3) next
            st = parts[2]
            rest = parts[3]
            sub(/^ — /, "", rest)
            if (index(rest, " — ") > 0) {
                rest = substr(rest, 1, index(rest, " — ") - 1)
            }
            sub(/[[:space:]]+$/, "", rest)
            final[rest] = st
        }
        /\*\*NOTE\*\*/ { note_count++ }
        END {
            unique_ids = 0
            for (id in final) {
                unique_ids++
                count[final[id]]++
            }
            printf "%d %d %d %d %d\n",
                (count["PASS"]+0), (count["FAIL"]+0), (count["SKIP"]+0), (note_count+0), unique_ids
        }
    ' "$REPORT")
    read -r unique_pass unique_fail unique_skip unique_note unique_total <<EOF
$stats
EOF
    superseded=$((REPORT_FAIL - unique_fail))
    [ $superseded -lt 0 ] && superseded=0
    {
        echo
        echo "## Run Summary"
        echo
        printf -- '- **End (UTC):** %s\n' "$(date -u +'%Y-%m-%d %H:%M:%SZ')"
        printf -- '- **Unique tests:** %d\n' "$unique_total"
        printf -- '- **Passed (final):** %d\n' "$unique_pass"
        printf -- '- **Failed (final):** %d\n' "$unique_fail"
        printf -- '- **Skipped:** %d\n' "$unique_skip"
        printf -- '- **Notes:** %d\n' "$unique_note"
        if [ "$superseded" -gt 0 ]; then
            printf -- '- **Historical FAILs superseded by retry PASS:** %d (not counted in Result)\n' "$superseded"
        fi
        if [ "$unique_fail" -eq 0 ]; then
            echo
            echo '**Result:** clean run — no unresolved mismatches.'
        else
            echo
            echo '**Result:** **FAILED** — see mismatch blocks above.'
        fi
    } >> "$REPORT"
}

# ---------------------------------------------------------------------------
# Agent-env preflight (called by phase0_setup.sh BEFORE any hardcoded
# TIDDLY_* exports — the point is to detect an engineer who forgot to
# export env in the launching shell, so the CLI fell back to hardcoded
# production defaults)
# ---------------------------------------------------------------------------

preflight_agent_env() {
    local status_out api_line auth_out
    # Bail early if the CLI binary isn't built — otherwise every `bin/tiddly …`
    # below fails with "command not found", which is noisier than the FATAL.
    if [ ! -x bin/tiddly ]; then
        echo "FATAL: bin/tiddly not found or not executable (cwd: $PWD)." >&2
        echo "       Build it first: make cli-build" >&2
        exit 1
    fi
    status_out=$(bin/tiddly status 2>&1) || true
    # Match the "URL:" line under the "API:" section (first URL line in status).
    api_line=$(echo "$status_out" | awk '/^[[:space:]]*URL:/ {print $2; exit}')
    case "$api_line" in
        http://localhost:*|http://127.0.0.1:*) ;;
        *)
            echo "FATAL: CLI API URL is '${api_line:-<empty>}', not localhost."            >&2
            echo "       Your launching shell did not export the TIDDLY_* vars, so the"    >&2
            echo "       CLI fell back to hardcoded production defaults. Running the"      >&2
            echo "       procedure in this state would operate on your real production"    >&2
            echo "       configs and tokens."                                               >&2
            echo                                                                            >&2
            echo "       Fix: exit Claude Code, open a fresh terminal, and paste the"      >&2
            echo "       auth block from agent_instructions.md (§ Auth). Re-launch"   >&2
            echo "       Claude Code from that same terminal so Bash inherits the exports." >&2
            exit 1
            ;;
    esac
    auth_out=$(bin/tiddly auth status 2>&1)
    if echo "$auth_out" | grep -qE 'Session expired|API error|Not logged in'; then
        echo "FATAL: OAuth session is not alive." >&2
        echo "       Run 'bin/tiddly logout && bin/tiddly login' in the launching"   >&2
        echo "       shell, then re-launch Claude Code from that same terminal."     >&2
        exit 1
    fi
    if echo "$auth_out" | grep -qE '^User:[[:space:]]+unknown'; then
        echo "FATAL: 'auth status' reports User: unknown — stored credentials are"  >&2
        echo "       not accepted by the backend. Likely logged in against the"     >&2
        echo "       wrong Auth0 tenant (prod instead of dev). Run 'bin/tiddly"      >&2
        echo "       logout' in the launching shell, verify the TIDDLY_AUTH0_*"     >&2
        echo "       exports, then 'bin/tiddly login' and re-launch Claude Code."   >&2
        exit 1
    fi
    echo "Agent env preflight: OK (CLI points at $api_line, session alive)."
}

# ---------------------------------------------------------------------------
# Sanitize: strip the user's Tiddly entries from real configs
# ---------------------------------------------------------------------------
#
# Two-pass sanitize:
#   1. `mcp remove <tool>` — URL-classifier driven. Removes entries whose URL
#      matches the current $TIDDLY_*_URL (typically localhost).
#   2. Canonical-name hard strip: jq/awk delete of tiddly_notes_bookmarks and
#      tiddly_prompts keys regardless of URL. Catches the common case where
#      the engineer has canonical-named entries pointing at production URLs
#      (which pass 1 skips because their URL doesn't match localhost).
#
# Phase 9 restores the originals from backup.

sanitize_one() {
    # $TIDDLY_BIN (absolute) — sanitize runs from Phase 0 at repo root, but
    # using the absolute path keeps this helper robust if called from any
    # other context (and matches the pattern used by the other helpers).
    local tool="$1" out rc
    set +e
    out=$("$TIDDLY_BIN" mcp remove "$tool" 2>&1); rc=$?
    set -e
    if [ $rc -ne 0 ]; then
        echo "WARNING: Phase 0 sanitize of $tool exited $rc: $out" >&2
    fi
}

# Hard-strip canonical Tiddly keys from a JSON config regardless of URL.
# Safe because `tiddly_notes_bookmarks` / `tiddly_prompts` are reserved
# canonical names; any entry bearing them is a Tiddly entry by definition.
sanitize_canonical_json() {
    local cfg="$1" tmp
    [ -f "$cfg" ] || return 0
    tmp=$(mktemp)
    # Delete both user-scope (.mcpServers.tiddly_*) and directory-scope
    # (.projects[*].mcpServers.tiddly_*) canonical entries.
    jq '
        (.mcpServers //= {}) | del(.mcpServers.tiddly_notes_bookmarks, .mcpServers.tiddly_prompts)
        | if (.projects|type) == "object"
                then .projects |= with_entries(.value.mcpServers |= (. // {} | del(.tiddly_notes_bookmarks, .tiddly_prompts)))
                else .
            end
    ' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
    chmod 0600 "$cfg"
}

# Hard-strip canonical Tiddly tables from a Codex TOML config regardless of URL.
sanitize_canonical_toml() {
    # Two `local` statements — `local cfg="$1" tmp="$cfg.tmp"` fails under
    # zsh (zsh evaluates $cfg before the first assignment binds).
    local cfg="$1"
    local tmp="$cfg.tmp"
    [ -f "$cfg" ] || return 0
    awk '
        /^\[mcp_servers\.(tiddly_notes_bookmarks|tiddly_prompts)(\.|\])/ { skip=1; next }
        /^\[/                                                             { skip=0 }
        !skip                                                             { print }
    ' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
    chmod 0600 "$cfg"
}

# ---------------------------------------------------------------------------
# Token cleanup helpers
# ---------------------------------------------------------------------------

# Delete ONLY cli-mcp-* tokens minted during THIS run. Diffs the current
# cli-mcp-* IDs against the Phase 0 snapshot; deletes only additions.
# Pre-existing tokens stay untouched.
#
# Uses $TIDDLY_BIN because this runs from the EXIT trap / final_teardown,
# either of which can fire from any cwd.
cleanup_cli_mcp_tokens() {
    echo "Cleaning up cli-mcp-* tokens created during THIS run…"
    local preexisting="$BACKUP_DIR/cli-mcp-ids-before.txt"

    # Gate 1: snapshot must be authoritative (Phase 0 completed and wrote it).
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

    # Gate 2: auth must be alive. Unauthed `tokens list` returns empty →
    # diff-cleanup would silently orphan every token minted during this run.
    local auth_line auth_mode
    auth_line=$("$TIDDLY_BIN" auth status 2>&1 | awk -F': ' '/^Auth method/ {print $2; exit}')
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
    # LC_ALL=C: byte-order sort for stable `comm -13` input.
    current=$("$TIDDLY_BIN" tokens list 2>/dev/null | awk '/cli-mcp-/ {print $1}' | LC_ALL=C sort)
    # Delete only IDs not in the pre-run snapshot.
    new_ids=$(comm -13 "$preexisting" <(echo "$current"))
    if [ -z "$new_ids" ]; then
        echo "  (no new cli-mcp-* tokens to delete)"
        return 0
    fi
    while read -r id; do
        [ -n "$id" ] || continue
        "$TIDDLY_BIN" tokens delete "$id" --force 2>/dev/null && echo "  deleted: $id"
    done <<< "$new_ids"
}

# Sweep CLI-emitted sibling backups (<config>.bak.<timestamp>) post-restore.
# The first-round residue holds the user's real-token configs from Phase 0's
# sanitize — removing it is the highest-value cleanup step here.
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

# Interim token cleanup between phases. Phase 2-6 accumulate 25+
# cli-mcp-test-* tokens (each Tx.y block mints several). Accounts with the
# default tier token cap (50) hit the wall when later `mcp configure` calls
# try to mint yet another token. Cleanup deletes only `cli-mcp-test-*` —
# a naming convention reserved for test-harness-minted PATs. Does NOT touch
# `cli-mcp-<tool>-<server>-*` names, which are produced by `mcp configure`
# itself and may still be referenced by live configs.
cleanup_test_tokens() {
    # Uses $TIDDLY_BIN — callable between phases, cwd may not be repo root.
    echo "Interim cleanup: deleting cli-mcp-test-* tokens accumulated so far…"
    local ids count=0
    ids=$("$TIDDLY_BIN" tokens list 2>/dev/null | awk '/cli-mcp-test-/ {print $1}')
    [ -n "$ids" ] || { echo "  (no cli-mcp-test-* tokens to delete)"; return 0; }
    while read -r id; do
        [ -n "$id" ] || continue
        "$TIDDLY_BIN" tokens delete "$id" --force >/dev/null 2>&1 && count=$((count + 1))
    done <<< "$ids"
    echo "  Deleted $count cli-mcp-test-* tokens."
}

# ---------------------------------------------------------------------------
# EXIT trap handler (CRASH RECOVERY ONLY)
# ---------------------------------------------------------------------------
#
# IMPORTANT: under the Claude Code Bash-per-call model, EVERY Bash call's
# shell exits at the end of its test snippet. That means the EXIT trap
# fires after every call — not just at session end. If this handler did
# the full "restore + delete BACKUP_DIR" teardown, finishing Phase 0 would
# immediately tear down the harness and leave later calls with no
# $BACKUP_DIR / $TEST_PROJECT.
#
# To handle this correctly, we split two concerns:
#
#   1. on_exit  — FAILURE-ONLY. Runs on abnormal exit (rc != 0). Does
#                 crash-recovery: restore configs, cleanup tokens. Does
#                 NOT delete $BACKUP_DIR / $TEST_PROJECT / state.env —
#                 the engineer may need those for forensic inspection.
#   2. final_teardown — EXPLICIT. Phase 9 calls it at session end.
#                 Does the full destructive cleanup and sets the
#                 TEARDOWN_COMPLETE sentinel so any subsequent trap
#                 fire is a no-op.
#
# Trap registration happens in phase0_setup.sh and per_call.sh (every Bash
# call must re-install the trap because Bash-per-call shells don't carry
# traps across calls). This file only defines the handler function.

on_exit() {
    local rc="${1:-$?}"
    # Clean call exits are the normal case — every test's Bash call ends
    # with rc=0 and fires this trap. Return early so we don't wipe state
    # between calls.
    if [ "$rc" -eq 0 ]; then
        return 0
    fi
    # Idempotency guard: if final_teardown already ran, the explicit
    # cleanup happened via that path. Any subsequent non-zero exit (e.g.
    # from a post-teardown error) should not try to touch state.env or
    # $BACKUP_DIR again.
    if [ "${TEARDOWN_COMPLETE:-0}" = "1" ]; then
        return "$rc"
    fi

    # Crash recovery path. Restore originals; preserve $BACKUP_DIR and
    # the live report so the engineer can inspect what went wrong.
    echo
    phase "Crash cleanup (exit code: $rc)"
    # Token cleanup first; needs auth to work. Best-effort here — if it
    # fails, orphaned tokens will appear in the engineer's settings UI
    # but the trap's job is to restore local state, not guarantee
    # server-side consistency under crash conditions.
    cleanup_cli_mcp_tokens || true
    # Restore every config + skills dir. `|| true` on each so one
    # failing restore doesn't break out of the series (under set -e
    # the helper's non-zero return would otherwise skip later restores).
    # Best-effort is correct for crash recovery.
    restore_file "$BACKUP_DIR/claude_desktop_config.json" "$CLAUDE_DESKTOP_CONFIG" || true
    restore_file "$BACKUP_DIR/.claude.json"               "$CLAUDE_CODE_CONFIG"    || true
    restore_file "$BACKUP_DIR/config.toml"                "$CODEX_CONFIG"          || true
    [ -f "$BACKUP_DIR/project.mcp.json" ] && { restore_file "$BACKUP_DIR/project.mcp.json" "$PROJECT_MCP_CONFIG" || true; }
    restore_dir  "$BACKUP_DIR/claude-skills"              "$CLAUDE_SKILLS_DIR"     || true
    restore_dir  "$BACKUP_DIR/codex-skills"               "$CODEX_SKILLS_DIR"      || true
    cleanup_sibling_backups || true

    echo
    echo "WARNING: backup dir preserved at $BACKUP_DIR due to non-zero exit ($rc)."
    echo "It contains copies of your real config files including Bearer tokens."
    echo "The live report is at: $REPORT"
    echo "State file at /tmp/tiddly-test-state.env also preserved for inspection."
    echo "Once you have what you need, clean up manually:"
    echo "    rm -rf '$BACKUP_DIR' '$TEST_PROJECT' /tmp/tiddly-test-state.env"
    exit "$rc"
}

# ---------------------------------------------------------------------------
# final_teardown — EXPLICIT clean shutdown
# ---------------------------------------------------------------------------
#
# Called from Phase 9 as the last action of a successful test session.
# Does everything on_exit's old rc=0 branch used to do, but as an explicit
# invocation rather than a by-side-effect-of-exit.
#
# After this runs, TEARDOWN_COMPLETE=1 so any subsequent trap fire is a
# no-op. Safe to call from any cwd — every path is absolute.

# _final_teardown_abort: print a user-actionable abort message and return.
# Called by final_teardown when any cleanup/restore step fails. Preserves
# $BACKUP_DIR, state.env, and the live report so the engineer can recover
# manually. The abort message enumerates the recovery paths so the engineer
# doesn't have to spelunk.
#
# Callers must return 1 after invoking this — it does not exit so the
# caller controls the return semantics (which feed Phase 9's if-guard).
_final_teardown_abort() {
    local reason="$1"
    echo >&2
    echo "FATAL: final_teardown aborted — $reason" >&2
    echo "       The session's artifacts are PRESERVED for manual recovery:" >&2
    echo "         \$BACKUP_DIR:  $BACKUP_DIR" >&2
    echo "         live report:  $REPORT" >&2
    echo "         state file:   /tmp/tiddly-test-state.env" >&2
    echo >&2
    echo "       Your original configs are in \$BACKUP_DIR. Restore manually:" >&2
    [ -f "$BACKUP_DIR/.claude.json" ] &&                echo "         cp -p '$BACKUP_DIR/.claude.json' '$CLAUDE_CODE_CONFIG'" >&2
    [ -f "$BACKUP_DIR/claude_desktop_config.json" ] && echo "         cp -p '$BACKUP_DIR/claude_desktop_config.json' '$CLAUDE_DESKTOP_CONFIG'" >&2
    [ -f "$BACKUP_DIR/config.toml" ] &&                echo "         cp -p '$BACKUP_DIR/config.toml' '$CODEX_CONFIG'" >&2
    [ -f "$BACKUP_DIR/project.mcp.json" ] &&           echo "         cp -p '$BACKUP_DIR/project.mcp.json' '$PROJECT_MCP_CONFIG'" >&2
    echo >&2
    echo "       Once recovery is complete, clean up:" >&2
    echo "         rm -rf '$BACKUP_DIR' '$TEST_PROJECT' /tmp/tiddly-test-state.env" >&2
    echo >&2
    # Note: we do NOT set TEARDOWN_COMPLETE here — the trap that fires as
    # the shell exits should still treat this as an abnormal exit (rc≠0).
    # Phase 9's caller is expected to `exit 1` after seeing our non-zero
    # return, and the resulting on_exit crash-recovery path will attempt
    # a best-effort re-restore against the still-present $BACKUP_DIR.
}

# final_teardown: explicit session-end cleanup.
#
# Returns 0 only when every restore and the token cleanup succeeded AND
# destructive state cleanup completed. Returns non-zero (after printing
# actionable recovery instructions) on any failure, leaving $BACKUP_DIR /
# $TEST_PROJECT / state.env intact so the engineer can recover.
#
# Phase 9 calls this with `if ! final_teardown; then exit 1; fi`. On
# non-zero return, the subsequent trap fires with rc=1 and does
# best-effort crash recovery (see on_exit). BACKUP_DIR remains preserved
# either way.
final_teardown() {
    phase "Final teardown"

    # Step 1: revoke this-run's cli-mcp-* tokens. If auth is dead or the
    # API is unreachable, stop here — deleting $BACKUP_DIR would orphan
    # the tokens server-side with no recovery path.
    if ! cleanup_cli_mcp_tokens; then
        _final_teardown_abort "token cleanup failed — this-run cli-mcp-* tokens may still exist server-side"
        return 1
    fi

    # Step 2: restore every config and skills dir. Track failures across
    # the whole set rather than aborting on the first — if multiple
    # restores fail, the engineer sees all of them in one pass.
    local restore_errors=0
    restore_file "$BACKUP_DIR/claude_desktop_config.json" "$CLAUDE_DESKTOP_CONFIG" || restore_errors=$((restore_errors+1))
    restore_file "$BACKUP_DIR/.claude.json"               "$CLAUDE_CODE_CONFIG"    || restore_errors=$((restore_errors+1))
    restore_file "$BACKUP_DIR/config.toml"                "$CODEX_CONFIG"          || restore_errors=$((restore_errors+1))
    if [ -f "$BACKUP_DIR/project.mcp.json" ]; then
        restore_file "$BACKUP_DIR/project.mcp.json" "$PROJECT_MCP_CONFIG" || restore_errors=$((restore_errors+1))
    fi
    restore_dir "$BACKUP_DIR/claude-skills" "$CLAUDE_SKILLS_DIR" || restore_errors=$((restore_errors+1))
    restore_dir "$BACKUP_DIR/codex-skills"  "$CODEX_SKILLS_DIR"  || restore_errors=$((restore_errors+1))

    if [ "$restore_errors" -gt 0 ]; then
        _final_teardown_abort "$restore_errors restore step(s) failed — originals still in \$BACKUP_DIR"
        return 1
    fi

    # Sibling backups are best-effort: if the sweep fails (e.g. permission
    # error on a specific .bak.<ts>), log and continue. The sibling backups
    # aren't a correctness concern the way restoration is.
    cleanup_sibling_backups || echo "WARNING: cleanup_sibling_backups reported issues; continuing." >&2

    # Step 3: copy the live report to a retained location BEFORE deleting
    # $BACKUP_DIR. Report has no secrets; the mktemp path is useless to
    # the engineer post-run.
    local retained_dir retained_report
    retained_dir=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
    retained_report="$retained_dir/test-run-$(date -u +%Y%m%dT%H%M%SZ).md"
    if ! cp -p "$REPORT" "$retained_report" 2>/dev/null; then
        _final_teardown_abort "failed to copy live report to $retained_report"
        return 1
    fi

    # Step 4 — destructive cleanup. Every prior step succeeded, so the
    # user-facing state is consistent. Set the sentinel BEFORE deletion:
    # if any of the rm's below fails (rare but possible under odd
    # permission states), the trap that fires on our exit must NOT try
    # to re-restore from a partially-gone $BACKUP_DIR (restore_file's
    # missing-source branch would rm -f the user's freshly restored
    # configs).
    export TEARDOWN_COMPLETE=1

    rm -rf "$TEST_PROJECT" 2>/dev/null || true
    rm -rf "$BACKUP_DIR"
    rm -f /tmp/tiddly-test-state.env

    echo "Backup dir removed after successful restore (no secret residue on disk)."
    echo "Report retained: $retained_report"
}

# ---------------------------------------------------------------------------
# Shared fixture writers (used by Phases 2, 5, 6)
# ---------------------------------------------------------------------------
#
# Multi-entry configs representing real-world multi-account setups —
# work_prompts + personal_prompts both pointing at the Tiddly prompt server
# with distinct PATs. Each writes plaintext PATs to disk (chmod 0600);
# never `cat` the config after calling.

write_multi_entry_prompts() {
    # Merges two non-CLI-managed prompt rows into $CLAUDE_CODE_CONFIG via jq.
    # Preserves non-Tiddly entries and other top-level keys; strips any
    # CLI-managed tiddly_* entries so the caller always starts from the
    # "user had multi-account setup, no CLI-managed entries yet" scenario.
    local pat_work="$1" pat_personal="$2"
    local tmp
    tmp=$(mktemp)
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
    # Claude Desktop analogue: stdio+npx+mcp-remote entry shape. Same
    # preserve-others-and-strip-CLI-managed contract.
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

write_multi_entry_prompts_codex() {
    # Codex/TOML analogue. Strip any pre-existing work_prompts /
    # personal_prompts / CLI-managed tiddly_* tables, then append two
    # fresh tables. Awk-strip-then-append (not parse-and-re-emit)
    # preserves the original file byte-for-byte outside the replaced tables.
    local pat_work="$1" pat_personal="$2"
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
Authorization = "Bearer ${pat_work}"

[mcp_servers.personal_prompts]
url = "${TIDDLY_PROMPT_MCP_URL}"

[mcp_servers.personal_prompts.http_headers]
Authorization = "Bearer ${pat_personal}"
TOML
    chmod 0600 "$CODEX_CONFIG"
}
