package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunInstall__oauth_creates_pats_with_unique_names(t *testing.T) {
	var createdNames []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && r.URL.Path == "/tokens/":
			var req api.TokenCreateRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			createdNames = append(createdNames, req.Name)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(api.TokenCreateResponse{
				ID:    "tok-new",
				Name:  req.Name,
				Token: "bm_created_" + req.Name,
			})
		case r.Method == "GET" && r.URL.Path == "/users/me":
			// No existing config means no existing PAT → validatePAT won't be called
			w.WriteHeader(404)
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "oauth",
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Len(t, createdNames, 2, "should create 2 PATs")

	// Token names should match the pattern cli-mcp-{tool}-{server}-{6hex}
	namePattern := regexp.MustCompile(`^cli-mcp-claude-desktop-(content|prompts)-[0-9a-f]{6}$`)
	for _, name := range createdNames {
		assert.Regexp(t, namePattern, name)
	}

	assert.Len(t, result.TokensCreated, 2)
	assert.Contains(t, result.ToolsConfigured, "claude-desktop")
}

func TestRunInstall__oauth_reuses_valid_existing_pat(t *testing.T) {
	var tokenCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && r.URL.Path == "/users/me":
			// Validate existing PAT — return 200 (valid)
			_ = json.NewEncoder(w).Encode(api.UserInfo{ID: "user-1", Email: "test@test.com"})
		case r.Method == "POST" && r.URL.Path == "/tokens/":
			tokenCalls++
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(api.TokenCreateResponse{
				ID:    "tok-new",
				Token: "bm_new_token",
			})
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// Write existing config with valid PATs
	existingConfig := map[string]any{
		"mcpServers": map[string]any{
			"tiddly_notes_bookmarks": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://content-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_existing_content"},
			},
			"tiddly_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://prompts-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_existing_prompt"},
			},
		},
	}
	writeTestJSON(t, configPath, existingConfig)

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "oauth",
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Equal(t, 0, tokenCalls, "should NOT create new tokens when existing PATs are valid")
	assert.Len(t, result.TokensReused, 2)
	assert.Empty(t, result.TokensCreated)
}

func TestRunInstall__oauth_creates_new_pat_when_existing_invalid(t *testing.T) {
	var tokenCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && r.URL.Path == "/users/me":
			// Reject the existing PAT (401)
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"detail": "Invalid token"})
		case r.Method == "POST" && r.URL.Path == "/tokens/":
			tokenCalls++
			var req api.TokenCreateRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(api.TokenCreateResponse{
				ID:    "tok-new",
				Name:  req.Name,
				Token: "bm_new_" + req.Name,
			})
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// Write existing config with invalid PATs
	existingConfig := map[string]any{
		"mcpServers": map[string]any{
			"tiddly_notes_bookmarks": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://content-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_expired_content"},
			},
			"tiddly_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://prompts-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_expired_prompt"},
			},
		},
	}
	writeTestJSON(t, configPath, existingConfig)

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "oauth",
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Equal(t, 2, tokenCalls, "should create 2 new PATs when existing are invalid")
	assert.Len(t, result.TokensCreated, 2)
	assert.Empty(t, result.TokensReused)
}

func TestRunInstall__pat_reuses_token(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// No API calls needed for PAT auth (no token creation)
	client := api.NewClient("http://unused", "bm_existing", "pat")
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:    client,
		AuthType:  "pat",
		Output:    stdout,
		ErrOutput: stderr,
	}, tools)

	require.NoError(t, err)
	assert.Empty(t, result.TokensCreated, "should not create tokens")
	assert.Contains(t, result.Warnings[0], "current token")

	// Verify the config was written with the existing PAT
	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	args := toStringSlice(content["args"])
	assert.Contains(t, args[3], "bm_existing")
}

func TestRunInstall__dry_run_no_token_creation(t *testing.T) {
	var tokenCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && r.URL.Path == "/tokens/":
			tokenCalls++
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(api.TokenCreateResponse{Token: "bm_new"})
		case r.Method == "GET" && r.URL.Path == "/users/me":
			w.WriteHeader(http.StatusUnauthorized)
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "oauth",
		DryRun:   true,
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Equal(t, 0, tokenCalls, "dry-run should NOT create tokens")
	assert.Contains(t, result.ToolsConfigured, "claude-desktop")

	// Output should contain placeholder (JSON-escaped angle brackets)
	assert.Contains(t, stdout.String(), "new-token-would-be-created")

	// File should NOT exist
	_, err = os.Stat(configPath)
	assert.True(t, os.IsNotExist(err), "config file should not be created in dry-run")
}

