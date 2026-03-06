package mcp

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// PAT extraction tests

func TestExtractClaudeCodePATs__user_scope(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := InstallClaudeCode(rc, "bm_content123", "bm_prompt456")
	require.NoError(t, err)

	contentPAT, promptPAT := ExtractClaudeCodePATs(rc)
	assert.Equal(t, "bm_content123", contentPAT)
	assert.Equal(t, "bm_prompt456", promptPAT)
}

func TestExtractClaudeCodePATs__no_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"other-server": map[string]any{"type": "stdio"},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	contentPAT, promptPAT := ExtractClaudeCodePATs(rc)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractClaudeCodePATs__missing_file(t *testing.T) {
	rc := ResolvedConfig{Path: "/nonexistent/.claude.json", Scope: "user"}
	contentPAT, promptPAT := ExtractClaudeCodePATs(rc)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractClaudeCodePATs__malformed_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	require.NoError(t, os.WriteFile(configPath, []byte("not json{"), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	contentPAT, promptPAT := ExtractClaudeCodePATs(rc)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

// Install/Uninstall/Status/DryRun tests

func TestInstallClaudeCode__user_scope_creates_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := InstallClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	assert.Equal(t, "http", content["type"])
	assert.Equal(t, ContentMCPURL(), content["url"])
	headers := content["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_content", headers["Authorization"])

	prompts := servers["tiddly_prompts"].(map[string]any)
	assert.Equal(t, "http", prompts["type"])
	assert.Equal(t, PromptMCPURL(), prompts["url"])
}

func TestInstallClaudeCode__preserves_existing_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Write existing config with other settings
	existing := map[string]any{
		"mcpServers": map[string]any{
			"other-server": map[string]any{"type": "stdio", "command": "test"},
		},
		"someOtherKey": "preserved",
	}
	writeTestJSON(t, configPath, existing)

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := InstallClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	assert.Equal(t, "preserved", config["someOtherKey"])

	servers := config["mcpServers"].(map[string]any)
	assert.NotNil(t, servers["other-server"], "existing server should be preserved")
	assert.NotNil(t, servers["tiddly_notes_bookmarks"], "new server should be added")
	assert.NotNil(t, servers["tiddly_prompts"], "new server should be added")
}

func TestInstallClaudeCode__local_scope(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	fakeCwd := "/fake/project/dir"

	rc := ResolvedConfig{Path: configPath, Scope: "local", Cwd: fakeCwd}
	err := InstallClaudeCode(rc, "bm_content", "")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	projects := config["projects"].(map[string]any)
	proj := projects[fakeCwd].(map[string]any)
	servers := proj["mcpServers"].(map[string]any)
	assert.NotNil(t, servers["tiddly_notes_bookmarks"])
}

func TestInstallClaudeCode__project_scope(t *testing.T) {
	dir := t.TempDir()
	// project scope uses cwd/.mcp.json
	path := resolveClaudeCodePath("", "project", dir)
	assert.Equal(t, filepath.Join(dir, ".mcp.json"), path)
}

func TestUninstallClaudeCode__removes_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}

	// Install first
	err := InstallClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Uninstall
	err = UninstallClaudeCode(rc)
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Nil(t, servers["tiddly_notes_bookmarks"])
	assert.Nil(t, servers["tiddly_prompts"])
}

func TestUninstallClaudeCode__no_file_is_noop(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := UninstallClaudeCode(rc)
	require.NoError(t, err)
}

func TestUninstallClaudeCode__no_tiddly_servers_skips_write(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	existing := map[string]any{
		"mcpServers": map[string]any{
			"other-server": map[string]any{
				"type": "http",
				"url":  "https://other.example.com/mcp",
			},
		},
	}
	writeTestJSON(t, configPath, existing)

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := UninstallClaudeCode(rc)
	require.NoError(t, err)

	// No backup should be created since nothing was removed
	_, statErr := os.Stat(configPath + ".bak")
	assert.True(t, os.IsNotExist(statErr), "no backup should be created on no-op uninstall")
}

func TestStatusClaudeCode__finds_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := InstallClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	sr, err := StatusClaudeCode(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)
	assert.Equal(t, configPath, sr.ConfigPath)
	assert.Equal(t, "content", sr.Servers[0].ServerType)
	assert.True(t, sr.Servers[0].MatchMethod == MatchByName)
	assert.Equal(t, "prompts", sr.Servers[1].ServerType)
	assert.True(t, sr.Servers[1].MatchMethod == MatchByName)
}

