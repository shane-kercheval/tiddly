# Auth0 ↔ Clerk Capability Ledger

A living record of the functional differences between Auth0 and Clerk as discovered during Tiddly's migration ([plan](implementation_plans/2026-07-02-clerk-migration.md)). Each entry opens with **What** — plain-language context explaining what the capability is and why it matters here — followed by how each provider handles it, what migrating took, a **gained / lost / neutral** verdict, and any gotchas. Entries also record "possible on both providers, but…" nuances and the places we deliberately diverged from Clerk's own migration guidance. This is the blunt raw record; polished writeups get distilled from it, not the other way around.

**Status**: seeded 2026-07-02, before implementation started. Migration-effort notes are estimates until the relevant milestone completes; every milestone's Definition of Done includes updating this file. Claims about either provider follow the plan's external-claims rule: they are verified against primary sources or listed under Open Questions — never asserted from memory or from secondhand summaries.

---

## Identity & user migration

### User export and password hashes
- **What**: To move users to a new auth provider without forcing everyone to reset their password, you need the password *hashes* (the one-way-encrypted form providers store) exported from the old provider. How hard a provider makes that export determines how painful it is to leave them.
- **Auth0**: Everything about your users exports self-serve *except* password hashes. Those require a support ticket (the magic words are "I would like to obtain an export of my tenant password hashes"), the turnaround is roughly a week, and support may require a paid tenant before releasing them.
- **Clerk**: The equivalent export, hashes included, is self-serve. If we ever leave Clerk, this step won't exist.
- **Alternative — skip the hashes entirely**: Clerk's user-creation API accepts `skip_password_requirement: true`, creating the user with no password at all (allowed as long as password isn't the instance's *only* sign-in method). Each affected user then sets a new password or uses a passwordless/social method on their first login. The trade is one reset event per password user versus a week of waiting on the ticket: with few password users the skip path usually wins; at scale the ticket earns its cost. In every no-password path, first-login identity is verified by proof of inbox ownership — Clerk emails a one-time code automatically (through the forgot-password flow, or through email-code sign-in if enabled); the application sends nothing. One inference worth noting: Clerk forbids the skip flag when password is the instance's *only* sign-in method, which suggests the forgot-password flow does not serve accounts that never had a password (otherwise that guardrail would be unnecessary) — this is open question 10 below. (Which path Tiddly chose, and why, lives in the plan — M0 operator steps and M2.)
- **Verdict**: Gained — Clerk's self-serve export means a future exit from Clerk would be easier than an exit from Auth0.
- **Gotcha**: Whichever path a migration chooses, it must be decided before the import work is scheduled, because the ticket path inserts a week-long external wait that nothing else can absorb. If a ticket is filed at all, file it on day one so the wait overlaps with other work.

### Password import
- **What**: The receiving provider has to accept those exported hashes directly, or the export was pointless — this is what lets users' existing passwords keep working after the switch.
- **Auth0 → Clerk**: Clerk's user-creation API accepts `password_digest` with `password_hasher="bcrypt"`, which is exactly the format Auth0 uses. An imported user signs in with their old password and never knows anything changed.
- **Verdict**: Gained. This single API parameter is most of the reason the migration can be invisible to users.

### Social (Google) account transfer
- **What**: Users who sign in with Google have no password to migrate — their "credential" is a consent grant living at Google, and no provider can export another provider's grants. The question is how a migrated user's first Google sign-in gets attached to their imported account instead of creating a duplicate account.
- **Both providers**: OAuth grants are consent-bound and non-exportable. This is inherent to OAuth, not a vendor limitation.
- **Clerk**: Handles it through account linking by verified email: import the user with their email address marked *verified*, and when they later sign in with Google (returning a matching verified email), Clerk silently attaches the Google identity to the existing account.
- **Verdict**: Neutral on mechanism, good ergonomics in practice.
- **Gotchas**: The import must mark emails as verified, or Clerk will prompt or block instead of linking silently. Separately: Auth0 treats each login method as its own user unless someone explicitly linked them, so the same human can appear twice in the Auth0 export (once as `auth0|...`, once as `google-oauth2|...`) with the same email. The import script must collapse those into one Clerk user, keyed by whichever identity Tiddly's database actually stores.

