# CLI test-procedure harness

Support files for `cli/agent_testing_procedure.md`. These exist because the
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
`sanitize_canonical_toml`, `on_exit`, and the shared multi-entry fixture
writers (`write_multi_entry_prompts` and variants).

Pure function definitions only. Sourcing has no side effects beyond
installing conditional platform helpers (`SHA256`, `file_mode`). Safe to
source once or many times.

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
source cli/test_procedure/lib.sh
source cli/test_procedure/phase0_setup.sh
```

Every subsequent test's Bash call:

```bash
source cli/test_procedure/per_call.sh
# ... test commands ...
```

The state file at `/tmp/tiddly-test-state.env` is written by Phase 0 and
read by every later call. It contains only path constants and export
statements — no PATs, no session values, no secrets.

## What does NOT live here

- **Test cases and verify checklists** stay in
  `cli/agent_testing_procedure.md`. This file's job is stable harness code;
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
