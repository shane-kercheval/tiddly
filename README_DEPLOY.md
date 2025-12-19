# Deployment Guide

This guide covers deploying the Bookmarks application to Railway.

## Architecture Overview

The application consists of three services:

| Service | Description | Port |
|---------|-------------|------|
| **API** | FastAPI backend | 8000 |
| **MCP Server** | Model Context Protocol server for AI agents | 8001 |
| **Frontend** | React SPA served by nginx | 80 |

Plus a PostgreSQL 16 database.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │────▶│   API       │────▶│  PostgreSQL │
│  (nginx)    │     │  (FastAPI)  │     │             │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │ MCP Server  │
                    │ (FastMCP)   │
                    └─────────────┘
```

---

## Prerequisites

### 1. Install Railway CLI

```bash
npm install -g @railway/cli
```

### 2. Authenticate with Railway

```bash
railway login
```

This opens a browser for authentication.

### 3. Auth0 Configuration (Production)

You need an Auth0 account with:
- **Tenant**: Your Auth0 domain (e.g., `your-app.auth0.com`)
- **API**: Create an API with identifier `https://bookmarks-api`
- **Application**: Create a Single Page Application, note the Client ID

---

## Initial Deployment Setup

### Step 1: Create Railway Project

```bash
# Create a new project
railway init

# Or link to existing project
railway link
```

### Step 2: Add PostgreSQL Database

```bash
# Add PostgreSQL database
railway add --database postgres
```

Or via the Railway dashboard: **+ Create** → **Database** → **PostgreSQL**.

### Step 3: Create Services

Create 3 services in Railway via the dashboard. Repeat these steps for each service (api, mcp, frontend):

