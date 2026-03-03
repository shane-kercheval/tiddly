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
			"bookmarks_notes": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://content-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_existing_content"},
			},
			"prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://prompt-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_existing_prompt"},
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
			"bookmarks_notes": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://content-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_expired_content"},
			},
			"prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://prompt-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_expired_prompt"},
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
		Client:   client,
		AuthType: "pat",
		DryRun:   true,
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Contains(t, stdout.String(), "bookmarks_notes")
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
	assert.Contains(t, servers, "bookmarks_notes")
	assert.NotContains(t, servers, "prompts")
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
		Client:   client,
		AuthType: "pat",
		Servers:  []string{"prompts"},
		Output:   stdout,
	}, tools)

	require.NoError(t, err)
	assert.Contains(t, result.ToolsConfigured, "claude-desktop")

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.NotContains(t, servers, "bookmarks_notes")
	assert.Contains(t, servers, "prompts")
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

func TestRunInstall__malformed_config_creates_backup_and_succeeds(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")
	require.NoError(t, os.WriteFile(configPath, []byte("not json{"), 0644))

	client := api.NewClient("http://unused", "bm_test", "pat")
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

	// Install should succeed after backup removes the malformed original
	require.NoError(t, err)
	assert.Contains(t, result.ToolsConfigured, "claude-desktop")

	// Backup should exist with original malformed content
	backupData, backupErr := os.ReadFile(configPath + ".bak")
	require.NoError(t, backupErr, "backup file should exist")
	assert.Equal(t, "not json{", string(backupData))

	// New config should be valid JSON
	newData, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.Contains(t, string(newData), "bookmarks_notes")

	// Warning should mention the backup
	hasBackupWarning := false
	for _, w := range result.Warnings {
		if strings.Contains(w, "malformed") {
			hasBackupWarning = true
		}
	}
	assert.True(t, hasBackupWarning, "should warn about malformed backup")
}

func TestCheckOrphanedTokens__finds_mcp_tokens(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-1", Name: "cli-mcp-claude-code-content-a1b2c3"},
			{ID: "tok-2", Name: "cli-mcp-claude-code-prompts-d4e5f6"},
			{ID: "tok-3", Name: "other-token"},
		})
	}))
	defer server.Close()

	client := api.NewClient(server.URL, "oauth-jwt", "oauth")
	orphaned, err := CheckOrphanedTokens(context.Background(), client)

	require.NoError(t, err)
	assert.Len(t, orphaned, 2)
	assert.Contains(t, orphaned[0], "cli-mcp-")
	assert.Contains(t, orphaned[1], "cli-mcp-")
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
	orphaned, err := CheckOrphanedTokens(context.Background(), client)

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

	assert.True(t, validatePAT(context.Background(), server.URL, "bm_valid"))
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

	assert.True(t, validatePAT(context.Background(), server.URL, "bm_consent"))
}

func TestValidatePAT__invalid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	assert.False(t, validatePAT(context.Background(), server.URL, "bm_expired"))
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

func TestExtractPATsFromTool__claude_desktop(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	config := map[string]any{
		"mcpServers": map[string]any{
			"bookmarks_notes": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://content-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_content123"},
			},
			"prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://prompt-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_prompt456"},
			},
		},
	}
	writeTestJSON(t, configPath, config)

	tool := DetectedTool{Name: "claude-desktop", ConfigPath: configPath}
	contentPAT, promptPAT := ExtractPATsFromTool(tool, "user", "")
	assert.Equal(t, "bm_content123", contentPAT)
	assert.Equal(t, "bm_prompt456", promptPAT)
}

func TestExtractPATsFromTool__missing_config(t *testing.T) {
	tool := DetectedTool{Name: "claude-desktop", ConfigPath: "/nonexistent/path.json"}
	contentPAT, promptPAT := ExtractPATsFromTool(tool, "user", "")
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}
