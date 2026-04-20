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
	_, err := configureClaudeCode(rc, "bm_content123", "bm_prompt456")
	require.NoError(t, err)

	ext := extractClaudeCodePATs(rc)
	assert.Equal(t, "bm_content123", ext.ContentPAT)
	assert.Equal(t, "bm_prompt456", ext.PromptPAT)
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
	ext := extractClaudeCodePATs(rc)
	assert.Empty(t, ext.ContentPAT)
	assert.Empty(t, ext.PromptPAT)
}

func TestExtractClaudeCodePATs__missing_file(t *testing.T) {
	rc := ResolvedConfig{Path: "/nonexistent/.claude.json", Scope: "user"}
	ext := extractClaudeCodePATs(rc)
	assert.Empty(t, ext.ContentPAT)
	assert.Empty(t, ext.PromptPAT)
}

func TestExtractClaudeCodePATs__malformed_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	require.NoError(t, os.WriteFile(configPath, []byte("not json{"), 0644))

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	ext := extractClaudeCodePATs(rc)
	assert.Empty(t, ext.ContentPAT)
	assert.Empty(t, ext.PromptPAT)
}

func TestExtractClaudeCodePATs__falls_through_canonical_with_missing_pat(t *testing.T) {
	// The canonical entry exists but has no Authorization header. ExtractPATs
	// must fall through to the next candidate (alphabetical-first custom entry)
	// so the value and the disclosed survivor name agree.
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			serverNamePrompts: map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				// headers intentionally omitted — PAT is unextractable
			},
			"work_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_work",
				},
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	ext := extractClaudeCodePATs(rc)
	assert.Equal(t, "bm_work", ext.PromptPAT,
		"PAT must come from work_prompts since canonical entry has no header")
	assert.Equal(t, "work_prompts", ext.PromptName,
		"survivor name must match the entry whose PAT was actually reused")
}

func TestExtractClaudeCodePATs__canonical_with_valid_pat_wins(t *testing.T) {
	// Canonical entry has a valid PAT; the custom entry is alphabetically
	// first but must NOT win because canonical-first ordering applies.
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"aaa_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_aaa",
				},
			},
			serverNamePrompts: map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_canonical",
				},
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	ext := extractClaudeCodePATs(rc)
	assert.Equal(t, "bm_canonical", ext.PromptPAT)
	assert.Equal(t, serverNamePrompts, ext.PromptName)
}

func TestExtractAllClaudeCodeTiddlyPATs__multi_entry_returns_every_token(t *testing.T) {
	// Core regression for `remove --delete-tokens`: a multi-entry config
	// (work + personal prompts under OAuth with distinct tokens) must
	// surface EVERY token so the remove flow can revoke all of them, not
	// just the ExtractPATs survivor. Before this primitive existed, the
	// cmd/mcp.go remove flow leaked one token per multi-entry server type.
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"work_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_work_token",
				},
			},
			"personal_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_personal_token",
				},
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	all := extractAllClaudeCodeTiddlyPATs(rc)
	require.Len(t, all, 2)
	// Canonical-first ordering: neither is canonical, so alphabetical.
	assert.Equal(t, "personal_prompts", all[0].Name)
	assert.Equal(t, "bm_personal_token", all[0].PAT)
	assert.Equal(t, "work_prompts", all[1].Name)
	assert.Equal(t, "bm_work_token", all[1].PAT)
}

func TestExtractAllClaudeCodeTiddlyPATs__filters_missing_pats(t *testing.T) {
	// Entries without an extractable PAT (missing/malformed headers) must
	// not appear in the slice — remove has nothing to revoke for them.
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"tiddly_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				// headers omitted — no extractable PAT
			},
			"work_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_work_token",
				},
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	all := extractAllClaudeCodeTiddlyPATs(rc)
	require.Len(t, all, 1, "canonical with missing PAT must be filtered out")
	assert.Equal(t, "work_prompts", all[0].Name)
}

