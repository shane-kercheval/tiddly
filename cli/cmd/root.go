package cmd

import (
	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/config"
	"github.com/shane-kercheval/tiddly/cli/internal/mcp"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var (
	flagToken   string
	flagAPIURL  string
	flagFormat  string
	flagKeyring string
)

// AppDeps holds the application dependencies, injectable for testing.
type AppDeps struct {
	CredStore         auth.CredentialStore
	TokenManager      *auth.TokenManager
	ConfigDir         string
	ExecLooker        mcp.ExecLooker
	FileStoreFallback bool // true if credentials fell back to plaintext file storage
}

// appDeps is the global deps instance, set during PersistentPreRunE or by tests.
var appDeps *AppDeps

// SetDeps allows tests to inject dependencies before command execution.
func SetDeps(deps *AppDeps) {
	appDeps = deps
}

func newRootCmd() *cobra.Command {
	rootCmd := &cobra.Command{
		Use:   "tiddly",
		Short: "Tiddly CLI — manage your bookmarks, notes, and AI integrations",
		Long: `Tiddly CLI automates setup for AI tool integrations.

Authenticate, install MCP servers, sync skills, export data, and manage tokens.`,
		SilenceErrors: true,
		SilenceUsage:  true,
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			// Skip init for completion and help commands
			if cmd.Name() == "completion" || cmd.Name() == "help" {
				return nil
			}

			// Always bind flags to viper (even when deps pre-set by tests)
			if flagAPIURL != "" {
				viper.Set("api_url", flagAPIURL)
			}
			if flagFormat != "" {
				viper.Set("format", flagFormat)
			}

			// Initialize config and deps (unless deps already set by test)
			if appDeps == nil {
				configDir := config.Dir()
				if err := config.Init(""); err != nil {
					return err
				}

				keyringMode := auth.KeyringAuto
				switch flagKeyring {
				case "force":
					keyringMode = auth.KeyringForce
				case "file":
					keyringMode = auth.KeyringFile
				}

				store, fileFallback := auth.NewCredentialStore(keyringMode, configDir)
				df := auth.NewDeviceFlow(auth.DefaultAuth0Config())
				tm := auth.NewTokenManager(store, df)

				appDeps = &AppDeps{
					CredStore:         store,
					TokenManager:      tm,
					ConfigDir:         configDir,
					ExecLooker:        &realExecLooker{},
					FileStoreFallback: fileFallback,
				}
			}

			return nil
		},
	}

	rootCmd.PersistentFlags().StringVar(&flagToken, "token", "", "Override auth token")
	rootCmd.PersistentFlags().StringVar(&flagAPIURL, "api-url", "", "API base URL (default: https://api.tiddly.me)")
	rootCmd.PersistentFlags().StringVar(&flagFormat, "format", "", "Output format: text, json (default: text)")
	rootCmd.PersistentFlags().StringVar(&flagKeyring, "keyring", "auto", "Credential storage: auto, force, file")
	_ = rootCmd.PersistentFlags().MarkHidden("keyring")

	rootCmd.AddCommand(newLoginCmd())
	rootCmd.AddCommand(newLogoutCmd())
	rootCmd.AddCommand(newAuthCmd())
	rootCmd.AddCommand(newStatusCmd())
	rootCmd.AddCommand(newMCPCmd())

	return rootCmd
}

// Execute runs the root command.
func Execute() error {
	return newRootCmd().Execute()
}

// apiURL returns the resolved API URL.
func apiURL() string {
	url := viper.GetString("api_url")
	if url == "" {
		return config.DefaultAPIURL
	}
	return url
}
