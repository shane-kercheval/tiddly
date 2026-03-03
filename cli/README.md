# Tiddly CLI

Go CLI tool for managing Tiddly integrations — authentication, MCP server installation, skills sync, data export, and token management.

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
  internal/
    api/                      # HTTP client
      client.go               # Auth headers, error handling, 429 retry
      users.go                # GET /users/me, /health
    auth/                     # Authentication
      device_flow.go          # OAuth device code flow
      keyring.go              # Credential storage (keyring + file fallback)
      token_manager.go        # Token resolution chain, refresh
    config/                   # Configuration
      config.go               # ~/.config/tiddly/config.yaml via Viper
    output/                   # Output formatting
      formatter.go            # text/json output
    testutil/                 # Shared test infrastructure
      mock_api.go             # httptest server builder
      mock_creds.go           # In-memory credential store
      mock_exec.go            # Exec/command mocks
      mock_tty.go             # TTY detection mock
      cmd_helper.go           # In-process Cobra command runner
      fixtures.go             # Shared response fixtures
```

### Test Patterns

Tests use dependency injection — no build tags, no real keyring or network calls in tests.

- **API tests** use `testutil.NewMockAPI(t)` to create a mock HTTP server
- **Command tests** use `testutil.ExecuteCmd(t, cmd, args...)` to run Cobra commands in-process
- **Credential tests** use `testutil.NewMockCredStore()` (in-memory)
- **Table-driven tests** are the standard pattern: one test function with a `[]struct` of cases

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

## Roadmap

See `docs/implementation_plans/2026-03-02-cli.md` for the full plan. Remaining milestones:

- **M2**: `tiddly status` + `tiddly mcp install` (auto-detect tools, create PATs, write configs)
- **M3**: `tiddly skills sync` (download/extract skills to Claude Code, Codex paths)
- **M4**: `tiddly export` (streaming JSON export of all content)
- **M5**: `tiddly tokens list/create/delete` + shell completions
- **M6**: Polish, llms.txt, GoReleaser, Homebrew, shell installer
