# CLI test-procedure harness

Support files for `cli/agent_instructions.md`. These exist because the
testing procedure is executed by an AI agent whose Bash tool spawns a fresh
shell for every command — in-memory state (functions, variables, traps)
doesn't survive across calls.

Rather than redefining every helper inside the markdown, the stable pieces
live here as real shell files. The procedure markdown stays focused on
test cases and verify checklists; the agent sources these files to bring
helpers, paths, and the cleanup trap back into the current shell.

## Files

**`lib.sh`** — All shared helpers: `sha_of`, `assert_unchanged`,
`assert_no_plaintext_bearers`, `assert_auth_still_working`, `backup_file` /
`restore_file` / `backup_dir` / `restore_dir`, `phase`, `report_phase` /
`report_test` / `report_mismatch` / `report_summary` / `redact_for_report`,
`cleanup_cli_mcp_tokens` / `cleanup_sibling_backups` / `cleanup_test_tokens`,
`preflight_agent_env`, `sanitize_one` / `sanitize_canonical_json` /
`sanitize_canonical_toml`, `on_exit` (the failure-only EXIT trap handler),
`final_teardown` (the explicit session-end cleanup called from Phase 10),
and the shared multi-entry fixture writers (`write_multi_entry_prompts`
and variants).

Pure function definitions only. Sourcing has no side effects beyond
installing conditional platform helpers (`SHA256`, `file_mode`). Safe to
source once or many times.

Helpers that shell out to the CLI use `"$TIDDLY_BIN"` (absolute path set
by Phase 0) rather than the relative `bin/tiddly`. That's required
because the EXIT trap can fire from any cwd — a test that did
`cd "$TEST_PROJECT"` and didn't cd back leaves the trap running outside
the repo root, where `bin/tiddly` is unresolvable. The sole exception is
`preflight_agent_env`, which runs before `$TIDDLY_BIN` is set; its
contract is "caller is at repo root" and it enforces that via its own
`[ -x bin/tiddly ]` check.

**`phase0_setup.sh`** — One-time Phase 0 setup (sourced exactly once per
test session). Platform detection, CLI-binary check, preflight assertions,
dev-mode probe, tool preflight, mktemp'd `$BACKUP_DIR` / `$REPORT` /
`$TEST_PROJECT`, initial config backups, token-ID snapshot, two-pass
sanitize, write runtime state to `/tmp/tiddly-test-state.env`, install
EXIT trap.

**`per_call.sh`** — Sourced at the top of every post-Phase-0 Bash call.
Re-establishes function definitions (lib.sh), runtime paths
(/tmp/tiddly-test-state.env), and the EXIT trap.

**`README.md`** — This file.

## Execution model

Phase 0 (first Bash call):

```bash
set -euo pipefail
source cli/tests_agentic/lib.sh
source cli/tests_agentic/phase0_setup.sh
```

Every subsequent test's Bash call:

```bash
source cli/tests_agentic/per_call.sh
# ... test commands ...
```

Phase 10 (session-end cleanup, explicit — the trap won't do this for you):

```bash
source cli/tests_agentic/per_call.sh
report_summary
final_teardown
```

The state file at `/tmp/tiddly-test-state.env` is written by Phase 0 and
read by every later call. It contains only path constants and export
statements — no PATs, no session values, no secrets. `per_call.sh`
validates that `$BACKUP_DIR` (named in state.env) still exists as a
directory; if the file is stale (previous run aborted and got
externally cleaned up), the preamble FATALs with an actionable fix.

### Trap semantics

The EXIT trap is **failure-only** by design — every Bash call's shell
exits at the end of its snippet, so if the trap did destructive teardown
on rc=0, finishing Phase 0 would wipe the harness before Phase 1 could
run. Two functions split the concerns:

- **`on_exit`** (registered by `per_call.sh`) — fires on every call's
  exit. Returns early on rc=0 or when `TEARDOWN_COMPLETE=1`. On rc≠0 it
  does crash recovery only: restore configs + cleanup tokens, but
  preserves `$BACKUP_DIR`, `$TEST_PROJECT`, and state.env for forensic
  inspection.
- **`final_teardown`** — explicit, called from Phase 10 only. Returns
  **non-zero on any cleanup/restore failure** (fail-closed by design).
  On success: restores configs, revokes this-run tokens, copies the
  live report to a retained post-run location, deletes `$BACKUP_DIR`,
  `$TEST_PROJECT`, and state.env, and sets `TEARDOWN_COMPLETE=1` so the
  subsequent trap fire is a no-op. On failure: prints actionable manual-
  recovery instructions (with copy-paste-ready `cp` commands) and returns
  1 without deleting `$BACKUP_DIR`, so the engineer has the originals
  preserved. Phase 10's caller checks the return with `if !
  final_teardown; then ... exit 1; fi`.

To proactively trigger cleanup on abort: call `on_exit 1` (crash path,
preserves artifacts) or `final_teardown` (clean path — preserves
artifacts on any failure, removes them only on full success). Both
available after `per_call.sh` is sourced.

### Concurrent-run guard

`phase0_setup.sh` refuses to start if `/tmp/tiddly-test-state.env` exists
AND references a `$BACKUP_DIR` that still exists on disk — that pattern
indicates another session is live, and two sessions mutating the same
`$HOME/.claude.json` would corrupt each other regardless of state.env.
If state.env exists but the referenced `$BACKUP_DIR` is gone (stale from
an aborted run), Phase 0 auto-removes state.env and proceeds. The guard
does not implement full OS-level locking for fully-concurrent Phase 0
startups — that's a low-probability case left unaddressed.

## What does NOT live here

- **Test cases and verify checklists** stay in
  `cli/agent_instructions.md`. This file's job is stable harness code;
  the plan's job is what-to-test content.
- **Per-run runtime state** (mktemp'd paths, token-ID snapshot, live report)
  stays on disk under `$BACKUP_DIR` / `/tmp/tiddly-test-state.env`. Never
  committed.
- **Auth tokens / session values** are not stored anywhere under this
  directory. Tokens are minted at test time via `bin/tiddly tokens create`
  and live in local shell variables.
- **Auth0 tenant config** is hardcoded in `phase0_setup.sh`. These are
  **public identifiers** (domain, client ID, audience) per the plan's
  § "Auth0 values — these are not secrets." They ship in frontend bundles
  and OAuth URLs, and checking them in is intentional. If a fork uses a
  different dev tenant, swap them.

## Security contract

Nothing committed here contains PATs, session tokens, or any user-specific
secret. Every helper that handles Bearer tokens (the fixture writers, the
report helpers, the assertions) either (a) takes PATs as runtime arguments
or (b) runs a defensive redactor (`assert_no_plaintext_bearers`,
`redact_for_report`) before any output escapes to a file or the report.

Any change that introduces a hardcoded token-shaped value here is a bug.
Test PATs come from `bin/tiddly tokens create` at runtime; Auth0 values
are public; local path constants don't carry secrets by construction.

## Maintenance invariant

The procedure markdown references function names defined here. Renaming a
function, removing it, or changing its signature needs the markdown
updated in the same change.
