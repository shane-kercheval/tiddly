package mcp

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Configure tests

func TestConfigureAntigravity__new_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")

	_, err := configureAntigravity(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	assert.Equal(t, ContentMCPURL(), content["serverUrl"])
	headers := content["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_content", headers["Authorization"])

	// Antigravity uses serverUrl, not url/httpUrl, and no type field.
	assert.NotContains(t, content, "url")
	assert.NotContains(t, content, "httpUrl")
	assert.NotContains(t, content, "type")

	prompts := servers["tiddly_prompts"].(map[string]any)
	assert.Equal(t, PromptMCPURL(), prompts["serverUrl"])
}

func TestConfigureAntigravity__preserves_existing(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			// A non-canonical HTTP server under a custom name.
			"other_remote": map[string]any{
				"serverUrl": "https://other.example.com/mcp",
				"headers":   map[string]any{"Authorization": "Bearer keep-me"},
			},
			// A stdio server with command/args/env — must round-trip untouched.
			"local_stdio": map[string]any{
				"command": "npx",
				"args":    []any{"-y", "some-mcp"},
				"env":     map[string]any{"FOO": "bar"},
			},
		},
	})

	_, err := configureAntigravity(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	servers := readTestJSON(t, configPath)["mcpServers"].(map[string]any)

	// Canonical entries added.
	assert.Contains(t, servers, "tiddly_notes_bookmarks")
	assert.Contains(t, servers, "tiddly_prompts")

	// Non-canonical HTTP entry preserved verbatim.
	other := servers["other_remote"].(map[string]any)
	assert.Equal(t, "https://other.example.com/mcp", other["serverUrl"])

	// Stdio entry preserved with all its fields.
	stdio := servers["local_stdio"].(map[string]any)
	assert.Equal(t, "npx", stdio["command"])
	assert.Equal(t, []any{"-y", "some-mcp"}, stdio["args"])
	assert.Equal(t, map[string]any{"FOO": "bar"}, stdio["env"])
}

// agy leaves empty mcp_config.json files on disk; configure must treat an
// empty/whitespace file as a fresh start rather than hard-failing on a JSON
// parse error.
func TestConfigureAntigravity__empty_file_starts_fresh(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")
	require.NoError(t, os.WriteFile(configPath, []byte("  \n"), 0644))

	_, err := configureAntigravity(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	servers := readTestJSON(t, configPath)["mcpServers"].(map[string]any)
	assert.Contains(t, servers, "tiddly_notes_bookmarks")
	assert.Contains(t, servers, "tiddly_prompts")
}

// A non-empty malformed config must still fail rather than be clobbered.
func TestConfigureAntigravity__malformed_file_errors(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")
	require.NoError(t, os.WriteFile(configPath, []byte("{not valid json"), 0644))

	_, err := configureAntigravity(configPath, "bm_content", "bm_prompts")
	require.Error(t, err)
}

func TestConfigureAntigravity__content_only_preserves_existing_prompts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")

	_, err := configureAntigravity(configPath, "bm_content1", "bm_prompts1")
	require.NoError(t, err)

	// Re-run with content only; prompts entry must survive.
	_, err = configureAntigravity(configPath, "bm_content2", "")
	require.NoError(t, err)

	servers := readTestJSON(t, configPath)["mcpServers"].(map[string]any)
	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	assert.Equal(t, "Bearer bm_content2", content["headers"].(map[string]any)["Authorization"])
	prompts := servers["tiddly_prompts"].(map[string]any)
	assert.Equal(t, "Bearer bm_prompts1", prompts["headers"].(map[string]any)["Authorization"])
}

// Remove tests

func TestRemoveAntigravity__removes_canonical_only(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"tiddly_notes_bookmarks": map[string]any{
				"serverUrl": ContentMCPURL(),
				"headers":   map[string]any{"Authorization": "Bearer bm_content"},
			},
			"tiddly_prompts": map[string]any{
				"serverUrl": PromptMCPURL(),
				"headers":   map[string]any{"Authorization": "Bearer bm_prompts"},
			},
			"work_prompts": map[string]any{
				"serverUrl": PromptMCPURL(),
				"headers":   map[string]any{"Authorization": "Bearer bm_work"},
			},
		},
	})

	result, err := removeAntigravity(configPath, []string{ServerContent, ServerPrompts})
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"tiddly_notes_bookmarks", "tiddly_prompts"}, result.RemovedEntries)

	servers := readTestJSON(t, configPath)["mcpServers"].(map[string]any)
	assert.NotContains(t, servers, "tiddly_notes_bookmarks")
	assert.NotContains(t, servers, "tiddly_prompts")
	// Non-canonical Tiddly-URL entry preserved.
	assert.Contains(t, servers, "work_prompts")
}

