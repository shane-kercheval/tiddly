# CLI login moves to the OAuth device authorization grant

Date: 2026-10-02. Status: planned, not started.

`tiddly login` signs the user in with Clerk's OAuth 2.0 Device Authorization Grant (RFC 8628): the CLI prints a short code and a URL, opens the browser to Clerk's hosted approval page with the code prefilled, and polls Clerk's token endpoint until the user clicks Approve. This replaces the authorization-code-with-PKCE flow that listens on a loopback port for a browser redirect. The device grant is the only interactive login. `tiddly login --token bm_...` (Personal Access Token) is unchanged and remains the path for CI and scripts.

## Why

The loopback flow needs the browser and the CLI on the same machine. Over SSH into a remote box, `tiddly login` opens nothing the user can see and waits out a five-minute timeout, so remote users have had to mint a PAT in the web app instead. The migration ledger (`docs/auth0-clerk-ledger.md`, "CLI auth: device authorization flow") records this as the headline capability lost when Tiddly moved from Auth0 to Clerk in July 2026, with the note "If Clerk ever ships device flow, this entry should be updated." Clerk shipped it on 2026-09-08.

With the device grant the browser can be on any device, so SSH and container logins work interactively. On a desktop the cost is one Approve click per login (the loopback flow was hands-free after a one-time consent). `tiddly login` runs about once per machine because Clerk refresh tokens never expire, so that cost is a click per machine.

## Decided

- **Device grant is the only interactive flow.** The loopback flow, its listener, its `state` correlation, and its tests are deleted. Keeping both flows was considered and rejected: it needs a flag plus an environment heuristic to pick a flow, and the obvious heuristic (the browser-open command failing) does not fire over SSH into a workstation, where `open` or `xdg-open` exists and starts successfully.
- **The CLI always prints the URL and the code before opening the browser.** The device grant has no local listener, so the user visually matching the terminal's code against the browser page is the defense against approving someone else's login. Suppressing the printout for tidiness removes that defense.
- **No SSH detection to skip the browser-open attempt.** `DefaultBrowserOpener.Open` starts the command with no stdin or stdout, and Go connects unset child streams to the null device, so a text browser that `xdg-open` falls back to gets no terminal and exits. The attempt is harmless over SSH and the printed URL covers that case.
- **No backend change.** The device grant issues the same Clerk OAuth access tokens (`typ: at+jwt`, `client_id` claim, 24 h lifetime) and rotating refresh tokens as the authorization-code flow, from the same "Tiddly CLI" OAuth application and client ID. Milestone 1 proves this on the dev instance instead of trusting Clerk's changelog.
- **Keyring storage, the token resolution chain, and refresh handling stay as they are.** The stored credential accounts do not change, so a user who upgrades the CLI keeps their existing login.
- **Scopes stay `openid profile email offline_access`.** `offline_access` is what makes Clerk issue a refresh token.
- **Every Clerk configuration change is an operator step: show the exact command, wait for approval, then run it.** Production changes are approved one at a time. The implementing agent never changes a Clerk setting on its own, including when a probe fails because of one.
- **Out of scope:** Client ID Metadata Documents for the MCP servers, and cleanup of the dynamically registered OAuth applications in Clerk. Both are separate decisions.

## Open decisions

None. Everything above is settled.

## Required reading

Read these before starting. The Clerk pages are the contract the CLI implements.

