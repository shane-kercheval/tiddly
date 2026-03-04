package mcp

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToolSupportedScopes(t *testing.T) {
	assert.Equal(t, []string{"user"}, ToolSupportedScopes("claude-desktop"))
	assert.Equal(t, []string{"user", "local", "project"}, ToolSupportedScopes("claude-code"))
	assert.Equal(t, []string{"user", "project"}, ToolSupportedScopes("codex"))
	assert.Nil(t, ToolSupportedScopes("unknown-tool"))
}

func TestResolveToolConfig__empty_scope_defaults_to_user(t *testing.T) {
	rc, err := ResolveToolConfig("codex", "/some/config.toml", "", "")
	require.NoError(t, err)
	assert.Equal(t, "user", rc.Scope)
	assert.Equal(t, "/some/config.toml", rc.Path)
}

func TestResolveToolConfig__codex_user_scope(t *testing.T) {
	rc, err := ResolveToolConfig("codex", "/home/user/.codex/config.toml", "user", "")
	require.NoError(t, err)
	assert.Equal(t, "user", rc.Scope)
	assert.Equal(t, "/home/user/.codex/config.toml", rc.Path)
}

func TestResolveToolConfig__codex_project_scope(t *testing.T) {
	rc, err := ResolveToolConfig("codex", "", "project", "/some/project")
	require.NoError(t, err)
	assert.Equal(t, "project", rc.Scope)
	assert.Equal(t, filepath.Join("/some/project", ".codex", "config.toml"), rc.Path)
	assert.Equal(t, "/some/project", rc.Cwd)
}

func TestResolveToolConfig__codex_local_scope_returns_error(t *testing.T) {
	_, err := ResolveToolConfig("codex", "", "local", "/some/project")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not supported by codex")
	assert.Contains(t, err.Error(), "user, project")
}

func TestResolveToolConfig__claude_desktop_non_user_scope_returns_error(t *testing.T) {
	_, err := ResolveToolConfig("claude-desktop", "", "project", "/some/project")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not supported by claude-desktop")

	_, err = ResolveToolConfig("claude-desktop", "", "local", "/some/project")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not supported by claude-desktop")
}

func TestResolveToolConfig__claude_code_all_scopes_valid(t *testing.T) {
	for _, scope := range []string{"user", "local", "project"} {
		cwd := "/some/project"
		rc, err := ResolveToolConfig("claude-code", "", scope, cwd)
		require.NoError(t, err, "scope %q should be valid for claude-code", scope)
		assert.Equal(t, scope, rc.Scope)
	}
}

func TestResolveToolConfig__project_scope_empty_cwd_returns_error(t *testing.T) {
	_, err := ResolveToolConfig("codex", "", "project", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "requires a working directory")
}

func TestResolveToolConfig__local_scope_empty_cwd_returns_error(t *testing.T) {
	_, err := ResolveToolConfig("claude-code", "", "local", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "requires a working directory")
}

func TestResolveToolConfig__unknown_scope_returns_error(t *testing.T) {
	_, err := ResolveToolConfig("codex", "", "bogus", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not supported by codex")
}

func TestResolveToolConfig__unknown_tool_returns_error(t *testing.T) {
	_, err := ResolveToolConfig("unknown-tool", "", "user", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown tool")
}

func TestResolveToolConfig__claude_code_user_scope_path(t *testing.T) {
	rc, err := ResolveToolConfig("claude-code", "/custom/.claude.json", "user", "")
	require.NoError(t, err)
	assert.Equal(t, "/custom/.claude.json", rc.Path)
}

func TestResolveToolConfig__claude_code_project_scope_path(t *testing.T) {
	rc, err := ResolveToolConfig("claude-code", "", "project", "/my/project")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join("/my/project", ".mcp.json"), rc.Path)
}

func TestResolveToolConfig__claude_code_local_scope_path(t *testing.T) {
	// local scope uses ~/.claude.json (same as user), not cwd
	rc, err := ResolveToolConfig("claude-code", "/home/user/.claude.json", "local", "/my/project")
	require.NoError(t, err)
	assert.Equal(t, "/home/user/.claude.json", rc.Path)
	assert.Equal(t, "/my/project", rc.Cwd)
}

func TestResolveToolConfig__claude_desktop_user_scope_with_config_path(t *testing.T) {
	rc, err := ResolveToolConfig("claude-desktop", "/custom/config.json", "user", "")
	require.NoError(t, err)
	assert.Equal(t, "/custom/config.json", rc.Path)
}