### Multi-identity / account linking (architectural)
- **What**: One human should be one account even if they sometimes log in with a password and sometimes with Google. Where that mapping lives — in your own database or inside the provider — shapes your schema.
- **Auth0**: Each login method is a distinct user (`sub`) unless explicitly linked via API calls. Tiddly had a designed-but-unbuilt plan (`future-identities.md`) to own this mapping ourselves with a `user_identities` table.
- **Clerk**: Linking happens inside the provider. One Clerk user can hold a password, a Google login, and more, while presenting a single stable `user_id` to our database.
- **Verdict**: Gained — an entire planned migration was deleted from our roadmap because the provider absorbs the problem. Probably the most underrated win of the switch.

### Divergences from Clerk's own migration guide (deliberate)
- **What**: Clerk publishes a recommended Auth0-to-Clerk migration path. We deviated from it in two places, and the reasons matter: the vendor's guide optimizes for large customers, and following it blindly would have left us with worse architecture.
1. **We skipped the `external_id` session-token aliasing.** The guide suggests configuring the session token to emit `{{user.external_id || user.id}}` so a backend can keep keying on legacy Auth0 IDs indefinitely. That exists for teams with large userbases and backend code they can't safely change. We control our backend and have a handful of users, so we do a clean swap of the lookup column instead. The old Auth0 ID is still stored in Clerk's `external_id` field, but purely as an audit breadcrumb — the application never reads it.
2. **We skipped trickle migration.** The guide describes running both providers in parallel and migrating each user when they happen to log in. That machinery pays off for big fleets. At our scale the right shape is: bulk import, a window where the backend accepts tokens from both providers, one coordinated client flip, a soak period, then decommission.

## Tokens & sessions

### Session/token model
- **What**: The core mechanics of how a logged-in browser proves its identity on every API call — how long tokens live, who refreshes them, and what the backend checks. This is the deepest architectural difference between the two providers.
- **Auth0**: Access tokens live for hours and are scoped to an API "audience"; the browser also holds a rotating refresh token and the SPA manages refreshing explicitly.
- **Clerk**: Session tokens are JWTs that live about 60 seconds and are refreshed automatically by Clerk's JavaScript via a cookie. The client never holds a refresh token for web sessions. Instead of an audience check, the backend checks `azp` ("authorized party" — which origin the token was issued to); Clerk session tokens carry no audience claim at all.
- **Migration effort**: The backend's claim validation changes shape (M1), and the SPA's 401-retry/refresh interceptor gets simpler because refresh is no longer its job.
- **Verdict**: Neutral to gained. A tab that sat idle overnight transparently gets a fresh token on the next request, which is better than Auth0's expired-cached-token dance.
- **Gotchas**: Any code assuming a token stays valid for hours breaks under 60-second tokens. Custom claims share roughly 1.2KB of budget inside a 4KB cookie. And the backend's auth cache must key on the user (`sub`), never on the raw token — tokens rotate every minute, so a token-keyed cache would never hit.

### Custom claims (getting email into the token)
- **What**: The backend wants the user's email inside the verified token itself so it doesn't need an extra lookup on every request. Providers differ wildly in how much machinery this takes.
- **Auth0**: Required a deployed post-login "Action" (JavaScript running inside Auth0), namespaced claim names like `https://tiddly.me/email`, and an environment variable (`AUTH0_CUSTOM_CLAIM_NAMESPACE`) that our settings validation demanded even on cron services that never touch auth.
- **Clerk**: A claims editor in the dashboard with shortcodes like `{{user.primary_email_address}}`. Plain claim names, no namespace, no deployed code.
- **Verdict**: Gained. An entire category of configuration machinery — the Action code, the namespace variables, the validator plumbing — disappears at decommission.

