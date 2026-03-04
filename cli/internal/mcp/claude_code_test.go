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

	content := servers["tiddly_content"].(map[string]any)
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
	assert.NotNil(t, servers["tiddly_content"], "new server should be added")
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
	assert.NotNil(t, servers["tiddly_content"])
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
	assert.Nil(t, servers["tiddly_content"])
	assert.Nil(t, servers["tiddly_prompts"])
}

func TestUninstallClaudeCode__no_file_is_noop(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := UninstallClaudeCode(rc)
	require.NoError(t, err)
}

func TestStatusClaudeCode__finds_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := InstallClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	servers, err := StatusClaudeCode(rc)
	require.NoError(t, err)
	assert.Equal(t, []string{"tiddly_content", "tiddly_prompts"}, servers)
}

func TestStatusClaudeCode__no_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{"mcpServers": map[string]any{}})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	servers, err := StatusClaudeCode(rc)
	require.NoError(t, err)
	assert.Nil(t, servers)
}

func TestStatusClaudeCode__no_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	servers, err := StatusClaudeCode(rc)
	require.NoError(t, err)
	assert.Nil(t, servers)
}

func TestDryRunClaudeCode__shows_diff(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	before, after, err := DryRunClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	assert.Contains(t, before, "{}")
	assert.Contains(t, after, "tiddly_content")
	assert.Contains(t, after, "tiddly_prompts")

	// File should NOT have been created
	_, err = os.Stat(configPath)
	assert.True(t, os.IsNotExist(err))
}
