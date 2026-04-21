#!/usr/bin/env bash
# shellcheck shell=bash
#
# One-time Phase 0 setup for cli/agent_instructions.md.
#
# Run exactly once per test session, as the first Bash call of Phase 0.
# Must be SOURCED, not executed, so env exports / trap registration /
# variable assignments take effect in the calling shell.
#
# Usage (from Phase 0 in the procedure doc):
#     set -euo pipefail
#     source cli/tests_agentic/lib.sh
#     source cli/tests_agentic/phase0_setup.sh
#
# What this file does:
#   1. Detect platform and set config/skills paths
#   2. Verify bin/tiddly exists (fail with actionable message if not)
#   3. Run preflight_agent_env() — assert CLI points at localhost and
#      OAuth session is alive (catches engineer-forgot-to-export failure)
#   4. Export TIDDLY_* env vars (defensive — the engineer's shell should
#      already have these, but we re-export to survive any shell state
#      drift). All values are public identifiers, not secrets.
#   5. Dev-mode probe — FATAL if backend is running with VITE_DEV_MODE
#   6. Tool preflight — fail fast if jq / python3 / openssl / etc. missing
#   7. mktemp BACKUP_DIR, REPORT, TEST_PROJECT
#   8. Back up every real config + skills dir
#   9. Snapshot pre-existing cli-mcp-* token IDs for diff-based cleanup
#   10. Two-pass sanitize: strip user's Tiddly entries from real configs
#   11. Write runtime state to /tmp/tiddly-test-state.env so subsequent
#       Bash calls can re-source it and see the same paths
#   12. Install the EXIT trap (on_exit handler defined in lib.sh)
#
# Nothing in this file contains PATs or session tokens — Auth0 values are
# public identifiers per the plan's § "Auth0 values — these are not secrets".
# Safe to commit.

# ---------------------------------------------------------------------------
# 1. Platform-specific config paths
# ---------------------------------------------------------------------------

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
# Project-scope .mcp.json in the CWD. The CLI has no supported write path
# to this file — tests don't operate on it. Backed up defensively so a
# user-authored .mcp.json survives the run.
PROJECT_MCP_CONFIG="$PWD/.mcp.json"

# ---------------------------------------------------------------------------
# 1b. Concurrent/stale-state guard
# ---------------------------------------------------------------------------
#
# /tmp/tiddly-test-state.env is a fixed path. A pre-existing state.env
# falls into one of two cases:
#   (a) Stale from a previous run that aborted without cleanup, where the
#       referenced $BACKUP_DIR has since been removed externally.
#   (b) Live — another test session is actively running against the same
#       user home directory.
#
# For (a) we can safely auto-recover: rm the stale state.env and proceed.
# For (b) two sessions mutating the same configs would corrupt each other
# regardless of state.env, so we refuse and let the engineer sort it out.
#
# Note: this check doesn't fully protect concurrent runs (two parallel
# Phase 0s could race each other writing state.env). Multi-session
# protection would need OS-level locking; catching the common aborted-
# run case here is the valuable 90%.

if [ -f /tmp/tiddly-test-state.env ]; then
    # Read existing BACKUP_DIR in a subshell so we don't clobber our own
    # environment if the file is malformed.
    existing_backup=$(
        set +euo pipefail
        # shellcheck disable=SC1091
        source /tmp/tiddly-test-state.env 2>/dev/null
        echo "${BACKUP_DIR:-}"
    )
    if [ -n "$existing_backup" ] && [ -d "$existing_backup" ]; then
        echo "FATAL: /tmp/tiddly-test-state.env references a live BACKUP_DIR:" >&2
        echo "         $existing_backup" >&2
        echo >&2
        echo "       This typically means another test session is actively running" >&2
        echo "       against this user's home directory, or a previous run is still" >&2
        echo "       in flight. Two concurrent sessions will corrupt each other's" >&2
        echo "       configs — refusing to start a second one." >&2
        echo >&2
        echo "       If you're certain no other session is running, clean up and retry:" >&2
        echo "           rm -rf '$existing_backup' /tmp/tiddly-test-state.env" >&2
        exit 1
    fi
    # Stale — BACKUP_DIR referenced in state.env is gone. Auto-recover.
    echo "Notice: removing stale /tmp/tiddly-test-state.env from aborted previous run." >&2
    rm -f /tmp/tiddly-test-state.env
    unset existing_backup
