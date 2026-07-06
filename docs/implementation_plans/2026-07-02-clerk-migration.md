# Auth0 → Clerk Migration

**Status**: Planned
**Date**: 2026-07-02
**Scope**: Web app, FastAPI backend, Postgres, Go CLI, MCP servers (adds OAuth — background and requirements in Appendix A; tracked internally as KAN-57). Out of scope: billing (Clerk Billing evaluated separately — open VAT/refunds questions), iOS app (separate repo; migrates on its own timeline after the M6a cutover — the M6b decommission is explicitly gated on it, and a high-level guide for its developer is maintained at `docs/ios-clerk-migration-guide.md`), Chrome extension (works unchanged through the migration on PATs; M7 then adds automatic session sync with the web app, PAT fallback retained).

## Context & Goals

Tiddly authenticates via Auth0 (web SPA tokens + CLI device flow) and app-managed Personal Access Tokens (`bm_` prefix). We are migrating the identity provider to Clerk. Beta scale (a handful of users) but **real user data that must not be lost** — content is keyed to internal UUIDv7 `users.id`, which never changes; only the identity *linkage* migrates.

Goals, in priority order:

1. Migrate all users (email/password + Google social) to Clerk with zero data loss and passwords preserved.
2. End state looks as if Clerk had been implemented from the start — **no Auth0 residue in code, config, or schema**, and provider-specific shape contained to a narrow seam (see Architecture Decisions).
3. Ship MCP OAuth (Appendix A) as part of the migration — unlocks ChatGPT and Claude Desktop native connectors.
4. Maintain a capability ledger documenting Auth0↔Clerk functional differences discovered during the work.
5. **Adopt, not just migrate**: the end state should include the capabilities a from-scratch Clerk build would obviously have (see "Adoption decisions" below) — this plan's charter is migrate *and* adopt. Deliberate exception: billing — the product isn't ready to charge, and nothing here forecloses it.

## Architecture Decisions (locked — do not relitigate during implementation)

These decisions came out of design discussion and cannot be recovered from the codebase. Each must survive into the code as comments/docstrings at the relevant seam, or into the ledger — not evaporate during implementation.

**AD1 — PATs stay app-managed through this migration; Clerk API Keys are a post-migration candidate.** The `bm_` token system (`services/token_service.py`, `models/api_token.py`) is untouched. PATs are the auth path for clients that can't or don't use OAuth: headless CLI, Chrome extension, scripts, non-OAuth MCP clients. Clerk's API Keys product (GA 2026-04) is the direct managed equivalent, and the long-term principle — offload credential storage, hashing, and leak-handling to the vendor — is sound. Adopting it *here* is rejected on sequencing and neutrality, not product quality: it would force every user to re-issue tokens (extension, scripts, MCP configs) inside an already-large migration, and it would forfeit the migration's cheapest de-risking property — PATs are the one auth surface crossing the cutover with zero churn, precisely because they are provider-neutral (the same neutrality would spare a future provider move). Arguments deliberately NOT relied on (first-pass reasoning, corrected on review — record in the ledger): per-verification metering is negligible at any plausible scale (~$10 per million requests); PAT traffic is not clearly the hottest path and shrinks after M5 moves OAuth-capable MCP clients off PATs; and the outage-resilience gap vs Clerk-issued JWTs (day-lived, verified locally against cached JWKS) is narrow — it matters only if API-key verification requires a live Clerk call, which is unverified. Post-migration follow-up: spike that verification model, per-user key caps, and what the verified payload exposes for the audit trail; if clean, replacing `token_service.py` with Clerk API Keys is a legitimate delete-owned-security-code simplification.

**AD2 — No `user_identities` table; one provider-neutral column.** `docs/implementation_plans/future-identities.md` planned a multi-identity table because Auth0 surfaces each login method as a distinct `sub`. Clerk performs account linking *inside the provider* (one Clerk user, many auth methods, one stable `user_id`), which obsoletes that plan. End state: `users.external_auth_id` (unique, indexed) storing the Clerk user ID — a neutral *name* ("the `sub` claim of verified IdP tokens") with a provider-specific *value*, which is unavoidable. Never parse or derive meaning from its format. `future-identities.md` gets a superseded-by note.

**AD3 — Divergence from Clerk's migration guide: no `external_id` session-token aliasing.** Clerk's guide suggests customizing the session token to emit `{{user.external_id || user.id}}` so backends can keep keying on old Auth0 subs indefinitely. That pattern exists for large userbases with untouchable code. We reject it: we control the backend and have a handful of users, so we do a clean lookup-column swap instead. The old Auth0 `sub` IS stored in Clerk's `external_id` at import time — but purely as an audit breadcrumb inside Clerk. **The application never reads `external_id`.**

**AD4 — Divergence from Clerk's migration guide: no trickle migration.** Clerk documents running both providers in parallel and migrating users on activity. At our scale this is machinery without payoff. We do: bulk import → backend dual-accept window → single coordinated client flip → soak → decommission.

