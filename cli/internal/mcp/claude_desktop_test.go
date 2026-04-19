package mcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConfigureClaudeDesktop__new_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	_, err := configureClaudeDesktop(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	assert.Contains(t, servers, "tiddly_notes_bookmarks")
	assert.Contains(t, servers, "tiddly_prompts")

	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	assert.Equal(t, "npx", content["command"])
	args := toStringSlice(content["args"])
	assert.Contains(t, args[1], "content-mcp.tiddly.me")
	assert.Contains(t, args[3], "bm_content")
}

func TestConfigureClaudeDesktop__preserves_existing(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// Write existing config with another server
	existing := map[string]any{
		"mcpServers": map[string]any{
			"other-server": map[string]any{
				"command": "node",
				"args":    []string{"other.js"},
			},
		},
		"someOtherSetting": true,
	}
	writeTestJSON(t, configPath, existing)

	_, err := configureClaudeDesktop(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)

	// Other server preserved
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, "other-server")
	assert.Contains(t, servers, "tiddly_notes_bookmarks")
	assert.Contains(t, servers, "tiddly_prompts")

	// Other settings preserved
	assert.Equal(t, true, config["someOtherSetting"])
}

func TestConfigureClaudeDesktop__content_only_preserves_existing_prompts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// Configure both servers first
	_, err := configureClaudeDesktop(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Re-configure with only content PAT (simulates --servers content)
	_, err = configureClaudeDesktop(configPath, "bm_new_content", "")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	// Content should be updated
	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	args := toStringSlice(content["args"])
	assert.Contains(t, args[3], "bm_new_content")

	// Prompts should be preserved from the first configure
	assert.Contains(t, servers, "tiddly_prompts", "prompts server should be preserved")
	prompts := servers["tiddly_prompts"].(map[string]any)
	promptArgs := toStringSlice(prompts["args"])
	assert.Contains(t, promptArgs[3], "bm_prompts")
}

func TestConfigureClaudeDesktop__prompts_only_preserves_existing_content(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// Configure both servers first
	_, err := configureClaudeDesktop(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Re-configure with only prompts PAT (simulates --servers prompts)
	_, err = configureClaudeDesktop(configPath, "", "bm_new_prompts")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	// Content should be preserved from the first configure
	assert.Contains(t, servers, "tiddly_notes_bookmarks", "content server should be preserved")
	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	contentArgs := toStringSlice(content["args"])
	assert.Contains(t, contentArgs[3], "bm_content")

	// Prompts should be updated
	prompts := servers["tiddly_prompts"].(map[string]any)
	promptArgs := toStringSlice(prompts["args"])
	assert.Contains(t, promptArgs[3], "bm_new_prompts")
}

func TestConfigureClaudeDesktop__idempotent(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// Configure twice
	_, err := configureClaudeDesktop(configPath, "bm_old", "bm_old")
	require.NoError(t, err)
	_, err = configureClaudeDesktop(configPath, "bm_new", "bm_new")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	args := toStringSlice(content["args"])

	// Should have the new token
	assert.Contains(t, args[3], "bm_new")
}

func TestRemoveClaudeDesktop__removes_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	existing := map[string]any{
		"mcpServers": map[string]any{
			"tiddly_notes_bookmarks": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", ContentMCPURL(), "--header", "Authorization: Bearer tok"},
			},
			"tiddly_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", PromptMCPURL(), "--header", "Authorization: Bearer tok"},
			},
			"other-server": map[string]any{"command": "node"},
		},
	}
	writeTestJSON(t, configPath, existing)

	_, err := removeClaudeDesktop(configPath, nil)
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	assert.NotContains(t, servers, "tiddly_notes_bookmarks")
	assert.NotContains(t, servers, "tiddly_prompts")
	assert.Contains(t, servers, "other-server")
}

func TestRemoveClaudeDesktop__missing_file_is_noop(t *testing.T) {
	_, err := removeClaudeDesktop("/nonexistent/path.json", nil)
	assert.NoError(t, err)
}

func TestRemoveClaudeDesktop__no_tiddly_servers_skips_write(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	existing := map[string]any{
		"mcpServers": map[string]any{
			"other-server": map[string]any{"command": "node"},
		},
	}
	writeTestJSON(t, configPath, existing)

	_, err := removeClaudeDesktop(configPath, nil)
	require.NoError(t, err)

	// No backup should be created since nothing was removed
	backupMatches, _ := filepath.Glob(configPath + ".bak.*")
	assert.Empty(t, backupMatches, "no backup should be created on no-op remove")
}