fi

# ---------------------------------------------------------------------------
# 2. TIDDLY_BIN resolution
# ---------------------------------------------------------------------------
#
# Captured BEFORE any `cd`. Several tests do `cd "$TEST_PROJECT"` and then
# invoke the CLI; the relative `bin/tiddly` would be unresolvable inside
# $TEST_PROJECT. Always prefer "$TIDDLY_BIN" over `bin/tiddly` in any
# test block that runs after a cd.

TIDDLY_BIN="$PWD/bin/tiddly"
[ -x "$TIDDLY_BIN" ] || { echo "FATAL: bin/tiddly not found or not executable at $TIDDLY_BIN — run 'make cli-build'" >&2; exit 1; }

echo "Platform: $OSTYPE"
echo "Claude Desktop config: $CLAUDE_DESKTOP_CONFIG"
echo "Claude Code config:    $CLAUDE_CODE_CONFIG"
echo "Codex config:          $CODEX_CONFIG"
echo "Project MCP config:    $PROJECT_MCP_CONFIG (backed up only if present)"

# ---------------------------------------------------------------------------
# 3. Agent env preflight
# ---------------------------------------------------------------------------
#
# MUST run BEFORE the hardcoded exports below — otherwise we mask the exact
# failure we're trying to detect (engineer forgot to export TIDDLY_* vars in
# the terminal that launched Claude Code, so the CLI fell back to hardcoded
# production defaults). Check CLI *behavior*, not env vars — the CLI's
# fallback is the actual failure mode and it's observable via `status`.

preflight_agent_env

# ---------------------------------------------------------------------------
# 4. Local-services env exports (defensive re-export)
# ---------------------------------------------------------------------------
#
# This procedure must only run against a local dev environment. Re-export
# every TIDDLY_* the CLI cares about, then fail closed if the API URL is
# non-local. Auth0 values below are public identifiers (see plan § "Auth0
# values — these are not secrets"). If a fork uses a different dev tenant,
# swap these values — they're not copied anywhere secret.

export TIDDLY_API_URL=http://localhost:8000
export TIDDLY_CONTENT_MCP_URL=http://localhost:8001/mcp
export TIDDLY_PROMPT_MCP_URL=http://localhost:8002/mcp
# Dev Auth0 tenant (must match the local API's .env VITE_AUTH0_*)
export TIDDLY_AUTH0_DOMAIN=kercheval-dev.us.auth0.com
export TIDDLY_AUTH0_CLIENT_ID=upLOqYelIdJIv7yZ8AnULA6VGklzak18
export TIDDLY_AUTH0_AUDIENCE=bookmarks-api

case "$TIDDLY_API_URL" in
    http://localhost:*|http://127.0.0.1:*) ;;
    *)
        echo "FATAL: TIDDLY_API_URL is not localhost ($TIDDLY_API_URL). This procedure is for local dev only." >&2
        exit 1
        ;;
esac

# ---------------------------------------------------------------------------
# 5. Dev-mode probe
# ---------------------------------------------------------------------------
#
# Bogus bm_ Bearer → 401 in prod mode, 200 in dev mode. Dev mode breaks
# server-side PAT validation (T2.12 canonical reuse, T6.8 / T6.8d canonical
# revoke + orphan-filter assertions) silently.

devmode_rc=$(curl -s -o /dev/null -w '%{http_code}' \
    -H 'Authorization: Bearer bm_devmode_probe_deliberately_invalid' \
    "$TIDDLY_API_URL/users/me" || echo "000")
case "$devmode_rc" in
    401|403)
        echo "Dev-mode probe: OK (backend rejects bogus tokens as expected)."
        ;;
    200)
        echo "FATAL: backend appears to be in DEV_MODE (accepted a bogus Bearer)." >&2
        echo "       Dev mode bypasses PAT validation; the canonical validate-then" >&2
        echo "       -reuse path and the CLI-minted/orphan-token assertions cannot" >&2
        echo "       fire under these conditions. Set VITE_DEV_MODE=false in"      >&2
        echo "       backend/.env and restart the API, then re-run this procedure." >&2
        exit 1
        ;;
    *)
        echo "FATAL: dev-mode probe got unexpected HTTP $devmode_rc from $TIDDLY_API_URL/users/me." >&2
        echo "       API may be down or mis-configured. Cannot safely proceed."                     >&2
        exit 1
        ;;
