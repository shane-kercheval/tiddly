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
	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunConfigure__oauth_creates_pats_with_unique_names(t *testing.T) {
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
		{Name: "claude-desktop", Detected: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunConfigure(ConfigureOpts{
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

func TestRunConfigure__oauth_reuses_valid_existing_pat(t *testing.T) {
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
		{Name: "claude-desktop", Detected: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunConfigure(ConfigureOpts{
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

func TestRunConfigure__oauth_creates_new_pat_when_existing_invalid(t *testing.T) {
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
		{Name: "claude-desktop", Detected: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunConfigure(ConfigureOpts{
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

func TestRunConfigure__pat_reuses_token(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// No API calls needed for PAT auth (no token creation)
	client := api.NewClient("http://unused", "bm_existing", "pat")
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Detected: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunConfigure(ConfigureOpts{
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

func TestRunConfigure__dry_run_no_token_creation(t *testing.T) {
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
		{Name: "claude-desktop", Detected: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunConfigure(ConfigureOpts{
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

func TestRunConfigure__dry_run_skips_pat_validation(t *testing.T) {
	// Dry-run should not make any network calls — not even PAT validation.
	// Use a server that fails on any request to prove this.
	var apiCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiCalls++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	result, err := RunConfigure(ConfigureOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "oauth",
		DryRun:   true,
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Equal(t, 0, apiCalls, "dry-run should not make any API calls")
	assert.Contains(t, result.ToolsConfigured, "claude-code")
	assert.Contains(t, stdout.String(), "new-token-would-be-created")
}

func TestRunConfigure__dry_run_pat_auth_shows_diff(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err := RunConfigure(ConfigureOpts{
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

func TestRunConfigure__servers_content_only(t *testing.T) {
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
		{Name: "claude-desktop", Detected: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunConfigure(ConfigureOpts{
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

func TestRunConfigure__servers_prompts_only(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Detected: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunConfigure(ConfigureOpts{
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

func TestRunConfigure__servers_content_only_preserves_existing_prompts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Pre-configure both servers
	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_old_content", "bm_old_prompts")
	require.NoError(t, err)

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err = RunConfigure(ConfigureOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		Servers:  []string{"content"},
		Output:   stdout,
	}, tools)

	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	// Content should be updated with the new PAT
	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	headers := content["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_test", headers["Authorization"])

	// Prompts should be preserved from the original configure
	assert.Contains(t, servers, "tiddly_prompts", "prompts server should be preserved when --servers content")
	prompts := servers["tiddly_prompts"].(map[string]any)
	promptHeaders := prompts["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_old_prompts", promptHeaders["Authorization"])
}

func TestRunConfigure__servers_prompts_only_preserves_existing_content(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Pre-configure both servers
	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_old_content", "bm_old_prompts")
	require.NoError(t, err)

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err = RunConfigure(ConfigureOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		Servers:  []string{"prompts"},
		Output:   stdout,
	}, tools)

	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	// Content should be preserved from the original configure
	assert.Contains(t, servers, "tiddly_notes_bookmarks", "content server should be preserved when --servers prompts")
	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	headers := content["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_old_content", headers["Authorization"])

	// Prompts should be updated with the new PAT
	prompts := servers["tiddly_prompts"].(map[string]any)
	promptHeaders := prompts["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_test", promptHeaders["Authorization"])
}

func TestRunConfigure__skips_undetected_tools(t *testing.T) {
	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Detected: false},
		{Name: "claude-code", Detected: false},
	}

	result, err := RunConfigure(ConfigureOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Empty(t, result.ToolsConfigured)
}

func TestRunConfigure__malformed_config_returns_parse_error(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")
	require.NoError(t, os.WriteFile(configPath, []byte("not json{"), 0644))

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Detected: true, ConfigPath: configPath, HasNpx: true},
	}

	_, err := RunConfigure(ConfigureOpts{
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

func TestRunConfigure__unsupported_scope_returns_error(t *testing.T) {
	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "codex", Detected: true},
	}

	_, err := RunConfigure(ConfigureOpts{
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

	// Should only return claude-code tokens (both server types)
	orphaned, err := CheckOrphanedTokens(context.Background(), client, "claude-code", []string{"content", "prompts"})
	require.NoError(t, err)
	assert.Len(t, orphaned, 2)
	assert.Contains(t, orphaned[0], "cli-mcp-claude-code-")
	assert.Contains(t, orphaned[1], "cli-mcp-claude-code-")

	// Should only return codex tokens
	orphaned, err = CheckOrphanedTokens(context.Background(), client, "codex", []string{"content", "prompts"})
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
	orphaned, err := CheckOrphanedTokens(context.Background(), client, "claude-code", []string{"content", "prompts"})

	require.NoError(t, err)
	assert.Nil(t, orphaned)
}

func TestCheckOrphanedTokens__filters_by_server_type(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-1", Name: "cli-mcp-claude-code-content-a1b2c3"},
			{ID: "tok-2", Name: "cli-mcp-claude-code-prompts-d4e5f6"},
		})
	}))
	defer server.Close()

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")

	// Content only — should only find content token
	orphaned, err := CheckOrphanedTokens(context.Background(), client, "claude-code", []string{"content"})
	require.NoError(t, err)
	require.Len(t, orphaned, 1)
	assert.Contains(t, orphaned[0], "content")

	// Prompts only — should only find prompts token
	orphaned, err = CheckOrphanedTokens(context.Background(), client, "claude-code", []string{"prompts"})
	require.NoError(t, err)
	require.Len(t, orphaned, 1)
	assert.Contains(t, orphaned[0], "prompts")
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

func TestTiddlyURLMatcher__both_pats(t *testing.T) {
	match := tiddlyURLMatcher("bm_content", "bm_prompts")
	assert.True(t, match(ContentMCPURL()))
	assert.True(t, match(PromptMCPURL()))
	assert.False(t, match("https://other.example.com/mcp"))
}

func TestTiddlyURLMatcher__content_only(t *testing.T) {
	match := tiddlyURLMatcher("bm_content", "")
	assert.True(t, match(ContentMCPURL()))
	assert.False(t, match(PromptMCPURL()))
}

func TestTiddlyURLMatcher__prompts_only(t *testing.T) {
	match := tiddlyURLMatcher("", "bm_prompts")
	assert.False(t, match(ContentMCPURL()))
	assert.True(t, match(PromptMCPURL()))
}

func TestTiddlyURLMatcher__neither_pat_matches_nothing(t *testing.T) {
	match := tiddlyURLMatcher("", "")
	assert.False(t, match(ContentMCPURL()))
	assert.False(t, match(PromptMCPURL()))
	assert.False(t, match("https://other.example.com/mcp"))
}

func TestConfigureClaudeCode__both_pats_empty_preserves_existing(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Configure both servers first
	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Call with both PATs empty — should be a no-op for existing servers
	_, err = configureClaudeCode(rc, "", "")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, "tiddly_notes_bookmarks", "content should be preserved")
	assert.Contains(t, servers, "tiddly_prompts", "prompts should be preserved")
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

func TestConfigureTool__claude_code_project_scope_malformed_returns_error(t *testing.T) {
	cwd := t.TempDir()
	mcpPath := filepath.Join(cwd, ".mcp.json")

	// Write malformed .mcp.json
	require.NoError(t, os.WriteFile(mcpPath, []byte("not json{"), 0644))

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: ""},
	}

	_, err := RunConfigure(ConfigureOpts{
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

func TestDryRunConfigure__claude_code_project_scope_shows_correct_path(t *testing.T) {
	// Regression: dryRunTool claude-code case showed tool.ResolvedConfigPath()
	// in diff output instead of the resolved project path.
	cwd := t.TempDir()
	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: ""},
	}

	_, err := RunConfigure(ConfigureOpts{
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

func TestRunConfigure__valid_config_creates_backup_before_writing(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// Write a valid existing config
	existingConfig := map[string]any{"existingKey": "existingValue"}
	writeTestJSON(t, configPath, existingConfig)

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Detected: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunConfigure(ConfigureOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Contains(t, result.ToolsConfigured, "claude-desktop")

	// Backup path should be surfaced in the result.
	require.Len(t, result.Backups, 1)
	assert.Equal(t, "claude-desktop", result.Backups[0].Tool)
	assert.True(t, strings.HasPrefix(result.Backups[0].Path, configPath+".bak."),
		"backup path should be <original>.bak.<timestamp>; got %q", result.Backups[0].Path)

	// Backup file should exist with the original content
	backupMatches, _ := filepath.Glob(configPath + ".bak.*")
	require.Len(t, backupMatches, 1, "exactly one timestamped backup should exist")
	backupData, backupErr := os.ReadFile(backupMatches[0])
	require.NoError(t, backupErr, "backup file should exist")
	assert.Contains(t, string(backupData), "existingKey")

	// New config should have our servers
	newData, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.Contains(t, string(newData), "tiddly_notes_bookmarks")
}

func TestRunConfigure__dry_run_warns_about_multi_entry_consolidation(t *testing.T) {
	// Simulate a user who manually set up work_prompts + personal_prompts for
	// two tiddly accounts. A dry-run configure should warn that both will be
	// consolidated into a single canonical entry, so the user understands
	// what's at stake before proceeding.
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"work_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_work",
				},
			},
			"personal_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_personal",
				},
			},
		},
	})

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err := RunConfigure(ConfigureOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		DryRun:   true,
		Output:   stdout,
	}, tools)

	require.NoError(t, err)

	out := stdout.String()
	assert.Contains(t, out, "claude-code:")
	assert.Contains(t, out, "prompts entries will be consolidated into tiddly_prompts")
	assert.Contains(t, out, "work_prompts")
	assert.Contains(t, out, "personal_prompts")
	// PAT auth rebinds all entries to the current login; the message
	// reflects that instead of claiming a specific entry's PAT "survives".
	assert.Contains(t, out, "current logged-in account")
}

func TestRunConfigure__dry_run_no_warning_when_single_entries(t *testing.T) {
	// Canonical single-entry setup — dry-run should NOT emit the consolidation
	// warning because nothing will be lost.
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	client := api.NewClient("http://unused", "bm_new", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err = RunConfigure(ConfigureOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		DryRun:   true,
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.NotContains(t, stdout.String(), "will be consolidated",
		"no consolidation warning should appear for canonical single-entry configs")
}

func TestRunConfigure__dry_run_servers_flag_scopes_warning(t *testing.T) {
	// Multi-entry on prompts, but user passes --servers content. The
	// consolidation only affects the prompts type, which is NOT being
	// configured, so no warning should appear.
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"tiddly_notes_bookmarks": map[string]any{
				"type": "http",
				"url":  ContentMCPURL(),
			},
			"work_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
			},
			"personal_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
			},
		},
	})

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err := RunConfigure(ConfigureOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		DryRun:   true,
		Servers:  []string{"content"},
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.NotContains(t, stdout.String(), "will be consolidated",
		"--servers content should not warn about prompts-only multi-entry")
}

// multiPromptsConfig writes a .claude.json with two custom-named prompt
// entries (work + personal) against the same tiddly URL. Used by the
// consolidation-prompt tests.
func multiPromptsConfig(t *testing.T, configPath string) {
	t.Helper()
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"work_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_work",
				},
			},
			"personal_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_personal",
				},
			},
		},
	})
}

func TestRunConfigure__consolidation_prompt_proceeds_on_yes(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	multiPromptsConfig(t, configPath)

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err := RunConfigure(ConfigureOpts{
		Handlers:      DefaultHandlers(),
		Client:        client,
		AuthType:      "pat",
		Output:        stdout,
		Stdin:         strings.NewReader("y\n"),
		IsInteractive: func() bool { return true },
	}, tools)
	require.NoError(t, err)

	out := stdout.String()
	assert.Contains(t, out, "will be consolidated", "warning should appear")
	assert.Contains(t, out, "Continue? [y/N]", "prompt should appear")

	// Post-consolidation: single canonical prompt entry remains.
	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, "tiddly_prompts")
	assert.NotContains(t, servers, "work_prompts", "custom name should be wiped")
	assert.NotContains(t, servers, "personal_prompts", "custom name should be wiped")
}

func TestRunConfigure__consolidation_prompt_aborts_on_no(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	multiPromptsConfig(t, configPath)

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err := RunConfigure(ConfigureOpts{
		Handlers:      DefaultHandlers(),
		Client:        client,
		AuthType:      "pat",
		Output:        stdout,
		Stdin:         strings.NewReader("n\n"),
		IsInteractive: func() bool { return true },
	}, tools)
	require.ErrorIs(t, err, ErrConsolidationDeclined)

	// Declining must leave the config untouched — both entries survive.
	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, "work_prompts", "work entry should be preserved on decline")
	assert.Contains(t, servers, "personal_prompts", "personal entry should be preserved on decline")
	assert.NotContains(t, servers, "tiddly_prompts", "no canonical entry should be written on decline")
}

func TestRunConfigure__consolidation_non_interactive_errors_without_yes(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	multiPromptsConfig(t, configPath)

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err := RunConfigure(ConfigureOpts{
		Handlers:      DefaultHandlers(),
		Client:        client,
		AuthType:      "pat",
		Output:        stdout,
		IsInteractive: func() bool { return false },
	}, tools)
	require.ErrorIs(t, err, ErrConsolidationNeedsConfirmation)

	// Non-interactive decline must also leave the config untouched.
	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, "work_prompts")
	assert.Contains(t, servers, "personal_prompts")
}

func TestRunConfigure__declining_before_writes_creates_no_server_tokens(t *testing.T) {
	// Regression guard for the correctness bug where resolveToolPATs ran
	// BEFORE the confirmation gate, causing OAuth token minting (and the
	// pre-check GET /users/me) to hit the API even when the user ultimately
	// said no. The mock server is configured with NO routes — any API call
	// triggers t.Errorf via MockAPI, failing the test. That makes "no API
	// calls happened" an assertable property.
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	multiPromptsConfig(t, configPath)

	mock := testutil.NewMockAPI(t)
	client := api.NewClient(mock.URL(), "bm_oauth_access", "oauth")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err := RunConfigure(ConfigureOpts{
		Handlers:      DefaultHandlers(),
		Client:        client,
		AuthType:      "oauth",
		Output:        stdout,
		Stdin:         strings.NewReader("n\n"),
		IsInteractive: func() bool { return true },
	}, tools)
	require.ErrorIs(t, err, ErrConsolidationDeclined)

	// Config must be untouched (same two custom-named entries).
	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, "work_prompts")
	assert.Contains(t, servers, "personal_prompts")
	assert.NotContains(t, servers, "tiddly_prompts")
}

func TestRunConfigure__non_interactive_decline_creates_no_server_tokens(t *testing.T) {
	// Parallel to the above, but under the non-interactive gate path.
	// Non-interactive + no --yes must fail BEFORE any API call.
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	multiPromptsConfig(t, configPath)

	mock := testutil.NewMockAPI(t)
	client := api.NewClient(mock.URL(), "bm_oauth_access", "oauth")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err := RunConfigure(ConfigureOpts{
		Handlers:      DefaultHandlers(),
		Client:        client,
		AuthType:      "oauth",
		Output:        stdout,
		IsInteractive: func() bool { return false },
	}, tools)
	require.ErrorIs(t, err, ErrConsolidationNeedsConfirmation)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, "work_prompts")
	assert.Contains(t, servers, "personal_prompts")
}

func TestRunConfigure__status_error_aborts_non_dry_run(t *testing.T) {
	// If Status fails in a non-dry-run, the consolidation check is blind,
	// and silently proceeding would bypass the safety gate. Preflight must
	// propagate the error and abort before any write.
	dir := t.TempDir()
	configPath := filepath.Join(dir, "not-a-valid-file.json")
	require.NoError(t, os.WriteFile(configPath, []byte("{{ not valid json"), 0600))

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	_, err := RunConfigure(ConfigureOpts{
		Handlers:      DefaultHandlers(),
		Client:        client,
		AuthType:      "pat",
		Output:        stdout,
		IsInteractive: func() bool { return true },
	}, tools)
	require.Error(t, err, "non-dry-run must fail closed on Status error")
	assert.Contains(t, err.Error(), "reading claude-code config for safety check")

	// Original (invalid) file must be preserved — no write happened.
	data, readErr := os.ReadFile(configPath)
	require.NoError(t, readErr)
	assert.Equal(t, "{{ not valid json", string(data))
}

func TestRunConfigure__single_gate_across_multiple_tools(t *testing.T) {
	// User has multi-entry on two different tools. One confirmation gate
	// should cover both; a "no" must leave BOTH untouched (atomicity),
	// not partially consolidate one while aborting the other.
	dir := t.TempDir()
	claudeCodePath := filepath.Join(dir, ".claude.json")
	claudeDesktopPath := filepath.Join(dir, "claude_desktop_config.json")

	multiPromptsConfig(t, claudeCodePath)
	writeTestJSON(t, claudeDesktopPath, map[string]any{
		"mcpServers": map[string]any{
			"work_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", PromptMCPURL(), "--header", "Authorization: Bearer bm_work"},
			},
			"personal_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", PromptMCPURL(), "--header", "Authorization: Bearer bm_personal"},
			},
		},
	})

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: claudeCodePath},
		{Name: "claude-desktop", Detected: true, ConfigPath: claudeDesktopPath, HasNpx: true},
	}

	_, err := RunConfigure(ConfigureOpts{
		Handlers:      DefaultHandlers(),
		Client:        client,
		AuthType:      "pat",
		Output:        stdout,
		Stdin:         strings.NewReader("n\n"),
		IsInteractive: func() bool { return true },
	}, tools)
	require.ErrorIs(t, err, ErrConsolidationDeclined)

	// Combined warning should list BOTH tools before the single prompt.
	out := stdout.String()
	assert.Contains(t, out, "claude-code:", "combined warning should mention claude-code")
	assert.Contains(t, out, "claude-desktop:", "combined warning should mention claude-desktop")
	// Exactly one prompt appears.
	assert.Equal(t, 1, strings.Count(out, "Continue? [y/N]:"),
		"only one prompt should appear across multiple tools needing consolidation")

	// Both tools' configs must be preserved.
	claudeCodeConfig := readTestJSON(t, claudeCodePath)
	claudeCodeServers := claudeCodeConfig["mcpServers"].(map[string]any)
	assert.Contains(t, claudeCodeServers, "work_prompts")
	assert.Contains(t, claudeCodeServers, "personal_prompts")

	claudeDesktopConfig := readTestJSON(t, claudeDesktopPath)
	claudeDesktopServers := claudeDesktopConfig["mcpServers"].(map[string]any)
	assert.Contains(t, claudeDesktopServers, "work_prompts")
	assert.Contains(t, claudeDesktopServers, "personal_prompts")
}

