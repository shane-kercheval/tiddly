package mcp

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockLooker struct {
	paths map[string]string
}

func newMockLooker() *mockLooker {
	return &mockLooker{paths: make(map[string]string)}
}

func (m *mockLooker) LookPath(file string) (string, error) {
	if path, ok := m.paths[file]; ok {
		return path, nil
	}
	return "", &lookPathError{file: file}
}

type lookPathError struct{ file string }

func (e *lookPathError) Error() string { return "not found: " + e.file }

func TestDetectTools__claude_code_in_path(t *testing.T) {
	looker := newMockLooker()
	looker.paths["claude"] = "/usr/bin/claude"

	tools := DetectTools(looker)

	var claudeCode *DetectedTool
	for _, tool := range tools {
		if tool.Name == "claude-code" {
			claudeCode = &tool
		}
	}

	assert.NotNil(t, claudeCode)
	assert.True(t, claudeCode.Installed)
	assert.Equal(t, "binary in PATH", claudeCode.Reason)
}

func TestDetectTools__codex_in_path(t *testing.T) {
	looker := newMockLooker()
	looker.paths["codex"] = "/usr/bin/codex"

	tools := DetectTools(looker)

	var codex *DetectedTool
	for _, tool := range tools {
		if tool.Name == "codex" {
			codex = &tool
		}
	}

	assert.NotNil(t, codex)
	assert.True(t, codex.Installed)
	assert.Equal(t, "binary in PATH", codex.Reason)
}

func TestDetectTools__codex_config_dir_exists(t *testing.T) {
	// Create a fake ~/.codex/ directory
	home := t.TempDir()
	t.Setenv("HOME", home)
	codexDir := filepath.Join(home, ".codex")
	require.NoError(t, os.MkdirAll(codexDir, 0755))

	looker := newMockLooker() // no binaries in path

	tools := DetectTools(looker)

	var codex *DetectedTool
	for _, tool := range tools {
		if tool.Name == "codex" {
			codex = &tool
		}
	}

	assert.NotNil(t, codex)
	assert.True(t, codex.Installed)
	assert.Equal(t, "config directory exists", codex.Reason)
}

func TestDetectTools__nothing_detected(t *testing.T) {
	// Override HOME to a temp dir with no config directories
	home := t.TempDir()
	t.Setenv("HOME", home)

	looker := newMockLooker()
	tools := DetectTools(looker)

	for _, tool := range tools {
		assert.False(t, tool.Installed, "expected %s to not be detected", tool.Name)
	}
}

func TestDetectTools__npx_detected_for_desktop(t *testing.T) {
	looker := newMockLooker()
	looker.paths["npx"] = "/usr/bin/npx"

	tools := DetectTools(looker)

	var desktop *DetectedTool
	for _, tool := range tools {
		if tool.Name == "claude-desktop" {
			desktop = &tool
		}
	}

	assert.NotNil(t, desktop)
	assert.True(t, desktop.HasNpx)
}

func TestDetectTools__tolerant_when_home_unavailable(t *testing.T) {
	// When HOME is unset, detection should mark tools as not-installed
	// rather than producing garbage paths or panicking.
	t.Setenv("HOME", "")

	looker := newMockLooker()
	// Even with binaries in PATH, config paths can't be resolved without HOME
	looker.paths["claude"] = "/usr/bin/claude"

	tools := DetectTools(looker)

	for _, tool := range tools {
		switch tool.Name {
		case "claude-code":
			// claude-code is detected via binary, ConfigPath may be empty
			assert.True(t, tool.Installed, "claude-code should still be detected via binary")
			assert.Empty(t, tool.ConfigPath, "config path should be empty when HOME is unset")
		case "claude-desktop", "codex":
			// These rely on config directory detection which needs HOME
			assert.False(t, tool.Installed, "%s should not be detected without HOME", tool.Name)
		}
	}
}

func TestConfigPath__returns_error_when_home_unavailable(t *testing.T) {
	t.Setenv("HOME", "")

	_, err := ClaudeCodeConfigPath()
	assert.Error(t, err)

	_, err = ClaudeDesktopConfigPath()
	assert.Error(t, err)

	_, err = CodexConfigPath()
	assert.Error(t, err)
}

func TestDetectTools__always_returns_three_tools(t *testing.T) {
	looker := newMockLooker()
	tools := DetectTools(looker)
	assert.Len(t, tools, 3)

	names := make(map[string]bool)
	for _, tool := range tools {
		names[tool.Name] = true
	}
	assert.True(t, names["claude-desktop"])
	assert.True(t, names["claude-code"])
	assert.True(t, names["codex"])
}