1. Click **+ Create** (top right) → **GitHub Repo**
2. Select your bookmarks repository
3. Once the service is created, click on it to open settings
4. Configure the service:

   **a. Rename the service** - Click the service name at the top and rename it

   **b. Set Dockerfile Path** - In the right sidebar, click **Build**:
   - Click the **Railpack** dropdown under "Builder"
   - Select **Dockerfile**
   - Enter the Dockerfile path (see table below)

   **c. Generate Domain** - In the right sidebar, click **Networking**:
   - Click **Generate Domain** to create a public URL for the service
   - (Port is auto-detected from the Dockerfile's EXPOSE directive)

#### Service Configuration

| Service | Dockerfile Path |
|---------|-----------------|
| `api` | `deploy/api.Dockerfile` |
| `mcp` | `deploy/mcp.Dockerfile` |
| `frontend` | `deploy/frontend.Dockerfile` |

### Step 4: Configure Environment Variables

Set these in Railway dashboard (Settings → Variables) for each service:

#### API Service Variables
```bash
# Database (auto-injected when you link PostgreSQL)
DATABASE_URL=postgresql+asyncpg://...

# Auth0
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=your-client-id
VITE_AUTH0_AUDIENCE=https://bookmarks-api

# CORS - set to your frontend URL
CORS_ORIGINS=https://your-frontend.up.railway.app

# Production mode
VITE_DEV_MODE=false
```

#### MCP Service Variables
```bash
# API URL (internal Railway networking)
VITE_API_URL=http://api.railway.internal:8000

# Or use the public API URL
# VITE_API_URL=https://your-api.up.railway.app

MCP_HOST=0.0.0.0
MCP_PORT=8001
```

#### Frontend Service Variables (Build Args)
```bash
# These are build-time variables
VITE_API_URL=https://your-api.up.railway.app
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=your-client-id
VITE_AUTH0_AUDIENCE=https://bookmarks-api
VITE_DEV_MODE=false
```

### Step 5: Configure Database Connection

Railway's PostgreSQL plugin automatically provides a `DATABASE_URL`. You need to:

1. Click on the PostgreSQL service in Railway dashboard
2. Go to **Variables** tab
3. Copy the `DATABASE_URL` value (looks like `postgresql://postgres:xxx@host:5432/railway`)
4. Go to your **API service** → **Variables**
5. Add a new variable `DATABASE_URL` with the copied value, but **change the prefix**:
   - From: `postgresql://...`
   - To: `postgresql+asyncpg://...`

This is required because the app uses async SQLAlchemy with the `asyncpg` driver.

**Note:** You don't need to set `POSTGRES_USER`, `POSTGRES_PASSWORD`, or `POSTGRES_DB` separately. Those are only used locally (in `.env`) to construct the DATABASE_URL. Railway provides the complete connection string with credentials already included.

### Step 6: Run Initial Migration

```bash
# Run migrations via Railway CLI
railway run --service api -- alembic upgrade head
```

### Step 7: Generate Domain URLs

For each service in Railway dashboard:
1. Go to service **Settings**
2. Under **Networking**, click **Generate Domain**
3. Note the URLs for configuration

---

## GitHub Actions Setup (Automated Deployment)

### Step 1: Get Railway API Token

1. Go to Railway dashboard → Account Settings → Tokens
2. Create a new token
3. Copy the token value

### Step 2: Get Service IDs

For each service, find the Service ID:
1. Click on the service in Railway dashboard
2. Go to **Settings**
3. Copy the **Service ID** (looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

### Step 3: Configure GitHub Repository

1. Go to your GitHub repo → Settings → Secrets and variables → Actions

2. Add **Secret**:
   - `RAILWAY_TOKEN`: Your Railway API token

3. Create **Environment** named `production`:
   - Go to Settings → Environments → New environment
   - Name: `production`
   - Add these **Variables**:
     - `RAILWAY_SERVICE_API_ID`: API service ID
     - `RAILWAY_SERVICE_MCP_ID`: MCP service ID
     - `RAILWAY_SERVICE_FRONTEND_ID`: Frontend service ID

### Step 4: Push to Deploy

Now, pushing to `main` branch will:
1. Run tests (backend lint, frontend lint + tests)
2. Deploy all three services in parallel
3. Run database migrations after API deploys

You can also trigger manual deployments:
1. Go to Actions tab in GitHub
2. Select "Deploy to Railway" workflow
3. Click "Run workflow"
4. Optionally specify services (e.g., `api,frontend` or `all`)

---

## Deploying Changes

### Automatic (Recommended)

Push to `main` branch:
```bash
git push origin main
```

GitHub Actions will:
1. Run tests
2. Deploy all services
3. Run migrations

### Manual via CLI

```bash
# Deploy specific service
railway up --service api

# Run migrations
railway run --service api -- alembic upgrade head
```

### Manual via Dashboard

1. Go to Railway dashboard
2. Select your service
3. Click **Deploy** → **Deploy Now**

---

## Database Migrations

### Creating New Migrations

```bash
# Local development
make migration message="Add new column"

# This creates a file in backend/src/db/migrations/versions/
```

### Running Migrations in Production

Migrations run automatically via GitHub Actions after API deployment.

To run manually:
```bash
railway run --service api -- alembic upgrade head
```

### Rolling Back Migrations

```bash
# Rollback one migration
railway run --service api -- alembic downgrade -1

# Rollback to specific revision
railway run --service api -- alembic downgrade <revision>
```

---

## Monitoring & Logs

### View Logs

```bash
# Via CLI
railway logs --service api
railway logs --service mcp
railway logs --service frontend

# Or use Railway dashboard → Service → Logs
```

### Health Checks

- **API**: `GET /health`
- **Frontend**: Nginx serves index.html
- **MCP**: HTTP endpoint at `/mcp`

---

## Troubleshooting

### Service won't start

1. Check logs: `railway logs --service <name>`
2. Verify environment variables are set
3. Ensure DATABASE_URL uses `postgresql+asyncpg://` prefix

### Database connection issues

1. Verify PostgreSQL is running in Railway
2. Check DATABASE_URL is correctly formatted
3. Ensure API service is linked to PostgreSQL

### Frontend shows blank page

1. Check browser console for errors
2. Verify VITE_API_URL points to correct API URL
3. Ensure Auth0 variables are set (or VITE_DEV_MODE=true for testing)

### MCP server can't reach API

1. Verify VITE_API_URL is set correctly
2. Try internal URL: `http://api.railway.internal:8000`
3. Check API service is running and healthy

### CORS errors

1. Verify CORS_ORIGINS includes your frontend URL
2. Include protocol: `https://your-frontend.up.railway.app`
3. Multiple origins: comma-separated list

### Build failures

1. Check Dockerfile syntax
2. Ensure all required files are committed
3. Verify pyproject.toml/package.json are valid

---

## Cost Estimation

Railway pricing is usage-based. Estimated costs for this application:

| Resource | Estimate |
|----------|----------|
| API (always-on, minimal traffic) | ~$5-8/month |
| MCP Server (light usage) | ~$2-4/month |
| Frontend (static serving) | ~$2-3/month |
| PostgreSQL (1GB) | ~$5-7/month |
| **Total** | **~$15-22/month** |

Costs vary based on actual usage. Monitor in Railway dashboard.

---

## Local Testing with Production Config

Test the Docker builds locally before deploying:

```bash
# Build images
docker build -f deploy/api.Dockerfile -t bookmarks-api .
docker build -f deploy/mcp.Dockerfile -t bookmarks-mcp .
docker build -f deploy/frontend.Dockerfile -t bookmarks-frontend \
  --build-arg VITE_API_URL=http://localhost:8000 \
  --build-arg VITE_DEV_MODE=true .

# Run with local database
docker compose up -d db

# Run API
docker run -p 8000:8000 \
  -e DATABASE_URL=postgresql+asyncpg://bookmarks:bookmarks@host.docker.internal:5435/bookmarks \
  -e VITE_DEV_MODE=true \
  -e CORS_ORIGINS=http://localhost \
  bookmarks-api

# Run frontend
docker run -p 80:80 bookmarks-frontend
```

---

## File Structure

```
deploy/
├── api.Dockerfile        # Backend API container
├── mcp.Dockerfile        # MCP server container
├── frontend.Dockerfile   # Frontend container (multi-stage)
├── nginx.conf            # Nginx config for frontend
└── railway.toml          # Railway configuration reference

.github/
└── workflows/
    └── deploy.yml        # GitHub Actions deployment workflow
```
