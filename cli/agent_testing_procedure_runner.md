# Runner prompt — agent_testing_procedure.md

Paste this into a fresh agent session to execute `cli/agent_testing_procedure.md`. The runner expects a first-time-through mindset: execute the procedure AND surface everything about the procedure itself that's unclear, inconsistent with reality, or could be improved.

---

You are going to execute the test procedure at `cli/agent_testing_procedure.md` against the local dev backend. This is the FIRST end-to-end run. Your job is both to execute the procedure AND to surface anything about the procedure itself that's unclear, inconsistent with reality, or could be improved.

## Before you start anything

1. Read the whole procedure top to bottom. Do not skim. In particular:
   - "CRITICAL: Never Echo Token Values" section (read this first)
   - "Reporting Protocol" section
   - "Safety Model" section
   - "Live Run Report" section
   - "Prerequisites" and "Platform Detection & Setup"

2. After reading, before running ANY command, reply with:
   - A one-paragraph summary of what the procedure is designed to verify.
   - A list of assumptions the procedure makes about the environment (backend URL, auth state, installed tools, data fixtures, dev-mode status, etc.).
   - Any clarifying questions you need answered BEFORE starting. If you find yourself inferring an answer, stop and ask instead — guesses are how destructive commands go wrong. Examples of questions worth asking:
     * "The plan assumes prompts tagged `python` + `skill` exist in the dev DB — should I seed test data first, or is T7.6/T7.7 expected to SKIP?"
     * "Phase 0 runs `mcp remove` against my real configs before backing them up — I see the backup step is BEFORE the remove, but can you confirm you've verified those backups are taking correctly on your machine?"
     * "The `TIDDLY_API_URL` in the plan's example is localhost:8000 — is your dev backend running there now?"

3. Wait for me to answer your questions and explicitly tell you to start. Do not start Phase 0 on your own initiative.

## When running

Execute one phase at a time. After EACH phase:

1. Post a short status update in this format:

   ```
   ## Phase N report
   - Tests passed: [count]
   - Tests failed/mismatched: [count] + their IDs
   - Tests skipped: [count] + reason
   - Plan-feedback findings: [see below]
   ```

2. Under **Plan-feedback findings**, list anything about the PROCEDURE itself (not the product) that you noticed while running that phase. This is where your first-run-through observations go. Categorize each:
   - **plan-bug** — the procedure says X, the CLI actually does Y (exact string mismatch, wrong file path, outdated command, etc.)
   - **unclear** — the procedure left you uncertain how to proceed; you had to make a judgment call
   - **friction** — the procedure worked but was awkward (extra manual step, flaky platform-dependent behavior, implicit assumption)
   - **improvement** — a concrete suggestion that would help the next run (e.g. "T2.8 should also check the EXPIRES value is not in the past")

   For each: quote the exact bullet / line / command from the plan, describe what happened, and propose the change. Do NOT edit the plan yourself.

3. If a `report_mismatch` fires during execution, per the Reporting Protocol you stop the run and wait. Do not try to recover.

4. Pause between phases for me to acknowledge before starting the next one. On long phases you can stream status mid-phase if useful, but always explicitly wait after the phase-report message before moving on.

## What you must NOT do

- Do NOT echo Bearer values, raw config contents, or plaintext tokens into your responses OR into the live report. If you catch yourself typing `bm_` followed by anything other than `REDACTED`, stop and flag it as a plan-bug (the procedure must never emit a path that exposes tokens).
- Do NOT adapt silently when the procedure doesn't match reality. Flag every drift as plan-feedback, even minor ones. The whole point of this run is to catch drift.
- Do NOT skip the engineer-manual steps (OAuth re-login in T9.3). Block and ask me to complete them.
- Do NOT run destructive actions outside the procedure (no `rm -rf` beyond what the procedure specifies, no `git reset`, no force pushes).
- Do NOT edit the plan file itself — your findings are input for the next iteration, not direct edits.

## Final deliverable

When Phase 10 completes (or the run stops early), post:

1. The retained report path (should be `<repo-root>/test-run-<ts>.md`).
2. A consolidated list of all plan-feedback findings across phases, grouped by category (plan-bug / unclear / friction / improvement), sorted by severity.
3. A one-paragraph honest assessment: did the procedure do what it claimed? What was the biggest surprise?
