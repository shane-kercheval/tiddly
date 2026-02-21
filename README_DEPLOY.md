# Deployment Guide

Deploy Tiddly services to Railway using Docker.

## Architecture

| Service | Description | Build |
|---------|-------------|-------|
| **api** | FastAPI backend | `Dockerfile.api` |
| **content-mcp** | Content MCP server (bookmarks/notes) | Railpack |
| **prompt-mcp** | Prompt MCP server (prompts capability) | Railpack |
| **frontend** | React SPA | Railpack |
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

Create 4 services, each connected to your GitHub repo:

1. Click **+ Create** → **GitHub Repo** → Select `bookmarks`
2. Repeat 3 more times (you'll have 4 services all pointing to the same repo)

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

#### 6d. Google Social Connection (Optional)

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

---

## Verify Deployment

1. **API:** Visit `https://<api-domain>/docs` - should show FastAPI docs
2. **Frontend:** Visit `https://<frontend-domain>` - should show login page
3. **Content MCP:** Visit `https://<content-mcp-domain>/mcp` - should respond to MCP requests
4. **Prompt MCP:** Visit `https://<prompt-mcp-domain>/mcp` - should respond to MCP requests

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