esac
unset devmode_rc

# ---------------------------------------------------------------------------
# 6. Tool preflight
# ---------------------------------------------------------------------------
#
# The procedure shells out to a handful of tools. Fail fast with a clear
# message rather than crashing partway through a phase. Python's tomllib
# (used by T6.8c / T6.8d verify steps) lives in the 3.11+ stdlib — older
# Python3 on macOS defaults will blow up late.

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

# ---------------------------------------------------------------------------
# 7. Backups dir + live report file
# ---------------------------------------------------------------------------

# BACKUP_DIR holds real token-bearing config copies for this run only.
# chmod 0700; deleted on clean success, preserved with warning on failure.
BACKUP_DIR=$(mktemp -d)
chmod 0700 "$BACKUP_DIR"
echo "Backup dir: $BACKUP_DIR (mode 0700, deleted on clean success)"

# Append-only live markdown report. Same no-token hygiene as the transcript.
REPORT="$BACKUP_DIR/test-report.md"
: > "$REPORT"
chmod 0600 "$REPORT"
REPORT_PASS=0; REPORT_FAIL=0; REPORT_SKIP=0; REPORT_NOTE=0
export REPORT_PASS REPORT_FAIL REPORT_SKIP REPORT_NOTE

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

# ---------------------------------------------------------------------------
# 8. Back up every real config + skills dir
# ---------------------------------------------------------------------------

backup_file "$CLAUDE_DESKTOP_CONFIG" "$BACKUP_DIR/claude_desktop_config.json"
backup_file "$CLAUDE_CODE_CONFIG"    "$BACKUP_DIR/.claude.json"
backup_file "$CODEX_CONFIG"          "$BACKUP_DIR/config.toml"
# Only back up the project-scope config if it actually exists — we don't want
# to create a bogus empty backup for every repo that doesn't use this scope.
[ -f "$PROJECT_MCP_CONFIG" ] && backup_file "$PROJECT_MCP_CONFIG" "$BACKUP_DIR/project.mcp.json"
backup_dir  "$CLAUDE_SKILLS_DIR"     "$BACKUP_DIR/claude-skills"
backup_dir  "$CODEX_SKILLS_DIR"      "$BACKUP_DIR/codex-skills"

# ---------------------------------------------------------------------------
# 9. Snapshot pre-existing cli-mcp-* token IDs for diff-based cleanup
# ---------------------------------------------------------------------------
#
# IDs only, no secrets. `tokens list` MUST succeed — a silent failure would
# make cleanup revoke valid pre-existing tokens.

set +e
snapshot_out=$(bin/tiddly tokens list 2>&1); snapshot_rc=$?
set -e
if [ $snapshot_rc -ne 0 ]; then
    echo "FATAL: 'tokens list' failed during Phase 0 snapshot (rc=$snapshot_rc)." >&2
    echo "       Auth may not be set up, or the API is unreachable. Aborting." >&2
    echo "       stderr (token values redacted by CLI design, safe to show):"    >&2
    echo "$snapshot_out" | sed 's/bm_[A-Za-z0-9_-]\{4,\}/bm_REDACTED/g'          >&2
    exit 1
fi
echo "$snapshot_out" | awk '/cli-mcp-/ {print $1}' | LC_ALL=C sort \
    > "$BACKUP_DIR/cli-mcp-ids-before.txt"
unset snapshot_out snapshot_rc
# Snapshot authoritative — cleanup_cli_mcp_tokens refuses to run without this.
export SNAPSHOT_EXPECTED=1

# ---------------------------------------------------------------------------
# 10. Two-pass sanitize: strip user's Tiddly entries from real configs
# ---------------------------------------------------------------------------

sanitize_one claude-desktop
sanitize_one claude-code
sanitize_one codex

sanitize_canonical_json "$CLAUDE_DESKTOP_CONFIG"
sanitize_canonical_json "$CLAUDE_CODE_CONFIG"
sanitize_canonical_toml "$CODEX_CONFIG"

