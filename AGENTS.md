# AGENTS.md

Tiddly — a multi-tenant SaaS for managing bookmarks, notes, and prompt templates. Monorepo: FastAPI backend, React frontend, Go CLI, Chrome extension, and two MCP servers for AI agent integration.

**For a system-level overview** (how services, databases, crons, MCP servers, CLI, and external deps fit together), see [`docs/architecture.md`](docs/architecture.md). This file is for conventions and rules; the architecture doc is for shape.

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
- **Public content is single-sourced and agent-readable** (`content/`): docs/legal prose as markdown (`content/prose/*.md`, rendered via `react-markdown` — not MDX, no SSR) and structured data as JSON the code reads (`content/data/*.json`: FAQ, known issues, tips, tiers). A Vite plugin serves both verbatim as static files at `/prose/*.md` and `/data/*.json` (each with a generated `index.json` manifest), so non-JS clients can read them; the `Docs*.tsx` pages are thin renderers of the prose. See `docs/implementation_plans/2026-05-21-content-as-markdown.md`.
- Other static data in `data/` — `tips/` (loader + selectors + validation over `content/data/tips.json`), `docsRoutes.tsx`/`settingsRoutes.tsx` (command-palette keyword indexes). Keyboard shortcuts are a validated JSON source at `shortcuts/shortcuts.json` (the loader derives OS-agnostic display tokens; `utils/platform.ts` localizes them at render — Mod → ⌘ on Mac, Ctrl elsewhere). JSON data files are schema-validated at load.

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
- **Subscription tiers**: FREE, STANDARD, and PRO with different rate limits and quotas — always test tier gating for AI features. `Tier.DEV` also exists as a runtime-only tier resolved when `VITE_DEV_MODE=true`.
- **Rate limiting**: In-memory with Redis fallback, per-user and per-operation.
- **ETag caching**: HTTP 304 responses for unchanged content.
- **Content versioning**: `ContentHistory` tracks changes with diff-match-patch.
- **SSRF protection**: URL scraping validates against internal networks.
- **Background tasks** (`backend/src/tasks/`): `ai-usage-flush` (hourly) and `cleanup` (daily) are deployed as Railway cron services. `orphan-relationships` is implemented and tested but intentionally deferred at beta scale — see [KAN-67](https://tiddly.atlassian.net/browse/KAN-67). See `docs/architecture.md` §9 for details.

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
- **Don't commit/push without approval**

## Files to Keep in Sync

After any feature, API, pricing, or UI change, review whether these need updating:

**Public content — edit the single source, not the renderer:**
- Docs/legal prose: `frontend/src/content/prose/*.md`. The `docs/Docs*.tsx` pages and the legal pages (`PrivacyPolicy.tsx`/`TermsOfService.tsx`, which add only page chrome + the dynamic "Last Updated" date) are thin renderers of these — editing the `.tsx` won't change the content (or what's served at `/prose/*.md`).
- FAQ: `frontend/src/content/data/faq.json` (one file feeds both `DocsFAQ` and `SettingsFAQ` via `components/FAQContent.tsx`). Known issues: `content/data/known-issues.json`. Tips: `content/data/tips.json`.
- Changelog: `frontend/src/content/data/changelog.json`. Roadmap: `content/data/roadmap.json`. The `changelog/Changelog.tsx` and `roadmap/Roadmap.tsx` pages are thin renderers — editing the `.tsx` won't change the content (or what's served at `/data/*.json`); presentation-only bits (tag/accent colors) stay in the renderer.
- Keyboard shortcuts: `frontend/src/shortcuts/shortcuts.json`.
- Tier limits / pricing numbers: `frontend/src/content/data/tiers.json` — the single cross-stack source (backend enforcement + `Pricing.tsx` display + served `/data/tiers.json`). **Never re-hardcode tier numbers**; `Pricing.tsx` reads them from this file (a test guards against drift).

**Designed pages still authored in TSX** (`frontend/src/pages/`):
- `LandingPage.tsx`, `FeaturesPage.tsx`, `AIIntegration.tsx` (marketing layouts — prose intentionally not migrated to markdown; see the content-as-markdown plan's M4), `Pricing.tsx` (layout and qualitative copy; the *numbers* come from `tiers.json`).

**LLM/AI discoverability:**
- `frontend/public/llms.txt` — LLM-friendly site index; update when features, API, or tiers change.

**Command palette search index:**
- `frontend/src/data/docsRoutes.tsx` — hand-curated keyword summaries that make `/docs/*` pages findable via the command palette. When you add a docs page, add its entry (path + label + keyword-rich `searchText`). When you substantially change an existing docs page (new sections, renamed concepts, removed features), update its `searchText`.
- `frontend/src/data/settingsRoutes.tsx` — same shape and obligation for `/app/settings/*` pages. The motivating case: searching `mcp` should surface `Settings: AI Integration` (where MCP is configured) even though the literal label doesn't contain that term.
- Optimize both for keyword density, not prose — terms a user might search for when looking for that page. Drift is graceful (a missing keyword means a missed result, not a broken feature), but accumulating drift erodes palette discoverability over time.

**Project-level docs:**
- `README.md` — feature list and setup instructions.
- `.env.example` — when adding/removing/renaming environment variables.
- `AGENTS.md` — when build commands, architecture, conventions, or project structure change.
- `docs/architecture.md` — when services, crons, middleware, auth variants, tier definitions, Redis key schemas, CLI commands, or other architecture changes occur. Of note, see the following sections for commonly missed updates:
    - "Known drift risks" section for the areas most likely to need updating
    - "Things that are easy to miss" section for non-obvious invariants to add to when you learn one.
- `README_DEPLOY.md` — when Railway service topology, env vars, or post-deploy steps change.
