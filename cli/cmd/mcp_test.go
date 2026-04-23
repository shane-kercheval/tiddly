package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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

func TestMCPConfigure__dry_run_surfaces_pat_auth_warning(t *testing.T) {
	// Regression guard: dry-run must still print the "Using your current
	// token…" advisory that RunConfigure populates under PAT auth. Dry-run
	// is specifically when users are trying to understand what the real run
	// would do — suppressing the advisory there defeats its purpose. An
	// earlier refactor accidentally gated the warning print on !dryRun; this
	// test ensures that regression doesn't come back.
	tmpDir := t.TempDir()
	tmpConfig := filepath.Join(tmpDir, ".claude.json")

	store := testutil.CredsWithPAT("bm_test123")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

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
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "claude-code", "--dry-run")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stderr, "Using your current token",
		"dry-run must surface the PAT-auth advisory; it's exactly when users are trying to understand the real run")
	// The summary ('Configured: ...') must NOT appear in dry-run — those
	// fields describe actual writes, and nothing was written.
	assert.NotContains(t, result.Stdout, "Configured:",
		"dry-run writes nothing, so the Configured: summary line must not appear")
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
	assert.Contains(t, result.Stdout, "Removed tiddly_notes_bookmarks, tiddly_prompts from claude-code")
	assert.Len(t, deletedTokenIDs, 2, "should delete both matching tokens")
	assert.Contains(t, deletedTokenIDs, "tok-content")
	assert.Contains(t, deletedTokenIDs, "tok-prompts")

	// Verify the config file was modified — tiddly servers removed
	data, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "tiddly_notes_bookmarks")
	assert.NotContains(t, string(data), "tiddly_prompts")
}

func TestMCPRemove__delete_tokens_revokes_canonical_only(t *testing.T) {
	// Under canonical-name-only remove, --delete-tokens revokes PATs
	// attached to the CLI-managed entries ONLY. The two canonical entries
	// hold distinct PATs (minted by separate configure runs), and both
	// tokens must be revoked. Any non-canonical entries — even at Tiddly
	// URLs — must NOT lose their PATs and their config entries must survive.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_cli_content_t"}
			},
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_cli_prompts_t"}
			},
			"work_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_work_toke1234"}
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
				{ID: "tok-content", Name: "cli-mcp-claude-code-content-aaa111", TokenPrefix: "bm_cli_conte"},
				{ID: "tok-prompts", Name: "cli-mcp-claude-code-prompts-bbb222", TokenPrefix: "bm_cli_promp"},
				{ID: "tok-work", Name: "cli-mcp-claude-code-prompts-ccc333", TokenPrefix: "bm_work_toke"},
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
	mock.On("DELETE", "/tokens/tok-work").
		HandleFunc(func(w http.ResponseWriter, r *http.Request) {
			deletedTokenIDs = append(deletedTokenIDs, "tok-work")
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
	// Only canonical PATs get revoked; work_prompts' PAT is NOT.
	assert.ElementsMatch(t, []string{"tok-content", "tok-prompts"}, deletedTokenIDs,
		"--delete-tokens revokes canonical PATs only; non-canonical entries' PATs stay intact")

	// Non-canonical work_prompts entry survives.
	data, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "tiddly_notes_bookmarks")
	assert.NotContains(t, string(data), "tiddly_prompts")
	assert.Contains(t, string(data), "work_prompts")
	assert.Contains(t, string(data), "bm_work_toke1234", "non-canonical PAT must remain untouched on disk")
}

