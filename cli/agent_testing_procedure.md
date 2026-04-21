# CLI Agent Testing Procedure

End-to-end verification of the `tiddly` CLI. Structured for an AI agent to execute, but every step is readable by a human. Covers command surface, scope variants, multi-account safety (additive configure + CLI-managed-only remove), URL-mismatch fail-closed gate with `--force` override, timestamped backups, remove flows including `--delete-tokens` with structured per-entry reporting, skills, error handling, and auth.

**Branch focus:** additive-configure and canonical-name-only remove work lives in the new T2.11–T2.13 (additive preservation, update-in-place, --force), T3.6–T3.8 (mismatch fail-closed across single/multi tools with pluralization, dry-run warnings), T5.4 (multi-row rendering regression — same fixture, different assertions now), and T6.8 / T6.8b / T6.8c / T6.8d (`--delete-tokens` reshaped for canonical-only revocation across JSON+TOML handlers). If time-boxed, prioritize those. Phases 7 and 8 are regression backstops. **Don't skip Phase 1** — T1.5 and T1.7 are contract locks that Phase 0's cleanup depends on (`tokens list` column order, status row format); if they break, the safety machinery breaks.

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

**The rule:** do not echo, print, or capture Bearer token values via any command whose output lands in the transcript, except the explicit token-display path (`tokens create`, which must show the plaintext once). Enforced by `assert_no_plaintext_bearers` (Phase 0 helper) and `redact_for_report`. This is the canonical statement — downstream sections reference it rather than restating.

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

### What to do on mismatch

Stop, write the mismatch report, wait for human discussion. Do NOT silently update plan expectations, fix the code to match the plan, skip ahead (later tests depend on earlier state), or run cleanup early unless the EXIT trap needs to fire. Batch related mismatches into one report; note the relationship in `Hypothesis:`.

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

Same hygiene as the transcript (see § CRITICAL: Never Echo Token Values). Safe content: pass/fail outcomes, hash comparison results, exit codes, token *names*, first-12 `TokenPrefix` strings.

---

## Safety Model

**The config files this procedure reads and writes are the REAL files your Claude Desktop / Claude Code / Codex installations use.** We do not synthesize sandbox copies. Instead:

1. Every destructive test is preceded by a timestamped backup handled by the CLI itself (`.bak.<UTC-ts>` sibling files next to the live configs) AND by this procedure's Phase 0 snapshot into `$BACKUP_DIR` (mode 0700). User-scope configs (`~/.claude.json`, Claude Desktop, Codex) plus project-scope `.mcp.json` in the CWD are all backed up. **Note:** `.mcp.json` is preserved defensively; the CLI has no supported write path to it (valid scopes are `user` and `directory`), so the tests never operate on it.
2. An `EXIT` trap always fires, attempting config restore + token cleanup + sibling-backup sweep, even on test abort. On clean success, `$BACKUP_DIR` is auto-deleted AND the CLI-emitted `.bak.<ts>` siblings are removed post-restore. On failure, `$BACKUP_DIR` is preserved with a warning so manual recovery is possible.
3. Tokens created during this run are identified by diffing the initial `cli-mcp-*` ID list against the post-run list. Cleanup deletes **only** the additions. Pre-existing `cli-mcp-*` tokens from prior runs or earlier configures are **not** touched. Two gates protect this: the Phase 0 `tokens list` must succeed (fail-closed FATAL otherwise), and cleanup requires `SNAPSHOT_EXPECTED=1` + a live OAuth session — if either is missing, cleanup refuses to delete rather than fail-open.
4. **Strongly recommended:** run against a dedicated test Tiddly account. `--delete-tokens` and the diff-based cleanup have been hardened, but account isolation is the best defense against agent mistakes.

If you cannot use a test account, the procedure is still safe to run, but review the `cli-mcp-*` tokens it creates against your token list before and after.

---

## Prerequisites

