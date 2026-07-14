# iOS App: Auth0 → Clerk Migration Guide

**Audience**: the developer of the Tiddly iOS app (separate repository). You maintain the app's auth layer; you don't need access to this backend repo — everything you need is (or will be) in this document.

**Status**: deliverable, updated 2026-07-12 (backend M3). All facts resolvable before your work starts are filled in; the two remaining `[OPEN]` markers are confirmations that need artifacts only you can produce (a real ClerkKit token; the request-source header check), following the [capability ledger](auth0-clerk-ledger.md)'s convention — `grep '\[OPEN\]'` lists exactly what's pending.

---

## The one-paragraph summary

Tiddly is replacing Auth0 with Clerk as its identity provider. For the iOS app this means swapping the Auth0 SDK for Clerk's native iOS SDK (ClerkKit) and rewriting the login/session layer; **everything else about how the app talks to the API stays the same** — same base URL, same endpoints, same `Authorization: Bearer <token>` header on every request, same `X-Request-Source: ios` header, same error semantics. Users keep their accounts and all their data; they will have to sign in again once when your update ships.

## Timeline and coordination (please read this even if you skim the rest)

- **You can start any time after the backend's M0/M1 land** (Clerk dev instance exists; backend accepts Clerk tokens). Develop and test against the Clerk **development instance** — see "Configuration values" below for how keys are handed over.
- **You must not ship before the production cutover ("M6a")** — the moment the web app flips to Clerk and all users are imported. Before that, production users have no Clerk accounts for your app to sign into. You'll get an explicit go-ahead.
- **During the window between the cutover and your release, the current app keeps working** — the backend deliberately accepts both Auth0 and Clerk tokens during this period. There is no hard deadline, but the window is open-ended in your hands: Auth0 cannot be decommissioned until your update has shipped *and* Auth0-token traffic from iOS has stopped. Please keep it moving.
- **Your release logs every iOS user out once** (their Auth0 session dies; they sign in via Clerk). One-time, expected, will be pre-announced to users.
- **The `X-Request-Source: ios` header matters more than usual during the window**: it's literally how the backend team observes whether iOS traffic is still on Auth0 (the decommission gate watches for it). Please confirm the app sends it on every request today `[OPEN: confirm with backend team — ledger question 9]`, and keep sending it.

## What you delete: the Auth0 token lifecycle

Today the app (presumably via Auth0.swift) manages: an access token that expires after hours, a refresh token to get new ones, single-use refresh-token rotation (store both new tokens after every refresh, handle the invalid-grant case), and retry-on-expiry logic. **All of that machinery goes away.** Clerk's native SDK owns the session: after sign-in, you ask the SDK for a token whenever you make an API call, and it's the SDK's job to hand you a currently-valid one. Clerk tokens are short-lived (about a minute) and refreshed automatically by the SDK — you never see or store a refresh token.

**Session policy note**: the production instance runs Clerk's **free tier** at cutover, which fixes session lifetime at a 7-day absolute maximum — users re-authenticate weekly, and that applies to iOS sessions too (one tap via the native Google sheet, or password re-entry). This is a deliberate, documented decision (see the plan's adoption register); it lifts automatically if/when the instance upgrades to Pro — no app change involved.