func TestRunConfigure__oauth_multi_entry_proceed_reuses_surviving_pat(t *testing.T) {
	// Full OAuth happy-path after the preflight → gate → commit restructure:
	// multi-entry prompts + canonical content, user confirms, the surviving
	// prompts PAT is validated and reused (no new token minted), the
	// non-surviving entry is discarded, and a single canonical entry is
	// written. This is the complement of the "decline creates no tokens"
	// regression guard — it proves the accept branch actually works.
	var (
		validatedPATs []string
		tokenCalls    int
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && r.URL.Path == "/users/me":
			auth := r.Header.Get("Authorization")
			validatedPATs = append(validatedPATs, auth)
			_ = json.NewEncoder(w).Encode(api.UserInfo{ID: "u1", Email: "t@t.com"})
		case r.Method == "POST" && r.URL.Path == "/tokens/":
			tokenCalls++
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(api.TokenCreateResponse{ID: "tok-new", Token: "bm_new"})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// One canonical content entry (single-entry, no consolidation for content)
	// + two custom prompts entries (consolidation required).
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"tiddly_notes_bookmarks": map[string]any{
				"type": "http",
				"url":  ContentMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_existing_content",
				},
			},
			// Neither prompts entry is canonical, so alphabetical order
			// (personal before work) decides the survivor under canonical-first.
			"personal_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_personal_prompt",
				},
			},
			"work_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_work_prompt",
				},
			},
		},
	})

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	result, err := RunConfigure(ConfigureOpts{
		Handlers:      DefaultHandlers(),
		Client:        client,
		AuthType:      "oauth",
		Output:        stdout,
		Stdin:         strings.NewReader("y\n"),
		IsInteractive: func() bool { return true },
	}, tools)

	require.NoError(t, err)
	assert.Equal(t, 0, tokenCalls, "no tokens should be minted when existing PATs are valid")

	// Both existing PATs were validated: content's, and the surviving
	// prompts one (personal_prompts, alphabetically first).
	assert.Contains(t, validatedPATs, "Bearer bm_existing_content",
		"content PAT should be validated for reuse")
	assert.Contains(t, validatedPATs, "Bearer bm_personal_prompt",
		"surviving prompts PAT (personal_prompts) should be validated for reuse")
	assert.NotContains(t, validatedPATs, "Bearer bm_work_prompt",
		"non-surviving prompts PAT (work_prompts) should NOT touch the API")

	assert.Len(t, result.TokensReused, 2, "both content and surviving prompts PATs reused")
	assert.Empty(t, result.TokensCreated)

	// Verify final filesystem state: canonical entries only, with the
	// surviving personal_prompts PAT bound to tiddly_prompts.
	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	assert.NotContains(t, servers, "work_prompts", "non-surviving entry must be deleted")
	assert.NotContains(t, servers, "personal_prompts", "original custom key must be deleted")
	require.Contains(t, servers, "tiddly_prompts", "canonical prompts entry must be written")
	require.Contains(t, servers, "tiddly_notes_bookmarks", "canonical content entry preserved")

	prompts := servers["tiddly_prompts"].(map[string]any)
	headers := prompts["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_personal_prompt", headers["Authorization"],
		"the surviving PAT (from personal_prompts) must be what's written under the canonical key")
}

