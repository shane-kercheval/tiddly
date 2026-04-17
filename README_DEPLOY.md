# Deployment Guide

Deploy Tiddly services to Railway using Docker.

## Architecture

| Service | Description | Build |
|---------|-------------|-------|
| **api** | FastAPI backend | `Dockerfile.api` |
| **content-mcp** | Content MCP server (bookmarks/notes) | Railpack |
| **prompt-mcp** | Prompt MCP server (prompts capability) | Railpack |
| **frontend** | React SPA | Railpack |
| **ai-usage-flush** | Hourly cron that flushes Redis AI cost buckets into `ai_usage` | `Dockerfile.api` |
| **cleanup** | Daily cron: tier-based history retention + soft-delete expiry + orphan-history sweep | `Dockerfile.api` |
| **orphan-relationships** | Daily cron: detects (and optionally deletes) rows in `content_relationships` whose source/target entity no longer exists | `Dockerfile.api` |
| **Postgres** | PostgreSQL database | (managed by Railway) |
| **Redis** | Rate limiting and auth cache | (managed by Railway) |

---

## Prerequisites

1. [Railway account](https://railway.app)
2. [Railway CLI](https://docs.railway.com/guides/cli) installed:
   ```bash
   npm install -g @railway/cli
   railway login
   ```
3. Auth0 account configured (see main README)

---

## Initial Setup

### Step 1: Create Railway Project

```bash
railway init
```

Or via dashboard: Click **+ New Project** → **Empty Project**

### Step 2: Add PostgreSQL

In the Railway dashboard:
1. Press `Cmd+K` (Mac) or `Ctrl+K` (Windows)
2. Type "Postgres" and select **Add PostgreSQL**

Railway automatically creates these variables on the Postgres service:
- `DATABASE_URL`
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

### Step 2b: Add Redis

In the Railway dashboard:
1. Click `Create`
2. Type "Redis" and select **Add Redis**

Railway automatically creates these variables on the Redis service:
- `REDIS_URL`
- `REDISHOST`, `REDISPORT`, `REDISUSER`, `REDISPASSWORD`

Redis is used for:
- **Rate limiting**: Tiered limits by auth type (PAT vs Auth0) and operation type
- **Auth caching**: 5-minute TTL cache for user lookups to reduce database load
- **Fail-open mode**: If Redis is unavailable, requests are allowed (degraded mode)

### Step 3: Create Services

Create 7 services, each connected to your GitHub repo:

1. Click **+ Create** → **GitHub Repo** → Select `tiddly`
2. Repeat 6 more times (you'll have 7 services all pointing to the same repo)

All seven are created the same way — Railway does NOT have a distinct "Cron Job" service type. The last three services (`ai-usage-flush`, `cleanup`, `orphan-relationships`) become crons by setting a **Cron Schedule** on each in Step 4; everything else is a regular long-running service.

### Step 4: Configure Each Service

Click on each service → **Settings** tab → Configure as follows:

#### API Service

**Settings → Source:**
- Rename service to `api` (click the name at top)
- Enable **Wait for CI** (deploys only after GitHub Actions pass)

**Settings → Build:**
- Builder: **Dockerfile**
- Dockerfile Path: `/Dockerfile.api`
- Watch Paths: `backend/**`, `pyproject.toml`, `Dockerfile.api`

**Settings → Deploy:**
- No Custom Start Command needed (the Dockerfile handles this)
- Pre-Deploy Command: `uv run alembic upgrade head` (runs database migrations automatically before each deployment)

**Settings → Networking:**
- Click **Generate Domain** (public, for external access)
- Click **+ Private Domain** → set to `api.railway.internal` (for internal service-to-service communication)

#### Content MCP Service

**Settings → Source:**
- Rename service to `content-mcp`
- Enable **Wait for CI**

**Settings → Build:**
- Build Command: `uv sync --no-dev`
- Watch Paths: `backend/**`, `pyproject.toml`

**Settings → Deploy:**
- Start Command: `cd backend/src && uv run python -m mcp_server`

**Settings → Networking:**
- Click **Generate Domain**

#### Prompt MCP Service

**Settings → Source:**
- Rename service to `prompt-mcp`
- Enable **Wait for CI**

**Settings → Build:**
- Build Command: `uv sync --no-dev`
- Watch Paths: `backend/**`, `pyproject.toml`

**Settings → Deploy:**
- Start Command: `cd backend/src && uv run python -m prompt_mcp_server`

**Settings → Networking:**
- Click **Generate Domain**

#### Frontend Service

**Settings → Source:**
- Rename service to `frontend`
- Root Directory: `/frontend`
- Enable **Wait for CI**

**Settings → Networking:**
- Click **Generate Domain**

#### AI Usage Flush Service (Cron)

Hourly job that flushes Redis AI-cost buckets into the `ai_usage` Postgres table. Runs as a regular Railway service with a cron schedule attached — Railway does not have a separate "Cron Job" service type. Runs independently of the API so its failure mode is isolated.

**Settings → Source:**
- Rename service to `ai-usage-flush`
- Enable **Wait for CI**

**Settings → Build:**
- Builder: **Dockerfile**
- Dockerfile Path: `/Dockerfile.api`
- Watch Paths: `backend/**`, `pyproject.toml`, `Dockerfile.api`

**Settings → Deploy:**
- **Cron Schedule:** `30 * * * *` (every hour at :30, UTC). Railway's minimum interval is 5 minutes.
- **Custom Start Command:** `uv run python -m tasks.ai_usage_flush`
  - For Dockerfile deploys this overrides the image's `CMD` in **exec form** (no shell). The command has no shell constructs and `PYTHONPATH=/app/backend/src` is already baked into `Dockerfile.api`, so no shell wrapping or `cd` is needed.
- **Pre-Deploy Command:** leave empty (migrations are owned by the api service).

**Settings → Networking:**
- No public domain — the cron writes to Postgres/Redis over Railway's private network only.

**Cron behavior on Railway (worth knowing before first run — applies to all three cron services):**
- Schedules are UTC.
- Execution time can drift by a few minutes — Railway does not guarantee minute precision.
- If a prior run is still in flight when the next tick fires, Railway **skips** the new execution.
- The cron process must exit when the task completes. All three scripts (`ai_usage_flush.py`, `cleanup.py`, `orphan_relationships.py`) use `asyncio.run(...)` and exit cleanly.
- There is no "Run Now" button. Manually redeploying (Deployments tab → three-dots menu → Redeploy) rebuilds the image but does NOT trigger an extra cron execution. To force a run for testing, temporarily change the schedule to a near-future expression (e.g. `*/5 * * * *`), observe a run, then revert.
- The `ai_usage_flush` upsert uses SET (not INCREMENT), and `cleanup` / `orphan-relationships` are idempotent by construction — so re-runs of any service are safe.

#### Cleanup Service (Cron)

Daily job that enforces tier-based history retention (`content_history`), permanently deletes soft-deleted items older than 30 days, and sweeps orphan `content_history` rows whose entity was hard-deleted. DB-only — does not need Redis.

**Settings → Source:**
- Rename service to `cleanup`
- Enable **Wait for CI**

**Settings → Build:**
- Builder: **Dockerfile**
- Dockerfile Path: `/Dockerfile.api`
- Watch Paths: `backend/**`, `pyproject.toml`, `Dockerfile.api`

**Settings → Deploy:**
- **Cron Schedule:** `0 3 * * *` (daily at 03:00 UTC)
- **Custom Start Command:** `uv run python -m tasks.cleanup`
- **Pre-Deploy Command:** leave empty.

**Settings → Networking:**
- No public domain.

#### Orphan Relationships Service (Cron)

Daily job that finds rows in `content_relationships` whose source or target entity no longer exists, and (when `--delete` is passed) deletes them. Independent of the `cleanup` service — separate failure mode. DB-only.

**Settings → Source:**
- Rename service to `orphan-relationships`
- Enable **Wait for CI**

**Settings → Build:**
- Builder: **Dockerfile**
- Dockerfile Path: `/Dockerfile.api`
- Watch Paths: `backend/**`, `pyproject.toml`, `Dockerfile.api`

**Settings → Deploy:**
- **Cron Schedule:** `0 4 * * *` (daily at 04:00 UTC — offset by an hour from `cleanup` so they don't pile on the DB simultaneously)
- **Custom Start Command:** start in **report-only mode first**, then switch to delete mode once verified.
  - **Initial (report-only):** `uv run python -m tasks.orphan_relationships`
  - **After verifying zero-or-small orphan counts:** `uv run python -m tasks.orphan_relationships --delete`
- **Pre-Deploy Command:** leave empty.

**Settings → Networking:**
- No public domain.

**Why report-only first:** `content_relationships` is write-light and orphans should be near-zero on a healthy system. Running in report mode for one cycle confirms the detector isn't finding false positives (e.g. a live entity it can't see due to a model misalignment) before you authorize deletes.

### Step 5: Configure Environment Variables

Click on each service → **Variables** tab.

#### API Service Variables

Click **New Variable** or use **RAW Editor** to add:

```
DATABASE_URL=postgresql+asyncpg://<manually-set-see-below>
REDIS_URL=${{Redis.REDIS_URL}}
CORS_ORIGINS=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}
VITE_AUTH0_DOMAIN=<your-auth0-domain>
VITE_AUTH0_CLIENT_ID=<your-auth0-client-id>
VITE_AUTH0_AUDIENCE=<your-auth0-api-identifier>
VITE_API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
VITE_FRONTEND_URL=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}
AUTH0_CUSTOM_CLAIM_NAMESPACE=https://tiddly.me
API_WORKERS=4
```

**Note:** `VITE_API_URL` and `VITE_FRONTEND_URL` are used by the backend to generate helpful error messages (e.g., consent enforcement instructions).

**Important: DATABASE_URL must be set manually.** Railway's Postgres provides `postgresql://` but this app requires `postgresql+asyncpg://` for async SQLAlchemy. Do NOT use `${{Postgres.DATABASE_URL}}`.

**Note:** `REDIS_URL` can use the Railway variable reference `${{Redis.REDIS_URL}}`. Redis fails open, so the app works even if Redis is temporarily unavailable.

To set DATABASE_URL:
1. Click the **Postgres** service → **Variables** tab
2. Copy the `DATABASE_URL` value (e.g., `postgresql://user:pass@host:5432/railway`)
3. Go back to the **api** service → **Variables** tab
4. Add `DATABASE_URL` and paste the copied value
5. Change `postgresql://` to `postgresql+asyncpg://` at the start of the URL

**Optional tuning variables** (defaults are fine for most cases, see [docs/connection-pool-tuning.md](docs/connection-pool-tuning.md)):

| Variable | Default | Description |
|----------|---------|-------------|
| `API_WORKERS` | `1` | Uvicorn worker processes (set to `4` for Railway's 8 vCPU) |
| `DB_POOL_SIZE` | `10` | Persistent DB connections per worker |
| `DB_MAX_OVERFLOW` | `10` | Temporary DB connections per worker |
| `DB_POOL_RECYCLE` | `3600` | Recycle connections older than N seconds |
| `REDIS_POOL_SIZE` | `5` | Redis connections per worker |

**AI / LLM variables:**

Only `OPENAI_API_KEY` is required for the initial deploy. The only AI use case wired up today (suggestions) defaults to `openai/gpt-5.4-nano`, and platform users are locked to the use-case default in code — no other platform key is reachable on the platform path. BYOK users supply their own keys via the `X-LLM-Api-Key` header and do not depend on these vars.

```
OPENAI_API_KEY=<your OpenAI key>
```

Add the following **when additional AI use cases ship** (TRANSFORM / AUTO_COMPLETE default to Gemini; CHAT defaults to OpenAI):

```
GEMINI_API_KEY=<your Google AI Studio key>
ANTHROPIC_API_KEY=<your Anthropic key>
```

Optional per-use-case model overrides (change only if you want to deviate from defaults — and add the matching provider key if the override points to a different provider):

```
LLM_MODEL_SUGGESTIONS=openai/gpt-5.4-nano
LLM_MODEL_TRANSFORM=gemini/gemini-flash-lite-latest
LLM_MODEL_AUTO_COMPLETE=gemini/gemini-flash-lite-latest
LLM_MODEL_CHAT=openai/gpt-5.4-mini
```

**Database migrations:** `ai_usage` and `ai_usage_analytics` (Postgres view used by the analytics role, see Step 8) are applied automatically by the pre-deploy `alembic upgrade head` command configured on this service — no manual migration step is needed.

#### AI Usage Flush Service Variables

```
DATABASE_URL=postgresql+asyncpg://<same value as api service>
REDIS_URL=${{Redis.REDIS_URL}}
AUTH0_CUSTOM_CLAIM_NAMESPACE=<same value as api service, e.g. https://tiddly.me>
```

Follow the same `postgresql+asyncpg://` rule as the API service (manually copy the Postgres URL and replace the `postgresql://` prefix — do NOT use `${{Postgres.DATABASE_URL}}` directly).

**Why `AUTH0_CUSTOM_CLAIM_NAMESPACE` is required even for a cron:** the cron imports `db.session`, which instantiates `Settings()` at module load. The Settings validator (`core/config.py`) hard-requires this variable in non-dev mode as a safety check against silent Auth0 misconfiguration on the API. Cron tasks don't touch auth, but they share the same Settings class. Without this var, the container crashes at import.

#### Cleanup Service Variables

DB-only; no Redis needed.

```
DATABASE_URL=postgresql+asyncpg://<same value as api service>
AUTH0_CUSTOM_CLAIM_NAMESPACE=<same value as api service>
```

Same `postgresql+asyncpg://` rule as above. `AUTH0_CUSTOM_CLAIM_NAMESPACE` is required for the same reason as above — Settings validation.

#### Orphan Relationships Service Variables

DB-only; no Redis needed.

```
DATABASE_URL=postgresql+asyncpg://<same value as api service>
AUTH0_CUSTOM_CLAIM_NAMESPACE=<same value as api service>
```

Same `postgresql+asyncpg://` rule as above. `AUTH0_CUSTOM_CLAIM_NAMESPACE` is required for the same reason as above — Settings validation.

#### Content MCP Service Variables

```
VITE_API_URL=http://api.railway.internal:8080
```

**Note:** Railway automatically provides the `PORT` variable - do not set it manually.

#### Prompt MCP Service Variables

```
VITE_API_URL=http://api.railway.internal:8080
```

**Note:** Railway automatically provides the `PORT` variable - do not set it manually.

**Why `http` and not `https`?** The MCP servers communicate with the API over Railway's private network, which never leaves Railway's infrastructure. TLS is unnecessary for internal traffic and skipping it reduces latency. The frontend must still use the public `https` URL since it runs in the user's browser.

#### Frontend Service Variables

```
VITE_API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
VITE_MCP_URL=https://${{content-mcp.RAILWAY_PUBLIC_DOMAIN}}
VITE_PROMPT_MCP_URL=https://${{prompt-mcp.RAILWAY_PUBLIC_DOMAIN}}
VITE_AUTH0_DOMAIN=<your-auth0-domain>
VITE_AUTH0_CLIENT_ID=<your-auth0-client-id>
VITE_AUTH0_AUDIENCE=<your-auth0-api-identifier>
```

**Note:** Railway may warn about egress fees for `VITE_API_URL` and `VITE_MCP_URL` referencing public endpoints. You can ignore this - the frontend is a static SPA, so all API calls happen from the user's browser, not between Railway services.

### Step 6: Configure Auth0

After generating your frontend domain (Step 4), configure Auth0 for authentication and refresh tokens.

#### 6a. Create Auth0 Tenant

1. Go to [Auth0 Dashboard](https://manage.auth0.com/)
2. Click your tenant name (top-left) → **+ Create tenant**
3. Tenant name: e.g., `tiddly` (cannot be changed later)
4. Region: Pick closest to your users
5. Environment Tag: select **Production**

**Important:** Production environment tag ensures proper rate limits for your tenant.

#### 6b. Create & Configure SPA Application

1. Go to **Applications** → **Applications** → **+ Create Application**
2. Name: e.g., "Tiddly"
3. Select: **Single Page Application**
4. Click **Create**

**In the Settings tab**:

5. Note the **Domain** and **Client ID** for Railway environment variables:
   - `VITE_AUTH0_DOMAIN` = Domain (e.g., `tiddly.us.auth0.com`)
   - `VITE_AUTH0_CLIENT_ID` = Client ID

6. Add your frontend URLs (use placeholder for now, update after Railway generates domain):

   **Allowed Callback URLs:**
   ```
   https://frontend-production-XXXX.up.railway.app, https://tiddly.me
   ```

   **Allowed Logout URLs:**
   ```
   https://frontend-production-XXXX.up.railway.app, https://tiddly.me
   ```

   **Allowed Web Origins:**
   ```
   https://frontend-production-XXXX.up.railway.app, https://tiddly.me
   ```

7. Scroll down to **Refresh Token Rotation**:
   - Toggle ON **Allow Refresh Token Rotation** (invalidates old tokens after use to prevent replay attacks)
   - Leave **Rotation Overlap Period** at `0` seconds (default)

8. Scroll to **Advanced Settings** → **Grant Types** tab:
   - Check the box for **Implicit** (optional, but typically enabled for SPAs)
   - Check the box for **Authorization Code**
   - Check the box for **Refresh Token**

9. Click **Save Changes**

#### 6c. Create & Configure API

1. Go to **Applications** → **APIs** → **+ Create API**
2. Name: e.g., "Tiddly API"
3. Identifier: e.g., `https://api.tiddly.me` (this becomes the "audience" - doesn't need to be a real URL)
4. Click **Create**

Go to the **Settings** tab of your new API:

5. Note the **Identifier** for Railway environment variables:
   - `VITE_AUTH0_AUDIENCE` = Identifier

6. In the **Settings** tab, under **Access Settings**:
   - Toggle ON **Allow Offline Access** (required for refresh tokens to be issued)

7. Click **Save**

**Why Allow Offline Access matters:** The frontend requests the `offline_access` scope to get refresh tokens. Without this enabled, Auth0 silently ignores the scope and users get logged out when their access token expires (~24 hours).

#### 6d. Post-Login Action (Email Claims)

Auth0 access tokens for custom APIs don't include profile claims like `email` by default. A Post-Login Action adds them as namespaced custom claims so the backend can read them.

1. Go to **Actions** → **Triggers** → **post-login**
2. Click **+** (Add Action) → **Create Custom Action**
    - Name: "Add email claims to access token"
    - Trigger: Login / Post Login (default)
    - Runtime: Node 22 (default)
3. Click **Create**
4. Replace the `onExecutePostLogin` function with:

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

5. Click **Deploy**
6. Click **Back to Triggers** → **post-login**
7. **Drag** the new action from the right panel into the flow (between **Start** and **Complete**)
8. Click **Apply**

**To verify:** Log in, grab the access token from browser dev tools (Network tab → any API request → `Authorization: Bearer <token>` header), paste it into [jwt.io](https://jwt.io), and confirm the payload contains `https://tiddly.me/email` and `https://tiddly.me/email_verified`.

**Note:** The namespace URL (`https://tiddly.me`) doesn't need to resolve — it's just a unique prefix required by Auth0 for custom claims. The backend reads these claims using the `AUTH0_CUSTOM_CLAIM_NAMESPACE` env var.

#### 6e. Google Social Connection (Optional)

To enable "Sign in with Google":

**Step 1: Create Google OAuth Credentials**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create one)
3. Navigate to **Branding** (configure consent screen first):
   - App name, support email, developer contact (required fields)
   - **Authorized domains**: Add `auth0.com`
4. Navigate to **Audience**:
   - User Type: **External** (unless you have Google Workspace)
   - If in testing mode, add your email as a test user
5. Navigate to **Clients**
6. Click **+ Create client**:
   - Application type: **Web application**
   - Name: e.g., "Tiddly"
   - **Authorized JavaScript origins**: Leave empty (not required for Auth0)
   - **Authorized redirect URIs**: Add your Auth0 callback URL:
     ```
     https://YOUR-AUTH0-TENANT.us.auth0.com/login/callback
     ```

7. Click **Create** and copy the **Client ID** and **Client Secret**

**Note:** Changes to Google OAuth credentials may take 5 minutes to a few hours to propagate.

**Step 2: Configure Auth0**

1. Go to [Auth0 Dashboard](https://manage.auth0.com/) → **Authentication** → **Social**
2. Click **+ Create Connection** → **Google / Gmail**
3. Paste your **Client ID** and **Client Secret** from Google
4. Click **Create**
5. Go to the **Applications** tab and enable the connection for your SPA application

### Step 7: Deploy

Push your changes to `main` branch. With **Wait for CI** enabled, Railway will:
1. Wait for GitHub Actions tests to pass
2. Then automatically deploy all services

**Note:** If you click **Deploy** in the dashboard before pushing, you'll see "Deployment waiting" until CI passes. Push to `main` to trigger the GitHub Actions workflow.

### Step 8: Post-Deploy AI Configuration

One-time setup required the first time you enable AI features. Only the OpenAI cap (8a) is a hard requirement for the initial deploy.

#### 8a. Provider spend caps (required)

Configure a monthly spend cap on every provider whose platform key is set on the API service. Provider-enforced caps suspend service when reached, so this is the primary safeguard against runaway cost — there is no application-level circuit breaker.

- **OpenAI** (required today — platform default for suggestions): [OpenAI billing dashboard → limits](https://platform.openai.com/account/limits). Set a monthly budget before enabling Pro-tier AI access.
- **Google AI Studio** (add when Gemini-backed use cases ship): set a project-level monthly spend cap (e.g. $50/month) in the Google AI Studio console.
- **Anthropic** (add when Anthropic-backed use cases ship): set a monthly spend limit in the Anthropic console.

Do not skip this — an unbounded platform key is the single largest cost-exposure risk of the AI feature set.

#### 8b. Analytics reader role (optional, recommended)

Create a separate read-only Postgres login scoped to the `ai_usage_analytics` view. The view replaces `user_id` with a pseudonymized `user_hash` (SHA-256) and exposes only cost/usage fields — no content tables, no auth tables, not even the base `ai_usage` table. Run this **manually** via Railway's database shell. Do NOT put credentials in migrations or source control.

```sql
-- Create the role with a strong, randomly generated password
CREATE ROLE analytics_reader LOGIN PASSWORD '<generated-password>';

-- Allow connection to the database and visibility into the public schema
GRANT CONNECT ON DATABASE railway TO analytics_reader;
GRANT USAGE ON SCHEMA public TO analytics_reader;

-- Grant SELECT on the analytics view ONLY — never the base `ai_usage` table
GRANT SELECT ON ai_usage_analytics TO analytics_reader;
```

Connection string for analytics tools / local CLI (Railway Postgres requires SSL):

```bash
psql "postgresql://analytics_reader:<password>@<railway-host>:<port>/railway?sslmode=require"
```

Use a separate role per consumer (one for each analytics tool, one for CLI) so credentials can be revoked independently. To grant access to a future analytics view, create the view with only the columns needed and `GRANT SELECT` on it to this role — do not widen access to base tables.

The `ai_usage_analytics` view and the `pgcrypto` extension it depends on are created by the `38f5a24e651f` migration and ship with the deploy. No schema work is needed before running the role/GRANT SQL above.

---

## Verify Deployment

1. **API:** Visit `https://<api-domain>/docs` - should show FastAPI docs
2. **Frontend:** Visit `https://<frontend-domain>` - should show login page
3. **Content MCP:** Visit `https://<content-mcp-domain>/mcp` - should respond to MCP requests
4. **Prompt MCP:** Visit `https://<prompt-mcp-domain>/mcp` - should respond to MCP requests
5. **AI Usage Flush cron:** Railway dashboard → `ai-usage-flush` service → **Deployments** tab. Verify at least one run has occurred at `:30` past the hour. One of three log outputs is expected:
   - `ai_usage_flush: no keys found` — Redis has no `ai_stats:*` keys at all (no AI traffic yet)
   - `ai_usage_flush: no completed hourly buckets to flush` — keys exist but only for the current hour (the flush intentionally excludes in-flight hours)
   - `ai_usage_flush: complete` — buckets were flushed, logged with `keys_processed` and `total_cost_flushed`
6. **Cleanup cron:** Railway dashboard → `cleanup` service → **Deployments** tab. After the first `0 3 * * *` UTC run, logs start with `Starting cleanup task` and end with `Cleanup complete: {...}` containing `soft_deleted_expired`, `expired_deleted`, `orphaned_deleted`. Any exceptions are surfaced via Railway's deployment failure indicator.
7. **Orphan Relationships cron:** Railway dashboard → `orphan-relationships` service → **Deployments** tab. After the first `0 4 * * *` UTC run, logs start with `Starting orphan relationship cleanup (delete=...)` and end with `Orphan relationship cleanup complete: {...}` containing `orphaned_source`, `orphaned_target`, `total_deleted`. Expect all zeros on a healthy system. **Before switching to `--delete`:** confirm `orphaned_source + orphaned_target = 0` for at least one scheduled run in report-only mode.
8. **AI endpoints** (requires an Auth0 token):
   ```bash
   curl -H "Authorization: Bearer <token>" https://<api>/ai/health
   # → {"available": true, "byok": false, "remaining_per_day": ..., "limit_per_day": ...,
   #    "remaining_per_minute": ..., "limit_per_minute": ...}

   curl -H "Authorization: Bearer <token>" https://<api>/ai/models
   # → {"models": [...7 models...], "defaults": {...}}
   ```
9. **Database objects** (via Railway Postgres shell):
   ```sql
   SELECT COUNT(*) FROM ai_usage;             -- 0 initially
   SELECT COUNT(*) FROM ai_usage_analytics;   -- 0 initially; view must exist
   ```

---

## Customizing Domain URLs

Railway generates random subdomains like `frontend-production-fb79.up.railway.app`. To customize:

### Change Railway Subdomain

1. Click on a service → **Settings** → **Networking**
2. Click the **edit icon** (pencil) next to the generated domain
3. Change the subdomain (e.g., `my-bookmarks` → `https://my-bookmarks.up.railway.app`)
4. Click **Save**

### Use a Custom Domain

See [docs/custom-domain-setup.md](docs/custom-domain-setup.md) for detailed instructions on configuring a custom domain with DNS and Auth0.

Quick summary:
1. Add custom domain in Railway (each service → **Settings** → **Networking** → **+ Custom Domain**)
2. Add CNAME records at your DNS provider
3. Update Railway environment variables (`CORS_ORIGINS`, `VITE_API_URL`, etc.)
4. Update Auth0 Allowed URLs
5. Redeploy all services

**Important:** After changing any domain, update:
- `CORS_ORIGINS` on the **api** service (must include `https://`)
- Auth0's Allowed Callback/Logout/Web Origins URLs
- **Redeploy the frontend** if you changed the API URL - Vite bakes `VITE_API_URL` at build time, so a rebuild is required for changes to take effect

---

## Deploying Changes

Push to `main` branch - Railway auto-deploys from connected GitHub repo.

For manual deploy:
```bash
railway up -s api         # Deploy API
railway up -s frontend    # Deploy frontend
railway up -s content-mcp # Deploy Content MCP
railway up -s prompt-mcp  # Deploy Prompt MCP
```

---

## Running Migrations

Migrations run automatically via the pre-deploy command configured in Step 4 (API Service).

To run migrations manually (if needed):
1. Go to Railway dashboard → **api** service → **Settings** → **Deploy**
2. The pre-deploy command `uv run alembic upgrade head` runs before each deployment

---

## Viewing Logs

```bash
railway logs -s api
railway logs -s frontend
railway logs -s content-mcp
railway logs -s prompt-mcp
```

Or use Railway dashboard → Click service → **Logs** tab

---

## Troubleshooting

### Build fails

Check build logs in Railway dashboard. Common issues:
- Missing dependencies in `pyproject.toml`
- Wrong root directory for frontend

### Database connection fails / ModuleNotFoundError: psycopg2

1. Verify `DATABASE_URL` uses `postgresql+asyncpg://` prefix (NOT `postgresql://`)
2. Do NOT use `${{Postgres.DATABASE_URL}}` - you must manually copy and modify the URL
3. See Step 5 above for detailed instructions

### CORS errors

Verify `CORS_ORIGINS` on API service includes your frontend domain with `https://`

### Frontend shows blank page

Check browser console. Verify `VITE_API_URL` points to your API's Railway domain.
