# iOS App: Auth0 → Clerk Migration Guide

**Audience**: the developer of the Tiddly iOS app (separate repository). You maintain the app's auth layer; you don't need access to this backend repo — everything you need is (or will be) in this document.

**Status**: stub, started 2026-07-04. The backend migration ([plan](implementation_plans/2026-07-02-clerk-migration.md)) is in progress, and several facts below don't exist yet — those carry a literal `[OPEN]` marker, following the same convention as the [capability ledger](auth0-clerk-ledger.md): `grep '\[OPEN\]'` on this file lists exactly what's still unknown. This guide is scheduled to be complete (all M3-resolvable markers filled) by the end of the backend's Milestone 3, before your work needs to start.

---

## The one-paragraph summary

Tiddly is replacing Auth0 with Clerk as its identity provider. For the iOS app this means swapping the Auth0 SDK for Clerk's native iOS SDK (ClerkKit) and rewriting the login/session layer; **everything else about how the app talks to the API stays the same** — same base URL, same endpoints, same `Authorization: Bearer <token>` header on every request, same `X-Request-Source: ios` header, same error semantics. Users keep their accounts and all their data; they will have to sign in again once when your update ships.

## Timeline and coordination (please read this even if you skim the rest)

- **You can start any time after the backend's M0/M1 land** (Clerk dev instance exists; backend accepts Clerk tokens). Develop and test against the Clerk **development instance** — credentials below `[OPEN: dev-instance publishable key — available after backend M0]`.
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
- **Configuration values**:
  - Development instance publishable key: `[OPEN — after backend M0]`
  - Production instance publishable key: `[OPEN — after backend M3]`
- **Attaching auth to API calls**: unchanged in shape — get a token from the SDK, send `Authorization: Bearer <token>` plus `X-Request-Source: ios`. The API base URL and all endpoints are unchanged.

## The backend contract (what our side guarantees and expects)

- The backend verifies Clerk session tokens by signature, expiry, and authorized-party (`azp`) checks. **Open item on our side, not yours**: how tokens minted by the native SDK present `azp` (an iOS app has no web origin), and what our allowlist must include for you — `[OPEN — ledger question 11, resolved during backend M0/M1; the answer and any required app-side configuration will be written here]`.
- Error semantics are unchanged: `401` means your token was missing/invalid/expired (with the SDK managing freshness, this should only mean signed-out); `451` means the user hasn't accepted the current privacy policy / terms and must do so (same consent flow as today); `429` is rate limiting.
- Personal Access Tokens (`bm_...`) are unaffected by the migration and continue to work — not that the iOS app uses them, but for completeness.

## What happens to the users

- Every existing user is imported into Clerk before the cutover, keyed to the same account — **no data moves, nothing is lost**, and email addresses are imported pre-verified so "Sign in with Google" attaches seamlessly on first use.
- Password users: passwords are **not** migrated (a deliberate decision — see the plan's M0/M2). On first Clerk sign-in, a password user sets a new password via the forgot-password flow or signs in with an emailed code `[OPEN — exact first-login path confirmed by backend M0 spike, ledger question 10]`. This is handled/communicated by the backend team; it affects your app only in that the sign-in UI should not surprise-block a user with no password (Clerk's prebuilt components handle it).

## References

- Backend migration plan: [`implementation_plans/2026-07-02-clerk-migration.md`](implementation_plans/2026-07-02-clerk-migration.md) — especially AD5 (the dual-accept window your timeline lives inside) and M6a/M6b.
- Capability ledger (Auth0↔Clerk differences, including the session/token model explainer): [`auth0-clerk-ledger.md`](auth0-clerk-ledger.md)
- Clerk iOS docs: https://clerk.com/docs/reference/ios/overview
