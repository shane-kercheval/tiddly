package mcp

import (
	"fmt"
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
	_, err := configureCodex(rc, "bm_content123", "bm_prompt456")
	require.NoError(t, err)

	ext := extractCodexPATs(rc)
	assert.Equal(t, "bm_content123", ext.ContentPAT)
	assert.Equal(t, "bm_prompt456", ext.PromptPAT)
}

func TestExtractCodexPATs__no_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("model = \"o3\"\n"), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	ext := extractCodexPATs(rc)
	assert.Empty(t, ext.ContentPAT)
	assert.Empty(t, ext.PromptPAT)
}

func TestExtractCodexPATs__missing_file(t *testing.T) {
	rc := ResolvedConfig{Path: "/nonexistent/config.toml", Scope: "user"}
	ext := extractCodexPATs(rc)
	assert.Empty(t, ext.ContentPAT)
	assert.Empty(t, ext.PromptPAT)
}

func TestExtractCodexPATs__malformed_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("not valid toml [[["), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	ext := extractCodexPATs(rc)
	assert.Empty(t, ext.ContentPAT)
	assert.Empty(t, ext.PromptPAT)
}

func TestExtractCodexPATs__project_scope(t *testing.T) {
	cwd := t.TempDir()
	codexDir := filepath.Join(cwd, ".codex")
	require.NoError(t, os.MkdirAll(codexDir, 0700))

	projectPath := filepath.Join(cwd, ".codex", "config.toml")
	rc := ResolvedConfig{Path: projectPath, Scope: "project", Cwd: cwd}

	// Configure for project scope
	_, err := configureCodex(rc, "bm_proj_content", "bm_proj_prompt")
	require.NoError(t, err)

	// Extract from project scope
	ext := extractCodexPATs(rc)
	assert.Equal(t, "bm_proj_content", ext.ContentPAT)
	assert.Equal(t, "bm_proj_prompt", ext.PromptPAT)
}

// Configure/Remove/Status tests

func TestConfigureCodex__new_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
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

func TestConfigureCodex__preserves_existing(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	existing := `
model = "o3"

[mcp_servers.other_server]
url = "https://other.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(existing), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
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

func TestConfigureCodex__content_only_preserves_existing_prompts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	// Configure both servers first
	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Re-configure with only content PAT (simulates --servers content)
	_, err = configureCodex(rc, "bm_new_content", "")
	require.NoError(t, err)

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)

	// Content should be updated
	content := mcpServers["tiddly_notes_bookmarks"].(map[string]any)
	headers := content["http_headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_new_content", headers["Authorization"])

	// Prompts should be preserved from the first configure
	assert.Contains(t, mcpServers, "tiddly_prompts", "prompts server should be preserved")
	prompts := mcpServers["tiddly_prompts"].(map[string]any)
	promptHeaders := prompts["http_headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_prompts", promptHeaders["Authorization"])
}

func TestConfigureCodex__prompts_only_preserves_existing_content(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	// Configure both servers first
	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Re-configure with only prompts PAT (simulates --servers prompts)
	_, err = configureCodex(rc, "", "bm_new_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)

	// Content should be preserved from the first configure
	assert.Contains(t, mcpServers, "tiddly_notes_bookmarks", "content server should be preserved")
	content := mcpServers["tiddly_notes_bookmarks"].(map[string]any)
	headers := content["http_headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_content", headers["Authorization"])

	// Prompts should be updated
	prompts := mcpServers["tiddly_prompts"].(map[string]any)
	promptHeaders := prompts["http_headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_new_prompts", promptHeaders["Authorization"])
}

func TestConfigureCodex__idempotent(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureCodex(rc, "bm_old", "bm_old")
	require.NoError(t, err)
	_, err = configureCodex(rc, "bm_new", "bm_new")
	require.NoError(t, err)

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)
	content := mcpServers["tiddly_notes_bookmarks"].(map[string]any)
	headers := content["http_headers"].(map[string]any)

	assert.Equal(t, "Bearer bm_new", headers["Authorization"])
}

func TestConfigureCodex__project_scope_creates_config(t *testing.T) {
	cwd := t.TempDir()
	projectConfig := filepath.Join(cwd, ".codex", "config.toml")

	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, projectConfig)
	mcpServers := config["mcp_servers"].(map[string]any)

	content := mcpServers["tiddly_notes_bookmarks"].(map[string]any)
	assert.Equal(t, ContentMCPURL(), content["url"])

	prompts := mcpServers["tiddly_prompts"].(map[string]any)
	assert.Equal(t, PromptMCPURL(), prompts["url"])
}

func TestConfigureCodex__project_scope_preserves_existing(t *testing.T) {
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
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, filepath.Join(codexDir, "config.toml"))
	assert.Equal(t, "o3", config["model"])

	mcpServers := config["mcp_servers"].(map[string]any)
	assert.Contains(t, mcpServers, "other_server")
	assert.Contains(t, mcpServers, "tiddly_notes_bookmarks")
	assert.Contains(t, mcpServers, "tiddly_prompts")
}

func TestRemoveCodex__removes_tiddly_servers(t *testing.T) {
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
	_, err := removeCodex(rc, []string{"content", "prompts"})
	require.NoError(t, err)

	config := readTestTOML(t, configPath)
	mcpServers := config["mcp_servers"].(map[string]any)

	assert.NotContains(t, mcpServers, "tiddly_notes_bookmarks")
	assert.NotContains(t, mcpServers, "tiddly_prompts")
	assert.Contains(t, mcpServers, "other")
}

func TestRemoveCodex__missing_file_is_noop(t *testing.T) {
	rc := ResolvedConfig{Path: "/nonexistent/config.toml", Scope: "user"}
	_, err := removeCodex(rc, []string{"content", "prompts"})
	assert.NoError(t, err)
}

func TestRemoveCodex__no_tiddly_servers_skips_write(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	existing := `
[mcp_servers.other]
url = "https://other.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(existing), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := removeCodex(rc, []string{"content", "prompts"})
	require.NoError(t, err)

	// No backup should be created since nothing was removed
	backupMatches, _ := filepath.Glob(configPath + ".bak.*")
	assert.Empty(t, backupMatches, "no backup should be created on no-op remove")
}

