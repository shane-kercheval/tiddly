package cmd

import (
	"fmt"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/spf13/cobra"
)

func newAuthCmd() *cobra.Command {
	authCmd := &cobra.Command{
		Use:   "auth",
		Short: "Authentication management",
	}

	authCmd.AddCommand(newAuthStatusCmd())

	return authCmd
}

func newAuthStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show current authentication status",
		RunE: func(cmd *cobra.Command, args []string) error {
			authType := appDeps.TokenManager.GetStoredAuthType()

			if authType == "none" {
				fmt.Fprintln(cmd.OutOrStdout(), "Not logged in.")
				fmt.Fprintln(cmd.OutOrStdout(), "Run 'tiddly login' to authenticate.")
				return nil
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Auth method: %s\n", authType)
			fmt.Fprintf(cmd.OutOrStdout(), "API URL: %s\n", apiURL())

			// Try to get user info
			result, err := appDeps.TokenManager.ResolveToken(flagToken, false)
			if err != nil {
				fmt.Fprintf(cmd.OutOrStdout(), "Token: stored but could not resolve (%v)\n", err)
				return nil
			}

			client := api.NewClient(apiURL(), result.Token, result.AuthType)
			user, err := client.GetMe()
			if err != nil {
				fmt.Fprintf(cmd.OutOrStdout(), "User: unknown (API error: %v)\n", err)
				return nil
			}

			if user.Email != "" {
				fmt.Fprintf(cmd.OutOrStdout(), "User: %s\n", user.Email)
			}

			return nil
		},
	}
}
