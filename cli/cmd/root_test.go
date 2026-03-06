package cmd

import (
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHelp__shows_all_subcommands(t *testing.T) {
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "--help")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "login")
	assert.Contains(t, result.Stdout, "logout")
	assert.Contains(t, result.Stdout, "auth")
}

func TestHelp__login_subcommand(t *testing.T) {
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "login", "--help")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "--token")
	assert.Contains(t, result.Stdout, "Personal Access Token")
}