func TestRemoveCodex__project_scope(t *testing.T) {
	cwd := t.TempDir()
	projectConfig := filepath.Join(cwd, ".codex", "config.toml")

	// Configure for project scope first
	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Remove from project scope
	_, err = removeCodex(rc, []string{"content", "prompts"})
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

	// Configure for project scope
	rc := ResolvedConfig{Path: projectConfig, Scope: "project", Cwd: cwd}
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
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

func TestStatusCodex__work_and_personal_prompts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	config := `
[mcp_servers.work_prompts]
url = "https://prompts-mcp.tiddly.me/mcp"

[mcp_servers.work_prompts.http_headers]
Authorization = "Bearer bm_work"

[mcp_servers.personal_prompts]
url = "https://prompts-mcp.tiddly.me/mcp"

[mcp_servers.personal_prompts.http_headers]
Authorization = "Bearer bm_personal"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusCodex(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)
	assert.Equal(t, "personal_prompts", sr.Servers[0].Name)
	assert.Equal(t, ServerPrompts, sr.Servers[0].ServerType)
	assert.Equal(t, "work_prompts", sr.Servers[1].Name)
	assert.Equal(t, ServerPrompts, sr.Servers[1].ServerType)
	assert.Empty(t, sr.OtherServers)
}

func TestStatusCodex__includes_url_on_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	sr, err := statusCodex(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)
	assert.Equal(t, ContentMCPURL(), sr.Servers[0].URL)
	assert.Equal(t, PromptMCPURL(), sr.Servers[1].URL)
}

func TestStatusCodex__collects_other_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	config := `
[mcp_servers.tiddly_notes_bookmarks]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.postgres]
url = "https://postgres.example.com/mcp"

[mcp_servers.analytics]
url = "https://analytics.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusCodex(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 1)
	assert.Len(t, sr.OtherServers, 2)
	// Alphabetical order
	assert.Equal(t, "analytics", sr.OtherServers[0].Name)
	assert.Equal(t, "http", sr.OtherServers[0].Transport)
	assert.Equal(t, "postgres", sr.OtherServers[1].Name)
	assert.Equal(t, "http", sr.OtherServers[1].Transport)
}

func TestStatusCodex__only_other_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	config := `
[mcp_servers.my_tool]
url = "https://my-tool.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusCodex(rc)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers)
	assert.Len(t, sr.OtherServers, 1)
	assert.Equal(t, "my_tool", sr.OtherServers[0].Name)
	assert.Equal(t, "http", sr.OtherServers[0].Transport)
}

func TestRemoveCodex__preserves_non_canonical_entries(t *testing.T) {
	// Canonical-name-only: custom-named entries — even at Tiddly URLs —
	// survive because they're user-managed, not CLI-managed.
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	config := `
[mcp_servers.tiddly_notes_bookmarks]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.my_content]
url = "https://content-mcp.tiddly.me/mcp"

[mcp_servers.my_prompts]
url = "https://prompts-mcp.tiddly.me/mcp"

