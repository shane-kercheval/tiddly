# Tiddly

A bookmark and notes management system with tagging and search capabilities.

## Features

- **Bookmarks & Notes** - Manage both bookmarks and markdown notes in one place
- **Prompts** - Jinja2 templates with arguments, exposed via MCP for AI assistants
- **Tag-based organization** - Filter content by tags with AND/OR matching
- **Custom lists** - Create filtered views based on tag expressions
- **URL metadata extraction** - Auto-fetch title, description, and page content from URLs
- **Full-text search** - Search across title, description, URL, and content
- **Soft delete & restore** - Delete content without permanent loss
- **Archive** - Hide content without deleting them
- **Keyboard shortcuts** - Quick actions for power users
- **Personal Access Tokens** - Programmatic API access for CLI tools and scripts
- **MCP Servers** - AI agent access via Model Context Protocol (Claude, etc.)

## Project Structure

```
bookmarks/
├── ai-instructions  # Prompts containing guidelines for AI
├── backend/         # FastAPI backend
├── frontend/        # React frontend
├── docs/            # Contains implementation plans for AI coding agents
├── .env.example     # Environment configuration
└── Makefile         # Development commands
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
make docker-up      # Start PostgreSQL
make migrate        # Run database migrations

# Run backend
make api-run        # API at http://localhost:8000/docs

# Run frontend (separate terminal)
cd frontend && npm install && npm run dev
# Frontend at http://localhost:5173
```

With default `VITE_DEV_MODE=true`, authentication is bypassed for local development.

### Testing with Auth0

To test real authentication:

