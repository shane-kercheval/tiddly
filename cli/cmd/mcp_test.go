package cmd

import (
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMCPInstall__not_logged_in(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "install")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "not logged in")
}

func TestMCPInstall__invalid_tool(t *testing.T) {
	store := testutil.CredsWithPAT("bm_test123")
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "install", "invalid-tool")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "unknown tool")
}

func TestMCPStatus__runs(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "status")

	require.NoError(t, result.Err)
	// Should list tools (even if not detected)
	assert.Contains(t, result.Stdout, "claude-desktop")
	assert.Contains(t, result.Stdout, "claude-code")
	assert.Contains(t, result.Stdout, "codex")
}

func TestMCPUninstall__requires_tool_arg(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "uninstall")

	require.Error(t, result.Err)
}

func TestMCPUninstall__invalid_tool(t *testing.T) {
	store := testutil.NewMockCredStore()
	setupTestDeps(t, store)

	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "mcp", "uninstall", "invalid-tool")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "unknown tool")
}