**AD5 — Cutover = backend dual-accept, single frontend/CLI flip.** During the transition window the backend verifies JWTs from *both* issuers (routing on the token's `iss` claim); both paths resolve to the same `users.id` row (Auth0 tokens via `auth0_id`, Clerk tokens via `external_auth_id`), so a user mid-transition (web on Clerk, CLI on a lingering Auth0 refresh token) sees one consistent account. The two columns coexist **only** during this window; the decommission (M6b) drops `auth0_id`. The window deliberately spans the iOS app's independent migration: M6a flips web/CLI/MCP to Clerk in production while iOS keeps authenticating via Auth0; M6b is gated on the iOS update shipping. Two window rules follow: (1) the production import must be complete before the first production Clerk login — an unimported user would JIT into a fresh, empty account; (2) no new Auth0 identities may be created once sign-up moves to Clerk — otherwise the same person can end up with two unlinked accounts (one per provider).

**AD6 — Neutral naming at the small leaks.** `AuthType.AUTH0` → `AuthType.SESSION` (mechanism-descriptive, covers both issuers during dual-accept; a future provider swap doesn't touch it). Redis auth-cache key segment `auth:vN:user:auth0:{id}` → `auth:vN:user:ext:{id}` with a schema-version bump. Historical `content_history.auth_type` rows keep the literal `"auth0"` — audit rows describe what was true at the time; do not backfill.

**AD7 — Backend verifies Clerk session tokens with the existing PyJWT/JWKS pattern, not the Clerk SDK, on the hot path.** Clerk session tokens are standard RS256 JWTs verified against a JWKS endpoint — the same shape `core/auth.py::decode_jwt` already handles. Key differences from Auth0: tokens are short-lived (~60s, auto-refreshed by clerk-js) and carry **no audience**; the equivalent check is `azp` (authorized party) against an allowlist of our web origins. The official `clerk-backend-api` Python SDK is used only where the Backend API is genuinely needed (the import script in M2). Rationale: consistency with existing code, no new dependency on the request path, networkless verification keeps existing sessions working during a Clerk outage.

**AD8 — Auth cache keys on `sub`, not on raw token.** Already true today (cache is keyed by `auth0_id`/`user_id`, not token) — preserve this. With 60-second Clerk tokens, any token-keyed cache would be useless; the sub-keyed design is why the 5-min TTL survives the migration unchanged.

**AD9 — CLI: device flow → authorization code + PKCE with loopback callback; PATs are the headless story.** Clerk does not support RFC 8628 device authorization (verified against OAuth server metadata, Clerk's own CLI-auth blog, and their public roadmap where it is backlog-only). The replacement is the `gh auth login` pattern: ephemeral listener on `127.0.0.1`, browser to Clerk's `/oauth/authorize` with PKCE (S256), code exchange at `/oauth/token`, tokens in the OS keyring. This loses true remote/SSH interactive login (browser must run on the same machine as the CLI); the documented fallback is `tiddly login --token bm_...`, which already works and does not change.

**AD10 — MCP servers stay thin bearer-passthrough proxies.** MCP OAuth is implemented exactly as sketched in Appendix A, with Clerk substituted for Auth0 as the authorization server: each MCP server adds one static discovery endpoint (`/.well-known/oauth-protected-resource`) pointing at Clerk; Clerk handles DCR, login, consent, and token issuance; the MCP servers keep forwarding whatever bearer arrives; the **backend API** is the only component that verifies tokens. Bearer/PAT auth remains supported (a must-have requirement — Appendix A).

**AD11 — Capability ledger.** `docs/auth0-clerk-ledger.md` is a living document, seeded in M0 and updated in every milestone's Definition of Done. Entry shape: capability · how Auth0 does it · how Clerk does it · what migrating took · gained/lost/neutral · gotchas (including "possible on both, but…" nuances and divergences from Clerk's own guides, per AD3/AD4). This is the raw material for a later external writeup; be blunt in it.

## Adoption decisions (the migrate-and-adopt register)

Capabilities Clerk makes cheap that Tiddly never built (or chose differently). Each gets an explicit status here so nothing sits as an ambiguous "if." Tier facts verified against clerk.com/pricing (2026-07): the free (Hobby) tier lacks MFA, passkeys, and branding removal, and fixes session lifetime at 7 days; Pro is $25/month.

| Capability | Decision | Notes |
|---|---|---|
| Account deletion | **Adopt — M8** | Immediate hard-delete. Rationale: deletion starts in Clerk's UI, so the identity is gone before our webhook fires — a "log back in to cancel" grace period is impossible without owning the whole flow ourselves, which defeats using the free component. Clerk's component owns the confirmation UX; content-level trash (soft-delete + 30-day sweep) is unaffected. |
| MFA | **Adopt as optional — M8** | Enforcement happens inside Clerk's sign-in ceremony before any session exists, so the backend is untouched; enrollment UI ships in `<UserProfile />`. Requires Pro. "Required-for-all" enforcement is a later product call. |
| Clerk plan tier | **Pro at M6a cutover (recommended; operator confirms)** | MFA + branding removal + custom session lifetime (free tier's fixed 7-day session means weekly re-login). Dev instance stays free. |
| Opaque tokens for the MCP path | **Declined — JWT kept (AD7)** | Agents are the chattiest clients; per-request verification calls add latency and couple the agent path to Clerk availability. Narrow the revocation window via OAuth token lifetime (spike Q2) instead; the blunt emergency fallback (revoke the grant and sessions) always works. Revisit only on real agent abuse. |
| Passkeys | **Deferred** | Pro-tier; solves a problem we don't have (one password user + Google). Can be enabled later with no architectural consequence. |
| Authorized-apps management UI | **Rides open question 12** | Free if `<UserProfile />` includes it; else a small post-M5 build against Clerk's API. |
| Billing (Clerk Billing / Stripe) | **Deferred — product readiness** | The charter's stated exception; deliberately decoupled (plus the open VAT/refunds questions). |
| Orgs / B2B | **Deferred — ledger Q13** | Newly verified: basic organizations up to 20 members are free on all plans; $100/month is the *enhanced* add-on. Relevant when teams reach the roadmap. |

## Required Reading (before implementing — do not code from memory of Clerk's API)

- Migration path & import: https://clerk.com/docs/deployments/migrate-overview · https://clerk.com/docs/reference/backend/user/create-user · https://github.com/clerk/migration-tool (reference for export parsing; we script our own)
- Auth0 hash export process (optional — superseded by the M0 no-hash-export decision; kept for the ledger exercise): https://support.auth0.com/center/s/article/How-to-Use-the-Password-Hashes-Export-from-Auth0
- Session tokens & verification: https://clerk.com/docs/guides/sessions/session-tokens · https://clerk.com/docs/guides/sessions/manual-jwt-verification · https://clerk.com/docs/guides/sessions/customize-session-tokens
- Social account linking (Google users): https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking
- Clerk as OAuth provider (CLI + MCP): https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth · https://clerk.com/docs/guides/configure/auth-strategies/oauth/scoped-access · https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens · https://clerk.com/blog/adding-clerk-auth-to-your-cli
- MCP auth: https://modelcontextprotocol.io/specification/draft/basic/authorization (RFC 9728 protected-resource metadata) · https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server (Node reference — we port the *shape*, not the code)
- React SPA & production deploy: https://clerk.com/docs (React quickstart) · https://clerk.com/docs/guides/development/deployment/production · https://clerk.com/docs/guides/development/managing-environments
- Python SDK (M2 import script only, per AD7): https://pypi.org/project/clerk-backend-api/
- Chrome extension (M7): https://clerk.com/docs/guides/sessions/sync-host · https://clerk.com/docs/reference/chrome-extension/create-clerk-client · https://clerk.com/docs/guides/development/deployment/chrome-extension
- MCP OAuth background, platform matrix, and requirements: Appendix A (self-contained; no internal-tracker access needed)

**Rule — external-system claims.** Anything this plan asserts about systems outside this repo (Clerk's behavior or configuration, the iOS app) must be verified against the primary source or recorded as an open question with a named owner — never stated as settled. Verification isn't only fetching: one review-caught error (the `syncHost` value, M7) was transcribed wrong from a correctly-fetched doc, so also check written values against the quoted source.

## Operator (human) steps — the agent cannot do these

Flagged inline per milestone, collected here so nothing blocks silently:

- **M0**: **Decision (recorded)**: we are NOT requesting Auth0's password-hash export. Tiddly has exactly one password-based user, who will be imported without a password and coordinated with directly (see M2 and the M6a email). This removes the project's only fixed external wait. Optionally, file the hash-export support ticket anyway purely to document Auth0's export friction firsthand for the ledger — nothing in the plan depends on it. Create the Clerk **application** — Clerk's model is one application with two paired **instances** (a development instance, created automatically with `pk_test_`/`sk_test_` keys and localhost support, and a production instance activated later in M3; unlike Auth0's two independent tenants). On the dev instance: enable email/password + Google auth strategies, and configure the session-token custom claims (email + verification status, exact shortcodes per the spike). Instance caveats that shape later milestones: **users never transfer between instances** (dev has a throwaway user pool; the real M2 import targets production), and per-instance settings (Google OAuth credentials, OAuth apps, DCR) must be configured on each instance — `clerk deploy` clones dev config to prod to reduce hand-replication.
- **M2**: Run the self-serve Auth0 bulk user export (no hash export — per the M0 decision).
- **M3**: Activate the Clerk production instance (of the M0 application; `clerk deploy` clones the dev-instance config); DNS CNAME records on tiddly.me (DNS-only, not proxied; up to 48h propagation); reuse the existing Google OAuth credentials with Clerk's redirect URI (prod instance requires real credentials — the dev instance used Clerk's shared ones); set Railway env vars. **Immediately after activating the production instance, restrict its public sign-up surface** (Clerk's restricted sign-up mode or equivalent — exact mechanism per ledger question 16) and keep it restricted until M6a's import completes and reconciles: the instance sits live-but-unlinked for weeks across M4–M8, and a walk-in sign-up with an email matching an existing Tiddly user would collide with the import's email-based idempotency. M6a's flip re-opens sign-ups. **The step-by-step operator walkthrough for all of this is an M3 deliverable**: the README_DEPLOY.md "Step 6: Configure Auth0" section gets a Clerk replacement (drafted in M3 while fresh, finalized in M6's docs sweep) — this plan intentionally does not duplicate that walkthrough. Calibration for the replacement: **exhaustively specific about WHAT must exist in Clerk** (every setting, value, and which instance it belongs to), with general dashboard direction only ("Dashboard → Sessions → Customize session token"-level) — not click-by-click UI paths, which rot as the dashboard changes (parts of the old Auth0 Step 6 demonstrate this).
- **M4**: Create the Clerk OAuth application for the CLI (public client, PKCE) — **with JWT access-token format enabled** (the backend's networkless verification, AD7, depends on it; opaque tokens 401 with the M1 warning log). Create it on **both instances**: dev for milestone testing, prod for cutover (the prod app has a different client_id — the CLI's hardcoded default config points at prod, env overrides point at dev, mirroring today's `TIDDLY_AUTH0_*` pattern).
- **M5**: Enable dynamic client registration and **confirm DCR-registered clients issue JWT access tokens** (per the M0 spike finding on where the format setting lives) — on both instances, same dev/prod split as M4; test connectors from Claude Desktop / ChatGPT accounts.
- **M6a**: Send the cutover email (web/CLI re-login required; iOS unaffected for now; note that password changes made on the Auth0/iOS side won't carry to Clerk during the window). Coordinate directly with the single password-based user: their first Clerk sign-in means setting a fresh password or using an email code (or just "Sign in with Google" if their email matches) — a one-message heads-up. Close Auth0 sign-ups: turn off sign-ups on the Auth0 DB connection and block first-time social sign-ins with a small post-login Action — the requirement is that no new Auth0 identity can be created after the flip. Confirm with the iOS app's owner that it sends `X-Request-Source: ios` (the backend docstring lists `ios` as an expected first-party value, but that is a claim about a separate repo — verify, don't assume); without it, iOS traffic logs as `unknown` and the M6b quiet-gate is unreadable.
- **M6b** (gated on the iOS app update shipping): run the deployed security tests against production; decommission **both Auth0 tenants** (dev and prod).
- **M8**: Configure the `user.deleted` webhook **on both Clerk instances** (dev and prod — separate endpoint URLs and separate signing secrets, one env var per environment; the dev-instance manual test is impossible without it); enable MFA strategies (authenticator app + backup codes). MFA requires Pro to already be active — the Pro upgrade itself is owned by M6a's pre-flip steps, not M8.
- **M7**: Allowlist the extension's origin on the Clerk instances **merge-safely**: fetch the instance's current `allowed_origins`, append the missing `chrome-extension://<EXTENSION_ID>` value, and PATCH the complete intended array back (PATCH replaces the array — a single-value call would clobber existing origins). Do this per instance; the unpacked dev build's ID differs from the published Web Store ID. Publish the updated extension to the Chrome Web Store **only after M6a** — the added `cookies` permission and new host permissions trigger a store review cycle and may prompt users to re-approve.

## Environment & testing strategy (Railway hosts production only — no permanent staging)

There is no dev/staging Railway environment, and none needs to be created. Day-to-day local development runs `VITE_DEV_MODE=true` (auth bypassed), but the **established auth-testing workflow** is the full stack locally with `VITE_DEV_MODE=false` against a **dev Auth0 tenant** (a separate tenant from prod; not documented in README_DEPLOY, which covers only the prod tenant). The migration reuses exactly that workflow, with Clerk's dev instance taking the dev tenant's role:

- **M0–M4: full stack locally with real auth.** Same local real-auth setup as today, pointed at the Clerk **dev instance** (`pk_test_`/`sk_test_` keys; Clerk dev instances work on localhost with no DNS records). M1's dual-accept is testable entirely locally by configuring the dev Auth0 tenant and the Clerk dev instance side by side — verify a dev-tenant Auth0 token and a Clerk token resolve to the same local user row. Required non-dev settings (`AUTH0_CUSTOM_CLAIM_NAMESPACE` until M6, Clerk settings from M1) stay set in the local env as today. The CLI's loopback OAuth (M4) is inherently localhost-friendly (`TIDDLY_AUTH0_*`-style env overrides already exist for pointing the CLI at a non-prod tenant; the Clerk equivalents replace them in M4).
- **M2: rehearse the import against a restored production backup.** Restore a prod Postgres backup into local Postgres and run the import (dry-run first) against the Clerk dev instance. This is the data-risk rehearsal; the production run in M6 must not be the first full-fidelity run.
- **M5: connector testing needs a public HTTPS URL** (ChatGPT/Claude Desktop cannot reach localhost). Default: tunnel the locally-running MCP servers (e.g. cloudflared/ngrok). Fallback if a connector client rejects tunnel domains: temporarily duplicate the Railway environment (Railway supports isolated environment copies within a project) and tear it down after.
- **M7 dev-tests locally too**: unpacked extension + local web app on the Clerk dev instance with `syncHost: "http://localhost"` — signing in on the local web app authenticates the extension. (Verified against Clerk's Sync Host docs: development instances are fully supported; an earlier research summary claiming production-only testing was wrong.)
- **M6a has no staging rehearsal — by design.** The mitigations are the dual-accept window (backend accepts both issuers, so the old frontend keeps working), Railway deployment rollback (re-deploy the prior frontend build to revert the flip), and soak-before-decommission (the Auth0 code path is only deleted after production has proven the Clerk path). The production Clerk instance and its DNS records (M3 prep) are additive and can be created/verified without touching the running app.

---

## Milestone 0 — Spike, dev instance, and ledger

### Goal & Outcome

De-risk the medium-confidence findings from research before any production code changes, and start the ledger.

- A Clerk dev instance exists and a throwaway script proves: FastAPI can verify a real Clerk session token via PyJWT+JWKS with an `azp` check; a custom email + email-verified claim appears in the session token; a Clerk OAuth app issues JWT access tokens verifiable against the same JWKS.
- Open questions answered and recorded: exact claim names/shortcodes for email + verification status; OAuth access-token default lifetime and whether refresh tokens require a scope to be issued; how Clerk meters/limits DCR-registered clients (Auth0's free tier caps at 10 applications — Appendix A flags DCR spam risk; confirm Clerk's equivalent posture); shape differences between session-token claims and OAuth access-token claims (`sub` present in both? email present in OAuth tokens?); **whether OAuth access tokens arrive JWT-formatted for both operator-created OAuth apps and DCR-registered clients, and where the JWT-vs-opaque format setting lives (per-app vs instance)** — the backend's issuer-routed dispatch requires JWTs (Clerk supports an opaque format, which would 401; see M1 step 3 and the M4/M5 operator steps). Do not build an opaque-token verification path — it would reintroduce the Backend-API-on-the-hot-path dependency AD7 rejects; JWT format is a configuration requirement. Additionally, verify the first-login experience for a user imported without a password (the M2 approach for our one password user): confirm in the dev instance whether Clerk's forgot-password flow lets a never-had-a-password user set their first password, and enable email-verification-code sign-in as the alternative if not. Also verify how session tokens minted by Clerk's **native iOS SDK** present the `azp` claim — an iOS app has no web origin, so the backend's authorized-parties allowlist may need a different value (or a tolerance for absent `azp`) for iOS traffic; record the answer in ledger question 11 and in `docs/ios-clerk-migration-guide.md`. Finally, enumerate what Clerk's `<UserProfile />` component and hosted Account Portal actually expose to end users — password change, active sessions/devices, connected accounts, authorized-OAuth-application listing/revocation, account deletion — and whether individual sections can be hidden or configured (ledger question 12); the answers set the guard rails for M3's new account-settings page. And confirm the tier-gating of the **OAuth Applications** feature (and consent-screen customization): the pricing page doesn't mention it, and M4/M5 depend on it being available on our plan (ledger question 14).
- `docs/auth0-clerk-ledger.md` created and seeded with the already-known entries (device-flow absence, no custom OAuth scopes, no client_credentials, hash-export-by-ticket vs Clerk self-serve export, session-token model differences, account-linking behavior, AD3/AD4 divergences, `future-identities.md` obsolescence, and the AD1 Clerk-API-Keys analysis including its corrected first-pass overstatements).

### Implementation Outline

Spike code is throwaway — a script or scratch test hitting the dev instance; do not integrate into `core/auth.py` yet. The deliverables are the answered questions (recorded in the ledger and in this plan's margins) and the ledger doc itself. Operator steps: Clerk dev application and dashboard session-token customization (the hash-export ticket is optional and non-blocking per the operator-steps decision).

### Definition of Done

Small milestone — proportionally: spike answers written into the ledger; ledger committed. No production code changed, no tests required beyond the spike itself running.

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

1. **Migration** (`make migration message="..."` — never hand-write): add `users.external_auth_id`, `String`, nullable, unique, indexed; **alter `auth0_id` to nullable** (it is NOT NULL today, which would make Clerk JIT provisioning impossible — a new Clerk-only user has no Auth0 sub); add a named transitional CHECK constraint `(auth0_id IS NOT NULL) OR (external_auth_id IS NOT NULL)` so the core identity invariant is enforced at the database, not only in application logic, during the window. (Alembic autogenerate does not detect CHECK constraints — migration `5fd6c03a4e43` in this repo hand-adds one and is the template.) M6 drops both `auth0_id` and this constraint and sets `external_auth_id` NOT NULL — end state unchanged.
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
- **Security review (deep — this is the token-verification core everything downstream trusts)**, run against the milestone's diff: issuer confusion on the unverified-`iss` dispatch (a token from one issuer must never validate against the other's keys — the dispatch only *selects* the verifier; the selected verifier still enforces everything); claim-enforcement parity between the two issuer paths (signature, `exp`, azp-or-audience each strict in both); JIT-provisioning abuse (what does a valid-but-unusual Clerk token create?); cache poisoning across the schema bump; the dev-mode bypass guard still holds.
- Ledger updated (e.g., azp-vs-audience entry). `docs/architecture.md` §5 updated to describe dual-accept as the *current* state.

---

## Milestone 2 — User import & backfill

### Goal & Outcome

Every existing Auth0 user exists in Clerk with working credentials, and every Postgres user row is linked to its Clerk user.

- The password user completes their first Clerk sign-in (new password via forgot-password, or email code — per the M0 spike finding) with **all data intact**. Password credentials are deliberately not preserved (the M0 no-hash-export decision); the cutover email says so.
- Google users are imported with verified emails so Clerk's account linking silently attaches their Google login on first sign-in.
- Every imported Clerk user carries `external_id` = the old Auth0 `sub` (audit breadcrumb only, per AD3).
- `users.external_auth_id` is populated for every row; a verification report proves the mapping is total and 1:1.

### Implementation Outline

A one-off, idempotent Python script (location per repo conventions; it is repo code, typed and reviewed like any other) using `clerk-backend-api` (the one sanctioned SDK use, per AD7). Input: the Auth0 bulk user export (self-serve; operator supplies). Per the M0 decision, **no password-hash export is used**: the single password-based user is imported without a password via `skip_password_requirement: true` — permitted because password is not the instance's only sign-in method (Google is enabled; verified against the CreateUser reference) — and completes first sign-in per the M0 spike finding (forgot-password sets a first password, or email-code sign-in).

Contract and edge cases decided in discussion:

- For each Auth0 user: create Clerk user with primary email **marked verified** (this is what makes Google account-linking silent — if left unverified, Clerk prompts or blocks linking) and `external_id` = full Auth0 `sub` string. Password users (`auth0|` subs) get `skip_password_requirement: true` per the M0 decision; `google-oauth2|` users import email-only as they always would. (Clerk's bcrypt `password_digest` import path exists and is recorded in the ledger; it is deliberately unused here.)
- A user may appear in the export as *both* `auth0|` and `google-oauth2|` subs with the same email (Auth0 kept them as separate users unless linked). The dry-run **pre-classifies every email collision against Postgres** before any Clerk user is created: zero DB rows → log and skip; exactly one DB row → create one Clerk user mapped to that row (`external_id` = the sub stored in `users.auth0_id`), logging the discarded sub; **two or more DB rows → hard preflight failure naming the accounts** — one human with two data-bearing Tiddly accounts is a manual merge/ownership decision the script must never guess. (Note: the backfill's existing no-match hard-fail would already catch this case — the classification's value is making the failure *legible and early*, telling the operator which decision is pending, rather than an opaque unmatched-row error.)
- Backfill: match each `users.auth0_id` row to its created Clerk user, write `external_auth_id`. Any Postgres row without a match, or Clerk user without a row, is a **hard failure** printed in the report — never guess-match by email at write time.
- `--dry-run` prints the full intended mapping without writing to Clerk or Postgres. Idempotency: re-runs must not duplicate (look up by `external_id`/email before create). Handle Clerk 429s with backoff — don't crash mid-import.

**First sign-in experience for the imported password user** (this is what the M6a email describes and the M0 spike tests): their old password exists only inside Auth0, which nothing consults after the flip — their Clerk account starts with no password at all. On their first visit they have three ways in. (a) Click "Forgot password?": Clerk automatically emails them a six-digit code — proving they can read that inbox *is* the identity check — then they enter the code, choose a new password, and are signed in. (b) If the M0 spike shows path (a) doesn't serve accounts that never had a password, we enable Clerk's email-code sign-in instead: enter email, receive a code, signed in, no password involved. (c) Click "Sign in with Google": instant, because their email was imported as verified, so Clerk attaches the Google login to their existing account. In every path the account and all its data are untouched — same account, new credential. The application sends no emails for any of this; Clerk sends the codes itself.

Run order: dry-run against dev instance → real run against dev instance with a test export → (M6a cutover) real run against production instance.

### Definition of Done

- Unit tests for the export-parsing and collision/mapping logic (the API-calling shell can be thin and untested; the decision logic must be tested — this script is the single highest-data-risk artifact in the migration).
- Dev-instance end-to-end: import a fixture export; complete a no-password user's first sign-in (via whichever path the M0 spike confirmed — forgot-password setting a first password, or email-code); sign in with Google on a verified-email user and confirm silent linking; confirm `external_auth_id` backfill.
- Verification report format finalized (counts: exported, created, skipped-as-duplicate, backfilled; must reconcile to zero discrepancy). The report also lists any **pre-existing Clerk users on the target instance that the export doesn't account for** — unexpected walk-in accounts are a hard failure unless explicitly named as operator/test accounts (see the M3 sign-up restriction).
- Unit test: the multi-row same-email collision classification (≥2 DB rows → hard preflight failure).
- **Security review (operational as much as code)**: custody of the user-export file and the Clerk secret key; the script must not log secrets or more PII than the reconciliation report needs. The M0 no-hash-export decision deleted this review's worst item — no password-hash file exists. (If the optional ticket is ever exercised, full hash-file custody rules apply: never logged anywhere including dry-run output, archival location named, every other copy deleted.)
- Ledger updated (hash-export friction, account-linking behavior, dual-sub collision handling).

---

## Milestone 3 — Frontend flip

### Goal & Outcome

The web app authenticates exclusively through Clerk. This milestone is code-complete and dev-instance-tested before any production flip (which happens in M6).

- Sign-up, sign-in (email/password + Google), sign-out, and session persistence work through Clerk.
- Authenticated API calls carry a Clerk session token; the 401-retry-then-logout behavior is preserved under the new token model.
- Dev mode (`VITE_DEV_MODE`) still bypasses auth entirely, exactly as today.
- Consent (451) flow, protected routes, and the post-login return-to-origin redirect behave identically.
- **New capability, not parity**: users get a self-service account page (password change, security/session management) — functionality Tiddly never had, because Auth0 shipped no end-user account UI and building one never justified itself.

### Implementation Outline

A provider seam exists for auth *status* only (`AuthProvider.tsx` → `AuthStatusProvider` → `useAuthStatus()`). Auth *actions* and user-profile reads do NOT go through it: seven files import `useAuth0` directly for `loginWithRedirect`/`logout`/`user` — `PublicHeader.tsx`, `SaveACopy.tsx`, `SidebarUserSection.tsx`, `Pricing.tsx`, `LandingPage.tsx`, `FeaturesPage.tsx`, and `SettingsGeneral.tsx` (which also reads `user?.email` off the SDK object). The full seam is therefore a *target state this milestone builds*, not something that exists:

0. **First step**: extend the seam to cover actions + user fields (login/logout/email — whatever the seven call sites actually need, judged against their code), migrate all seven onto it, and enforce the boundary with an ESLint `no-restricted-imports` rule so only `AuthProvider.tsx` may import the auth-provider SDK — wired into `frontend-verify`, not a one-time check. This can (and should) be done and merged *against Auth0 first*, before the SDK swap — it's a pure refactor that shrinks the risky change.

1. Replace `@auth0/auth0-react` with `@clerk/clerk-react` in `AuthProvider.tsx`. Login/signup UI: use Clerk's prebuilt components/modal (we currently delegate UI to Auth0's hosted page; prebuilt Clerk components are the equivalent least-custom-code choice). `userId` comes from Clerk's user id (replaces `user?.sub`).
2. `config.ts`: `VITE_CLERK_PUBLISHABLE_KEY` replaces the three `VITE_AUTH0_*` values. Preserve the existing semantic that a missing key falls back to dev mode (`isDevMode`), including its test.
3. `services/api.tsx` interceptor: `getToken()` per request (clerk-js serves a cached ≤60s token and refreshes in the background — this *replaces* the Auth0 refresh-token machinery; there is no client-held refresh token anymore). The 401-retry path forces a fresh token (Clerk's skip-cache option) once, then falls to `onAuthError` → `signOut()` + the existing consent/queryClient cleanup. The shared-refresh-promise dedup may simplify or disappear — judge against the actual interceptor code, but the observable contract (one retry, then logout) must hold.
4. Post-login redirect: preserve the `toSafeReturnTo` sanitization on whatever Clerk's redirect-completion hook provides.
5. Keep the Auth0 npm package and env vars until M6 removes them repo-wide? **No** — this milestone removes the frontend's Auth0 dependency outright (the frontend can only speak one provider; dual-accept lives in the backend, per AD5). What M6 removes is the *backend* Auth0 path and deploy config.
6. Operator: production-instance DNS + Railway env vars are prepared here but the production flip itself is executed in M6.
7. **Account-management settings page (new capability)**: mount Clerk's `<UserProfile />` as a settings page (Settings → Account) rather than linking out to the hosted Account Portal — same prebuilt UI, but users stay inside the app, consistent with the existing settings pattern (the portal link-out is the fallback if mounting has friction). **Guard rail**: per the M0 spike's section enumeration (ledger question 12), do NOT expose an account-deletion section unless deletion is properly wired end-to-end (Clerk `user.deleted` webhook → backend cascade delete) — a Clerk-side deletion without backend handling deletes the identity while orphaning all the user's data in Postgres. Hide or configure that section away until a real deletion story exists. Add the new page to `frontend/src/data/settingsRoutes.tsx` (command-palette search index, per AGENTS.md).

Edge case from discussion to verify explicitly: laptop-sleep / long-idle tab followed by an API call must transparently get a fresh token (this is a *behavioral improvement* over Auth0's expired-cached-token dance — confirm, and note in ledger).

### Definition of Done

- `AuthProvider.test.tsx` and interceptor tests rewritten for the Clerk contract (mock `@clerk/clerk-react` as the Auth0 hooks are mocked today): token attach, 401-retry-once, logout-on-repeat-failure, dev-mode bypass, safe-return-to. Component tests for the seven migrated call sites mock the seam hook instead of the SDK (a test-quality improvement — they stop caring which provider is behind it).
- The `no-restricted-imports` lint rule is active in `frontend-verify` and passing; a grep confirms the provider SDK is imported only in `AuthProvider.tsx`.
- `make frontend-verify` clean. Manual dev-instance pass: email/password login, Google login, logout, consent dialog on fresh user, protected-route redirect; account settings page renders and a password change works end-to-end; confirmed no account-deletion section is reachable (unless the deletion path was wired).
- No backend tests run for this milestone (frontend-only change).
- README_DEPLOY Step 6 (Auth0 setup) replacement drafted for Clerk (full docs sweep lands in M6, but deployment steps are written while fresh). Ledger updated (session model entry, prebuilt-components-vs-hosted-page entry).
- `docs/ios-clerk-migration-guide.md` completed: every `[OPEN]` marker resolvable by M3 (publishable keys, claim names, the native-`azp` answer, backend contract) is filled in — the guide is deliverable to the iOS developer at the end of this milestone, so their work can proceed in parallel with M4/M5.

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
- **Security review**, two parts: (a) a **policy decision answered deliberately, not by default** — do Clerk OAuth access tokens (day-lived, programmatic) count as session auth on the PAT-blocked surfaces (`/tokens/*`, the SSRF-sensitive fetch-metadata, AI endpoints)? Parity with today argues yes — the CLI's Auth0 device-flow JWTs already pass those checks — but record the decision and rationale in code where the check lives. (b) The loopback listener: binds `127.0.0.1` only, PKCE + `state` implemented correctly, and the listener terminates once the flow completes or times out.
- Docs: CLI docs + `llms-cli-instructions.txt` updated where they describe login (mention the SSH/PAT story). Ledger updated (device-flow gap entry finalized with actual effort/UX notes — this is the headline entry).

---

## Milestone 5 — MCP OAuth (Appendix A)

### Goal & Outcome

MCP clients that require OAuth can connect to Tiddly's MCP servers with a paste-the-URL experience; bearer/PAT auth keeps working.

- Claude Desktop native Connectors and ChatGPT can add `https://<content-mcp>/mcp` and `https://<prompt-mcp>/mcp`, complete a browser sign-in, and use the tools.
- Existing bearer-token MCP configs (Claude Code, Codex, `tiddly mcp configure` output) keep working untouched.
- Unauthenticated MCP requests return 401 with the discovery metadata pointer, per spec, so OAuth-capable clients can bootstrap.

### Implementation Outline

Per AD10, the servers stay proxies; Appendix A's requirements are the shape. For each MCP server:

1. Serve the protected-resource metadata (static JSON: `resource` = that server's public URL, `authorization_servers` = [Clerk domain], `bearer_methods_supported: ["header"]`). Each server states its own `resource` — config-driven, since the two servers have different domains. Serve **`GET` and `OPTIONS` with permissive CORS** (browser-based clients preflight), at **both** the root well-known path (`/.well-known/oauth-protected-resource`) and the path-suffixed variant (`/.well-known/oauth-protected-resource/mcp`) — client implementations differ on which they request.
2. **This is new HTTP-layer auth gating, not a realignment — and it is the riskiest piece of M5.** Neither server rejects unauthenticated requests at the HTTP layer today: the content server fails at tool-invocation time (`_get_token` → FastMCP `ToolError`), and the prompt server's `AuthMiddleware` only *stages* the token into a contextvar, rejecting nothing. Add ASGI-level, pre-dispatch bearer checks to both: a missing `Authorization` header on the MCP endpoint → HTTP 401 with `WWW-Authenticate: Bearer resource_metadata="<metadata-url>"` (RFC 9728 §5 — this is what triggers client OAuth bootstrap) *before* any MCP/JSON-RPC handling. **Presence-only at the proxy**: a present-but-invalid bearer flows through and fails at the backend API, which remains the only verifier (AD10) — state this boundary in code. Existing bearer clients send the header on every request and never hit the gate; regression-test that explicitly rather than assuming it.
3. Testing-ladder checkpoint: if MCP Inspector / Claude Desktop / ChatGPT probe `/.well-known/oauth-authorization-server` on our origins (some older clients do), decide then whether to proxy/redirect it to Clerk's — don't build it speculatively.
4. Operator: enable dynamic client registration on the Clerk instance (JWT token format confirmed per operator steps). Note the M0 spike's answer on DCR client metering here.
5. Backend token verification: **no new work** — Clerk OAuth access tokens were accepted in M4. The MCP servers forward the bearer exactly as today.
6. `tiddly mcp configure` stays as-is this milestone (it writes bearer configs, which remain valid). Whether its docs/help should mention the OAuth path for Desktop/ChatGPT: yes, one line — the CLI is no longer the only setup path, per discussion.

### Definition of Done

- Tests, per server: no-bearer request → 401 with the correct `WWW-Authenticate` header before MCP dispatch; bearer-present request (valid or invalid) passes the gate and reaches the proxy path unchanged; metadata content + CORS headers on GET/OPTIONS for both path variants. Regression: existing bearer-extraction tests untouched and passing, plus an explicit end-to-end check that a `tiddly mcp configure`-style bearer config works from the first request.
- Manual verification ladder (Appendix A's platform matrix): MCP Inspector → Claude Desktop connector → ChatGPT (operator accounts) → Codex OAuth. Record results against the matrix; operator updates the internal tracking ticket.
- **Security review (deep — the first new unauthenticated HTTP surface since public shares)**: the metadata endpoints disclose nothing beyond the spec fields (permissive CORS is required, so *content* is the only control); the 401 gate cannot be bypassed to reach tool dispatch; DCR abuse — registration spam (informed by the M0 metering answer) and consent-screen phishing via attacker-chosen client names (check what Clerk's consent page actually shows users); and the proxy boundary did not quietly become a verifier (AD10). Update `backend/tests/security/` in this milestone (AGENTS.md obligation — this milestone changes API-facing auth), not only at M6.
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

1. **Pre-flip**: operator sends the heads-up email; production Clerk instance + DNS verified live (from M3 prep); **upgrade the production instance to Pro** (per the adoption register — this is owned here, not by M8, precisely so an M8 slip can't cause a silent free-tier cutover with 7-day forced re-logins and Clerk branding); **close Auth0 sign-ups** (per the operator step — no new Auth0 identity creatable from here on); run the M2 import against production (dry-run, review report, real run, review report). The import must be complete and reconciled **before** the flip — a production Clerk login by an unimported user would JIT-create a fresh, empty account.
2. **Flip**: **re-open production Clerk sign-ups** (restricted since M3 activation precisely so no walk-in accounts could collide with the import), then deploy frontend (Clerk env vars) + backend (dual-accept already live since M1). Verify login, CLI login, MCP connector, Chrome extension (PAT — should be unaffected; verify anyway), **and that an iOS (Auth0) login and a web (Clerk) login by the same user land on the same account**.
3. **Soak**: the Auth0-path log will *not* go quiet while iOS traffic continues — watch for Auth0-path authentications from any source other than `ios` (the M1 log line includes the request source for exactly this reason). Fix-forward anything that surfaces.

**M6b — decommission.** Gate: the iOS app update is shipped and adopted, **and** the Auth0-path log is quiet including `ios` (operator's call on the wait; at our user count, days once iOS is out). Then:
4. **Decommission change-set**: remove Auth0 verification branch + issuer routing's Auth0 arm (unknown issuer → 401 remains); remove Auth0 config/validators, replacing the "namespace required in non-dev" safety check with the Clerk-settings equivalent introduced in M1; migration to drop `users.auth0_id`, drop the M1 transitional identity CHECK constraint, and set `external_auth_id` NOT NULL; drop the transitional cache key/fallback from M1 and bump the cache schema version again; remove `CachedUser.auth0_id`; delete `TIDDLY_AUTH0_*` handling remnants in the CLI; remove `.env.example` Auth0 vars; add `deleted_identities` retention to the existing `tasks/cleanup.py` daily task (sweep entries older than 30 days — safe only now, because deleting the Auth0 verification path is what ends the open-ended lifetime the Auth0-side tombstones guarded; 30 days comfortably exceeds the ~1-day Clerk token lifetime; see M8 step 2a).
5. **Dev-mode synthetic user**: currently `auth0_id="dev|local-development-user"` — becomes an `external_auth_id` sentinel; keep the same shape/semantics, update `docs/architecture.md`'s mention.
6. **Security tests** (AGENTS.md obligation): update `backend/tests/security/` and `tests/security/deployed/` for the Clerk world (the deployed tests use PATs and should need little; anything asserting Auth0-specific 401/403 text or claims gets updated). Operator runs `test_live_penetration.py` against production.
7. **Docs sweep** (AGENTS.md "Files to Keep in Sync"): `docs/architecture.md` (§5 auth rewrite, diagram nodes, Redis key schema, "known drift risks"), `README_DEPLOY.md` (Step 6 → Clerk, env var tables, cron env vars), `README.md`, `AGENTS.md` (auth description), `.env.example`, `llms.txt` family where auth is described (`llms-integration.txt` "Auth0-only 403 surfaces" → renamed dependency family), `frontend/src/data/docsRoutes.tsx`/`settingsRoutes.tsx` searchText if auth-related pages changed terms. Mark `future-identities.md` superseded (AD2). 
8. **Ledger**: final pass — total effort per milestone, the complete gained/lost/neutral table. Operator deletes the Auth0 tenants (dev and prod) only after the user export is archived somewhere safe (and the hash export too, if the optional ticket was exercised).

### Definition of Done

- M6a done: import reconciled to zero discrepancy; flip verified across web, CLI, MCP, and extension; iOS-on-Auth0 verified against the same accounts; Auth0 sign-ups closed **and the freeze verified by attempting to create a new Auth0 identity via both the DB connection and the social path (both must fail)**; deployed security tests run against production immediately post-flip (M6a is when production auth actually changes — don't wait for M6b's run). M6b done means everything below:
- `make tests` (full suite) clean; deployed security tests green against production (operator-run, results reported).
- Grep-level assertion: no case-insensitive `auth0` matches in code/config outside `docs/` history (implementation plans and the ledger legitimately reference it) and historical migration files (which are immutable — never edit old Alembic migrations; the *new* drop-column migration is the change).
- Ledger open-questions assertion: `grep '\[OPEN\]' docs/auth0-clerk-ledger.md` returns no marker pointing at a migration milestone — every such question is `[ANSWERED]` with its answer folded into the relevant entry. Only items explicitly scoped post-migration (e.g. the Clerk API-Keys spike, AD1) may remain open, each with a named owner.
- All sync-listed docs updated; ledger finalized.
- Appendix A's platform matrix fully verified; operator closes the internal tracking ticket.

---

## Milestone 7 — Chrome extension: session sync with the web app

Buildable and dev-testable any time after M1 + M3; **ships only after M6a**, because the extension syncs with the user's tiddly.me session, which doesn't exist on Clerk in production until the web flip. PAT support is retained as a fallback, so Web Store review latency is harmless — existing installs keep working on PATs before, during, and after the update.

### Goal & Outcome

A user who is signed in to tiddly.me has a signed-in extension automatically — the PAT-paste onboarding (today's only path) becomes optional.

- Install the extension while signed in to tiddly.me → save a bookmark immediately; no token creation, no options page.
- Signed out of the web app → the extension uses a configured PAT if one exists, else prompts to sign in at tiddly.me (or paste a PAT).
- Existing installs and PAT-configured users see no behavior change; their PATs keep working indefinitely (AD1).
- Rationale worth preserving (ledger + code comment): PAT-paste was Auth0-era pragmatism — running an IdP login inside an MV3 extension was painful under Auth0; Clerk's extension SDK + Sync Host has no comparably easy Auth0 equivalent, making this a capability gained by the migration.

### Implementation Outline

All provider mechanics below were verified against Clerk's Sync Host and `createClerkClient()` docs (see Required Reading) — including that **development instances are fully supported** (`syncHost: "http://localhost"` against the locally running web app; an earlier research summary claiming production-only testing was checked against the primary docs and was wrong).

0. **Build pipeline (new scope — the SDK forces it)**: the extension today has no bundler, no runtime dependencies, and no config layer (`API_URL` is hardcoded to production in `background-core.js`). Clerk's SDK is only consumable as a bare npm import (`@clerk/chrome-extension/client`), which MV3 service workers cannot resolve unbundled — "no React/Plasmo needed" does not mean "no build step." Introduce a minimal build: esbuild unless a quick pre-check shows Clerk ships a framework-agnostic prebuilt bundle. Keep it narrow — one bundled background entry, existing popup/options code mostly unchanged — and generate dev/prod config constants (API URL, publishable key, `syncHost`, Frontend API origin). Manifest and the vitest suite target the built output; wire the build into the extension's existing test/package flow.
1. **Background service worker**: initialize `createClerkClient({ publishableKey, syncHost, background: true })` — the vanilla-JS entry point. `background: true` keeps the ~60s session token refreshing while the popup is closed — without it, sessions go stale between popup opens. `syncHost` is the **Clerk Frontend API domain**, not the web-app origin — expected `https://clerk.tiddly.me` in prod, `http://localhost` in dev (per the Sync Host guide). Treat it as a verified config value: the manual pass must prove sync with the exact deployed value. (An earlier draft said `https://tiddly.me` — a transcription error against a correctly-fetched doc; see the external-claims rule.)
2. **Token resolution** in the background core becomes: explicit PAT in `chrome.storage` wins (a deliberate user choice, and deterministic for script-like usage); otherwise `getToken()` from the Clerk client; neither → the existing not-configured error, with copy updated to mention both paths. `X-Request-Source: chrome-extension` unchanged.
3. **Manifest**: add `cookies` to `permissions` (the Sync Host guide requires `["cookies", "storage"]`; the manifest has `storage` but not `cookies`) and add `host_permissions` for the sync host origin and the Clerk Frontend API origin (prod: `clerk.tiddly.me`; dev: the instance's `.accounts.dev` FAPI + localhost). The added permission and host permissions are what trigger the store re-review and possible user re-approval — an intentional cost, stated in the operator step, not a surprise at review time.
4. **Backend config**: add the published extension's `chrome-extension://<ID>` origin to the authorized-parties (`azp`) allowlist from M1; local/dev config adds the unpacked build's ID. Verify with a real token minted in the extension context that `azp` carries the extension origin as expected — if extension-context tokens behave differently (absent/different `azp`), surface that in review rather than shipping a silent 401.
5. **Options page**: PAT field stays as the fallback; copy reframes sync-with-web-app as the default experience.

### Definition of Done

- Extension tests updated: token-resolution precedence (PAT set → PAT; no PAT + session → Clerk token; neither → error), manifest assertions for the `cookies` permission and new host permissions (the existing `manifest.test.js` / `background-core.test.js` structure covers both), all running against the built output.
- Backend: authorized-parties config covers the extension origin; one test with an extension-origin `azp` fixture.
- Manual dev pass with the **built artifact loaded unpacked in Chrome** — not just Vitest; this is what catches bundling, manifest, permission, and service-worker import failures in the environment that matters: sign in on the local web app → extension saves without any PAT; sign out on web → PAT fallback works; both configured → PAT wins; sync proven with the exact deployed `syncHost` value.
- Operator: extension IDs allowlisted (both instances); store publish executed only after M6a.
- Ledger updated: the capability-gained entry (item 4 of Goal & Outcome) and the process entry — this milestone surfaced two distinct verification failure modes worth recording separately: unverified-summary claims (the production-only-testing error, caught by fetching the source) and transcription error (the `syncHost` value, written wrong despite a correct fetch — only re-reading the written value against the quoted source catches that).
- **Security review**: the background worker's message listener hands tokens only to the extension's own popup/options — sender validated, no `externally_connectable` exposure (the classic extension token-exfiltration vulnerability); the `cookies` permission is scoped to the declared hosts only.
- Docs: README extension setup section and any llms-family mention of extension auth updated to describe sync-first with PAT fallback.

---

## Milestone 8 — Adoption features: account deletion + optional MFA

Per the adoption register: capabilities a from-scratch Clerk build would have, adopted as part of the migration. Buildable after M1 (the webhook endpoint is backend work) and alongside M3 (the UI surfaces live in `<UserProfile />`); **target: complete before the M6a flip** so cutover day ships the full experience. Fallback if it slips: M6a proceeds with the deletion/MFA sections hidden — M3's guard already handles that gracefully.

### Goal & Outcome

- Users can delete their own account, end to end: the `<UserProfile />` deletion section is live, and a deletion in Clerk removes all Tiddly data — no orphaned rows. **Decision (recorded)**: immediate hard-delete, per the adoption register's rationale (the Clerk identity is gone before our webhook fires, so grace-period semantics are impossible without owning the whole flow; Clerk's component provides the confirmation UX; content-level trash is unaffected).
- Users can optionally enroll in MFA (authenticator app + backup codes) from the account page; enforcement happens inside Clerk's sign-in ceremony, so the backend needs no changes.
- The production instance is on the Pro plan (operator step) — which also removes Clerk branding and lifts the fixed 7-day session lifetime.

### Implementation Outline

1. **Webhook endpoint — the first inbound provider-calls-us surface in the codebase, treat it accordingly**: a route (e.g. `POST /webhooks/clerk`) that **verifies the Svix signature before doing anything else** — an unauthenticated webhook endpoint is an attacker-triggerable "delete this user" button. The Clerk dashboard subscription is scoped to `user.deleted` only, *and* the handler defensively checks `event.type`, returning 200 no-op for anything else (subscriptions can be broadened later without a code change). Note this is the **first application-level delete-user path** — no service function exists today (`test_user_cascade.py` exercises the ORM cascade directly); M8 writes one, wrapping the tested cascade. Webhooks are sync convenience, never source of truth: JIT provisioning remains the primary path for creation; this endpoint only handles deletion (and is the natural future home for billing/org events).
2. **Deletion must defeat resurrection (review-round Critical finding)**: JIT provisioning will happily re-create a deleted user on the next validly-signed token — a still-live Clerk JWT (a seconds-to-a-day window), or worse, the user's iOS app on the Auth0 path (Auth0 doesn't know a Clerk-side deletion happened, and refresh tokens keep that session alive for the whole M6a→M6b window), producing a resurrected empty row with `external_auth_id` NULL that would also break M6b's `SET NOT NULL` migration months later. The handler therefore: (a) writes a **tombstone** to a new `deleted_identities` table — *both* identity columns when the row exists (`external_auth_id` blocks the Clerk path, `auth0_id` blocks the Auth0/iOS path); for unknown-user events, tombstone the Clerk ID and return success. **Tombstones never block returning users**: providers never reuse identity IDs, so a deleted user who signs up again arrives as a brand-new identity that no tombstone matches — tombstones block dead credentials, not people. **Retention — do NOT add a sweep in M8**: the two tombstone kinds have different required lifetimes. Clerk-side entries are only needed for ~the longest Clerk token lifetime (about a day), but Auth0-side entries must survive the *entire* open-ended dual-accept window — the iOS resurrection they guard against stays live until M6b deletes the Auth0 path. A fixed-retention sweep added now could silently reopen the Critical resurrection hole the moment the window outlives the retention period. The sweep is therefore part of M6b's decommission change-set (see M6b step 4), where it becomes safe by construction, and it goes into the *existing* `tasks/cleanup.py` daily task — no new cron. During the window the table just grows, which at this scale is a handful of rows. (b) **Invalidates the auth cache** for both key segments — the only current `AuthCache.invalidate` caller is the consent flow; deletion is a new caller, without which a cached identity serves requests for up to 5 minutes post-deletion and then 500s on foreign-key violations. (c) Both JIT paths **check the tombstone before create** and reject with an explicit "this account was deleted" 401 detail — a deliberate exception to the generic-401 policy, safe because only a holder of a validly-signed token for that exact identity can ever see it (M4's friendly `invalid_grant` message is the precedent), and it stops a deleted user's devices looping on an unexplained sign-in failure.
3. **Unhide the `<UserProfile />` deletion section** that M3 app-gated, per the Q12 enumeration. (MFA enrollment sections are *not* app-gated — they simply don't render on a non-Pro instance, Clerk-side; enabling MFA strategies once Pro is active is what makes them appear.)
4. **iOS guide**: one line — deletion and MFA surface via ClerkKit's prebuilt views with the same provider-side semantics; nothing app-specific required.

### Definition of Done

- Tests: unsigned and bad-signature requests rejected; idempotent replay (same event twice → one deletion, two successes); unknown-user event → tombstone written, clean success; non-deletion event type → 200 no-op, nothing touched; **a stale-but-valid Clerk JWT after deletion cannot recreate the user**; **a live Auth0-path token after deletion cannot recreate the user** (the iOS scenario); a cached-then-deleted user's next API call fails cleanly (401, not a foreign-key 500); end-to-end in the dev instance (delete Clerk user → Tiddly row and content gone).
- **Security review (deep — new inbound attack surface)**: signature verification is unbypassable (no code path parses the body first), signing-secret storage, replay behavior; update `backend/tests/security/` per the AGENTS.md obligation.
- Manual dev pass: full delete-account flow (webhook delivery to locally-running code needs a tunnel — reuse M5's cloudflared/ngrok pattern; local dev has no public URL). MFA enroll + sign-in with a TOTP code runs wherever ledger question 15 says MFA is testable (per-application Pro covering the dev instance, or production after its pre-flip upgrade) — do not assume the free dev instance can run it.
- Docs: `docs/architecture.md` (new webhook surface), `.env.example` (signing secret), README_DEPLOY (webhook configuration step). Ledger updated.

---

## Known limitations accepted (recorded, not to be "fixed" in this project)

- Interactive CLI login requires a browser on the CLI's machine; SSH/headless uses PATs (AD9).
- MCP OAuth grants are all-or-nothing (Clerk has no custom OAuth scopes yet) — parity with today's unscoped PATs, no regression.
- One forced re-login per client at its own cutover (web/CLI at M6a; iOS when its update ships). During the M6a→M6b window: Auth0-side password changes do not propagate to Clerk, and users who sign up during the window cannot use the iOS app until it ships.
- Clerk reliability posture: sign-ins depend on Clerk uptime (as with Auth0); networkless JWT verification means existing tokens keep verifying during a Clerk outage, but with ~60s session tokens the practical grace window for web sessions is about a minute. Accepted at current scale; revisit (e.g., tolerating slightly-stale tokens during incidents) only if it bites.

---

## Appendix A — MCP OAuth: background and requirements

Self-contained rewrite of an internal tracking ticket (KAN-57) so this public document doesn't depend on private-tracker access. The ticket was originally authored with Auth0 as the authorization server; M5 supersedes those specifics — Clerk plays the authorization-server role. The problem statement, platform facts, and requirements below are unchanged.

### Problem

Tiddly's MCP servers authenticate with bearer tokens (PATs). That works for clients that let users configure headers, but two major platforms cannot use bearer tokens at all — OAuth is their only supported auth for remote MCP servers. Until the servers speak OAuth, those integrations are impossible (ChatGPT) or require a proxy workaround (Claude Desktop via `mcp-remote`).

### Platform compatibility target

| Platform | Auth method |
| --- | --- |
| Claude Desktop / Claude web (native Connectors UI) | OAuth (required for the paste-a-URL experience) |
| ChatGPT | OAuth (mandatory — no bearer option) |
| Claude Code | OAuth or bearer token (`--header`) |
| Codex CLI | OAuth or bearer token (`bearer_token_env_var` / `http_headers`) |

### Requirements

1. Each MCP server serves `/.well-known/oauth-protected-resource` (RFC 9728) — **the only OAuth endpoint we implement**. The identity provider serves everything else: authorization-server metadata (RFC 8414), dynamic client registration (RFC 7591), the authorize and token endpoints.
2. Dynamic client registration is enabled at the identity provider, so MCP clients register themselves — no pre-provisioned client IDs or callback URLs per platform.
3. Existing bearer/PAT auth keeps working unchanged (must-have — Claude Code, Codex, and all current configs rely on it).

### How the OAuth bootstrap works (per the MCP authorization spec)

1. Client sends an unauthenticated request to the MCP server and receives HTTP 401 with a pointer to the resource metadata.
2. Client reads `/.well-known/oauth-protected-resource` from the MCP server, learning where the authorization server is.
3. Client reads the authorization server's metadata, registers itself via DCR (obtaining a `client_id`), and sends the user through browser login/consent.
4. Client attaches the issued token as a bearer on every MCP request; token verification happens server-side exactly as for any other bearer (in Tiddly's architecture: at the backend API, not the MCP proxy — see AD10).

### DCR considerations

- **Pros**: universal client compatibility; best UX (users paste one URL); clients manage their own callback URLs; no manual per-platform client creation.
- **Cons**: open registration (anyone can register a client — spam/abuse surface; this motivated the original concern about Auth0's 10-application free-tier entity limit, and is why M0 verifies how Clerk meters DCR-registered clients); no control over client names/logos; harder to revoke a specific platform; the spec area is still evolving (e.g., Client ID Metadata Documents).

### References (public)

- MCP authorization spec: https://modelcontextprotocol.io/specification/draft/basic/authorization
- RFC 9728 (OAuth 2.0 Protected Resource Metadata) · RFC 7591 (Dynamic Client Registration) · RFC 8414 (Authorization Server Metadata)
- Claude custom connectors: https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers
- ChatGPT MCP authentication: https://developers.openai.com/apps-sdk/build/auth/
- Codex MCP configuration: https://developers.openai.com/codex/mcp/