1. **Set up Auth0** ([auth0.com](https://auth0.com)):
   - Create an account and tenant
   - Create an API (identifier/audience: `https://bookmarks-api`)
   - Create a Single Page Application (note the Client ID)

2. **Configure `.env`**:
   ```bash
   VITE_DEV_MODE=false
   VITE_AUTH0_DOMAIN=your-tenant.auth0.com
   VITE_AUTH0_CLIENT_ID=your-spa-client-id
   VITE_AUTH0_AUDIENCE=https://bookmarks-api
   ```

3. **Test backend** (get a test token from Auth0 Dashboard → APIs → Test tab):
   ```bash
   curl http://localhost:8000/users/me \
     -H "Authorization: Bearer <paste-token-here>"
   ```

4. **Test frontend**: Visit http://localhost:5173 and click "Get Started" to log in.

## Configuration

See `.env.example` for all options. Key settings:

- `VITE_DEV_MODE=true` - Bypasses auth (local dev)
- `VITE_AUTH0_*` - Auth0 config (used by both backend and frontend, empty = dev mode)

## Commands

See `Makefile` for all commands. Run `make` with no args to see help.

## Testing

```bash
make tests          # Run backend linting + tests
make frontend-tests # Run frontend tests
```

## Evaluations

LLM-based evaluations verify that AI agents can correctly use the MCP tools:

```bash
make evals              # Run all evaluations
make evals-content-mcp  # Run Content MCP evals only
```

Evals use the [flex-evals](https://github.com/shane-kercheval/flex-evals) framework with test cases defined in YAML. See [evals/README.md](evals/README.md) for setup and configuration.

## API Documentation

With the backend running: http://localhost:8000/docs

## Personal Access Tokens

PATs allow programmatic API access for CLI tools and scripts.

```bash
# Create a token (with VITE_DEV_MODE=true, no auth header needed)
curl -X POST http://localhost:8000/tokens/ \
  -H "Content-Type: application/json" \
  -d '{"name": "My CLI Token"}'

# Use the token
curl http://localhost:8000/bookmarks/ \
  -H "Authorization: Bearer bm_abc123..."
```

Tokens are stored hashed. The `bm_` prefix distinguishes PATs from Auth0 JWTs.

## MCP Servers (AI Agent Access)

Two MCP (Model Context Protocol) servers allow AI agents like Claude to interact with your content:

| Server | Port | Purpose |
|--------|------|---------|
| Content MCP | 8001 | Tools for bookmarks and notes |
| Prompt MCP | 8002 | Prompts capability + create_prompt tool |

### Running the MCP Servers

```bash
# Requires the main API to be running on port 8000
make content-mcp-server   # Content MCP server (port 8001)
make prompt-mcp-server    # Prompt MCP server (port 8002)
```

### Content MCP Server Tools

| Tool | Description |
|------|-------------|
| `search_items` | Search bookmarks and notes with text query and tag filtering |
| `get_item` | Get bookmark or note by ID with optional partial read (line range) |
| `edit_content` | Edit bookmark or note content using string replacement |
| `search_in_content` | Search within a single item's content for matches with context |
| `update_item_metadata` | Update metadata (title, description, tags) |
| `create_bookmark` | Create a new bookmark |
| `create_note` | Create a new note |
| `list_tags` | List all tags with usage counts |

### Prompt MCP Server Tools

| Tool | Description |
|------|-------------|
| `search_prompts` | Search prompts with text query and tag filtering |
| `get_prompt_template` | Get raw template content for viewing/editing |
| `get_prompt_metadata` | Get metadata without full content |
| `list_tags` | List all tags with usage counts |
| `create_prompt` | Create a new prompt template |
| `edit_prompt_template` | Edit content using string replacement |
| `update_prompt_metadata` | Update title, description, tags |

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:8000` | Backend API URL |
| `MCP_PORT` | `8001` | Content MCP port (falls back to `PORT` for PaaS) |
| `PROMPT_MCP_PORT` | `8002` | Prompt MCP port (falls back to `PORT` for PaaS) |

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector

# Content MCP: http://localhost:8001/mcp
# Prompt MCP: http://localhost:8002/mcp
# Add header: Authorization: `Bearer bm_your_token_here`
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "content": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8001/mcp",
        "--header",
        "Authorization: Bearer bm_your_token_here"
      ]
    },
    "prompts": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8002/mcp",
        "--header",
        "Authorization: Bearer bm_your_token_here"
      ]
    }
  }
}
```

Replace `bm_your_token_here` with a Personal Access Token created via the API.

## Deployment

See [README_DEPLOY.md](README_DEPLOY.md) for full deployment instructions including:

## Security

### SSRF Protection

The `/bookmarks/fetch-metadata` endpoint fetches URLs provided by users. To prevent Server-Side Request Forgery (SSRF) attacks, all URLs are validated before fetching:

- **Blocked:** Private IPs (`10.x.x.x`, `192.168.x.x`, `172.16-31.x.x`), loopback (`127.0.0.1`, `::1`), link-local (`169.254.x.x`), and `localhost`
- **DNS resolution check:** Hostnames are resolved to verify they don't point to internal IPs
- **Redirect protection:** Final URLs after redirects are also validated

This prevents attackers from using your server to probe internal networks or cloud metadata endpoints.

**Location:** `backend/src/services/url_scraper.py`

### Rate Limiting

The `/bookmarks/fetch-metadata` endpoint is rate-limited to prevent abuse:

| Setting | Default | Description |
|---------|---------|-------------|
| `max_requests` | 15 | Requests allowed per window |
| `window_seconds` | 60 | Sliding window duration |

Rate limiting is per authenticated user. When exceeded, returns HTTP 429 with `Retry-After` header.

**Location:** `backend/src/core/rate_limiter.py`

To adjust limits, modify the `fetch_metadata_limiter` instance:

```python
fetch_metadata_limiter = RateLimiter(max_requests=15, window_seconds=60)
```

### Field Length Limits

Field length limits are configured via environment variables (shared between frontend and backend):

| Field | Env Variable | Default | Notes |
|-------|--------------|---------|-------|
| Bookmark Content | `VITE_MAX_CONTENT_LENGTH` | 512,000 | ~500KB, sufficient for articles |
| Note Content | `VITE_MAX_NOTE_CONTENT_LENGTH` | 500,000 | ~500KB for markdown notes |
| Description | `VITE_MAX_DESCRIPTION_LENGTH` | 2,000 | Brief summary |
| Title | `VITE_MAX_TITLE_LENGTH` | 500 | Matches DB constraint |

Content exceeding these limits will be rejected with a validation error.

# Limitations and Future Improvements

- **No automatic trash deletion:** Trashed bookmarks are kept indefinitely until manually deleted. Future versions will automatically permanently delete items after 30 days in trash.
- **No account deletion:** Users cannot delete their own accounts through the UI. This requires manual database operations. A self-service account deletion feature is planned.
- **Limited data export:** Users can export bookmarks programmatically via the API with a Personal Access Token, but there's no UI-based bulk export feature. A one-click export (JSON/CSV) is planned for GDPR compliance.
- **In-memory Rate Limiting:** Current rate limiting uses in-memory storage, which won't work across multiple instances. Future versions could use Redis or a distributed cache.
- **Security Audit Logging:** No structured logging for security events (auth failures, IDOR attempts, token operations). Consider adding if monitoring infrastructure is in place.

## Updating Privacy Policy or Terms of Service

When updating PRIVACY.md or TERMS.md:

1. Update the policy document
2. Update "Last Updated" date in the policy file
3. Update version constants in `backend/src/core/policy_versions.py`:
   ```python
   PRIVACY_POLICY_VERSION = "YYYY-MM-DD"  # New date
   TERMS_OF_SERVICE_VERSION = "YYYY-MM-DD"  # New date
   ```
4. Deploy changes
5. All users will see consent dialog again on next login (version mismatch requires re-consent)

The backend is the single source of truth for policy versions. The frontend fetches current versions from the `/consent/status` endpoint.
