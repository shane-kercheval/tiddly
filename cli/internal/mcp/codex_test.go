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

	err := InstallCodex(configPath, "bm_content123", "bm_prompt456")
	require.NoError(t, err)

	contentPAT, promptPAT := ExtractCodexPATs(configPath)
	assert.Equal(t, "bm_content123", contentPAT)
	assert.Equal(t, "bm_prompt456", promptPAT)
}

func TestExtractCodexPATs__no_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("model = \"o3\"\n"), 0644))

	contentPAT, promptPAT := ExtractCodexPATs(configPath)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractCodexPATs__missing_file(t *testing.T) {
	contentPAT, promptPAT := ExtractCodexPATs("/nonexistent/config.toml")
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractCodexPATs__malformed_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("not valid toml [[["), 0644))

	contentPAT, promptPAT := ExtractCodexPATs(configPath)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

// Install/Uninstall/Status tests

func TestInstallCodex__new_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	err := InstallCodex(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)

	content := mcpServers["bookmarks_notes"].(map[string]any)
	assert.Equal(t, ContentMCPURL(), content["url"])
	headers := content["http_headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_content", headers["Authorization"])

	prompts := mcpServers["prompts"].(map[string]any)
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

	err := InstallCodex(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, configPath)

	// Other settings preserved
	assert.Equal(t, "o3", config["model"])

	// Other MCP server preserved
	mcpServers := config["mcp_servers"].(map[string]any)
	assert.Contains(t, mcpServers, "other_server")
	assert.Contains(t, mcpServers, "bookmarks_notes")
	assert.Contains(t, mcpServers, "prompts")
}

func TestInstallCodex__idempotent(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	require.NoError(t, InstallCodex(configPath, "bm_old", "bm_old"))
	require.NoError(t, InstallCodex(configPath, "bm_new", "bm_new"))

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)
	content := mcpServers["bookmarks_notes"].(map[string]any)
	headers := content["http_headers"].(map[string]any)

	assert.Equal(t, "Bearer bm_new", headers["Authorization"])
}

func TestUninstallCodex__removes_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	existing := `
[mcp_servers.bookmarks_notes]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.prompts]
url = "https://prompt-mcp.tiddly.me/mcp"

[mcp_servers.other]
url = "https://other.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(existing), 0644))

	err := UninstallCodex(configPath)
	require.NoError(t, err)

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)

	assert.NotContains(t, mcpServers, "bookmarks_notes")
	assert.NotContains(t, mcpServers, "prompts")
	assert.Contains(t, mcpServers, "other")
}

func TestUninstallCodex__missing_file_is_noop(t *testing.T) {
	err := UninstallCodex("/nonexistent/config.toml")
	assert.NoError(t, err)
}

func TestStatusCodex__configured(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	config := `
[mcp_servers.bookmarks_notes]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.prompts]
url = "https://prompt-mcp.tiddly.me/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	servers, err := StatusCodex(configPath)
	require.NoError(t, err)
	assert.Equal(t, []string{"bookmarks_notes", "prompts"}, servers)
}

func TestStatusCodex__not_configured(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("model = \"o3\"\n"), 0644))

	servers, err := StatusCodex(configPath)
	require.NoError(t, err)
	assert.Nil(t, servers)
}

func TestStatusCodex__missing_file(t *testing.T) {
	servers, err := StatusCodex("/nonexistent/config.toml")
	require.NoError(t, err)
	assert.Nil(t, servers)
}

func TestInstallCodex__malformed_toml_returns_error(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("not valid toml [[["), 0644))

	err := InstallCodex(configPath, "bm_test", "bm_test")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing")
}

func readTestTOML(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var result map[string]any
	require.NoError(t, toml.Unmarshal(data, &result))
	return result
}