func TestRunConfigure__commit_phase_failure_preserves_earlier_writes(t *testing.T) {
	// Two tools configured in one call. Tool-1 succeeds. Tool-2's parent
	// directory is read-only, so its write fails during phase 3 (commit).
	//
	// Contract under test: RunConfigure returns the failing tool's error,
	// but tool-1's filesystem state is NOT rolled back. A future regression
	// that "helpfully" restored tool-1 on tool-2 failure would lose the
	// user's successful work without telling them — this test prevents that.

	// Tool-1: ordinary temp dir. Configure will create .claude.json here.
	dir1 := t.TempDir()
	configPath1 := filepath.Join(dir1, ".claude.json")

	// Tool-2: pre-create the parent, then chmod it read-only so the
	// atomic-write temp-file create fails inside writeJSONConfig.
	dir2 := t.TempDir()
	readonly := filepath.Join(dir2, "readonly")
	require.NoError(t, os.Mkdir(readonly, 0700))
	configPath2 := filepath.Join(readonly, "claude_desktop_config.json")
	require.NoError(t, os.Chmod(readonly, 0500))
	t.Cleanup(func() {
		// Restore write bit so t.TempDir() cleanup can remove the directory.
		_ = os.Chmod(readonly, 0700)
	})

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath1},
		{Name: "claude-desktop", Detected: true, ConfigPath: configPath2, HasNpx: true},
	}

	_, err := RunConfigure(ConfigureOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		Output:   stdout,
	}, tools)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "configuring claude-desktop",
		"error should identify the failing tool so the user knows where to look")

	// Tool-1's write MUST persist — no rollback.
	config1 := readTestJSON(t, configPath1)
	servers1, ok := config1["mcpServers"].(map[string]any)
	require.True(t, ok, "tool-1's config file should exist and be valid JSON")
	assert.Contains(t, servers1, "tiddly_notes_bookmarks",
		"tool-1's successful write must survive tool-2's failure")

	// Tool-2's config must not exist — the write failed atomically.
	_, statErr := os.Stat(configPath2)
	assert.True(t, os.IsNotExist(statErr),
		"tool-2's config file should not exist after a failed write")
}

