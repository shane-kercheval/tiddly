package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newLogoutCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "Clear stored credentials",
		Long: `Remove all stored credentials (OAuth tokens and PATs).

  tiddly logout    Clear credentials and log out`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := appDeps.TokenManager.ClearAll(); err != nil {
				return fmt.Errorf("clearing credentials: %w", err)
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Logged out successfully.")
			return nil
		},
	}
}
