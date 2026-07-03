# Auth0 → Clerk Migration

**Status**: Planned
**Date**: 2026-07-02
**Scope**: Web app, FastAPI backend, Postgres, Go CLI, MCP servers (adds OAuth — resolves [KAN-57](https://tiddly.atlassian.net/browse/KAN-57)). Out of scope: billing (Clerk Billing evaluated separately — open VAT/refunds questions), iOS app (separate repo; migrates on its own timeline after the M6a cutover — the M6b decommission is explicitly gated on it), Chrome extension (PAT-only today; no changes required).

## Context & Goals

Tiddly authenticates via Auth0 (web SPA tokens + CLI device flow) and app-managed Personal Access Tokens (`bm_` prefix). We are migrating the identity provider to Clerk. Beta scale (a handful of users) but **real user data that must not be lost** — content is keyed to internal UUIDv7 `users.id`, which never changes; only the identity *linkage* migrates.

Goals, in priority order:

1. Migrate all users (email/password + Google social) to Clerk with zero data loss and passwords preserved.
2. End state looks as if Clerk had been implemented from the start — **no Auth0 residue in code, config, or schema**, and provider-specific shape contained to a narrow seam (see Architecture Decisions).
3. Ship MCP OAuth (KAN-57) as part of the migration — unlocks ChatGPT and Claude Desktop native connectors.
4. Maintain a capability ledger documenting Auth0↔Clerk functional differences discovered during the work.

## Architecture Decisions (locked — do not relitigate during implementation)

These decisions came out of design discussion and cannot be recovered from the codebase. Each must survive into the code as comments/docstrings at the relevant seam, or into the ledger — not evaporate during implementation.

**AD1 — PATs stay app-managed.** The `bm_` token system (`services/token_service.py`, `models/api_token.py`) is untouched. Clerk's API Keys product was considered and rejected: per-verification metering on our hottest auth path, and it couples PAT validation to Clerk availability. PATs remain the provider-neutral escape hatch (headless CLI, Chrome extension, scripts, non-OAuth MCP clients).

**AD2 — No `user_identities` table; one provider-neutral column.** `docs/implementation_plans/future-identities.md` planned a multi-identity table because Auth0 surfaces each login method as a distinct `sub`. Clerk performs account linking *inside the provider* (one Clerk user, many auth methods, one stable `user_id`), which obsoletes that plan. End state: `users.external_auth_id` (unique, indexed) storing the Clerk user ID — a neutral *name* ("the `sub` claim of verified IdP tokens") with a provider-specific *value*, which is unavoidable. Never parse or derive meaning from its format. `future-identities.md` gets a superseded-by note.

**AD3 — Divergence from Clerk's migration guide: no `external_id` session-token aliasing.** Clerk's guide suggests customizing the session token to emit `{{user.external_id || user.id}}` so backends can keep keying on old Auth0 subs indefinitely. That pattern exists for large userbases with untouchable code. We reject it: we control the backend and have a handful of users, so we do a clean lookup-column swap instead. The old Auth0 `sub` IS stored in Clerk's `external_id` at import time — but purely as an audit breadcrumb inside Clerk. **The application never reads `external_id`.**

**AD4 — Divergence from Clerk's migration guide: no trickle migration.** Clerk documents running both providers in parallel and migrating users on activity. At our scale this is machinery without payoff. We do: bulk import → backend dual-accept window → single coordinated client flip → soak → decommission.

**AD5 — Cutover = backend dual-accept, single frontend/CLI flip.** During the transition window the backend verifies JWTs from *both* issuers (routing on the token's `iss` claim); both paths resolve to the same `users.id` row (Auth0 tokens via `auth0_id`, Clerk tokens via `external_auth_id`), so a user mid-transition (web on Clerk, CLI on a lingering Auth0 refresh token) sees one consistent account. The two columns coexist **only** during this window; the decommission (M6b) drops `auth0_id`. The window deliberately spans the iOS app's independent migration: M6a flips web/CLI/MCP to Clerk in production while iOS keeps authenticating via Auth0; M6b is gated on the iOS update shipping. Two window rules follow: (1) the production import must be complete before the first production Clerk login — an unimported user would JIT into a fresh, empty account; (2) no new Auth0 identities may be created once sign-up moves to Clerk — otherwise the same person can end up with two unlinked accounts (one per provider).

**AD6 — Neutral naming at the small leaks.** `AuthType.AUTH0` → `AuthType.SESSION` (mechanism-descriptive, covers both issuers during dual-accept; a future provider swap doesn't touch it). Redis auth-cache key segment `auth:vN:user:auth0:{id}` → `auth:vN:user:ext:{id}` with a schema-version bump. Historical `content_history.auth_type` rows keep the literal `"auth0"` — audit rows describe what was true at the time; do not backfill.

**AD7 — Backend verifies Clerk session tokens with the existing PyJWT/JWKS pattern, not the Clerk SDK, on the hot path.** Clerk session tokens are standard RS256 JWTs verified against a JWKS endpoint — the same shape `core/auth.py::decode_jwt` already handles. Key differences from Auth0: tokens are short-lived (~60s, auto-refreshed by clerk-js) and carry **no audience**; the equivalent check is `azp` (authorized party) against an allowlist of our web origins. The official `clerk-backend-api` Python SDK is used only where the Backend API is genuinely needed (the import script in M2). Rationale: consistency with existing code, no new dependency on the request path, networkless verification keeps existing sessions working during a Clerk outage.

**AD8 — Auth cache keys on `sub`, not on raw token.** Already true today (cache is keyed by `auth0_id`/`user_id`, not token) — preserve this. With 60-second Clerk tokens, any token-keyed cache would be useless; the sub-keyed design is why the 5-min TTL survives the migration unchanged.

**AD9 — CLI: device flow → authorization code + PKCE with loopback callback; PATs are the headless story.** Clerk does not support RFC 8628 device authorization (verified against OAuth server metadata, Clerk's own CLI-auth blog, and their public roadmap where it is backlog-only). The replacement is the `gh auth login` pattern: ephemeral listener on `127.0.0.1`, browser to Clerk's `/oauth/authorize` with PKCE (S256), code exchange at `/oauth/token`, tokens in the OS keyring. This loses true remote/SSH interactive login (browser must run on the same machine as the CLI); the documented fallback is `tiddly login --token bm_...`, which already works and does not change.

**AD10 — MCP servers stay thin bearer-passthrough proxies.** KAN-57 is implemented exactly as the ticket sketches, with Clerk substituted for Auth0 as the authorization server: each MCP server adds one static discovery endpoint (`/.well-known/oauth-protected-resource`) pointing at Clerk; Clerk handles DCR, login, consent, and token issuance; the MCP servers keep forwarding whatever bearer arrives; the **backend API** is the only component that verifies tokens. Bearer/PAT auth remains supported (backward compatibility is a must-have in the ticket).

**AD11 — Capability ledger.** `docs/auth0-clerk-ledger.md` is a living document, seeded in M0 and updated in every milestone's Definition of Done. Entry shape: capability · how Auth0 does it · how Clerk does it · what migrating took · gained/lost/neutral · gotchas (including "possible on both, but…" nuances and divergences from Clerk's own guides, per AD3/AD4). This is the raw material for a later external writeup; be blunt in it.

## Required Reading (before implementing — do not code from memory of Clerk's API)

- Migration path & import: https://clerk.com/docs/deployments/migrate-overview · https://clerk.com/docs/reference/backend/user/create-user · https://github.com/clerk/migration-tool (reference for export parsing; we script our own)
- Auth0 hash export process: https://support.auth0.com/center/s/article/How-to-Use-the-Password-Hashes-Export-from-Auth0
- Session tokens & verification: https://clerk.com/docs/guides/sessions/session-tokens · https://clerk.com/docs/guides/sessions/manual-jwt-verification · https://clerk.com/docs/guides/sessions/customize-session-tokens
- Social account linking (Google users): https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking
- Clerk as OAuth provider (CLI + MCP): https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth · https://clerk.com/docs/guides/configure/auth-strategies/oauth/scoped-access · https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens · https://clerk.com/blog/adding-clerk-auth-to-your-cli
- MCP auth: https://modelcontextprotocol.io/specification/draft/basic/authorization (RFC 9728 protected-resource metadata) · https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server (Node reference — we port the *shape*, not the code)
- React SPA & production deploy: https://clerk.com/docs (React quickstart) · https://clerk.com/docs/guides/development/deployment/production · https://clerk.com/docs/guides/development/managing-environments
- Python SDK (M2 import script only, per AD7): https://pypi.org/project/clerk-backend-api/
- KAN-57: https://tiddly.atlassian.net/browse/KAN-57

## Operator (human) steps — the agent cannot do these

Flagged inline per milestone, collected here so nothing blocks silently:

- **M0**: File the Auth0 password-hash export support ticket (~1 week turnaround — this is the critical path; file it first). Create the Clerk **application** — Clerk's model is one application with two paired **instances** (a development instance, created automatically with `pk_test_`/`sk_test_` keys and localhost support, and a production instance activated later in M3; unlike Auth0's two independent tenants). On the dev instance: enable email/password + Google auth strategies, and configure the session-token custom claims (email + verification status, exact shortcodes per the spike). Instance caveats that shape later milestones: **users never transfer between instances** (dev has a throwaway user pool; the real M2 import targets production), and per-instance settings (Google OAuth credentials, OAuth apps, DCR) must be configured on each instance — `clerk deploy` clones dev config to prod to reduce hand-replication.
- **M2**: Run the Auth0 bulk user export; receive the hash export from the support ticket.
- **M3**: Activate the Clerk production instance (of the M0 application; `clerk deploy` clones the dev-instance config); DNS CNAME records on tiddly.me (DNS-only, not proxied; up to 48h propagation); reuse the existing Google OAuth credentials with Clerk's redirect URI (prod instance requires real credentials — the dev instance used Clerk's shared ones); set Railway env vars. **The step-by-step operator walkthrough for all of this is an M3 deliverable**: the README_DEPLOY.md "Step 6: Configure Auth0" section gets a Clerk replacement (drafted in M3 while fresh, finalized in M6's docs sweep) — this plan intentionally does not duplicate that walkthrough. Calibration for the replacement: **exhaustively specific about WHAT must exist in Clerk** (every setting, value, and which instance it belongs to), with general dashboard direction only ("Dashboard → Sessions → Customize session token"-level) — not click-by-click UI paths, which rot as the dashboard changes (parts of the old Auth0 Step 6 demonstrate this).
- **M4**: Create the Clerk OAuth application for the CLI (public client, PKCE) — **with JWT access-token format enabled** (the backend's networkless verification, AD7, depends on it; opaque tokens 401 with the M1 warning log). Create it on **both instances**: dev for milestone testing, prod for cutover (the prod app has a different client_id — the CLI's hardcoded default config points at prod, env overrides point at dev, mirroring today's `TIDDLY_AUTH0_*` pattern).
- **M5**: Enable dynamic client registration and **confirm DCR-registered clients issue JWT access tokens** (per the M0 spike finding on where the format setting lives) — on both instances, same dev/prod split as M4; test connectors from Claude Desktop / ChatGPT accounts.
- **M6a**: Send the cutover email (web/CLI re-login required; iOS unaffected for now; note that password changes made on the Auth0/iOS side won't carry to Clerk during the window). Close Auth0 sign-ups: turn off sign-ups on the Auth0 DB connection and block first-time social sign-ins with a small post-login Action — the requirement is that no new Auth0 identity can be created after the flip.
- **M6b** (gated on the iOS app update shipping): run the deployed security tests against production; decommission **both Auth0 tenants** (dev and prod).

## Environment & testing strategy (Railway hosts production only — no permanent staging)

There is no dev/staging Railway environment, and none needs to be created. Day-to-day local development runs `VITE_DEV_MODE=true` (auth bypassed), but the **established auth-testing workflow** is the full stack locally with `VITE_DEV_MODE=false` against a **dev Auth0 tenant** (a separate tenant from prod; not documented in README_DEPLOY, which covers only the prod tenant). The migration reuses exactly that workflow, with Clerk's dev instance taking the dev tenant's role:

- **M0–M4: full stack locally with real auth.** Same local real-auth setup as today, pointed at the Clerk **dev instance** (`pk_test_`/`sk_test_` keys; Clerk dev instances work on localhost with no DNS records). M1's dual-accept is testable entirely locally by configuring the dev Auth0 tenant and the Clerk dev instance side by side — verify a dev-tenant Auth0 token and a Clerk token resolve to the same local user row. Required non-dev settings (`AUTH0_CUSTOM_CLAIM_NAMESPACE` until M6, Clerk settings from M1) stay set in the local env as today. The CLI's loopback OAuth (M4) is inherently localhost-friendly (`TIDDLY_AUTH0_*`-style env overrides already exist for pointing the CLI at a non-prod tenant; the Clerk equivalents replace them in M4).
- **M2: rehearse the import against a restored production backup.** Restore a prod Postgres backup into local Postgres and run the import (dry-run first) against the Clerk dev instance. This is the data-risk rehearsal; the production run in M6 must not be the first full-fidelity run.
- **M5: connector testing needs a public HTTPS URL** (ChatGPT/Claude Desktop cannot reach localhost). Default: tunnel the locally-running MCP servers (e.g. cloudflared/ngrok). Fallback if a connector client rejects tunnel domains: temporarily duplicate the Railway environment (Railway supports isolated environment copies within a project) and tear it down after.
- **M6a has no staging rehearsal — by design.** The mitigations are the dual-accept window (backend accepts both issuers, so the old frontend keeps working), Railway deployment rollback (re-deploy the prior frontend build to revert the flip), and soak-before-decommission (the Auth0 code path is only deleted after production has proven the Clerk path). The production Clerk instance and its DNS records (M3 prep) are additive and can be created/verified without touching the running app.

---

## Milestone 0 — Spike, dev instance, and ledger

### Goal & Outcome

De-risk the medium-confidence findings from research before any production code changes, and start the ledger.

- A Clerk dev instance exists and a throwaway script proves: FastAPI can verify a real Clerk session token via PyJWT+JWKS with an `azp` check; a custom email + email-verified claim appears in the session token; a Clerk OAuth app issues JWT access tokens verifiable against the same JWKS.
- Open questions answered and recorded: exact claim names/shortcodes for email + verification status; OAuth access-token default lifetime and whether refresh tokens require a scope to be issued; how Clerk meters/limits DCR-registered clients (Auth0's free tier caps at 10 applications — KAN-57 flags DCR spam risk; confirm Clerk's equivalent posture); shape differences between session-token claims and OAuth access-token claims (`sub` present in both? email present in OAuth tokens?); **whether OAuth access tokens arrive JWT-formatted for both operator-created OAuth apps and DCR-registered clients, and where the JWT-vs-opaque format setting lives (per-app vs instance)** — the backend's issuer-routed dispatch requires JWTs (Clerk supports an opaque format, which would 401; see M1 step 3 and the M4/M5 operator steps). Do not build an opaque-token verification path — it would reintroduce the Backend-API-on-the-hot-path dependency AD7 rejects; JWT format is a configuration requirement.
- `docs/auth0-clerk-ledger.md` created and seeded with the already-known entries (device-flow absence, no custom OAuth scopes, no client_credentials, hash-export-by-ticket vs Clerk self-serve export, session-token model differences, account-linking behavior, AD3/AD4 divergences, `future-identities.md` obsolescence).

### Implementation Outline

Spike code is throwaway — a script or scratch test hitting the dev instance; do not integrate into `core/auth.py` yet. The deliverables are the answered questions (recorded in the ledger and in this plan's margins) and the ledger doc itself. Operator steps: Clerk dev application, dashboard session-token customization, **filing the Auth0 hash-export ticket immediately**.

### Definition of Done

Small milestone — proportionally: spike answers written into the ledger; ledger committed; hash-export ticket filed (operator confirms). No production code changed, no tests required beyond the spike itself running.

---

## Milestone 1 — Backend dual-accept

### Goal & Outcome

The backend verifies both Auth0 and Clerk JWTs, resolving both to the same user rows. Nothing user-visible changes; production keeps running on Auth0.

- A request bearing a valid Clerk session token authenticates, JIT-provisions a user on first sight (same semantics as today's Auth0 path), and passes consent/rate-limit checks identically.
- All existing Auth0-token and PAT behavior is unchanged and all existing tests pass.
- Every Auth0-path authentication emits a log line that includes the resolved request source (the cutover signal — during the M6a→M6b window, `ios` is expected to be the only remaining Auth0 source, so the log must distinguish clients).
- The schema has a nullable unique `users.external_auth_id` column, empty for now.

### Implementation Outline

Read `core/auth.py`, `core/config.py`, `core/auth_cache.py`, `core/request_context.py`, `schemas/cached_user.py` first — the entire provider seam lives there (keep it that way; that containment is AD-level intent, note it in the module docstring).

1. **Migration** (`make migration message="..."` — never hand-write): add `users.external_auth_id`, `String`, nullable, unique, indexed; **alter `auth0_id` to nullable** (it is NOT NULL today, which would make Clerk JIT provisioning impossible — a new Clerk-only user has no Auth0 sub); add a named transitional CHECK constraint `(auth0_id IS NOT NULL) OR (external_auth_id IS NOT NULL)` so the core identity invariant is enforced at the database, not only in application logic, during the window. M6 drops both `auth0_id` and this constraint and sets `external_auth_id` NOT NULL — end state unchanged.
2. **Config**: add Clerk settings (Frontend API domain → derived issuer + JWKS URL, and an authorized-parties list of web origins). Auth0 settings remain. The existing validator requiring `AUTH0_CUSTOM_CLAIM_NAMESPACE` in non-dev stays for now (removed in M6); add an equivalent guard that Clerk settings are present in non-dev.
3. **Token routing in `_authenticate_user`**: `bm_` prefix → PAT (unchanged). Otherwise parse the JWT's `iss` claim *unverified for dispatch only* (full signature/claims verification happens in the issuer-specific path — comment this, it looks alarming otherwise), route to Auth0 verification (existing `decode_jwt`, unchanged) or Clerk verification (new: same PyJWT/JWKS pattern per AD7; validate `iss`, `exp`, `azp` ∈ authorized parties; **no audience check** — Clerk session tokens don't carry one). Unknown issuer or missing `iss` → 401 with the same generic detail as other token failures. A non-`bm_` bearer that isn't parseable as a JWT at all → same generic 401 plus a **warning log naming the cause** — this is the observable symptom of a Clerk OAuth app misconfigured to issue opaque tokens (see the M4/M5 operator requirements), and the log is what makes that misconfiguration diagnosable during M4/M5 testing instead of a silent 401.
4. **User resolution**: `create_user_with_defaults` and the lookup/race-recovery logic in `get_or_create_user` become provider-neutral — create/resolve by whichever identifier the verified token supplied, exactly one required (the DB CHECK from step 1 backstops this). The Clerk path looks up / JIT-creates by `external_auth_id` (= token `sub`), mirroring the existing race-condition handling and email-sync rules (null never overwrites a value). Email + email_verified come from the custom session-token claims configured in M0 — plain claim names, no namespace prefix. Because `auth0_id` becomes optional, sweep every consumer typed against a non-optional `auth0_id` (e.g. `CachedUser.auth0_id: str`) — fix the whole type, not just the two creation/lookup call sites.
5. **`AuthType.AUTH0` → `AuthType.SESSION`** (AD6): covers both issuers. This value is persisted to `content_history.auth_type` going forward; historical rows untouched. Rename the `get_current_user_auth0_only*` dependency family to match (the *behavior* — blocking PATs — is unchanged; only the name was provider-shaped).
6. **Auth cache**: bump `CACHE_SCHEMA_VERSION`; `CachedUser` gains `external_auth_id`; dual-key scheme becomes `ext`/`id` segments (AD6). During dual-accept the Auth0 path still needs its lookup — either keep a third transitional key segment or fall through to DB for Auth0-path cache misses; choose whichever reads cleaner given the cache module, and note the transitional part for M6 removal.

Establish here the pattern M4/M5 will reuse: **issuer-routed verification with per-token-type claim expectations**. M4 adds "Clerk OAuth access token" as a third accepted JWT shape inside the Clerk branch — design the Clerk verification function so that addition is a parameterization, not a parallel implementation.

### Definition of Done

- New tests: Clerk-token happy path (mock JWKS, as existing Auth0 tests do), `azp` rejection, expired token, unknown issuer → 401, unparseable/opaque-shaped bearer → clean 401 (not 500) with the warning log, JIT provisioning + race condition on `external_auth_id`, email-claim sync rules, cache round-trip with new schema, `AuthType.SESSION` recorded in request context/history.
- Identity-invariant tests: Auth0-path creation with `external_auth_id` NULL works; Clerk-path creation with `auth0_id` NULL works; a row with **both** NULL is impossible to produce through the service layer (the DB CHECK raises).
- Entire existing backend suite passes with unchanged behavior. The `AuthType.AUTH0` → `SESSION` rename is **real M1 scope, not an aside**: update every test asserting the old value; done means a grep shows no remaining `AuthType.AUTH0` references and no `"auth0"` string literals in auth-type assertions (distinct from `auth0_id`/config references, which M1 legitimately keeps). Historical persisted `content_history.auth_type = "auth0"` rows remain valid data — never backfilled or migrated. `make backend-verify` clean.
- Auth0-path log line verified present.
- Ledger updated (e.g., azp-vs-audience entry). `docs/architecture.md` §5 updated to describe dual-accept as the *current* state.

---

## Milestone 2 — User import & backfill

### Goal & Outcome

Every existing Auth0 user exists in Clerk with working credentials, and every Postgres user row is linked to its Clerk user.

- Email/password users can sign in to Clerk with their **existing passwords** (bcrypt hashes imported — no resets).
- Google users are imported with verified emails so Clerk's account linking silently attaches their Google login on first sign-in.
- Every imported Clerk user carries `external_id` = the old Auth0 `sub` (audit breadcrumb only, per AD3).
- `users.external_auth_id` is populated for every row; a verification report proves the mapping is total and 1:1.

### Implementation Outline

A one-off, idempotent Python script (location per repo conventions; it is repo code, typed and reviewed like any other) using `clerk-backend-api` (the one sanctioned SDK use, per AD7). Inputs: the Auth0 bulk user export + the hash export from the M0 support ticket (operator supplies both).

Contract and edge cases decided in discussion:

- For each Auth0 user: create Clerk user with primary email **marked verified** (this is what makes Google account-linking silent — if left unverified, Clerk prompts or blocks linking), `external_id` = full Auth0 `sub` string, and `password_digest` (bcrypt, `password_hasher="bcrypt"`) when a hash exists (`auth0|` users). `google-oauth2|` users have no hash — import email-only.
- A user may appear in the export as *both* `auth0|` and `google-oauth2|` subs with the same email (Auth0 kept them as separate users unless linked). Detect same-email collisions and create **one** Clerk user (password hash attached, `external_id` = the sub currently stored in `users.auth0_id` — that's the identity the app actually knows). Log the discarded sub in the report.
- Backfill: match each `users.auth0_id` row to its created Clerk user, write `external_auth_id`. Any Postgres row without a match, or Clerk user without a row, is a **hard failure** printed in the report — never guess-match by email at write time.
- `--dry-run` prints the full intended mapping without writing to Clerk or Postgres. Idempotency: re-runs must not duplicate (look up by `external_id`/email before create). Handle Clerk 429s with backoff (rate limits are generous relative to our user count, but don't crash mid-import).

Run order: dry-run against dev instance → real run against dev instance with a test export → (M6a cutover) real run against production instance.

### Definition of Done

- Unit tests for the export-parsing and collision/mapping logic (the API-calling shell can be thin and untested; the decision logic must be tested — this script is the single highest-data-risk artifact in the migration).
- Dev-instance end-to-end: import a fixture export, sign in with an imported password, sign in with Google on a verified-email user and confirm silent linking, confirm `external_auth_id` backfill.
- Verification report format finalized (counts: exported, created, skipped-as-duplicate, backfilled; must reconcile to zero discrepancy).
- Ledger updated (hash-export friction, account-linking behavior, dual-sub collision handling).

---

## Milestone 3 — Frontend flip

### Goal & Outcome

The web app authenticates exclusively through Clerk. This milestone is code-complete and dev-instance-tested before any production flip (which happens in M6).

- Sign-up, sign-in (email/password + Google), sign-out, and session persistence work through Clerk.
- Authenticated API calls carry a Clerk session token; the 401-retry-then-logout behavior is preserved under the new token model.
- Dev mode (`VITE_DEV_MODE`) still bypasses auth entirely, exactly as today.
- Consent (451) flow, protected routes, and the post-login return-to-origin redirect behave identically.

### Implementation Outline

A provider seam exists for auth *status* only (`AuthProvider.tsx` → `AuthStatusProvider` → `useAuthStatus()`). Auth *actions* and user-profile reads do NOT go through it: seven files import `useAuth0` directly for `loginWithRedirect`/`logout`/`user` — `PublicHeader.tsx`, `SaveACopy.tsx`, `SidebarUserSection.tsx`, `Pricing.tsx`, `LandingPage.tsx`, `FeaturesPage.tsx`, and `SettingsGeneral.tsx` (which also reads `user?.email` off the SDK object). The full seam is therefore a *target state this milestone builds*, not something that exists:

0. **First step**: extend the seam to cover actions + user fields (login/logout/email — whatever the seven call sites actually need, judged against their code), migrate all seven onto it, and enforce the boundary with an ESLint `no-restricted-imports` rule so only `AuthProvider.tsx` may import the auth-provider SDK — wired into `frontend-verify`, not a one-time check. This can (and should) be done and merged *against Auth0 first*, before the SDK swap — it's a pure refactor that shrinks the risky change.

1. Replace `@auth0/auth0-react` with `@clerk/clerk-react` in `AuthProvider.tsx`. Login/signup UI: use Clerk's prebuilt components/modal (we currently delegate UI to Auth0's hosted page; prebuilt Clerk components are the equivalent least-custom-code choice). `userId` comes from Clerk's user id (replaces `user?.sub`).
2. `config.ts`: `VITE_CLERK_PUBLISHABLE_KEY` replaces the three `VITE_AUTH0_*` values. Preserve the existing semantic that a missing key falls back to dev mode (`isDevMode`), including its test.
3. `services/api.tsx` interceptor: `getToken()` per request (clerk-js serves a cached ≤60s token and refreshes in the background — this *replaces* the Auth0 refresh-token machinery; there is no client-held refresh token anymore). The 401-retry path forces a fresh token (Clerk's skip-cache option) once, then falls to `onAuthError` → `signOut()` + the existing consent/queryClient cleanup. The shared-refresh-promise dedup may simplify or disappear — judge against the actual interceptor code, but the observable contract (one retry, then logout) must hold.
4. Post-login redirect: preserve the `toSafeReturnTo` sanitization on whatever Clerk's redirect-completion hook provides.
5. Keep the Auth0 npm package and env vars until M6 removes them repo-wide? **No** — this milestone removes the frontend's Auth0 dependency outright (the frontend can only speak one provider; dual-accept lives in the backend, per AD5). What M6 removes is the *backend* Auth0 path and deploy config.
6. Operator: production-instance DNS + Railway env vars are prepared here but the production flip itself is executed in M6.

Edge case from discussion to verify explicitly: laptop-sleep / long-idle tab followed by an API call must transparently get a fresh token (this is a *behavioral improvement* over Auth0's expired-cached-token dance — confirm, and note in ledger).

### Definition of Done

- `AuthProvider.test.tsx` and interceptor tests rewritten for the Clerk contract (mock `@clerk/clerk-react` as the Auth0 hooks are mocked today): token attach, 401-retry-once, logout-on-repeat-failure, dev-mode bypass, safe-return-to. Component tests for the seven migrated call sites mock the seam hook instead of the SDK (a test-quality improvement — they stop caring which provider is behind it).
- The `no-restricted-imports` lint rule is active in `frontend-verify` and passing; a grep confirms the provider SDK is imported only in `AuthProvider.tsx`.
- `make frontend-verify` clean. Manual dev-instance pass: email/password login, Google login, logout, consent dialog on fresh user, protected-route redirect.
- No backend tests run for this milestone (frontend-only change).
- README_DEPLOY Step 6 (Auth0 setup) replacement drafted for Clerk (full docs sweep lands in M6, but deployment steps are written while fresh). Ledger updated (session model entry, prebuilt-components-vs-hosted-page entry).

---

## Milestone 4 — CLI auth rewrite

### Goal & Outcome

`tiddly login` authenticates against Clerk via browser-based OAuth (PKCE + loopback); everything downstream of login is unchanged.

- Desktop `tiddly login`: browser opens, user signs in to Clerk, CLI receives tokens, stores them in the keyring; silent refresh thereafter.
- Headless/SSH: interactive login cleanly errors with copy directing to `tiddly login --token bm_...` (unchanged PAT path) — per AD9 this is an accepted capability loss, stated in the error message and docs, not hidden.
- The backend accepts Clerk OAuth access tokens (the CLI's tokens are OAuth-app tokens, not session tokens).
- `tiddly tokens` (which forces OAuth auth because the backend blocks PATs on `/tokens/*`) works end-to-end.

### Implementation Outline

1. **Backend first** (this is the shared piece M5 reuses — build it here, per the M1 pattern): extend the Clerk branch of token verification to also accept Clerk **OAuth access tokens** (JWTs since 2026-01, same JWKS). Claim expectations differ from session tokens (per the M0 spike findings — likely no `azp`; `sub` is the Clerk user id; email may be absent → fall back to the existing null-email-tolerant user resolution). Same `AuthType.SESSION`, same user lookup by `external_auth_id`. This must be a parameterization of the M1 verification function, not a third implementation.
2. **CLI**: replace `device_flow.go` with a PKCE loopback flow: generate verifier/S256 challenge, listen on an ephemeral `127.0.0.1` port, open browser to Clerk's `/oauth/authorize` (client_id of the operator-created OAuth app; scopes per M0 spike findings — `openid profile email` plus whatever the spike showed is needed for refresh tokens), exchange the code at `/oauth/token`, hand `TokenResponse` to the existing `TokenManager`/keyring layer unchanged. Serve a minimal "you can close this tab" success page on the callback. Timeout the wait (mirror the device flow's expiry behavior); Ctrl+C cancels cleanly via the existing context pattern.
3. Refresh: Clerk refresh tokens are non-rotating and non-expiring — simpler than Auth0's rotation, but keep storing whatever the token endpoint returns (if a refresh response includes a new refresh token, store it; don't hardcode the non-rotation assumption). Map `invalid_grant` to the existing "session expired, run tiddly login" UX.
4. Config: hardcoded prod values + env overrides mirror the existing `DefaultAuth0Config` pattern (`TIDDLY_AUTH0_*` env names → neutral `TIDDLY_OAUTH_*` or similar; these are public client values, not secrets — keep the existing comment saying so).
5. `isJWTExpired`'s local `exp` decode carries over unchanged.
6. Headless detection: don't over-engineer — attempt the flow; if the browser can't be opened AND the callback never arrives, the timeout error names the PAT alternative. A `--no-browser` style escape hatch only if one already exists in conventions (it doesn't — so don't add it).

### Definition of Done

- Backend: tests for OAuth-access-token acceptance (claim-shape fixtures from the spike), and that a session-token-shaped and OAuth-shaped token resolve to the same user. Manual check during dev-instance testing: the token the CLI actually receives is JWT-shaped (if it isn't, the OAuth app's token format is misconfigured — the M1 warning log will say so).
- CLI: Go tests mirroring the existing device-flow test structure — PKCE exchange against an httptest server, callback handling, timeout, denial, refresh including invalid_grant mapping, keyring round-trip (existing tests largely retarget). `make cli-verify` and `make backend-verify` clean.
- Manual: `tiddly login` end-to-end against the dev instance; `tiddly tokens create/list/delete`; `tiddly login --token` unchanged.
- Docs: CLI docs + `llms-cli-instructions.txt` updated where they describe login (mention the SSH/PAT story). Ledger updated (device-flow gap entry finalized with actual effort/UX notes — this is the headline entry).

---

## Milestone 5 — MCP OAuth (KAN-57)

### Goal & Outcome

MCP clients that require OAuth can connect to Tiddly's MCP servers with a paste-the-URL experience; bearer/PAT auth keeps working.

- Claude Desktop native Connectors and ChatGPT can add `https://<content-mcp>/mcp` and `https://<prompt-mcp>/mcp`, complete a browser sign-in, and use the tools.
- Existing bearer-token MCP configs (Claude Code, Codex, `tiddly mcp configure` output) keep working untouched.
- Unauthenticated MCP requests return 401 with the discovery metadata pointer, per spec, so OAuth-capable clients can bootstrap.

### Implementation Outline

Per AD10, the servers stay proxies; the ticket's own checklist is the shape. For each MCP server:

1. Serve the protected-resource metadata (static JSON: `resource` = that server's public URL, `authorization_servers` = [Clerk domain], `bearer_methods_supported: ["header"]`). Each server states its own `resource` — config-driven, since the two servers have different domains. Serve **`GET` and `OPTIONS` with permissive CORS** (browser-based clients preflight), at **both** the root well-known path (`/.well-known/oauth-protected-resource`) and the path-suffixed variant (`/.well-known/oauth-protected-resource/mcp`) — client implementations differ on which they request.
2. **This is new HTTP-layer auth gating, not a realignment — and it is the riskiest piece of M5.** Neither server rejects unauthenticated requests at the HTTP layer today: the content server fails at tool-invocation time (`_get_token` → FastMCP `ToolError`), and the prompt server's `AuthMiddleware` only *stages* the token into a contextvar, rejecting nothing. Add ASGI-level, pre-dispatch bearer checks to both: a missing `Authorization` header on the MCP endpoint → HTTP 401 with `WWW-Authenticate: Bearer resource_metadata="<metadata-url>"` (RFC 9728 §5 — this is what triggers client OAuth bootstrap) *before* any MCP/JSON-RPC handling. **Presence-only at the proxy**: a present-but-invalid bearer flows through and fails at the backend API, which remains the only verifier (AD10) — state this boundary in code. Existing bearer clients send the header on every request and never hit the gate; regression-test that explicitly rather than assuming it.
3. Testing-ladder checkpoint: if MCP Inspector / Claude Desktop / ChatGPT probe `/.well-known/oauth-authorization-server` on our origins (some older clients do), decide then whether to proxy/redirect it to Clerk's — don't build it speculatively.
4. Operator: enable dynamic client registration on the Clerk instance (JWT token format confirmed per operator steps). Note the M0 spike's answer on DCR client metering here.
5. Backend token verification: **no new work** — Clerk OAuth access tokens were accepted in M4. The MCP servers forward the bearer exactly as today.
6. `tiddly mcp configure` stays as-is this milestone (it writes bearer configs, which remain valid). Whether its docs/help should mention the OAuth path for Desktop/ChatGPT: yes, one line — the CLI is no longer the only setup path, per discussion.

### Definition of Done

- Tests, per server: no-bearer request → 401 with the correct `WWW-Authenticate` header before MCP dispatch; bearer-present request (valid or invalid) passes the gate and reaches the proxy path unchanged; metadata content + CORS headers on GET/OPTIONS for both path variants. Regression: existing bearer-extraction tests untouched and passing, plus an explicit end-to-end check that a `tiddly mcp configure`-style bearer config works from the first request.
- Manual verification ladder from the ticket: MCP Inspector → Claude Desktop connector → ChatGPT (operator accounts) → Codex OAuth. Record results in the ticket and mark KAN-57 accordingly.
- `llms-integration.txt` updated (it documents the auth surfaces; the "Auth0-only 403 surfaces" phrasing also needs the M6-era rename, but the MCP-OAuth capability is added now, pointing at canonical sources per the anti-drift rules).
- Ledger updated (DCR/entity-limit comparison vs Auth0's 10-app free-tier cap — the entry this project was partly motivated by).

---

## Milestone 6 — Production cutover (M6a), then decommission (M6b)

Two separately shipped halves. **M6a** puts web, CLI, and MCP on Clerk in production while the iOS app keeps using Auth0 through the dual-accept window. **M6b** — gated on the iOS app update shipping (separate repo, independent timeline) — removes Auth0 entirely. The split exists so the cutover (and the MCP OAuth win) is not blocked on the iOS developer.

### Goal & Outcome

**M6a — cutover.** Production runs web, CLI, and MCP on Clerk; iOS users notice nothing.

- Production import executed and reconciled; web and CLI users sign in via Clerk (one forced re-login per client, announced in advance).
- iOS keeps working against Auth0, resolving to the **same** accounts (dual-accept).
- New sign-ups happen exclusively in Clerk; no new Auth0 identity can be created for the remainder of the window.
- Window caveats, accepted and stated in the cutover email: an Auth0-side password change does not carry to Clerk, and users who sign up during the window cannot use the iOS app until its update ships. The window is bounded by the iOS timeline — keep it moving.

**M6b — decommission.** Auth0 is gone from code, config, schema, and vendor accounts; the system reads as if Clerk were there from day one.

- After iOS ships and soak completes: no `auth0_id` column, no Auth0 verification path, no `AUTH0_*`/`VITE_AUTH0_*` env vars, no `@auth0/auth0-react`, no Auth0-specific validator (including the cron-service `AUTH0_CUSTOM_CLAIM_NAMESPACE` requirement — cron Settings validation now keys on the Clerk equivalent), no Auth0 tenant.
- Security tests updated and run against production.
- All docs-to-keep-in-sync updated.

### Implementation Outline

**M6a — cutover** (order is load-bearing):

1. **Pre-flip**: operator sends the heads-up email; production Clerk instance + DNS verified live (from M3 prep); **close Auth0 sign-ups** (per the operator step — no new Auth0 identity creatable from here on); run the M2 import against production (dry-run, review report, real run, review report). The import must be complete and reconciled **before** the flip — a production Clerk login by an unimported user would JIT-create a fresh, empty account.
2. **Flip**: deploy frontend (Clerk env vars) + backend (dual-accept already live since M1). Verify login, CLI login, MCP connector, Chrome extension (PAT — should be unaffected; verify anyway), **and that an iOS (Auth0) login and a web (Clerk) login by the same user land on the same account**.
3. **Soak**: the Auth0-path log will *not* go quiet while iOS traffic continues — watch for Auth0-path authentications from any source other than `ios` (the M1 log line includes the request source for exactly this reason). Fix-forward anything that surfaces.

**M6b — decommission.** Gate: the iOS app update is shipped and adopted, **and** the Auth0-path log is quiet including `ios` (operator's call on the wait; at our user count, days once iOS is out). Then:
4. **Decommission change-set**: remove Auth0 verification branch + issuer routing's Auth0 arm (unknown issuer → 401 remains); remove Auth0 config/validators, replacing the "namespace required in non-dev" safety check with the Clerk-settings equivalent introduced in M1; migration to drop `users.auth0_id`, drop the M1 transitional identity CHECK constraint, and set `external_auth_id` NOT NULL; drop the transitional cache key/fallback from M1 and bump the cache schema version again; remove `CachedUser.auth0_id`; delete `TIDDLY_AUTH0_*` handling remnants in the CLI; remove `.env.example` Auth0 vars.
5. **Dev-mode synthetic user**: currently `auth0_id="dev|local-development-user"` — becomes an `external_auth_id` sentinel; keep the same shape/semantics, update `docs/architecture.md`'s mention.
6. **Security tests** (AGENTS.md obligation): update `backend/tests/security/` and `tests/security/deployed/` for the Clerk world (the deployed tests use PATs and should need little; anything asserting Auth0-specific 401/403 text or claims gets updated). Operator runs `test_live_penetration.py` against production.
7. **Docs sweep** (AGENTS.md "Files to Keep in Sync"): `docs/architecture.md` (§5 auth rewrite, diagram nodes, Redis key schema, "known drift risks"), `README_DEPLOY.md` (Step 6 → Clerk, env var tables, cron env vars), `README.md`, `AGENTS.md` (auth description), `.env.example`, `llms.txt` family where auth is described (`llms-integration.txt` "Auth0-only 403 surfaces" → renamed dependency family), `frontend/src/data/docsRoutes.tsx`/`settingsRoutes.tsx` searchText if auth-related pages changed terms. Mark `future-identities.md` superseded (AD2). 
8. **Ledger**: final pass — total effort per milestone, the complete gained/lost/neutral table. Operator deletes the Auth0 tenants (dev and prod) only after the hash export and user export are archived somewhere safe.

### Definition of Done

- M6a done: import reconciled to zero discrepancy; flip verified across web, CLI, MCP, and extension; iOS-on-Auth0 verified against the same accounts; Auth0 sign-ups closed. M6b done means everything below:
- `make tests` (full suite) clean; deployed security tests green against production (operator-run, results reported).
- Grep-level assertion: no case-insensitive `auth0` matches in code/config outside `docs/` history (implementation plans and the ledger legitimately reference it) and historical migration files (which are immutable — never edit old Alembic migrations; the *new* drop-column migration is the change).
- All sync-listed docs updated; ledger finalized.
- KAN-57 closed.

---

## Known limitations accepted (recorded, not to be "fixed" in this project)

- Interactive CLI login requires a browser on the CLI's machine; SSH/headless uses PATs (AD9).
- MCP OAuth grants are all-or-nothing (Clerk has no custom OAuth scopes yet) — parity with today's unscoped PATs, no regression.
- One forced re-login per client at its own cutover (web/CLI at M6a; iOS when its update ships). During the M6a→M6b window: Auth0-side password changes do not propagate to Clerk, and users who sign up during the window cannot use the iOS app until it ships.
- Clerk reliability posture: sign-ins depend on Clerk uptime (as with Auth0); networkless JWT verification means existing tokens keep verifying during a Clerk outage, but with ~60s session tokens the practical grace window for web sessions is about a minute. Accepted at current scale; revisit (e.g., tolerating slightly-stale tokens during incidents) only if it bites.
