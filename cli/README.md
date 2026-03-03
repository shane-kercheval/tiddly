# Tiddly CLI

Go CLI tool for managing Tiddly integrations — authentication and MCP server installation for AI tools.

## Prerequisites

- [Go 1.21+](https://go.dev/dl/) — already installed in the dev VM
- [golangci-lint](https://golangci-lint.run/welcome/install/) — installed at `$(go env GOPATH)/bin/golangci-lint`. The Makefile uses the full path so no PATH changes needed. To install/upgrade: `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`

## Quick Start

```bash
# Build
make cli-build        # outputs bin/tiddly

# Run
./bin/tiddly --help
./bin/tiddly login --token bm_YOUR_PAT
./bin/tiddly auth status

# Test & lint
make cli-test
make cli-lint
```

## Development

### Building

```bash
cd cli
go build -o ../bin/tiddly .
```

Or from the repo root:

```bash
make cli-build
```

### Testing

```bash
cd cli
go test ./... -v              # verbose
go test ./... -count=1        # no cache
go test ./internal/auth/...   # single package
go test ./... -run TestLogin  # single test pattern
```

### Linting

```bash
cd cli
golangci-lint run ./...
```

Lint config is in `cli/.golangci.yml`. We exclude `fmt.Fprint*` and `http.ResponseWriter.Write` from errcheck since these are standard CLI/HTTP patterns where error returns are intentionally ignored.

### Project Structure

```
cli/
  main.go                     # Entry point
  cmd/                        # Cobra command definitions
    root.go                   # Global flags, dependency injection
    login.go                  # tiddly login (OAuth + PAT)
    logout.go                 # tiddly logout
    auth.go                   # tiddly auth status
    status.go                 # tiddly status (overview)
    mcp.go                    # tiddly mcp install/status/uninstall
  internal/
    api/                      # HTTP client
      client.go               # Auth headers, error handling, 429 retry (idempotent methods only)
      users.go                # GET /users/me, /health
      tokens.go               # POST/GET/DELETE /tokens/
      content.go              # GET /{content_type}/ (count)
    auth/                     # Authentication
      device_flow.go          # OAuth device code flow
      keyring.go              # Credential storage (keyring + file fallback)
      token_manager.go        # Token resolution chain, refresh
    config/                   # Configuration
      config.go               # ~/.config/tiddly/config.yaml via Viper
    mcp/                      # MCP server management
      detect.go               # AI tool detection (PATH + config dirs)
      install.go              # Install orchestration, PAT creation, dry-run
      claude_desktop.go       # Claude Desktop config (JSON, uses npx mcp-remote)
      claude_code.go          # Claude Code config (JSON, direct HTTP entries)
      codex.go                # Codex config (TOML)
    output/                   # Output formatting
      formatter.go            # text/json output
    testutil/                 # Shared test infrastructure
      mock_api.go             # httptest server builder
      mock_creds.go           # In-memory credential store
      mock_exec.go            # Mock ExecLooker for PATH detection
      cmd_helper.go           # In-process Cobra command runner
      fixtures.go             # Shared response fixtures
```

### Test Patterns

Tests use dependency injection — no build tags, no real keyring or network calls in tests.

- **API tests** use `testutil.NewMockAPI(t)` to create a mock HTTP server
- **Command tests** use `testutil.ExecuteCmd(t, cmd, args...)` to run Cobra commands in-process
- **Credential tests** use `testutil.NewMockCredStore()` (in-memory)
- **Table-driven tests** are the standard pattern: one test function with a `[]struct` of cases

## Commands

### `tiddly login`

Authenticates with the Tiddly API and stores credentials locally.

**PAT login** (`tiddly login --token bm_xxx`):
1. Trims whitespace, validates the `bm_` prefix
2. Calls `GET /users/me` to verify the token works
3. Stores the PAT in the system keyring (or file fallback)

**OAuth login** (`tiddly login`):
1. Initiates Auth0 Device Code flow — prints a URL and code for the user to visit
2. Polls Auth0 until the user authorizes
3. Stores the access token and refresh token in the keyring
4. Calls `GET /users/me` to confirm; handles 451 (consent required) gracefully

**Files written**: Keyring entries under service `tiddly-cli`, or `~/.config/tiddly/credentials` (0600) as fallback.

### `tiddly logout`

Removes all stored credentials (PAT, OAuth access token, OAuth refresh token) from the keyring or file store.

### `tiddly auth status`

Shows the current authentication method (`pat`, `oauth`, `flag`, `env`), API URL, and user email. Does not modify any files. Calls `GET /users/me` to display user info.

### `tiddly status`

Shows a full overview: CLI version, auth status, API health/latency, content counts (bookmarks, notes, prompts fetched in parallel), and MCP server status for each detected AI tool. Read-only — no files modified.

### `tiddly mcp install [tool...]`

Installs Tiddly MCP server entries into AI tool config files so they can access your bookmarks, notes, and prompts.

**Token management** (OAuth users):
- Creates one PAT per tool per MCP server (e.g., claude-code gets a separate PAT for content and a separate PAT for prompts). Tokens are not shared across tools.
- Token names follow the pattern `cli-mcp-{tool}-{server}-{6hex}` where `{server}` is `content` or `prompts` and `{6hex}` is random (e.g., `cli-mcp-claude-code-content-a1b2c3`).
- **Re-install behavior**: Reads existing PATs from the tool's config file, validates each via `GET /users/me` (200 or 451 = valid), and reuses valid tokens. Only creates new PATs when the existing one is missing or returns 401.
- `--servers content,prompts` (default: both): Install only the content server, only the prompts server, or both.

**PAT users**: The CLI cannot create new tokens via the API when authenticated with a PAT (`POST /tokens/` requires OAuth). Instead, the existing login PAT is used for both MCP servers. A warning is printed.

**Tool detection** (`DetectTools`):
- **claude-desktop**: Checks if the config directory exists (`~/Library/Application Support/Claude/` on macOS, `~/.config/Claude/` on Linux, `%APPDATA%\Claude\` on Windows). Also checks for `npx` in PATH (required for `mcp-remote`).
- **claude-code**: Checks if `claude` binary is in PATH.
- **codex**: Checks if `codex` binary is in PATH, or if `~/.codex/` config directory exists.

**Config files written per tool**:

| Tool | Config File | Format | Server Entry Format |
|------|------------|--------|-------------------|
| claude-desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) | JSON | `{"command": "npx", "args": ["mcp-remote", "<url>", "--header", "Authorization: Bearer <pat>"]}` |
| claude-code | `~/.claude.json` | JSON | `{"type": "http", "url": "<url>", "headers": {"Authorization": "Bearer <pat>"}}` |
| codex | `~/.codex/config.toml` | TOML | `[mcp_servers.<name>]` with `url` and `http_headers` |

Two MCP server entries are written into the config: `bookmarks_notes` (points to the content MCP server for bookmarks and notes) and `prompts` (points to the prompt MCP server).

All config files are written atomically (write-to-temp + rename) with mode 0600 (owner-only read/write). Directories are created with 0700. Existing config keys/servers are preserved. Malformed config files are backed up to `.bak` before overwriting.

**`--scope`** (Claude Code only — ignored for claude-desktop and codex, which have a single global config):
- `user` (default): writes to top-level `mcpServers` in `~/.claude.json`
- `local`: writes to `projects[<cwd>].mcpServers` in `~/.claude.json`
- `project`: writes to `.mcp.json` in the current working directory

A warning is printed if `--scope` is set to a non-default value with a non-Claude-Code tool.

**`--dry-run`**: Shows before/after diff of each config file without writing anything to disk. No PATs are created — the literal string `<new-token-would-be-created>` appears in the diff where a real token would go. If the tool already has PATs in its config, they are still validated via `GET /users/me` (read-only) to show whether they would be reused or replaced.

### `tiddly mcp status`

For each supported tool, shows: not detected (binary/config dir not found), detected but not configured (no `bookmarks_notes`/`prompts` entries in config), or configured (lists which server entries are present). Reads config files directly — no API calls, no subprocesses.

### `tiddly mcp uninstall <tool>`

Removes the `bookmarks_notes` and `prompts` server entries from the specified tool's config file. All other config keys are preserved.

**`--delete-tokens`** (requires OAuth auth):
1. Reads the PATs from the tool's config file *before* removing the server entries.
2. Removes the server entries from the config file.
3. Calls `GET /tokens/` to list all tokens, then deletes any token where: (a) the `token_prefix` field (first 12 chars stored by the API) matches the extracted PAT, AND (b) the token name starts with `cli-mcp-`. The name guard prevents accidentally deleting user-created tokens that happen to share a prefix.

**Without `--delete-tokens`**: After removing config entries, checks `GET /tokens/` for any tokens whose name starts with `cli-mcp-`. If found, warns the user that these tokens may be orphaned and suggests `--delete-tokens` or `tiddly tokens list`.

## Auth0 Setup (Required for OAuth)

The `tiddly login` command (without `--token`) uses the OAuth Device Code flow, which requires a Native application in Auth0.

### Steps

1. Auth0 Dashboard → Applications → Create Application → **Native**
2. Settings → Advanced → Grant Types → enable **Device Code**
3. Enable **Refresh Token Rotation** (Settings → Refresh Token Rotation → Enabled)
4. Note the **Client ID** and **Domain**

### Files to Update

Once the Auth0 app is created, update the hardcoded values in:

**`cli/internal/auth/device_flow.go`** — `DefaultAuth0Config()`:
```go
cfg := Auth0Config{
    Domain:   "auth.tiddly.me",                   // ← your Auth0 domain
    ClientID: "REPLACE_WITH_REAL_CLIENT_ID",       // ← your Client ID
    Audience: "https://api.tiddly.me",             // ← your API audience
}
```

These are not secrets — they're public values for a first-party native app (same as the frontend's Auth0 config).

### Testing Without Auth0

For local development without Auth0 configured:

- **PAT auth works immediately**: `tiddly login --token bm_xxx` validates against the API and stores the PAT
- **OAuth env overrides**: Hidden env vars let you point at a dev/staging Auth0 tenant:
  ```bash
  TIDDLY_AUTH0_DOMAIN=dev-xxx.auth0.com \
  TIDDLY_AUTH0_CLIENT_ID=your-dev-client-id \
  TIDDLY_AUTH0_AUDIENCE=https://localhost:8000 \
  tiddly login
  ```

## Configuration

Config file: `~/.config/tiddly/config.yaml` (respects `$XDG_CONFIG_HOME`)

```yaml
api_url: https://api.tiddly.me
format: text
```

**Precedence** (highest to lowest):
1. CLI flags (`--api-url`, `--format`)
2. Environment variables (`TIDDLY_API_URL`, `TIDDLY_FORMAT`)
3. Config file
4. Defaults

## Credential Storage

Credentials are stored in the system keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service) with automatic file fallback.

**File fallback** (`~/.config/tiddly/credentials`, mode 0600) is used when:
- No desktop session (DISPLAY/WAYLAND_DISPLAY unset on Linux)
- Keyring hangs (3-second timeout)
- `--keyring=file` flag is passed

## Token Resolution

When a command needs a token, the resolution order is:

1. `--token` flag
2. `TIDDLY_TOKEN` env var
3. Stored PAT (from keyring/file)
4. Stored OAuth JWT (from keyring/file) — refreshed automatically if expired

Commands that call Auth0-only endpoints (e.g., `tiddly tokens`) use `preferOAuth=true`, which swaps steps 3 and 4.
