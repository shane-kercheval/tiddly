package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/skills"
	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStatus__not_logged_in(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Tiddly CLI vdev")
	assert.Contains(t, result.Stdout, "Not logged in")
}

func TestStatus__with_pat(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/health").
		RespondJSON(200, testutil.HealthResponse())
	mock.On("GET", "/users/me").
		RespondJSON(200, testutil.UserMeResponse("user@example.com"))
	mock.On("GET", "/bookmarks/").
		RespondJSON(200, map[string]any{"items": []any{}, "total": 10, "offset": 0, "limit": 1, "has_more": true})
	mock.On("GET", "/notes/").
		RespondJSON(200, map[string]any{"items": []any{}, "total": 5, "offset": 0, "limit": 1, "has_more": true})
	mock.On("GET", "/prompts/").
		RespondJSON(200, map[string]any{"items": []any{}, "total": 3, "offset": 0, "limit": 1, "has_more": false})

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status", "--api-url", mock.URL())

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Logged in")
	assert.Contains(t, result.Stdout, "pat")
	assert.Contains(t, result.Stdout, "user@example.com")
	// Content counts should appear
	assert.Contains(t, result.Stdout, "bookmarks:")
	assert.Contains(t, result.Stdout, "10")
	assert.Contains(t, result.Stdout, "notes:")
	assert.Contains(t, result.Stdout, "5")
	assert.Contains(t, result.Stdout, "prompts:")
	assert.Contains(t, result.Stdout, "3")
}

func TestStatus__api_unreachable(t *testing.T) {
	mock := testutil.NewMockAPI(t)
	mock.On("GET", "/health").RespondError(500, "internal server error")
	// /users/me should NOT be called when API is unreachable
	// (no route registered — mock will fail the test if it's called)

	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status", "--api-url", mock.URL())

	require.NoError(t, result.Err) // Command itself doesn't error
	assert.Contains(t, result.Stdout, "Logged in")
	assert.Contains(t, result.Stdout, "Unreachable")
}

func TestStatus__shows_version(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Tiddly CLI vdev")
}

func TestStatus__project_path_flag_accepted(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	dir := t.TempDir()

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status", "--project-path", dir)

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Tiddly CLI vdev")
}

func TestStatus__invalid_project_path_returns_error(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status", "--project-path", "/nonexistent/path/xyz")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "does not exist")
}

func TestStatus__shows_tree_output(t *testing.T) {
	// Set up claude-code as detected with a config
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
	result := testutil.ExecuteCmd(t, cmd, "status")

	require.NoError(t, result.Err)
	// Tree connectors should appear
	assert.Contains(t, result.Stdout, "├──")
	assert.Contains(t, result.Stdout, "└──")
	// Scope labels
	assert.Contains(t, result.Stdout, "user")
	// Tiddly servers section
	assert.Contains(t, result.Stdout, "Tiddly servers:")
	assert.Contains(t, result.Stdout, "claude-code")
	// Header should NOT show (project: ...) when --project-path is not passed
	assert.Contains(t, result.Stdout, "MCP Servers:")
	assert.NotContains(t, result.Stdout, "MCP Servers (project:")
}

func TestStatus__shows_project_path_in_header(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	dir := t.TempDir()

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status", "--project-path", dir)

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "MCP Servers (project: "+dir+")")
}

func TestStatus__shows_tiddly_server_urls(t *testing.T) {
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
	result := testutil.ExecuteCmd(t, cmd, "status")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Tiddly servers:")
	assert.Contains(t, result.Stdout, "https://content-mcp.tiddly.me/mcp")
	assert.Contains(t, result.Stdout, "https://prompts-mcp.tiddly.me/mcp")
}

func TestStatus__shows_other_servers(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"tiddly_notes_bookmarks": {"type": "http", "url": "https://content-mcp.tiddly.me/mcp"},
			"github": {"command": "npx", "args": ["github-mcp-server"]},
			"postgres-mcp": {"url": "https://postgres.example.com/mcp"}
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
	result := testutil.ExecuteCmd(t, cmd, "status")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Tiddly servers:")
	assert.Contains(t, result.Stdout, "Other servers:")
	assert.Contains(t, result.Stdout, "github")
	assert.Contains(t, result.Stdout, "(stdio)")
	assert.Contains(t, result.Stdout, "postgres-mcp")
	assert.Contains(t, result.Stdout, "(http)")
}

func TestStatus__no_tiddly_shows_hint_with_other_servers(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")
	configData := `{
		"mcpServers": {
			"sentry": {"command": "node", "args": ["sentry-server.js"]}
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
	result := testutil.ExecuteCmd(t, cmd, "status")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "No Tiddly servers configured.")
	assert.Contains(t, result.Stdout, "tiddly mcp install")
	assert.Contains(t, result.Stdout, "Other servers:")
	assert.Contains(t, result.Stdout, "sentry")
}

func TestStatus__only_tiddly_no_other_section(t *testing.T) {
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
	result := testutil.ExecuteCmd(t, cmd, "status")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Tiddly servers:")
	assert.NotContains(t, result.Stdout, "Other servers:")
}

func TestStatus__shows_skills_section(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	// Set up a skills directory
	skillsDir := t.TempDir()
	skillDir := filepath.Join(skillsDir, "test-skill")
	require.NoError(t, os.MkdirAll(skillDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("# Test"), 0644))

	cleanupOverride := skills.SetToolPathOverride("claude-code", "global", skillsDir)
	t.Cleanup(cleanupOverride)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "status")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "Skills:")
	assert.Contains(t, result.Stdout, "test-skill")
	assert.Contains(t, result.Stdout, "1 skill")
}
