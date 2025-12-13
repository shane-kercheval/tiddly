# Bookmarks API

A bookmark management system with tagging and search capabilities.

## Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Docker (for PostgreSQL)

## Quick Start

```bash
make build                # Install dependencies
cp .env.example .env      # Configure environment (edit with your Auth0 credentials)
make db-up                # Start PostgreSQL
make migrate              # Create database tables
make run                  # Start API at http://localhost:8010
```

To stop: `Ctrl+C` to stop the API, then `make db-down` to stop PostgreSQL.

API docs available at: http://localhost:8010/docs

## Commands

See `Makefile` for all available commands.

## Configuration

See `.env.example` for all environment variables. Key setting:

- `DEV_MODE=true` bypasses auth for local development
- `DEV_MODE=false` requires real Auth0 JWT tokens

## Testing Authentication

With `DEV_MODE=true` (default), auth is bypassed:
```bash
curl http://localhost:8010/users/me
```

To test real Auth0 authentication:

1. Set `DEV_MODE=false` in `.env`
2. Restart the API server (`Ctrl+C`, then `make run`)
3. Get a test token from Auth0: **Applications → APIs → Bookmarks API → Test tab**
4. Test:
```bash
curl http://localhost:8010/users/me \
  -H "Authorization: Bearer <paste-token-here>"
```

## Personal Access Tokens (PATs)

PATs allow programmatic API access for CLI tools, scripts, and MCP servers without requiring Auth0 browser login.

### Creating a Token

```bash
# With DEV_MODE=true or valid Auth0 JWT
curl -X POST http://localhost:8010/tokens/ \
  -H "Authorization: Bearer <your-auth-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "My CLI Token"}'

# With optional expiration (1-365 days). Omit for non-expiring token.
curl -X POST http://localhost:8010/tokens/ \
  -H "Authorization: Bearer <your-auth-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Temp Token", "expires_in_days": 30}'
```

**Response** (save the token - it's only shown once):
```json
{
  "id": 1,
  "name": "My CLI Token",
  "token": "bm_abc123...",
  "token_prefix": "bm_abc12345",
  "expires_at": null,
  "created_at": "2025-12-13T..."
}
```

### Using a PAT

Use the `bm_*` token in the `Authorization` header:

```bash
# Access any endpoint
curl http://localhost:8010/bookmarks/ \
  -H "Authorization: Bearer bm_abc123..."

# Create a bookmark
curl -X POST http://localhost:8010/bookmarks/ \
  -H "Authorization: Bearer bm_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### Managing Tokens

```bash
# List all your tokens (metadata only, no secrets)
curl http://localhost:8010/tokens/ \
  -H "Authorization: Bearer <any-valid-token>"

# Revoke a token
curl -X DELETE http://localhost:8010/tokens/1 \
  -H "Authorization: Bearer <any-valid-token>"
```

### Token Properties

| Field | Description |
|-------|-------------|
| `name` | User-provided label (required, 1-100 chars) |
| `expires_in_days` | Optional expiration (1-365 days). Omit for non-expiring. |
| `token_prefix` | First 12 chars shown in list view for identification |
| `last_used_at` | Updated each time the token is used |

### Security Notes

- Tokens are stored as SHA-256 hashes (plaintext never stored)
- The `bm_` prefix identifies PATs vs Auth0 JWTs
- Tokens are scoped to the creating user
- Revoked/expired tokens return 401
