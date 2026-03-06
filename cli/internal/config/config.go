package config

import (
	"os"
	"path/filepath"

	"github.com/spf13/viper"
)

const (
	DefaultAPIURL = "https://api.tiddly.me"
)

// Dir returns the configuration directory path, respecting XDG_CONFIG_HOME.
func Dir() string {
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "tiddly")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "tiddly")
}

// Init sets up Viper with defaults, config file, and env var bindings.
// configDir overrides the default config directory (used in tests).
func Init(configDir string) error {
	if configDir == "" {
		configDir = Dir()
	}

	viper.SetDefault("api_url", DefaultAPIURL)
	viper.SetDefault("update_check", true)

	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(configDir)

	viper.SetEnvPrefix("TIDDLY")
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return err
		}
	}

	return nil
}

// EnsureDir creates the config directory if it doesn't exist.
func EnsureDir(configDir string) error {
	if configDir == "" {
		configDir = Dir()
	}
	return os.MkdirAll(configDir, 0700)
}

// Save writes the current config to disk.
func Save(configDir string) error {
	if configDir == "" {
		configDir = Dir()
	}

	if err := EnsureDir(configDir); err != nil {
		return err
	}

	return viper.WriteConfigAs(filepath.Join(configDir, "config.yaml"))
}