func TestRunConfigure__consolidation_assume_yes_bypasses_prompt(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	multiPromptsConfig(t, configPath)

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	// AssumeYes + non-interactive stdin: should still proceed without prompt.
	_, err := RunConfigure(ConfigureOpts{
		Handlers:      DefaultHandlers(),
		Client:        client,
		AuthType:      "pat",
		Output:        stdout,
		AssumeYes:     true,
		IsInteractive: func() bool { return false },
	}, tools)
	require.NoError(t, err)

	out := stdout.String()
	assert.Contains(t, out, "will be consolidated", "warning should still be shown")
	assert.NotContains(t, out, "Continue? [y/N]", "prompt must be skipped under --yes")
	assert.Contains(t, out, "Proceeding (--yes)")

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, "tiddly_prompts")
}

func TestRunConfigure__no_prompt_when_single_entries(t *testing.T) {
	// Canonical single-entry setup: consolidation helper returns nil,
	// so the prompt machinery is never invoked. Verifies the common
	// case isn't impacted by the new confirmation flow.
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	client := api.NewClient("http://unused", "bm_new", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-code", Detected: true, ConfigPath: configPath},
	}

	// IsInteractive returns false — if the prompt machinery fired erroneously,
	// this would trigger ErrConsolidationNeedsConfirmation.
	_, err = RunConfigure(ConfigureOpts{
		Handlers:      DefaultHandlers(),
		Client:        client,
		AuthType:      "pat",
		Output:        stdout,
		IsInteractive: func() bool { return false },
	}, tools)
	require.NoError(t, err, "single-entry configure must not gate on confirmation")

	assert.NotContains(t, stdout.String(), "will be consolidated")
	assert.NotContains(t, stdout.String(), "Continue? [y/N]")
}

