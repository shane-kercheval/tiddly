package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInit(t *testing.T) {
	tests := []struct {
		name        string
		configYAML  string
		envVars     map[string]string
		wantAPIURL  string
	}{
		{
			name:       "defaults when no config file",
			wantAPIURL: DefaultAPIURL,
		},
		{
			name:       "reads values from config file",
			configYAML: "api_url: https://custom.example.com\n",
			wantAPIURL: "https://custom.example.com",
		},
		{
			name:       "env var overrides config file",
			configYAML: "api_url: https://from-file.example.com\n",
			envVars:    map[string]string{"TIDDLY_API_URL": "https://from-env.example.com"},
			wantAPIURL: "https://from-env.example.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Reset viper for each test
			viper.Reset()

			dir := t.TempDir()

			if tt.configYAML != "" {
				err := os.WriteFile(filepath.Join(dir, "config.yaml"), []byte(tt.configYAML), 0644)
				require.NoError(t, err)
			}

			for k, v := range tt.envVars {
				t.Setenv(k, v)
			}

			err := Init(dir)
			require.NoError(t, err)

			assert.Equal(t, tt.wantAPIURL, viper.GetString("api_url"))
		})
	}
}

func TestDir(t *testing.T) {
	tests := []struct {
		name     string
		xdgHome  string
		wantSuffix string
	}{
		{
			name:       "uses XDG_CONFIG_HOME when set",
			xdgHome:    "/custom/config",
			wantSuffix: "/custom/config/tiddly",
		},
		{
			name:       "uses ~/.config when XDG unset",
			wantSuffix: ".config/tiddly",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.xdgHome != "" {
				t.Setenv("XDG_CONFIG_HOME", tt.xdgHome)
			} else {
				t.Setenv("XDG_CONFIG_HOME", "")
			}

			dir := Dir()
			assert.Contains(t, dir, tt.wantSuffix)
		})
	}
}

func TestEnsureDir(t *testing.T) {
	dir := t.TempDir()
	configDir := filepath.Join(dir, "nested", "tiddly")

	err := EnsureDir(configDir)
	require.NoError(t, err)

	info, err := os.Stat(configDir)
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}

func TestSave(t *testing.T) {
	viper.Reset()
	dir := t.TempDir()

	err := Init(dir)
	require.NoError(t, err)

	viper.Set("api_url", "https://saved.example.com")
	err = Save(dir)
	require.NoError(t, err)

	// Read back
	viper.Reset()
	err = Init(dir)
	require.NoError(t, err)
	assert.Equal(t, "https://saved.example.com", viper.GetString("api_url"))
}
