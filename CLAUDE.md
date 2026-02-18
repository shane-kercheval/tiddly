# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A content management system for bookmarks, notes, and prompts with tagging and search capabilities. Multi-tenant architecture with Auth0 authentication (bypassed in VITE_DEV_MODE). Prompts are Jinja2 templates exposed via MCP for AI assistants.

### llms.txt

`frontend/public/llms.txt` is a user-facing document describing platform features, capabilities, and usage for LLMs and AI agents. It is served at `https://tiddly.me/llms.txt`. When adding or changing user-facing features, update llms.txt to reflect the change.

## Common Commands

```bash
# Backend
make build              # Install backend dependencies (uv sync)
make run                # Start API server with hot-reload (port 8000)
make linting            # Run ruff linter on backend
make unit_tests         # Run backend tests with coverage
make tests              # Run linting + all tests (backend + frontend)

# Run a single backend test
uv run pytest backend/tests/path/to/test_file.py::test_function_name -v

# MCP Servers (Model Context Protocol)
make content-mcp-server   # Start Content MCP server (port 8001, requires API on 8000)
make prompt-mcp-server    # Start Prompt MCP server (port 8002, requires API on 8000)

# Frontend (from frontend/ directory)
npm install             # Install dependencies
npm run dev             # Start dev server (port 5173)
npm run test:run        # Run tests once
npm run test            # Run tests in watch mode
npm run lint            # Run ESLint

# Docker (PostgreSQL + Redis)
make docker-up          # Start all containers
make docker-down        # Stop all containers
make docker-restart     # Restart all containers
make docker-logs        # Show container logs
make redis-cli          # Connect to Redis CLI

# Database Migrations
make migrate            # Run Alembic migrations
make migration message="description"  # Create new migration
```

## Architecture

