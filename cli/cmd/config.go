package cmd

import (
	"fmt"
	"strings"

	"github.com/shane-kercheval/tiddly/cli/internal/config"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

// configKeys defines the supported configuration keys and their types.
var configKeys = map[string]string{
	"api_url":      "string",
	"update_check": "bool",
}

func newConfigCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Manage CLI configuration",
		Long: `View and modify CLI configuration settings.

  tiddly config list              Show all config values
  tiddly config get <key>         Get a config value
  tiddly config set <key> <value> Set a config value

Supported keys: api_url, update_check`,
	}

	cmd.AddCommand(newConfigListCmd())
	cmd.AddCommand(newConfigGetCmd())
	cmd.AddCommand(newConfigSetCmd())

	return cmd
}

func newConfigListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "Show all config values",
		RunE: func(cmd *cobra.Command, args []string) error {
			w := cmd.OutOrStdout()
			for _, key := range sortedConfigKeys() {
				fmt.Fprintf(w, "%s=%v\n", key, viper.Get(key))
			}
			return nil
		},
	}
}

func newConfigGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "get <key>",
		Short: "Get a config value",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			key := args[0]
			if _, ok := configKeys[key]; !ok {
				return fmt.Errorf("unknown config key %q. Valid keys: %s", key, strings.Join(sortedConfigKeys(), ", "))
			}
			fmt.Fprintln(cmd.OutOrStdout(), viper.Get(key))
			return nil
		},
	}
}

func newConfigSetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "set <key> <value>",
		Short: "Set a config value",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			key := args[0]
			value := args[1]

			keyType, ok := configKeys[key]
			if !ok {
				return fmt.Errorf("unknown config key %q. Valid keys: %s", key, strings.Join(sortedConfigKeys(), ", "))
			}

			switch keyType {
			case "bool":
				switch strings.ToLower(value) {
				case "true":
					viper.Set(key, true)
				case "false":
					viper.Set(key, false)
				default:
					return fmt.Errorf("invalid value %q for %s. Use true or false", value, key)
				}
			default:
				viper.Set(key, value)
			}

			if err := config.Save(appDeps.ConfigDir); err != nil {
				return fmt.Errorf("saving config: %w", err)
			}

			fmt.Fprintf(cmd.OutOrStdout(), "%s=%v\n", key, viper.Get(key))
			return nil
		},
	}
}

// sortedConfigKeys returns config keys in sorted order.
func sortedConfigKeys() []string {
	return []string{"api_url", "update_check"}
}