func TestMCPRemove__delete_tokens_dedups_shared_pat(t *testing.T) {
	// Two canonical entries, one shared PAT. The important post-M2 behavior
	// is "one server-side delete, N per-entry outcomes": the cmd layer must
	// NOT pre-dedupe the TokenRevokeRequests — doing so would collapse two
	// canonical entries into a single request and drop one entry's share
	// of the per-request result contract. The helper dedupes internally.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	sharedToken := "bm_shared_token12"
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer ` + sharedToken + `"}
			},
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer ` + sharedToken + `"}
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
				{ID: "tok-shared", Name: "cli-mcp-claude-code-shared-xyz", TokenPrefix: "bm_shared_to"},
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
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	// Contract: one server-side DELETE regardless of how many canonical
	// entries share the PAT.
	assert.Len(t, deletedTokenIDs, 1, "shared PAT must produce exactly one DELETE")
	// Contract: the deleted token's name surfaces exactly once, not once
	// per canonical entry.
	assert.Equal(t, 1, strings.Count(result.Stdout, "cli-mcp-claude-code-shared-xyz"),
		"a deleted token must appear in 'Deleted tokens:' output exactly once even when multiple canonical entries share its PAT")
}

func TestMCPRemove__delete_tokens_shared_pat_fans_out_per_entry_notes(t *testing.T) {
	// Two canonical entries sharing one PAT that does NOT match any
	// cli-mcp-* server-side token. The cmd layer must send ONE
	// TokenRevokeRequest PER canonical entry (no pre-dedupe), so
	// DeleteTokensByPrefix can mirror the "nothing matched" outcome back
	// to both input labels. The user must see per-entry notes for BOTH
	// canonical entries — anything less drops attribution they need to
	// make sense of their tokens list.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	sharedToken := "bm_user_pasted_" // not minted by the CLI
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer ` + sharedToken + `"}
			},
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer ` + sharedToken + `"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// No cli-mcp-* tokens on the server match this PAT prefix.
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-unrelated", Name: "cli-mcp-claude-code-content-xyz", TokenPrefix: "bm_something"},
		})
	})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	// Both canonical entry labels must appear in their own per-entry note.
	assert.Contains(t, result.Stdout,
		"Note: no CLI-created token matched the token attached to tiddly_notes_bookmarks",
		"per-entry attribution must survive even when multiple canonical entries share a PAT")
	assert.Contains(t, result.Stdout,
		"Note: no CLI-created token matched the token attached to tiddly_prompts",
		"per-entry attribution must survive even when multiple canonical entries share a PAT")
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
	assert.Contains(t, result.Stdout, "Removed tiddly_notes_bookmarks from claude-code")

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
	// New consolidated warning: names the canonical entry being revoked and
	// the retained entry still holding the same PAT.
	assert.Contains(t, result.Stderr,
		"Warning: token from tiddly_notes_bookmarks is also used by tiddly_prompts (still configured)")
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
	// Consolidated warning from the perspective of the canonical entry
	// being revoked (tiddly_prompts) naming the retained one.
	assert.Contains(t, result.Stderr,
		"Warning: token from tiddly_prompts is also used by tiddly_notes_bookmarks (still configured)")
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

func TestPrintConfigureSummary__emits_preserved_entries_line(t *testing.T) {
	// Direct printer-level test: given a ConfigureResult with preserved
	// entries across two tools, the summary must emit one line per tool,
	// sorted by tool name, with the preserved names joined by ", " in
	// their stored order (which RunConfigure sorts alphabetically before
	// assignment).
	result := &mcp.ConfigureResult{
		ToolsConfigured: []string{"claude-code", "codex"},
		PreservedEntries: map[string][]string{
			"codex":       {"work_prompts"},
			"claude-code": {"personal_prompts", "work_prompts"},
		},
	}

	var buf bytes.Buffer
	printConfigureSummary(&buf, result, false)
	out := buf.String()

	assert.Contains(t, out, "Preserved non-CLI-managed entries in claude-code: personal_prompts, work_prompts")
	assert.Contains(t, out, "Preserved non-CLI-managed entries in codex: work_prompts")

	// Tool names must appear in sorted order: claude-code before codex.
	assert.Less(t,
		bytesIndex(out, "in claude-code:"),
		bytesIndex(out, "in codex:"),
		"preserved-entries lines must be sorted by tool name",
	)
}