func TestStatusClaudeDesktop__configured(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	config := map[string]any{
		"mcpServers": map[string]any{
			"tiddly_notes_bookmarks": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", ContentMCPURL()},
			},
			"tiddly_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", PromptMCPURL()},
			},
		},
	}
	writeTestJSON(t, configPath, config)

	sr, err := statusClaudeDesktop(configPath)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)
	assert.Equal(t, configPath, sr.ConfigPath)
	assert.Equal(t, "content", sr.Servers[0].ServerType)
	assert.True(t, sr.Servers[0].MatchMethod == MatchByName)
	assert.Equal(t, "prompts", sr.Servers[1].ServerType)
	assert.True(t, sr.Servers[1].MatchMethod == MatchByName)
}

func TestStatusClaudeDesktop__not_configured(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")
	writeTestJSON(t, configPath, map[string]any{})

	sr, err := statusClaudeDesktop(configPath)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers)
	assert.Equal(t, configPath, sr.ConfigPath)
}

func TestStatusClaudeDesktop__missing_file(t *testing.T) {
	sr, err := statusClaudeDesktop("/nonexistent/path.json")
	require.NoError(t, err)
	assert.Empty(t, sr.Servers)
	assert.Equal(t, "/nonexistent/path.json", sr.ConfigPath)
}

func TestStatusClaudeDesktop__url_based_detection(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"my_content_server": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", ContentMCPURL(), "--header", "Authorization: Bearer tok"},
			},
			"my_prompts_server": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", PromptMCPURL(), "--header", "Authorization: Bearer tok"},
			},
		},
	})

	sr, err := statusClaudeDesktop(configPath)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)

	for _, s := range sr.Servers {
		assert.True(t, s.MatchMethod == MatchByURL, "server %q should be detected by URL", s.Name)
		assert.False(t, s.MatchMethod == MatchByName)
	}
}

func TestStatusClaudeDesktop__work_and_personal_prompts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	// Two tiddly prompt entries under distinct names (e.g. work + personal
	// accounts with different PATs) should both surface.
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"work_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", PromptMCPURL(), "--header", "Authorization: Bearer bm_work"},
			},
			"personal_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", PromptMCPURL(), "--header", "Authorization: Bearer bm_personal"},
			},
		},
	})

	sr, err := statusClaudeDesktop(configPath)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)
	assert.Equal(t, "personal_prompts", sr.Servers[0].Name)
	assert.Equal(t, ServerPrompts, sr.Servers[0].ServerType)
	assert.Equal(t, "work_prompts", sr.Servers[1].Name)
	assert.Equal(t, ServerPrompts, sr.Servers[1].ServerType)
	assert.Empty(t, sr.OtherServers)
}

func TestStatusClaudeDesktop__includes_url_on_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	_, err := configureClaudeDesktop(configPath, "bm_content", "bm_prompts")
	require.NoError(t, err)

	sr, err := statusClaudeDesktop(configPath)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)
	assert.Equal(t, ContentMCPURL(), sr.Servers[0].URL)
	assert.Equal(t, PromptMCPURL(), sr.Servers[1].URL)
}

func TestStatusClaudeDesktop__collects_other_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			serverNameContent: map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", ContentMCPURL(), "--header", "Authorization: Bearer tok"},
			},
			"github": map[string]any{
				"command": "node",
				"args":    []string{"github-server.js"},
			},
			"sentry": map[string]any{
				"command": "npx",
				"args":    []string{"sentry-mcp"},
			},
		},
	})

	sr, err := statusClaudeDesktop(configPath)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 1)
	assert.Len(t, sr.OtherServers, 2)
	assert.Equal(t, "github", sr.OtherServers[0].Name)
	assert.Equal(t, "stdio", sr.OtherServers[0].Transport)
	assert.Equal(t, "sentry", sr.OtherServers[1].Name)
	assert.Equal(t, "stdio", sr.OtherServers[1].Transport)
}

func TestStatusClaudeDesktop__only_other_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"my-tool": map[string]any{
				"command": "npx",
				"args":    []string{"my-mcp-tool"},
			},
		},
	})

	sr, err := statusClaudeDesktop(configPath)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers)
	assert.Len(t, sr.OtherServers, 1)
	assert.Equal(t, "my-tool", sr.OtherServers[0].Name)
}

func TestRemoveClaudeDesktop__removes_custom_named_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"my_content": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", ContentMCPURL()},
			},
			"my_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", PromptMCPURL()},
			},
			"other-server": map[string]any{"command": "node"},
		},
	})

	_, err := removeClaudeDesktop(configPath, nil)
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.NotContains(t, servers, "my_content")
	assert.NotContains(t, servers, "my_prompts")
	assert.Contains(t, servers, "other-server")
}

