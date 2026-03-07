package cmd

import (
	"testing"
	"time"

	"github.com/shane-kercheval/tiddly/cli/internal/config"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestCmd(name string) *cobra.Command {
	return &cobra.Command{Use: name}
}

// overrideTTY sets isStderrTTY to return the given value and restores it on cleanup.
func overrideTTY(t *testing.T, val bool) {
	t.Helper()
	old := isStderrTTY
	isStderrTTY = func() bool { return val }
	t.Cleanup(func() { isStderrTTY = old })
}

func TestShouldCheckForUpdates__dev_version(t *testing.T) {
	old := cliVersion
	cliVersion = "dev"
	defer func() { cliVersion = old }()

	assert.False(t, shouldCheckForUpdates(newTestCmd("status"), ""))
}

func TestShouldCheckForUpdates__opt_out_config(t *testing.T) {
	old := cliVersion
	cliVersion = "1.0.0"
	defer func() { cliVersion = old }()

	viper.Reset()
	viper.Set("update_check", false)
	defer viper.Reset()

	assert.False(t, shouldCheckForUpdates(newTestCmd("status"), ""))
}

func TestShouldCheckForUpdates__ci_env(t *testing.T) {
	old := cliVersion
	cliVersion = "1.0.0"
	defer func() { cliVersion = old }()

	viper.Reset()
	viper.SetDefault("update_check", true)
	defer viper.Reset()

	// Any non-empty CI value should suppress update checks
	for _, val := range []string{"true", "1", "yes", "anything"} {
		t.Setenv("CI", val)
		assert.False(t, shouldCheckForUpdates(newTestCmd("status"), ""), "CI=%q should suppress update checks", val)
	}
}

func TestShouldCheckForUpdates__no_update_check_env(t *testing.T) {
	old := cliVersion
	cliVersion = "1.0.0"
	defer func() { cliVersion = old }()

	viper.Reset()
	viper.SetDefault("update_check", true)
	defer viper.Reset()

	t.Setenv("TIDDLY_NO_UPDATE_CHECK", "1")

	assert.False(t, shouldCheckForUpdates(newTestCmd("status"), ""))
}

func TestShouldCheckForUpdates__upgrade_command(t *testing.T) {
	assert.False(t, shouldCheckForUpdates(newTestCmd("upgrade"), ""))
}

func TestShouldCheckForUpdates__completion_command(t *testing.T) {
	assert.False(t, shouldCheckForUpdates(newTestCmd("completion"), ""))
}

func TestShouldCheckForUpdates__config_command(t *testing.T) {
	assert.False(t, shouldCheckForUpdates(newTestCmd("config"), ""))
}

func TestShouldCheckForUpdates__config_subcommand(t *testing.T) {
	// "tiddly config get" — cmd.Name() is "get", but parent is "config"
	parent := &cobra.Command{Use: "config"}
	child := &cobra.Command{Use: "get"}
	parent.AddCommand(child)
	assert.False(t, shouldCheckForUpdates(child, ""))
}

func TestShouldCheckForUpdates__within_24h(t *testing.T) {
	old := cliVersion
	cliVersion = "1.0.0"
	defer func() { cliVersion = old }()

	viper.Reset()
	viper.SetDefault("update_check", true)
	defer viper.Reset()

	overrideTTY(t, true)

	dir := t.TempDir()
	err := config.WriteState(dir, &config.State{
		LastUpdateCheck: time.Now().Add(-1 * time.Hour),
	})
	require.NoError(t, err)

	assert.False(t, shouldCheckForUpdates(newTestCmd("status"), dir))
}

func TestShouldCheckForUpdates__after_24h(t *testing.T) {
	old := cliVersion
	cliVersion = "1.0.0"
	defer func() { cliVersion = old }()

	viper.Reset()
	viper.SetDefault("update_check", true)
	defer viper.Reset()

	overrideTTY(t, true)

	dir := t.TempDir()
	err := config.WriteState(dir, &config.State{
		LastUpdateCheck: time.Now().Add(-25 * time.Hour),
	})
	require.NoError(t, err)

	assert.True(t, shouldCheckForUpdates(newTestCmd("status"), dir))
}

func TestShouldCheckForUpdates__not_tty(t *testing.T) {
	old := cliVersion
	cliVersion = "1.0.0"
	defer func() { cliVersion = old }()

	viper.Reset()
	viper.SetDefault("update_check", true)
	defer viper.Reset()

	overrideTTY(t, false)

	assert.False(t, shouldCheckForUpdates(newTestCmd("status"), ""))
}