- [ ] CLI is built: `make cli-build` (verify `bin/tiddly` exists)
- [ ] Local API and MCP servers are running (tests run against local services, not production)
- [ ] **Backend `VITE_DEV_MODE` is `false`.** Dev mode short-circuits all Bearer validation (PATs and JWTs alike resolve to a shared dev user), which silently breaks any test that depends on server-side token validation — most visibly T2.12's canonical-PAT validate-then-reuse path and the CLI-minted/orphan-token assertions in T6.8 / T6.8d. Phase 0 runs a probe that FATALs if dev mode is detected.
- [ ] Authenticated via OAuth — see [§ Auth](#auth-engineer-must-do-this-manually) (human step, must happen before the agent starts)
- [ ] API is reachable: `bin/tiddly status` shows API status `ok`

---

## Execution model (read before Phase 0)

The test harness is designed around the Claude Code Bash tool's execution model: **every Bash call spawns a new shell with no memory of prior calls**. Functions, variables, and traps don't survive across calls.

To make this workable, the stable pieces of the harness (helpers, Phase 0 setup, cleanup trap) live in checked-in shell files under `cli/test_procedure/`:

- **`lib.sh`** — all shared function definitions (`sha_of`, `assert_*`, `report_*`, `backup_*` / `restore_*`, `cleanup_*`, `on_exit`, the `write_multi_entry_prompts*` fixture writers, etc.). Pure definitions — safe to source any number of times.
- **`phase0_setup.sh`** — one-time Phase 0 setup: platform detection, preflight assertions, `mktemp`'d `$BACKUP_DIR` / `$REPORT` / `$TEST_PROJECT`, initial backups, token-ID snapshot, sanitize. Writes runtime state to `/tmp/tiddly-test-state.env` so subsequent calls can re-source it.
- **`per_call.sh`** — the preamble every post-Phase-0 Bash call sources. Re-installs function definitions, runtime paths, and the EXIT trap.
- **`README.md`** — structure overview + security contract.

See `cli/test_procedure/README.md` for the full rundown.

### Phase 0 — first Bash call of the session

```bash
set -euo pipefail
source cli/test_procedure/lib.sh
source cli/test_procedure/phase0_setup.sh
```

That's it. `phase0_setup.sh` does everything in the old inline block: platform detection, preflight, backups, snapshot, sanitize, trap install, and writes `/tmp/tiddly-test-state.env`. On success, `$BACKUP_DIR` / `$REPORT` / `$TEST_PROJECT` / `$CLAUDE_CODE_CONFIG` / etc. are exported and persisted to state.env for later calls.

### Every subsequent test's Bash call

```bash
source cli/test_procedure/per_call.sh
# ... test commands here ...
```

`per_call.sh` sources `lib.sh`, sources `/tmp/tiddly-test-state.env`, and re-installs the EXIT trap. After sourcing, every helper (`sha_of`, `report_test`, `assert_no_plaintext_bearers`, etc.) and every path variable (`$CLAUDE_CODE_CONFIG`, `$TEST_PROJECT`, `$BACKUP_DIR`, `$TIDDLY_BIN`, ...) is available. If `/tmp/tiddly-test-state.env` is missing, `per_call.sh` FATALs — a sign Phase 0 didn't run or was aborted mid-write.

### Trap semantics under Bash-per-call

The per-call model means the EXIT trap fires after **every** Bash call (each call's shell exits at the end of its snippet). If the trap did the full "restore + delete `$BACKUP_DIR`" teardown, Phase 0's clean exit would wipe the harness before Phase 1 could run.

To make this work, the trap is **failure-only**:

- **`on_exit`** (registered by `per_call.sh`) — fires on every call's exit. On rc=0 it returns early and does nothing. On rc≠0 (a genuine crash) it does **crash recovery only**: restores configs and cleans up this-run tokens, but **preserves** `$BACKUP_DIR`, `$TEST_PROJECT`, and `/tmp/tiddly-test-state.env` so the engineer can inspect what went wrong.
- **`final_teardown`** (defined in `lib.sh`, called explicitly from Phase 10) — does the full session-end cleanup: restore configs, revoke this-run tokens, copy the live report to the retained post-run location, and delete `$BACKUP_DIR`, `$TEST_PROJECT`, and `/tmp/tiddly-test-state.env`. Sets `TEARDOWN_COMPLETE=1` so the trap that fires as the shell exits sees the sentinel and no-ops.

**Between-call** crashes (agent stops between tests) don't fire the trap. `$BACKUP_DIR` persists with original configs; the engineer can recover manually using the paths shown in the trap's WARNING (if the last call printed one). If a new run starts and `/tmp/tiddly-test-state.env` still exists but references a deleted `$BACKUP_DIR`, `per_call.sh` detects that staleness and FATALs with an actionable fix. **To proactively trigger cleanup on abort**: call `on_exit 1` to fire the crash-recovery path, or call `final_teardown` to do the explicit clean teardown — both are available after `per_call.sh` is sourced.

### Fixture helpers

`write_multi_entry_prompts` / `write_multi_entry_prompts_desktop` / `write_multi_entry_prompts_codex` are defined in `lib.sh` and available after `per_call.sh` is sourced. They're used by T2.11, T5.4, T6.8, T6.8c.


## Auth (engineer must do this manually)

The agent **cannot** complete the OAuth device flow — it requires opening a browser and entering a code. Auth must be set up BEFORE the agent starts.

> **Instruction to the agent:** if auth/env setup hasn't been done, paste the copy-paste block below verbatim into your message to the engineer (inside a fenced code block). Don't paraphrase or reference by line number.

### Critical — `.env` is NOT read by the CLI

The Go CLI reads **shell environment variables**, not `backend/.env`. Variables like `VITE_AUTH0_DOMAIN` exist for the backend and frontend; the CLI cannot see them. If you skip the exports below and just run `bin/tiddly login`, the CLI falls back to hardcoded **production** defaults (`tiddly.us.auth0.com` / `Gpv1ZrySgEeoTHlPyq3vSqHdFkS1vPwI` / `tiddly-api`). Your token will then be a production token that your local backend (which validates against the dev Auth0 tenant) will reject with 401 at the first authenticated command.

If you already ran `bin/tiddly login` bare and ended up logged into production, run `bin/tiddly logout` first and start over from step 2 below.

### Preflight — one check before you start

Confirm `VITE_DEV_MODE=false` in the backend's `.env` (or is unset). Dev mode makes the backend accept any Bearer value as the dev user and silently breaks token-validation tests (T2.12 canonical reuse, T6.8 canonical revoke + orphan filter). Phase 0 has a probe that FATALs on detection, but checking here first saves a wasted run.

### Auth0 values — these are not secrets

Auth0 domain, client ID, and audience are **public identifiers**. They ship in frontend bundles and OAuth URLs. The values below are for this repo's dev Auth0 tenant and are safe to commit. If you forked this repo and have a different dev tenant, replace them with yours — otherwise the values below are what you want.

### The exact commands — copy, paste, run

1. Exit any running Claude Code session.
2. Open a fresh terminal and run **exactly this block**:

   ```bash
   # Build the CLI binary. All bin/tiddly invocations below (and the
   # agent's Phase 0 setup) require this to have run first.
   make cli-build

   # Backend + MCP service URLs (standard local-dev ports)
   export TIDDLY_API_URL=http://localhost:8000
   export TIDDLY_CONTENT_MCP_URL=http://localhost:8001/mcp
   export TIDDLY_PROMPT_MCP_URL=http://localhost:8002/mcp

   # Auth0 — dev tenant for this repo (public identifiers, not secrets).
   # IMPORTANT: the CLIENT_ID below is the CLI's dedicated Native Auth0
   # application (has Device Code grant enabled), NOT the frontend SPA
   # client ID from backend/.env. The SPA client doesn't have device flow
   # enabled; using it here fails with `unauthorized_client`. See
   # docs/implementation_plans/2026-03-02-cli.md:249 for the Native-app
   # Auth0 setup.
   export TIDDLY_AUTH0_DOMAIN=kercheval-dev.us.auth0.com
   export TIDDLY_AUTH0_CLIENT_ID=upLOqYelIdJIv7yZ8AnULA6VGklzak18
   export TIDDLY_AUTH0_AUDIENCE=bookmarks-api

   # Drop any stale production session that may be cached
   bin/tiddly logout 2>/dev/null || true

   # Log in against the dev tenant
   bin/tiddly login

   # Sanity check: should print `Auth method: oauth` and your dev-account email
   bin/tiddly auth status
   ```

3. If `auth status` shows your expected dev email, **launch Claude Code from this same terminal**. The agent's Bash tool inherits these env vars from the launching shell.

> If login errors with `grant type ... not allowed for the client`, the client ID points at a non-Native Auth0 app; enable "Device Code" in the Auth0 dashboard Grant Types or use a Native app's client ID. Other errors usually mean an env var is wrong — `echo $TIDDLY_AUTH0_DOMAIN`.

### What the agent verifies post-launch

**This is enforced, not advisory.** The Phase 0 setup block's `preflight_agent_env` helper runs as its very first step (before any hardcoded `TIDDLY_*` exports) and FATALs with remediation instructions if any of the following fail:

- CLI's `status` output must show `API URL: http://localhost:*` or `http://127.0.0.1:*` (catches the prod-default fallback when exports didn't reach the agent's shell).
- `auth status` output must not contain `Session expired` / `API error` / `Not logged in`.
- `auth status` must not report `User: unknown` (credentialed but server-rejected — typically wrong Auth0 tenant).

If the preflight FATALs, the message tells the engineer to exit Claude Code, redo the exports in a fresh terminal, and relaunch. No need to run `auth status` manually here — the agent runs it with the exact assertions.

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
| OtherServer.URL round-trips for mismatch detection | `TestClassifyServer__canonical_name_at_non_tiddly_url_records_url` |
| DeleteTokensByPrefix dedupes by PAT and fans out per-entry results | `TestDeleteTokensByPrefix__shared_pat_fans_out_single_deletion` + `__preserves_order_and_labels_with_mixed_shared_and_unique_pats` + `__short_pat_returns_empty_not_error` |
| Hard-error ordering in preflight (discards accumulated mismatches / short-circuits scan) | `TestRunConfigure__hard_error_on_second_tool_discards_first_tool_mismatch` + `__hard_error_on_first_tool_short_circuits_second_tool_scan` |
| `canonicalEntryPATs` rejects cross-wired PATs | `TestRunConfigure__does_not_reuse_pat_from_cross_wired_canonical_slot` |
| `--force` log only fires after PAT resolution succeeds | `TestRunConfigure__force_log_not_emitted_when_pat_resolution_fails` |
| Mismatch error has no double "Error:" prefix under cobra | `TestMCPConfigure__mismatch_error_has_no_double_error_prefix` |

Run `make cli-verify` before this procedure to confirm those cover their invariants.

---

## How to use the report helpers

Every phase starts with `report_phase`. Every test ends with `report_test PASS|SKIP|NOTE ...` or `report_mismatch ...` (which exits non-zero and fires the EXIT trap — per the Reporting Protocol, stop and wait for the engineer).

**Every post-Phase-0 Bash call must start with `source cli/test_procedure/per_call.sh`** — that's what brings `report_phase`, `report_test`, `assert_no_plaintext_bearers`, `$CLAUDE_CODE_CONFIG`, `$BACKUP_DIR`, and the EXIT trap back into the current shell (see § Execution model). The preamble is omitted from the test snippets below for brevity, but it's not optional.

```bash
source cli/test_procedure/per_call.sh

report_phase "Phase 1: Read-only"

out=$(bin/tiddly --help 2>&1)
if echo "$out" | grep "Usage:" >/dev/null; then
  report_test PASS "T1.1 — Root help"
else
  report_mismatch "T1.1" "output contains 'Usage:'" "output was: $(echo "$out" | head -1)" plan-bug ""
fi
```

**IMPORTANT: do NOT use `grep -q` inside a pipeline under `set -o pipefail`.** `grep -q` exits as soon as it finds a match, which closes the pipe and sends `SIGPIPE` (exit 141) to any still-writing upstream. With `pipefail` on, that 141 becomes the pipeline exit, so a real match reports as failure. The race is invisible on small outputs (pipe buffer absorbs everything before grep reads) but fires on dry-run diffs, multi-entry configure output, and `tokens list` with many rows. **Use `grep PATTERN >/dev/null` instead** — it reads all of stdin, so upstream finishes normally. Applies anywhere the assertion is on a pipeline; greps against a file (e.g. `grep PATTERN "$CONFIG"`) are safe.

**IMPORTANT: redirect large CLI output to a file, not a shell variable.** `$(cmd)` captures stdout into a shell var, but `echo "$var" | grep …` on a multi-hundred-KB blob (dry-run dumps of real `~/.claude.json` are commonly 100 KB+) is unreliable across shells and assertion frameworks. **Pattern:** `cmd > /tmp/tXY_stdout 2> /tmp/tXY_stderr` then assert with `grep … /tmp/tXY_stdout`. Small outputs (help text, `tokens list`, `auth status`) are fine to capture in a variable; the threshold is "could this output include a full config dump?" — if yes, use a file.

**IMPORTANT: escape `--` prefix in grep/grep -F patterns.** `grep -F "--scope directory …"` parses the leading `--` as end-of-options for grep itself and then treats `scope directory …` as the pattern. Use `grep -F -- "$pattern"` (the `--` terminates grep's own option parsing) whenever the expected string starts with `--`.

**Mandatory Bearer-leak guard — call before every `echo "$out"` on configure/remove/dry-run output:**

```bash
out=$(bin/tiddly mcp configure ... 2>&1)
assert_no_plaintext_bearers "$out" "T<id>"   # FATAL if Bearer bm_<plaintext> found
echo "$out"                                   # safe to show
```

Use `report_test SKIP "T<id>" "reason"` for environmentally-skipped tests and `report_test NOTE "T<id>" "detail"` for narrative outcomes (e.g. T2.12 when the PAT was reused vs. re-minted).

---

## Phase 1: Read-only verification (no mutations)

`phase "Phase 1: Read-only"` at the start. Nothing here writes to disk or touches server state.

### [T1.1] Help-surface smoke (root / mcp / skills)
```bash
bin/tiddly --help        # root
bin/tiddly mcp --help    # mcp
bin/tiddly skills --help # skills
```
**Verify (all three exit 0):**
- [ ] Root help lists subcommands `login`, `logout`, `auth`, `status`, `mcp`, `skills`, `tokens` and global flags `--token`, `--api-url`
- [ ] `mcp --help` lists subcommands `configure`, `status`, `remove`
- [ ] `skills --help` lists subcommands `configure`, `list`

### [T1.3] MCP configure help — new content must be present
```bash
bin/tiddly mcp configure --help
```
**Verify:**
- [ ] Exit 0
- [ ] Flags listed: `--dry-run`, `--scope`, `--expires`, `--servers`, `--force`
- [ ] `--yes` / `-y` are NOT listed (removed in the additive-configure rework)
- [ ] Valid args: `claude-desktop`, `claude-code`, `codex`
- [ ] Help text mentions the CLI-managed entry names (`tiddly_notes_bookmarks`, `tiddly_prompts`) and the fact that other entries are preserved (e.g. "work_prompts")
- [ ] Help text mentions `--force` as the override for the URL-mismatch refusal
- [ ] Help text mentions `.bak.<timestamp>` backups
- [ ] Help text does **not** contain "consolidate" / "consolidation" / "migrations from manual setups are safe"

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
cd "$TEST_PROJECT" && "$TIDDLY_BIN" mcp configure claude-code --scope directory
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
cd "$TEST_PROJECT" && "$TIDDLY_BIN" mcp configure codex --scope directory
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

# Parse the EXPIRES column for any cli-mcp-claude-code-* token. Row format:
#   ID  NAME  PREFIX  LAST USED  EXPIRES  CREATED
# LAST USED is `—` on a fresh token, a date once exercised — either way it's
# a single whitespace-separated field, so $5 is always EXPIRES. (Header-
# position parsing is fragile because the em-dash `—` is multi-byte in
# UTF-8, which shifts byte-based substring math off tabwriter's columns.)
# Date math differs by platform (GNU `date -d` vs BSD `date -j`).
expires_raw=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-claude-code-/ {print $5; exit}')
if [ -n "$expires_raw" ]; then
  # Take just the YYYY-MM-DD portion (strip any T..Z suffix)
  expires_date=${expires_raw%%T*}
  # Force a fully-specified time — BSD `date -j -f '%Y-%m-%d'` silently
  # retains the current local HH:MM:SS for the missing components, which
  # adds up to a day off depending on when the test runs.
  if days_until=$(date -d "$expires_date 00:00:00" +%s 2>/dev/null); then
    now_s=$(date -u +%s)
  elif days_until=$(date -j -f '%Y-%m-%d %H:%M:%S' "$expires_date 00:00:00" +%s 2>/dev/null); then
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

### [T2.11] Additive configure preserves non-CLI-managed Tiddly-URL entries

Headline behavior of the additive-configure rework: a user who set up `work_prompts` + `personal_prompts` for two Tiddly accounts must have those entries survive configure. The CLI writes the CLI-managed entries alongside them and reports which entries were preserved.

```bash
# Set up two non-CLI-managed prompts entries pointing at the Tiddly prompt server.
PAT_WORK_211=$(bin/tiddly tokens create "cli-mcp-test-2-11-work-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_-]+' | head -1)
PAT_PERSONAL_211=$(bin/tiddly tokens create "cli-mcp-test-2-11-personal-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_-]+' | head -1)
[ -n "$PAT_WORK_211" ] && [ -n "$PAT_PERSONAL_211" ] || { echo "FATAL: T2.11 token mint failed"; exit 1; }

# Fresh slate, then install two non-CLI-managed prompts entries.
bin/tiddly mcp remove claude-code 2>/dev/null || true
write_multi_entry_prompts "$PAT_WORK_211" "$PAT_PERSONAL_211"

out=$(bin/tiddly mcp configure claude-code 2>&1)
assert_no_plaintext_bearers "$out" "T2.11"
echo "$out"

unset PAT_WORK_211 PAT_PERSONAL_211
```
**Verify:**
- [ ] Exit 0
- [ ] Output contains `Preserved non-CLI-managed entries in claude-code:` followed by both `personal_prompts` and `work_prompts` (order-independent — any order is fine)
- [ ] `jq -e '.mcpServers.tiddly_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null` — canonical entry added
- [ ] `jq -e '.mcpServers.work_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null` — non-CLI-managed entry survives
- [ ] `jq -e '.mcpServers.personal_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null` — non-CLI-managed entry survives
- [ ] Output does NOT contain `consolidate` / `Consolidation required` (gate is gone)

### [T2.12] Canonical update-in-place — no churn on re-run

Re-running configure against a config that already has correct CLI-managed entries must not churn tokens or rewrite the entry. Under OAuth, existing PATs are validated and reused; under PAT auth, the login PAT is used (same as last run). Either way, the written canonical entries should be identical to what was there before — a regression that unnecessarily re-minted or rewrote tokens would change the bytes.

```bash
# First run: ensure a known-good configured state.
bin/tiddly mcp configure claude-code >/dev/null
pre_content_sha=$(jq -c '.mcpServers.tiddly_notes_bookmarks' "$CLAUDE_CODE_CONFIG" | SHA256 | awk '{print $1}')
pre_prompts_sha=$(jq -c '.mcpServers.tiddly_prompts'         "$CLAUDE_CODE_CONFIG" | SHA256 | awk '{print $1}')

# Second run: must not churn the canonical entries.
out=$(bin/tiddly mcp configure claude-code 2>&1)
assert_no_plaintext_bearers "$out" "T2.12"

post_content_sha=$(jq -c '.mcpServers.tiddly_notes_bookmarks' "$CLAUDE_CODE_CONFIG" | SHA256 | awk '{print $1}')
post_prompts_sha=$(jq -c '.mcpServers.tiddly_prompts'         "$CLAUDE_CODE_CONFIG" | SHA256 | awk '{print $1}')

# Record the OAuth-vs-PAT path so a reader of the run log can tell which
# code path actually fired — `Reused tokens:` under OAuth with still-valid
# PATs; absent under PAT auth (no "reuse" concept there, login PAT is used
# directly). Either path must be no-churn; this is a narrative note, not
# an assertion.
if echo "$out" | grep -F "Reused tokens:" >/dev/null; then
  report_test NOTE "T2.12 — outcome path" "OAuth reused existing PATs (validate-then-reuse)"
else
  report_test NOTE "T2.12 — outcome path" "PAT auth (login PAT rewritten into canonical entries)"
fi
```
**Verify:**
- [ ] Exit 0
- [ ] `$out` contains `Configured: claude-code` — no refusal, no mismatch warning
- [ ] `$out` does NOT contain any `unexpected URL` / `re-run with --force` refusal copy
- [ ] `[ "$pre_content_sha" = "$post_content_sha" ]` — `tiddly_notes_bookmarks` is byte-for-byte identical after re-run (no token churn, no rewrite)
- [ ] `[ "$pre_prompts_sha" = "$post_prompts_sha" ]` — same for `tiddly_prompts`

### [T2.13] `--force` overwrites a CLI-managed entry at a non-Tiddly URL

User hand-edited `tiddly_prompts` to point at a local dev URL. Default configure refuses; `--force` overwrites the entry and emits the per-entry "Forcing overwrite of …" stderr line.

```bash
# Seed a non-Tiddly URL on the canonical tiddly_prompts slot.
jq '.mcpServers.tiddly_prompts = {
      type: "http",
      url: "https://example.com/my-prompts",
      headers: {Authorization: "Bearer bm_user_pasted_xyz"}
    }' "$CLAUDE_CODE_CONFIG" > "$CLAUDE_CODE_CONFIG.tmp" && mv "$CLAUDE_CODE_CONFIG.tmp" "$CLAUDE_CODE_CONFIG"
chmod 0600 "$CLAUDE_CODE_CONFIG"

# Default refuses.
set +e
out_default=$(bin/tiddly mcp configure claude-code 2>&1); rc_default=$?
set -e

# --force proceeds. Split stdout/stderr so the routing assertion is meaningful.
stderr_tmp=$(mktemp)
set +e
stdout_force=$(bin/tiddly mcp configure claude-code --force 2>"$stderr_tmp"); rc_force=$?
set -e
stderr_force=$(cat "$stderr_tmp")
rm -f "$stderr_tmp"
assert_no_plaintext_bearers "$stdout_force" "T2.13-stdout"
assert_no_plaintext_bearers "$stderr_force" "T2.13-stderr"
```
**Verify default refusal:**
- [ ] `rc_default != 0`
- [ ] `out_default` contains `1 CLI-managed entry` (singular) and `has an unexpected URL`
- [ ] `out_default` names the mismatched entry: `tiddly_prompts → https://example.com/my-prompts`
- [ ] `out_default` contains `re-run with --force`
- [ ] Config still has the bad URL on disk (no write happened): `jq -e '.mcpServers.tiddly_prompts.url == "https://example.com/my-prompts"' "$CLAUDE_CODE_CONFIG" >/dev/null`

**Verify `--force` overwrite:**
- [ ] `rc_force == 0`
- [ ] `stderr_force` contains `Forcing overwrite of tiddly_prompts (currently https://example.com/my-prompts)` — channel-specific (stderr, not stdout)
- [ ] `stdout_force` contains `Configured: claude-code`
- [ ] Canonical URL restored: `jq -e '.mcpServers.tiddly_prompts.url' "$CLAUDE_CODE_CONFIG" | grep -F -- "$TIDDLY_PROMPT_MCP_URL" >/dev/null`

```bash
# Restore clean state for subsequent phases.
bin/tiddly mcp remove claude-code 2>/dev/null || true
bin/tiddly mcp configure claude-code >/dev/null
assert_auth_still_working
```

```bash
assert_auth_still_working
```

---

## Phase 3: Dry-run

`phase "Phase 3: Dry-run"`. Nothing here mutates config files or server state.

### [T3.1] Dry-run — Claude Code user scope + PAT-auth advisory (if PAT auth)
```bash
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
# IMPORTANT: redirect stdout to a file, not a shell var. The dry-run dumps
# the entire existing ~/.claude.json into the Before: block, which for a
# real user's config is easily 100 KB+ / thousands of lines. Capturing via
# `$(cmd)` then echoing+grepping that var is flaky at this size. Assertions
# below must grep the file directly.
bin/tiddly mcp configure claude-code --dry-run > /tmp/t31_stdout 2> /tmp/t31_stderr
```
**Verify (assertions must grep /tmp/t31_stdout, not a captured shell var):**
- [ ] Exit 0
- [ ] `grep -q '^--- claude-code ---$' /tmp/t31_stdout`
- [ ] `grep -q '^File: ' /tmp/t31_stdout`
- [ ] `grep -q '^\(Before:\|After:\|(new file)\)' /tmp/t31_stdout` (Before/After sections or new-file marker)
- [ ] `grep -q 'tiddly_notes_bookmarks' /tmp/t31_stdout` and `grep -q 'tiddly_prompts' /tmp/t31_stdout`
- [ ] **If current auth is PAT (not OAuth):** `grep -q 'Using your current token for MCP servers' /tmp/t31_stderr`
- [ ] **If current auth is OAuth:** no such advisory expected
- [ ] `assert_unchanged T3.1 "$CLAUDE_CODE_CONFIG" "$pre_sha"`
- [ ] No new tokens created: `tokens list` count unchanged before/after

### [T3.2] Dry-run — directory scope
```bash
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
cd "$TEST_PROJECT" && "$TIDDLY_BIN" mcp configure claude-code --scope directory --dry-run
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

### [T3.7] Dry-run on a URL-mismatch warns but does not abort

When a CLI-managed entry points at a non-Tiddly URL, a real run fails closed — but dry-run is tolerant: it emits a per-entry stderr warning alongside the diff, so users can preview both the mismatch and the intended write.

```bash
# Seed a non-Tiddly URL on the canonical tiddly_prompts slot.
jq '.mcpServers.tiddly_prompts = {
      type: "http",
      url: "https://example.com/my-prompts",
      headers: {Authorization: "Bearer bm_user_pasted_xyz"}
    }' "$CLAUDE_CODE_CONFIG" > "$CLAUDE_CODE_CONFIG.tmp" && mv "$CLAUDE_CODE_CONFIG.tmp" "$CLAUDE_CODE_CONFIG"
chmod 0600 "$CLAUDE_CODE_CONFIG"

pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
stderr_tmp=$(mktemp)
set +e
stdout=$(bin/tiddly mcp configure claude-code --dry-run 2>"$stderr_tmp"); rc=$?
set -e
stderr=$(cat "$stderr_tmp")
rm -f "$stderr_tmp"
assert_no_plaintext_bearers "$stdout" "T3.7-stdout"
assert_no_plaintext_bearers "$stderr" "T3.7-stderr"
```
**Verify:**
- [ ] `rc == 0` — dry-run never aborts on a mismatch
- [ ] `$stderr` contains `Warning: tiddly_prompts at https://example.com/my-prompts — real run will require --force` (channel-specific — NOT stdout)
- [ ] `$stdout` still contains the normal dry-run diff (`--- claude-code ---` banner, `Before:` / `After:` sections)
- [ ] `assert_unchanged T3.7 "$CLAUDE_CODE_CONFIG" "$pre_sha"` — no write

### [T3.8] Dry-run + `--force` shows overwrite in diff, suppresses the warning

`--force` is allowed under dry-run. The warning is suppressed because the diff IS the answer — users see exactly what the real-run overwrite would produce.

```bash
# (canonical tiddly_prompts still points at https://example.com/my-prompts from T3.7)
pre_sha=$(sha_of "$CLAUDE_CODE_CONFIG")
stderr_tmp=$(mktemp)
set +e
stdout=$(bin/tiddly mcp configure claude-code --dry-run --force 2>"$stderr_tmp"); rc=$?
set -e
stderr=$(cat "$stderr_tmp")
rm -f "$stderr_tmp"
assert_no_plaintext_bearers "$stdout" "T3.8-stdout"
assert_no_plaintext_bearers "$stderr" "T3.8-stderr"
```
**Verify:**
- [ ] `rc == 0`
- [ ] `$stderr` does NOT contain `real run will require --force` — warnings are suppressed under `--force`
- [ ] `$stderr` does NOT contain `Forcing overwrite of` — the "Forcing overwrite of X" log is non-dry-run only
- [ ] `$stdout` contains the canonical prompts URL (the overwrite target) so users can see what the real run would write
- [ ] `assert_unchanged T3.8 "$CLAUDE_CODE_CONFIG" "$pre_sha"` — dry-run still writes nothing

```bash
# Restore clean state for subsequent phases.
bin/tiddly mcp remove claude-code 2>/dev/null || true
bin/tiddly mcp configure claude-code >/dev/null
assert_auth_still_working
```


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

<!-- T5.3 removed — invalid --path handling covered by T1.5 (shared validator) -->

### [T5.4] Multi-entry rendered as multiple rows (regression guard for KAN-112)

Status must render non-CLI-managed Tiddly-URL entries as their own rows (not fold them under a single "prompts" node). This is the user-visible half of the additive-configure contract: `configure` preserves these entries, and `status` must make them visible so users know what they have.

```bash
PAT_WORK_54=$(bin/tiddly tokens create "cli-mcp-test-t54-work-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_-]+' | head -1)
PAT_PERSONAL_54=$(bin/tiddly tokens create "cli-mcp-test-t54-personal-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_-]+' | head -1)
[ -n "$PAT_WORK_54" ] && [ -n "$PAT_PERSONAL_54" ] || { echo "FATAL: T5.4 token mint failed"; exit 1; }

write_multi_entry_prompts "$PAT_WORK_54" "$PAT_PERSONAL_54"
out=$(bin/tiddly mcp status 2>&1)
```
**Verify (anchor on the trailing `(name)` suffix, not leading whitespace — `mcp status` prefixes tree rows with `│` (U+2502 box-drawing) which is not POSIX `[[:space:]]`):**
- [ ] `grep -F '(work_prompts)' <<<"$out"` finds at least one line
- [ ] `grep -F '(personal_prompts)' <<<"$out"` finds at least one line
- [ ] Neither name appears under "Other servers" (confirm by inspecting the section breakdown in `$out`)
- [ ] Both rows are under the claude-code prompts section (the `(name)` suffix appears after a `prompts` label)

```bash
# Additive-configure: the CLI-managed entry is added alongside the
# multi-entry setup; the user's work_prompts/personal_prompts are
# preserved. Clean up the T5.4-specific tokens afterward.
bin/tiddly mcp configure claude-code 2>/dev/null
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
assert_no_plaintext_bearers "$out" "T6.1"
echo "$out"
backup_path=$(echo "$out" | sed -n 's/.*Backed up previous config to \(.*\)$/\1/p' | head -1)
```
**Verify:**
- [ ] Exit 0
- [ ] Output contains `Removed tiddly_notes_bookmarks, tiddly_prompts from claude-code.`
- [ ] `[ -n "$backup_path" ]` and `[ -f "$backup_path" ]` — exact backup from this command exists
- [ ] `[ "$pre_sha" = "$(sha_of "$backup_path")" ]` — backup contains pre-remove state
- [ ] `jq -e '.mcpServers.tiddly_notes_bookmarks == null' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] `jq -e '.mcpServers.tiddly_prompts == null' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] Non-Tiddly keys preserved (diff `jq -r '.mcpServers | keys[]'` before-remove vs now; pre-remove had tiddly_*; now tiddly_* gone; everything else unchanged)
- [ ] Stderr may contain an orphan-token warning

### [T6.2] Remove Claude Code directory scope
```bash
cd "$TEST_PROJECT" && "$TIDDLY_BIN" mcp configure claude-code --scope directory
cd "$TEST_PROJECT" && "$TIDDLY_BIN" mcp remove claude-code --scope directory
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
- [ ] Output: `Removed tiddly_notes_bookmarks, tiddly_prompts from codex.`
- [ ] `$CODEX_CONFIG` has no `tiddly_*` entries

### [T6.4] Remove Claude Desktop
```bash
bin/tiddly mcp configure claude-desktop
bin/tiddly mcp remove claude-desktop
```
**Verify:**
- [ ] Output: `Removed tiddly_notes_bookmarks, tiddly_prompts from claude-desktop.`
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
assert_no_plaintext_bearers "$out_configure" "T6.7-configure"
echo "$out_configure"
out_remove=$(bin/tiddly mcp remove claude-code --delete-tokens 2>&1)
assert_no_plaintext_bearers "$out_remove" "T6.7-remove"
echo "$out_remove"
```
**Verify:**
- [ ] `out_configure` contains `Created tokens:` followed by `cli-mcp-claude-code-*` names
- [ ] `out_remove` contains `Deleted tokens:` listing those exact names
- [ ] `bin/tiddly tokens list` confirms those tokens are gone

### [T6.8] Remove `--delete-tokens` preserves non-CLI-managed entries (headline canonical-only guard)

Under the canonical-name-only remove, non-CLI-managed entries (e.g. `work_prompts` from a multi-account setup) MUST survive remove entirely — both the config entries and their PATs. This test proves the split: two canonical CLI-minted tokens are revoked; the non-CLI-managed work/personal entries and their PATs stay intact.

```bash
# Fresh tokens. Two are attached to the CLI-managed entries; two more are attached to user-managed work/personal entries.
PAT_CONTENT_68=$(bin/tiddly tokens create "cli-mcp-test-6-8-content-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_-]+' | head -1)
PAT_PROMPTS_68=$(bin/tiddly tokens create "cli-mcp-test-6-8-prompts-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_-]+' | head -1)
PAT_WORK_68=$(bin/tiddly tokens create "cli-mcp-test-6-8-work-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_-]+' | head -1)
PAT_PERSONAL_68=$(bin/tiddly tokens create "cli-mcp-test-6-8-personal-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_-]+' | head -1)
for v in PAT_CONTENT_68 PAT_PROMPTS_68 PAT_WORK_68 PAT_PERSONAL_68; do
  eval "[ -n \"\$$v\" ]" || { echo "FATAL: token mint failed ($v)"; exit 1; }
done

# Install the user's non-CLI-managed entries first, then configure to add the
# CLI-managed ones alongside (via jq — we need specific PAT values on the
# canonical entries, not whatever configure happens to mint).
bin/tiddly mcp remove claude-code 2>/dev/null || true
write_multi_entry_prompts "$PAT_WORK_68" "$PAT_PERSONAL_68"
jq --arg content "$PAT_CONTENT_68" --arg prompts "$PAT_PROMPTS_68" --arg curl "$TIDDLY_CONTENT_MCP_URL" --arg purl "$TIDDLY_PROMPT_MCP_URL" \
  '.mcpServers.tiddly_notes_bookmarks = {type:"http", url:$curl, headers:{Authorization:("Bearer "+$content)}}
   | .mcpServers.tiddly_prompts       = {type:"http", url:$purl, headers:{Authorization:("Bearer "+$prompts)}}' \
  "$CLAUDE_CODE_CONFIG" > "$CLAUDE_CODE_CONFIG.tmp" && mv "$CLAUDE_CODE_CONFIG.tmp" "$CLAUDE_CODE_CONFIG"
chmod 0600 "$CLAUDE_CODE_CONFIG"

before=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-test-6-8-/ {print $1}' | sort)
echo "Tokens before remove: $before"

out=$(bin/tiddly mcp remove claude-code --delete-tokens 2>&1)
assert_no_plaintext_bearers "$out" "T6.8"
echo "$out"

# Compute post-state of each token: the CLI-managed ones should be gone; the
# user-managed ones should survive. Names-based match rather than IDs.
after_content=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-test-6-8-content-/ {print $1}' | head -1)
after_prompts=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-test-6-8-prompts-/ {print $1}' | head -1)
after_work=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-test-6-8-work-/ {print $1}' | head -1)
after_personal=$(bin/tiddly tokens list 2>/dev/null | awk '/cli-mcp-test-6-8-personal-/ {print $1}' | head -1)

unset PAT_CONTENT_68 PAT_PROMPTS_68 PAT_WORK_68 PAT_PERSONAL_68
```
**Verify:**
- [ ] Exit 0
- [ ] `out` contains `Removed tiddly_notes_bookmarks, tiddly_prompts from claude-code.`
- [ ] `out` contains `Deleted tokens:` listing BOTH `cli-mcp-test-6-8-content-*` AND `cli-mcp-test-6-8-prompts-*` token names (and ONLY those — the work/personal tokens must NOT appear)
- [ ] `[ -z "$after_content" ]` and `[ -z "$after_prompts" ]` — CLI-managed PATs revoked server-side
- [ ] `[ -n "$after_work" ]` and `[ -n "$after_personal" ]` — user-managed PATs survive (canonical-only revocation)
- [ ] `jq -e '.mcpServers.work_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null` — non-CLI-managed config entry survives
- [ ] `jq -e '.mcpServers.personal_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null` — non-CLI-managed config entry survives
- [ ] `jq -e '.mcpServers.tiddly_notes_bookmarks == null' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] `jq -e '.mcpServers.tiddly_prompts == null' "$CLAUDE_CODE_CONFIG" >/dev/null`

### [T6.8b] Shared-PAT consolidated warning — one line naming all retained entries

Shared-PAT scenario: a CLI-managed entry (being revoked) and one or more non-CLI-managed entries (retained) reference the same PAT. The new consolidated warning fires one line per CLI-managed entry being revoked, listing every retained entry that shares its PAT (sorted alphabetically).

```bash
# Build state manually so each entry's PAT is predictable:
#   - tiddly_notes_bookmarks: a DISTINCT PAT (must NOT appear in the
#     shared-PAT warning — this is the point of the test)
#   - tiddly_prompts (revoke target): PAT_SHARED
#   - work_prompts (retained, non-CLI-managed): PAT_SHARED
#   - personal_prompts (retained, non-CLI-managed): PAT_SHARED
# Only the canonical prompts entry + the two non-CLI-managed entries
# should share the PAT. The canonical content entry has its own PAT and
# must be listed nowhere in the shared-PAT warning.
bin/tiddly mcp remove claude-code 2>/dev/null || true
PAT_CONTENT=$(bin/tiddly tokens create "cli-mcp-test-shared-content-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_-]+' | head -1)
PAT_SHARED=$(bin/tiddly tokens create "cli-mcp-test-shared-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_-]+' | head -1)
[ -n "$PAT_CONTENT" ] && [ -n "$PAT_SHARED" ] || { echo "FATAL: T6.8b token mint failed"; exit 1; }

# Write the four-entry config directly.
[ -f "$CLAUDE_CODE_CONFIG" ] || echo "{}" > "$CLAUDE_CODE_CONFIG"
jq --arg curl "$TIDDLY_CONTENT_MCP_URL" --arg purl "$TIDDLY_PROMPT_MCP_URL" \
   --arg content "$PAT_CONTENT" --arg shared "$PAT_SHARED" \
   '.mcpServers = (.mcpServers // {})
    | .mcpServers.tiddly_notes_bookmarks = {type:"http", url:$curl, headers:{Authorization:("Bearer "+$content)}}
    | .mcpServers.tiddly_prompts         = {type:"http", url:$purl, headers:{Authorization:("Bearer "+$shared)}}
    | .mcpServers.work_prompts           = {type:"http", url:$purl, headers:{Authorization:("Bearer "+$shared)}}
    | .mcpServers.personal_prompts       = {type:"http", url:$purl, headers:{Authorization:("Bearer "+$shared)}}' \
   "$CLAUDE_CODE_CONFIG" > "$CLAUDE_CODE_CONFIG.tmp" && mv "$CLAUDE_CODE_CONFIG.tmp" "$CLAUDE_CODE_CONFIG"
chmod 0600 "$CLAUDE_CODE_CONFIG"

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

unset PAT_CONTENT PAT_SHARED
```
**Verify:**
- [ ] `rc == 0`
- [ ] `$stderr` contains `Warning: token from tiddly_prompts is also used by personal_prompts, work_prompts (still configured); revoking will break those bindings.` — single consolidated line (channel-specific — NOT stdout). Retained names comma-joined, sorted alphabetically (`personal_prompts` before `work_prompts`).
- [ ] `$stderr` does NOT name `tiddly_notes_bookmarks` in the shared-PAT warning — the canonical content entry has a distinct PAT and is NOT sharing with the revoke target.
- [ ] `$stdout` contains `Deleted tokens:` (the CLI-managed prompts PAT was revoked as requested)
- [ ] Prompts gone: `jq -e '.mcpServers.tiddly_prompts == null' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] Content retained: `jq -e '.mcpServers.tiddly_notes_bookmarks' "$CLAUDE_CODE_CONFIG" >/dev/null`
- [ ] Non-CLI-managed entries survive: `jq -e '.mcpServers.work_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null` and `jq -e '.mcpServers.personal_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null`

> NOTE: T6.8b leaves `$CLAUDE_CODE_CONFIG` with work_prompts / personal_prompts carrying a now-revoked PAT (exactly the breakage the warning predicted) and tiddly_notes_bookmarks carrying `PAT_CONTENT`. T6.9 reconfigures claude-code from scratch. Don't add tests between T6.8b and T6.9 that depend on those PATs working.

### [T6.8c] `--delete-tokens` informational note when PAT doesn't match any CLI-minted token

A canonical entry whose PAT was not created by the CLI (e.g. a user manually pasted a PAT from the Settings UI into the canonical slot) produces no deletion — but the user must see a per-entry note naming the specific entry so they understand why. Plan-specified wording: `Note: no CLI-created token matched the token attached to <entry>; nothing was revoked. Manage tokens at https://tiddly.me/settings.`

```bash
bin/tiddly mcp remove claude-code 2>/dev/null || true

# Install a canonical tiddly_prompts entry with a PAT that was created via
# `tokens create` (plaintext bm_* value) but has a NAME that doesn't match
# the cli-mcp- pattern the CLI revokes. Using tokens create lets us get a
# valid PAT; using a non-cli-mcp- NAME prevents DeleteTokensByPrefix from
# matching it.
PAT_MANUAL=$(bin/tiddly tokens create "manual-test-pat-$(openssl rand -hex 3)" 2>&1 | grep -oE 'bm_[A-Za-z0-9_-]+' | head -1)
[ -n "$PAT_MANUAL" ] || { echo "FATAL: T6.8c token mint failed"; exit 1; }

# Configure claude-code normally (both CLI-managed entries land), then
# overwrite tiddly_prompts' PAT with the manually-named token.
bin/tiddly mcp configure claude-code >/dev/null
jq --arg pat "$PAT_MANUAL" \
  '.mcpServers.tiddly_prompts.headers.Authorization = "Bearer "+$pat' \
  "$CLAUDE_CODE_CONFIG" > "$CLAUDE_CODE_CONFIG.tmp" && mv "$CLAUDE_CODE_CONFIG.tmp" "$CLAUDE_CODE_CONFIG"
chmod 0600 "$CLAUDE_CODE_CONFIG"

stderr_tmp=$(mktemp)
set +e
stdout=$(bin/tiddly mcp remove claude-code --servers prompts --delete-tokens 2>"$stderr_tmp"); rc=$?
set -e
stderr=$(cat "$stderr_tmp")
rm -f "$stderr_tmp"
assert_no_plaintext_bearers "$stdout" "T6.8c-stdout"
assert_no_plaintext_bearers "$stderr" "T6.8c-stderr"
echo "--- stdout ---"; echo "$stdout"
echo "--- stderr ---"; echo "$stderr"

# Clean up the manually-named token we created.
manual_id=$(bin/tiddly tokens list 2>/dev/null | awk '/manual-test-pat-/ {print $1; exit}')
[ -n "$manual_id" ] && bin/tiddly tokens delete "$manual_id" --force 2>/dev/null
unset PAT_MANUAL manual_id
```
**Verify:**
- [ ] `rc == 0`
- [ ] `$stdout` contains `Note: no CLI-created token matched the token attached to tiddly_prompts; nothing was revoked. Manage tokens at https://tiddly.me/settings.` (stdout, not stderr — it's an outcome report, not a warning)
- [ ] `$stdout` does NOT contain `Deleted tokens:` — nothing got deleted

### [T6.8d] Orphan-warning filter excludes tokens still referenced by retained entries

Without `--delete-tokens`, the orphan-warning path fires. But tokens whose PAT is still in active use by a retained non-CLI-managed entry (e.g. a `work_prompts` entry keeping a cli-mcp-* token referenced) must be EXCLUDED from the warning — they're not orphans, they're in active use.

```bash
bin/tiddly mcp remove claude-code 2>/dev/null || true

# Configure normally so the CLI-managed entries have freshly-minted
# cli-mcp-* PATs.
bin/tiddly mcp configure claude-code >/dev/null

# Capture the PAT on tiddly_prompts and paste it into a new work_prompts
# entry. After remove, that token will still be server-side (it's a valid
# CLI-minted token) AND still referenced by a retained entry — the filter
# must NOT report it as a potential orphan.
prompts_pat=$(jq -r '.mcpServers.tiddly_prompts.headers.Authorization' "$CLAUDE_CODE_CONFIG" | sed 's/^Bearer //')
jq --arg url "$TIDDLY_PROMPT_MCP_URL" --arg pat "$prompts_pat" \
   '.mcpServers.work_prompts = {type:"http", url:$url, headers:{Authorization:("Bearer "+$pat)}}' \
   "$CLAUDE_CODE_CONFIG" > "$CLAUDE_CODE_CONFIG.tmp" && mv "$CLAUDE_CODE_CONFIG.tmp" "$CLAUDE_CODE_CONFIG"
chmod 0600 "$CLAUDE_CODE_CONFIG"
unset prompts_pat

stderr_tmp=$(mktemp)
stdout=$(bin/tiddly mcp remove claude-code 2>"$stderr_tmp")
stderr=$(cat "$stderr_tmp")
rm -f "$stderr_tmp"
assert_no_plaintext_bearers "$stdout" "T6.8d-stdout"
assert_no_plaintext_bearers "$stderr" "T6.8d-stderr"
```
**Verify:**
- [ ] `$stderr` does NOT contain `Warning: PATs created for claude-code may still exist:` that names the prompts token — it's still in use by `work_prompts`, not an orphan. Either the warning doesn't fire at all (if content's token is the only true orphan and it'd mean a warning for a different name), or it fires only for the content token.
- [ ] The token attached to `work_prompts` is still present on the server: `bin/tiddly tokens list 2>/dev/null | grep -F 'cli-mcp-claude-code-prompts'` finds something
- [ ] `jq -e '.mcpServers.work_prompts' "$CLAUDE_CODE_CONFIG" >/dev/null` — non-CLI-managed entry survives the remove

> NOTE: T6.8d leaves `work_prompts` alive in the config. T6.9 runs configure + remove without arguments, which should not interact with work_prompts — but restore state yourself if you add intervening tests.

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

### [T6.10] Remove idempotent — second run hits the no-op path

Re-running remove after the canonical entries are already gone must not fail and must report accurately. The CLI distinguishes "removed something" from "nothing to remove" and prints the no-op message rather than a misleading "Removed …" line.

```bash
out=$(bin/tiddly mcp remove claude-code 2>&1)  # already removed in T6.9
```
**Verify:**
- [ ] Exit 0
- [ ] `$out` contains `No CLI-managed entries found in claude-code.`
- [ ] `$out` does NOT contain `Removed tiddly_notes_bookmarks` — nothing was actually removed; the old wording would be a lie
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
cd "$TEST_PROJECT" && "$TIDDLY_BIN" skills configure claude-code --scope directory
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
- [ ] Output contains either `codex: Configured N skill(s) to ~/.agents/skills` OR `codex: No skills to configure.` (mirrors T7.1's branching — the `~/.agents/skills` path is only printed when at least one skill matches)

### [T7.4] Codex, directory scope
```bash
cd "$TEST_PROJECT" && "$TIDDLY_BIN" skills configure codex --scope directory
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
bin/tiddly mcp configure claude-code --servers "" 2>&1 | tee /tmp/t87_out >/dev/null
```
**Verify:**
- [ ] Exit non-zero
- [ ] `grep -F -- '--servers flag requires at least one value: content, prompts' /tmp/t87_out` finds the error — **note the `--` option terminator**; without it grep parses `--servers …` as its own flags and fails

### [T8.8] Tool not installed (skip if all tools detected)
```bash
bin/tiddly mcp configure claude-desktop   # only if claude-desktop is NOT detected
```
**Verify (only applies when tool missing):**
- [ ] Exit non-zero
- [ ] Error: `claude-desktop is not installed on this system`

### [T8.9] Claude Desktop + skills `--scope directory`
```bash
bin/tiddly skills configure claude-desktop --scope directory 2>&1 | tee /tmp/t89_out >/dev/null
```
**Verify:**
- [ ] Exit non-zero
- [ ] `grep -F -- '--scope directory is not supported by: claude-desktop' /tmp/t89_out` finds the error — **note the `--` option terminator** (same reason as T8.7)

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

`phase "Phase 10: Final cleanup"`. This is the **only** place the harness's destructive teardown runs. The per-call EXIT trap is failure-only by design (see § Execution model and `lib.sh` § "EXIT trap handler"); without this explicit Phase 10 call, the harness would leak `$BACKUP_DIR` / `$TEST_PROJECT` / `/tmp/tiddly-test-state.env` at session end.

`final_teardown` is **fail-closed**: it returns non-zero and preserves all artifacts (`$BACKUP_DIR`, state file, live report) if any cleanup/restore step fails, so the engineer always has the original configs to recover from. The common failure modes it catches: OAuth session dead at Phase 10 (can't revoke this-run's `cli-mcp-*` tokens), a config `cp` fails (e.g. disk full, permission flipped), or the report copy to the retained location fails.

```bash
source cli/test_procedure/per_call.sh

# Finalize the live report with run summary counters BEFORE teardown —
# final_teardown() copies the report to the retained location and then
# deletes $BACKUP_DIR; report_summary needs $REPORT still present.
report_summary

# Full session-end teardown. Returns 0 only on complete success; returns
# non-zero (with actionable recovery instructions printed to stderr) on
# any failure, leaving $BACKUP_DIR/state intact for manual recovery.
if ! final_teardown; then
    # On abort, the user-facing recovery instructions have already been
    # printed by final_teardown. Exit non-zero so the shell's EXIT trap
    # fires with rc!=0 — on_exit's crash-recovery path will do a
    # best-effort re-restore against the still-preserved $BACKUP_DIR.
    exit 1
fi

echo "Done."
```

If `final_teardown` aborts, the failure message includes the exact `cp` commands needed to restore each config manually. The trap's subsequent crash-recovery pass is a second layer of defense — by that point `$BACKUP_DIR` is still on disk so restores can retry.

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

## Reference: Config Shapes (one-liner each)

Tests assert the real shape with `jq -e` / `tomllib`; if you need to read a live file, see the existing configs on disk.

- **Claude Desktop** (JSON): `.mcpServers.<name>.{command:"npx", args:["mcp-remote", URL, "--header", "Authorization: Bearer bm_..."]}`
- **Claude Code — user** (JSON, `~/.claude.json`): `.mcpServers.<name>.{type:"http", url:URL, headers:{Authorization:"Bearer bm_..."}}`
- **Claude Code — directory** (JSON, same file): same shape nested under `.projects["<path>"].mcpServers.<name>`
- **Codex** (TOML, `~/.codex/config.toml` or `.codex/config.toml` for directory scope): `[mcp_servers.<name>]` with `url = "..."` + `[mcp_servers.<name>.http_headers]` with `Authorization = "Bearer bm_..."`

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
