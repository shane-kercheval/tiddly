# M6b decommission run sheet (remove Auth0 entirely)

**Date**: 2026-07-14
**Status**: Proposed operational contract — in **PR #155** (companion to [`2026-07-14-m6a-cutover-runsheet.md`](2026-07-14-m6a-cutover-runsheet.md)). Reviewed now, **executed later** — M6b runs only after the dual-accept window closes (gated on the iOS app shipping); it is planned now so the one-way-door half is settled before M6a is considered fully planned.
**Governs**: Milestone 6, half B of [`2026-07-02-clerk-migration.md`](2026-07-02-clerk-migration.md) (Implementation Outline "M6b — decommission", steps 4–8).

---

## Why this is a separate, staged run sheet

M6b is the migration's **only one-way door**. The plan compresses code removal, schema change, env cleanup, cache change, and vendor-account deletion into one "decommission change-set." **Do not execute that as one irreversible deployment.** This sheet stages it **expand/contract**: ship Clerk-only *code* while the Auth0 column, config, and tenants still exist → verify in production with a rollback window → only then drop the column and transitional machinery → remove env vars once no deployed code needs them → **delete the Auth0 tenants last.** That preserves a real rollback path right up until the tenants are gone.

Legend (`[C]` / `[S]` / `[C→S]`) and the credential-custody rule are the same as the M6a sheet.

---

## Gate G — the window is actually closed (direct confirmation, not a monitored soak)

At this scale the decommission gate is a **direct confirmation with a known cohort**, not a log-watching wait. The log going quiet is a **backstop that should agree**, not the mechanism.

| # | Step | Who |
|---|------|-----|
| G1 | **Re-enumerate the cohort** at execution time (do not trust counts recorded earlier). Today: two iOS users (maintainer + app developer, both TestFlight) **plus any CLI users** surfaced during the M6a soak. | **[S]** |
| G2 | For **every** cohort member, on **every device they use**, confirm they have: installed/upgraded the Clerk build, launched it, **signed in through Clerk**, and made **one successful authenticated request** landing on their **existing** account. (Install alone is insufficient — removing Auth0 after install-only could kill the fallback while the Clerk path is silently broken for that user.) | **[S]** |
| G3 | **Backstop (also required, not merely advisory):** confirm the Auth0-path log (including `source=ios`) shows **no unexplained traffic**. G2 and G3 must **both** hold. A disagreement — a confirmed-migrated cohort but lingering Auth0-path traffic, or the reverse — means the gate is **unresolved**: stop and investigate until explained. Neither signal "wins." | **[C]** monitors + **[S]** resolves |

**Exit G:** every known Auth0 client confirmed on Clerk against their real account **and** the log shows no unexplained Auth0-path traffic; any disagreement resolved before proceeding.

---

## Phase H — Expand: deploy Clerk-only code, retain Auth0 column/config/tenants

Everything Auth0 stays *present but unused* here, so this deploy is revertible.

**H entry criterion (define the rollback window *before* starting H, not during it).** Phase H is the last rollback opportunity's evidence-gathering window. Set its minimum up front: at least **one complete normal-use cycle for both iOS users and every known CLI client, with zero Auth0-path traffic and zero Clerk errors observed**, before Phase I's contract begins. If that evidence isn't accruing, you extend H — you do not proceed to I on a timer.