# Note: $PWD/.mcp.json is NOT sanitized. The CLI has no supported write
# path to it (valid scopes are `user` and `directory`; `directory` for
# claude-code writes to ~/.claude.json under .projects[...], not to
# .mcp.json). The file is backed up / restored defensively above in case
# the engineer has one, but the tests do not operate on it.

echo "Sanitized: Tiddly entries wiped (URL-based + canonical-name strip); originals preserved in \$BACKUP_DIR."

# ---------------------------------------------------------------------------
# 11. Temp project dir for directory-scope tests
# ---------------------------------------------------------------------------

TEST_PROJECT=$(mktemp -d)
echo "Test project dir: $TEST_PROJECT"

# ---------------------------------------------------------------------------
# 12. Write runtime state to /tmp/tiddly-test-state.env
# ---------------------------------------------------------------------------
#
# Every subsequent Bash call sources per_call.sh, which sources this file.
# The file contains only path constants, counters, and the
# SNAPSHOT_EXPECTED gate. No PATs, no session tokens.

TIDDLY_TEST_STATE="/tmp/tiddly-test-state.env"
{
    echo "# Auto-generated by cli/tests_agentic/phase0_setup.sh"
    echo "# Runtime state for the current CLI test run. Sourced by per_call.sh"
    echo "# at the top of every subsequent Bash call."
    echo
    printf 'export TIDDLY_BIN=%q\n'             "$TIDDLY_BIN"
    printf 'export CLAUDE_DESKTOP_CONFIG=%q\n'  "$CLAUDE_DESKTOP_CONFIG"
    printf 'export CLAUDE_CODE_CONFIG=%q\n'     "$CLAUDE_CODE_CONFIG"
    printf 'export CODEX_CONFIG=%q\n'           "$CODEX_CONFIG"
    printf 'export CLAUDE_SKILLS_DIR=%q\n'      "$CLAUDE_SKILLS_DIR"
    printf 'export CODEX_SKILLS_DIR=%q\n'       "$CODEX_SKILLS_DIR"
    printf 'export PROJECT_MCP_CONFIG=%q\n'     "$PROJECT_MCP_CONFIG"
    printf 'export BACKUP_DIR=%q\n'             "$BACKUP_DIR"
    printf 'export REPORT=%q\n'                 "$REPORT"
    printf 'export TEST_PROJECT=%q\n'           "$TEST_PROJECT"
    printf 'export SNAPSHOT_EXPECTED=%q\n'      "$SNAPSHOT_EXPECTED"
    # Re-export TIDDLY_* so subsequent calls don't rely on inherited env.
    printf 'export TIDDLY_API_URL=%q\n'         "$TIDDLY_API_URL"
    printf 'export TIDDLY_CONTENT_MCP_URL=%q\n' "$TIDDLY_CONTENT_MCP_URL"
    printf 'export TIDDLY_PROMPT_MCP_URL=%q\n'  "$TIDDLY_PROMPT_MCP_URL"
    printf 'export TIDDLY_AUTH0_DOMAIN=%q\n'    "$TIDDLY_AUTH0_DOMAIN"
    printf 'export TIDDLY_AUTH0_CLIENT_ID=%q\n' "$TIDDLY_AUTH0_CLIENT_ID"
    printf 'export TIDDLY_AUTH0_AUDIENCE=%q\n'  "$TIDDLY_AUTH0_AUDIENCE"
    # Report counters — every call needs these initialized. Bash counters
    # don't export across shells by value (arithmetic needs fresh lookups);
    # calls should re-read them from the live report via report_summary
    # at end-of-run. For in-call counters, initialize to 0 per call.
    echo "export REPORT_PASS=0"
    echo "export REPORT_FAIL=0"
    echo "export REPORT_SKIP=0"
    echo "export REPORT_NOTE=0"
} > "$TIDDLY_TEST_STATE"
chmod 0600 "$TIDDLY_TEST_STATE"
echo "Runtime state written: $TIDDLY_TEST_STATE"

# ---------------------------------------------------------------------------
# 13. Install the EXIT trap
# ---------------------------------------------------------------------------
#
# on_exit is defined in lib.sh. Registration has to happen per-Bash-call
# (the Claude Code Bash tool spawns a new shell per call, so traps from
# prior calls don't survive). This installs it for the current call; every
# subsequent call re-installs via per_call.sh.

trap 'on_exit $?' EXIT
