package cmd

import (
	"fmt"
	"os"

	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/config"
	"github.com/shane-kercheval/tiddly/cli/internal/mcp"
	"github.com/shane-kercheval/tiddly/cli/internal/update"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var (
	flagToken   string
	flagAPIURL  string
	flagKeyring string
)

// AppDeps holds the application dependencies, injectable for testing.
type AppDeps struct {
	CredStore         auth.CredentialStore
	TokenManager      *auth.TokenManager
	ConfigDir         string
	ExecLooker        mcp.ExecLooker
	ToolHandlers      []mcp.ToolHandler // MCP tool handlers; nil uses DefaultHandlers()
	FileStoreFallback bool              // true if credentials fell back to plaintext file storage
	UpdateChecker     update.Checker
}

// handlers returns the tool handlers, defaulting to production handlers if not set.
func (d *AppDeps) handlers() []mcp.ToolHandler {
	if d.ToolHandlers != nil {
		return d.ToolHandlers
	}
	return mcp.DefaultHandlers()
}

// appDeps is the global deps instance, set during PersistentPreRunE or by tests.
var appDeps *AppDeps

// SetDeps allows tests to inject dependencies before command execution.
func SetDeps(deps *AppDeps) {
	appDeps = deps
	updateCheckResult = nil
}

// updateCheckResult receives the background update check result (if started).
var updateCheckResult <-chan string

func newRootCmd() *cobra.Command {
	rootCmd := &cobra.Command{
		Use:   "tiddly",
		Short: "Tiddly CLI — manage your bookmarks, notes, and AI integrations",
		Long: `Tiddly CLI automates setup for AI tool integrations.

Authenticate, configure MCP servers, sync skills, export data, and manage tokens.`,
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

			// Start background update check
			if shouldCheckForUpdates(cmd, appDeps.ConfigDir) {
				checker := appDeps.UpdateChecker
				if checker == nil {
					checker = update.NewGitHubChecker()
				}
				updateCheckResult = startUpdateCheck(cmd.Context(), checker, appDeps.ConfigDir)
			}

			return nil
		},
		// Cobra only runs the most-specific post-run hook. Do not add PersistentPostRun
		// to subcommands — it would override this one and suppress update notifications.
		PersistentPostRun: func(cmd *cobra.Command, args []string) {
			if updateCheckResult == nil {
				return
			}
			// Non-blocking: only print if the result is already available
			select {
			case msg := <-updateCheckResult:
				if msg != "" {
					fmt.Fprintln(os.Stderr, msg)
				}
			default:
			}
		},
	}

	rootCmd.Version = cliVersion

	rootCmd.PersistentFlags().StringVar(&flagToken, "token", "", "Override auth token")
	rootCmd.PersistentFlags().StringVar(&flagAPIURL, "api-url", "", "API base URL (default: https://api.tiddly.me)")
	rootCmd.PersistentFlags().StringVar(&flagKeyring, "keyring", "auto", "Credential storage: auto, force, file")
	_ = rootCmd.PersistentFlags().MarkHidden("keyring")

	rootCmd.AddCommand(newLoginCmd())
	rootCmd.AddCommand(newLogoutCmd())
	rootCmd.AddCommand(newAuthCmd())
	rootCmd.AddCommand(newStatusCmd())
	rootCmd.AddCommand(newMCPCmd())
	rootCmd.AddCommand(newSkillsCmd())
	rootCmd.AddCommand(newExportCmd())
	rootCmd.AddCommand(newTokensCmd())
	rootCmd.AddCommand(newCompletionCmd())
	rootCmd.AddCommand(newConfigCmd())
	rootCmd.AddCommand(newUpgradeCmd())

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
