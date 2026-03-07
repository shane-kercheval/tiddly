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
	err := installCodex(rc, "bm_content123", "bm_prompt456")
	require.NoError(t, err)

	contentPAT, promptPAT := extractCodexPATs(rc)
	assert.Equal(t, "bm_content123", contentPAT)
	assert.Equal(t, "bm_prompt456", promptPAT)
}

func TestExtractCodexPATs__no_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("model = \"o3\"\n"), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	contentPAT, promptPAT := extractCodexPATs(rc)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractCodexPATs__missing_file(t *testing.T) {
	rc := ResolvedConfig{Path: "/nonexistent/config.toml", Scope: "user"}
	contentPAT, promptPAT := extractCodexPATs(rc)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractCodexPATs__malformed_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("not valid toml [[["), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	contentPAT, promptPAT := extractCodexPATs(rc)
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
	err := installCodex(rc, "bm_proj_content", "bm_proj_prompt")
	require.NoError(t, err)

	// Extract from project scope
	contentPAT, promptPAT := extractCodexPATs(rc)
	assert.Equal(t, "bm_proj_content", contentPAT)
	assert.Equal(t, "bm_proj_prompt", promptPAT)
}

// Install/Uninstall/Status tests

func TestInstallCodex__new_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := installCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)

	content := mcpServers["tiddly_notes_bookmarks"].(map[string]any)
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
	err := installCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, configPath)

	// Other settings preserved
	assert.Equal(t, "o3", config["model"])

	// Other MCP server preserved
	mcpServers := config["mcp_servers"].(map[string]any)
	assert.Contains(t, mcpServers, "other_server")
	assert.Contains(t, mcpServers, "tiddly_notes_bookmarks")
	assert.Contains(t, mcpServers, "tiddly_prompts")
}

func TestInstallCodex__idempotent(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	require.NoError(t, installCodex(rc, "bm_old", "bm_old"))
	require.NoError(t, installCodex(rc, "bm_new", "bm_new"))

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)
	content := mcpServers["tiddly_notes_bookmarks"].(map[string]any)
	headers := content["http_headers"].(map[string]any)

	assert.Equal(t, "Bearer bm_new", headers["Authorization"])
}

func TestInstallCodex__project_scope_creates_config(t *testing.T) {
	cwd := t.TempDir()
	projectConfig := filepath.Join(cwd, ".codex", "config.toml")

	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	err := installCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, projectConfig)
	mcpServers := config["mcp_servers"].(map[string]any)

	content := mcpServers["tiddly_notes_bookmarks"].(map[string]any)
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
	err := installCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, filepath.Join(codexDir, "config.toml"))
	assert.Equal(t, "o3", config["model"])

	mcpServers := config["mcp_servers"].(map[string]any)
	assert.Contains(t, mcpServers, "other_server")
	assert.Contains(t, mcpServers, "tiddly_notes_bookmarks")
	assert.Contains(t, mcpServers, "tiddly_prompts")
}

func TestUninstallCodex__removes_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	existing := `
[mcp_servers.tiddly_notes_bookmarks]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.tiddly_prompts]
url = "https://prompts-mcp.tiddly.me/mcp"

[mcp_servers.other]
url = "https://other.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(existing), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := uninstallCodex(rc)
	require.NoError(t, err)

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)

	assert.NotContains(t, mcpServers, "tiddly_notes_bookmarks")
	assert.NotContains(t, mcpServers, "tiddly_prompts")
	assert.Contains(t, mcpServers, "other")
}

func TestUninstallCodex__missing_file_is_noop(t *testing.T) {
	rc := ResolvedConfig{Path: "/nonexistent/config.toml", Scope: "user"}
	err := uninstallCodex(rc)
	assert.NoError(t, err)
}

func TestUninstallCodex__no_tiddly_servers_skips_write(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	existing := `
[mcp_servers.other]
url = "https://other.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(existing), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := uninstallCodex(rc)
	require.NoError(t, err)

	// No backup should be created since nothing was removed
	_, statErr := os.Stat(configPath + ".bak")
	assert.True(t, os.IsNotExist(statErr), "no backup should be created on no-op uninstall")
}