func TestExtractClaudeCodePATs__all_entries_empty_returns_zero(t *testing.T) {
	// Every matching entry has a malformed/missing header → PATExtraction
	// stays zero-valued (both PAT and Name empty), signaling "no survivor."
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"work_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
			},
			"personal_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "not-a-bearer",
				},
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	ext := extractClaudeCodePATs(rc)
	assert.Empty(t, ext.PromptPAT)
	assert.Empty(t, ext.PromptName)
}

// Configure/Remove/Status/DryRun tests

func TestConfigureClaudeCode__user_scope_creates_config(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
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

func TestConfigureClaudeCode__preserves_existing_config(t *testing.T) {
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
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	assert.Equal(t, "preserved", config["someOtherKey"])

	servers := config["mcpServers"].(map[string]any)
	assert.NotNil(t, servers["other-server"], "existing server should be preserved")
	assert.NotNil(t, servers["tiddly_notes_bookmarks"], "new server should be added")
	assert.NotNil(t, servers["tiddly_prompts"], "new server should be added")
}

func TestConfigureClaudeCode__local_scope(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")
	fakeCwd := "/fake/project/dir"

	rc := ResolvedConfig{Path: configPath, Scope: "local", Cwd: fakeCwd}
	_, err := configureClaudeCode(rc, "bm_content", "")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	projects := config["projects"].(map[string]any)
	proj := projects[fakeCwd].(map[string]any)
	servers := proj["mcpServers"].(map[string]any)
	assert.NotNil(t, servers["tiddly_notes_bookmarks"])
}

func TestConfigureClaudeCode__project_scope(t *testing.T) {
	dir := t.TempDir()
	// project scope uses cwd/.mcp.json
	path, err := resolveClaudeCodePath("", "project", dir)
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(dir, ".mcp.json"), path)
}

func TestRemoveClaudeCode__removes_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}

	// Configure first
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Remove
	_, err = removeClaudeCode(rc, nil)
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Nil(t, servers["tiddly_notes_bookmarks"])
	assert.Nil(t, servers["tiddly_prompts"])
}

func TestRemoveClaudeCode__no_file_is_noop(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := removeClaudeCode(rc, nil)
	require.NoError(t, err)
}

func TestRemoveClaudeCode__no_tiddly_servers_skips_write(t *testing.T) {
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
	_, err := removeClaudeCode(rc, nil)
	require.NoError(t, err)

	// No backup should be created since nothing was removed
	backupMatches, _ := filepath.Glob(configPath + ".bak.*")
	assert.Empty(t, backupMatches, "no backup should be created on no-op remove")
}

func TestStatusClaudeCode__finds_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	sr, err := statusClaudeCode(rc)
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
	sr, err := statusClaudeCode(rc)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers)
	assert.Equal(t, configPath, sr.ConfigPath)
}

func TestStatusClaudeCode__no_file(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusClaudeCode(rc)
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
	sr, err := statusClaudeCode(rc)
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
	sr, err := statusClaudeCode(rc)
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
	sr, err := statusClaudeCode(rc)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers, "should not match URL with same host but different path")
}

func TestStatusClaudeCode__multiple_entries_same_url_all_shown(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Both a canonical and custom entry point to the same tiddly URL.
	// Both should surface so users can see all entries that route to tiddly
	// (e.g. work/personal accounts against the same MCP URL with distinct PATs).
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
	sr, err := statusClaudeCode(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2, "both entries should surface")
	// Sorted by (ServerType, Name): both content; names sort alphabetically.
	assert.Equal(t, "my_custom_content", sr.Servers[0].Name)
	assert.Equal(t, MatchByURL, sr.Servers[0].MatchMethod)
	assert.Equal(t, serverNameContent, sr.Servers[1].Name)
	assert.Equal(t, MatchByName, sr.Servers[1].MatchMethod)
}

