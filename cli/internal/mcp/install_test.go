package mcp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunInstall__oauth_creates_pats(t *testing.T) {
	var tokenCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && r.URL.Path == "/tokens/":
			_ = json.NewEncoder(w).Encode([]api.TokenInfo{})
		case r.Method == "POST" && r.URL.Path == "/tokens/":
			tokenCalls++
			var req api.TokenCreateRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(api.TokenCreateResponse{
				ID:    "tok-new",
				Name:  req.Name,
				Token: "bm_created_" + req.Name,
			})
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
		Client:   client,
		AuthType: "oauth",
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Equal(t, 2, tokenCalls, "should create 2 PATs")
	assert.Contains(t, result.TokensCreated, "tiddly-mcp-content")
	assert.Contains(t, result.TokensCreated, "tiddly-mcp-prompts")
	assert.Contains(t, result.ToolsConfigured, "claude-desktop")
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
	content := servers["bookmarks_notes"].(map[string]any)
	args := toStringSlice(content["args"])
	assert.Contains(t, args[3], "bm_existing")
}

func TestRunInstall__dry_run_no_writes(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: true, ConfigPath: configPath, HasNpx: true},
	}

	result, err := RunInstall(InstallOpts{
		Client:   client,
		AuthType: "pat",
		DryRun:   true,
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Contains(t, result.ToolsConfigured, "claude-desktop")

	// File should NOT exist
	_, err = os.Stat(configPath)
	assert.True(t, os.IsNotExist(err), "config file should not be created in dry-run")

	// Output should contain diff
	assert.Contains(t, stdout.String(), "bookmarks_notes")
}

func TestRunInstall__dry_run_claude_code_shows_commands(t *testing.T) {
	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}
	runner := newMockRunner()

	tools := []DetectedTool{
		{Name: "claude-code", Installed: true},
	}

	_, err := RunInstall(InstallOpts{
		Client:   client,
		Runner:   runner,
		AuthType: "pat",
		DryRun:   true,
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Contains(t, stdout.String(), "claude mcp add")
	assert.Contains(t, stdout.String(), "bm_test")
	assert.Empty(t, runner.calls, "should not execute any commands in dry-run")
}

func TestRunInstall__skips_uninstalled_tools(t *testing.T) {
	client := api.NewClient("http://unused", "bm_test", "pat")
	stdout := &bytes.Buffer{}

	tools := []DetectedTool{
		{Name: "claude-desktop", Installed: false},
		{Name: "claude-code", Installed: false},
	}

	result, err := RunInstall(InstallOpts{
		Client:   client,
		AuthType: "pat",
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Empty(t, result.ToolsConfigured)
}

func TestRunInstall__malformed_config_creates_backup(t *testing.T) {
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
		Client:    client,
		AuthType:  "pat",
		Output:    stdout,
		ErrOutput: stderr,
	}, tools)

	// Install will fail because the file is malformed, but backup should exist
	// The backup warning should be in warnings
	if err != nil {
		// A backup should have been created
		_, backupErr := os.Stat(configPath + ".bak")
		assert.NoError(t, backupErr, "backup file should exist")
	}
}

func TestCheckOrphanedTokens__finds_mcp_tokens(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-1", Name: "tiddly-mcp-content"},
			{ID: "tok-2", Name: "tiddly-mcp-prompts"},
			{ID: "tok-3", Name: "other-token"},
		})
	}))
	defer server.Close()

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")
	orphaned, err := CheckOrphanedTokens(client)

	require.NoError(t, err)
	assert.Equal(t, []string{"tiddly-mcp-content", "tiddly-mcp-prompts"}, orphaned)
}

func TestCheckOrphanedTokens__no_orphans(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-1", Name: "other-token"},
		})
	}))
	defer server.Close()

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")
	orphaned, err := CheckOrphanedTokens(client)

	require.NoError(t, err)
	assert.Nil(t, orphaned)
}
