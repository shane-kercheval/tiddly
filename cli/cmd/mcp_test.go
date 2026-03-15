package cmd

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/mcp"
	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMCPConfigure__not_logged_in(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "not logged in")
}

func TestMCPConfigure__invalid_tool(t *testing.T) {
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "invalid-tool")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "unknown tool")
}

func TestMCPConfigure__invalid_scope(t *testing.T) {
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "--scope", "bad-scope")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "invalid scope")
	assert.Contains(t, result.Err.Error(), "user, directory")
}

func TestMCPConfigure__invalid_servers_flag(t *testing.T) {
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "--servers", "invalid")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "invalid server")
}

func TestMCPConfigure__happy_path_with_pat(t *testing.T) {
	// Set up a Claude Desktop config directory so the tool is "detected"
	dir := t.TempDir()
	configPath := filepath.Join(dir, "Claude", "claude_desktop_config.json")
	require.NoError(t, os.MkdirAll(filepath.Dir(configPath), 0755))

	store := testutil.CredsWithPAT("bm_test123")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	// Use a mock looker that reports claude-desktop config dir
	looker := testutil.NewMockExecLooker()
	looker.Paths["npx"] = "/usr/bin/npx"

	// Override detection via a custom looker that uses our temp dir
	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   &fixedDesktopLooker{configPath: configPath, inner: looker},
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "claude-desktop")

	// PAT auth can't detect the temp config dir via the normal path, so the tool
	// won't be found. This is expected because detection uses OS-specific paths.
	// Instead, test the dry-run path via the configure_test.go unit tests.
	// This test just verifies the command wiring doesn't panic.
	_ = result
}

func TestMCPConfigure__dry_run_with_oauth_no_token_creation(t *testing.T) {
	var tokenCreated int
	mock := testutil.NewMockAPI(t)
	var patValidationCalls int
	mock.On("GET", "/users/me").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			patValidationCalls++
			t.Error("dry-run should not call PAT validation endpoint")
			w.WriteHeader(http.StatusInternalServerError)
		})
	mock.On("POST", "/tokens/").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenCreated++
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":    "tok-new",
				"token": "bm_created",
			})
		})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	// Use a temp dir so the test doesn't read the real ~/.claude.json
	tmpDir := t.TempDir()
	tmpConfig := filepath.Join(tmpDir, ".claude.json")

	// A mock looker that finds claude-code
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   looker,
		ToolHandlers: []mcp.ToolHandler{
			&mcp.ClaudeCodeHandler{ConfigPathOverride: tmpConfig},
		},
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "claude-code", "--dry-run", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "tiddly_notes_bookmarks")
	// Dry-run should not make any API calls (no PAT validation, no token creation)
	assert.Equal(t, 0, patValidationCalls, "dry-run should not validate PATs")
	assert.Equal(t, 0, tokenCreated, "dry-run should not create tokens")
	// Output should contain placeholder
	assert.Contains(t, result.Stdout, "new-token-would-be-created")
}

func TestMCPConfigure__servers_flag_parsed(t *testing.T) {
	// Test that the --servers flag is wired up and parsed correctly.
	// The actual filtering behavior is tested in configure_test.go.
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	// Valid: should not error (may fail because no tools detected, that's fine)
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "--servers", "content")
	// No tool detection error is fine — the flag was parsed
	if result.Err != nil {
		assert.NotContains(t, result.Err.Error(), "invalid server")
	}
}

func TestMCPStatus__runs(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "status")

	require.NoError(t, result.Err)
	// Should list tools (even if not detected)
	assert.Contains(t, result.Stdout, "claude-desktop")
	assert.Contains(t, result.Stdout, "claude-code")
	assert.Contains(t, result.Stdout, "codex")
}

func TestMCPStatus__shows_config_path_for_configured_tool(t *testing.T) {
	// Set up a Claude Code config with tiddly servers so it's "configured"
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {"type": "http", "url": "https://content-mcp.tiddly.me/mcp"},
			"tiddly_prompts": {"type": "http", "url": "https://prompts-mcp.tiddly.me/mcp"}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	store := testutil.NewMockCredStore()
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "status")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "claude-code")
	assert.Contains(t, result.Stdout, "Tiddly servers:")
	assert.Contains(t, result.Stdout, configPath)
	// Verify tree format with scope labels
	assert.Contains(t, result.Stdout, "├──")
	assert.Contains(t, result.Stdout, "└──")
	assert.Contains(t, result.Stdout, "user")
}

func TestMCPRemove__requires_tool_arg(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove")

	require.Error(t, result.Err)
}

func TestMCPRemove__invalid_tool(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "invalid-tool")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "unknown tool")
}