func TestRunInstall__dry_run_pat_auth_shows_diff(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Installed: true, ConfigPath: configPath},
	}

	_, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		DryRun:   true,
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Contains(t, stdout.String(), "tiddly_notes_bookmarks")
	assert.Contains(t, stdout.String(), "bm_test")

	// File should NOT exist (dry run)
	_, statErr := os.Stat(configPath)
	assert.True(t, os.IsNotExist(statErr), "config file should not be created in dry-run")
}

func TestRunInstall__servers_content_only(t *testing.T) {
	var createdNames []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && r.URL.Path == "/tokens/":
			var req api.TokenCreateRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			createdNames = append(createdNames, req.Name)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(api.TokenCreateResponse{
				ID:    "tok-new",
				Name:  req.Name,
				Token: "bm_created_" + req.Name,
			})
		case r.Method == "GET" && r.URL.Path == "/users/me":
			w.WriteHeader(404)
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "oauth",
		Servers:  []string{"content"},
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Len(t, createdNames, 1, "should only create 1 PAT")
	assert.Contains(t, createdNames[0], "content")
	assert.Len(t, result.TokensCreated, 1)

	// Config should only have content server
	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, "tiddly_notes_bookmarks")
	assert.NotContains(t, servers, "tiddly_prompts")
}

func TestRunInstall__servers_prompts_only(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		Servers:  []string{"prompts"},
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Contains(t, result.ToolsConfigured, "claude-desktop")

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.NotContains(t, servers, "tiddly_notes_bookmarks")
	assert.Contains(t, servers, "tiddly_prompts")
}

func TestRunInstall__skips_uninstalled_tools(t *testing.T) {
	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: false},
		{Name: "claude-code", Installed: false},
	}

	result, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Empty(t, result.ToolsConfigured)
}

func TestRunInstall__malformed_config_returns_parse_error(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")
	require.NoError(t, os.WriteFile(configPath, []byte("not json{"), 0644))

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: true, ConfigPath: configPath, HasNpx: true},
	}

	_, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:    client,
		AuthType:  "pat",
		Output:    stdout,
		ErrOutput: stderr,
	}, tools)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "parsing")

	// Original file should be untouched
	data, readErr := os.ReadFile(configPath)
	require.NoError(t, readErr)
	assert.Equal(t, "not json{", string(data))
}

func TestRunInstall__unsupported_scope_returns_error(t *testing.T) {
	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "codex", Installed: true},
	}

	_, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		Scope:    "local",
		Output:   stdout,
	}, tools)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "not supported by codex")
}

func TestCheckOrphanedTokens__finds_mcp_tokens_for_tool(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-1", Name: "cli-mcp-claude-code-content-a1b2c3"},
			{ID: "tok-2", Name: "cli-mcp-claude-code-prompts-d4e5f6"},
			{ID: "tok-3", Name: "cli-mcp-codex-content-x1y2z3"},
			{ID: "tok-4", Name: "other-token"},
		})
	}))
	defer server.Close()

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")

	// Should only return claude-code tokens
	orphaned, err := CheckOrphanedTokens(context.Background(), client, "claude-code")
	require.NoError(t, err)
	assert.Len(t, orphaned, 2)
	assert.Contains(t, orphaned[0], "cli-mcp-claude-code-")
	assert.Contains(t, orphaned[1], "cli-mcp-claude-code-")

	// Should only return codex tokens
	orphaned, err = CheckOrphanedTokens(context.Background(), client, "codex")
	require.NoError(t, err)
	assert.Len(t, orphaned, 1)
	assert.Contains(t, orphaned[0], "cli-mcp-codex-")
}

func TestCheckOrphanedTokens__no_orphans(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-1", Name: "other-token"},
			{ID: "tok-2", Name: "cli-mcp-codex-content-a1b2c3"},
		})
	}))
	defer server.Close()

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")
	orphaned, err := CheckOrphanedTokens(context.Background(), client, "claude-code")

	require.NoError(t, err)
	assert.Nil(t, orphaned)
}

