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
#     source cli/test_procedure/per_call.sh
#     # ... test commands here ...
#
# Nothing secret in this file — safe to commit.

set -euo pipefail

# The procedure is always run from the repo root. If this file is sourced
# before the working directory is right, fail loudly rather than silently
# loading nothing.
if [ ! -f cli/test_procedure/lib.sh ]; then
    echo "FATAL: per_call.sh sourced from $PWD — expected repo root." >&2
    echo "       (cli/test_procedure/lib.sh not found relative to PWD)." >&2
    exit 1
fi

# shellcheck source=lib.sh
source cli/test_procedure/lib.sh

# Runtime state from Phase 0. If this doesn't exist, Phase 0 hasn't run
# yet or was aborted before writing state.env — refuse to proceed.
if [ ! -f /tmp/tiddly-test-state.env ]; then
    echo "FATAL: /tmp/tiddly-test-state.env not found." >&2
    echo "       Phase 0 has not completed. Run it before any other phase:" >&2
    echo "           source cli/test_procedure/lib.sh" >&2
    echo "           source cli/test_procedure/phase0_setup.sh" >&2
    exit 1
fi
# shellcheck source=/dev/null
source /tmp/tiddly-test-state.env

# Re-install the EXIT trap. The handler lives in lib.sh; we re-register it
# here because traps don't survive a new shell. Covers within-call crashes;
# between-call crashes need manual recovery from $BACKUP_DIR.
trap 'on_exit $?' EXIT