func TestRunRemove__valid_config_creates_backup_before_writing(t *testing.T) {
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
	backupPath, err := h.Remove(ResolvedConfig{Path: configPath, Scope: "user"}, []string{"content", "prompts"})
	require.NoError(t, err)
	require.NotEmpty(t, backupPath, "Remove should return backup path when a write occurred")
	assert.True(t, strings.HasPrefix(backupPath, configPath+".bak."),
		"backup filename should be <path>.bak.<timestamp>; got %q", backupPath)

	// Backup file should exist with the original content (including the tiddly server)
	backupData, backupErr := os.ReadFile(backupPath)
	require.NoError(t, backupErr, "backup file should exist")
	assert.Contains(t, string(backupData), "tiddly_notes_bookmarks")
}

func TestRunConfigure__no_existing_file_does_not_create_backup(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Detected: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunConfigure(ConfigureOpts{
		Handlers: DefaultHandlers(),
		Client:   client,
		AuthType: "pat",
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Contains(t, result.ToolsConfigured, "claude-desktop")

	// No backup should be produced when no original file existed.
	assert.Empty(t, result.Backups, "no backup record should be surfaced when there was no prior config")
	backupMatches, _ := filepath.Glob(configPath + ".bak.*")
	assert.Empty(t, backupMatches, "backup should not be created when no original file exists")

	// Config should have been created
	newData, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.Contains(t, string(newData), "tiddly_notes_bookmarks")
}
