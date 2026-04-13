.PHONY: tests build run content-mcp-server prompt-mcp-server migrate backend-lint unit_tests pen_tests frontend-install frontend-build frontend-dev frontend-tests frontend-lint frontend-typecheck docker-up docker-down docker-restart docker-rebuild docker-logs redis-cli evals evals-content-mcp evals-prompt-mcp evals-ai-suggestions evals-ai-suggestions-tags evals-ai-suggestions-relationships api-run-bench eval-viewer-install eval-viewer test-data test-data-clear cli-build cli-test cli-lint cli-snapshot cli-release-check

-include .env
export

# Set PYTHONPATH for backend
PYTHONPATH := backend/src

# VM IP for host-accessible dev server (auto-detected, override with: make frontend-run-vm VM_IP=x.x.x.x)
VM_IP ?= $(shell hostname -I 2>/dev/null | awk '{print $$1}' || ipconfig getifaddr en0 2>/dev/null || echo '0.0.0.0')

####
# Backend Development
####
build:  ## Install backend dependencies
	uv sync

api-run:  ## Start API server with hot-reload
	PYTHONPATH=$(PYTHONPATH) uv run uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

api-run-bench:  ## Start API server for benchmarking (4 workers, no reload)
	PYTHONPATH=$(PYTHONPATH) VITE_DEV_MODE=true uv run uvicorn api.main:app --workers 4 --host 0.0.0.0 --port 8000

####
# MCP Servers
####
content-mcp-server:  ## Start Content MCP server (port 8001, requires API on 8000)
	PYTHONPATH=$(PYTHONPATH) uv run python -m mcp_server

prompt-mcp-server:  ## Start Prompt MCP server (port 8002, requires API on 8000)
	PYTHONPATH=$(PYTHONPATH) uv run python -m prompt_mcp_server