func TestStatusClaudeCode__no_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{"mcpServers": map[string]any{}})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := StatusClaudeCode(rc)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers)
	assert.Equal(t, configPath, sr.ConfigPath)
}

func TestStatusClaudeCode__no_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := StatusClaudeCode(rc)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers)
	assert.Equal(t, configPath, sr.ConfigPath)
}

func TestStatusClaudeCode__url_based_detection(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"my_custom_content": map[string]any{
				"type": "http",
				"url":  ContentMCPURL(),
			},
			"my_custom_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := StatusClaudeCode(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)

	// Should be detected by URL, not by name
	for _, s := range sr.Servers {
		assert.True(t, s.MatchMethod == MatchByURL, "server %q should be detected by URL", s.Name)
		assert.False(t, s.MatchMethod == MatchByName)
	}
}

func TestStatusClaudeCode__url_false_positive_rejected(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// A URL that contains the tiddly host as a substring but has a different actual host
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"sneaky_server": map[string]any{
				"type": "http",
				"url":  "https://content-mcp.tiddly.me.evil.com/mcp",
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := StatusClaudeCode(rc)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers, "should not match URL with different host")
}

func TestStatusClaudeCode__same_host_different_path_rejected(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Same host as content MCP but different path — should not match
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"other_service": map[string]any{
				"type": "http",
				"url":  "https://content-mcp.tiddly.me/other-endpoint",
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := StatusClaudeCode(rc)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers, "should not match URL with same host but different path")
}

func TestStatusClaudeCode__canonical_preferred_over_custom(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Both a canonical and custom entry point to the same tiddly URL
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"my_custom_content": map[string]any{
				"type": "http",
				"url":  ContentMCPURL(),
			},
			serverNameContent: map[string]any{
				"type": "http",
				"url":  ContentMCPURL(),
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := StatusClaudeCode(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 1, "should deduplicate to one match")
	assert.Equal(t, serverNameContent, sr.Servers[0].Name, "should prefer canonical name")
	assert.Equal(t, MatchByName, sr.Servers[0].MatchMethod)
}

func TestUninstallClaudeCode__removes_custom_named_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"my_content": map[string]any{
				"type": "http",
				"url":  ContentMCPURL(),
			},
			"my_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
			},
			"other-server": map[string]any{
				"type": "stdio",
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := UninstallClaudeCode(rc)
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.NotContains(t, servers, "my_content")
	assert.NotContains(t, servers, "my_prompts")
	assert.Contains(t, servers, "other-server")
}

func TestInstallClaudeCode__replaces_custom_named_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Pre-populate with custom-named entries pointing to tiddly URLs
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"my_content": map[string]any{
				"type":    "http",
				"url":     ContentMCPURL(),
				"headers": map[string]any{"Authorization": "Bearer old_token"},
			},
			"other-server": map[string]any{"type": "stdio"},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := InstallClaudeCode(rc, "bm_new_content", "bm_new_prompts")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	// Custom-named entry should be removed, canonical name should exist
	assert.NotContains(t, servers, "my_content")
	assert.Contains(t, servers, "tiddly_notes_bookmarks")
	assert.Contains(t, servers, "tiddly_prompts")
	assert.Contains(t, servers, "other-server")
}

func TestExtractClaudeCodePATs__custom_named_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"my_content": map[string]any{
				"type":    "http",
				"url":     ContentMCPURL(),
				"headers": map[string]any{"Authorization": "Bearer bm_custom_content"},
			},
			"my_prompts": map[string]any{
				"type":    "http",
				"url":     PromptMCPURL(),
				"headers": map[string]any{"Authorization": "Bearer bm_custom_prompts"},
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	contentPAT, promptPAT := ExtractClaudeCodePATs(rc)
	assert.Equal(t, "bm_custom_content", contentPAT)
	assert.Equal(t, "bm_custom_prompts", promptPAT)
}

func TestDryRunClaudeCode__shows_diff(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	before, after, err := DryRunClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	assert.Contains(t, before, "{}")
	assert.Contains(t, after, "tiddly_notes_bookmarks")
	assert.Contains(t, after, "tiddly_prompts")

	// File should NOT have been created
	_, err = os.Stat(configPath)
	assert.True(t, os.IsNotExist(err))
}
