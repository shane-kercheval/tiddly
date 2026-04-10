# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tiddly — a multi-tenant SaaS for managing bookmarks, notes, and prompt templates. Monorepo with four components: FastAPI backend, React frontend, Go CLI, and Chrome extension. Includes two MCP servers for AI agent integration.

## Common Commands

### Backend
```bash
make build                # Install Python deps (uv sync)
make api-run              # Start API server (port 8000, hot-reload)
make backend-lint         # Ruff linter with auto-fixes
make backend-tests        # pytest with coverage
make backend-verify       # lint + tests
make migrate              # Run Alembic migrations
make migration message="description"  # Create new migration
```

**Note**: never create migrations manually — always use `make migration ...` or underlying command to ensure they are properly generated and named.

**Note**: uv is used instead of pip for dependency management. Use `uv run` to execute commands in the virtual environment (e.g., `uv run pytest`).

Run a single backend test:
```bash
PYTHONPATH=backend/src uv run pytest backend/tests/path/to/test_file.py::test_name -v
```

### Frontend
```bash
make frontend-install     # npm install (requires Node 22 via nvm)
make frontend-run         # Vite dev server
make frontend-lint        # ESLint
make frontend-typecheck   # tsc --noEmit
make frontend-tests       # Vitest
make frontend-verify      # lint + typecheck + tests
```

Run a single frontend test:
```bash
cd frontend && npx vitest run src/path/to/file.test.ts
```

### CLI (Go)
```bash
make cli-build            # Build binary to bin/tiddly
make cli-test             # go test ./...
make cli-lint             # golangci-lint
make cli-verify           # lint + tests
```

### Infrastructure
```bash
make docker-up            # Start PostgreSQL + Redis
make docker-down          # Stop containers
make tests                # Full suite: cli + backend + frontend + chrome extension
```

### Evaluations (LLM-based MCP tool testing)
```bash
make evals                # All evals (requires API + MCP servers running)
make evals-content-mcp    # Content MCP evals only
make evals-prompt-mcp     # Prompt MCP evals only
```

## Architecture

### Backend (`backend/src/`)
- **Framework**: FastAPI + async SQLAlchemy 2.0 + PostgreSQL 17 (pgvector)
- **Python**: 3.13, dependencies managed by `uv`
- **PYTHONPATH**: `backend/src` — all imports are relative to this root (e.g., `from api.routers import bookmarks`, `from services.bookmark_service import BookmarkService`)
- **Entry point**: `api/main.py` → FastAPI app with lifespan manager
- **Routers** (`api/routers/`): 16 endpoint modules — bookmarks, notes, prompts, content (unified search), ai, history, tags, filters, relationships, tokens, users, consent, settings, health, mcp
- **Services** (`services/`): Business logic layer. `BaseEntityService` provides shared CRUD patterns for bookmark/note/prompt services. `ContentService` handles unified cross-type search/filtering. `LLMService` wraps LiteLLM for multi-provider AI (Gemini, OpenAI, Anthropic).
- **Models** (`models/`): SQLAlchemy ORM with UUIDv7 primary keys, soft delete (`deleted_at`), archiving (`archived_at`), trigger-maintained full-text search vectors
- **Schemas** (`schemas/`): Pydantic validation models
- **Auth** (`core/auth.py`): Auth0 JWT + Personal Access Tokens (`bm_` prefix). Dev mode bypass via `VITE_DEV_MODE=true`. Auth cached in Redis (5-min TTL).
- **Migrations** (`db/migrations/`): Alembic, auto-run on deploy
- **Testing**: pytest-asyncio, testcontainers (PostgreSQL + Redis), 60s timeout per test

### Frontend (`frontend/src/`)
- **Stack**: React 19 + TypeScript + Vite + Tailwind CSS 4
- **Node**: v22 (`.nvmrc`)
- **State**: Zustand stores (`stores/`)
- **Data fetching**: @tanstack/react-query (`hooks/`)
- **Routing**: React Router v7
- **Editor**: Milkdown (markdown with CodeMirror)
- **Testing**: Vitest + @testing-library/react

### MCP Servers
- **Content MCP** (`backend/src/mcp_server/`, port 8001): Tools for bookmarks/notes CRUD and search
- **Prompt MCP** (`backend/src/prompt_mcp_server/`, port 8002): Tools for prompt template management
- Both proxy through the backend API (require API server running on port 8000)

### CLI (`cli/`)
- **Go** with Cobra framework, Viper config
- OAuth device code flow + keyring credential storage
- Commands: login, auth, mcp configure, skills configure, export, tokens, update

### Chrome Extension (`chrome-extension/`)
- Bookmark saver popup, background service worker
- Tests via npm test

## Key Patterns

- **Multi-tenant**: All queries scoped to authenticated user via `user_id`
- **Subscription tiers**: FREE and PRO with different rate limits and quotas — always test tier gating for AI features
- **Rate limiting**: In-memory with Redis fallback, per-user and per-operation limits
- **ETag caching**: HTTP 304 responses for unchanged content
- **Content versioning**: `ContentHistory` tracks changes with diff-match-patch
- **SSRF protection**: URL scraping validates against internal networks
- **pytest config**: `asyncio_mode = "auto"` in `pyproject.toml` — no need for `@pytest.mark.asyncio`