####
# Frontend Development
####
EXPECTED_NODE_MAJOR := $(shell cat frontend/.nvmrc 2>/dev/null)
ACTUAL_NODE_MAJOR := $(shell node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
define check_node_version
	@if [ "$(ACTUAL_NODE_MAJOR)" != "$(EXPECTED_NODE_MAJOR)" ]; then \
		echo "Error: Node $(EXPECTED_NODE_MAJOR) required (found $(ACTUAL_NODE_MAJOR)). Run: nvm install $(EXPECTED_NODE_MAJOR) && nvm alias default $(EXPECTED_NODE_MAJOR)"; \
		exit 1; \
	fi
endef
frontend-run:  ## Start frontend dev server
	$(check_node_version)
	cd frontend && npm run dev

frontend-run-ssh:  ## Start frontend dev server accessible from host
	$(check_node_version)
	cd frontend && npm run dev -- --host 0.0.0.0

frontend-install:  ## Install frontend dependencies
	$(check_node_version)
	cd frontend && npm install

frontend-build:  ## Build frontend for production
	$(check_node_version)
	cd frontend && npm run build

frontend-lint:  ## Run frontend linter
	$(check_node_version)
	cd frontend && npm run lint

frontend-typecheck:  ## Run TypeScript type checking
	$(check_node_version)
	cd frontend && npm run typecheck

frontend-tests:  ## Run frontend tests
	$(check_node_version)
	cd frontend && npm run test:run

frontend-verify: frontend-lint frontend-typecheck frontend-tests

####
# Chrome Extension
####
chrome-ext-install:  ## Install chrome extension test dependencies
	$(check_node_version)
	cd chrome-extension && npm install

chrome-ext-tests:  ## Run chrome extension tests
	$(check_node_version)
	cd chrome-extension && npm test

chrome-ext-zip:  ## Package chrome extension for distribution
	@mkdir -p dist
	cd chrome-extension && zip -r ../dist/chrome-extension.zip \
		manifest.json \
		popup.html popup.js popup-core.js popup.css \
		background.js background-core.js \
		options.html options.js options.css \
		icons/ \
		-x '*.DS_Store'

chrome-ext-verify: chrome-ext-tests

####
# Docker (PostgreSQL + Redis)
####
docker-up:  ## Start all containers (PostgreSQL + Redis)
	docker compose up -d

docker-down:  ## Stop all containers
	docker compose down

docker-restart:  ## Restart all containers
	docker compose down && docker compose up -d

docker-rebuild:  ## Rebuild and restart all containers
	docker compose down && docker compose up -d --build

docker-logs:  ## Show container logs (follow mode)
	docker compose logs -f

redis-cli:  ## Connect to Redis CLI
	docker compose exec redis redis-cli

####
# Database Migrations
####
migrate:  ## Run database migrations
	uv run alembic upgrade head

migration:  ## Create new migration: make migration message="description"
	uv run alembic revision --autogenerate -m "$(message)"

####
# Evaluations (LLM-based MCP tool testing)
####
evals:  ## Run all LLM evaluations (requires API + MCP servers running)
	uv run ruff check evals --fix --unsafe-fixes
	PYTHONPATH=$(PYTHONPATH) uv run pytest evals/ -vs --timeout=300

evals-content-mcp:  ## Run Content MCP evaluations only
	PYTHONPATH=$(PYTHONPATH) uv run pytest evals/content_mcp/ -vs --timeout=300

evals-prompt-mcp:  ## Run Prompt MCP evaluations only
	PYTHONPATH=$(PYTHONPATH) uv run pytest evals/prompt_mcp/ -vs --timeout=300

evals-ai-suggestions:  ## Run all AI suggestion evaluations (no server needed)
	PYTHONPATH=$(PYTHONPATH) uv run pytest evals/ai_suggestions/ -vs --timeout=300

evals-ai-suggestions-tags:  ## Run tag suggestion evaluations only
	PYTHONPATH=$(PYTHONPATH) uv run pytest evals/ai_suggestions/test_suggest_tags.py -vs --timeout=300

evals-ai-suggestions-relationships:  ## Run relationship suggestion evaluations only
	PYTHONPATH=$(PYTHONPATH) uv run pytest evals/ai_suggestions/test_suggest_relationships.py -vs --timeout=300

####
# Eval Viewer
####
eval-viewer-install:  ## Install eval viewer dependencies
	cd evals/viewer && npm install

eval-viewer:  ## Start eval results viewer
	cd evals/viewer && npm run dev

####
# Testing & Quality
####
backend-lint:  ## Run ruff linter on backend
	uv run ruff check backend/src --fix --unsafe-fixes
	uv run ruff check backend/tests --fix --unsafe-fixes

backend-tests:  ## Run backend unit tests with coverage (excludes deployed security tests)
	uv run coverage run -m pytest --durations=20 backend/tests --ignore=backend/tests/security/deployed
	uv run coverage html

backend-verify: backend-lint backend-tests

lint: backend-lint frontend-lint

tests: cli-verify backend-verify frontend-verify chrome-ext-verify

pen_tests:  ## Run deployed security tests (requires SECURITY_TEST_* env vars in .env)
	uv run pytest backend/tests/security/deployed -v

dependency-audit:  ## Run audits to check for vulnerable dependencies
	uv run pip-audit
	npm audit --prefix frontend

security: dependency-audit pen_tests  ## Run security checks

open_coverage:  ## Open coverage report in browser
	open 'htmlcov/index.html'

####
# Seed Data
####
test-data:  ## Populate database with test data
	PYTHONPATH=$(PYTHONPATH) uv run python backend/scripts/seed_data.py populate --force

test-data-clear:  ## Remove all test data
	PYTHONPATH=$(PYTHONPATH) uv run python backend/scripts/seed_data.py clear

####
# CLI (Go)
####
cli-build:  ## Build CLI binary
	cd cli && go build -o ../bin/tiddly .

cli-test:  ## Run CLI tests
	cd cli && go test ./... -count=1

cli-lint:  ## Run CLI linter
	cd cli && $(shell go env GOPATH)/bin/golangci-lint run ./...

cli-verify: cli-lint cli-test

cli-release-check:  ## Pre-release checks (tests + vet + build)
	cd cli && go test ./... -count=1 && go vet ./... && go build ./...

cli-snapshot:  ## Build CLI snapshot (local testing, requires goreleaser)
	cd cli && goreleaser build --snapshot --clean