func TestRemoveAntigravity__servers_filter(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")

	_, err := configureAntigravity(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	result, err := removeAntigravity(configPath, []string{ServerContent})
	require.NoError(t, err)
	assert.Equal(t, []string{"tiddly_notes_bookmarks"}, result.RemovedEntries)

	servers := readTestJSON(t, configPath)["mcpServers"].(map[string]any)
	assert.NotContains(t, servers, "tiddly_notes_bookmarks")
	assert.Contains(t, servers, "tiddly_prompts")
}

func TestRemoveAntigravity__missing_file_is_noop(t *testing.T) {
	result, err := removeAntigravity("/nonexistent/mcp_config.json", []string{ServerContent, ServerPrompts})
	require.NoError(t, err)
	assert.Empty(t, result.RemovedEntries)
}

func TestRemoveAntigravity__no_canonical_entries_skips_write(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"other": map[string]any{"serverUrl": "https://other.example.com/mcp"},
		},
	})

	result, err := removeAntigravity(configPath, []string{ServerContent, ServerPrompts})
	require.NoError(t, err)
	assert.Empty(t, result.RemovedEntries)
	assert.Empty(t, result.BackupPath)
}

// Status tests

func TestStatusAntigravity__canonical_and_url_match(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			// Canonical name → MatchByName.
			"tiddly_notes_bookmarks": map[string]any{
				"serverUrl": ContentMCPURL(),
				"headers":   map[string]any{"Authorization": "Bearer bm_content"},
			},
			// Custom name but Tiddly URL → MatchByURL.
			"work_prompts": map[string]any{
				"serverUrl": PromptMCPURL(),
				"headers":   map[string]any{"Authorization": "Bearer bm_work"},
			},
			// Non-Tiddly → OtherServers.
			"other": map[string]any{"serverUrl": "https://other.example.com/mcp"},
		},
	})

	result, err := statusAntigravity(configPath)
	require.NoError(t, err)
	require.Len(t, result.Servers, 2)
	require.Len(t, result.OtherServers, 1)

	byName := map[string]ServerMatch{}
	for _, s := range result.Servers {
		byName[s.Name] = s
	}
	assert.Equal(t, MatchByName, byName["tiddly_notes_bookmarks"].MatchMethod)
	assert.Equal(t, ServerContent, byName["tiddly_notes_bookmarks"].ServerType)
	assert.Equal(t, MatchByURL, byName["work_prompts"].MatchMethod)
	assert.Equal(t, ServerPrompts, byName["work_prompts"].ServerType)

	assert.Equal(t, "other", result.OtherServers[0].Name)
	assert.Equal(t, "http", result.OtherServers[0].Transport)
}

func TestStatusAntigravity__missing_file(t *testing.T) {
	result, err := statusAntigravity("/nonexistent/mcp_config.json")
	require.NoError(t, err)
	assert.Empty(t, result.Servers)
	assert.Empty(t, result.OtherServers)
}

// agy 1.0.0 reads only serverUrl; a Tiddly URL under the "url" key is silently
// ignored by agy, so status must NOT report it as a configured Tiddly server.
// It lands in OtherServers instead — status reflects what Antigravity loads.
func TestStatusAntigravity__url_keyed_tiddly_entry_is_other(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"misks_keyed": map[string]any{
				"url":     ContentMCPURL(),
				"headers": map[string]any{"Authorization": "Bearer bm_x"},
			},
		},
	})

	result, err := statusAntigravity(configPath)
	require.NoError(t, err)
	assert.Empty(t, result.Servers, "url-keyed entry must not classify as a Tiddly server")
	require.Len(t, result.OtherServers, 1)
	assert.Equal(t, "misks_keyed", result.OtherServers[0].Name)
}

// A malformed (non-empty, unparseable) config surfaces an error rather than
// silently reporting "not configured" — matches statusClaudeDesktop.
func TestStatusAntigravity__malformed_file_errors(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")
	require.NoError(t, os.WriteFile(configPath, []byte("{not valid json"), 0644))

	_, err := statusAntigravity(configPath)
	require.Error(t, err)
}

// An empty/whitespace file reads as "no servers" (agy creates such files), not
// an error.
func TestStatusAntigravity__empty_file_is_not_configured(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")
	require.NoError(t, os.WriteFile(configPath, []byte("  \n"), 0644))

	result, err := statusAntigravity(configPath)
	require.NoError(t, err)
	assert.Empty(t, result.Servers)
}

func TestStatusAntigravity__not_configured(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")
	writeTestJSON(t, configPath, map[string]any{})

	result, err := statusAntigravity(configPath)
	require.NoError(t, err)
	assert.Empty(t, result.Servers)
}

// PAT extraction tests

func TestExtractAntigravityPATs__valid_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")

	_, err := configureAntigravity(configPath, "bm_content123", "bm_prompt456")
	require.NoError(t, err)

	ext := extractAntigravityPATs(configPath)
	assert.Equal(t, "bm_content123", ext.ContentPAT)
	assert.Equal(t, "bm_prompt456", ext.PromptPAT)
}

