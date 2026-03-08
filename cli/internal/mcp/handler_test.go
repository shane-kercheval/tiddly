package mcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDefaultHandlers__returns_all_three_in_order(t *testing.T) {
	handlers := DefaultHandlers()
	require.Len(t, handlers, 3)
	assert.Equal(t, "claude-desktop", handlers[0].Name())
	assert.Equal(t, "claude-code", handlers[1].Name())
	assert.Equal(t, "codex", handlers[2].Name())
}

func TestGetHandler__found(t *testing.T) {
	handlers := DefaultHandlers()
	h, ok := GetHandler(handlers, "claude-code")
	assert.True(t, ok)
	assert.Equal(t, "claude-code", h.Name())
}

func TestGetHandler__not_found(t *testing.T) {
	handlers := DefaultHandlers()
	h, ok := GetHandler(handlers, "unknown-tool")
	assert.False(t, ok)
	assert.Nil(t, h)
}

func TestGetHandler__empty_list(t *testing.T) {
	h, ok := GetHandler(nil, "claude-code")
	assert.False(t, ok)
	assert.Nil(t, h)
}

func TestHandlerSupportedScopes(t *testing.T) {
	tests := []struct {
		name   string
		handler ToolHandler
		want   []string
	}{
		{"claude-desktop", &ClaudeDesktopHandler{}, []string{"user"}},
		{"claude-code", &ClaudeCodeHandler{}, []string{"user", "local", "project"}},
		{"codex", &CodexHandler{}, []string{"user", "project"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tt.handler.SupportedScopes())
		})
	}
}

func TestClaudeDesktopHandler__detect_with_config_override(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "claude_desktop_config.json")
	require.NoError(t, os.WriteFile(configPath, []byte("{}"), 0600))

	h := &ClaudeDesktopHandler{ConfigPathOverride: configPath}
	tool := h.Detect(newMockLooker())

	assert.True(t, tool.Installed)
	assert.Equal(t, configPath, tool.ConfigPath)
	assert.Equal(t, "config directory exists", tool.Reason)
}

func TestClaudeCodeHandler__detect_with_config_override(t *testing.T) {
	looker := newMockLooker()
	looker.paths["claude"] = "/usr/bin/claude"

	h := &ClaudeCodeHandler{ConfigPathOverride: "/tmp/test/.claude.json"}
	tool := h.Detect(looker)

	assert.True(t, tool.Installed)
	assert.Equal(t, "/tmp/test/.claude.json", tool.ConfigPath)
}

func TestClaudeCodeHandler__detect_not_installed(t *testing.T) {
	h := &ClaudeCodeHandler{}
	tool := h.Detect(newMockLooker())

	assert.False(t, tool.Installed)
	assert.Empty(t, tool.ConfigPath)
}

func TestCodexHandler__detect_binary_in_path(t *testing.T) {
	looker := newMockLooker()
	looker.paths["codex"] = "/usr/bin/codex"

	h := &CodexHandler{ConfigPathOverride: "/tmp/test/config.toml"}
	tool := h.Detect(looker)

	assert.True(t, tool.Installed)
	assert.Equal(t, "/tmp/test/config.toml", tool.ConfigPath)
	assert.Equal(t, "binary in PATH", tool.Reason)
}

func TestCodexHandler__detect_config_dir_with_override(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	h := &CodexHandler{ConfigPathOverride: configPath}
	tool := h.Detect(newMockLooker())

	// tmpDir exists as the parent directory
	assert.True(t, tool.Installed)
	assert.Equal(t, configPath, tool.ConfigPath)
	assert.Equal(t, "config directory exists", tool.Reason)
}

func TestClaudeDesktopHandler__configure_and_status(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	h := &ClaudeDesktopHandler{}
	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	tool := DetectedTool{Name: "claude-desktop", HasNpx: true}

	warnings, err := h.Configure(rc, "content-token", "prompt-token", tool)
	require.NoError(t, err)

	// Should not have npx warning since HasNpx is true
	for _, w := range warnings {
		assert.NotContains(t, w, "Node.js")
	}
	// Should have plaintext and restart warnings
	assert.Contains(t, warnings[0], "plaintext")
	assert.Contains(t, warnings[1], "Restart")

	// Verify status detects the installed servers
	result, err := h.Status(rc)
	require.NoError(t, err)
	assert.Len(t, result.Servers, 2)
}

func TestClaudeDesktopHandler__configure_without_npx(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	h := &ClaudeDesktopHandler{}
	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	tool := DetectedTool{Name: "claude-desktop", HasNpx: false}

	warnings, err := h.Configure(rc, "content-token", "prompt-token", tool)
	require.NoError(t, err)
	assert.Contains(t, warnings[0], "Node.js")
}

func TestClaudeCodeHandler__configure_and_remove(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, ".claude.json")

	h := &ClaudeCodeHandler{}
	rc := ResolvedConfig{Path: configPath, Scope: "user"}
	tool := DetectedTool{Name: "claude-code"}

	warnings, err := h.Configure(rc, "ct", "pt", tool)
	require.NoError(t, err)
	assert.Len(t, warnings, 1)
	assert.Contains(t, warnings[0], "plaintext")

	// Verify file was written
	data, err := os.ReadFile(configPath)
	require.NoError(t, err)
	var config map[string]any
	require.NoError(t, json.Unmarshal(data, &config))
	servers := config["mcpServers"].(map[string]any)
	assert.Contains(t, servers, serverNameContent)
	assert.Contains(t, servers, serverNamePrompts)

	// Uninstall
	require.NoError(t, h.Remove(rc))

	data, err = os.ReadFile(configPath)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(data, &config))
	servers = config["mcpServers"].(map[string]any)
	assert.NotContains(t, servers, serverNameContent)
	assert.NotContains(t, servers, serverNamePrompts)
}

func TestCodexHandler__dry_run(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	h := &CodexHandler{}
	rc := ResolvedConfig{Path: configPath, Scope: "user"}

	before, after, err := h.DryRun(rc, "ct", "pt")
	require.NoError(t, err)
	assert.Empty(t, before) // no existing file
	assert.Contains(t, after, "tiddly")
}

func TestCodexHandler__extract_pats_no_config(t *testing.T) {
	h := &CodexHandler{}
	rc := ResolvedConfig{Path: "/nonexistent/config.toml", Scope: "user"}
	content, prompt := h.ExtractPATs(rc)
	assert.Empty(t, content)
	assert.Empty(t, prompt)
}

func TestDetectAll__returns_results_in_handler_order(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	looker := newMockLooker()
	looker.paths["claude"] = "/usr/bin/claude"
	looker.paths["npx"] = "/usr/bin/npx"

	handlers := DefaultHandlers()
	tools := DetectAll(handlers, looker)

	require.Len(t, tools, len(handlers))
	for i, h := range handlers {
		assert.Equal(t, h.Name(), tools[i].Name, "tool at index %d should match handler name", i)
	}
}

func TestValidToolNames(t *testing.T) {
	names := ValidToolNames(DefaultHandlers())
	assert.Equal(t, []string{"claude-desktop", "claude-code", "codex"}, names)
}