- Clerk, Device Authorization Grant: https://clerk.com/docs/guides/configure/auth-strategies/oauth/device-authorization-grant (request and response shapes, the four polling error codes, the hosted verification page, the per-app toggle)
- Clerk changelog, 2026-09-08: https://clerk.com/changelog/2026-09-08-device-authorization-grant (discovery metadata, parity with the authorization-code flow)
- Clerk, how Clerk implements OAuth: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth (token lifetimes, refresh tokens never expire, JWT access-token setting)
- RFC 8628: https://www.rfc-editor.org/rfc/rfc8628 (sections 3.2 to 3.5: the device authorization response, the polling rules, `slow_down`)
- Repo: `cli/internal/auth/pkce_flow.go` (the flow being replaced; the token-endpoint client, error mapping, and `User-Agent` requirement it carries survive), `cli/internal/auth/token_manager.go`, `cli/cmd/login.go`, `cli/cmd/root.go`, `cli/README.md` ("Clerk OAuth Setup"), `docs/auth0-clerk-ledger.md` (the device-flow entry), `docs/implementation_plans/2026-07-02-clerk-migration.md` (AD9 and the M4 section, for the Clerk-side gotchas the last rewrite hit), `clerk/README.md`.
- Git history: `git show 716774a^:cli/internal/auth/device_flow.go` is the Auth0-era device flow this CLI shipped until July 2026. Its request, print, open, poll structure and its error mapping are the model, retargeted to Clerk's endpoints.

## Current state, verified 2026-10-01 and 2026-10-02

- Production Clerk (`https://clerk.tiddly.me/.well-known/oauth-authorization-server`) advertises `device_authorization_endpoint` and the `urn:ietf:params:oauth:grant-type:device_code` grant type. Clerk advertises these only when the feature is available on the instance and the verification page is reachable, so no support request is needed.
- The hosted verification page exists at `https://accounts.tiddly.me/device` (it redirects to sign-in and back). It lives in Clerk's Account Portal, which must stay enabled.
- The "Tiddly CLI" OAuth application on both instances has `device_authorization_grant_enabled: false`, `pkce_required: true`, `public: true`, scopes `email offline_access openid profile`, redirect URI `http://127.0.0.1/callback`.
- The dev instance's authorization-server metadata was not checked. Milestone 1 checks it.
- Whether Clerk rejects device requests from an application with `pkce_required: true` is undocumented. Clerk's docs say the device grant "does not use redirect URIs or PKCE". Milestone 1 settles it.

## Conventions shared by every milestone