func TestGenerateTokenName__format(t *testing.T) {
	name := generateTokenName("claude-code", "content")
	assert.Regexp(t, `^cli-mcp-claude-code-content-[0-9a-f]{6}$`, name)
}

func TestGenerateTokenName__unique(t *testing.T) {
	name1 := generateTokenName("claude-code", "content")
	name2 := generateTokenName("claude-code", "content")
	assert.NotEqual(t, name1, name2, "names should be unique due to random suffix")
}

func TestValidatePAT__valid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(api.UserInfo{ID: "user-1"})
	}))
	defer server.Close()

	valid, err := validatePAT(context.Background(), server.URL, "bm_valid")
	require.NoError(t, err)
	assert.True(t, valid)
}

func TestValidatePAT__consent_needed_still_valid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(451)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error":       "consent_required",
			"consent_url": "https://tiddly.me/terms",
		})
	}))
	defer server.Close()

	valid, err := validatePAT(context.Background(), server.URL, "bm_consent")
	require.NoError(t, err)
	assert.True(t, valid)
}

func TestValidatePAT__invalid_401(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	valid, err := validatePAT(context.Background(), server.URL, "bm_expired")
	require.NoError(t, err)
	assert.False(t, valid)
}

func TestValidatePAT__server_error_returns_error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	valid, err := validatePAT(context.Background(), server.URL, "bm_test")
	assert.False(t, valid)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "validating token")
}

func TestValidatePAT__network_error_returns_error(t *testing.T) {
	// Use a URL that will fail to connect
	valid, err := validatePAT(context.Background(), "http://127.0.0.1:1", "bm_test")
	assert.False(t, valid)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "validating token")
}

func TestDeleteTokensByPrefix__matches_and_deletes(t *testing.T) {
	var deletedIDs []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && r.URL.Path == "/tokens/":
			// token_prefix is the first 12 chars of the PAT (bm_ + 9 chars)
			_ = json.NewEncoder(w).Encode([]api.TokenInfo{
				{ID: "tok-1", Name: "cli-mcp-claude-code-content-a1b2c3", TokenPrefix: "bm_abcdefghi"},
				{ID: "tok-2", Name: "cli-mcp-claude-code-prompts-d4e5f6", TokenPrefix: "bm_123456789"},
				{ID: "tok-3", Name: "other-token", TokenPrefix: "bm_xxxxxxxxx"},
			})
		case r.Method == "DELETE" && strings.HasPrefix(r.URL.Path, "/tokens/"):
			tokenID := strings.TrimPrefix(r.URL.Path, "/tokens/")
			deletedIDs = append(deletedIDs, tokenID)
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")

	// PATs whose first 12 chars match the token_prefix
	pats := []string{"bm_abcdefghijklmnop", "bm_123456789jklmnop"}
	deleted, err := DeleteTokensByPrefix(context.Background(), client, pats)

	require.NoError(t, err)
	assert.Contains(t, deletedIDs, "tok-1")
	assert.Contains(t, deletedIDs, "tok-2")
	assert.NotContains(t, deletedIDs, "tok-3")
	assert.Len(t, deleted, 2)
}

func TestDeleteTokensByPrefix__partial_failure_returns_deleted_and_error(t *testing.T) {
	var deletedIDs []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && r.URL.Path == "/tokens/":
			_ = json.NewEncoder(w).Encode([]api.TokenInfo{
				{ID: "tok-1", Name: "cli-mcp-claude-code-content-a1b2c3", TokenPrefix: "bm_abcdefghi"},
				{ID: "tok-2", Name: "cli-mcp-claude-code-prompts-d4e5f6", TokenPrefix: "bm_123456789"},
			})
		case r.Method == "DELETE" && r.URL.Path == "/tokens/tok-1":
			deletedIDs = append(deletedIDs, "tok-1")
			w.WriteHeader(http.StatusNoContent)
		case r.Method == "DELETE" && r.URL.Path == "/tokens/tok-2":
			// Simulate failure for second token
			w.WriteHeader(http.StatusInternalServerError)
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")

	pats := []string{"bm_abcdefghijklmnop", "bm_123456789jklmnop"}
	deleted, err := DeleteTokensByPrefix(context.Background(), client, pats)

	// Should return both the successfully deleted token AND the error
	assert.Len(t, deleted, 1)
	assert.Contains(t, deleted, "cli-mcp-claude-code-content-a1b2c3")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cli-mcp-claude-code-prompts-d4e5f6")
}

