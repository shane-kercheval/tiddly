# M6a cutover run sheet (Auth0 → Clerk, production)

**Date**: 2026-07-14
**Status**: Proposed operational contract — this sheet, its companion [`2026-07-14-m6b-decommission-runsheet.md`](2026-07-14-m6b-decommission-runsheet.md), and the matching migration-plan edits are all in **PR #155**. **Executable only after #155 is approved/merged** and the held M3 flip PR (#150) is reviewed; nothing past the read-only A1 pre-check runs before then.
**Governs**: the production cutover step of [`2026-07-02-clerk-migration.md`](2026-07-02-clerk-migration.md) (Milestone 6, half A). This is the operational run sheet; the plan is the design source of truth. The matching plan edits are **included in the same PR (#155)** so the two documents stay consistent — see "Plan-sync (landed in this PR)" at the end.

---

## What M6a does (scope — read this first)

M6a moves **web and CLI authentication** to Clerk in production. It does **not** move MCP to Clerk OAuth:

- **Web** and **CLI** flip to Clerk-issued tokens.
- **Existing PAT/bearer MCP integrations remain operational and unchanged** — they keep using Tiddly's own PAT system (or a forwarded bearer), and the backend already accepts Clerk-issued OAuth tokens (merged in M4, commit `37d8250`). The MCP servers are dumb bearer pass-throughs; nothing about them changes at cutover.
- **MCP OAuth discovery / DCR / paste-the-URL connectors** are **M5**, shipped **after** cutover. They are additive; their value is gated on users being in Clerk (which is this cutover), but there is no requirement that they be live at the moment of the flip.
- **iOS** keeps authenticating via Auth0 through the dual-accept window; it resolves to the same accounts. iOS decommission is M6b.

So the M6a verification bar for MCP is **"existing bearer/PAT integrations still work,"** not "OAuth connectors work."

---

## Standing rules for the whole run

**Legend — who executes each step:**
- **[C]** — the agent can run it locally: read-only checks, code/tests, or a scripted `clerk api` / `curl` / `psql` sequence against non-secret targets. State-changing ones are shown and approved first.
- **[S]** — requires the operator (Shane): an Auth0 dashboard/Management-API action, a Railway secret, a Clerk **dashboard-only** toggle, a browser-based verification, or a business go/no-go.
- **[C→S]** — the agent prepares/drafts the exact command or artifact; the operator approves and runs it (or approves the agent running it).

**Credential custody (hard rule).** The production DB URL and `CLERK_SECRET_KEY` are **not** routed through the agent or this chat. For every step needing them (data hygiene, import), the operator runs the prepared command in a controlled terminal or one-shot job with secrets injected from the secret manager. The agent prepares the command and inspects the **non-secret** report output only.

**Evidence — the cutover record.** Maintain a single cutover record (paste-in log) capturing, as each step completes: fresh-export SHA-256, import dry-run + execute reports, Clerk user IDs created, DB reconciliation result (must be zero discrepancy), env-flag values before/after each change, Railway deploy SHA, CLI release tag + commit SHA, each go/no-go sign-off, and any rollback action taken. Template at the bottom of this sheet.

**Go/no-go + rollback.** Every phase has an exit criterion. Before the frontend deploy (E2), no *web-frontend* change has shipped — existing users still see the Auth0 build — but backend state **has** changed (freeze, import, Clerk JIT, `delete_self`, webhook), so recovery is a deliberate procedure, not a no-op. After E2, rollback is a revert of the flip merge on `main` (Railway redeploys the Auth0 frontend) **plus** re-enabling Auth0-path JIT-create. The full **pause-vs-abandon** split is in "Rollback contract" at the end.

---

## Pre-cutover preparation (done AHEAD of the live window — never inside it)

| # | Step | Who |
|---|------|-----|
| P1 | **Refresh `clerk-m3-flip`** onto current `main` (the M8 merge), run `make frontend-verify`, review the diff. Do not do branch reconciliation during the live cutover window. *(Done 2026-07-14: merged onto `main` clean, `make frontend-verify` **passed** — 3602 tests, lint + typecheck clean, and **pushed** — reflected in the held PR #150. Only its normal review remains.)* | **[C→S]** |
| P2 | **Determine the CLI release version** and run `make cli-release-check` green on the intended commit. The tag is pushed later (E4) against the post-flip `main` commit. | **[C→S]** |
| P3 | **Approve this run sheet** — rollback commands and go/no-go criteria agreed before any mutation. | **[S]** |
| P4 | **Confirm the iOS app actually sends `X-Request-Source: ios`** (coordinate with the iOS developer) **before** relying on it. If it's wrong, iOS traffic logs as `unknown`, and the soak signal (F5) and M6b's quiet-gate become unreadable — and nobody would notice until M6b. This is the open `[OPEN]` item in the iOS guide; close it now. | **[S]** |
| P5 | **Draft the direct-message comms** (content below under "Communications"). | **[C→S]** |

---

## Phase A — Deletion backend confirmed live in production (the M8 prerequisite)

`delete_self` stays **OFF** until the positive end-to-end proof in D3.

| # | Step | Who |
|---|------|-----|
| A1 | Confirm the **exact M8 build** is deployed via **two independent read-only proofs** — not just a healthy API: (i) the **Railway deployed commit SHA** for the API service, and (ii) a **production DB query** confirming the `deleted_identities` **table + migration `64e3641d3441`** are applied. `/health` alone is insufficient. Per the credential-custody rule, the agent prepares the read-only query; the **operator runs it** and shares the non-secret result. | **[C→S]** |
| A2 | Create the **production** Clerk webhook endpoint (`https://<prod-api>/webhooks/clerk`, event `user.deleted`) and capture its **signing secret** (`whsec_…`). | **[S]** (or **[C→S]** via `clerk api`) |
| A3 | Set `CLERK_WEBHOOK_SIGNING_SECRET` on the Railway **API** service to A2's secret; redeploy/restart so it takes effect. (Prod secret — operator owns; agent supplies the exact `railway` command.) | **[S]** |
| A4 | Run the focused forgery pen test against prod: `SECURITY_TEST_API_URL=https://<prod-api> uv run pytest backend/tests/security/deployed/test_webhook_penetration.py` → **400** on all three cases. This proves the endpoint *rejects* forgeries; it does **not** prove prod holds the *correct* secret (a wrong secret also 400s everything) — that proof is D3. | **[C]** |

**Exit A:** endpoint live, secret configured, all forgery cases 400, deploy SHA + table recorded.

---

## Phase B — Freeze Auth0, then capture the authoritative source of truth

**Order matters: freeze → verify the freeze → *then* take the export.** Otherwise the export can go stale between capture and use.

| # | Step | Who |
|---|------|-----|
| B1 | Confirm the **Clerk plan** decision as it stands: launch on **Clerk's free plan** (accept the 7-day session cap → ~weekly re-login; Clerk branding). This is the Clerk billing plan, **not** a Tiddly subscription tier — all beta users remain on Tiddly **Pro**. Upgrade to Clerk Pro here only if that decision has flipped. | **[S]** |
| B2 | **Apply the Auth0 freeze** — disable **DB-connection sign-up** and add an **Auth0 Action that denies first-time social logins**. **Do NOT disable the social connection itself** — that would break *existing* Google/iOS logins. The enforced invariant is *"no new Auth0 identity can authenticate into Tiddly or create a Tiddly row,"* not necessarily "Auth0 records no provider identity" (a post-login deny may still mint a provider record; the Tiddly boundary is what we hold). | **[S]** |
| B3 | **Verify the freeze immediately** (before B4): (a) a brand-new DB signup **fails**; (b) a first-time social login **cannot reach Tiddly**; (c) an **existing** social/iOS user **can still sign in**. **Caveat:** test (b) may cause Auth0 to mint a provider identity record even though the Action denies Tiddly access. **Before B4, either delete that freeze-test identity or record its Auth0 id** so it is accounted for in the import **dry-run's expected *skipped* set** — the import script has no skip-list flag; a no-DB-row identity is classified as skipped, and this is a human reconciliation record, not a CLI option. Otherwise it silently enters the authoritative export and shows up as an unexplained no-DB-row identity. | **[S]** + **[C]** for the API-level checks |
| B4 | Take a **fresh Auth0 bulk export** (the M2-era export was rehearsal input only). **Checksum it** (SHA-256 into the cutover record). Hand the file path to the operator's terminal for the import. *(Confirm the B3 freeze-test identity was removed or is accounted for in the dry-run's expected skipped set. The JIT-block canary — F2 — is deliberately **not** created yet, so it never appears in this authoritative export.)* | **[S]** |
| B5 | Send the **direct-message comms** (see "Communications"). | **[S]** |

**Exit B:** freeze verified in all three directions; fresh export captured + checksummed.

---

## Phase C — Backup, data hygiene, import (must reconcile to zero before the flip)

| # | Step | Who |
|---|------|-----|
| C0 | **Take a restorable production DB snapshot.** Capture pre-change user/linkage counts. Record the restore + rerun procedure in the cutover record. This is the deep rollback point for the destructive C1 and the import. | **[S]** |
| C1 | **Production data hygiene** (from the M2 rehearsal): delete the **3 dead user rows** (Auth0 identities gone), and create **2 Clerk operator users** for the deployed-security-test PAT accounts, hand-linking each row's `external_auth_id`. SQL + `clerk api`; agent drafts, operator runs with prod secrets injected. | **[C→S]** |
| C2 | **Import dry-run** (default — writes nothing): `PYTHONPATH=backend/src uv run python backend/scripts/clerk_import.py --export-file <B4> --database-url <prod-url>`. Operator runs; agent reviews the report. | **[C→S]** |
| C3 | **Import execute**: same command `+ --execute` (`--allow-existing` for the 2 operator accounts from C1). Then **rerun a fresh from-scratch dry-run** and require an entirely reconciled/idempotent result (zero discrepancy), in addition to the script's null-count verification. **Signed go/no-go recorded before proceeding to D1.** | **[C→S]** |

**Exit C:** DB snapshot taken; import executed; a fresh dry-run reconciles to zero; go/no-go signed.

**Rollback boundary note.** The import creates Clerk users one at a time *before* the single Postgres backfill transaction — Clerk and Postgres are **not** cross-system atomic. The script is deliberately idempotent (safe to rerun; it self-heals partial Clerk creation). If it fails mid-run: **do not** reopen sign-ups or flip; keep Auth0 serving; repair; rerun the dry-run to a clean state before `--execute` again.

---

## Phase D — Prove production's Clerk config end-to-end (frontend still on Auth0)

| # | Step | Who |
|---|------|-----|
| D1 | **Enable Clerk-path JIT-create** on prod (backend env flag, per M1 step 4). Safe now: the production frontend is still the Auth0 build until E2's merge deploys. | **[S]** |
| D2 | **Consent-aware smoke test** (does **not** repeat the M8 phantom-cache 451→rollback bug): create one operator test account on the prod Clerk instance; mint a session token; then, in order — `GET /consent/status` (consent-**exempt**, returns 200 and **commits** JIT provisioning) → submit consent → call an ordinary protected endpoint → **200** → **create a bookmark** (so D3's cascade proof is non-vacuous). | **[C]** |
| D3 | **Forgery-survival + positive-proof deletion** (reuses D2's account **and its content**): POST an *unsigned* forged `user.deleted` for its Clerk id → **400**; reuse its token → **200**; then **delete the account *through Clerk*** (`clerk api` — **not** a DB delete) → webhook delivery **200** → verify the row **and its bookmark** are gone, the tombstone is written, and a token minted before deletion now returns the terminal **"This account was deleted" 401**. This genuine signed 200 is the proof production and Clerk share the **correct** signing secret. | **[C]** |
| D4 | **Enable `user_settings.actions.delete_self` on production.** This is a **dashboard-only** setting (Dashboard → User & authentication → User model) — it is **not** in the config CLI schema, so there is no `clerk api`/`clerk config` command for it (ledger Q12). | **[S]** dashboard |

**azp caveat (important).** D2/D3 use a **Backend-API-minted** session token, which per the M0 spike carries **no `azp`** claim. So D2/D3 prove JWKS verification, claims, JIT-create, consent, webhook, cascade, tombstone, and stale-token handling — **but not the `azp` / authorized-parties check**. That is proved separately at the **browser-login gate (F0)**, post-deploy and pre-reopen. Do not describe the D-phase smoke as validating `azp`.

**Exit D:** consent-aware smoke green; positive-proof deletion green (correct secret confirmed); `delete_self` ON.

---

## Phase E — The flip (revised order: reopen Clerk sign-ups **last**)

| # | Step | Who |
|---|------|-----|
| E1 | **Disable Auth0-path JIT-create** (backend env flag) — closes window rule 2 in the backend *before* the new creation path is exposed. Existing Auth0 users still authenticate (dual-accept verify stays on); they simply can't JIT-create new rows, and all real users are already imported. | **[S]** |
| E2 | **Deploy the Clerk frontend**: merge the held, refreshed `clerk-m3-flip` PR into `main`. **The merge is the production deploy trigger** — highest-consequence step. | **[C→S]** |
| E3 | **Healthcheck + the `azp` browser-login gate (F0)** on the newly deployed frontend, **before** reopening sign-ups. | **[S]** + **[C]** |
| E4 | **Publish the CLI release**: `make cli-release-check` (P2, re-run on the post-flip commit) → tag the exact post-flip `main` commit `cli/vX.Y.Z` → `git push origin cli/vX.Y.Z` (triggers the GitHub Actions release pipeline, per `cli/README.md`) → monitor the workflow → verify assets/checksums → install the published binary. | **[C→S]** |
| E5 | **Reopen production Clerk sign-ups** (LAST) — `sign_up_mode: restricted` → open. This setting **is** in the config schema, so `clerk config patch --instance prod` / `clerk api` works (unlike D4). | **[C→S]** |

**Deliberate sign-up maintenance interval.** Between E2 (frontend deployed) and E5 (sign-ups reopened), the Clerk frontend exposes a sign-up path while the instance is still **restricted** — a would-be new user sees Clerk's *"Access restricted — Sign ups are currently disabled"* page (ledger Q16). This is intentional and acceptable at beta scale: no new account of either provider can be created during the riskiest sub-steps (the frontend flip and CLI release). **If E4's CI stalls**, this is an operator **decision point** — reopen sign-ups anyway or hold — not an indefinite outage.

**Exit E:** frontend healthy; azp gate passed; CLI released + installed-binary verified; sign-ups reopened.

---

## Phase F — Post-flip verification + soak

| # | Step | Who |
|---|------|-----|
| F0 | **`azp` browser-login gate** (run at E3 timing; listed here for completeness): an **imported existing** user completes a **real browser Clerk login**; confirm the token carries the expected production `azp` (`https://tiddly.me`) and an authenticated API request **succeeds**. This is the **only** test that exercises `azp` (D2/D3's Backend-API tokens have none). A wrong authorized-party setting would break **every** web login on flip day — catch it here, before reopening. | **[S]** |
| F1 | Verify **web login** (Clerk), **CLI login**, **existing PAT/bearer MCP integration still works unchanged** (NOT an OAuth connector — that's M5), **Chrome extension** (PAT — should be unaffected), and that an **iOS (Auth0) login and a web (Clerk) login by the same user land on the same account**. | **[S]** + **[C]** |
| F2 | **Auth0 JIT-block canary** (Management-API lifecycle — created **after** the B4 export so it never contaminates it): (1) create a disposable Auth0 **DB-connection** user via the **Management API** (an admin op — works despite disabled public sign-up); (2) obtain a **real signed token** for it **without** calling any Tiddly endpoint (so Auth0 can't provision a row); (3) with Auth0 JIT-create disabled (E1), call a protected Tiddly endpoint → require **401 + the JIT-disabled warning log**; (4) confirm **no Tiddly row** was created; (5) **delete the canary** from Auth0. | **[S]** for Auth0 Mgmt-API steps, **[C]** for the token→endpoint check |
| F3 | **Two-account, dual-UI deletion drill** (plan line 465 — the step that actually exercises the hosted-portal side door that made M8 a cutover prerequisite): provision **two** fresh **content-bearing** throwaway accounts (post-reopen); delete one through the **in-app `<UserProfile />`** and the other through the **hosted Account Portal**; verify webhook delivery + cascade + tombstone for **each**. (D3 proved only the `clerk api` path, never a UI.) | **[S]** + **[C]** |
| F4 | Run the **deployed security suite** against production: `make pen_tests` (needs `SECURITY_TEST_*` env). M6a is when production auth actually changes — run now, don't wait for M6b. | **[C]** |
| F5 | **Soak**: the Auth0-path log will not go silent (iOS continues). Watch for Auth0-path authentications from any `source` **other than `ios`** and fix-forward. Relies on P4's `X-Request-Source` confirmation; the CLI is a straggler class (old binaries keep working on Auth0 refresh tokens until M6b — the M6b cohort gate must cover CLI users, not just iOS). | **[C]** monitors, **[S]** decides |

**Exit F:** all logins verified; canary proves backend enforcement; both UI deletion paths cascade; deployed suite green; soak watch running.

---

## Communications (right-sized to ~11 known beta users — direct messages, not a broadcast email)

Cover this content by DM; format is informal:
- **All web users:** expect **one** re-login at cutover, and **weekly** re-authentication thereafter (Clerk free-plan session cap).
- **All CLI users:** **upgrade to the new release and complete a Clerk login before M6b.** An un-upgraded CLI keeps working on its Auth0 refresh token through the window, then **breaks at M6b** with no warning.
- **The one password user (the iOS engineer):** the old password does **not** carry to Clerk; sign in with the **emailed 6-digit code**, set a new password afterward if desired.
- **iOS users:** the current build keeps working on Auth0; migrate at the coordinated TestFlight cutover (M6b), not now.

---

## Window-era account-deletion policy — KEEP the manual Auth0 delete

During the dual-accept window, a user-requested account deletion:
1. Cascades the Clerk/Postgres side **immediately** via the webhook, and writes the tombstone (resurrection-safe on both identity columns).
2. **Also gets a manual delete in the Auth0 tenant.** Worklist = tombstones with a non-null `auth0_id`.

**Reconciliation cadence (owner: operator; weekly — without a cadence the 30-day reasoning is aspirational):**
1. Query tombstones with a non-null `auth0_id`.
2. Look up each identity in the Auth0 tenant.
3. Delete any that still exist.
4. Record the reconciliation (date, ids handled) in the cutover/window record.
5. Escalate any deletion approaching **30 days** old (the privacy-policy limit) so it is closed before the clause is breached.

**Why keep it (corrected reasoning).** This is **not** about resurrection (tombstones fully cover that) and **not** about an "immediate" promise. The privacy policy commits to deletion **"within 30 days"** (`frontend/src/content/prose/privacy.md:119`). The real hazard is that the **M6a→M6b window is unbounded** — gated on the external iOS team's independent release schedule with no stated deadline. If that window **exceeds 30 days**, a window-era deletion left to the M6b tenant-sweep would leave the user's Auth0 identity (and, for the one password user, a password hash) alive **past the documented 30-day commitment**. At beta deletion volume (~zero) the manual delete is near-free insurance against that.

**Judgment call retained for the operator.** If the window can be *guaranteed* short (≤ ~2–3 weeks, comfortably inside 30 days), the manual step's marginal value shrinks toward pure risk-acceptance. Dropping it *then* is legitimate but requires: a **hard maximum window duration**, a **documented privacy risk-acceptance**, a **reconciliation query** for window-era tombstones, and an **escalation** if M6b slips past the cap. **Default: keep the manual step** — simpler and safe regardless of window length.

---

## Rollback contract

Two distinct recovery modes — pick by whether you intend to **resume** the cutover or **unwind** it. Note the C0 DB snapshot alone does **not** undo Clerk users the import created before the Postgres backfill transaction (Clerk and Postgres are not cross-system atomic); unwinding those is an explicit decision, not an automatic restore.

**Pause-and-repair** (default when a step fails but you still intend to cut over): keep the freeze, the import, and the webhook in place; leave the production frontend on the Auth0 build (if E2 hasn't merged) or revert the E2 flip merge (if it has); fix the issue; rerun the affected dry-run/verification; resume. None of the retained freeze/import/webhook state needs undoing to pause.

**Abandon-cutover** (unwind). The clean unwind depends on how far you got — **E4 (the CLI binary release) is a rollback boundary**, because once users download the Clerk-authenticating binary you cannot un-distribute it.

*Common steps:* (1) disable `delete_self` (undo D4); (2) revert the E2 flip merge on `main` if merged (Railway redeploys the Auth0 frontend); (3) re-enable Auth0-path JIT-create (undo E1) and reopen Auth0 sign-ups (undo B2); (4) **if E5 already reopened Clerk sign-ups, re-restrict them** (`sign_up_mode → restricted`) — otherwise new Clerk identities keep being created while the Clerk frontend and JIT are being torn down; (5) **decide deliberately what to do with the Clerk identities the import created** — leave them dormant (harmless once the frontend is Auth0 again) or delete via `clerk api` — and whether to restore the C0 snapshot vs. retain the `external_auth_id` backfill (harmless under Auth0 auth, so usually retained); (6) record how cross-system Clerk creations were handled. The import never modified Auth0, so Auth0 needs no restore.

*Before E4:* web returns fully to Auth0; you may also disable Clerk-path JIT-create (undo D1), since no released client depends on it yet.

*After E4:* this is **no longer an Auth0-only rollback** — released CLI clients now authenticate through Clerk. **Keep Clerk token acceptance and the imported identity links live** (the backend is dual-accept regardless) and **keep Clerk-path JIT-create enabled** so those CLI clients keep resolving; the web frontend reverts to Auth0 but the Clerk backend path stays up. Fully removing Clerk then requires an explicit **rollback CLI release** plus comms, not just a tag deletion.

**Predefined triggers for immediate pause-or-abandon:** F0 azp gate fails; web login broken post-deploy; import reconciliation discovered non-zero post-flip.

---

## Cutover record template (fill during execution)

```
Fresh Auth0 export SHA-256:        ____
Import dry-run report (C2):        ____ (attach)
Import execute report (C3):        ____ (attach)
Post-execute fresh dry-run:        RECONCILED / discrepancies: ____
Clerk operator user IDs (C1):      ____
Pre-change user/linkage counts:    ____
DB snapshot id/location (C0):      ____
Env flags (before → after):
  CLERK_JIT_CREATE_ENABLED:        ____ → ____   (D1)
  AUTH0_JIT_CREATE_ENABLED:        ____ → ____   (E1)
  CLERK_WEBHOOK_SIGNING_SECRET:    set? ____      (A3)
  sign_up_mode:                    restricted → open  (E5)
  delete_self:                     off → on       (D4)
Railway API deploy SHA (A1):       ____
Frontend flip merge commit (E2):   ____
CLI release tag + commit (E4):     ____
Go/no-go sign-offs:                C3 ____   pre-flip ____
Rollback action taken (if any):    ____
```

---

## Plan-sync (landed in this PR — applied to `2026-07-02-clerk-migration.md`)

These edits keep the plan and this run sheet consistent; they are **included in PR #155** alongside this sheet (the pre-flip smoke step, the M6b expand/contract summary, and the M5→post-cutover execution-order note were added in the final consistency pass). Sites updated:

1. **Line 47 (AD5)** — "M6a flips web/CLI/MCP to Clerk in production" → clarify: M6a flips **web/CLI**; **existing MCP access remains on Tiddly's own PAT system** (it is *not* "MCP on Clerk"); **MCP OAuth connectors ship in M5, post-cutover**.
2. **Lines 355 & 359 (M6a intro + goal)** — same MCP rescope ("web, CLI, and MCP on Clerk" → "web and CLI on Clerk; existing MCP bearer/PAT integrations unchanged; MCP OAuth connectors in M5").
3. **Line 377 (step 2 "Flip")** — reorder to: disable Auth0 JIT → deploy frontend → healthcheck + `azp` browser gate → release CLI → **reopen Clerk sign-ups last**; and change "Verify … MCP connector" → "verify existing bearer/PAT MCP integrations still work."
4. **Line 389 (M6a Definition of Done)** — "flip verified across web, CLI, MCP, and extension" → "…web, CLI, **PAT/bearer MCP continuity**, and extension"; replace **"synthetic never-imported Auth0-identity token → 401"** with the **Management-API canary lifecycle** (F2); and note `azp` is proven via the **browser-login gate**, not the Backend-API smoke.
5. **Release choreography + milestone chronology / any "the MCP OAuth win" phrasing (line 355 tail)** — ensure nothing implies OAuth connectors are available *at* cutover; M5 is unambiguously **post-cutover**. Check the milestone ordering and the release-choreography section read consistently with that.
6. **Sign-up reordering (step 2)** — the "reopen sign-ups last" order must replace the plan's current "reopen → disable Auth0 JIT → deploy" sequence, not just live in this sheet.