### CLI auth: device authorization flow — the headline gap
- **What**: How a terminal program (`tiddly login`) logs a user in. The relevant standard, "device flow" (RFC 8628), works by showing the user a short code to enter in a browser *on any device* — which makes it the only flow that works when the terminal is on a remote SSH machine with no browser of its own.
- **Auth0**: Supports device flow, and our Go CLI is built on it.
- **Clerk**: Does not support it. Their OAuth server offers only the authorization-code and refresh-token grants; Clerk's own blog post about CLI auth explicitly scopes device flow out; and it sits on their public feedback roadmap as a backlog idea with no commitment.
- **Migration effort**: A full rewrite of the CLI's login flow (M4) to the pattern `gh auth login` uses: authorization code + PKCE, with the browser redirecting to a temporary listener on `127.0.0.1`. The keyring storage and token-refresh plumbing survive.
- **Verdict**: Lost. Interactive login now requires the browser and the CLI to be on the same machine; users SSH'd into remote boxes fall back to pasting a Personal Access Token.
- **Gotcha**: This is the single hardest gap for any CLI-first product migrating from Auth0. If Clerk ever ships device flow, this entry should be updated.

### OAuth provider capability (Clerk as authorization server)
- **What**: Beyond logging users into your own app, a provider can act as a full OAuth server, letting *third-party* clients — our CLI, or MCP clients like ChatGPT — request access to your API with the user's consent. This is the machinery that powers both the CLI rewrite and MCP OAuth.
- **Clerk**: Offers authorization code with PKCE, refresh tokens that never expire, dynamic client registration (clients can register themselves without pre-provisioning), OAuth access tokens issued as JWTs by default since January 2026 (meaning our backend verifies them locally without calling Clerk), and a customizable consent screen.
- **Limitations**: There are no custom OAuth scopes — a consenting user grants all-or-nothing access. That matches our unscoped PATs, so nothing regresses, but finer-grained consent isn't available either. There is also no `client_credentials` grant (Clerk sells proprietary machine-to-machine tokens instead), which we don't need.
- **Verdict**: Gained overall, with those two named limitations.

### PATs vs Clerk API Keys — a corrected first-pass analysis
- **What**: Tiddly has a home-built Personal Access Token system — the `bm_` tokens users create for scripts, the CLI, and MCP configurations. Clerk sells a direct managed equivalent called API Keys (GA April 2026). The question was whether to keep ours or adopt theirs.
- **Decision**: Keep our system untouched through the migration, then spike Clerk's product afterward. The spike must answer: does their key verification require a live call to Clerk or work locally; can we cap keys per user (we enforce tier quotas today); and does the verified result expose enough to keep our audit trail. If those come back clean, deleting our `token_service.py` and letting Clerk own credential storage is a legitimate simplification.
- **Why wait**: Two reasons. Sequencing — our PATs cross the migration with zero churn, meaning every existing token and pasted config keeps working while everything else changes, which de-risks the whole project. And provider neutrality — the PATs cost zero migration work precisely because they were never coupled to Auth0, and moving them into Clerk trades that away.
- **What a first-pass evaluation got wrong** (recorded because it's useful to anyone assessing this product): the instinctive objections were "per-verification metering on a hot path" and "it couples PAT auth to Clerk availability." Neither survives scrutiny. The metering costs about $10 per million verifications. PAT traffic isn't clearly the hottest path, and it shrinks once MCP clients move to OAuth. And Clerk's OAuth JWTs verify locally anyway, so the availability gap is narrow and hinges on one unverified detail. The durable reasons to defer were sequencing and lock-in — not product weakness.

## Clients

### React SPA (Vite, non-Next.js)
- **What**: Tiddly's web frontend is React on Vite — not Next.js, which is Clerk's home turf. The question is whether the non-Next.js path is a first-class citizen.
- **Clerk**: It is — documented and supported, with prebuilt sign-in components replacing Auth0's hosted login page. Production requires DNS records on your own domain (Clerk's Frontend API gets served at `clerk.<your-domain>`), and those records must be plain DNS — Cloudflare's proxying breaks Clerk's validation.
- **Verdict**: Neutral to gained.
- **Gotcha**: The ecosystem is Next.js-first. New features (billing components, MCP helpers) land there before plain React, and the Python verification SDK is solid but thinner than the JavaScript ones. Expect to hand-roll occasionally.