func TestRemoveClaudeDesktop__content_only_preserves_prompts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			serverNameContent: map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", ContentMCPURL(), "--header", "Authorization: Bearer tok"},
			},
			serverNamePrompts: map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", PromptMCPURL(), "--header", "Authorization: Bearer tok"},
			},
		},
	})

	_, err := removeClaudeDesktop(configPath, []string{"content"})
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.NotContains(t, servers, serverNameContent)
	assert.Contains(t, servers, serverNamePrompts)
}

func TestRemoveClaudeDesktop__prompts_only_preserves_content(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			serverNameContent: map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", ContentMCPURL(), "--header", "Authorization: Bearer tok"},
			},
			serverNamePrompts: map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", PromptMCPURL(), "--header", "Authorization: Bearer tok"},
			},
		},
	})

	_, err := removeClaudeDesktop(configPath, []string{"prompts"})
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, serverNameContent)
	assert.NotContains(t, servers, serverNamePrompts)
}

func TestConfigureClaudeDesktop__replaces_custom_named_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"my_content": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", ContentMCPURL(), "--header", "Authorization: Bearer old_token"},
			},
			"other-server": map[string]any{"command": "node"},
		},
	})

	_, err := configureClaudeDesktop(configPath, "bm_new_content", "bm_new_prompts")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	assert.NotContains(t, servers, "my_content")
	assert.Contains(t, servers, "tiddly_notes_bookmarks")
	assert.Contains(t, servers, "tiddly_prompts")
	assert.Contains(t, servers, "other-server")
}

func TestExtractClaudeDesktopPATs__custom_named_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"my_content": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", ContentMCPURL(), "--header", "Authorization: Bearer bm_custom_content"},
			},
			"my_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", PromptMCPURL(), "--header", "Authorization: Bearer bm_custom_prompts"},
			},
		},
	})

	contentPAT, promptPAT := extractClaudeDesktopPATs(configPath)
	assert.Equal(t, "bm_custom_content", contentPAT)
	assert.Equal(t, "bm_custom_prompts", promptPAT)
}

func TestConfigureClaudeDesktop__malformed_json_returns_error(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")
	require.NoError(t, os.WriteFile(configPath, []byte("not json{"), 0644))

	_, err := configureClaudeDesktop(configPath, "bm_test", "bm_test")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing")
}

// PAT extraction tests

func TestExtractClaudeDesktopPATs__valid_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	config := map[string]any{
		"mcpServers": map[string]any{
			"tiddly_notes_bookmarks": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://content-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_content123"},
			},
			"tiddly_prompts": map[string]any{
				"command": "npx",
				"args":    []string{"mcp-remote", "https://prompts-mcp.tiddly.me/mcp", "--header", "Authorization: Bearer bm_prompt456"},
			},
		},
	}
	writeTestJSON(t, configPath, config)

	contentPAT, promptPAT := extractClaudeDesktopPATs(configPath)
	assert.Equal(t, "bm_content123", contentPAT)
	assert.Equal(t, "bm_prompt456", promptPAT)
}

func TestExtractClaudeDesktopPATs__no_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")

	config := map[string]any{
		"mcpServers": map[string]any{
			"other-server": map[string]any{"command": "node"},
		},
	}
	writeTestJSON(t, configPath, config)

	contentPAT, promptPAT := extractClaudeDesktopPATs(configPath)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractClaudeDesktopPATs__missing_file(t *testing.T) {
	contentPAT, promptPAT := extractClaudeDesktopPATs("/nonexistent/path.json")
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractClaudeDesktopPATs__malformed_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "claude_desktop_config.json")
	require.NoError(t, os.WriteFile(configPath, []byte("not json{"), 0644))

	contentPAT, promptPAT := extractClaudeDesktopPATs(configPath)
	assert.Empty(t, contentPAT)
	assert.Empty(t, promptPAT)
}

func TestExtractBearerToken(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Bearer bm_test123", "bm_test123"},
		{"Authorization: Bearer bm_test123", "bm_test123"},
		{"  Bearer bm_test123  ", "bm_test123"},
		{"", ""},
		{"not-bearer", ""},
		{"Authorization: ", ""},
	}

	for _, tc := range tests {
		result := extractBearerToken(tc.input)
		assert.Equal(t, tc.expected, result, "input: %q", tc.input)
	}
}

// Helpers

func readTestJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var result map[string]any
	require.NoError(t, json.Unmarshal(data, &result))
	return result
}

func writeTestJSON(t *testing.T, path string, data any) {
	t.Helper()
	b, err := json.MarshalIndent(data, "", "  ")
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0755))
	require.NoError(t, os.WriteFile(path, b, 0644))
}

func toStringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	result := make([]string, len(arr))
	for i, item := range arr {
		result[i], _ = item.(string)
	}
	return result
}
