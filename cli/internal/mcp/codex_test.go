package mcp

import (
	"os"
	"path/filepath"
	"testing"

	toml "github.com/pelletier/go-toml/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// PAT extraction tests

func TestExtractCodexPATs__valid_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := InstallCodex(rc, "bm_content123", "bm_prompt456")
	require.NoError(t, err)

	contentPAT, promptPAT := ExtractCodexPATs(rc)
	assert.Equal(t, "bm_content123", contentPAT)
	assert.Equal(t, "bm_prompt456", promptPAT)
}

func TestExtractCodexPATs__no_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("model = \"o3\"\n"), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	contentPAT, promptPAT := ExtractCodexPATs(rc)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractCodexPATs__missing_file(t *testing.T) {
	rc := ResolvedConfig{Path: "/nonexistent/config.toml", Scope: "user"}
	contentPAT, promptPAT := ExtractCodexPATs(rc)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractCodexPATs__malformed_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("not valid toml [[["), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	contentPAT, promptPAT := ExtractCodexPATs(rc)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractCodexPATs__project_scope(t *testing.T) {
	cwd := t.TempDir()
	codexDir := filepath.Join(cwd, ".codex")
	require.NoError(t, os.MkdirAll(codexDir, 0700))

	projectPath := filepath.Join(cwd, ".codex", "config.toml")
	rc := ResolvedConfig{Path: projectPath, Scope: "project", Cwd: cwd}

	// Install to project scope
	err := InstallCodex(rc, "bm_proj_content", "bm_proj_prompt")
	require.NoError(t, err)

	// Extract from project scope
	contentPAT, promptPAT := ExtractCodexPATs(rc)
	assert.Equal(t, "bm_proj_content", contentPAT)
	assert.Equal(t, "bm_proj_prompt", promptPAT)
}

// Install/Uninstall/Status tests

func TestInstallCodex__new_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := InstallCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)

	content := mcpServers["tiddly_content"].(map[string]any)
	assert.Equal(t, ContentMCPURL(), content["url"])
	headers := content["http_headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_content", headers["Authorization"])

	prompts := mcpServers["tiddly_prompts"].(map[string]any)
	assert.Equal(t, PromptMCPURL(), prompts["url"])
}

func TestInstallCodex__preserves_existing(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	existing := `
model = "o3"

[mcp_servers.other_server]
url = "https://other.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(existing), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := InstallCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, configPath)

	// Other settings preserved
	assert.Equal(t, "o3", config["model"])

	// Other MCP server preserved
	mcpServers := config["mcp_servers"].(map[string]any)
	assert.Contains(t, mcpServers, "other_server")
	assert.Contains(t, mcpServers, "tiddly_content")
	assert.Contains(t, mcpServers, "tiddly_prompts")
}

func TestInstallCodex__idempotent(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	require.NoError(t, InstallCodex(rc, "bm_old", "bm_old"))
	require.NoError(t, InstallCodex(rc, "bm_new", "bm_new"))

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)
	content := mcpServers["tiddly_content"].(map[string]any)
	headers := content["http_headers"].(map[string]any)

	assert.Equal(t, "Bearer bm_new", headers["Authorization"])
}

func TestInstallCodex__project_scope_creates_config(t *testing.T) {
	cwd := t.TempDir()
	projectConfig := filepath.Join(cwd, ".codex", "config.toml")

	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	err := InstallCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, projectConfig)
	mcpServers := config["mcp_servers"].(map[string]any)

	content := mcpServers["tiddly_content"].(map[string]any)
	assert.Equal(t, ContentMCPURL(), content["url"])

	prompts := mcpServers["tiddly_prompts"].(map[string]any)
	assert.Equal(t, PromptMCPURL(), prompts["url"])
}

func TestInstallCodex__project_scope_preserves_existing(t *testing.T) {
	cwd := t.TempDir()
	codexDir := filepath.Join(cwd, ".codex")
	require.NoError(t, os.MkdirAll(codexDir, 0700))

	existing := `
model = "o3"

[mcp_servers.other_server]
url = "https://other.example.com/mcp"
`
	require.NoError(t, os.WriteFile(filepath.Join(codexDir, "config.toml"), []byte(existing), 0644))

	projectConfig := filepath.Join(cwd, ".codex", "config.toml")
	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	err := InstallCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, filepath.Join(codexDir, "config.toml"))
	assert.Equal(t, "o3", config["model"])

	mcpServers := config["mcp_servers"].(map[string]any)
	assert.Contains(t, mcpServers, "other_server")
	assert.Contains(t, mcpServers, "tiddly_content")
	assert.Contains(t, mcpServers, "tiddly_prompts")
}

func TestUninstallCodex__removes_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	existing := `
[mcp_servers.tiddly_content]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.tiddly_prompts]
url = "https://prompt-mcp.tiddly.me/mcp"