### Chrome extension (MV3)
- **What**: Tiddly's browser extension saves bookmarks through the API. Today a user authenticates it by creating a Personal Access Token in the web app and pasting it into the extension's options page. That friction exists because running an Auth0 login inside a Manifest V3 extension was painful — the PAT paste was pragmatism, not preference.
- **Clerk**: Ships an official extension SDK with a feature called Sync Host: the extension *shares the web app's session*, so a user signed in at tiddly.me has a signed-in extension with zero setup. It has a vanilla-JavaScript entry point (`createClerkClient` — no React required), a documented background-service-worker pattern that keeps the 60-second tokens refreshing while the popup is closed, and full support for development instances (`syncHost: "http://localhost"` against a locally running web app).
- **Verdict**: Gained — a capability with no comparably easy Auth0 equivalent. Planned as M7, shipping after the production cutover, with the PAT paste retained as a fallback.
- **Gotchas** (each verified against primary docs after review rounds caught errors in secondhand claims): the SDK is only consumable as an npm import, so a bundler is mandatory — our extension had no build step at all, making that genuinely new scope. The production `syncHost` value is the Clerk Frontend API domain (`clerk.tiddly.me`), not the web app's origin. The manifest needs the `cookies` permission, which affects Chrome Web Store review. And Clerk's `allowed_origins` update replaces the whole array — fetch, merge, then write, or you clobber existing origins.

### iOS
- **What**: Tiddly's iOS app (a separate repository) authenticates via Auth0 today and needs its auth layer rewritten no matter which provider wins.
- **Clerk**: The native SDK reached v1 GA in February 2026, with native Google Sign-In and prebuilt auth and profile views. The migration plan's dual-accept window exists partly so the iOS app can migrate on its own timeline without blocking the main cutover — the final Auth0 decommission is explicitly gated on iOS shipping.
- **Verdict**: Neutral. Well supported on both sides, and a rewrite is unavoidable either way.

### MCP servers / AI-agent auth
- **What**: Tiddly runs two MCP servers so AI tools (Claude, ChatGPT, coding agents) can manage a user's content. ChatGPT and Claude Desktop's native connectors *require* OAuth — they have no way to accept a pasted bearer token — so whether the provider can act as the OAuth server for MCP determines whether those integrations are possible at all. Background and requirements live in the plan's Appendix A.
- **Both providers can do this** (the pattern is: a discovery endpoint on our servers plus dynamic client registration at the provider). An Auth0 version was fully designed before the migration. MCP OAuth alone is therefore not a reason to switch providers.
- **Clerk's deltas**: OAuth access tokens are JWTs by default (locally verifiable), the consent screen is customizable and self-hostable, and Clerk actively invests in the MCP auth spec. One open comparison point: Auth0's free tier caps total applications at 10, which open client registration could exhaust; how Clerk meters registered clients is an open question for the M0 spike.
- **Verdict**: Gained in ergonomics; honest entry for "possible on both."

## Platform & operations

### Environments
- **What**: How each provider separates real users from the environment you develop and test against.
- **Auth0**: Fully independent tenants — we ran a dev tenant and a prod tenant with nothing shared.
- **Clerk**: One *application* with paired dev and prod *instances*. Users and secrets do not transfer between instances, a `clerk deploy` command clones configuration from dev to prod, and dev instances work on localhost with no DNS setup.
- **Verdict**: Neutral, mildly gained — the config cloning and localhost-friendly development are conveniences Auth0 didn't offer.

