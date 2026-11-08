# Tiddly iOS 1.0 release plan: the website, backend, policy, Clerk and operator work

**Status**: planned 2026-11-08, not started. Written against commit `2070791`. The iOS app is a separate private repository built by Jeremy, who submits it to the US App Store. This plan covers our side.

## What this plan is

The iOS team's release checklist (Nov 2, 2026) lists seven website and backend items, four decisions and three backend questions it needs settled before the app can go to App Review. This plan is our side of that checklist. It corrects the checklist where it describes code that no longer exists, adds work the checklist does not list, and records who decided what.

It has three kinds of work, kept apart:

- **Milestones M1 to M8**: code and content changes in this repository. Each is a reviewable PR.
- **Operator steps O1 to O10**: things only the operator can do in the Apple, Porkbun and Clerk accounts and in production.
- **The order of operations** across our side, the iOS team and submission.

Two readers. The approver (Shane) reads the open questions, the decisions, the checklist table and each milestone's goal. The implementer (a coding agent) reads each milestone's implementation outline and definition of done, and reads the code before acting. Once committed, the plan is shared with the iOS team by its GitHub URL, so it must stay readable to someone outside this repository: repository-specific terms are defined where they first appear.

Who found what. "Checked" means the plan's author read the file or ran the command. "The investigator" is the agent that read this repository at commit `2070791`. "The researcher" is the agent that read Apple's, Clerk's and Google's documentation; its URLs are cited where the plan relies on a rule. "The orchestrator" is the agent that ran both and recommended each decision to Shane. Clerk is the sign-in provider the website and the iOS app share.

Hygiene rules for this file, because the repository is public: no secrets, no Clerk instance or application IDs, no Apple Team ID, no publishable keys, no personal email addresses. "The support address" means `support@tiddly.me` (decision 5). "The operator" means Shane. The Team ID rule stands even though the Team ID is public by construction (P9): the plan does not need it.

## Open questions for the iOS team

Jeremy has not been consulted on any of this yet. The answers are not guessed. Work that depends on an answer says so.

