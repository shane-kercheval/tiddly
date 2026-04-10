# CLAUDE.md

Tiddly — a multi-tenant SaaS for managing bookmarks, notes, and prompt templates. Monorepo: FastAPI backend, React frontend, Go CLI, Chrome extension, and two MCP servers for AI agent integration.

## Commands

Run `make help` or see the `Makefile` for all targets. Key commands:

```bash
make backend-verify       # lint + tests (always run before backend PRs)
make frontend-verify      # lint + typecheck + tests
make cli-verify           # lint + tests
make tests                # full suite across all components
make migration message="description"  # create new Alembic migration
```

**Run a single backend test:**
```bash
PYTHONPATH=backend/src uv run pytest backend/tests/path/to/test_file.py::test_name -v
```

**Run a single frontend test:**
```bash
cd frontend && npx vitest run src/path/to/file.test.ts
```

## Architecture

### Backend (`backend/src/`)
- **FastAPI + async SQLAlchemy 2.0 + PostgreSQL 17** (pgvector). Python 3.13, deps managed by `uv`.
- **PYTHONPATH is `backend/src`** — all imports relative to this root (e.g., `from api.routers import bookmarks`, `from services.bookmark_service import BookmarkService`). Never use `from backend.src...` or relative imports.
- **Entry point**: `api/main.py`. Routers in `api/routers/`, services in `services/`, models in `models/`, schemas in `schemas/`.
- **`BaseEntityService`** provides shared CRUD for bookmark/note/prompt services. `ContentService` handles unified cross-type search. `LLMService` wraps LiteLLM for multi-provider AI.
- **Auth** (`core/auth.py`): Auth0 JWT + Personal Access Tokens (`bm_` prefix). Dev mode bypass via `VITE_DEV_MODE=true`. Cached in Redis (5-min TTL).
- **Models**: UUIDv7 PKs, soft delete (`deleted_at`), archiving (`archived_at`), trigger-maintained FTS vectors.

### Frontend (`frontend/src/`)
- React 19 + TypeScript + Vite + Tailwind CSS 4. Node v22 (`.nvmrc`).
- State: Zustand (`stores/`). Data fetching: @tanstack/react-query (`hooks/`). Routing: React Router v7. Editor: Milkdown.

### MCP Servers
- **Content MCP** (`backend/src/mcp_server/`, port 8001): bookmarks/notes CRUD and search.
- **Prompt MCP** (`backend/src/prompt_mcp_server/`, port 8002): prompt template management.
- Both proxy through the backend API (require API server on port 8000).

### CLI (`cli/`)
- Go + Cobra + Viper. OAuth device code flow + keyring credential storage.

### Chrome Extension (`chrome-extension/`)
- Bookmark saver popup + background service worker. Manifest V3.

## Key Patterns

- **Multi-tenant**: All queries scoped to authenticated user via `user_id`.
- **Subscription tiers**: FREE and PRO with different rate limits and quotas — always test tier gating for AI features.
- **Rate limiting**: In-memory with Redis fallback, per-user and per-operation.
- **ETag caching**: HTTP 304 responses for unchanged content.
- **Content versioning**: `ContentHistory` tracks changes with diff-match-patch.
- **SSRF protection**: URL scraping validates against internal networks.
- **Background tasks** (`backend/src/tasks/`): Cron jobs for cleanup, orphan detection, etc. Not yet deployed — deployment to Railway is in progress.

## Evals (`evals/`)

LLM-based evaluations for agentic tool behavior. Currently covers MCP servers; expanding to AI suggestion endpoints. Run with `make evals` (requires API + MCP servers running). After modifying MCP tools or AI endpoints, run relevant evals to catch regressions.

## Design Docs (`docs/`)

`docs/implementation_plans/` contains dated plans for past and in-progress features. `docs/` also has high-level design documents (e.g., `ai-integration.md`, `content-versioning.md`, `connection-pool-tuning.md`). **Before designing a new feature or refactoring a system, check `docs/` for existing plans and design decisions.**

## Security Tests (`backend/tests/security/`)

Includes SSRF tests (run locally) and live penetration tests (`deployed/test_live_penetration.py`) that run against production. **After changes to auth, API endpoints, or input validation, update these tests and remind the user to run the deployed security tests against production.**

## Don't

- **Don't create migrations manually** — always use `make migration message="..."`.
- **Don't add `@pytest.mark.asyncio`** — `asyncio_mode = "auto"` is set in `pyproject.toml`.
- **Don't use `pip`** — use `uv`. Run commands via `uv run` (e.g., `uv run pytest`).
- **Don't mutate `deleted_at`/`archived_at` directly** — use the service layer methods.
- **Don't use synchronous DB calls** — all database access is async.
- **Don't bypass auth outside dev mode** — `VITE_DEV_MODE=true` is for local development only.

## Files to Keep in Sync

After any feature, API, pricing, or UI change, review whether these need updating:

**User-facing content pages** (`frontend/src/pages/`):
- `FeaturesPage.tsx`, `Pricing.tsx`, `LandingPage.tsx`
- `changelog/Changelog.tsx`, `roadmap/Roadmap.tsx`
- `docs/DocsFAQ.tsx`, `settings/SettingsFAQ.tsx`
- `docs/Docs*.tsx` — especially `DocsAPI.tsx`, `DocsAIFeatures.tsx`, `DocsCLIReference.tsx`, `DocsContentTypes.tsx`, `DocsShortcuts.tsx`, `DocsKnownIssues.tsx`
- `../components/FAQContent.tsx` (shared FAQ content)

**LLM/AI discoverability:**
- `frontend/public/llms.txt` — LLM-friendly site index; update when features, API, or tiers change.

**Project-level docs:**
- `README.md` — feature list and setup instructions.
- `.env.example` — when adding/removing/renaming environment variables.
- `CLAUDE.md` — when build commands, architecture, conventions, or project structure change.
