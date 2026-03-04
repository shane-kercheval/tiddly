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
./bin/tiddly login
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

## User Documentation

For CLI usage, commands, and configuration, see the [CLI documentation](https://tiddly.me/docs/cli).

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