1. **Has any build ever been uploaded to App Store Connect under the bundle ID registered in Clerk today, in any team, and does an app record named "tiddly" already exist?** Apple does not let a team delete an explicit App ID for an app that was uploaded, and an app transfer needs a version released on the App Store, so a TestFlight-only app cannot move to Shane's team (D1). Under decision 1 the app therefore ships under a new bundle ID chosen with Jeremy. Does Jeremy agree to decision 1 (Shane's individual account publishes; Jeremy works as an App Store Connect user; Shane creates and hands over the signing material) and to the new identifier? If a record named "tiddly" exists in Jeremy's team, Jeremy removes it after confirming in App Store Connect Help that removal frees the name: Apple's "Remove an app" page says "If you remove an app, you'll lose ownership of the app name" and does not say outright that another team can then take it (https://developer.apple.com/help/app-store-connect/create-an-app-record/remove-an-app). If the name cannot be reused, the store name is Shane's call. Blocks O1 and O2, and therefore Sign in with Apple and submission.
2. **Does the app register tiddly.me as an associated domain** (universal links)? If yes, M7 serves the `apple-app-site-association` file and Jeremy supplies its contents. If no, that work is dropped. If yes, the path patterns must exclude `/app/delete-account`, `/privacy` and `/terms`, so the app's own links to them open in the browser and not back in the app; and if they include `/shared/*`, the app shows other users' content and needs an in-app report action (guideline 1.2, D6).
3. **How does the app render the FAQ, Known Issues, Terms and Privacy pages**: a web view of the HTML pages, or direct rendering of `/data/faq.json`, `/data/known-issues.json`, `/prose/terms.md` and `/prose/privacy.md`? The plan recommends direct rendering. The `/docs/faq` page carries the site header with Pricing and Sign Up links; `/privacy` and `/terms` carry only a "Back to Home" link (checked: `DocsLayout.tsx` renders `PublicHeader`; `PrivacyPolicy.tsx` renders no header). Only a direct renderer can use the per-item `platforms` field M6 adds to the FAQ.
4. **Does the in-app web view allow free browsing beyond tiddly.me pages?** If yes, the age-rating answer for "Unrestricted Web Access" is yes, and the rating becomes 16+ (Apple's definitions: https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions/).
5. **Does the app set a Firebase user ID or any identifying user property?** The recommendation is no. If no, the policy says the analytics data is not tied to your Tiddly account (M6). The App Store label classification is a separate call for the iOS team against Apple's definition, which counts data linked through a device identifier as well as through an account (https://developer.apple.com/app-store/app-privacy-details/); omitting a user ID does not by itself make the labels "not linked". The checklist's "every analytics item is marked as linked to the person" stays unless the iOS team establishes otherwise.
6. **Does the app move to clerk-ios 1.7.1** (released 2026-11-03, after the checklist's 1.6.2)? Nothing on our side depends on it. Recorded so the checklist's version is not read as current.
7. **Does the app need anything from the deletion page beyond its URL?** The page cannot signal the app that deletion finished. The plan assumes the app opens the URL, and the user returns to the app and uses "Clear this phone and sign out" as the checklist describes.
8. **Add Shane as an owner or admin of the iOS repository, before O2 starts.** A request rather than a question, made now. Three reasons: the repository must not be single-owner; the public-release checklist (O10) runs from Shane's side; and if Jeremy's first upload with the API key fails (O2 step 8), Shane archives and uploads each release candidate himself, which needs the source. Treated as a blocker for O2, not a contingency.
9. **Which Firebase module does the app link, and what does Google retain?** `FirebaseAnalytics` collects the advertising identifier (IDFA) when AdSupport is linked, and the identifier for vendor otherwise (https://support.google.com/firebase/answer/6318039); with the IDFA the app needs Apple's App Tracking Transparency prompt. Firebase documents the variant without IDFA collection: depend on `FirebaseAnalyticsCore` (Swift Package Manager) or `FirebaseAnalytics/Core` (CocoaPods) instead of `FirebaseAnalytics`, and do not link AdSupport (https://firebase.google.com/docs/analytics/configure-data-collection?platform=ios). The answer decides which identifier E2 and M6 name. Also: how does a user withdraw analytics consent in the app, and what retention is set in the Firebase project? Both go in the policy.
10. **How does the app open the deletion URL?** In `SFSafariViewController` or `ASWebAuthenticationSession`, never a `WKWebView`: Google refuses sign-in from embedded web views with `disallowed_useragent` and names `SFSafariViewController` as supported (https://developers.google.com/identity/protocols/oauth2/native-app). A user who signed up with Google could not sign in on the page otherwise.
11. **Does the app's sign-up for every method (email, Google, Apple) use Clerk's prebuilt UI, or pass `legalAccepted` from a real affirmation?** Production has Clerk's legal-consent setting on, and native sign-up under it has never been exercised (`docs/auth0-clerk-ledger.md`, question 17: "documented, not exercised"). O4 tests it with Jeremy.
12. **Does the app revalidate with `If-Modified-Since` alone?** Sharing, archiving and deleting do not move `updated_at`, so a `Last-Modified`-only revalidation can return a stale 304 for those changes; the ETag is the complete validator (`docs/architecture.md` section 16). If the app relies on `If-Modified-Since`, archive, delete and share changes made on the web may not show on the phone. Jeremy answers before the release candidate; if the answer is yes, a native fix (revalidate with the ETag, or treat those changes as updates) is a release gate.
13. **Does the app have a build configuration that points at the dev Clerk instance and a dev API URL?** If yes, TestFlight builds with that configuration can serve O4 step 5 and O8 part A instead of development-signed builds on registered phones, which on an individual account only Shane can provision (O2 step 6). A TestFlight build has its API URL compiled in and each build passes Apple's processing, so this works only if the dev API URL is a stable hostname the operator can serve on the test day (a named tunnel or a reserved domain), or the app lets a tester set the API URL in-app; today's dev tunnels are recreated per session (`README_DEPLOY.md` 6f).

## Decisions

### Decided by Shane on 2026-11-08, on the orchestrator's recommendation

Each entry gives the decision, the reason, and the finding it rests on. The implementer does not change these; new evidence against one is reported in the PR, not acted on.

**D1. Apple Developer account and team.** Shane enrolls in the Apple Developer Program as an individual and publishes the app from that account, so the App Store seller is the person the privacy policy names as operator (the privacy policy's source file, `frontend/src/content/prose/privacy.md`, line 11: "operated by Shane Kercheval as an individual"). Jeremy is added as an App Store Connect user with the App Manager role, which lets him manage the listing, metadata and submission. He cannot sign or upload builds on his own: users added to an individual account are not team members and have no access to Certificates, Identifiers & Profiles, the section of the developer account where signing material and identifiers are created (https://developer.apple.com/support/roles/: "If you're enrolled as an individual and add users in App Store Connect, users receive access only to your content in App Store Connect and are not considered part of your team"; "Certificates, Identifiers & Profiles is only available to Account Holders and members of an organization's team"). So Shane creates the distribution certificate, the App IDs for the app and its share extension, the App Group, the Services ID and the Sign in with Apple key (O2), hands the signing material to Jeremy by a secure channel, and gives him an App Store Connect team API key with the App Manager role for uploads with Transporter (O2 step 7). Apple documents Transporter uploads with API-key tokens and lists App Manager among the roles that can upload builds; whether a team API key works for uploads on an individual account was not found in Apple's documentation, so the first upload is the test. If it fails, Shane uploads each release candidate himself from a Mac with Xcode, which is why open question 8 (repository access) is asked before O2. Enrollment rules: https://developer.apple.com/support/enrollment/.

The web Services ID (Sign in with Apple on tiddly.me) and the iOS App ID must be in this same Apple team. Apple scopes the user identifier and the Hide My Email relay address per team, so different teams would make one Apple user two Clerk users. Source: https://developer.apple.com/documentation/signinwithapple/transferring-your-apps-and-users-to-another-team.

The app ships under a new bundle ID chosen with Jeremy (open question 1). Apple does not let a team delete an explicit App ID for an app that was uploaded to App Store Connect (https://developer.apple.com/help/account/identifiers/delete-an-app-id/), and an app transfer between teams needs a version released on the App Store (https://developer.apple.com/help/app-store-connect/transfer-an-app/app-transfer-criteria: "The app must have at least one version that was released to the App Store"). The existing identifier therefore stays in Jeremy's team if any build was uploaded under it, which the checklist's TestFlight testers suggest. Nothing is transferred, so the 60-day Sign in with Apple user migration does not apply. Precondition, and the first operator step: open question 1 answered and Jeremy in agreement; the decision is reversible only before any Apple configuration starts. Two alternatives were rejected. Shipping from Jeremy's team would show a seller name other than the operator the policy names, and a later transfer to Shane's team would force every Sign in with Apple user to be migrated within 60 days (https://developer.apple.com/documentation/signinwithapple/transferring-your-apps-and-users-to-another-team). Enrolling as an organization would give Jeremy team access but needs a registered legal entity and a D-U-N-S number, and Tiddly is operated by an individual (https://developer.apple.com/support/enrollment/).

**D2. A Tiddly-owned "Delete account" page**, rather than a link into `UserProfile`, Clerk's prebuilt account-management component. The page has our own confirmation step, calls Clerk's documented `user.delete()` from the client through Clerk's reverification wrapper (M4), and then runs the web app's existing account-deleted teardown, which ends on the `/account-deleted` confirmation page. It says what the policy says about timing and nothing stronger (the account is deleted immediately; data is removed within the stated bound, E2), lists what is removed (content, tags, filters, version history, tokens, shared links, the sign-in identity), and shows Apple's instructions for removing Tiddly from an Apple account for users who signed in with Apple (decision 3). Its URL is the deliverable for the iOS team.

Reasons: Apple's account-deletion guidance wants the page to say how long deletion takes and to confirm completion (https://developer.apple.com/support/offering-account-deletion-in-your-app/). An app using Clerk's prebuilt UI was rejected in September 2026 because the delete option was hidden under Security (https://github.com/clerk/clerk-ios/issues/572). Today deletion lives only inside `UserProfile` on `/app/settings/account`, on its Security tab (checked: `SettingsAccount.tsx` line 51).

Included: the deep-link fix. A signed-out visitor who opens a protected URL must land on that URL after sign-in. Today the component that guards signed-in pages, `ProtectedRoute.tsx`, redirects to `/` at lines 71 to 72 with no memory of the path, and `LandingPage.tsx` lines 415 to 416 send every signed-in user to `/app/content` (both checked). M3 sizes this at four frontend files plus tests. A deliberate logout must not carry a return target.

One claim to verify in M4, not assume: a client-side `user.delete()` fires the same Clerk `user.deleted` webhook as a deletion through `UserProfile`, so the backend cascade runs. The deletion still happens in Clerk, so it should, but nobody has checked.

Watch the existing `ProtectedRoute` behavior: any sign-out that is not a deliberate logout is treated as session expiry and raises the "sign back in" dialog (checked: `ProtectedRoute.tsx` lines 54 to 61). After deletion the user must see the deleted confirmation instead. Setting the existing flags before the call is not enough either: with `deliberateLogout` set, the same component redirects to `/` as soon as Clerk reports signed-out, before the result arrives (lines 71 to 72, checked). M4 holds the page with a pending-deletion flag until the result, then runs the existing teardown in `AuthProvider.tsx` (the `onAccountDeleted` callback, lines 170 to 202); see M4 step 4.

**D3. Sign in with Apple token revocation: accepted for 1.0 without revocation.** Clerk does not revoke Apple tokens on deletion (Clerk's iOS guide says deleting the user from Clerk "does not reset this on Apple's side": https://clerk.com/docs/ios/guides/configure/auth-strategies/sign-in-with-apple). For sign-ins made in the iOS app, Clerk never receives an Apple access or refresh token; the SDK sends only the ID token (researcher's reading of clerk-ios 1.6.2 source). So a backend-only revocation is impossible. Apple's technote TN3194 (October 2025) says that when no token is held, delete the data and direct the user to Apple's manual instructions: https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple. The deletion page carries those instructions, which are at https://support.apple.com/en-us/102571.

Recorded for 1.1: real revocation needs the app to run a fresh Apple sign-in at deletion time and send our backend an authorization code, plus backend work (exchange the code, then call Apple's revoke endpoint with a client secret signed by the Sign in with Apple key: https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens). The backend holds no Clerk secret key today (checked: `README_DEPLOY.md` 6e). That is iOS work as well as backend work and is out of scope here.

**D4. Pricing, Pro and AI wording in pages the app shows: leave the web content as it is.** The US storefront has allowed purchase links since Apple's guideline change of May 1, 2025 (https://developer.apple.com/news/?id=9txfddzf; the 3.1.3 introduction now exempts "apps on the United States storefront"). Stripping pricing is caution, not a requirement. The rejection pattern reviewers report is web-paid features working inside the app, guideline 3.1.1 (forum threads https://developer.apple.com/forums/thread/828238 and https://developer.apple.com/forums/thread/825551). Hiding tier and AI UI inside the app is the iOS team's work. Note for the review notes: today nobody pays. `terms.md` line 124 says the service is free during beta, and `llms.txt` (the agent-facing summary served at https://tiddly.me/llms.txt) says every account has Pro access at no charge (both checked), so there is no web-paid feature for a reviewer to find.

Our side adds an optional per-item `platforms` field to the FAQ data so the app can leave out the Pro and pricing questions when it renders `/data/faq.json` (M6). The web renderer ignores the field unless the implementer finds a reason it should filter too. The validator keeps only known fields today (checked: `faq.ts` lines 37 to 46), so the field has to be made official.

Demo accounts for App Review stay on the Pro tier like every other account (decided by Shane on 2026-11-08, after the plan's first draft said Free). Reason: a new account's tier defaults to `pro` during beta (checked: `backend/src/models/user.py` lines 44 to 50, "BETA: default to 'pro'"), so every account is Pro at no charge, and nothing is sold anywhere today. Putting the demo accounts on Free would need a production database write and would show the reviewer an account unlike any real one. The review notes say so (M8).

**D5. Support address.** `support@tiddly.me` (the name decided by Shane on 2026-11-08), a Porkbun Email mailbox rather than free forwarding, because the address also sends user mail (policy notices, takedown correspondence) and Porkbun's forwarding is receive-only (corrected after the second review; evidence and the cheaper options ruled out are in O3). It becomes the contact in the FAQ, the contact and report links on share pages, the App Store support contact, and it replaces the personal address in the privacy policy and terms. Finding: the only contact email today is a personal address, in `privacy.md` (lines 135, 179, 189) and `terms.md` (line 256), and nothing else on the site offers a contact (checked). No tiddly.me mailbox exists; the only sending domain is Clerk's `clkmail` subdomain (`README_DEPLOY.md` 6b). Steps in O3.

**D6. Share-page links and a takedown runbook.** Every public share page (`/shared/{bookmarks|notes|prompts}/{token}`) gets a "Contact" link and a "Report this page" link, both `mailto:` links to the support address, with the share URL prefilled in the report. No form and no backend. Plus a takedown runbook in `README_DEPLOY.md` next to the existing runbooks. Finding: share pages have no contact or report link (checked: `PublicItemShell.tsx`, `Footer.tsx`). There is no admin endpoint; share state is owner-scoped (investigator's reading of `services/base_entity_service.py`). A takedown is a direct database write that sets `is_public` to false and nulls `public_token`, which the check constraint allows only together (checked: `models/bookmark.py` lines 46 to 49, same shape in `note.py` and `prompt.py`). The public lookup requires `is_public` true (checked: `services/public_item_service.py`), and public responses revalidate on every request (investigator's reading of `core/http_cache.py`), so a takedown applies on the next request. Apple's guideline 1.2 requires four things of apps whose users publish content: filtering objectionable material, a report mechanism with timely responses, the ability to block abusive users, and published contact information (https://developer.apple.com/app-store/review/guidelines/#user-generated-content). Decided by Shane on 2026-11-08 after review: no content filtering is built (a product call Shane may change); reporting and contact are the links above; blocking is a two-tier runbook step (M1): first offense, unpublish the share; repeat abuser, block the email in Clerk and delete the user in Clerk, so the webhook cascade removes data, tokens and shares and the identity tombstone makes any held token fail once the webhook commits and the auth cache is evicted. The blocklist must first be enabled on the production instance, a one-time production change with per-change approval, rehearsed on dev; whether it applies to Google and Apple sign-ups is unverified until that rehearsal. "Delete for repeat abusers" is Shane's product call on 2026-11-08, reversible. A Clerk ban alone is not enough: a held CLI token stays valid for up to 24 hours, the backend verifies it without asking Clerk, and it can create a new personal access token (`docs/architecture.md` section 5; `api/routers/tokens.py` accepts session-only auth, which the CLI token has; both checked). The review notes say: content is visible only to people with the link, the app shows no other user's content, reports go to the support address, abusers are banned. If universal links include `/shared/*`, the app does show other users' content and needs an in-app report action (open question 2).

**D7. "Beta" wording in the Terms of Service stays for 1.0.** Apple bars beta apps (guideline 2.2), but the rejections reported involve app names and listings, not a terms page. Changing the beta framing is a legal decision for Shane to make separately. The wording is at `terms.md` lines 17 to 32, 124, 181 and 209.

**D8. AI usage rows after deletion.** Rows in `ai_usage` (the table of hourly AI-usage buckets) keep a `user_id` with no foreign key (checked: `models/ai_usage.py`, `user_id` is a plain UUID column), so they survive account deletion and the policy's "all data permanently deleted" is not strictly true. M2 deletes them in the deletion path. The deletion must stay a fixed number of statements regardless of account size (`docs/architecture.md` section 16, and the statement-count test in `backend/tests/services/test_user_deletion.py`, both checked), so this is one more set-based delete, not a loop. M2 also makes the hourly flush drop a bucket whose user no longer exists (decided by Shane on 2026-11-08, on the orchestrator's recommendation; one query). That check alone leaves a race: the flush can see the user, the deletion can commit, and the flush can then insert (reviewer finding, confirmed by reading the loop). Decided by Shane on 2026-11-08 after review: no locking between the flush and deletion; instead the daily cleanup task gets a set-based sweep of `ai_usage` rows whose `user_id` has no `users` row, next to its existing sweeps. A row written in that window is removed by the next successful daily sweep, which the policy's bounded wording (E2) covers.

**D9. The iOS app repository goes public after 1.0 ships, not as a release blocker.** Preconditions are the post-release checklist in O10: settle ownership of the iOS code (IP assignment or license grant if Jeremy wrote it), choose a license (Elastic License 2.0 to match this repository), run a secret scan over the full git history, remove the environment identifiers this project keeps out of public repositories (Clerk instance and application IDs; the Apple Team ID is not one of them, see P9), and review the Firebase configuration file for anything that should not be public. One step happens now, not after release: Jeremy is asked to add Shane as an owner or admin of the iOS repository (open question 8), so the repository is not single-owner and the checklist can run from Shane's side.

### Settled by evidence (the orchestrator's decisions; Shane may overrule)

**E1. There is no consent version decision.** The blocking consent gate (an HTTP 451 on every API call until the user re-accepted the policies) was retired on 2026-08-01 (`docs/implementation_plans/2026-08-01-consent-simplification.md`, `docs/architecture.md` section 5). A policy version bump changes only the "Last Updated" date and creates the email-notice obligation in the runbook inside `backend/src/core/policy_versions.py` (checked). Nobody is ever locked out, so the policy update publishes as soon as it is ready and does not wait for TestFlight. The checklist's decision 2, item 5 and both backend questions (`needs_consent` or 451, and `DELETE /tokens` and consent) describe code that no longer exists: `GET /consent/status` returns 404 (asserted by `backend/tests/test_consent_gate_removed.py`), and `/settings/consent` was never a page (it was an OpenAPI example string deleted in August). The iOS team removes its 451 handling. `DELETE /tokens/{token_id}` is session-only, so a personal access token cannot revoke itself (investigator's reading of `api/routers/tokens.py`); noted for completeness.

**E2. What the privacy policy update covers**, as categories: the iOS app as part of the Service; Google Firebase Analytics as a processor, with device identifiers (the Firebase app instance ID, and either the identifier for vendor or the advertising identifier, depending on which module the app links, open question 9: https://support.google.com/firebase/answer/6318039), approximate location derived from IP address, and usage events, collected only after the in-app consent prompt; Sign in with Apple (name, email or Apple relay address); the operator and seller named consistently; the Apple revocation instructions. It removes the checklist's "IP address and user agent stored at consent" (that table was dropped on 2026-08-01). It replaces the current "within 30 days" with a bounded promise, corrected after review on 2026-11-08: the account is deleted immediately; your data is removed always within 30 days; the sign-in provider's identifier for the deleted account is kept for 30 days to block reuse of the deleted sign-in and removed within the following day (the sweep in `tasks/cleanup.py` deletes tombstones strictly older than `DELETED_IDENTITY_RETENTION_DAYS = 30` on a daily run, and its boundary test in `test_cleanup.py` keeps an exactly-30-day-old row; both checked); the internal timings per store are listed in M2 and the known limitations, not in the policy; database backups expire within N days, N supplied by Shane from Railway's backup settings; a failed deletion signal is completed by hand within the same bound (`README_DEPLOY.md` 6f). The deletion page says the same and nothing stronger (D2, M4). It drops "Posting a notice on the Service" as a notification channel, because no such mechanism exists (the consent plan put an in-app notice surface out of scope). It fixes "(future: auto-delete after 30 days)" at `privacy.md` line 149, since the daily cleanup cron already does it. Whether analytics are described as tied to the account depends on open question 5; the App Store label classification is the iOS team's call against Apple's definition, which counts device identifiers (open question 5). Also corrected after review: the Clerk entry gains Clerk's per-session data (IP address, approximate location, browser and device type) and the names received from Google and Apple sign-ins; the "aggregated, not individual" sentence at `privacy.md` line 49 is rewritten, since Firebase collects per-install events; the bring-your-own-key sentence at line 120 becomes "never stored on our servers", because the browser keeps the key in local storage (`frontend/src/stores/aiStore.ts`, checked); and Firebase retention and consent withdrawal are added once open question 9 is answered. The prose is legal content: the agent drafts, Shane reviews the wording before it ships. Both version constants bump. The email notice is operator step O9. Apple's side: guideline 5.1.1(i) requires the policy to describe all collected data including third-party SDKs (https://developer.apple.com/app-store/app-privacy-details/).

**E3. Sign in with Apple on the web.** Enable the Apple social connection on the Clerk dev instance first, with custom credentials (Services ID, Team ID, Key ID, the `.p8` key), and test a brand-new Apple sign-up in a browser with Clerk's legal-consent setting on (it adds the terms checkbox to sign-up). The Google path was tested for the class of bug in https://github.com/clerk/javascript/issues/8338 (an SSO sign-in that turns into a sign-up can fail at legal acceptance); Apple never was. Then production via a targeted `clerk config patch`, never a whole-file `clerk config put`: the consent-simplification plan's M1 records that a whole-file put resets the production Google credentials to dev values. Apple side: a Services ID with the Clerk Frontend API domain (`clerk.<domain>`, the subdomain Clerk serves from) and the return URL copied from the Clerk dashboard, no domain verification file needed (https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/); and register Clerk's "Email Source for Apple Private Email Relay" value under Sign in with Apple for Email Communication, or Hide My Email users never receive Clerk's codes (https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/; Clerk's web guide: https://clerk.com/docs/guides/configure/auth-strategies/social-connections/apple). The web sign-in UI is Clerk's prebuilt components, so no frontend code lists providers (checked: `AuthProvider.tsx` opens `clerk.openSignIn`; `SessionExpiredDialog.tsx` mounts `<SignIn>`). Every production Clerk change is a per-change approval from Shane, rehearsed on dev first. Update `clerk/config.dev.json` by re-pull when dev changes, per `clerk/README.md`, committed as pulled (P9).

**E4. The App Review window.** Clerk's Device Trust asks for an emailed code on a password sign-in from a new device and has no per-account exemption (https://clerk.com/docs/guides/protect/device-trust). A reviewer cannot receive that code, and Apple's workaround of putting codes in the review notes does not fit one-time codes (https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review). So Device Trust is turned off in production for the review window and turned back on after approval (O7). Whether production has it on today is unverified: the committed config is the dev instance, where `auth_password.device_trust.enabled` is true (checked: `clerk/config.dev.json` lines 54 to 56). The first step is to read the production config. Two demo accounts (email and password, sample content that is not real people's data) are created in production by the operator, who accepts the terms through Clerk's sign-up checkbox (O6). The review notes name one of them for the reviewer's deletion test, and before every submission the operator signs in to both and recreates any that is missing (M8), since a reviewer who deletes an account would otherwise break the next resubmission. After Device Trust is turned off, the operator signs in to both demo accounts from a fresh browser session and a clean native install without opening their inboxes; a config re-pull proves the setting, not that a reviewer on a new device gets in (O7's done-when). A test deletion runs end to end in production with a throwaway account (O8). The pages the app shows are checked for the wording the iOS team cares about before submission.

**E5. Website launch surfaces** (not in the checklist): a docs page for the iOS app under `/docs`, FAQ entries, a changelog entry, the roadmap's "Mobile app" item moving to Shipped with a date, a mention in `frontend/public/llms.txt`, an App Store badge on the landing page (only when the app is live), the `apple-itunes-app` Smart App Banner meta tag in `frontend/index.html` (a static head, applies site-wide, needs the App Store ID), and `ios` added to the labels and filter the Version History settings page uses for where an edit came from (frontend only; the backend filter is free-form, checked: `api/routers/history.py` lines 176 to 181). Universal links are conditional on open question 2: the `apple-app-site-association` file at `/.well-known/`, which Vite copies from `public/` (the investigator built it to confirm) and Caddy serves, but with no `Content-Type` unless one header line is added to `frontend/Caddyfile`. Today that path returns the HTML shell (researcher's live check). All in M7.

### Decided while writing this plan (the plan author's choices; open for Shane)

The brief left these to the writer. Each is a recommendation with the alternative. The implementer treats them as decided unless Shane changes them. Shane reviewed the first draft on 2026-11-08 and reversed P9 and P10; those two are now his decisions and say so.

**P1. Deletion page URL: `/app/delete-account`.** Mounted under `ProtectedRoute` as a sibling of `Layout`, like `/app/save-shared/:type/:token` (checked: `App.tsx` lines 160 to 169), so it renders without the app shell's sidebar and reads cleanly at phone width in the app's web view. Alternative: a settings sub-route, which would render inside the settings navigation. Settings, then Account, gets a link to the page so web users find it.

**P2. The confirmation step: the user types a fixed word** (Clerk's own `UserProfile` requires typing "Delete account"). Alternative: a checkbox plus a second click. This is a UX choice; Shane may change it.

**P3. The FAQ field is `platforms`**, an optional array whose allowed values are `web` and `ios`. Absent means every platform. An empty array is invalid. The web renderer does not filter.

**P4. Share-page links.** "Contact" is `mailto:<support address>`. "Report this page" is `mailto:<support address>?subject=Report%20a%20shared%20page&body=<encoded share URL>`. Both sit in the row that already holds "Save a copy" and the signed-out blurb (`PublicItemShell.tsx` lines 133 to 143), visible to every visitor. The support address lives in one frontend constant (new file, for example `constants/support.ts`); the markdown and JSON content carry the literal address, with a test that every `mailto:` in `content/` matches the constant.

**P5. No "Contact" link in the shared footer.** The footer appears on every public page, so one link there would cover the FAQ page and the share pages at once. Left out because it changes every public page's footer, which is a product choice. Shane may add it.

**P6. The docs page is top-level: `/docs/ios`**, nav label "iOS App", with a card on `/docs` (`DocsOverview.tsx`). The app is not a browser extension, so it does not go under `/docs/extensions`. Alternative: `/docs/extensions/ios` with a hub card.

**P7. A new changelog tag `ios`.** The validator's allowed tags are web, api, cli, extension, site, performance and ai (checked: `content/data/changelog.ts` line 16). Adding a tag touches the validator, the renderer's tag colors, the manifest description in `plugins/dataContent.ts`, and `changelog.test.ts`. Alternative: tag the entry `site`.

**P8. History source labels: add `ios` as "iOS app" and keep `iphone` as "iPhone" (the iOS shortcut).** The two are different clients; older `iphone` rows may exist in production (unchecked). Alternative: one "iPhone" filter that maps to both values.

**P9. The Apple identifier fields in `clerk/config.dev.json` are committed as pulled.** Decided by Shane on 2026-11-08, on the orchestrator's recommendation; it reverses the plan's first draft, which redacted them. Enabling Apple on dev with custom credentials makes `clerk config pull` return the Services ID, Team ID, Key ID and bundle ID in the `connection_oauth_apple` block (today all empty strings, checked: lines 119 to 128). The Apple Team ID is public by construction: it is in every signed build, in Clerk's own `apple-app-site-association` file today (researcher's live check), and in Apple's association-file format. So M5 commits the pulled file with no redaction and no exception in `clerk/README.md`, and the drift check stays clean. The hygiene rule for this plan file is unchanged: the plan does not need the Team ID, so it does not write it.

**P10. The universal-links file is committed under `frontend/public/.well-known/` like any other static file.** Decided by Shane on 2026-11-08, on the orchestrator's recommendation; it reverses the plan's first draft, which generated it at build time. If open question 2 is yes, Jeremy supplies the contents (the team-prefixed app ID and the path patterns), the file is committed, Vite copies it into `dist/`, and Caddy serves it with the header line from M7. No build-time generation. The Team ID it contains is public by construction (P9).

**P11. The sign-in modal opens automatically when a signed-out visitor arrives with a return target.** The iOS app's deep link to the deletion page lands a signed-out user on `/`, and sign-in is the only next step. Alternative: show the landing page and let the user click Log In. UX choice; Shane may change it.

**P12. Clerk's `UserProfile` deletion stays as a second path.** CSS hiding would break silently when Clerk renames a class (investigator's finding). O8 observes what that path shows after deletion; if it raises the expiry dialog, that becomes a known limitation and a separate decision.

## The iOS team's checklist, item by item

| Checklist item | Where this plan handles it, or why it is moot |
|---|---|
| Decision: who is the App Store seller | D1, O1. The seller is the operator the policy names. Apple has no written rule that the two must match (researcher: none found), but the mismatch is avoided anyway. |
| Decision: does the policy update bump the consent version | Moot. E1: a bump changes the date and obligates an email notice; nobody re-accepts. The update publishes when ready (M6, O9). |
| Decision: can Clerk revoke Apple tokens on deletion | D3. No. 1.0 ships with Apple's manual instructions on the deletion page. Nothing to ask Clerk. |
| Decision: fallback if Apple rejects the 3.1.3(f) argument | D4. The 3.1.3(f) argument is the wrong basis: the US storefront allows purchase links, and the risk is 3.1.1 (web-paid features in the app), which does not apply while nobody pays. Hiding Pro and AI in the app is still the iOS team's mitigation. No in-app purchase decision is needed now. Review notes should say: free app, no purchases, US only, nothing is sold anywhere today. |
| 1. Account deletion page | M2, M3, M4, O8. "Must also work for an account that never accepted the terms": deletion has no consent precondition (investigator's reading of the webhook and delete service). |
| 2. Contact option on the FAQ page | M1 (FAQ entry with the support address), O3 (the mailbox). The App Store support URL is `https://tiddly.me/docs/faq`. |
| 3. Sign in with Apple in Clerk production, app and web | O1, O2, O4, O5, M5. The web flow needs the Services ID, key, Team ID and Key ID in Clerk (E3). The email-relay registration, missing from the checklist, is in O2. |
| 4. Privacy policy update | M6, O9. "IP address and user agent stored at consent" is removed: that data no longer exists (E2). |
| 5. A page for accepting updated terms | Moot. E1: no such page, no such endpoint, no re-acceptance. The app removes its 451 handling and its "Review terms" flow. |
| 6. Share pages carry a contact link and a report link; a report leads to unpublishing | M1 (links, the takedown runbook, the repeat-abuser step). Guideline 1.2's filtering requirement is not built (D6). |
| 7. No pricing, upgrade, Pro or AI text in pages the app shows | D4, M6. Web text stays. The FAQ gets the `platforms` field; the app filters. The pre-submission wording check stays (order of operations). |
| Backend question: `GET /consent/status`, `needs_consent` or 451 | Moot. The endpoint returns 404; nothing returns 451. |
| Backend question: is `DELETE /tokens` exempt from the consent check | Moot. There is no consent check. `DELETE /tokens/{token_id}` requires a session token. |
| Production Clerk: is sign-up on | Yes. `sign_up_mode` is `public` since 2026-07-15 (`README_DEPLOY.md` 6c). |
| Production Clerk: is automatic user creation on | Yes. `CLERK_JIT_CREATE_ENABLED=true` in production (`README_DEPLOY.md` API service variables; `docs/architecture.md` section 5). |
| Production Clerk: do new devices need an email code | Probably. Dev has Device Trust on; production is read in O7 and turned off for the review window. |
| App Store Connect: privacy policy URL | `https://tiddly.me/privacy`, after M6 is live. |
| App Store Connect: support URL | `https://tiddly.me/docs/faq`, after M1 is live. |
| App Store Connect: privacy labels, analytics linked to the person | The iOS team's call against Apple's definition, which counts device identifiers (open question 5). The policy says only "not tied to your Tiddly account" when no user ID is set (E2). |
| App Store Connect: age rating, user-generated content | Open question 4 decides the web-access answer. Public share links count as user-generated content under Apple's definition. |
| App Store Connect: two demo accounts that accepted the terms on the web after the policy is published | O6. Acceptance happens once, at sign-up, through Clerk's checkbox; there is no re-acceptance to wait for. |
| Order of operations: the policy update waits for TestFlight | Replaced. See the order of operations at the end. |
| Mobile work: "Updated terms (a 451 from the API)" | Remove. The API never returns 451. |
| Mobile work: Delete Account opens the website's deletion page | The URL is `https://tiddly.me/app/delete-account` (P1), delivered after O8. |

## Required reading for the implementer

Read these before starting the milestone that cites them.

Repository:

- `docs/architecture.md` section 5 (authentication, the webhook, deletion order), section 16 (the constant-statement deletion invariant), section 17 (drift risks).
- `docs/implementation_plans/2026-08-01-consent-simplification.md` (why there is no consent gate; the "never a whole-file put" rule in M1; the version-bump runbook in M6).
- `docs/ios-clerk-migration-guide.md` (what the iOS app was told about auth and deletion).
- `backend/src/core/policy_versions.py` (the runbook that a version bump obligates).
- `README_DEPLOY.md` step 6 (Clerk configuration, the Google credentials pattern in 6d, the webhook and replay runbook in 6f).
- `clerk/README.md` (config-as-code workflow, drift check, promotion rules).
- `AGENTS.md` "Files to keep in sync".

Apple:

- Account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- TN3194, deletions and token revocation: https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple
- Apple's user instructions for revoking Sign in with Apple: https://support.apple.com/en-us/102571
- Sign in with Apple for the web: https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/
- Private email relay registration: https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/
- Team scoping and transfers: https://developer.apple.com/documentation/signinwithapple/transferring-your-apps-and-users-to-another-team
- Roles: https://developer.apple.com/support/roles/
- Privacy details and labels: https://developer.apple.com/app-store/app-privacy-details/
- Associated domains: https://developer.apple.com/documentation/xcode/supporting-associated-domains
- Smart App Banner: https://developer.apple.com/documentation/webkit/promoting-apps-with-smart-app-banners
- Review guidelines (1.2, 2.2, 3.1.1, 4.8, 5.1.1): https://developer.apple.com/app-store/review/guidelines/

Clerk:

- Apple social connection, web: https://clerk.com/docs/guides/configure/auth-strategies/social-connections/apple
- Apple sign-in, iOS: https://clerk.com/docs/ios/guides/configure/auth-strategies/sign-in-with-apple
- Device Trust: https://clerk.com/docs/guides/protect/device-trust
- The `User` object (`delete()`): https://clerk.com/docs/react/reference/objects/user.md
- Legal acceptance issue: https://github.com/clerk/javascript/issues/8338

Google:

- What Firebase Analytics collects: https://support.google.com/analytics/answer/10285841

## How "done" is checked

Every milestone's definition of done includes a check of the real result, not only tests. The rules, stated once here:

- Run the feature the way a user would and look at what it does. For frontend work that means a browser at phone width, against the Clerk dev instance, with a throwaway account.
- Check side effects: rows deleted, files in `dist/`, headers on the wire, webhook deliveries in the Clerk dashboard. Never trigger a real outward effect (an email, a production write) without asking.
- Read the actual value, not a cached copy: fetch `/data/faq.json` from the dev server, not the module; read `dist/index.html`, not the source.
- A new test counts only after it has failed on a known-bad input.
- Prefer a check you can script and rerun, and keep the command and its output in the PR description.
- When a check fails unexpectedly, suspect the check first. When it passes too easily, suspect it too.

The tests that must keep passing throughout (from the investigator's inventory, all confirmed present): `frontend/src/content/data/faq.test.ts`, `knownIssues.test.ts`, `changelog.test.ts`, `roadmap.test.ts`, `frontend/src/content/dataContent.test.ts`, `frontend/src/content/proseDocs.test.tsx`, `frontend/src/pages/Pricing.test.tsx`, `frontend/src/data/docsRoutes.test.ts`, `frontend/src/components/ProtectedRoute.test.tsx`, `AuthProvider.test.tsx`, `frontend/src/utils/returnTo.test.ts`, `backend/tests/services/test_user_deletion.py`, `test_user_cascade.py`, `test_user_deletion_concurrency.py`, `backend/tests/api/test_webhooks.py`, `backend/tests/test_consent_gate_removed.py`, `backend/tests/core/test_tier_limits.py`. Run `make frontend-verify` for frontend milestones and `make backend-verify` for backend ones.

## Milestones

Each milestone is one PR. Order within the plan is dependency order; M1, M2 and M3 are independent and can run in parallel.

### M1. Support contact in the FAQ, share-page links, takedown runbook

Depends on: nothing in code. The mailbox (O3) can be created in parallel; the links work as soon as forwarding is live. The address is `support@tiddly.me` (D5).

#### Goal and outcome

Anyone can reach the operator from the public site, and the operator has written steps for taking down a shared page.

- The FAQ page shows a support email address without signing in.
- Every public share page shows "Contact" and "Report this page", and the report email arrives with the share URL in it.
- `README_DEPLOY.md` says how to take down a shared page, who decides, how to confirm, and what to do about a repeat abuser.

#### Implementation outline

1. Add one frontend constant for the support address (P4). Everything in code reads it.
2. FAQ: add a section at the end of `faq.json` (for example "Support") with an item "How do I contact support or report a problem?" whose answer links `mailto:` the support address and says reports about shared pages should include the page URL. The FAQ renders on `/docs/faq` and in Settings; both come from this file (`components/FAQContent.tsx`).
3. Share pages: in `PublicItemShell.tsx`, add the two links to the action row (P4). Build the report link with `encodeURIComponent` over the full share URL (origin plus pathname). Show them for signed-in and signed-out visitors alike.
4. Test only M1's own links here. The drift guard over every `mailto:` in `src/content/` lands in M6: today `privacy.md` and `terms.md` carry four personal-address links, so the guard would fail until M6 replaces them (reviewer finding, confirmed).
5. Takedown runbook in `README_DEPLOY.md`, as its own top-level section placed after "Verify Deployment" (the replay runbook stays inside 6f; this one is not a Clerk step). Content:
   - **Who decides**: the operator, on a report to the support address, judged against the acceptable-use section of `terms.md`. Takedown is reversible by the owner republishing, which mints a new token, so the reported URL stays dead.
   - **Find the row**: the share URL is `https://tiddly.me/shared/{bookmarks|notes|prompts}/{token}`. The type picks the table (`bookmarks`, `notes`, `prompts`); the token is the `public_token` column. `SELECT id, user_id, is_public, deleted_at FROM <table> WHERE public_token = '<token>';`
   - **Write**: `UPDATE <table> SET is_public = false, public_token = NULL WHERE public_token = '<token>';` in one statement. The check constraint `ck_<type>_public_requires_token` ("NOT is_public OR public_token IS NOT NULL") allows nulling the token only together with `is_public = false`. This write records no version-history entry and does not touch `updated_at`, which matches what the share endpoints do (`docs/architecture.md` section 5).
   - **Confirm**: `GET /public/<type>/<token>` on the API returns 404, and the share page shows its not-found state. Public responses are sent with `max-age=0, must-revalidate`, so the next request sees the change. Have the implementer confirm the header in `core/http_cache.py` when writing this.
   - **Connect**: the same way the operator runs the verification query in the 6f replay runbook. Every production write is a per-change approval.
   - **Tell the owner**: there is no email capability in the backend; the operator writes to the owner from the support address if warranted. The owner's email is in Clerk, not reliably in `users.email` (nullable).
   - **First offense**: unpublish the share as above. No content filtering exists (D6).
   - **One-time setup, before the first repeat-abuser case**: enable Clerk's blocklist on the production instance (`auth_access_control.blocklist_enabled`; the committed dev config has it false, lines 3 to 7, checked), a production change with Shane's per-change approval, rehearsed on dev first. Clerk's docs say the lists apply only after "Enable blocklist" is toggled on and saved (reviewer's citation: https://clerk.com/docs/guides/secure/restricting-access). The dev rehearsal adds a test email to the blocklist and tries a Google sign-up with it; that also settles whether the blocklist applies to OAuth sign-ups, which is unverified until then.
   - **Repeat abuser, the default** (Shane's product call on 2026-11-08, reversible): add the user's email to the blocklist, then delete the user in Clerk. The `user.deleted` webhook cascade removes their data, personal access tokens and shares; once the webhook commits and the auth cache is evicted, the identity tombstone makes any session, CLI or connector token they still hold fail with the terminal `account_deleted` 401, and a deleted personal access token gets the generic "Invalid or expired token" 401 (`core/auth.py`: `get_or_create_user` and `validate_pat`; `docs/architecture.md` section 5; all checked). The tombstone blocks the dead credentials, not the person: a new sign-up gets a new Clerk ID, which is what the blocklist is for. The terms allow removal: "We may suspend or terminate your access immediately if you: Violate these Terms" (`terms.md`, "By Us").
   - **Completion check for the delete tier**: Clerk's webhook log shows the delivery succeeded; `SELECT 1 FROM users WHERE external_auth_id = '<clerk user id>'` returns no row; a `deleted_identities` row exists; a held session or CLI token gets the `account_deleted` 401 and a PAT gets the generic 401 (rehearsed on dev with a test account's credentials; the operator never holds a real abuser's).
   - **Dispute alternative, unverified until rehearsed, when the data must be kept**: ban the user in Clerk, delete their tokens and unpublish their shares, then repeat both after the access-token lifetime (24 hours plus `core/auth.py`'s five-second leeway). A Clerk ban alone is not enough: Clerk says a ban revokes sessions (https://clerk.com/docs/reference/backend/user/ban-user), but the backend verifies CLI OAuth tokens against Clerk's public keys without asking Clerk, those tokens last 24 hours, and `POST /tokens/` accepts them (`api/routers/tokens.py`, checked), so a banned user could mint a new personal access token and republish. Whether a banned user's refresh token can still obtain a new access token is not established by Clerk's pages (its OAuth guide says refresh tokens never expire). Rehearsal on dev before this tier is ever used: log a test account in through the CLI, ban it, force a token refresh, and try `POST /tokens/`; if Clerk still refreshes, this alternative needs the user's OAuth grants revoked as well, or it is dropped.

#### Definition of done

- Tests: the FAQ validator still passes on the new section; a `PublicItemShell` test asserts both links exist, point at the constant's address, and the report `href` contains the encoded share URL.
- Real check: run the dev server, open a share page as a signed-out visitor at phone width, click "Report this page", and confirm the mail client opens with the subject and the URL in the body. Fetch `/data/faq.json` and see the new section in the raw JSON. Open `/docs/faq` signed out and see the address.
- Docs: `AGENTS.md` "Files to keep in sync" does not need a new entry; the FAQ rule already covers `faq.json`. `docs/architecture.md` section 5's public-sharing paragraph gets one sentence pointing at the takedown runbook.
- Known limitation: the report is an email, so abuse of the report link is bounded only by the operator's inbox. No rate limit, no form.

### M2. Backend: delete `ai_usage` rows in the account-deletion path

#### Goal and outcome

After an account is deleted, its `ai_usage` rows go with it, and any bucket written afterwards is removed by the next successful daily sweep.

- `ai_usage` rows for the deleted user are gone when the webhook handler commits.
- Deletion still issues the same number of SQL statements for a large account as for a small one.
- The hourly flush skips a bucket whose user no longer exists and drops the Redis key; a bucket written in the race window is removed by the next successful daily sweep.

#### Implementation outline

In `services/user_service.py`, `delete_user_by_external_auth_id`, add one set-based delete of `AiUsage` rows by `user_id` next to the existing `ContentFilter` bulk delete, before `db.delete(user)`. Update the docstring's statement count. Do not add a foreign key to `ai_usage`: the flush cron writes rows by raw `INSERT` (checked: `tasks/ai_usage_flush.py`, `_upsert_usage`) and a foreign key would turn a late flush for a deleted user into a failing cron run.

Also in `tasks/ai_usage_flush.py` (decided by Shane on 2026-11-08, on the orchestrator's recommendation): the flush loop upserts each past-hour bucket and then deletes the processed keys after commit (checked: `flush_ai_usage`, the `keys_to_delete` list). Before the upsert, check that a `users` row exists for the bucket's `user_id`; if not, skip the upsert and still add the key to `keys_to_delete`, so it is removed with the rest. One existence query per bucket, or one query over the batch's distinct user IDs; the implementer picks after reading the loop. Reason: the flush can run up to an hour after a deletion, and without this the deleted user's unflushed hour lands in `ai_usage` after the cascade has run. Log the skip at INFO with the user ID so an orphan bucket is visible.

The existence check leaves a race (reviewer finding, confirmed: the flush can read the user, the deletion can commit, and the flush then inserts; `ai_usage.user_id` has no foreign key, so the insert succeeds). Decided by Shane on 2026-11-08 after review: no locking between the flush and deletion. Instead, in `tasks/cleanup.py`, add `cleanup_orphaned_ai_usage` next to the existing sweeps: one set-based delete of `ai_usage` rows whose `user_id` has no `users` row (`NOT EXISTS` over `users`), its count in `CleanupStats`, a call in `run_cleanup` after the tombstone sweep, and a bump of `CLEANUP_TASK_VERSION` (the file says to update it whenever cleanup logic changes). The deletion path itself is unchanged, so the constant-statement invariant holds; a row written in the window lives until the next successful daily run. The first production run also deletes `ai_usage` rows of accounts deleted before M2, and the `ai_usage_analytics` view (`README_DEPLOY.md` 8b, checked) reads that table, so past cost totals drop on that run. Before deploying, the operator counts those rows with a read-only production query (`SELECT count(*) FROM ai_usage u WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = u.user_id);`) and records the number in the PR.

Internal removal timings after a deletion, for the record (the policy promises only "immediately" for the account and "within 30 days" for the data, E2): the webhook cascade removes the user's rows on delivery; an orphan `ai_usage` row written in the race window goes at the next successful daily run; Redis usage buckets go with the next hourly flush that skips them, or at their seven-day expiry if the flush keeps failing (`_COST_TTL` in `services/ai_cost_tracking.py`, checked); the deleted-account identifier stays at least 30 days and goes at the next daily run after that.

Update `docs/architecture.md` section 5's deletion-order sentence and section 16's constant-statement invariant to name the `ai_usage` delete, and section 9's descriptions of the flush cron (drops buckets for deleted users) and the cleanup cron (sweeps orphaned `ai_usage` rows).

#### Definition of done

- Tests in `backend/tests/services/test_user_deletion.py`: a test that seeds `ai_usage` rows for the deleted user and for another user, then asserts the first set is gone and the second untouched. Extend the seeding in `test__deletion_query_count_does_not_scale_with_account_size` so both accounts also carry `ai_usage` rows (6x more for the large one); the equal-count assertion then covers the new delete. See the new test fail first by running it without the service change.
- Real check: against the local database, run the deletion through the webhook route (`backend/tests/api/test_webhooks.py` shows the signed-request shape) for a user with `ai_usage` rows, then query the table directly.
- Flush test in `backend/tests/tasks/test_ai_usage_flush.py`: seed a past-hour `ai_stats` bucket for a `user_id` with no `users` row alongside one for a real user, run the flush, and assert no `ai_usage` row exists for the first, the real user's row does, and both Redis keys are gone. Seen to fail first (today the orphan row is written).
- Real check for the flush: against the local database and Redis, write an `ai_stats` key with a past hour for a user ID that does not exist (the key format is documented on `_parse_key`), run `run_flush`, and query `ai_usage` for that ID: no row, and the key is gone.
- Cleanup test in `backend/tests/tasks/test_cleanup.py`: seed an `ai_usage` row for a `user_id` with no `users` row and one for a real user, run `run_cleanup`, and assert the first is gone, the second stays, and the new stats count is 1. Seen to fail first. Real check: insert such a row in the local database, run `python -m tasks.cleanup`, and query it.

### M3. Frontend: a signed-out deep link survives sign-in

Depends on nothing. M4's deliverable (the deletion URL) is useless to the iOS app without it.

#### Goal and outcome

A signed-out visitor who opens a protected URL ends up on that URL after signing in.

- Opening `https://tiddly.me/app/delete-account` (or any `/app/...` URL) while signed out, then signing in, lands on that page with its query string and hash intact.
- A deliberate logout still lands on the landing page, and the next sign-in on that browser goes to `/app/content`, not to the previous user's page.
- Mid-use session expiry is unchanged: no navigation, the in-place dialog, parked requests replayed.

#### Implementation outline

Frontend only, four source files plus tests (sized by the investigator; line numbers checked here):

1. `components/ProtectedRoute.tsx` lines 71 to 72: for a cold signed-out visit, navigate to `/?returnTo=<encoded pathname + search + hash>` instead of `/`. Encode with `encodeURIComponent`; a raw `#` would end the query string. When `deliberateLogout` is set in the session-expiry store, navigate to plain `/` with no `returnTo`. The `sessionDiedMidUse` branch (lines 54 to 61) must keep returning `<Outlet />`; `ProtectedRoute.test.tsx` guards it.
2. `pages/LandingPage.tsx` lines 404 to 421: read `returnTo` from the URL, sanitize it, and use it instead of `/app/content` for a signed-in user. Pass it to the `login({ mode: 'signup' })` call for the signup CTA. If P11 stands, open the sign-in modal automatically when a sanitized `returnTo` is present and the visitor is signed out.
3. `components/PublicHeader.tsx` lines 32 and 38: the Log In and Sign Up buttons pass the current `returnTo` through to `login()`. Clerk's default post-login destination is `/`, which drops the query string (comment at `AuthProvider.tsx` lines 72 to 76).
4. `utils/returnTo.ts`: a target must start with `/app/`; anything else falls back to `/app/content`, not `/`. Check every caller of `login({ returnTo })` before changing the fallback (the "Save a copy" flow passes an `/app/save-shared/...` target).

Two redirects fire when sign-in completes on `/`: Clerk's `forceRedirectUrl` and the landing page's own `<Navigate>`. Both must point at the same target. The router bridge's `isSameLocation` ignores the hash while `stripOrigin` keeps it (`AuthProvider.tsx` lines 16 to 24); if the landing page navigates from the query value itself, Clerk's handling of the hash stops mattering.

#### Definition of done

- Tests: `ProtectedRoute` puts path, query and hash into `returnTo`; deliberate logout carries no `returnTo`; the landing page uses a safe target, rejects an unsafe one, and falls back to `/app/content`; the header buttons pass the `returnTo` through. There is no `LandingPage` test today; add one. Update `returnTo.test.ts` for the `/app/` rule.
- Real check, in a browser at phone width against the Clerk dev instance: open `/app/settings/tokens?x=1#y` signed out, sign in, and confirm the address bar shows that URL. Run it once with email and password and once with Google, which leaves the page and returns through Clerk's callback, so the target must survive the round trip in both `forceRedirectUrl` and the landing page's `returnTo`; after O4, run it with Apple too. Log out, sign in from the landing page, and confirm `/app/content`. Shorten the dev session lifetime, let a session expire on an editor page, and confirm the dialog appears with no navigation.

### M4. Frontend: the Delete account page

Depends on: M3 (deep link), M2 (so the deletion cascade is complete when O8 runs). Precondition for testing: the dev Clerk instance's `delete_self` switch is on (dashboard-only, not in the config file; `README_DEPLOY.md` 6f item 3), and the dev webhook endpoint is tunneled to a local backend (6f item 1).

#### Goal and outcome

A user can delete their account from one page that says what will happen, and the iOS app can open that page.

- `https://tiddly.me/app/delete-account` shows what deletion removes, that the account is deleted immediately and irreversibly and the data removed within the policy's bound (E2), and Apple's instructions for removing Tiddly from an Apple account.
- Confirming deletes the Clerk user, the backend removes the data through the webhook, and the browser ends on `/account-deleted` without a "sign back in" dialog.
- The same email can sign up again afterwards.
- Settings, then Account, links to the page. Clerk's own deletion inside `UserProfile` still works (P12).
- The page shows which account it will delete, with a way to sign out if it is the wrong one.

#### Implementation outline

1. Route: `/app/delete-account` under `ProtectedRoute`, sibling of `Layout` (P1). Add it to `routePrefetch.ts`.
2. The page imports `useUser` and `useReverification` from `@clerk/clerk-react` (both exported by the installed 5.61.8, checked) and calls `user.delete()` through `useReverification`. Clerk requires a recent verification for account deletion (its table lists "Delete account", strongest available, 10 minutes: https://clerk.com/docs/guides/secure/reverification); a `session_reverification_required` error must open Clerk's verification prompt, not the failure state. A Hide My Email user verifies with a code sent to Apple's relay, so O2's relay registration is a deletion prerequisite for them, and O4 and O5 confirm reverification is enabled on each instance. The lint rule restricts that import to three files (`eslint.config.js` lines 23 to 38); add the page and its test to the `ignores` list and update the comment that counts the exceptions. Do not route the call through the auth seam: the seam exists to keep provider logic in one module, and a one-method prebuilt-provider call on a page is the documented exception pattern (`SettingsAccount.tsx`, `SessionExpiredDialog.tsx`).
3. Content, in this order: heading; the signed-in email and sign-in method (from `user.primaryEmailAddress` and `user.externalAccounts`) with a "Not you? Sign out" link, because the browser's session can belong to a different account than the app's; a list of what is removed (bookmarks, notes, prompt templates, tags, filters, version history, personal access tokens, shared links, the sign-in identity at Clerk); "Your account is deleted immediately and cannot be restored. Remaining data is removed within 30 days; see the privacy policy's Data Retention section for what is kept and how long", with a link to `/privacy` (nothing stronger than the policy, E2); the Apple section: "If you signed in with Apple, also remove Tiddly from your Apple account" with Apple's steps summarized and a link to https://support.apple.com/en-us/102571, shown to everyone (conditional display on `user.externalAccounts` is allowed if it is reliable; not required); the confirmation (P2); the Delete button.
4. On confirm, in this order: set two new entries on the session-expiry store, `deletingUserId` (the active identity's Clerk user ID, which keys the 401 suppression below) and `deletionPending` (which holds the page); then call `user.delete()` through the reverification wrapper. Why a new flag: when Clerk reports signed-out during `delete()`, `ProtectedRoute` today either raises the expiry dialog (`sessionDiedMidUse`, lines 54 to 61) or, if `deliberateLogout` is already set, redirects to `/` (lines 71 to 72) before the result arrives; both checked, so the existing flags are wrong in both orders. Design choice: (a) a pending-deletion flag that `ProtectedRoute` treats as "hold the current page, no redirect, no dialog" until the result, chosen over (b) moving the page outside `ProtectedRoute` with its own signed-in check, because (a) is one store flag plus one condition in `ProtectedRoute`, while (b) would duplicate the cold-visit redirect and M3's return-target logic on the page. In `ProtectedRoute`, the hold is scoped to the deleting identity: when `deletionPending` is true and the last signed-in user ID the component saw equals `deletingUserId` (keep that ID as sticky state beside the existing `wasAuthenticated`, because the active ID from the auth seam is already null once Clerk reports signed-out), render `<Outlet />` and do not call `markExpired`. For any other identity the component behaves as today, so account B's client-only expiry in the same tab is handled normally even while A's deletion is pending. `SessionExpiryGuard` needs no change: it mounts in `RootLayout` beside the routes (`App.tsx` line 81, checked) and renders only when the store's `expired` flag is set. The page has no queries of its own, but a request started by the page the user came from can finish late: `Layout` fires `fetchFilters()` and `fetchTags()` on mount with no cancellation on unmount (`Layout.tsx` lines 88 to 93, checked), and a late generic 401 reaches `parkRequest`, which sets `expired` unconditionally (`sessionExpiryStore.ts`, checked). The suppression is keyed on identity, not on time (a page-mount flag would end while an older request can still finish, and a global flag would also swallow account B's real expiry while A's deletion is pending). The request interceptor stamps every request with `_senderUserId`, the `sub` of the token it attached (`services/api.tsx` line 136, checked), and the park path at line 229 runs in that interceptor with `error.config` in scope, so it passes the sender into `parkRequest` as a new parameter. The deleting-sender check runs at the top of the interceptor's 401 handling, before both the terminal `account_deleted` branch and the refresh-and-retry branch: a 401 whose sender equals `deletingUserId` is rejected with its original error, never refreshed, retried or parked, both during the hold and after the confirmation page mounts, because the 401 is the deletion's own effect. The order matters: today the generic-401 branch (`services/api.tsx` lines 200 to 215, checked) has no sender guard; it calls `getAccessToken({ skipCache: true })`, which after account B signs in mints B's token, and replays A's request with B's credentials. The only sender guard today is inside the `account_deleted` branch (lines 169 to 170), which this check precedes. A 401 from any other identity is handled as today at all times. `markExpired` is not request-driven; it fires from `ProtectedRoute`, which the `deletionPending` hold covers and which is unmounted once the public confirmation route renders. On success, run the existing account-deleted teardown only if the active user ID is still the recorded one or nobody is signed in. Today that cross-account guard lives in the API interceptor (`services/api.tsx`, the `_senderUserId` check against `getActiveUserId()`), not in the `onAccountDeleted` callback, so the extracted function takes the identity and the guard applies to both callers. The teardown is the callback inside `AuthInterceptorSetup` in `AuthProvider.tsx` (lines 170 to 202): mark deleted, clear queries, BYOK keys, drafts and the reading-mode cache, reset the session-expiry store, `beginDeliberateLogout`, navigate to `/account-deleted` (a public route outside `ProtectedRoute`, `App.tsx` line 103), then a fire-and-forget `signOut` pinned there. Extract it into a function both the interceptor and the page call. Clear `deletionPending` in `AccountDeleted.tsx`'s mount effect, beside the existing `clearAccountDeleted()` (line 21, checked), not after `navigate()`: the router applies the new location inside a transition while the store hook renders synchronously (the reviewer's reading of the installed react-router and zustand), so a flag cleared right after `navigate()` can let `ProtectedRoute` render once more at the old location with `deliberateLogout` set and redirect to `/`.
5. On failure (Clerk returns an error, for example when `delete_self` is off, or the user cancels reverification, which rejects with `reverification_cancelled`) and on the skipped-teardown path (the active identity changed before `delete()` resolved): clear `deletionPending` and every other flag the operation set, show the error on the page where there is one, and leave the current user signed in. `deletingUserId` is the exception: it is cleared on the failure path only. Not on the skipped path, because A's deletion did succeed and A's late 401s must still be ignored; and not on the next sign-in either, because B can sign in while A's requests are still finishing. It stays for the tab's lifetime (the store is not persisted) and is overwritten by the next deletion; an entry naming an account that no longer exists is harmless. Do not run the teardown. Nothing sets `accountDeleted` or `deliberateLogout` before the teardown, so on the skipped path account B keeps its unsaved-change protection (`useUnsavedChangesWarning.ts` reads `accountDeleted` at navigation time, checked), and a leaked flag would outlive the operation: `deliberateLogout` until the next sign-in (`SessionExpiredDialog.tsx` line 90, checked), `accountDeleted` across sign-ins, because only `AccountDeleted.tsx` clears it (checked). That is why the failure and skipped paths clear every flag the operation set.
6. Settings, then Account (`SettingsAccount.tsx`): a short block above `<UserProfile />` linking to the page. Update that file's header comment, which currently describes `UserProfile` as the only deletion path.
7. `AccountDeleted.tsx` already confirms completion. Leave it, or add the Apple instructions there too (open; both are allowed).
8. Docs: `docs/ios-clerk-migration-guide.md` line 52 says deletion appears inside the app through ClerkKit's prebuilt views; rewrite that sentence to name the page URL. `docs/architecture.md` section 5 gets one sentence that the page calls `user.delete()` and the webhook does the rest. `README_DEPLOY.md` 6f item 3's sentence about the switch governing "both the embedded `<UserProfile />` and the hosted Account Portal" gains the page.

The claim to verify: on the dev instance, with the webhook tunnel up, delete a throwaway account from the page and watch the local backend log `user_deleted` and the Clerk dashboard's webhook log show a 200 for `user.deleted`. If `user.delete()` does not fire the webhook, stop and report; the fallback would be a backend endpoint that calls Clerk's Backend API, which needs a secret the backend does not hold today (D3).

#### Definition of done

- Tests: the page refuses to call `delete()` until the confirmation is satisfied; calls it exactly once; sets `deletionPending` before calling it; runs the teardown on success; clears the flag, shows the error and does not run the teardown on failure; opens the reverification prompt on `session_reverification_required`; skips the teardown when the active user changed before `delete()` resolved. The hold test: mock `delete()` to return a promise the test controls, flip the auth state to signed-out while it is pending, render under the real `ProtectedRoute` inside a router with the real extracted teardown (a mocked teardown cannot reproduce the redirect, which needs its `beginDeliberateLogout()`), and record every store change with `useSessionExpiryStore.subscribe`. Before resolving: assert `expired` is false and the location is still `/app/delete-account` (assert the store, as `ProtectedRoute.test.tsx` does; the dialog mounts in `RootLayout`, not under `ProtectedRoute`). After resolving: the location is `/account-deleted`, and the recorded changes never set `expired` true (the teardown's `reset()` sets it false, so a check made only after resolution would mask a dialog that fired during the hold). Three interceptor tests, each with the request's `_senderUserId` set: a late generic 401 tagged with A's identity during the hold leaves `expired` false and rejects the request; a late generic 401 tagged with A's identity after `/account-deleted` has mounted (so `deletionPending` is already cleared) also leaves `expired` false; a 401 tagged with B's identity before A's promise resolves sets `expired` as today. Two more: B's client-only expiry (Clerk flips signed-out with B as the last signed-in user) while A's deletion is pending raises `expired` as today, because the hold is scoped to A; and a late 401 tagged with A's identity after B has signed in is still ignored, because `deletingUserId` survives the sign-in. One more, with B's token available from the mocked `getAccessToken`: A's late generic 401 after B signs in is not retried (no refresh call, no second request) and `expired` stays false, which proves the check runs before the refresh-and-retry branch. On the skipped-teardown path assert `accountDeleted`, `deliberateLogout` and `deletionPending` are all false and `deletingUserId` is still A, so a later editor's unsaved-change blocker still fires for account B while A's stragglers stay ignored; on the failure path assert `deletingUserId` is cleared. `ProtectedRoute.test.tsx` gains the hold case. `AuthProvider.test.tsx` covers the extracted teardown and its identity guard on the interceptor path.
- Real check, in a browser at phone width against the dev instance with a throwaway account that has content and a personal access token: open the URL signed out, sign in (M3), confirm the page shows that account, confirm, and see `/account-deleted` with no dialog. Do one deletion with a session older than ten minutes and see Clerk's reverification prompt before it proceeds. The joint check with the app is O8 part A. In the local database: no `users` row, a `deleted_identities` row, no `ai_usage` rows. Sign up again with the same email and succeed. Then delete a second throwaway account through `UserProfile`'s Security tab and record what the browser shows afterwards (P12).
- The deliverable: the URL `https://tiddly.me/app/delete-account`, which the order of operations sends to Jeremy in its first step.
- Known limitation: the page cannot revoke Apple tokens (D3). The page cannot tell the iOS app that deletion finished (open question 7).

### M5. Sign in with Apple on the web: config file and docs

Depends on: O2 (the Services ID, key and relay registration) and O4 (Apple enabled on dev). The code side is small; the milestone exists so the config file and the runbooks land in a reviewable PR.

#### Goal and outcome

The repository describes how Sign in with Apple is configured and how it is promoted, and the committed dev config reflects the enabled connection.

- `clerk/config.dev.json` shows `connection_oauth_apple.enabled: true` with the identifier fields as pulled (P9), and the drift check is clean.
- `README_DEPLOY.md` has an Apple subsection next to 6d (Google) describing both instances.
- The ledger records the Apple sign-up test result.

#### Implementation outline

1. After O4, re-pull the dev config per `clerk/README.md` and commit it as pulled. The `connection_oauth_apple` block will carry the Services ID, Team ID, Key ID and bundle ID; that is intended (P9). `clerk config pull` never returns OAuth client secrets (`clerk/README.md`), so confirm in the diff that `client_secret` is still empty before committing.
2. `README_DEPLOY.md`: a new subsection after 6d, "Apple social connection (custom credentials, both instances)": the Apple-side prerequisites (App ID with the capability, the Services ID with the Frontend API domain `clerk.<domain>` and the return URL copied from the Clerk dashboard, the key, the private email relay source registered under Email Communication), the Clerk-side fields, and the promotion rule: `clerk config patch --instance prod` scoped to `connection_oauth_apple`, with a `clerk config pull --instance prod` diff captured before and after; never `clerk config put` or `clerk deploy` for this (the consent plan's M1 reasoning, also stated in `clerk/README.md`'s promotion section, which this PR corrects to say so). The `.p8` secret is entered where the CLI cannot carry it (the dashboard); say so.
3. 6c's auth-strategies bullet gains Apple.
4. `docs/ios-clerk-migration-guide.md`'s "Sign-in methods to support" line gains Apple. The native flow does not use the Services ID or the key (Clerk's iOS guide); the app is registered in Clerk's native-application settings by App ID prefix and bundle ID, and that prefix changes if the app moves teams (O2).
5. `docs/auth0-clerk-ledger.md` question 17: add the Apple sign-up result from O4 with that file's exercised-versus-documented convention.
6. `docs/architecture.md` section 17 (drift risks): one line that the Apple relay source must be re-registered with Apple if Clerk's sending address for the production instance ever changes, or Hide My Email users stop receiving codes.

#### Definition of done

- No code tests; this is config and docs. `make frontend-verify` and `make backend-verify` unaffected.
- Real check: O4's browser test, recorded in the ledger: a brand-new Apple ID signs up on the dev instance through Clerk's modal with the legal-consent checkbox, and `clerk api` shows `legal_accepted_at` set on the new user. A second sign-in with the same Apple ID lands in the same account.
- Known limitation: the Hide My Email delivery test is meaningful on the instance whose relay source is registered with Apple; if only production's value is registered (O2), that test happens in O5.

### M6. Policy update, FAQ `platforms` field, content fixes

Depends on, the full list (the order of operations points here): open questions 5 and 9 (the Firebase branches); N, the backup retention in days, from Shane; M2 deployed and verified, because the deletion wording describes its behavior; Shane's prose review before merge. Everything else can be drafted now; the support address is decided (D5).

#### Goal and outcome

The privacy policy and terms describe the product that will exist when the app ships, and the FAQ data lets the app leave out questions that do not apply to it.

- `/privacy` and `/terms` name the iOS app, Firebase Analytics, Sign in with Apple, the support address and the bounded deletion timing, and show a new "Last Updated" date.
- `/data/faq.json` items that are about pricing, Pro or Tiddly's AI features carry `"platforms": ["web"]`; the web FAQ still shows every item.
- The version bump's email notice is ready to send (O9).

#### Implementation outline

**Privacy policy** (`frontend/src/content/prose/privacy.md`; categories, not an exhaustive field list, so ordinary prompt edits do not invalidate it). Edit by section:

- Introduction (line 11): the Service is tiddly.me and the Tiddly iOS app. Operator unchanged.
- Information You Provide: add Sign in with Apple under authentication: name and email, or Apple's private relay address if the user hides their email.
- Automatically Collected Information (lines 26 to 30): add a mobile-analytics item for the iOS app only, collected after the user agrees in the app: Google Firebase Analytics receives a Firebase app instance ID, the device's identifier for vendor, device model and OS version, app version, usage events such as screen views, and approximate location derived from IP address. Branch on open question 5: "These are not tied to your Tiddly account" or "These are tied to your account by a user identifier". Which device identifier is named (identifier for vendor or advertising identifier) depends on open question 9; add Firebase's retention period and how to withdraw consent in the app once that question is answered. Keep Server Logs.
- Third-Party Services: add Google Firebase (Analytics, iOS app) with what it receives and a link to Google's policy; add Apple under authentication alongside Clerk. Clerk's entry (lines 70 to 74) today lists email, login timestamps and the acceptance date; add Clerk's per-session data (IP address, approximate location, browser and device type, recorded for iOS sign-ins too) and the name received from a Google or Apple sign-in (reviewer finding from the installed `@clerk/shared` session types; the implementer confirms against Clerk's session object).
- Your Rights (line 135): "delete your account in Settings on the web or from the iOS app." Timing lives in Data Retention below. Add: if you signed in with Apple, also remove Tiddly from your Apple account (link to https://support.apple.com/en-us/102571).
- Data Retention (lines 149 to 150): trashed items are permanently removed by the next daily run after 30 days in the trash, or sooner if you empty the trash (`cleanup_soft_deleted_items` in `tasks/cleanup.py` uses the same strict older-than-30-days boundary as the tombstone sweep, checked). Account deletion, bounded (corrected after review; Shane reviews the wording): your account is deleted immediately; your data is removed always within 30 days; our sign-in provider's identifier for the deleted account is kept for 30 days to block reuse of the deleted sign-in and removed within the following day; database backups expire within N days (Shane supplies N from Railway's backup settings); if the deletion signal from our sign-in provider fails to reach our servers, we complete the deletion by hand within the same bound. No clause about the daily cleanup run goes in the policy: that run does not touch Redis, so it cannot carry a promise. The internal timings per store are in M2 and the known limitations. The deletion page says the same as the policy and nothing stronger (M4).
- How We Use Your Information (line 49): rewrite "aggregated, not individual", since Firebase collects per-installation events. Scope the new sentence to the iOS app's analytics: they are studied per installation and are not combined with your name or Tiddly account unless open question 5 says otherwise. The backend's own AI-usage records are keyed by account and are covered by the deletion wording, so the sentence must not claim they are unlinked.
- AI Features (line 120): "We never store your key" becomes "never stored on our servers": the browser keeps the key in local storage so you do not re-enter it (`frontend/src/stores/aiStore.ts`, `persist` under the `ai-config` key, checked), and the user can clear it from Settings.
- Changes to This Policy (lines 160 to 168): remove "Posting a notice on the Service".
- Contact Us and Data Controller (lines 174 to 189): the support address replaces the personal address. The GitHub link stays.

**Terms** (`terms.md`): About the Service names the iOS app; Account Termination (line 49) says "from Settings on the web or from the iOS app" instead of "through the Settings page"; Changes to Terms (lines 185 to 193) drops "Posting a notice on the Service"; Contact (line 256) uses the support address. Beta wording stays (D7).

**Version constants**: bump both in `backend/src/core/policy_versions.py` to the deploy date with a dated comment in the file's existing style saying what changed and why. Runbook step 0 (lines 14 to 20) asks whether the change is materially adverse. Decided by Shane on 2026-11-08: opt-in analytics on a new client is an ordinary change, so the notice is the mechanism; Shane still reviews the prose. Then the runbook's steps 3 to 5 are O9.

**Drift guard** (moved here from M1): a test that collects every `mailto:` in `src/content/` (prose and data) and asserts each equals the support-address constant. Confirm it fails by temporarily pointing one link elsewhere.

**FAQ field**: in `content/data/faq.ts`, add `platforms?: Platform[]` to `FaqItem` with `type Platform = 'web' | 'ios'`; in `validateFaq`, accept the field when absent, reject a non-array, an empty array, or an unknown value, and keep it on the returned item. Update the manifest description in `plugins/dataContent.ts` (the `faq.json` entry) to mention the optional field and its meaning. `FAQContent.tsx` unchanged. Tag `"platforms": ["web"]` on: "How long is version history kept?", "How much content can I store?", and every item in the "AI Features" section (they describe Pro and Tiddly's AI suggestions). Items in "API & Integrations" that mention outside AI tools (MCP, Claude) are not tagged. Shane reviews the tagged list with the prose.

**Small content fixes found while reading**, included unless Shane says otherwise:

- `faq.json` line 151 hardcodes "500" and "2,000" AI calls per day, which `AGENTS.md` forbids ("never re-hardcode tier numbers"; the guard only covers `Pricing.tsx`). Replace the numbers with a link to `/pricing`.
- The investigator's contradiction list also notes `privacy.md` promises a machine-readable export while "Data export" sits in the roadmap backlog. Not changed here; recorded for Shane.

#### Definition of done

- Tests: `faq.test.ts` gains cases for a valid `platforms` array passing through, an unknown value rejected, an empty array rejected, and absence allowed; each seen to fail first. The drift guard added here has been seen to fail and passes. `proseDocs.test.tsx` passes (frontmatter unchanged in shape). `dataContent.test.ts` passes.
- Real check: fetch `/data/faq.json` from the dev server and see the field on the tagged items in the raw JSON; open `/privacy` and `/terms` in a browser at phone width and read them end to end; `GET /consent/versions` on the local API returns the new constants.
- Review gate: Shane reads the full prose diff before merge. The agent does not merge legal wording on its own.
- Docs: `docs/architecture.md` section 17 already lists the privacy policy as a drift risk; add "iOS app analytics" to that line. `README.md`'s policy section already points at the runbook.
- Deploy note: the api and frontend services deploy independently minutes apart (consent plan, "How this ships"); the "Last Updated" date and the wording can disagree for those minutes. Accepted.

### M7. Launch surfaces

Depends on: M6 (the FAQ field exists), open question 2 (universal links), and for three pieces the App Store itself: the Smart App Banner needs the App Store ID (available once the app record exists in App Store Connect), and the badge, changelog entry and roadmap move wait for the app to be live. Split this milestone into two PRs if the gated pieces would hold the rest.

#### Goal and outcome

The website tells people and agents that the app exists and how to get it, and the version history shows edits made in the app.

- `/docs/ios` documents the app, is in the docs nav and the command palette, and is served at `/prose/ios-app.md`.
- The FAQ answers "Is there an iOS app?" and "How do I delete my account from the app?".
- The roadmap shows "Mobile app" as shipped with a date; the changelog has an entry; `llms.txt` mentions the app once.
- Safari on iOS shows the Smart App Banner on tiddly.me pages; the landing page shows the App Store badge.
- Version history labels `ios` edits "iOS app" and the filter offers it.
- If open question 2 is yes: `https://tiddly.me/.well-known/apple-app-site-association` returns Jeremy's JSON with `Content-Type: application/json`.

#### Implementation outline

**Docs page** (checked against the Chrome extension page, `DocsExtensionsChrome.tsx`):

1. `frontend/src/content/prose/ios-app.md` with frontmatter `route: /docs/ios`, `title`, `description` (all three required by `content/frontmatter.ts`). Content needs Jeremy's input for the feature list; the skeleton is: what the app does, how to install (App Store link), sign-in methods (email, Google, Apple), the share sheet "Save to Tiddly", what syncs, how to delete your account (the M4 page), where to get help (the support address).
2. `pages/docs/DocsIOS.tsx` rendering `<ProseDocPage slug="ios-app" />`.
3. `App.tsx`: lazy import and a route under the `DocsLayout` children.
4. `routePrefetch.ts`: an entry. This also adds the route to `KNOWN_ROUTE_PATHS`, which `proseDocs.test.tsx` uses.
5. `components/DocsLayout.tsx`: a top-level nav item "iOS App" (P6).
6. `pages/docs/DocsOverview.tsx`: a card.
7. `data/docsRoutes.tsx`: a palette entry with a keyword-dense `searchText` (ios, iphone, ipad, app store, mobile, share sheet, save to tiddly, sign in with apple).

Silent omissions the tests do not catch (investigator's finding, matching behavior of `matchPathPrefix`): a missing `App.tsx` route, nav item, overview card or palette entry, and a typo in the `ProseDocPage` slug. The real check below covers them.

**FAQ**: two items in a new or existing section: "Is there an iOS app?" (link to the docs page and the App Store) and "How do I delete my account from the iOS app?" (the app's Delete Account opens the deletion page). Neither tagged `web`.

**Changelog**: an entry in the release month with tag `ios` (P7: add the tag to `VALID_TAGS` in `changelog.ts`, to the renderer's tag colors in `pages/changelog/Changelog.tsx`, to the error message, to the manifest description in `plugins/dataContent.ts`, and to `changelog.test.ts`).

**Roadmap**: move the "Mobile app" item from In Progress to Shipped with `"date": "YYYY-MM"` (checked: shipped items carry `date`; `roadmap.json` lines 44 to 47 and 63 to 67).

**`llms.txt`**: one line in "Platform and Privacy" naming the iOS app with the App Store link and `https://tiddly.me/docs/ios`. Generic facts live once in this file; the sibling files do not restate it.

**Smart App Banner**: `<meta name="apple-itunes-app" content="app-id=<App Store ID>">` in `frontend/index.html`'s head. Static head, applies site-wide (checked: no head manager in the project). Source: https://developer.apple.com/documentation/webkit/promoting-apps-with-smart-app-banners.

**App Store badge**: on `LandingPage.tsx`, using Apple's official badge artwork per https://developer.apple.com/app-store/marketing/guidelines/, placed where Shane decides (open; the hero is the suggestion). Only when the app is live.

**History labels**: `constants/historyLabels.ts` gains `ios: 'iOS app'`; `pages/settings/SettingsVersionHistory.tsx` gains `ios` in the `DisplaySourceType` union and the dropdown options; `content/prose/versioning.md`'s source table gains a row (P8).

**Universal links** (only if open question 2 is yes): the file committed at `frontend/public/.well-known/apple-app-site-association` with Jeremy's contents (P10; Vite copies it to `dist/.well-known/`, which the investigator built to confirm); and in `frontend/Caddyfile`, inside the catch-all `handle` block, one line: `header /.well-known/apple-app-site-association Content-Type application/json`. Caddy sends no `Content-Type` for an extensionless file and `header` runs before `file_server`, so the explicit value wins (investigator's reading of Caddy's `staticfiles.go` and the `header` directive docs). The file must be served over HTTPS with no redirect and must accept any user agent (https://developer.apple.com/documentation/xcode/supporting-associated-domains, TN3155). Apple's CDN fetches it within about 24 hours, and there is no way to force a refresh. The path patterns must exclude `/app/delete-account`, `/privacy` and `/terms`, so the app's own links to them open in the browser rather than routing back into the app (open question 2). If they include `/shared/*`, the in-app report action from D6 is Jeremy's work.

#### Definition of done

- Tests: `proseDocs.test.tsx`, `docsRoutes.test.ts`, `changelog.test.ts` (with a case for the new tag), `roadmap.test.ts`, `faq.test.ts` all pass. No test pins the history labels; add one small test for `formatSource('ios')`.
- Real check: run the dev server and click through `/docs`, the nav item and the palette entry to `/docs/ios`; fetch `/prose/index.json` and see the entry; open Settings, then Version History, filter by "iOS app" and see rows after creating one with `X-Request-Source: ios` through the API. Build the frontend (`npm run build`) and grep `dist/index.html` for `apple-itunes-app`; if universal links are in, `ls dist/.well-known` shows the file. After deploy, `curl -sI https://tiddly.me/.well-known/apple-app-site-association` shows 200, `Content-Type: application/json` and no redirect.
- Docs: `AGENTS.md` "Files to keep in sync" lists the docs routes and changelog obligations already; nothing to add. `docs/architecture.md`'s CLI and client list in section 2, if it enumerates clients, gains the iOS app (implementer checks).

### M8. Runbooks: the review window and the post-release checklist

Depends on nothing; can land any time before submission.

#### Goal and outcome

The operator has written steps for the App Review window and for the day after approval.

- `README_DEPLOY.md` has an "App Review window" runbook: Device Trust off and on, verified by reading the production config back; the demo accounts; the pre-submission wording check.
- This plan's O10 is the post-release checklist.

#### Implementation outline

Add a subsection to `README_DEPLOY.md` step 6 (after the Apple subsection from M5), "6h. App Review window (runbook)" or the next free letter:

1. Read production: `clerk config pull --instance prod`, look at `auth_password.device_trust.enabled`.
2. If true, right before submission: `clerk config patch --instance prod` scoped to `auth_password.device_trust` with `enabled: false`; re-pull and diff to confirm. Clerk's documentation says Device Trust "has no settings", so if the patch does not take, use the dashboard's Protections page; if neither works, stop and report (Apple's fallback is a phone call that takes three to five business days).
3. After approval: patch it back to true and confirm by re-pull. Record the dates in the ledger.
4. The demo accounts (O6): before every submission or resubmission, sign in to both on the web and recreate any that is missing (a reviewer may delete one to test guideline 5.1.1(v); the same email can sign up again because tombstones are keyed on the Clerk user ID). What the review notes must say: free app, no purchases, US only, every account has Pro at no charge during beta and nothing is sold anywhere, the deletion page URL and which demo account to delete with, and for guideline 1.2: shared content is visible only to people with the link, reports go to the support address, repeat abusers are removed; plus, depending on open question 2, either "the app shows no other user's content" (no universal links for `/shared/*`) or a description of the in-app report action, which must ship before submission if shared pages open inside the app.
5. The wording check: open `/docs/faq`, `/docs/known-issues`, `/privacy` and `/terms` and confirm the pages the app renders match what the iOS team expects (the `platforms` tags for a direct renderer; the full page for a web view).

Link the runbook from `docs/architecture.md` section 17.

#### Definition of done

- Docs only. Real check: a dry read by the operator against the production config in O7 confirms the paths and field names are right.

## Operator steps

Who: the operator (Shane) unless stated. Every production Clerk change and every production database write is a per-change approval, rehearsed on dev first (consent plan, "How this ships"). "Done" is stated for each.

### O1. Apple Developer Program enrollment and team

Precondition: open question 1 answered and Jeremy in agreement.

1. Enroll as an individual at https://developer.apple.com/programs/enroll/ (rules: https://developer.apple.com/support/enrollment/). The App Store will show the individual's legal name as seller.
2. Accept the revised Apple Developer Program License Agreement (October 13, 2026 per the checklist).
3. Add Jeremy as an App Store Connect user with the App Manager role (https://developer.apple.com/support/roles/). App Store Connect is Apple's site for app records, builds and submissions; the role lets him manage the listing, metadata and submission. He cannot create identifiers, certificates or profiles, and cannot upload a build until O2 hands him the signing material.
4. Agree the new bundle ID with Jeremy (open question 1): the app's unique identifier, written like a reversed domain name. The old one stays registered in his team and is never reused.

Done when: the membership is active, Jeremy signs in to App Store Connect and sees the team, and the new bundle ID is agreed.

### O2. Apple identifiers, keys and signing material

Only the Account Holder can do these on an individual account. Terms, once: an App ID is the record in the developer account that ties a bundle ID to the capabilities the app may use; a Services ID is the same kind of record for a website that uses Sign in with Apple; the distribution certificate is the file Xcode needs to sign a release build; a provisioning profile ties one App ID to that certificate so a signed build can be uploaded; an App Group is a shared-storage identifier that lets the app and its share extension (the "Save to Tiddly" sheet) exchange data; a development certificate and development profiles are the same things for builds that run on registered test phones; an App Store Connect API key is a credential for uploading builds and calling Apple's API without a person's login.

0. From Jeremy: the bundle IDs for the app and the share extension, the App Group identifier, the capabilities each needs, the device identifiers of his test phones (for step 6), and the Google and Firebase identifiers that depend on the bundle ID (the list at the end of this step).
1. Register the App ID for the app with the new bundle ID and the capabilities Jeremy lists (Sign in with Apple; App Groups; Associated Domains if open question 2 is yes; anything else the app needs). Register the App ID for the share extension and the App Group, and add the App Group to both App IDs.
2. Create a Services ID for the web, with Sign in with Apple configured: primary App ID = the App ID above; domain = the Clerk Frontend API domain (`clerk.<domain>`, `README_DEPLOY.md` 6b); return URL = the exact value the Clerk dashboard shows for the Apple connection. No verification file is needed (https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/).
3. Create a Sign in with Apple key. Download the `.p8` once, store it in the operator's password manager with its Key ID. Apple does not offer it again.
4. Email Communication: under Sign in with Apple, register the "Email Source for Apple Private Email Relay" value the Clerk dashboard shows for each instance (https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/). Without it Apple bounces Clerk's codes to Hide My Email users. Register at least production's value. Also register the domain `tiddly.me` as an email source, so mail from `support@tiddly.me` (policy notices and takedown correspondence, O9 and M1) passes Apple's relay: Apple requires an SPF record for a registered domain, which the mailbox setup in O3 provides, and bounces unregistered senders to Hide My Email users (checked on the same page).
5. Clerk native-application settings (both instances): check the dashboard first. Clerk's docs describe one registration per iOS app and do not say whether a second App ID prefix and bundle ID pair can be added (https://clerk.com/docs/ios/guides/configure/auth-strategies/sign-in-with-apple: "add your iOS application. You will need your iOS app's App ID Prefix and Bundle ID"). If the setting holds a list, add the new app beside the old one now and remove the old one in O10. If it holds one app, or that is unclear: switch the dev instance now (O4 needs it, and the testers do not use dev); the production switch happens on the release-candidate day, when the testers install the release candidate the same day and Jeremy's production native Apple sign-in check for the new bundle ID runs then (order of operations step 2). The old app's native sign-in stops at that switch, which is why the move is same-day. Production is a per-change approval.
6. Create the App Store distribution certificate and the App Store provisioning profiles for the app and the share extension. Also create a development certificate for Jeremy, development provisioning profiles for the app and the share extension, and register Jeremy's test phones (their device identifiers) in the account. Each new test phone and each profile renewal goes through Shane, because only the Account Holder can edit these on an individual account; open question 13 asks whether TestFlight builds with a dev configuration can replace development builds for the checks.
7. Hand Jeremy the certificates with their private keys and the profiles by a secure channel (a password-manager share or an encrypted archive, never chat or email). Prerequisite for the upload key: the Account Holder requests App Store Connect API access and Apple approves it, which Apple considers case by case (reviewer's citation: https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/). If access is not approved, skip the key and go straight to the fallback in step 8 (Shane uploads). Otherwise create an App Store Connect team API key with the App Manager role (Account Holder only) and hand over its key file, Key ID and Issuer ID the same way, for uploads with Transporter. Apple documents Transporter uploads with API-key tokens and lists Account Holder, Admin, App Manager and Developer as roles that can upload builds (https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds; the researcher's fetch returned a summary of that page, not verbatim text). Whether Apple allows a team API key to upload on an individual account was not found in Apple's documentation; step 8 is the test.
7b. Create the App Store Connect app record: name, the new bundle ID, SKU and primary language. If a record named "tiddly" exists in Jeremy's team, he removes it first after confirming in App Store Connect Help that removal frees the name (open question 1); if the name cannot be reused, Shane decides the store name.
8. The first archive proves the hand-off and the key: Jeremy uploads a build under the new bundle ID to TestFlight with the API key, with Shane's team as the developer. If he cannot, Shane uploads from his own Mac with Xcode, which needs the source (open question 8, asked before O2 for this reason).

What the new bundle ID changes, each marked verified or the reviewer's understanding:

- Clerk native-application settings on both instances (App ID prefix plus bundle ID): verified, step 5 above; Clerk publishes the value in its own association file (researcher's live check).
- The Apple connection's `bundle_id` in `clerk/config.dev.json` and in production: verified, the field exists in the `connection_oauth_apple` block (lines 119 to 128).
- The Google iOS OAuth client used by native Google sign-in: the reviewer's understanding (Google iOS clients are bound to a bundle ID); not checked.
- The Firebase app registration and its configuration file: the reviewer's understanding (the registration is per bundle ID); not checked.
- The share extension's bundle ID and the App Group identifier, which derive from the app's: the reviewer's understanding; not checked, the iOS repository is private.
- Testers: the new bundle ID is a separate app, so they sync before installing the release candidate or lose unsynced local edits in the old app (order of operations).

Done when: the `.p8` key is in the operator's password manager with its Key ID (the Services ID, Team ID and Key ID also end up in the committed dev config after O4, P9), the relay sources show as registered in Apple's developer account, Clerk's native-application settings carry the new bundle ID on the dev instance (and on production too only in the multi-app branch; in the single-slot branch production switches on the release-candidate day), and a build uploaded under the new bundle ID appears in App Store Connect.

### O3. The support mailbox at Porkbun

Decided after the second review (2026-11-08): `support@tiddly.me` sends user mail (policy notices, takedown correspondence), so it needs a mailbox that can send, not a forward. Evidence: Porkbun's product page lists Email Forwarding as "Receive Only" and its paid Porkbun Email as "Send & Receive Email" with webmail, POP3 and IMAP, "as low as $3.00 / month" (https://porkbun.com/products/email); Gmail's "Send as" for a third-party address shows recipients "on behalf of" and Google says the feature ends for third-party addresses in January 2027 (https://support.google.com/mail/answer/22370), so it is not a working option for the release window; the backend has no outbound email provider (a search of `backend/src` and `pyproject.toml` for resend, postmark, sendgrid, ses and smtp finds nothing, checked). Chosen, the cheapest working option found: a Porkbun Email mailbox. The page does not name SMTP; webmail sending is on the page, and sending from a desktop mail client is the operator's check at setup. Alternative at a higher price: Google Workspace. Shane may overrule. Porkbun specifics are from its product page; the operator verifies menu names and DNS values when doing it.

1. Before changing anything, inspect the apex's current records with `dig MX tiddly.me` and `dig TXT tiddly.me`, so an undocumented receiver is not displaced; the repository documents only Railway records (`docs/custom-domain-setup.md`), which is not proof of the live state. Then, in the Porkbun dashboard, open the domain, then Email Hosting, and create the mailbox `support@tiddly.me`. Porkbun's setup adds the MX records and an SPF TXT record; DKIM is a separate action in the Porkbun dashboard (reviewer's citation: https://kb.porkbun.com/article/179-how-to-turn-on-dkim-dmarc), so turn it on too, and record all the values. The apex can hold only one set of MX records, so this replaces whatever the inspection found. Clerk's sending records live on the `clkmail` subdomain and Clerk's DKIM CNAMEs are separate names (`README_DEPLOY.md` 6b), so they are unaffected.
2. Deliver to the operator: a forwarding rule from the mailbox to the operator's inbox if Porkbun offers one, otherwise IMAP in the operator's mail client. Replies and notices are sent from the mailbox (webmail or the client), never from the personal address.
3. Test: send to `support@tiddly.me` from another account and see it arrive; send from it to a Gmail address and check the received headers show SPF and DKIM passing, with no "on behalf of".

Done when: both test messages pass, and the SPF and DKIM records are in place for O2 step 4 (registering the domain with Apple's relay).

### O4. Clerk dev instance: enable Apple

Precondition: O2.

1. Enable the Apple social connection on the dev instance with custom credentials (the Services ID, Team ID, Key ID and `.p8`), through the dashboard or `clerk config patch --instance dev` scoped to `connection_oauth_apple`. The secret goes where the CLI cannot carry it.
2. In a browser, with legal consent on (it is, `clerk/config.dev.json` lines 112 to 116): sign up with a brand-new Apple ID through Clerk's modal on the local frontend. Watch for the 8338 failure (a sign-in that becomes a sign-up stalls on legal acceptance). If it reproduces, record the exact symptom and stop; the resolution is Shane's decision.
3. Read the new user with `clerk api` and confirm `legal_accepted_at` is set. Sign in again and land in the same account.
4. If the dev relay source was registered in O2, repeat with Hide My Email and confirm the code arrives.
5. Native sign-up under legal consent, with Jeremy: from a dev build (signed with the development certificate and profiles from O2 step 6 on a registered phone, or a TestFlight build with the dev configuration if open question 13 is yes), sign up a brand-new user with each method (email, Google, Apple, Apple with Hide My Email). Shane reads `legal_accepted_at` for each with `clerk api`. Today this is "documented, not exercised" (`docs/auth0-clerk-ledger.md`, question 17); record the result there in place of that wording (open question 11).
6. Confirm in the Clerk dashboard that reverification is enabled on the dev instance (M4 depends on it).
7. Run M3's deep-link check with Apple sign-in.
8. Re-pull the config for M5 and commit it as pulled (P9).

Done when: every sign-up above succeeded and the results are recorded in the ledger (M5).

### O5. Clerk production: enable Apple

Precondition: O4 passed, M5 merged.

1. Capture `clerk config pull --instance prod` before.
2. `clerk config patch --instance prod` scoped to `connection_oauth_apple` with the production values; the secret via the dashboard if needed. Never `clerk config put` or `clerk deploy`.
3. Capture the pull after and diff: only the Apple block changed.
4. In a browser on tiddly.me: sign up with a fresh Apple ID using Hide My Email and receive Clerk's code (the checklist's done-when for item 3). Reaching the deletion page and deleting that account is O8 part B, after M4 deploys; keep the account until then.
5. Once, with a TestFlight build: a brand-new native sign-up with each method, `legal_accepted_at` read back, as in O4 step 5. Record it in the ledger.
6. Confirm in the dashboard that reverification is enabled on production.

Done when: the diff shows only the Apple block, the Hide My Email sign-up worked, and the native sign-ups are recorded in the ledger.

### O6. Demo accounts for App Review

1. Sign up two accounts on tiddly.me with email and password, each on a mailbox the operator controls (plus-addressed aliases of the operator's inbox work, since Clerk's codes must arrive). Do not use Clerk's `+clerk_test` test mode on production; Clerk discourages it there. The operator accepts the terms through Clerk's checkbox.
2. Add sample content that is not real people's data: a few bookmarks to public pages, a note, a prompt template, a tag or two, one shared item.
3. Tier: leave them on Pro. Every account is Pro at no charge during beta (the default in `models/user.py`), nothing is sold anywhere today, and the review notes say so (D4). No database write.
4. Give the credentials to Jeremy for the review notes.

Done when: both accounts sign in on the web and in a TestFlight build, and the content shown is the sample data.

### O7. Device Trust for the review window

Per the M8 runbook. Read production first; if Device Trust is on, turn it off right before Jeremy submits, confirm by re-pull, and turn it back on after approval, confirmed the same way.

Done when: the re-pull after each change shows the intended value; after the setting is turned off, both demo accounts sign in from a fresh browser session and a clean native install without the operator opening their inboxes (a config read proves the setting, not that a reviewer on a new device gets in); and both dates are recorded in the ledger.

### O8. Test deletion end to end in production

**Part A, joint device check with Jeremy, on dev.** Precondition: M3 and M4 merged and running on a dev frontend; O4 done. Environment: the local Vite frontend exposed through an HTTPS tunnel (cloudflared, as `docs/ios-clerk-migration-guide.md` describes for the API), paired with the Clerk dev instance, and a local backend exposed through a second tunnel that carries both the app's API calls and Clerk's webhook; the dev build (or the dev-configured TestFlight build, open question 13, which needs the API tunnel on a stable hostname) points at that API URL. Two settings first: Vite rejects requests from hosts it does not allow and `vite.config.ts` sets no `server.allowedHosts` (checked), so add the frontend tunnel's host there; and the API reads `CORS_ORIGINS` once at startup (`AGENTS.md`), so add the frontend tunnel's origin before starting it. Jeremy has the dev deletion URL (the frontend tunnel's origin plus `/app/delete-account`; the production URL was sent in the Now phase, so the button is already wired). Steps: sign up natively with Apple and Hide My Email; open the deletion URL from the app the way it will ship (open question 10); sign in on the web to the same identity and confirm the page shows that identity; delete; return to the app. Record what the app does in both cases: with a token it still holds (a session token is valid for about 60 seconds), the API returns the terminal `account_deleted` 401 (`core/auth.py`, `get_or_create_user`, checked); with an expired or absent token, the API returns a generic 401 before any tombstone check (expired signatures are rejected at `core/auth.py` line 160, checked) and the app sees its Clerk session end. Confirm local data is wiped either way, exercise the manual "Clear this phone and sign out" action, and test returning to the app after token expiry (wait more than a minute before returning). Repeat with Google. If universal links are on, confirm the deletion URL still opens in the browser. After part B, repeat the joint path once with the production TestFlight configuration.

**Part B, production.** Precondition: M2, M3, M4 deployed; O5 done for the Apple path.

1. Create a throwaway account (email and password; a second one with Google; for the Apple path, use the Hide My Email account kept from O5 step 4, which makes this O5's deletion check too). Note its Clerk user ID and its `users.id`. Add a bookmark, a note, a personal access token and a shared item.
2. On a phone browser, open `https://tiddly.me/app/delete-account` signed out, sign in, and confirm the page lands there (M3) and shows the account. Delete.
3. Confirm: the browser shows `/account-deleted` with no sign-in dialog; the Clerk dashboard no longer lists the user and its webhook log shows a 200 for `user.deleted`; in the production database (reads only): no `users` row for the Clerk ID, a `deleted_identities` row, and no `ai_usage` rows for the old `users.id` (a bucket written after the deletion is removed by the next daily cleanup run; if one appears, check again the next day). The shared item's URL returns 404.
4. Sign up again with the same email and succeed; delete that account too.

Done when: part A passed on dev, every check in part B step 3 passed, the joint path was repeated once on the production TestFlight configuration, and Jeremy confirms the production URL he already has is the one the app opens.

### O9. Email notice for the policy update

Precondition, all four: M6 deployed and verified live (runbook step 3 in `policy_versions.py`: `/privacy` and `/terms` show the new date and wording, `/prose/*.md` serve it, `GET /consent/versions` returns the new constants); O3 done, so the mailbox sends; O2 step 4 done, so the domain is registered with Apple's relay; O5 done, so a Hide My Email test account can be created on production. The tracks run in parallel and M6 can finish first; wait for the other three.

1. Export user email addresses from Clerk (`clerk api` or the dashboard), not from `users.email`.
2. Send the notice by hand as a service message, from the address registered with Apple's relay in O2 step 4: what changed (the iOS app, Firebase Analytics in the app, Sign in with Apple, the support address, the deletion timing), when it takes effect, and a link to `https://tiddly.me/privacy`. Both documents' change sections promise this email.
3. Before recording the notice as sent, confirm delivery to one Hide My Email address the operator controls: a throwaway Apple account with Hide My Email created for this check and deleted afterwards. Apple bounces mail from unregistered senders.

Done when: the notice is sent, delivery to a relay address is confirmed, and the date is recorded in the version constant's comment or the ledger.

### O10. Post-release checklist

After the app is live:

1. Device Trust back on (O7).
2. The gated M7 pieces: App Store badge, changelog entry, roadmap move.
2b. If the old app was added beside the new one in Clerk's native-application settings (O2 step 5), remove the old one on both instances once the testers are on the new build (production: per-change approval).
3. iOS repository public (D9), run from Shane's side as an owner (open question 8, asked in the Now phase): ownership settled (IP assignment or license grant from Jeremy), license chosen (Elastic License 2.0), full-history secret scan, environment identifiers removed (Clerk instance and application IDs; the Apple Team ID stays, P9), Firebase configuration file reviewed.
4. 1.1 candidates recorded: Apple token revocation (D3), in-app acceptance of new terms if a material change ever needs one (the consent plan's limitation).

## Order of operations

Replaces the checklist's order. The policy no longer waits for TestFlight.

1. **Now.** Send the open questions to Jeremy, including the request to add Shane as an owner or admin of the iOS repository before O2 (open question 8), and give him the production deletion URL (`https://tiddly.me/app/delete-account`, P1) so the button is wired before O8 part A. O3 (the support mailbox) starts. M1, M2, M3 and M8 start; they have no dependencies. M6's prose is drafted now and held for the dependency list in M6's header.
2. **After open question 1 and repository access (open question 8).** O1 (enrollment, Jeremy's role, the new bundle ID), then O2 (identifiers, keys, development and distribution signing, the app record, the API key and the first upload), then O4 (Apple on dev; its native sign-up step waits on Jeremy's first dev build), then M5 (config and docs), then O5 (Apple on production; its deletion check runs in O8 part B after M4 deploys). O5 is due before the TestFlight release candidate, so Jeremy can test Sign in with Apple against production. The Clerk native-application registration for the new bundle ID follows O2 step 5's branch: in the multi-app branch it is added on both instances in O2 and the old one removed in O10; in the single-slot branch the dev instance switches in O2 and the production switch, the testers' install of the release candidate, and Jeremy's production native Apple sign-in check for the new bundle ID all happen on the release-candidate day, because the old app's native sign-in stops at the switch. Testers sync before installing the release candidate: the new bundle ID is a separate app, so unsynced local edits in the old one do not carry over.
3. **Deletion.** M4 after M3 and M2. O8 part A with Jeremy on dev (needs O4 and a dev build). Deploy. O8 part B, which includes O5's Hide My Email deletion. Jeremy removes the 451 handling. Open question 12 is answered before the release candidate; if the answer is yes, the native fix is a release gate.
4. **Policy.** M6 when its header's dependency list is met (open questions 5 and 9, N from Shane, M2 deployed and verified, Shane's prose review). Deploy and verify live. O9 (the email notice). Tell Jeremy the policy URL is current, for the App Store Connect field and the privacy labels.
5. **Launch surfaces.** M7's ungated pieces (docs page, FAQ, history labels, `llms.txt`, universal links if open question 2 is yes) before submission, so Apple's CDN has the association file and the support URL has the contact. The Smart App Banner once Jeremy has the App Store ID from the app record.
6. **Submission.** O6 (demo accounts). The wording check from the M8 runbook. O7 (Device Trust off). Jeremy submits with the review notes and releases manually after approval.
7. **After approval.** O7 (Device Trust on). O10.

Parallel tracks: our steps 1 to 5 and the iOS team's build and TestFlight work run side by side. The hard hand-offs are the signing material and the first upload (O2), O5 plus the native-application settings before the release candidate (step 2), the deletion URL (step 3), the policy going live (step 4), and the demo accounts and Device Trust (step 6).

## Known limitations, recorded deliberately

- Apple tokens are not revoked on deletion (D3). The user is pointed at Apple's manual steps.
- A failed `user.deleted` delivery leaves data in place until the operator replays it (`README_DEPLOY.md` 6f). The policy's deletion sentence says so in plain words.
- Internal removal timings after a deletion differ by store: the webhook cascade on delivery; an orphan `ai_usage` row written in the flush race window at the next successful daily run; Redis usage buckets by the hourly flush or their seven-day expiry; the deleted-account identifier at least 30 days and the next daily run after. The policy promises only "immediately" for the account and "within 30 days" for the data (E2, M2).
- No content filtering for shared pages (D6). A repeat abuser is removed by deleting the account, Shane's product call; the ban-and-keep-data path exists only as the dispute alternative in the runbook, with its 24-hour re-sweep.
- The report link is an email with no rate limit (M1).
- Clerk's `UserProfile` deletion remains a second path whose post-deletion screen is observed, not designed (P12).
- The deletion page cannot signal the iOS app (open question 7).
- The age rating, the privacy labels and the review notes are the iOS team's deliverables; this plan only supplies the facts they rest on.
