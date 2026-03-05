package cmd

import (
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCompletion__bash(t *testing.T) {
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "completion", "bash")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "bash completion")
}

func TestCompletion__zsh(t *testing.T) {
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "completion", "zsh")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "zsh")
}

func TestCompletion__fish(t *testing.T) {
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "completion", "fish")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "fish")
}

func TestCompletion__invalid_shell(t *testing.T) {
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "completion", "powershell")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "unsupported shell")
}

func TestCompletion__no_args(t *testing.T) {
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "completion")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "accepts 1 arg")
}

func TestCompletionHelp(t *testing.T) {
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "completion", "--help")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "bash")
	assert.Contains(t, result.Stdout, "zsh")
	assert.Contains(t, result.Stdout, "fish")
}