func TestStatusClaudeCode__work_and_personal_prompts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// A user running two tiddly accounts (work + personal) configures two
	// prompt MCP entries under distinct names pointing at the same URL.
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"work_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_work_token",
				},
			},
			"personal_prompts": map[string]any{
				"type": "http",
				"url":  PromptMCPURL(),
				"headers": map[string]any{
					"Authorization": "Bearer bm_personal_token",
				},
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusClaudeCode(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2, "both work and personal prompt servers should surface")
	// Both are ServerPrompts; alphabetical: personal_prompts before work_prompts.
	assert.Equal(t, "personal_prompts", sr.Servers[0].Name)
	assert.Equal(t, ServerPrompts, sr.Servers[0].ServerType)
	assert.Equal(t, MatchByURL, sr.Servers[0].MatchMethod)
	assert.Equal(t, "work_prompts", sr.Servers[1].Name)
	assert.Equal(t, ServerPrompts, sr.Servers[1].ServerType)
	assert.Equal(t, MatchByURL, sr.Servers[1].MatchMethod)
	assert.Empty(t, sr.OtherServers)
}

func TestStatusClaudeCode__detects_stdio_npx_format(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Simulate a server added via `claude mcp add` (stdio/npx format)
	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"prompts": map[string]any{
				"command": "npx",
				"args": []any{
					"mcp-remote",
					PromptMCPURL(),
					"--header",
					"Authorization: Bearer bm_test123",
				},
			},
			serverNameContent: map[string]any{
				"type": "http",
				"url":  ContentMCPURL(),
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusClaudeCode(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)
	assert.Equal(t, "content", sr.Servers[0].ServerType)
	assert.Equal(t, MatchByName, sr.Servers[0].MatchMethod)
	assert.Equal(t, "prompts", sr.Servers[1].ServerType)
	assert.Equal(t, MatchByURL, sr.Servers[1].MatchMethod)
	assert.Equal(t, "prompts", sr.Servers[1].Name)
}

func TestStatusClaudeCode__includes_url_on_tiddly_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	sr, err := statusClaudeCode(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2)
	assert.Equal(t, ContentMCPURL(), sr.Servers[0].URL)
	assert.Equal(t, PromptMCPURL(), sr.Servers[1].URL)
}

func TestStatusClaudeCode__collects_other_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			serverNameContent: map[string]any{
				"type": "http",
				"url":  ContentMCPURL(),
			},
			"github": map[string]any{
				"command": "npx",
				"args":    []any{"github-mcp-server"},
			},
			"postgres-mcp": map[string]any{
				"url": "https://postgres.example.com/mcp",
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusClaudeCode(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 1)
	assert.Equal(t, "content", sr.Servers[0].ServerType)

	assert.Len(t, sr.OtherServers, 2)
	// Alphabetical order
	assert.Equal(t, "github", sr.OtherServers[0].Name)
	assert.Equal(t, "stdio", sr.OtherServers[0].Transport)
	assert.Equal(t, "postgres-mcp", sr.OtherServers[1].Name)
	assert.Equal(t, "http", sr.OtherServers[1].Transport)
}

func TestStatusClaudeCode__only_other_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"sentry": map[string]any{
				"command": "node",
				"args":    []any{"sentry-server.js"},
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusClaudeCode(rc)
	require.NoError(t, err)
	assert.Empty(t, sr.Servers)
	assert.Len(t, sr.OtherServers, 1)
	assert.Equal(t, "sentry", sr.OtherServers[0].Name)
	assert.Equal(t, "stdio", sr.OtherServers[0].Transport)
}