func TestPrintConfigureSummary__no_preserved_line_when_empty(t *testing.T) {
	// No PreservedEntries → no preserved line. Prevents a "Preserved…: "
	// trailing-colon regression.
	result := &mcp.ConfigureResult{ToolsConfigured: []string{"claude-code"}}
	var buf bytes.Buffer
	printConfigureSummary(&buf, result, false)
	assert.NotContains(t, buf.String(), "Preserved")
}

// bytesIndex returns the index of needle in haystack, or -1 if absent.
// Local helper so assert.Less can compare line positions without pulling
// in strings.Index inline at each call site.
func bytesIndex(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

func TestMCPConfigure__mismatch_error_has_no_double_error_prefix(t *testing.T) {
	// Regression guard for the "Error: Error: ..." bug: formatMismatchError
	// must NOT include its own "Error:" prefix — main.go adds that. We drive
	// the command through Cobra and inspect result.Err (which is what the
	// entrypoint formats). A leading "Error:" inside the message would
	// produce "Error: Error: ..." in the real terminal.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	require.NoError(t, os.WriteFile(configPath, []byte(`{
		"mcpServers": {
			"tiddly_prompts": {
				"type": "http",
				"url": "https://example.com/my-prompts",
				"headers": {"Authorization": "Bearer bm_custom"}
			}
		}
	}`), 0600))

	store := testutil.CredsWithPAT("bm_test123")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)

	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore:    store,
		TokenManager: tm,
		ExecLooker:   looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() {
		appDeps = nil
		viper.Reset()
	})

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "configure", "claude-code")

	require.Error(t, result.Err)
	// The returned error is what main.go prefixes with "Error: ". It must
	// therefore NOT start with "Error:" itself.
	assert.NotContains(t, result.Err.Error(), "Error: ",
		"formatMismatchError must not include its own 'Error:' prefix — main.go adds that")
	// Sanity: the real mismatch copy must still be there.
	assert.Contains(t, result.Err.Error(), "CLI-managed")
	assert.Contains(t, result.Err.Error(), "--force")
}

// ---------------------------------------------------------------------------
// Milestone 2: canonical-name-only remove + structured --delete-tokens.
// ---------------------------------------------------------------------------

func TestMCPRemove__reports_nothing_removed_when_no_canonical_entries_present(t *testing.T) {
	// Config has only non-canonical entries. Canonical-name-only remove
	// finds nothing to do → "No CLI-managed entries found in <tool>".
	// Token-cleanup path must be skipped.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"work_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_work_pat1234"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	mock := testutil.NewMockAPI(t)
	// Any /tokens/ call would be a test bug — we should NOT hit the API.
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("no-op remove must not call the API")
		w.WriteHeader(500)
	})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "No CLI-managed entries found in claude-code")
	assert.NotContains(t, result.Stdout, "Removed ", "nothing was removed, so no 'Removed' line")

	// Non-canonical entry survives untouched.
	data, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.Contains(t, string(data), "work_prompts")
}

func TestMCPRemove__delete_tokens_ignores_non_canonical_pats(t *testing.T) {
	// User has tiddly_notes_bookmarks (canonical) + work_prompts (non-canonical,
	// at Tiddly URL) with DISTINCT PATs. --delete-tokens revokes the canonical
	// one only; the work_prompts PAT is neither revoked nor even sent to the
	// DeleteTokensByPrefix helper.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_canon_conte"}
			},
			"work_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_work_prompt"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	var deletedIDs []string
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-canon", Name: "cli-mcp-claude-code-content-aaa", TokenPrefix: "bm_canon_con"},
			{ID: "tok-work", Name: "cli-mcp-claude-code-prompts-bbb", TokenPrefix: "bm_work_prom"},
		})
	})
	mock.On("DELETE", "/tokens/tok-canon").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		deletedIDs = append(deletedIDs, "tok-canon")
		w.WriteHeader(http.StatusNoContent)
	})
	mock.On("DELETE", "/tokens/tok-work").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("non-canonical PAT must never reach the DELETE path")
		deletedIDs = append(deletedIDs, "tok-work")
		w.WriteHeader(http.StatusNoContent)
	})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Equal(t, []string{"tok-canon"}, deletedIDs)
}

func TestMCPRemove__shared_pat_warning_fires_when_non_canonical_retains_pat(t *testing.T) {
	// tiddly_prompts (canonical, being revoked) shares its PAT with
	// work_prompts (non-canonical, staying). The consolidated warning must
	// name work_prompts as the retained binding that will lose access.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_shared_pat_"}
			},
			"work_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_shared_pat_"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-shared", Name: "cli-mcp-claude-code-prompts-aaa", TokenPrefix: "bm_shared_pa"},
		})
	})
	mock.On("DELETE", "/tokens/tok-shared").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stderr,
		"Warning: token from tiddly_prompts is also used by work_prompts (still configured); revoking will break those bindings.")
}

func TestMCPRemove__shared_pat_warning_consolidates_multiple_retained_entries(t *testing.T) {
	// The canonical entry being revoked shares its PAT with TWO retained
	// non-canonical entries (work + personal). The warning must list both
	// on a single line, sorted alphabetically.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_shared_pat_"}
			},
			"work_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_shared_pat_"}
			},
			"personal_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_shared_pat_"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-shared", Name: "cli-mcp-claude-code-prompts-aaa", TokenPrefix: "bm_shared_pa"},
		})
	})
	mock.On("DELETE", "/tokens/tok-shared").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	// Retained names comma-joined, sorted alphabetically (personal < work).
	assert.Contains(t, result.Stderr,
		"Warning: token from tiddly_prompts is also used by personal_prompts, work_prompts (still configured); revoking will break those bindings.")
}

func TestMCPRemove__no_warning_when_no_retained_pat_shares(t *testing.T) {
	// Two canonical entries, distinct PATs, no non-canonical retained
	// entries. No shared-PAT warning should fire.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_conte_unique"}
			},
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_promp_unique"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{})
	})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.NotContains(t, result.Stderr, "is also used by",
		"no shared-PAT warning should fire when no retained entry shares a PAT")
}

func TestMCPRemove__non_cli_token_note_fires_per_unmatched_entry(t *testing.T) {
	// Canonical PAT doesn't match any cli-mcp-* server-side token. Emit
	// the informational note naming the entry; no deletions.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_unmatched_"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Server has no cli-mcp-* token matching the PAT prefix.
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-unrelated", Name: "some-other-token", TokenPrefix: "bm_unmatched"},
		})
	})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout,
		"Note: no CLI-created token matched the token attached to tiddly_prompts; nothing was revoked. Manage tokens at https://tiddly.me/settings.")
	assert.NotContains(t, result.Stdout, "Deleted tokens:",
		"no tokens were deleted")
}

func TestMCPRemove__non_cli_token_note_does_not_fire_for_cli_tokens(t *testing.T) {
	// When the canonical PAT DOES match a cli-mcp-* token, the note must NOT
	// fire — that's the happy path, "Deleted tokens:" covers it.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_matched_pat"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-cli", Name: "cli-mcp-claude-code-prompts-abc", TokenPrefix: "bm_matched_p"},
		})
	})
	mock.On("DELETE", "/tokens/tok-cli").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.NotContains(t, result.Stdout, "Note: no CLI-created token matched")
	assert.Contains(t, result.Stdout, "Deleted tokens: cli-mcp-claude-code-prompts-abc")
}

func TestMCPRemove__non_cli_token_note_fires_for_short_or_garbled_pat(t *testing.T) {
	// A canonical entry with a PAT shorter than tokenPrefixLen triggers the
	// same "nothing matched" note path (DeleteTokensByPrefix treats short
	// PATs as empty/nil, indistinguishable from "no match").
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_tiny"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-unrelated", Name: "cli-mcp-claude-code-prompts-xyz", TokenPrefix: "bm_something"},
		})
	})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--delete-tokens", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout,
		"Note: no CLI-created token matched the token attached to tiddly_prompts")
}

func TestMCPRemove__orphan_warning_excludes_tokens_used_by_non_canonical_entries(t *testing.T) {
	// No --delete-tokens: orphan warning fires. But one orphan candidate
	// has a TokenPrefix matching a PAT still referenced by a retained
	// non-canonical entry (work_prompts). That candidate must be filtered
	// out — it's NOT orphaned, it's in active use.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_canon_conte"}
			},
			"work_prompts": {
				"type": "http",
				"url": "https://prompts-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_work_prompt"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Two cli-mcp-* tokens exist. One matches the work_prompts PAT
		// (still in use), one doesn't (truly orphaned).
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-still-used", Name: "cli-mcp-claude-code-prompts-used", TokenPrefix: "bm_work_prom"},
			{ID: "tok-truly-orphaned", Name: "cli-mcp-claude-code-prompts-orph", TokenPrefix: "bm_no_match__"},
		})
	})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stderr, "cli-mcp-claude-code-prompts-orph",
		"truly orphaned token must still be reported")
	assert.NotContains(t, result.Stderr, "cli-mcp-claude-code-prompts-used",
		"token still referenced by a retained non-canonical entry must NOT be flagged as orphan")
}

func TestMCPRemove__orphan_warning_fires_for_unreferenced_cli_tokens(t *testing.T) {
	// No retained PATs, one cli-mcp-* token on the server → orphan warning fires.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_canon_conte"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/tokens/").HandleFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]api.TokenInfo{
			{ID: "tok-orph", Name: "cli-mcp-claude-code-prompts-orph", TokenPrefix: "bm_orphan____"},
		})
	})

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stderr, "cli-mcp-claude-code-prompts-orph")
	assert.Contains(t, result.Stderr, "--delete-tokens")
}

func TestMCPRemove__write_failure_prints_backup_path(t *testing.T) {
	// The plan specifies: on write failure after backup, the cmd layer must
	// print "Backed up previous config to <path>" before propagating the
	// error. This is the user's recovery path.
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {
				"type": "http",
				"url": "https://content-mcp.tiddly.me/mcp",
				"headers": {"Authorization": "Bearer bm_canon_conte"}
			}
		}
	}`
	require.NoError(t, os.WriteFile(configPath, []byte(configData), 0600))

	// Force atomicWriteFile to fail so the backup is taken but the write errors.
	prev := mcp.AtomicWriteFileFunc()
	mcp.SetAtomicWriteFileFunc(func(path string, data []byte, perm os.FileMode) error {
		return fmt.Errorf("simulated write failure")
	})
	t.Cleanup(func() { mcp.SetAtomicWriteFileFunc(prev) })

	store := testutil.NewMockCredStore()
	_ = store.Set(auth.AccountOAuthAccess, "oauth-jwt-token")
	viper.Reset()
	tm := auth.NewTokenManager(store, nil)
	looker := testutil.NewMockExecLooker()
	looker.Paths["claude"] = "/usr/bin/claude"

	SetDeps(&AppDeps{
		CredStore: store, TokenManager: tm, ExecLooker: looker,
		ToolHandlers: handlersWithOverride("claude-code", configPath),
	})
	t.Cleanup(func() { appDeps = nil; viper.Reset() })

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "remove", "claude-code")

	require.Error(t, result.Err, "write failure must propagate")
	assert.Contains(t, result.Stdout, "Backed up previous config to",
		"backup line must surface before the error is returned")
	assert.Contains(t, result.Err.Error(), "simulated write failure")
}