func TestUninstallCodex__project_scope(t *testing.T) {
	cwd := t.TempDir()
	projectConfig := filepath.Join(cwd, ".codex", "config.toml")

	// Install to project scope first
	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	err := installCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Uninstall from project scope
	err = uninstallCodex(rc)
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
[mcp_servers.tiddly_notes_bookmarks]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.tiddly_prompts]
url = "https://prompts-mcp.tiddly.me/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusCodex(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)
	assert.Equal(t, configPath, sr.ConfigPath)
	assert.Equal(t, "content", sr.Servers[0].ServerType)
	assert.True(t, sr.Servers[0].MatchMethod == MatchByName)
	assert.Equal(t, "prompts", sr.Servers[1].ServerType)
	assert.True(t, sr.Servers[1].MatchMethod == MatchByName)
}

func TestStatusCodex__not_configured(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("model = \"o3\"\n"), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusCodex(rc)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers)
	assert.Equal(t, configPath, sr.ConfigPath)
}

func TestStatusCodex__missing_file(t *testing.T) {
	rc := ResolvedConfig{Path: "/nonexistent/config.toml", Scope: "user"}
	sr, err := statusCodex(rc)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers)
	assert.Equal(t, "/nonexistent/config.toml", sr.ConfigPath)
}

func TestStatusCodex__project_scope(t *testing.T) {
	cwd := t.TempDir()
	projectConfig := filepath.Join(cwd, ".codex", "config.toml")

	// Install to project scope
	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	err := installCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Status from project scope
	sr, err := statusCodex(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)
	assert.Equal(t, "content", sr.Servers[0].ServerType)
	assert.Equal(t, "prompts", sr.Servers[1].ServerType)
}

func TestStatusCodex__url_based_detection(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	config := `
[mcp_servers.custom_content]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.custom_prompts]
url = "https://prompts-mcp.tiddly.me/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusCodex(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)

	for _, s := range sr.Servers {
		assert.True(t, s.MatchMethod == MatchByURL, "server %q should be detected by URL", s.Name)
		assert.False(t, s.MatchMethod == MatchByName)
	}
}

func TestUninstallCodex__removes_custom_named_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	config := `
[mcp_servers.my_content]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.my_prompts]
url = "https://prompts-mcp.tiddly.me/mcp"

[mcp_servers.other]
url = "https://other.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := uninstallCodex(rc)
	require.NoError(t, err)

	result := readTestTOML(t, configPath)
	mcpServers := result["mcp_servers"].(map[string]any)
	assert.NotContains(t, mcpServers, "my_content")
	assert.NotContains(t, mcpServers, "my_prompts")
	assert.Contains(t, mcpServers, "other")
}

func TestInstallCodex__replaces_custom_named_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	config := `
[mcp_servers.my_content]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.other]
url = "https://other.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := installCodex(rc, "bm_new_content", "bm_new_prompts")
	require.NoError(t, err)

	result := readTestTOML(t, configPath)
	mcpServers := result["mcp_servers"].(map[string]any)
	assert.NotContains(t, mcpServers, "my_content")
	assert.Contains(t, mcpServers, "tiddly_notes_bookmarks")
	assert.Contains(t, mcpServers, "tiddly_prompts")
	assert.Contains(t, mcpServers, "other")
}

func TestExtractCodexPATs__custom_named_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	config := `
[mcp_servers.my_content]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.my_content.http_headers]
Authorization = "Bearer bm_custom_content"

[mcp_servers.my_prompts]
url = "https://prompts-mcp.tiddly.me/mcp"

[mcp_servers.my_prompts.http_headers]
Authorization = "Bearer bm_custom_prompts"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	contentPAT, promptPAT := extractCodexPATs(rc)
	assert.Equal(t, "bm_custom_content", contentPAT)
	assert.Equal(t, "bm_custom_prompts", promptPAT)
}

func TestInstallCodex__malformed_toml_returns_error(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("not valid toml [[["), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	err := installCodex(rc, "bm_test", "bm_test")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing")
}

func TestDryRunCodex__project_scope(t *testing.T) {
	cwd := t.TempDir()
	projectConfig := filepath.Join(cwd, ".codex", "config.toml")

	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	before, after, err := dryRunCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Before should be empty (no existing file)
	assert.Empty(t, before)

	// After should contain our servers
	assert.Contains(t, after, "tiddly_notes_bookmarks")
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