func TestStatusClaudeCode__duplicate_tiddly_both_shown_never_in_other(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			serverNameContent: map[string]any{
				"type": "http",
				"url":  ContentMCPURL(),
			},
			"my_custom_content": map[string]any{
				"type": "http",
				"url":  ContentMCPURL(),
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusClaudeCode(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 2, "both tiddly entries should surface")
	assert.Empty(t, sr.OtherServers, "tiddly-URL entries must never appear in OtherServers")
}

func TestStatusClaudeCode__env_override_classified_as_tiddly(t *testing.T) {
	t.Setenv("TIDDLY_CONTENT_MCP_URL", "http://localhost:8001/mcp")

	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			serverNameContent: map[string]any{
				"type": "http",
				"url":  "http://localhost:8001/mcp",
			},
			"other": map[string]any{
				"command": "node",
				"args":    []any{"server.js"},
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusClaudeCode(rc)
	require.NoError(t, err)
	assert.Len(t, sr.Servers, 1)
	assert.Equal(t, "content", sr.Servers[0].ServerType)
	assert.Equal(t, "http://localhost:8001/mcp", sr.Servers[0].URL)
	assert.Len(t, sr.OtherServers, 1)
	assert.Equal(t, "other", sr.OtherServers[0].Name)
}

func TestStatusClaudeCode__unknown_transport(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"mystery": map[string]any{
				"config": "something",
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	sr, err := statusClaudeCode(rc)
	require.NoError(t, err)
	assert.Len(t, sr.OtherServers, 1)
	assert.Equal(t, "", sr.OtherServers[0].Transport)
}

func TestRemoveClaudeCode__removes_stdio_npx_servers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	writeTestJSON(t, configPath, map[string]any{
		"mcpServers": map[string]any{
			"prompts": map[string]any{
				"command": "npx",
				"args": []any{
					"mcp-remote",
					PromptMCPURL(),
					"--header",
					"Authorization: Bearer bm_test123",
				},
			},
			"other-server": map[string]any{
				"type": "stdio",
			},
		},
	})

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := removeClaudeCode(rc, nil)
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.NotContains(t, servers, "prompts")
	assert.Contains(t, servers, "other-server")
}

func TestRemoveClaudeCode__removes_custom_named_servers(t *testing.T) {
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
	_, err := removeClaudeCode(rc, nil)
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.NotContains(t, servers, "my_content")
	assert.NotContains(t, servers, "my_prompts")
	assert.Contains(t, servers, "other-server")
}

func TestRemoveClaudeCode__content_only_preserves_prompts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	_, err = removeClaudeCode(rc, []string{"content"})
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.NotContains(t, servers, serverNameContent)
	assert.Contains(t, servers, serverNamePrompts)
}

func TestRemoveClaudeCode__prompts_only_preserves_content(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	_, err = removeClaudeCode(rc, []string{"prompts"})
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, serverNameContent)
	assert.NotContains(t, servers, serverNamePrompts)
}

func TestConfigureClaudeCode__replaces_custom_named_servers(t *testing.T) {
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
	_, err := configureClaudeCode(rc, "bm_new_content", "bm_new_prompts")
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
	ext := extractClaudeCodePATs(rc)
	assert.Equal(t, "bm_custom_content", ext.ContentPAT)
	assert.Equal(t, "bm_custom_prompts", ext.PromptPAT)
}

func TestConfigureClaudeCode__content_only_preserves_existing_prompts(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Configure both servers first
	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Re-configure with only content PAT (simulates --servers content)
	_, err = configureClaudeCode(rc, "bm_new_content", "")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	// Content should be updated
	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	headers := content["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_new_content", headers["Authorization"])

	// Prompts should be preserved from the first configure
	prompts := servers["tiddly_prompts"].(map[string]any)
	assert.NotNil(t, prompts, "prompts server should be preserved")
	promptHeaders := prompts["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_prompts", promptHeaders["Authorization"])
}

func TestConfigureClaudeCode__prompts_only_preserves_existing_content(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	// Configure both servers first
	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	_, err := configureClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	// Re-configure with only prompts PAT (simulates --servers prompts)
	_, err = configureClaudeCode(rc, "", "bm_new_prompts")
	require.NoError(t, err)

	config := readTestJSON(t, configPath)
	servers := config["mcpServers"].(map[string]any)

	// Content should be preserved from the first configure
	content := servers["tiddly_notes_bookmarks"].(map[string]any)
	assert.NotNil(t, content, "content server should be preserved")
	headers := content["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_content", headers["Authorization"])

	// Prompts should be updated
	prompts := servers["tiddly_prompts"].(map[string]any)
	promptHeaders := prompts["headers"].(map[string]any)
	assert.Equal(t, "Bearer bm_new_prompts", promptHeaders["Authorization"])
}

func TestDryRunClaudeCode__shows_diff(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ".claude.json")

	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	before, after, err := dryRunClaudeCode(rc, "bm_content", "bm_prompts")
	require.NoError(t, err)

	assert.Contains(t, before, "{}")
	assert.Contains(t, after, "tiddly_notes_bookmarks")
	assert.Contains(t, after, "tiddly_prompts")

	// File should NOT have been created
	_, err = os.Stat(configPath)
	assert.True(t, os.IsNotExist(err))
}
