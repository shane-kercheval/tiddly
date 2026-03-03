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

	err := InstallClaudeCode(configPath, "bm_content123", "bm_prompt456", "user")
	require.NoError(t, err)

	contentPAT, promptPAT := ExtractClaudeCodePATs(configPath, "user")
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

	contentPAT, promptPAT := ExtractClaudeCodePATs(configPath, "user")
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractClaudeCodePATs__missing_file(t *testing.T) {
	contentPAT, promptPAT := ExtractClaudeCodePATs("/nonexistent/.claude.json", "user")
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractClaudeCodePATs__malformed_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	require.NoError(t, os.WriteFile(configPath, []byte("not json{"), 0644))

	contentPAT, promptPAT := ExtractClaudeCodePATs(configPath, "user")
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

// Install/Uninstall/Status/DryRun tests

func TestInstallClaudeCode__user_scope_creates_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	err := InstallClaudeCode(configPath, "bm_content", "bm_prompts", "user")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	content := servers["bookmarks_notes"].(map[string]any)
	assert.Equal(t, "http", content["type"])
	assert.Equal(t, ContentMCPURL(), content["url"])
	headers := content["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_content", headers["Authorization"])

	prompts := servers["prompts"].(map[string]any)
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

	err := InstallClaudeCode(configPath, "bm_content", "bm_prompts", "user")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	assert.Equal(t, "preserved", config["someOtherKey"])

	servers := config["mcpServers"].(map[string]any)
	assert.NotNil(t, servers["other-server"], "existing server should be preserved")
	assert.NotNil(t, servers["bookmarks_notes"], "new server should be added")
	assert.NotNil(t, servers["prompts"], "new server should be added")
}

func TestInstallClaudeCode__default_scope_is_user(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	err := InstallClaudeCode(configPath, "bm_content", "", "")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.NotNil(t, servers["bookmarks_notes"])
}

func TestInstallClaudeCode__local_scope(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	err := InstallClaudeCode(configPath, "bm_content", "", "local")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	cwd, _ := os.Getwd()
	projects := config["projects"].(map[string]any)
	proj := projects[cwd].(map[string]any)
	servers := proj["mcpServers"].(map[string]any)
	assert.NotNil(t, servers["bookmarks_notes"])
}

func TestInstallClaudeCode__project_scope(t *testing.T) {
	dir := t.TempDir()
	// project scope ignores configPath and writes to cwd/.mcp.json
	// We can't easily test this without changing cwd, so test resolveClaudeCodePath instead
	path := resolveClaudeCodePath(dir, "project")
	cwd, _ := os.Getwd()
	assert.Equal(t, filepath.Join(cwd, ".mcp.json"), path)
}

func TestUninstallClaudeCode__removes_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Install first
	err := InstallClaudeCode(configPath, "bm_content", "bm_prompts", "user")
	require.NoError(t, err)

	// Uninstall
	err = UninstallClaudeCode(configPath, "user")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Nil(t, servers["bookmarks_notes"])
	assert.Nil(t, servers["prompts"])
}

func TestUninstallClaudeCode__no_file_is_noop(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	err := UninstallClaudeCode(configPath, "user")
	require.NoError(t, err)
}

func TestStatusClaudeCode__finds_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	err := InstallClaudeCode(configPath, "bm_content", "bm_prompts", "user")
	require.NoError(t, err)

	servers, err := StatusClaudeCode(configPath, "user")
	require.NoError(t, err)
	assert.Equal(t, []string{"bookmarks_notes", "prompts"}, servers)
}

func TestStatusClaudeCode__no_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{"mcpServers": map[string]any{}})

	servers, err := StatusClaudeCode(configPath, "user")
	require.NoError(t, err)
	assert.Nil(t, servers)
}

func TestStatusClaudeCode__no_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	servers, err := StatusClaudeCode(configPath, "user")
	require.NoError(t, err)
	assert.Nil(t, servers)
}

func TestDryRunClaudeCode__shows_diff(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	before, after, err := DryRunClaudeCode(configPath, "bm_content", "bm_prompts", "user")
	require.NoError(t, err)

	assert.Contains(t, before, "{}")
	assert.Contains(t, after, "bookmarks_notes")
	assert.Contains(t, after, "prompts")

	// File should NOT have been created
	_, err = os.Stat(configPath)
	assert.True(t, os.IsNotExist(err))
}

