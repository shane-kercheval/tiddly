#!/usr/bin/env bash
# shellcheck shell=bash
#
# Preamble for every post-Phase-0 Bash call.
#
# The Claude Code Bash tool spawns a new shell per call, so functions,
# variables, and traps from prior calls don't survive. This file re-
# establishes the shared test harness state:
#
#   1. Source lib.sh (function definitions — idempotent, no side effects).
#   2. Source /tmp/tiddly-test-state.env (runtime paths written by Phase 0).
#   3. Re-install the EXIT trap (the on_exit handler lives in lib.sh).
#
# Usage from a test's Bash snippet:
#
#     source cli/tests_agentic/per_call.sh
#     # ... test commands here ...
#
# Nothing secret in this file — safe to commit.

set -euo pipefail

# The procedure is always run from the repo root. If this file is sourced
# before the working directory is right, fail loudly rather than silently
# loading nothing.
if [ ! -f cli/tests_agentic/lib.sh ]; then
    echo "FATAL: per_call.sh sourced from $PWD — expected repo root." >&2
    echo "       (cli/tests_agentic/lib.sh not found relative to PWD)." >&2
    exit 1
fi

# shellcheck source=lib.sh
source cli/tests_agentic/lib.sh

# Runtime state from Phase 0. If this doesn't exist, Phase 0 hasn't run
# yet or was aborted before writing state.env — refuse to proceed.
if [ ! -f /tmp/tiddly-test-state.env ]; then
    echo "FATAL: /tmp/tiddly-test-state.env not found." >&2
    echo "       Phase 0 has not completed. Run it before any other phase:" >&2
    echo "           source cli/tests_agentic/lib.sh" >&2
    echo "           source cli/tests_agentic/phase0_setup.sh" >&2
    exit 1
fi
# shellcheck source=/dev/null
source /tmp/tiddly-test-state.env

# Freshness check: the state file is a hard-coded path in /tmp and could be
# left over from a previous run that aborted without cleaning up (state.env
# survives but $BACKUP_DIR was deleted externally, or a crash left state.env
# pointing at a no-longer-valid temp dir). Validate $BACKUP_DIR still exists
# as a directory — if not, the state is stale and proceeding would misroute
# cleanup / reporting to a dead path.
if [ ! -d "${BACKUP_DIR:-/nonexistent}" ]; then
    echo "FATAL: /tmp/tiddly-test-state.env references BACKUP_DIR=${BACKUP_DIR:-<unset>}" >&2
    echo "       which no longer exists. This is a stale state file from a previous" >&2
    echo "       aborted run." >&2
    echo "       Fix: rm /tmp/tiddly-test-state.env, then re-run Phase 0:" >&2
    echo "           source cli/tests_agentic/lib.sh" >&2
    echo "           source cli/tests_agentic/phase0_setup.sh" >&2
    exit 1
fi

# PATH sanity probe — catch transient tool-lookup failures BEFORE the trap
# is installed and BEFORE any test snippet runs. The Bash tool spawns a
# fresh shell per call and re-evaluates the user's login-shell profile;
# stochastic profile conditions (direnv, plugin managers, conditional
# PATH exports) can occasionally produce a narrower PATH in a given call.
# When that happens mid-test, helpers like sha_of silently produce empty
# output and downstream assertions surface as false mismatches — which
# fire the EXIT trap and wipe the session. Probing here means a flake
# FATALs cleanly at preamble time rather than mid-test.
for _tool in awk jq python3 openssl; do
    command -v "$_tool" >/dev/null 2>&1 || {
        echo "FATAL: '$_tool' not on PATH in this Bash call." >&2
        echo "       PATH=$PATH" >&2
        echo "       This is an env flake (transient shell-profile state). Either" >&2
        echo "       retry the call, or fix the login-shell profile to guarantee" >&2
        echo "       /usr/bin and /usr/local/bin are always present." >&2
        exit 1
    }
done
# sha256sum on Linux, shasum on macOS — accept either.
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || {
    echo "FATAL: neither sha256sum nor shasum on PATH. PATH=$PATH" >&2
    exit 1
}
unset _tool

# Re-install the EXIT trap. The handler lives in lib.sh; we re-register it
# here because traps don't survive a new shell. on_exit is FAILURE-ONLY
# by design (clean call exits return early, so repeated per-call traps
# don't tear down the harness between calls — see lib.sh § "EXIT trap
# handler" for the full rationale). Final session-end cleanup runs via
# final_teardown() from Phase 9, not via this trap.
trap 'on_exit $?' EXIT