[mcp_servers.other]
url = "https://other.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(existing), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := UninstallCodex(rc)
	require.NoError(t, err)

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)

	assert.NotContains(t, mcpServers, "tiddly_content")
	assert.NotContains(t, mcpServers, "tiddly_prompts")
	assert.Contains(t, mcpServers, "other")
}

func TestUninstallCodex__missing_file_is_noop(t *testing.T) {
	rc := ResolvedConfig{Path: "/nonexistent/config.toml", Scope: "user"}
	err := UninstallCodex(rc)
	assert.NoError(t, err)
}

func TestUninstallCodex__project_scope(t *testing.T) {
	cwd := t.TempDir()
	projectConfig := filepath.Join(cwd, ".codex", "config.toml")

	// Install to project scope first
	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	err := InstallCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Uninstall from project scope
	err = UninstallCodex(rc)
	require.NoError(t, err)

	config := readTestTOML(t, projectConfig)

	// mcp_servers should be empty (no servers left)
	_, hasMCP := config["mcp_servers"]
	assert.False(t, hasMCP)
}

func TestStatusCodex__configured(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	config := `
[mcp_servers.tiddly_content]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.tiddly_prompts]
url = "https://prompt-mcp.tiddly.me/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	servers, err := StatusCodex(rc)
	require.NoError(t, err)
	assert.Equal(t, []string{"tiddly_content", "tiddly_prompts"}, servers)
}

func TestStatusCodex__not_configured(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("model = \"o3\"\n"), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	servers, err := StatusCodex(rc)
	require.NoError(t, err)
	assert.Nil(t, servers)
}

func TestStatusCodex__missing_file(t *testing.T) {
	rc := ResolvedConfig{Path: "/nonexistent/config.toml", Scope: "user"}
	servers, err := StatusCodex(rc)
	require.NoError(t, err)
	assert.Nil(t, servers)
}

func TestStatusCodex__project_scope(t *testing.T) {
	cwd := t.TempDir()
	projectConfig := filepath.Join(cwd, ".codex", "config.toml")

	// Install to project scope
	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	err := InstallCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Status from project scope
	servers, err := StatusCodex(rc)
	require.NoError(t, err)
	assert.Equal(t, []string{"tiddly_content", "tiddly_prompts"}, servers)
}

func TestInstallCodex__malformed_toml_returns_error(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("not valid toml [[["), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := InstallCodex(rc, "bm_test", "bm_test")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing")
}

func TestDryRunCodex__project_scope(t *testing.T) {
	cwd := t.TempDir()
	projectConfig := filepath.Join(cwd, ".codex", "config.toml")

	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	before, after, err := DryRunCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Before should be empty (no existing file)
	assert.Empty(t, before)

	// After should contain our servers
	assert.Contains(t, after, "tiddly_content")
	assert.Contains(t, after, "tiddly_prompts")
}

func readTestTOML(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var result map[string]any
	require.NoError(t, toml.Unmarshal(data, &result))
	return result
}