func TestExtractPATs__claude_desktop_handler(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	config := map[string]any{
		"mcpServers": map[string]any{
			"tiddly_notes_bookmarks": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://content-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_content123"},
			},
			"tiddly_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://prompts-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_prompt456"},
			},
		},
	}
	writeTestJSON(t, configPath, config)

	h := &ClaudeDesktopHandler{}
	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	contentPAT, promptPAT := h.ExtractPATs(rc)
	assert.Equal(t, "bm_content123", contentPAT)
	assert.Equal(t, "bm_prompt456", promptPAT)
}

func TestExtractPATs__missing_config(t *testing.T) {
	h := &ClaudeDesktopHandler{}
	rc := ResolvedConfig{Path: "/nonexistent/path.json", Scope: "user"}
	contentPAT, promptPAT := h.ExtractPATs(rc)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestInstallTool__claude_code_project_scope_malformed_returns_error(t *testing.T) {
	cwd := t.TempDir()
	mcpPath := filepath.Join(cwd, ".mcp.json")

	// Write malformed .mcp.json
	require.NoError(t, os.WriteFile(mcpPath, []byte("not json{"), 0644))

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Installed: true, ConfigPath: ""},
	}

	_, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:    client,
		AuthType:  "pat",
		Scope:     "project",
		Cwd:       cwd,
		Output:    stdout,
		ErrOutput: stderr,
	}, tools)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "parsing")

	// Original malformed file should be untouched
	data, readErr := os.ReadFile(mcpPath)
	require.NoError(t, readErr)
	assert.Equal(t, "not json{", string(data))
}

func TestDryRunTool__claude_code_project_scope_shows_correct_path(t *testing.T) {
	// Regression: dryRunTool claude-code case showed tool.ResolvedConfigPath()
	// in diff output instead of the resolved project path.
	cwd := t.TempDir()
	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Installed: true, ConfigPath: ""},
	}

	_, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		DryRun:   true,
		Scope:    "project",
		Cwd:      cwd,
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	output := stdout.String()
	// Should show the .mcp.json path, not ~/.claude.json
	assert.Contains(t, output, filepath.Join(cwd, ".mcp.json"))
}

func TestRunInstall__valid_config_creates_backup_before_writing(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// Write a valid existing config
	existingConfig := map[string]any{"existingKey": "existingValue"}
	writeTestJSON(t, configPath, existingConfig)

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Contains(t, result.ToolsConfigured, "claude-desktop")

	// Backup should exist with the original content
	backupData, backupErr := os.ReadFile(configPath + ".bak")
	require.NoError(t, backupErr, "backup file should exist")
	assert.Contains(t, string(backupData), "existingKey")

	// New config should have our servers
	newData, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.Contains(t, string(newData), "tiddly_notes_bookmarks")
}

func TestRunUninstall__valid_config_creates_backup_before_writing(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// Write a valid existing config with tiddly servers
	existingConfig := map[string]any{
		"mcpServers": map[string]any{
			"tiddly_notes_bookmarks": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://content-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_test"},
			},
		},
	}
	writeTestJSON(t, configPath, existingConfig)

	h := &ClaudeDesktopHandler{}
	err := h.Uninstall(ResolvedConfig{Path: configPath, Scope: "user"})
	require.NoError(t, err)

	// Backup should exist with the original content (including the tiddly server)
	backupData, backupErr := os.ReadFile(configPath + ".bak")
	require.NoError(t, backupErr, "backup file should exist")
	assert.Contains(t, string(backupData), "tiddly_notes_bookmarks")
}

func TestRunInstall__no_existing_file_does_not_create_backup(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunInstall(InstallOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Contains(t, result.ToolsConfigured, "claude-desktop")

	// No backup should exist since there was no original file
	_, statErr := os.Stat(configPath + ".bak")
	assert.True(t, os.IsNotExist(statErr), "backup should not be created when no original file exists")

	// Config should have been created
	newData, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.Contains(t, string(newData), "tiddly_notes_bookmarks")
}