**Mid-use expiry must not lose user work (please treat this as a requirement, not a suggestion)**: under Auth0's ~30-day-inactivity sessions, the app's 401/logged-out path has probably never fired during active use — under Clerk it will fire *weekly*, including while someone is mid-edit in a note. Whatever that path does today, the Clerk version must do this: on a 401 from an expired session, present sign-in **modally over the current screen** (Clerk's `AuthView` presents this way naturally) without tearing down the underlying view or discarding unsaved editor state, then retry the failed request after re-auth — the user ends up exactly where they were with nothing lost. The web app is implementing this same contract. Rehearse it: shorten the development instance's session lifetime to minutes (session settings are free to customize in dev mode), let a session expire mid-edit, and watch what happens.

## What you build with

- **SDK**: Clerk iOS (ClerkKit), v1 GA since February 2026 — https://clerk.com/docs/reference/ios/overview and https://github.com/clerk/clerk-ios
- **Sign-in methods to support**: email/password and native Google Sign-In (both configured on the Clerk instance already). Clerk ships prebuilt `AuthView` / `UserProfileView` components if you want the least-code path; custom UI is also supported.
- **Configuration values**: both instances exist (dev since M0, production since M3). Publishable keys (`pk_test_...` / `pk_live_...`) are not secrets, but this repo's policy keeps environment identifiers out of public docs — request them from the backend maintainer, who pulls them with `clerk env pull [--instance prod]`. Use the dev key for all development; the production key ships only in the release you publish after the M6a go-ahead.
- **Attaching auth to API calls**: unchanged in shape — get a token from the SDK, send `Authorization: Bearer <token>` plus `X-Request-Source: ios`. The API base URL and all endpoints are unchanged.

## The backend contract (what our side guarantees and expects)

- The backend verifies Clerk session tokens by signature, expiry, and authorized-party (`azp`) checks. The `azp` rule is **"present → must be allowlisted; absent → tolerated"**, and non-browser tokens are expected to carry no `azp` at all (verified for Backend-API-minted tokens in M0; a native app has no web origin) — so **no app-side configuration is expected for you, and no allowlist entry should be needed**. One confirmation remains: `[OPEN — when you mint your first real ClerkKit token in development, send us its decoded claims (ledger question 11); if it unexpectedly carries an azp, we allowlist that value on our side — still nothing for you to change]`.
- Error semantics are unchanged with one addition: `401` means your token was missing/invalid/expired (with the SDK managing freshness, this should only mean signed-out); `451` means the user hasn't accepted the current privacy policy / terms and must do so (same consent flow as today); `429` is rate limiting.
- **One 401 is terminal, not retriable: `{"detail": "This account was deleted"}`.** If the user deletes their account (self-service, via account settings), the backend removes their data and permanently blocks that identity — but an Auth0 session on this app can outlive the deletion (Auth0 never learns about it, and refresh tokens keep the session alive). Requests from that session get this specific 401. Do NOT route it into the re-authentication flow — signing in again with the same session will never succeed and produces a loop. Detect the detail string, sign the user out locally, and show a "this account was deleted" end state. Every other 401 keeps the normal modal re-auth behavior above.
- Account deletion and (future) MFA surface through ClerkKit's prebuilt views with the same provider-side semantics as the web app — nothing app-specific to build for them.
- Personal Access Tokens (`bm_...`) are unaffected by the migration and continue to work — not that the iOS app uses them, but for completeness.

## What happens to the users

- Every existing user is imported into Clerk before the cutover, keyed to the same account — **no data moves, nothing is lost**, and email addresses are imported pre-verified so "Sign in with Google" attaches seamlessly on first use.
- Password users: passwords are **not** migrated (a deliberate decision — see the plan's M0/M2). Confirmed empirically (backend M2 rehearsal, ledger question 10): Clerk's sign-in flow never shows a passwordless account a password prompt — entering their email goes straight to an emailed six-digit code; they're signed in after entering it, and setting a password afterwards is optional. Clerk's prebuilt components (including `AuthView` on iOS) handle this automatically — nothing for your app to special-case.

## References

- Backend migration plan: [`implementation_plans/2026-07-02-clerk-migration.md`](implementation_plans/2026-07-02-clerk-migration.md) — especially AD5 (the dual-accept window your timeline lives inside) and M6a/M6b.
- Capability ledger (Auth0↔Clerk differences, including the session/token model explainer): [`auth0-clerk-ledger.md`](auth0-clerk-ledger.md)
- Clerk iOS docs: https://clerk.com/docs/reference/ios/overview
