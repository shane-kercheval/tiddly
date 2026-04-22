# CLI agentic test procedure

End-to-end tests for the `tiddly` CLI, structured to be executed by an AI agent against a local dev environment.

## Files

- **`agent_instructions.md`** — the procedure. Read it top-to-bottom before running.
- **`lib.sh`** — a small pile of optional/example shell helpers (`sha_of`, `assert_no_plaintext_bearers`, two canonical-entry sanitizers, one multi-entry fixture writer). Everything else the agent can write inline.

## Design intent

The procedure describes **behavioral claims**, not copy-paste shell snippets. The agent is expected to:

1. Read the claim for a test.
2. Decide how to verify it in the local shell (zsh / bash, macOS / Linux, whatever's on PATH).
3. Run the relevant CLI command.
4. Assert the claim holds, using whatever combination of `jq`, `grep`, `python3`, etc. fits.

When a claim doesn't verify, the agent **stops and reports**. It does not auto-recover, restore configs, or revoke tokens on failure — that decision belongs to the engineer, who reviews the mismatch and directs what happens next. There is no destructive EXIT trap.

## Safety

Three narrow, explicit guards — nothing more:

1. **Localhost-only.** Phase 0 aborts unless `TIDDLY_API_URL` points at `localhost` / `127.0.0.1` and `auth status` agrees. Stops writes from going against production.

2. **No plaintext tokens in transcripts.** `assert_no_plaintext_bearers` from `lib.sh` is called on every captured `configure`/`remove`/`dry-run` output before it's echoed. FATALs if a real token slipped through the CLI's redactor.

3. **No silent token orphans.** Phase 0 snapshots the pre-existing `cli-mcp-*` token IDs to a file in `$BACKUP_DIR`. Phase 9's explicit teardown diffs current-vs-snapshot and revokes only the additions. If Phase 9 doesn't run (crash, aborted run), the agent prints the list of new token names so the engineer can revoke manually via the web UI.

The user's real config files are backed up before Phase 0's sanitize runs and restored by Phase 9. If Phase 9 doesn't run, `$BACKUP_DIR` stays on disk with the originals; the procedure prints the exact `cp` commands to restore manually.