### Billing
- **What**: Tiddly has subscription tiers but zero billing code — `tier` is a plain database column, with no Stripe integration and no way for a user to pay. Clerk sells a billing product that could become that missing layer, which is part of why the migration was attractive.
- **Clerk Billing**: Plans and features map directly onto our tiers. The user's plan is embedded in the session token (`pla`/`fea` claims), so server-side tier enforcement reads the already-verified JWT with zero extra calls. Stripe is the payment processor underneath; Clerk takes 0.7% on top of Stripe's fees.
- **Hard gaps**: No refunds through Clerk, USD only, no tax/VAT handling, no 3D Secure.
- **Decision**: Deferred, deliberately decoupled from the auth migration. The VAT gap could be disqualifying for European sales; when billing actually ships, evaluate Clerk Billing against Stripe Billing or Paddle with that gap front and center.

### Reliability
- **What**: When an auth provider goes down, users can't sign in. What is each provider's track record, and what is our exposure?
- **Clerk**: Two acknowledged major outages — September 2025, and March 2026 (26 minutes of errors, followed by a public postmortem committing to fixes). Our exposure is softened by architecture: the backend verifies JWTs locally, so *existing* sessions keep working through an outage; only new sign-ins fail, which is the same failure mode any provider (Auth0 included) has.
- **Verdict**: Recorded as an accepted risk at our current scale.

### Pricing
- **What**: What the provider costs as the user base grows.
- **Clerk**: The free tier covers 50,000 monthly *retained* users and is production-ready. Pro is $25/month and adds branding removal and MFA. That's cheaper than Auth0 at any scale Tiddly will see soon, and "retained users" is a friendlier billing metric than Auth0's monthly-actives.

## Process notes (how this ledger stays honest)

- **What**: Mistakes made *while researching this migration* that changed how we verify claims. They're kept because they're findings about how to evaluate a provider, not just about the provider itself.
1. **Unverified-summary claims.** A research summary asserted that the extension's Sync Host feature could only be tested in production. Fetching the primary documentation killed the claim — development instances are fully supported. Lesson: verify claims about external systems against primary sources, not summaries.
2. **Transcription error.** The production `syncHost` value was written down wrong *even though the correct documentation had been fetched earlier in the same session*. Fetching the source isn't enough; written values have to be re-checked against the quoted text.
3. **First-pass vendor-evaluation bias.** The initial analysis of Clerk's API Keys product reached for availability and cost objections that didn't survive basic arithmetic; the objections that held up were about sequencing and lock-in. Instinctive objections to a vendor product deserve the same scrutiny as the product's claims.

## Open questions (resolve and fold into entries above)

| # | Question | Where it resolves |
|---|----------|-------------------|
| 1 | Exact session-token claim shortcodes for email + verification status | M0 spike |
| 2 | OAuth access-token default lifetime; does refresh-token issuance require a scope? | M0 spike |
| 3 | Where the JWT-vs-opaque token format setting lives; do DCR clients inherit it? | M0 spike (blocks M5) |
| 4 | How Clerk meters/limits DCR-registered clients (vs Auth0's 10-app free-tier cap) | M0 spike |
| 5 | Claim-shape differences: session tokens vs OAuth access tokens (`sub`, email presence) | M0 spike (blocks M4) |
| 6 | Do extension-context session tokens carry `azp = chrome-extension://<id>`? | M7 step 4 |
| 7 | Does Clerk ship a framework-agnostic extension bundle, or is esbuild required? | M7 step 0 pre-check |
| 8 | Does Clerk API-key verification require a live Clerk call, support per-user caps, and expose enough for our audit trail? | Post-migration spike (AD1) |
| 9 | Does the iOS app send `X-Request-Source: ios`? | M6a operator confirmation (cross-repo) |
| 10 | Can a user created with no password (`skip_password_requirement`) set their *first* password through the forgot-password flow, or must email-code sign-in be enabled for them? | M0 spike |