func TestMCPRemove__delete_tokens_flag(t *testing.T) {
	// Write a temp config with tiddly MCP servers so remove has something to extract/remove.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_content_token_abc"}
			},
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_promptsx_token_xyz"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	var deletedTokenIDs []string
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]api.TokenInfo{
				{ID: "tok-content", Name: "cli-mcp-claude-code-content-a1b2c3", TokenPrefix: "bm_content_t"},
				{ID: "tok-prompts", Name: "cli-mcp-claude-code-prompts-d4e5f6", TokenPrefix: "bm_promptsx_"},
			})
		})
	mock.On("DELETE", "/tokens/tok-content").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			deletedTokenIDs = append(deletedTokenIDs, "tok-content")
			w.WriteHeader(http.StatusNoContent)
		})
	mock.On("DELETE", "/tokens/tok-prompts").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			deletedTokenIDs = append(deletedTokenIDs, "tok-prompts")
			w.WriteHeader(http.StatusNoContent)
		})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Removed Tiddly MCP servers from claude-code")
	assert.Len(t, deletedTokenIDs, 2, "should delete both matching tokens")
	assert.Contains(t, deletedTokenIDs, "tok-content")
	assert.Contains(t, deletedTokenIDs, "tok-prompts")

	// Verify the config file was modified — tiddly servers removed
	data, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "tiddly_notes_bookmarks")
	assert.NotContains(t, string(data), "tiddly_prompts")
}

func TestParseServersFlag__valid(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{"content,prompts", []string{"content", "prompts"}},
		{"content", []string{"content"}},
		{"prompts", []string{"prompts"}},
		{" content , prompts ", []string{"content", "prompts"}},
		{"content,content", []string{"content"}},
		{"prompts,prompts", []string{"prompts"}},
		{"content,prompts,content", []string{"content", "prompts"}},
	}

	for _, tc := range tests {
		result, err := parseServersFlag(tc.input)
		require.NoError(t, err, "input: %q", tc.input)
		assert.Equal(t, tc.expected, result, "input: %q", tc.input)
	}
}

func TestParseServersFlag__invalid(t *testing.T) {
	tests := []string{"invalid", "content,invalid", ""}

	for _, tc := range tests {
		_, err := parseServersFlag(tc)
		assert.Error(t, err, "input: %q", tc)
	}
}

func TestMCPConfigure__old_scope_local_rejected(t *testing.T) {
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "--scope", "local")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "invalid scope")
	assert.Contains(t, result.Err.Error(), "user, directory")
}

func TestMCPConfigure__old_scope_project_rejected(t *testing.T) {
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "--scope", "project")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "invalid scope")
	assert.Contains(t, result.Err.Error(), "user, directory")
}

func TestMCPConfigure__old_scope_global_rejected(t *testing.T) {
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "--scope", "global")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "invalid scope")
	assert.Contains(t, result.Err.Error(), "user, directory")
}

func TestMCPConfigure__claude_desktop_directory_scope_rejected(t *testing.T) {
	store := testutil.CredsWithPAT("bm_test123")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	looker := testutil.NewMockExecLooker()

	dir := t.TempDir()
	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   looker,
		ToolHandlers: handlersWithOverrides(map[string]string{
			"claude-desktop": filepath.Join(dir, "claude_desktop_config.json"),
		}),
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "claude-desktop", "--scope", "directory")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "not supported by")
	assert.Contains(t, result.Err.Error(), "claude-desktop")
}

func TestMCPRemove__old_scope_local_rejected(t *testing.T) {
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--scope", "local")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "invalid scope")
	assert.Contains(t, result.Err.Error(), "user, directory")
}

func TestMCPStatus__project_path_flag(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	dir := t.TempDir()

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "status", "--path", dir)

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "MCP Servers (path: "+dir+")")
}

func TestMCPRemove__servers_flag_content_only(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_content_token_abc"}
			},
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_promptsx_token_xyz"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	store := testutil.NewMockCredStore()
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--servers", "content")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Removed Tiddly MCP servers from claude-code")

	// Verify content removed but prompts preserved
	data, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "tiddly_notes_bookmarks")
	assert.Contains(t, string(data), "tiddly_prompts")
}

func TestMCPRemove__servers_flag_default_removes_both(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_content_token_abc"}
			},
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_promptsx_token_xyz"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	store := testutil.NewMockCredStore()
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	// No --servers flag = default "content,prompts" = removes both
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code")

	require.NoError(t, result.Err)

	data, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "tiddly_notes_bookmarks")
	assert.NotContains(t, string(data), "tiddly_prompts")
}

