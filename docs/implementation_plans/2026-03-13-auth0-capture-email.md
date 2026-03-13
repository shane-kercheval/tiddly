# Auth0 Email Capture via Namespaced Custom Claims (KAN-25)

## Context

Auth0 access tokens for custom APIs only include `sub` by default — no profile claims like `email`. The backend currently reads `payload.get("email")` from the access token (`core/auth.py` line 439), which returns `None`. The fix is to add email as a namespaced custom claim via an Auth0 Post-Login Action, then read it in the backend.

**Auth0 docs to read before implementing:**
- Custom claims: https://auth0.com/docs/secure/tokens/json-web-tokens/json-web-token-claims
- Post-Login Actions: https://auth0.com/docs/customize/actions/flows-and-triggers/login-flow
- Actions API object: https://auth0.com/docs/customize/actions/flows-and-triggers/login-flow/api-object
- OIDC scopes (why email isn't in access tokens): https://auth0.com/docs/get-started/apis/scopes/openid-connect-scopes

---

## Milestone 1: Backend Code Changes

### Goal & Outcome

- Backend correctly reads `email` and `email_verified` from namespaced custom claims in Auth0 access tokens
- `email_verified` is stored in the database and cache alongside `email`
- The `/users/me` endpoint returns `email_verified`
- Dev mode continues to work unchanged

### Implementation Outline

1. **Add `AUTH0_CUSTOM_CLAIM_NAMESPACE` to `Settings`** (`core/config.py`)
   - New env var: `AUTH0_CUSTOM_CLAIM_NAMESPACE` with default `""` (empty in dev mode since auth is bypassed)
   - This is the URL prefix, e.g. `https://tiddly.me`
   - The backend will read `{namespace}/email` and `{namespace}/email_verified` from the JWT payload
   - **Startup validation** (add to `model_validator`): if `dev_mode is False`, require `auth0_custom_claim_namespace` to be non-empty. A missing namespace in production silently reproduces the exact bug we're fixing — the fallback to `payload.get("email")` returns `None` because Auth0 doesn't put email in custom API access tokens. Fail fast at startup, not silently at request time.
   - **Trailing slash normalization**: strip trailing `/` from the namespace value (e.g. `https://tiddly.me/` → `https://tiddly.me`). Otherwise `f"{namespace}/email"` produces `https://tiddly.me//email` which silently misses the claim.

2. **Add `email_verified` column to `users` table**
   - **Never create migration files manually.** Use: `make migration message="add email_verified to users"`
   - This runs `uv run alembic revision --autogenerate -m "..."` which generates the migration from model changes
   - So: update the `User` model first, then run the make command to auto-generate the migration
   - The migration should add `email_verified` column (`Boolean`, nullable, default `NULL`)
   - Nullable because existing users won't have this data until their next login after the Auth0 Action is deployed
   - After all users log in once, `null` means "we haven't received this claim from Auth0 yet"
   - `true` = Auth0 confirmed the email is verified; `false` = Auth0 says it's not verified
   - Update `User` model in `models/user.py`: `email_verified: Mapped[bool | None]`

3. **Update `CachedUser`** (`schemas/cached_user.py`)
   - Add `email_verified: bool | None` field
   - Bump `CACHE_SCHEMA_VERSION` to `4` in `auth_cache.py`

4. **Update `_authenticate_user()`** (`core/auth.py`, around line 428-440)
   - Current:
     ```python
     email = payload.get("email")
     ```
   - New:
     ```python
     namespace = settings.auth0_custom_claim_namespace
     email = payload.get(f"{namespace}/email") if namespace else payload.get("email")
     email_verified = payload.get(f"{namespace}/email_verified") if namespace else None
     ```
   - The empty-namespace fallback to `payload.get("email")` exists only for dev mode and tests (where auth is bypassed and namespace is empty). The startup validator from step 1 guarantees this fallback path cannot be reached in production.
   - Pass `email_verified` through to `get_or_create_user()`

5. **Update `get_or_create_user()`** (`core/auth.py`)
   - Add `email_verified: bool | None = None` parameter
   - Update the user's `email_verified` field alongside email updates (lines 200-202)
   - Same "don't overwrite with None" pattern as email: only update if the new value is not None

6. **Update `create_user_with_defaults()`** (`services/user_service.py`)
   - Add `email_verified` parameter, pass to `User()` constructor

7. **Update `UserResponse`** (`api/routers/users.py`)
   - Add `email_verified: bool | None` to the response model

8. **Update `AuthCache.set()`** (`core/auth_cache.py`)
   - Include `email_verified` in the cached data

### Testing Strategy

**`test_auth.py` — `get_or_create_user` tests:**
- Creates user with `email_verified=True` → stored correctly
- Creates user with `email_verified=None` → stored as None
- Updates `email_verified` from `None` to `True` on subsequent login
- Updates `email_verified` from `False` to `True` on subsequent login
- `email_verified` NOT overwritten with `None` when claim is missing from token
- Email + `email_verified` updated together when email changes

**`test_auth.py` — `_authenticate_user` / JWT claim extraction:**
- Namespaced claims: token with `https://tiddly.me/email` → correctly extracted
- Namespaced claims: token with `https://tiddly.me/email_verified` → correctly extracted
- Fallback: empty namespace → reads `email` directly (dev/test compatibility)
- Missing namespace claim → email is None, `email_verified` is None

**Settings validation tests (`test_config.py` or similar):**
- `dev_mode=False` + empty `auth0_custom_claim_namespace` → raises `ValueError` at startup
- `dev_mode=True` + empty `auth0_custom_claim_namespace` → allowed (auth bypassed)
- Trailing slash stripped: `https://tiddly.me/` → `https://tiddly.me`

**`test_auth_cache.py`:**
- `CachedUser` round-trips with `email_verified` field
- Cache version bump ensures old entries are ignored (cache miss on v3 keys)

**API tests — `/users/me`:**
- Returns `email_verified` field on cache miss (first request, hits DB)
- Returns correct `email_verified` field on cache hit (second request, served from cache after schema v4 bump)

**Migration:**
- Existing users get `email_verified=NULL` after migration (no data loss, no blocking)

---

## Milestone 2: Auth0 Configuration & Deployment

### Goal & Outcome

- Auth0 Post-Login Action is deployed, adding namespaced email claims to access tokens
- `AUTH0_CUSTOM_CLAIM_NAMESPACE` env var is set in Railway
- Production users get `email` and `email_verified` populated on next login
- No existing users are blocked or disrupted

### Implementation Outline

1. **Create Auth0 Post-Login Action** (Auth0 Dashboard > Actions > Flows > Login)
   ```javascript
   exports.onExecutePostLogin = async (event, api) => {
     const namespace = 'https://tiddly.me';
     if (event.authorization) {
       api.accessToken.setCustomClaim(
         `${namespace}/email`,
         event.user.email ?? null
       );
       api.accessToken.setCustomClaim(
         `${namespace}/email_verified`,
         event.user.email_verified ?? false
       );
     }
   };
   ```
   - Add this Action to the Login flow in the Auth0 Dashboard (drag it into the flow)
   - The namespace URL does NOT need to resolve to anything — it's just a unique prefix
   - Test in the dev Auth0 tenant first before deploying to production

2. **Set Railway env var**
   - `AUTH0_CUSTOM_CLAIM_NAMESPACE=https://tiddly.me`

3. **Deploy backend** (the code from Milestone 1)

4. **Run Alembic migration** in production

### Testing Strategy (manual)

- **Dev tenant first:**
  - Create the Action in the dev Auth0 tenant
  - Log in via email/password → decode the access token at jwt.io → confirm `https://tiddly.me/email` and `https://tiddly.me/email_verified` claims are present
  - Log in via Google → confirm claims are present with `email_verified: true`
  - Check `/users/me` returns email + `email_verified`

- **Production after deploy:**
  - Log in → check `/users/me` returns email + `email_verified`
  - Check Auth0 Dashboard > Users > pick a user > raw JSON to confirm the Action ran
  - Verify existing beta users get email populated on next login
  - Verify no users are blocked (this change is purely additive)

---

## What This Plan Does NOT Include

- **Email verification enforcement** — not blocking users with unverified emails. That belongs in the larger identity redesign (`user_identities` table).
- **Account linking** — same person logging in with different providers still creates separate accounts. That's a separate initiative.
- **Removing `auth0_id` from `users` table** — the identity table migration is out of scope here.

This plan only fixes the email capture bug (KAN-25) and starts storing `email_verified` so we have the data when the identity redesign happens.

## User-Facing Impact

**None.** This plan has zero UX changes. No new screens, no verification emails sent, no verification stamps in the UI. Users will not notice anything changed.

The only difference is backend data plumbing: the backend will now correctly read and store `email` and `email_verified` from Auth0 access tokens, where before it was silently getting `None` because Auth0 doesn't include profile claims in custom API access tokens by default.

Auth0 sends verification emails for email/password signups by default — verify this is enabled in the Auth0 Dashboard under Authentication > Database > Username-Password-Authentication. This plan just starts *recording* whether Auth0 considers the email verified, so we have that data available for the future identity redesign.
