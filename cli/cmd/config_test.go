package cmd

import (
	"testing"

	"github.com/shane-kercheval/tiddly/cli/internal/config"
	"github.com/shane-kercheval/tiddly/cli/internal/testutil"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupConfigTest(t *testing.T) *testutil.MockCredStore {
	t.Helper()
	viper.Reset()
	dir := t.TempDir()
	require.NoError(t, config.Init(dir))

	creds := testutil.CredsWithPAT("bm_test")
	SetDeps(&AppDeps{
		CredStore: creds,
		ConfigDir: dir,
	})
	t.Cleanup(func() { SetDeps(nil) })
	return creds
}

func TestConfigList__shows_defaults(t *testing.T) {
	setupConfigTest(t)
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "config", "list")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "api_url=https://api.tiddly.me")
	assert.Contains(t, result.Stdout, "update_check=true")
}

func TestConfigGet__api_url(t *testing.T) {
	setupConfigTest(t)
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "config", "get", "api_url")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "https://api.tiddly.me")
}

func TestConfigGet__invalid_key(t *testing.T) {
	setupConfigTest(t)
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "config", "get", "nonexistent")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "unknown config key")
}

func TestConfigSet__update_check(t *testing.T) {
	setupConfigTest(t)
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "config", "set", "update_check", "false")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "update_check=false")
	assert.Equal(t, false, viper.GetBool("update_check"))
}

func TestConfigSet__update_check_invalid_value(t *testing.T) {
	setupConfigTest(t)
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "config", "set", "update_check", "maybe")

	require.Error(t, result.Err)
	assert.Contains(t, result.Err.Error(), "invalid value")
}

func TestConfigSet__api_url(t *testing.T) {
	setupConfigTest(t)
	cmd := newRootCmd()
	result := testutil.ExecuteCmd(t, cmd, "config", "set", "api_url", "http://localhost:8000")

	require.NoError(t, result.Err)
	assert.Contains(t, result.Stdout, "api_url=http://localhost:8000")
	assert.Equal(t, "http://localhost:8000", viper.GetString("api_url"))
}