### Backend (`backend/src/`)
- **api/**: FastAPI routers and dependencies
  - `main.py`: App entry point, CORS config, router registration
  - `dependencies.py`: Re-exports auth dependencies and session/settings getters
  - `routers/`: Endpoint handlers (bookmarks, notes, prompts, users, tags, tokens, health)
- **core/**: Configuration, authentication, rate limiting, and caching
  - `config.py`: Settings and environment configuration
  - `auth.py`: JWT/PAT validation and user authentication
  - `redis.py`: Redis client wrapper with graceful fallback
  - `rate_limiter.py`: Tiered rate limiting (sliding + fixed window)
  - `auth_cache.py`: User lookup caching with 5-minute TTL
- **models/**: SQLAlchemy ORM models (User, Bookmark, Note, Prompt, ApiToken)
- **schemas/**: Pydantic request/response schemas
- **services/**: Business logic (bookmark_service, note_service, prompt_service, token_service, url_scraper)
- **db/**: Database session management and Alembic migrations
- **mcp_server/**: Content MCP server for bookmarks/notes (uses FastMCP)
  - `server.py`: Tools: search_items, get_item, edit_content, search_in_content, update_item, create_bookmark, create_note, list_tags
  - `auth.py`: Bearer token extraction from MCP request headers
  - `api_client.py`: HTTP client helpers for API requests
- **prompt_mcp_server/**: Prompt MCP server (uses low-level MCP SDK for prompts capability)
  - `server.py`: Tools: search_prompts, get_prompt_content, get_prompt_metadata, create_prompt, edit_prompt_content, update_prompt, list_tags
  - `template_renderer.py`: Jinja2 template rendering with StrictUndefined
  - `auth.py`: Context-based token management via contextvars

### Frontend (`frontend/src/`)
- React 19 + TypeScript + Vite + Tailwind CSS
- **components/**: Reusable UI components
- **pages/**: Route pages
- **hooks/**: Custom React hooks
- **services/**: API client layer
- Auth via `@auth0/auth0-react`

### Key Patterns
- All database tables include `user_id` for multi-tenancy
- Bookmarks, Notes, and Prompts use `BaseEntityService` for consistent CRUD, soft delete, archive, tags, and search
- Tests use testcontainers for PostgreSQL with transaction rollback isolation
- `VITE_DEV_MODE=true` bypasses authentication for local development
- Personal Access Tokens (PATs) prefixed with `bm_` for programmatic API access

### Authentication Dependencies

Four auth dependencies in `core/auth.py`, exported via `api/dependencies.py`:

| Dependency | Auth0 | PATs | Consent Check | Use Case |
|------------|-------|------|---------------|----------|
| `get_current_user` | Yes | Yes | Yes | **Default** - most endpoints |
| `get_current_user_without_consent` | Yes | Yes | No | Consent/policy viewing endpoints |
| `get_current_user_auth0_only` | Yes | No | Yes | Blocks PAT access (e.g., fetch-metadata) |
| `get_current_user_auth0_only_without_consent` | Yes | No | No | Blocks PAT access, no consent check |

**When to use `_auth0_only` variants:**

Use to block PAT access and help prevent unintended programmatic use:
- Endpoint makes external HTTP requests (SSRF risk) - e.g., `/bookmarks/fetch-metadata`
- Account management features - e.g., `/tokens/*`, `/settings/*`
- Endpoints where PAT access has no legitimate use case

**Important:** `_auth0_only` does NOT prevent all programmatic access. Users can extract
their Auth0 JWT from browser DevTools and use it in scripts. Rate limiting provides
the additional layer to cap any abuse.

**Current Auth0-only endpoints:**
- `/bookmarks/fetch-metadata` - blocks PAT-based SSRF abuse (also rate limited)
- `/tokens/*` - prevents compromised PAT from creating more tokens
- `/settings/*` - account management (no PAT use case)

**Status codes:**
- 401: No/invalid credentials
- 403: Valid PAT but endpoint is Auth0-only
- 429: Rate limit exceeded
- 451: Valid auth but missing/outdated consent

### Rate Limiting

Redis-based tiered rate limiting with different limits by auth type and operation:

| Auth Type | Operation | Per Minute | Per Day |
|-----------|-----------|------------|---------|
| PAT | Read | 120 | 2000 |
| PAT | Write | 60 | 2000 |
| Auth0 | Read | 300 | 4000 |
| Auth0 | Write | 90 | 4000 |
| Auth0 | Sensitive | 30 | 250 |

**Sensitive operations:** Endpoints making external HTTP requests (e.g., `/bookmarks/fetch-metadata`).

**Rate limit headers** on all responses:
- `X-RateLimit-Limit`: Maximum requests in window
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Unix timestamp when window resets
- `Retry-After`: Seconds until retry (on 429 responses)

**Fail-open:** If Redis is unavailable, requests are allowed (degraded mode).

### Auth Caching

User lookups are cached in Redis for 5 minutes to reduce database load:
- Cache key includes schema version for safe migrations
- Invalidated on consent updates (`POST /consent/me`)
- Falls back to database on cache miss or Redis unavailability

### HTTP Caching

The API supports HTTP caching via ETag and Last-Modified headers to reduce bandwidth and improve client performance:

**ETag (all GET JSON endpoints):**
- Server includes `ETag` header with response content hash
- Client sends `If-None-Match: <etag>` on subsequent requests
- Server returns 304 Not Modified if content unchanged (saves bandwidth, not DB work)
- Implemented via `ETagMiddleware` in `core/http_cache.py`

**Last-Modified (single-resource endpoints):**
- Endpoints: `/bookmarks/{id}`, `/notes/{id}`, `/prompts/{id}`, `/prompts/name/{name}`
- Server includes `Last-Modified` header with `updated_at` timestamp
- Client sends `If-Modified-Since: <date>` on subsequent requests
- Server can skip the full database query if resource unchanged (only runs lightweight `SELECT updated_at`)

**Header Precedence:** `If-None-Match` takes precedence over `If-Modified-Since` per HTTP spec.

**Caching Headers on all cacheable responses:**
- `Cache-Control: private, must-revalidate` - User-specific data, always revalidate
- `Vary: Authorization` - Response varies by auth header

**Implementation Files:**
- `core/http_cache.py`: ETagMiddleware, format_http_date, parse_http_date, check_not_modified
- `services/base_entity_service.py`: get_updated_at() method
- `services/prompt_service.py`: get_updated_at_by_name() method

### Content Versioning

All content changes (bookmarks, notes, prompts) are tracked in the `content_history` table:

**Tracked Actions:**
- Content actions (versioned): CREATE, UPDATE, RESTORE
- Audit actions (NULL version, no content): DELETE, UNDELETE, ARCHIVE, UNARCHIVE

**Source Tracking:**
- Request source via `X-Request-Source` header (any value accepted, stored as-is). Known values: web, mcp-content, mcp-prompt, iphone
- Auth type: auth0, pat, dev
- Token prefix for PAT requests (e.g., "bm_a3f8...") for audit trail

**Content Storage (Reverse Diffs):**
- Uses Google's diff-match-patch algorithm with reverse diffs
- Change type derived from columns: `version IS NULL` → audit, `action = 'create'` → create, `content_diff IS NOT NULL` → content change, else → metadata only
- CREATE: `content_snapshot` set (full content), no diff
- Content change: `content_diff` set; also `content_snapshot` at every 10th version (periodic snapshot)
- Metadata only: neither content column set; `content_snapshot` at every 10th version (bounded reconstruction)
- Audit: neither content column set, version is NULL
- Reconstruction: find nearest record with `content_snapshot IS NOT NULL`, apply diffs backwards
- Fallback: if no snapshot found, start from `entity.content`

**API Endpoints:**
- `GET /history` - All user history (paginated, filterable by content_type)
- `GET /history/{content_type}/{content_id}` - Entity history
- `GET /history/{content_type}/{content_id}/version/{v}` - Reconstruct content at version
- `POST /history/{content_type}/{content_id}/restore/{v}` - Restore to version
- `GET /bookmarks/{id}/history` - Bookmark history (also for notes/prompts)

**Retention:**
- Tier-based limits: `history_retention_days`, `max_history_per_entity` in TierLimits
- Count limits: enforced inline every 10th write (modulo check)
- Time limits: enforced via nightly cron job (batched by tier)
- Soft-delete expiry: entities deleted 30+ days are permanently removed with history

**Implementation Files:**
- `models/content_history.py`: ContentHistory model, ActionType, EntityType enums
- `services/history_service.py`: HistoryService for recording and reconstruction
- `schemas/history.py`: Pydantic schemas for API responses
- `api/routers/history.py`: History API endpoints
- `tasks/cleanup.py`: Nightly cleanup cron job

## Testing

Backend tests use pytest with async support. The `conftest.py` sets up:
- PostgreSQL container (session-scoped) via testcontainers
- Redis container (session-scoped) via testcontainers
- Transaction rollback per test for isolation
- FastAPI test client with session and Redis overrides

Test naming convention: `test__<function_name>__<scenario>`

## Code Style

- Python: ruff for linting, type hints required on all functions
- Use `uv` for package management (not pip)
- Single quotes for code strings, double quotes for user-facing strings
- Docstrings in Google style with Args/Returns/Raises sections