[mcp_servers.other]
url = "https://other.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	res, err := removeCodex(rc, []string{"content", "prompts"})
	require.NoError(t, err)
	assert.Equal(t, []string{serverNameContent}, res.RemovedEntries)

	result := readTestTOML(t, configPath)
	mcpServers := result["mcp_servers"].(map[string]any)
	assert.NotContains(t, mcpServers, serverNameContent, "canonical entry must be removed")
	assert.Contains(t, mcpServers, "my_content", "non-canonical Tiddly-URL entry must survive")
	assert.Contains(t, mcpServers, "my_prompts", "non-canonical Tiddly-URL entry must survive")
	assert.Contains(t, mcpServers, "other")
}

func TestRemoveCodex__deletes_canonical_entry_with_non_tiddly_url(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	config := `
[mcp_servers.tiddly_prompts]
url = "https://example.com/my-prompts"

[mcp_servers.tiddly_prompts.http_headers]
Authorization = "Bearer bm_user_custom"
`
	require.NoError(t, os.WriteFile(configPath, []byte(config), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	res, err := removeCodex(rc, []string{"prompts"})
	require.NoError(t, err)
	assert.Equal(t, []string{serverNamePrompts}, res.RemovedEntries)
	assert.NotEmpty(t, res.BackupPath)
}

func TestRemoveCodex__content_only_preserves_prompts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	_, err = removeCodex(rc, []string{"content"})
	require.NoError(t, err)

	result := readTestTOML(t, configPath)
	mcpServers := result["mcp_servers"].(map[string]any)
	assert.NotContains(t, mcpServers, serverNameContent)
	assert.Contains(t, mcpServers, serverNamePrompts)
}

func TestRemoveCodex__prompts_only_preserves_content(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	_, err = removeCodex(rc, []string{"prompts"})
	require.NoError(t, err)

	result := readTestTOML(t, configPath)
	mcpServers := result["mcp_servers"].(map[string]any)
	assert.Contains(t, mcpServers, serverNameContent)
	assert.NotContains(t, mcpServers, serverNamePrompts)
}

func TestConfigureCodex__preserves_custom_named_tiddly_url_entries(t *testing.T) {
	// Additive contract: custom-named Tiddly-URL entries survive configure.
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
	_, err := configureCodex(rc, "bm_new_content", "bm_new_prompts")
	require.NoError(t, err)

	result := readTestTOML(t, configPath)
	mcpServers := result["mcp_servers"].(map[string]any)
	assert.Contains(t, mcpServers, "my_content", "custom-named Tiddly-URL entry must survive")
	assert.Contains(t, mcpServers, "tiddly_notes_bookmarks")
	assert.Contains(t, mcpServers, "tiddly_prompts")
	assert.Contains(t, mcpServers, "other")
}

func TestExtractCodexPATs__ignores_custom_named_servers(t *testing.T) {
	// ExtractPATs reads canonical entries only.
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
	ext := extractCodexPATs(rc)
	assert.Empty(t, ext.ContentPAT)
	assert.Empty(t, ext.PromptPAT)
}

func TestConfigureCodex__malformed_toml_returns_error(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("not valid toml [[["), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureCodex(rc, "bm_test", "bm_test")
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

// TestConfigureCodex__preserves_stdio_server is the regression guard for the
// data-loss bug: configuring Tiddly must not destroy a non-managed *stdio*
// (command-based) MCP server like Codex's built-in node_repl. The earlier typed
// writer rewrote it to `url = ''`, dropping command/args/env.
func TestConfigureCodex__preserves_stdio_server(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	existing := `model = "gpt-5-codex"

[mcp_servers.node_repl]
command = "/Applications/Codex.app/Contents/Resources/node_repl"
args = ["--flag"]
startup_timeout_sec = 120

[mcp_servers.node_repl.env]
CODEX_HOME = "/Users/me/.codex"

[mcp_servers.work_http]
url = "https://work.example.com/mcp"
`
	require.NoError(t, os.WriteFile(configPath, []byte(existing), 0600))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureCodex(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestTOML(t, configPath)
	servers := config["mcp_servers"].(map[string]any)

	// The stdio server survives intact — command/args/env all preserved.
	node := servers["node_repl"].(map[string]any)
	assert.Equal(t, "/Applications/Codex.app/Contents/Resources/node_repl", node["command"])
	assert.Equal(t, []any{"--flag"}, node["args"])
	assert.Equal(t, int64(120), node["startup_timeout_sec"])
	assert.Equal(t, "/Users/me/.codex", node["env"].(map[string]any)["CODEX_HOME"])
	assert.Nil(t, node["url"], "stdio server must not gain a bogus url")

	// Foreign HTTP server preserved, and tiddly entries added.
	assert.Equal(t, "https://work.example.com/mcp", servers["work_http"].(map[string]any)["url"])
	assert.Contains(t, servers, "tiddly_notes_bookmarks")
	assert.Contains(t, servers, "tiddly_prompts")
}

func TestValidateCodexConfig(t *testing.T) {
	// Valid: an HTTP server (url) and a stdio server (command) side by side.
	valid := []byte(`[mcp_servers.http_one]
url = "https://x/mcp"

[mcp_servers.stdio_one]
command = "/bin/thing"
`)
	require.NoError(t, validateCodexConfig(valid))

	// No servers section is fine.
	require.NoError(t, validateCodexConfig([]byte(`model = "x"`)))

	// Corrupt: a server with neither url nor command (the bug's signature).
	corrupt := []byte(`[mcp_servers.broken]
url = ""
`)
	err := validateCodexConfig(corrupt)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "broken")
}

// TestWriteCodexConfig__restores_backup_on_corrupting_write proves the runtime
// guard: if the write step somehow produces a config that drops/corrupts a
// non-managed server, writeCodexConfig restores the backup and errors instead of
// leaving the user's config broken.
func TestWriteCodexConfig__restores_backup_on_corrupting_write(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	original := `[mcp_servers.node_repl]
command = "/bin/node_repl"
`
	require.NoError(t, os.WriteFile(configPath, []byte(original), 0600))

	// Hook the writer: corrupt the first write (node_repl reduced to url=''),
	// pass the restore write (second call) through so the backup is actually written.
	prev := AtomicWriteFileFunc()
	t.Cleanup(func() { SetAtomicWriteFileFunc(prev) })
	calls := 0
	SetAtomicWriteFileFunc(func(path string, data []byte, perm os.FileMode) error {
		calls++
		if calls == 1 {
			return prev(path, []byte("[mcp_servers.node_repl]\nurl = ''\n"), perm)
		}
		return prev(path, data, perm)
	})

	cfg, err := buildCodexConfig(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)
	_, err = writeCodexConfig(configPath, cfg)

	require.Error(t, err, "guard must reject the corrupting write")
	assert.Contains(t, err.Error(), "integrity check failed")
	assert.Contains(t, err.Error(), "restored previous config")

	// The file on disk was restored to the original (node_repl intact).
	restored := readTestTOML(t, configPath)
	node := restored["mcp_servers"].(map[string]any)["node_repl"].(map[string]any)
	assert.Equal(t, "/bin/node_repl", node["command"], "backup should have been restored")
}

// TestWriteCodexConfig__reports_when_restore_also_fails proves the guard tells
// the truth in its worst case: corruption detected AND the rollback failed. It
// must not claim a successful restore, and must still error (non-zero exit).
func TestWriteCodexConfig__reports_when_restore_also_fails(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")
	require.NoError(t, os.WriteFile(configPath, []byte("[mcp_servers.node_repl]\ncommand = \"/bin/node_repl\"\n"), 0600))

	prev := AtomicWriteFileFunc()
	t.Cleanup(func() { SetAtomicWriteFileFunc(prev) })
	calls := 0
	SetAtomicWriteFileFunc(func(path string, data []byte, perm os.FileMode) error {
		calls++
		if calls == 1 {
			return prev(path, []byte("[mcp_servers.node_repl]\nurl = ''\n"), perm) // corrupt write
		}
		return fmt.Errorf("simulated restore failure") // second call = the restore
	})

	cfg, err := buildCodexConfig(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)
	_, err = writeCodexConfig(configPath, cfg)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "AUTOMATIC RESTORE ALSO FAILED")
	assert.NotContains(t, err.Error(), "restored previous config", "must not claim a restore that failed")
}

// TestWriteCodexConfig__no_backup_when_new_file_corrupts covers the second
// false-success path: a brand-new config (no prior file) that the writer
// corrupts. There's nothing to restore, so the error must say so — not claim a
// restore — and must still be non-nil.
func TestWriteCodexConfig__no_backup_when_new_file_corrupts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml") // does not exist → no backup taken

	prev := AtomicWriteFileFunc()
	t.Cleanup(func() { SetAtomicWriteFileFunc(prev) })
	SetAtomicWriteFileFunc(func(path string, _ []byte, perm os.FileMode) error {
		return prev(path, []byte("[mcp_servers.broken]\nurl = ''\n"), perm)
	})

	cfg, err := buildCodexConfig(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)
	_, err = writeCodexConfig(configPath, cfg)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "no prior config existed")
}