| # | Step | Who |
|---|------|-----|
| H0 | **Fresh production DB snapshot** and a **final Auth0 bulk export**; assign the archived export a **named retention owner and period** (it contains every user's email). | **[S]** |
| H1 | **`external_auth_id IS NULL` preflight** on production (users are **hard-deleted**, not soft-deleted — there is **no `deleted_at` column**, so do not filter on one): `SELECT id, email, auth0_id FROM users WHERE external_auth_id IS NULL;`. **Every returned row blocks M6b** and is investigated/resolved before proceeding — not discovered as a failed migration later (the JIT-create flags existed precisely to keep this empty). Also run the identity reconciliation as explicit counts: `SELECT count(*) FROM users;` must equal `SELECT count(*) FROM users WHERE external_auth_id IS NOT NULL;`, and `SELECT count(*) FROM users WHERE auth0_id IS NOT NULL AND external_auth_id IS NULL;` must be **0**. | **[C→S]** |
| H2 | **Deploy the Clerk-only application code**, but **retain** `auth0_id`, the Auth0 config/Settings fields/validators, and the tenants: remove the Auth0 verification branch + the issuer-routing Auth0 arm (unknown issuer → 401 stays); stop *using* the per-issuer JIT-create **branching logic** (single-issuer world). **The `auth0_jit_create_enabled` Settings *field* itself is removed later, in Ic** — leaving the config surface intact here keeps this deploy cleanly revertible. **Do NOT** drop the column, bump the cache schema, remove Settings fields, or delete env vars in this deploy. | **[C→S]** |
| H3 | **Verify production** on Clerk-only code: web/CLI/MCP-bearer/extension all work; the **deployed security suite** is green; and a **still-valid Auth0 token is now rejected** (401 — the Auth0 path is gone). | **[C]** + **[S]** for browser checks |
| H4 | **Observe through the rollback window defined at H entry** (above) — remain in H until *both* the pre-agreed minimum duration **and** the normal-use evidence (every iOS user + every known CLI client) have been satisfied; do **not** redefine the window after seeing early results. Rollback here = revert the H code deploy — the column/config/tenants are all still present, so it's clean. | **[S]** |

**Exit H:** Clerk-only code verified in production; rollback window elapsed with no issue.

---

## Phase I — Contract (staged: code deploy → fleet verification → schema migration)

Only after H's rollback window closes cleanly. **The column drop must not share a deploy with the code that stops reading it** — during a rolling deploy an old instance still mapping `users.auth0_id` would error against the dropped column. Stage it in three steps.

### I-code — deploy Clerk-only code that tolerates the old column/env still existing

| # | Step | Who |
|---|------|-----|
| Ia | Remove **all `users.auth0_id` reads/mapping** from the ORM/model and services (the column stays in the DB for now; the code simply stops referencing it). | **[C]** |
| Ib | **Cache**: drop the M1 transitional Auth0 cache key/fallback; remove `CachedUser.auth0_id`; **bump `CACHE_SCHEMA_VERSION`** (old entries are ignored → safe cache-miss to DB). | **[C]** |
| Ic | **Remove the Auth0 Settings surface** (`core/config.py`): the `auth0_domain`/`auth0_audience`/`auth0_client_id`/`auth0_custom_claim_namespace`/`auth0_jit_create_enabled` fields, the `auth0_issuer`/`auth0_jwks_url` helpers, and the **non-dev `AUTH0_CUSTOM_CLAIM_NAMESPACE` startup requirement** (`config.py:141`) — replaced by the Clerk-settings equivalent introduced in M1. This must land **here**, before J's env-var removal, or a retained validator crashes the api/cron services at startup. Env vars stay set for now (unreferenced = harmless). | **[C]** |
| Id | **Dev-mode synthetic user**: `auth0_id="dev\|local-development-user"` → an `external_auth_id` sentinel of the same shape/semantics; update `docs/architecture.md`. | **[C]** |
| Ie | **Tombstone retention**: add the `deleted_identities` sweep (entries older than **30 days**) to `tasks/cleanup.py` (daily) — safe **only now** (removing the Auth0 verification path ends the open-ended lifetime the Auth0-side tombstones guarded; 30 days ≫ the ~1-day Clerk token lifetime; see M8 step 2a). | **[C]** |
| If | **CLI source cleanup**: delete `TIDDLY_AUTH0_*` handling remnants. **Source-only — no user-facing CLI release is required** (users already upgraded at M6a); fold into the next routine `cli/v*` release if/when convenient. | **[C]** |
| Ig | **Deploy I-code**; run the full suite + deployed security tests. | **[C→S]** |

### I-verify — confirm the fleet is on I-code before touching the schema

| # | Step | Who |
|---|------|-----|
| Ih | Confirm **every** api **and** cron instance is running the I-code build (drain/replace any lingering old instance). The column drop is unsafe while any process still maps `auth0_id`. | **[C→S]** |

### I-migrate — drop the column

| # | Step | Who |
|---|------|-----|
| Ii | **Forward migration** (`make migration message="drop auth0_id and finalize clerk-only identity"`): drop the M1 transitional identity **CHECK constraint** (`ck_user_has_identity`), drop `users.auth0_id`, and **`SET NOT NULL` on `external_auth_id`** (guarded by H1's empty preflight). Define behavior for legacy rows (dev sentinel migrated per Id; document pre-migration local/dev DBs as reset-or-backfill, not left to fail opaquely). **Never edit old migrations** — this is a new forward migration. Deploy; verify production again (full suite + deployed security tests). | **[C→S]** |

**Exit I:** I-code deployed and verified fleet-wide; column dropped; `external_auth_id` NOT NULL; cache / dev-sentinel / tombstone-sweep / CLI / Auth0 Settings all cleaned; production green.

---

## Phase J — Remove env vars, then delete the tenants (last)

| # | Step | Who |
|---|------|-----|
| J1 | **Remove obsolete env vars** — safe now because I-code (Ic) already removed the Settings fields and the non-dev namespace validator that read them, so nothing deployed references them: `AUTH0_*` on the Settings-loading services (api + the two cron services), **and `VITE_AUTH0_*` on the Railway *frontend* service** (build-time values; not a Settings-loading service, so easy to miss). Remove `@auth0/auth0-react` from the frontend. Remove `.env.example` Auth0 vars. | **[C→S]** |
| J2 | **Security tests**: update `backend/tests/security/` and `tests/security/deployed/` for the Clerk-only world (deployed tests use PATs — little change; update anything asserting Auth0-specific 401/403 text or claims). Operator runs `test_live_penetration.py` against production. | **[C]** + **[S]** |
| J3 | **Docs sweep** (AGENTS.md "Files to Keep in Sync"): `docs/architecture.md` (§5 auth rewrite, diagram nodes, Redis key schema, "known drift risks"), `README_DEPLOY.md` (Step 6 → Clerk, env tables, cron env vars), `README.md`, `AGENTS.md` (auth description), `.env.example`, the `llms.txt` family where auth is described (`llms-integration.txt` "Auth0-only 403 surfaces" → renamed dependency family), re-check `CONSENT_INSTRUCTIONS` in `core/auth.py`, and `docsRoutes.tsx`/`settingsRoutes.tsx` searchText if auth terms changed. Mark `future-identities.md` superseded (AD2). | **[C]** |
| J4 | **Grep gate**: no case-insensitive `auth0` in code/config outside `docs/` history and immutable historical migrations. **Ledger gate**: `grep '\[OPEN\]' docs/auth0-clerk-ledger.md` returns no marker pointing at a migration milestone. | **[C]** |
| J5 | **Ledger final pass**: total effort per milestone; the complete gained/lost/neutral table. | **[C→S]** |
| J6 | **Delete the Auth0 tenants (dev and prod) — LAST**, only after the archived user export (and the hash export, if the optional ticket was exercised) is stored safely with its **named retention owner and period** recorded. This is the irreversible step; everything above is already verified Clerk-only in production. | **[S]** |

**Exit J (M6b done):** `make tests` clean; deployed security tests green against production; all sync-listed docs updated; grep + ledger gates pass; tenants deleted; export archived with a named retention owner.

---

## Rollback boundaries (where the door is still open)

- **Through Phase H and I-code (before I-migrate):** revertible — revert the code deploy; `users.auth0_id`, the Auth0 env vars, and both tenants all still exist, so dual-accept can be restored (re-add the verification path + Settings fields from git history).
- **After I-migrate (column dropped):** the schema door has closed; re-introducing Auth0 is a rebuild, not a revert. Treat this as the practical point of no return for the Auth0 *code path*. The **tenants still exist**, so identities/data are still recoverable from Auth0 until J6.
- **After J6 (tenants deleted):** irreversible. This is why J6 is last and gated on the archived export.