func TestExtractAntigravityPATs__ignores_non_canonical(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")

	// Only a non-canonical Tiddly-URL entry; canonical PATs must be empty.
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"work_prompts": map[string]any{
				"serverUrl": PromptMCPURL(),
				"headers":   map[string]any{"Authorization": "Bearer bm_work"},
			},
		},
	})

	ext := extractAntigravityPATs(configPath)
	assert.Empty(t, ext.ContentPAT)
	assert.Empty(t, ext.PromptPAT)
}

func TestExtractAllAntigravityTiddlyPATs__includes_non_canonical(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"tiddly_prompts": map[string]any{
				"serverUrl": PromptMCPURL(),
				"headers":   map[string]any{"Authorization": "Bearer bm_canonical"},
			},
			"work_prompts": map[string]any{
				"serverUrl": PromptMCPURL(),
				"headers":   map[string]any{"Authorization": "Bearer bm_work"},
			},
		},
	})

	all := extractAllAntigravityTiddlyPATs(configPath)
	require.Len(t, all, 2)
	// Canonical entry sorts first.
	assert.Equal(t, "tiddly_prompts", all[0].Name)
	assert.Equal(t, "bm_canonical", all[0].PAT)
	assert.Equal(t, "work_prompts", all[1].Name)
}

func TestExtractAntigravityPATs__missing_file(t *testing.T) {
	ext := extractAntigravityPATs("/nonexistent/mcp_config.json")
	assert.Empty(t, ext.ContentPAT)
	assert.Empty(t, ext.PromptPAT)
}

func TestExtractAntigravityPATs__malformed_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")
	require.NoError(t, os.WriteFile(configPath, []byte("{not valid json"), 0644))

	ext := extractAntigravityPATs(configPath)
	assert.Empty(t, ext.ContentPAT)
	assert.Empty(t, ext.PromptPAT)
}

// Dry-run test

func TestDryRunAntigravity__shows_before_after(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "mcp_config.json")
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"existing": map[string]any{"serverUrl": "https://other.example.com/mcp"},
		},
	})

	before, after, err := dryRunAntigravity(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	assert.Contains(t, before, "existing")
	assert.NotContains(t, before, "tiddly_notes_bookmarks")

	assert.Contains(t, after, "existing")
	assert.Contains(t, after, "tiddly_notes_bookmarks")
	assert.Contains(t, after, "tiddly_prompts")
	assert.Contains(t, after, "serverUrl")

	// No write occurred.
	assert.Equal(t, map[string]any{"existing": map[string]any{"serverUrl": "https://other.example.com/mcp"}},
		readTestJSON(t, configPath)["mcpServers"])
}

// Detection tests

func TestAntigravityDetect__binary_in_path(t *testing.T) {
	looker := newMockLooker()
	looker.paths["agy"] = "/usr/local/bin/agy"

	h := &AntigravityHandler{}
	tool := h.Detect(looker)
	assert.True(t, tool.Detected)
	assert.Equal(t, "binary in PATH", tool.Reason)
}

func TestAntigravityDetect__cli_dir_exists(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	require.NoError(t, os.MkdirAll(filepath.Join(home, ".gemini", "antigravity-cli"), 0755))

	h := &AntigravityHandler{}
	tool := h.Detect(newMockLooker())
	assert.True(t, tool.Detected)
	assert.Equal(t, "config directory exists", tool.Reason)
}

func TestAntigravityDetect__ide_dir_exists(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	require.NoError(t, os.MkdirAll(filepath.Join(home, ".gemini", "antigravity"), 0755))

	h := &AntigravityHandler{}
	tool := h.Detect(newMockLooker())
	assert.True(t, tool.Detected)
	assert.Equal(t, "config directory exists", tool.Reason)
}

// A vanilla ~/.gemini/ holding only legacy Gemini CLI artifacts (config/,
// settings.json) must NOT be detected as Antigravity — that's the false
// positive the antigravity-specific dir probe is designed to avoid.
func TestAntigravityDetect__legacy_gemini_only_not_detected(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	require.NoError(t, os.MkdirAll(filepath.Join(home, ".gemini", "config"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(home, ".gemini", "settings.json"), []byte("{}"), 0644))

	h := &AntigravityHandler{}
	tool := h.Detect(newMockLooker())
	assert.False(t, tool.Detected)
}

func TestAntigravityDetect__nothing_present(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	h := &AntigravityHandler{}
	tool := h.Detect(newMockLooker())
	assert.False(t, tool.Detected)
}

// Scope test

func TestAntigravity__user_scope_only(t *testing.T) {
	h := &AntigravityHandler{}
	assert.Equal(t, []string{"user"}, h.SupportedScopes())
}