- **Endpoints**, relative to the OAuth issuer (`OAuthConfig.Issuer`, `https://clerk.tiddly.me` in production, overridable with `TIDDLY_OAUTH_ISSUER`): `POST /oauth/device_authorization` and `POST /oauth/token`. Both are form-encoded and both must carry the CLI's `User-Agent` (`tiddly-cli/<version>`), because Clerk's endpoints answer default HTTP-library user agents with a bare 403.
- **Device authorization request:** `client_id` and `scope`. Public client, no secret.
- **Token poll:** `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `device_code`, `client_id`.
- **Polling rules (RFC 8628 §3.5, Clerk's docs):** wait `interval` seconds between polls (default 5 if absent or zero: Go cannot tell an absent field from a zero, and a zero interval would be a tight loop); on `authorization_pending` keep polling; on `slow_down` add 5 seconds to the interval and keep polling; on `access_denied` stop with "access denied"; on `expired_token` or `invalid_grant` stop and tell the user to run `tiddly login` again; on any other error stop and show the error. Stop at `expires_in` seconds (default 600 if absent or zero) even if the server never says `expired_token`. A `device_code` can be exchanged once.
- **Time unit is injectable for tests.** The flow has a `PollUnit time.Duration` field, `time.Second` by default and set in the constructor, that `Login` multiplies `interval`, the 5-unit `slow_down` increment, and `expires_in` by. Tests set it to `time.Millisecond` so the RFC-mandated numbers stay in the code while the suite runs in milliseconds. Production never sets it. This is the same shape as the `LoginTimeout` override the current flow has.
- **Clerk configuration commands** use the Clerk CLI: `clerk api /oauth_applications/<id> --instance <dev|prod> -X PATCH -d '{"device_authorization_grant_enabled": true}'`. Application IDs and the dev client ID live in the operator's private note and local env, never in the repo. The pattern established in the migration plan: show the command, get approval, run, then read the setting back to confirm.

## Milestone 1: prove the device grant on the dev Clerk instance

### Goal and outcome

Confirm, on the dev instance and before any CLI code changes, that the "Tiddly CLI" OAuth application can issue tokens through the device grant and that the backend accepts them unchanged.

- The dev instance advertises the device endpoint, or the reason it does not is recorded.
- The dev "Tiddly CLI" application has the device grant enabled.
- One scripted probe gets a device code, is approved in a browser, and receives an access token and a refresh token.
- The access token is a JWT with `typ: at+jwt`, a `client_id` claim equal to the dev CLI client ID, and a `sub`. The local API (running against the dev Clerk instance, the established local real-auth setup) answers `GET /users/me` with 200 for it.
- The refresh token works at `/oauth/token` with `grant_type=refresh_token` and returns a rotated pair.
- The `pkce_required` question is answered and recorded.

### Implementation outline

This is an operator milestone with a probe script. No CLI code changes.

1. Fetch `<dev issuer>/.well-known/oauth-authorization-server` and confirm `device_authorization_endpoint` is present. If it is absent, stop and report: Clerk advertises it only when the feature is available and the verification page is reachable, which usually means the Account Portal is disabled on dev.
2. Operator step, show and approve: enable `device_authorization_grant_enabled` on the dev "Tiddly CLI" application. Read it back.
3. Write the probe as a rerunnable shell script (not committed, keep its output in the as-executed notes): request a device code with the CLI's `User-Agent`, print `user_code` and `verification_uri_complete`, poll `/oauth/token` every `interval` seconds while the operator approves in a browser, then decode the access token's header and payload.
4. If step 3's device authorization request fails with an error that names PKCE, that is the undocumented interaction. Operator step, show and approve: patch `pkce_required` to `false` on the dev application, re-run the probe, and record that production needs the same patch (it becomes a listed item in Milestone 4, never an on-the-spot fix). Under device-only login `pkce_required` governs nothing the CLI uses.
5. Call the local API's `GET /users/me` with the access token. Then exchange the refresh token once and confirm a new pair comes back.

### Definition of done

- The as-executed section of this plan records: the dev metadata check, the exact PATCH commands run and their read-back, the probe's device authorization response (codes redacted), the decoded token header and payload (`sub` redacted), the API response status, the refresh result, and the `pkce_required` answer.
- A copy of the probe script's command lines is in the as-executed section so a reviewer can rerun it.
- If anything above fails, the milestone is not done and the failure is recorded instead of worked around.

## Milestone 2: replace the CLI login flow

### Goal and outcome

`tiddly login` signs in with the device grant against Clerk. Everything else about the CLI's credentials is unchanged.

- Running `tiddly login` prints a URL and a short code, opens the browser to the code-prefilled approval page, waits, and on approval stores the access and refresh tokens in the same keyring accounts as today, then prints "Logged in as <email>".
- The same command works from a machine with no browser: the user opens the printed URL on any device, enters or confirms the code, approves, and the terminal completes.
- If the browser cannot be opened the CLI says so and keeps waiting. The printed URL and code are always shown first.
- Denying in the browser, letting the code expire, pressing Ctrl+C, and Clerk error responses each end the command with a specific message. The expiry and `invalid_grant` messages say to run `tiddly login` again; `--token` is mentioned only in the command's help as the CI path, not as a fallback for a failed interactive login.
- A login attempt against an OAuth application that does not have the device grant enabled fails at the first request with a message that names that setting, because this is the exact misconfiguration a new instance or an out-of-order production rollout produces.
- Token refresh, `tiddly auth status`, `tiddly logout`, and `tiddly login --token` behave as before. A user who upgrades keeps their existing stored login.

### Implementation outline

1. **Rename the flow so the name stops lying.** `pkce_flow.go` becomes `device_flow.go` and `PKCEFlow` becomes `DeviceFlow` (constructor, the `TokenManager.Flow` field type, the construction in `cli/cmd/root.go`, the copy in `cli/cmd/login.go`, and the test helpers follow). The token-endpoint client stays on the type: `OAuthConfig`, `DefaultOAuthConfig`, `postForm`, `errInvalidGrant`, `defaultUserAgent`, `RefreshAccessToken`, and `TokenResponse` are unchanged in behavior. Refresh is the one path the rest of the CLI calls, and it must not be duplicated.
2. **Replace `Login`.** Delete the PKCE pair, `state`, the loopback listener, `callbackHandler`, `LoginTimeout` (replaced by `PollUnit`), and `newPKCEPair`. The new `Login(ctx)`:
   - POSTs the device authorization request through `postForm` and parses the response into a struct with `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in`, `interval`. Apply the defaults from the shared conventions. A non-200 here maps to an error whose text says the OAuth application may not have the device authorization grant enabled and includes Clerk's error body.
   - Prints, in this order: the verification URI, the user code, then attempts `Browser.Open(verification_uri_complete)` (falling back to `verification_uri` if the complete form is empty) and prints "(Could not open browser automatically)" on failure, then "Waiting for authorization...".
   - Polls per the shared conventions, bounded by `ctx` and by `expires_in`, with every duration scaled by `PollUnit`. `postForm` already turns `invalid_grant` into the `errInvalidGrant` sentinel and other OAuth errors into `auth error: <code>` errors; the poll loop needs to see the raw error code to distinguish `authorization_pending` and `slow_down` from terminal errors, so either extend `postForm` to expose the code or give the poll its own request helper that shares the header logic. Do not copy the `User-Agent` handling into a second place.
   - Keeps the two loud checks on success: empty `access_token` fails at login; empty `refresh_token` fails at login with the "is the OAuth app missing the offline_access scope?" wording.
3. **Rewrite the package comment** as a description of the current design, not of what it replaced: the device grant was chosen because the browser can be on any device, which is what makes SSH and container logins work; the grant uses no redirect URI and no PKCE, so the Clerk application's redirect URI and `pkce_required` setting are not exercised by the CLI; the terminal prints the code before opening the browser because the user's visual match is the defense against approving a code they did not request; the `User-Agent` is required, not cosmetic. This rationale must survive in the code.
4. **`cli/cmd/login.go`:** update the `Long` help text (no more "requires a browser on this machine"; say the URL can be opened on any device; `--token` is for CI and scripts). `loginWithOAuth` keeps its shape; only the type name changes.
5. **`cli/cmd/root.go`:** constructor rename. The `User-Agent` with the CLI version stays.
6. **`cli/README.md`, "Clerk OAuth Setup":** rewrite to the current requirements: public application, `device_authorization_grant_enabled` ON (defaults OFF on creation, the same default-off class as the flags the July rewrite hit), instance `oauth_jwt_access_tokens` ON, `offline_access` requested. Say `pkce_required` and the redirect URI are not used by the device grant. Update the "Files to Update" pointer to the renamed file.

### Definition of done

- `make cli-verify` passes.
- Tests in `device_flow_test.go` against an `httptest` server, each named for the behavior: happy path (`authorization_pending` twice, then tokens; asserts the device request carried `client_id` and the scope string, the poll carried the device grant type and `device_code`, and both carried the test `User-Agent`); `slow_down` lengthens the interval (the `httptest` handler records a timestamp per poll; with `PollUnit` set to `time.Millisecond`, assert the gap after the `slow_down` response is at least 5 units longer than the gap before it); `access_denied` stops with "access denied"; `expired_token` stops with the run-again message; `invalid_grant` stops with the run-again message; a non-OAuth error body is surfaced; local `expires_in` bound stops polling when the server keeps saying pending (fake `expires_in` of 50, millisecond unit, assert the poll count is bounded and the error names expiry); `interval: 0` in the fake response polls every 5 units, not continuously; Ctrl+C cancels within one interval (millisecond unit, so the test finishes in well under a second); browser-open failure is non-fatal and the printed output still contains the URL and the code; browser-open success still prints the URL and the code before "Waiting"; a non-200 on the device authorization request names the grant setting; empty `access_token` and empty `refresh_token` fail loudly. Refresh tests from `pkce_flow_test.go` move over unchanged in behavior. Each new test must have been seen failing against a deliberately wrong expectation at least once before it counts.
- `token_manager_test.go` and `login_test.go` compile and pass with the renamed type and no behavior changes.
- Manual proof on the dev instance with `make cli-snapshot` or `make cli-build` and the `TIDDLY_OAUTH_ISSUER` and `TIDDLY_OAUTH_CLIENT_ID` overrides: (a) desktop login end to end, then `tiddly auth status` shows method `oauth` and the account email, then `tiddly status` makes a real API call; (b) browserless login: run the Linux build inside a container with no browser (`docker run` with the binary mounted and the two env overrides), open the printed URL on the host's browser, approve, and confirm `tiddly auth status` inside the container; (c) deny in the browser and confirm the message; (d) either wait out a real code expiry (10 minutes) and confirm the message, or rely on the fake-server expiry test and say so. Save the terminal transcripts, with codes and tokens redacted, in the as-executed section.
- Known limitation, recorded in the package comment: on Windows the browser opener uses `rundll32`, unchanged from today, and the printed URL is the fallback.

## Milestone 3: documentation, ledger, and plan records

### Goal and outcome

Every place that describes how `tiddly login` works, or records the device-flow gap, describes the current state.

- A user reading the CLI docs or an agent reading `llms-cli-instructions.txt` learns that `tiddly login` prints a URL and code, works over SSH, and that `--token` is for CI and scripts.
- The command palette finds the CLI reference page for "ssh", "remote", "device code".
- The migration ledger's device-flow entry says the gap closed and when.

### Implementation outline

Small milestone; the list is the work. Rewrite each as a description of the current state, except the two historical records, which get a dated addendum.

- `frontend/src/content/prose/cli-reference.md`, "OAuth Login (default)": currently describes the Auth0-era flow. Rewrite: prints a URL and a one-time code, opens the browser to the page with the code prefilled, you approve, the CLI stores both tokens and shows your email. Add one sentence: on a machine without a browser (SSH, containers) open the URL on any device. Keep the PAT section and point it at CI and scripts.
- `frontend/public/llms-cli-instructions.txt`: the `tiddly login` bullet (device code, URL plus code, works from remote machines), the credential-storage note (unchanged content, check it still reads correctly), and the "CI / headless" workflow line (PAT is for CI and scripts; interactive remote login no longer needs a PAT).
- `frontend/src/content/prose/connect-ai-apps.md` (the paragraph that routes "headless or remote machines" to the CLI) and `frontend/public/llms-integration.txt` (the matching routing sentence): these describe why an AI tool's own OAuth connector needs a browser, which is still true. Adjust only if a sentence claims the CLI itself cannot sign in over SSH.
- `frontend/src/data/docsRoutes.tsx`, the `/docs/cli/reference` entry: add `ssh remote machine user code approve` to `searchText`.
- `frontend/src/content/data/changelog.json`: add an entry for the CLI release that ships this (users can now sign in from SSH sessions and containers). Date it to the release in Milestone 4.
- `docs/architecture.md`: the diagram edge label "PKCE loopback flow" and the CLI section's auth bullet. Add a line to "Things that are easy to miss": the device grant needs the per-application toggle on, and the verification page lives in the Account Portal, so disabling the portal breaks CLI login.
- `AGENTS.md`, the CLI bullet under Architecture: update the auth description.
- `cli/README.md`: done in Milestone 2.
- `clerk/README.md`: add a per-application table for the "Tiddly CLI" OAuth application next to the instance-settings table: `device_authorization_grant_enabled` true on dev and prod; `pkce_required` as decided in Milestone 1; `redirect_uris` still `http://127.0.0.1/callback`, unused by the device grant, kept only so binaries older than this release can still log in, scheduled for removal under the Milestone 4 follow-up. Each row carries its why.
- `docs/auth0-clerk-ledger.md`, "CLI auth: device authorization flow": add a dated addendum (Clerk shipped the grant 2026-09-08; Tiddly's CLI adopted it in this plan; the gap is closed; the `pkce_required` answer from Milestone 1). Update the two summary-table rows that say "Lost narrowly" and "honest loss on ... device flow".
- `docs/implementation_plans/2026-07-02-clerk-migration.md`: a dated note under AD9 and under the "Costs, accepted knowingly" paragraph pointing here. Do not rewrite the July text.
- Run `grep -rn -i "pkce\|loopback\|device flow\|device code\|headless\|ssh" --include='*.md' --include='*.txt' --include='*.tsx' --include='*.json' .` (excluding `node_modules` and this plan) and reconcile anything the list above missed.

### Definition of done

- `make frontend-verify` passes (the JSON data files are schema-validated at load, and the changelog has a test).
- `tiddly ai-instructions` run against a local build of the frontend's static files, or the raw file, prints the updated login text.
- A reviewer can diff the served `/prose/cli-reference.md` against the CLI's `login --help` and find no contradiction.

## Milestone 4: production rollout and CLI release

### Goal and outcome

The released CLI binary signs in with the device grant against production, and the production Clerk application is configured before any user can download that binary.

- The production "Tiddly CLI" application has the device grant enabled (and `pkce_required` patched only if Milestone 1 showed Clerk requires it).
- A snapshot build of the new CLI logs in against production end to end before the release is tagged.
- The release is published and `tiddly update` on an older install picks it up.
- Users on the previous binary are not broken at any point in the sequence.

### Implementation outline

Order is load-bearing: the production toggle comes first, because a new binary against an application without the grant fails at the first request. Enabling the grant does not affect the old binary, whose authorization-code flow keeps working.

1. Operator step, show and approve: enable `device_authorization_grant_enabled` on the production "Tiddly CLI" application. Read it back. If Milestone 1 established that `pkce_required` must be off, that is a second, separately approved PATCH.
2. Build a snapshot (`make cli-snapshot`) and run `tiddly login` with no env overrides, so it targets production. Complete the login, run `tiddly auth status` and `tiddly status`, then `tiddly logout`.
3. Merge the branch to `main` (the user merges; the agent does not open or merge pull requests). The docs from Milestone 3 deploy to tiddly.me on merge, so tag the release right after the merge to keep the window where the site describes an unreleased binary to minutes.
4. Tag `cli/v<next minor>` per `cli/README.md` "Releases" and push the tag (the user does this or approves it). Confirm the GitHub release appears with binaries.
5. On a machine with the previous version installed, run `tiddly update` and then `tiddly login` against production.
6. **Follow-up, after old binaries are retired.** The authorization-code flow stays enabled on the "Tiddly CLI" application after this release: Clerk still accepts `/oauth/authorize` for the CLI's public client ID with the loopback redirect, which no binary from this release onward uses. It stays until every CLI user has updated, because updates are manual (`tiddly update` nudges, it does not force). Condition for running the follow-up: confirm with the known CLI users (at beta scale, a short list) that each has updated. Then, as two separately approved production changes: remove the `http://127.0.0.1/callback` redirect URI (if Clerk requires at least one redirect URI on an application, or offers a per-application switch for the authorization-code grant, read Clerk's OAuth application API docs at that point and pick the option that disables the surface), and restore `pkce_required` to `true` if Milestone 1 turned it off. Record the result in the `clerk/README.md` per-application table.

### Definition of done

- The as-executed section records the production PATCH commands and read-backs, the snapshot login transcript (redacted), the release tag, and the `tiddly update` result.
- The changelog entry from Milestone 3 carries the actual release date.
- Known limitation, recorded in the ledger addendum: the hosted verification page is part of Clerk's Account Portal, so the portal cannot be disabled without breaking CLI login.
- The retired-binaries follow-up (step 6) is recorded in the `clerk/README.md` per-application table with its condition, so the dormant authorization-code surface has a written reason and an exit.

## As executed

Empty until the milestones run. Each milestone appends its evidence here, dated.
