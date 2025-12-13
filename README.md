# Bookmarks

A bookmark management system with tagging and search capabilities.

## Project Structure

```
bookmarks/
├── backend/       # FastAPI backend
│   ├── src/       # Application code
│   └── tests/     # Backend tests
├── frontend/      # React frontend (see frontend/README.md)
├── .env.example   # Environment configuration
└── Makefile       # Development commands
```

## Prerequisites

- Python 3.13+ with [uv](https://docs.astral.sh/uv/)
- Node.js 20+ (for frontend)
- Docker (for PostgreSQL)

## Quick Start

```bash
# Setup
cp .env.example .env
make build          # Install backend dependencies
make db-up          # Start PostgreSQL
make migrate        # Run database migrations

# Run backend
make run            # API at http://localhost:8000/docs

# Run frontend (separate terminal)
cd frontend && npm install && npm run dev
# Frontend at http://localhost:5173
```

With default `DEV_MODE=true`, authentication is bypassed for local development.

## Configuration

See `.env.example` for all options. Key settings:

- `DEV_MODE=true` - Bypasses auth (local dev)
- `VITE_AUTH0_*` - Frontend auth (empty = dev mode)

## Commands

See `Makefile` for all commands. Run `make` with no args to see help.

## Testing

```bash
make tests          # Run backend linting + tests
make frontend-test  # Run frontend tests
```

## API Documentation

With the backend running: http://localhost:8000/docs

## Personal Access Tokens

PATs allow programmatic API access for CLI tools and scripts.

```bash
# Create a token (with DEV_MODE=true, no auth header needed)
curl -X POST http://localhost:8000/tokens/ \
  -H "Content-Type: application/json" \
  -d '{"name": "My CLI Token"}'

# Use the token
curl http://localhost:8000/bookmarks/ \
  -H "Authorization: Bearer bm_abc123..."
```

Tokens are stored hashed. The `bm_` prefix distinguishes PATs from Auth0 JWTs.