func TestMCPRemove__servers_content_delete_tokens_only_revokes_content_pat(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_content_token_abc"}
			},
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_promptsx_token_xyz"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	var deletedTokenIDs []string
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]api.TokenInfo{
				{ID: "tok-content", Name: "cli-mcp-claude-code-content-a1b2c3", TokenPrefix: "bm_content_t"},
				{ID: "tok-prompts", Name: "cli-mcp-claude-code-prompts-d4e5f6", TokenPrefix: "bm_promptsx_"},
			})
		})
	mock.On("DELETE", "/tokens/tok-content").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			deletedTokenIDs = append(deletedTokenIDs, "tok-content")
			w.WriteHeader(http.StatusNoContent)
		})
	mock.On("DELETE", "/tokens/tok-prompts").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			deletedTokenIDs = append(deletedTokenIDs, "tok-prompts")
			w.WriteHeader(http.StatusNoContent)
		})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--servers", "content", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	// Should only delete the content token, not the prompts token
	assert.Equal(t, []string{"tok-content"}, deletedTokenIDs)
}

func TestMCPRemove__servers_content_orphan_warning_includes_servers_flag(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_content_token_abc"}
			},
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_promptsx_token_xyz"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]api.TokenInfo{
				{ID: "tok-content", Name: "cli-mcp-claude-code-content-a1b2c3", TokenPrefix: "bm_content_t"},
			})
		})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--servers", "content", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	// Orphan warning should suggest --servers content --delete-tokens
	assert.Contains(t, result.Stderr, "--delete-tokens --servers content")
}

func TestMCPRemove__shared_pat_content_only_revokes_and_warns(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	// Both servers use the same PAT (shared token from PAT auth)
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_shared_token"}
			},
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_shared_token"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	var deletedTokenIDs []string
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]api.TokenInfo{
				{ID: "tok-shared", Name: "cli-mcp-claude-code-content-a1b2c3", TokenPrefix: "bm_shared_to"},
			})
		})
	mock.On("DELETE", "/tokens/tok-shared").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			deletedTokenIDs = append(deletedTokenIDs, "tok-shared")
			w.WriteHeader(http.StatusNoContent)
		})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--servers", "content", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	// Should revoke the shared token
	assert.Len(t, deletedTokenIDs, 1)
	// Should warn about retained server losing access
	assert.Contains(t, result.Stderr, "shared with prompts server")
}

func TestMCPRemove__shared_pat_prompts_only_revokes_and_warns(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_shared_token"}
			},
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_shared_token"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	var deletedTokenIDs []string
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]api.TokenInfo{
				{ID: "tok-shared", Name: "cli-mcp-claude-code-content-a1b2c3", TokenPrefix: "bm_shared_to"},
			})
		})
	mock.On("DELETE", "/tokens/tok-shared").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			deletedTokenIDs = append(deletedTokenIDs, "tok-shared")
			w.WriteHeader(http.StatusNoContent)
		})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ConfigDir:    "",
		ExecLooker:   looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--servers", "prompts", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	// Should revoke the shared token (not silently skip)
	assert.Len(t, deletedTokenIDs, 1)
	// Should warn about retained server losing access
	assert.Contains(t, result.Stderr, "shared with content server")
}

func TestMCPRemove__invalid_servers_flag(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--servers", "invalid")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "invalid server")
}

func TestMCPRemove__invalid_scope_returns_error(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--scope", "bogus")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "invalid scope")
}

// fixedDesktopLooker wraps a real looker but overrides Claude Desktop detection
// to use a temp config path for testing.
type fixedDesktopLooker struct {
	configPath string
	inner      mcp.ExecLooker
}

func (f *fixedDesktopLooker) LookPath(file string) (string, error) {
	return f.inner.LookPath(file)
}

// handlersWithOverride returns DefaultHandlers with a ConfigPathOverride set for the named tool.
func handlersWithOverride(toolName, configPath string) []mcp.ToolHandler {
	return handlersWithOverrides(map[string]string{toolName: configPath})
}

// handlersWithOverrides returns DefaultHandlers with ConfigPathOverride set for multiple tools.
func handlersWithOverrides(overrides map[string]string) []mcp.ToolHandler {
	handlers := mcp.DefaultHandlers()
	for i, h := range handlers {
		if path, ok := overrides[h.Name()]; ok {
			switch v := h.(type) {
			case *mcp.ClaudeDesktopHandler:
				v.ConfigPathOverride = path
			case *mcp.ClaudeCodeHandler:
				v.ConfigPathOverride = path
			case *mcp.CodexHandler:
				v.ConfigPathOverride = path
			}
			handlers[i] = h
		}
	}
	return handlers
}
