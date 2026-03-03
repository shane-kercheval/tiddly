package cmd

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/spf13/cobra"
)

func newLoginCmd() *cobra.Command {
	var tokenFlag string

	cmd := &cobra.Command{
		Use:   "login",
		Short: "Authenticate with Tiddly",
		Long: `Authenticate with Tiddly using OAuth device flow or a Personal Access Token.

  tiddly login              Open browser for OAuth login
  tiddly login --token X    Use a Personal Access Token`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if tokenFlag != "" {
				return loginWithPAT(cmd, tokenFlag)
			}
			return loginWithOAuth(cmd)
		},
	}

	cmd.Flags().StringVar(&tokenFlag, "token", "", "Personal Access Token (starts with bm_)")

	return cmd
}

func loginWithPAT(cmd *cobra.Command, token string) error {
	// Trim whitespace (common copy-paste artifact)
	original := token
	token = strings.TrimSpace(token)
	if token != original {
		fmt.Fprintln(cmd.ErrOrStderr(), "Trimmed whitespace from token.")
	}

	// Reject tokens with embedded spaces/newlines
	if strings.ContainsAny(token, " \t\n\r") {
		return fmt.Errorf("invalid token: contains embedded whitespace")
	}

	// Validate format
	if err := auth.ValidatePATFormat(token); err != nil {
		return err
	}

	// Verify token works
	client := api.NewClient(apiURL(), token, "pat")
	user, err := client.GetMe()
	if err != nil {
		return fmt.Errorf("token verification failed: %w", err)
	}

	// Store PAT
	if err := appDeps.TokenManager.StorePAT(token); err != nil {
		return fmt.Errorf("storing token: %w", err)
	}

	msg := "Logged in successfully."
	if user.Email != "" {
		msg = fmt.Sprintf("Logged in as %s", user.Email)
	}
	fmt.Fprintln(cmd.OutOrStdout(), msg)
	return nil
}

func loginWithOAuth(cmd *cobra.Command) error {
	// Set up context with Ctrl+C cancellation
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	// Shallow copy the DeviceFlow from appDeps to preserve HTTPClient, BaseURL, etc.
	// Only override Output for command-specific stderr routing.
	var df *auth.DeviceFlow
	if appDeps.TokenManager.DeviceFlow != nil {
		dfCopy := *appDeps.TokenManager.DeviceFlow
		dfCopy.Output = cmd.ErrOrStderr()
		df = &dfCopy
	} else {
		df = auth.NewDeviceFlow(auth.DefaultAuth0Config())
		df.Output = cmd.ErrOrStderr()
	}

	tokens, err := df.Login(ctx)
	if err != nil {
		if ctx.Err() != nil {
			fmt.Fprintln(cmd.OutOrStdout(), "Login cancelled.")
			return nil
		}
		return fmt.Errorf("login failed: %w", err)
	}

	// Store OAuth tokens
	if err := appDeps.TokenManager.StoreOAuthTokens(tokens.AccessToken, tokens.RefreshToken); err != nil {
		return fmt.Errorf("storing credentials: %w", err)
	}

	// Verify and show user info
	client := api.NewClient(apiURL(), tokens.AccessToken, "oauth")
	user, err := client.GetMe()
	if err != nil {
		// Handle 451 consent required gracefully
		if apiErr, ok := err.(*api.APIError); ok && apiErr.StatusCode == 451 {
			fmt.Fprintln(cmd.OutOrStdout(), "Logged in successfully.")
			fmt.Fprintln(cmd.ErrOrStderr(), "Warning: Terms of Service acceptance required.")
			consentURL := apiErr.ConsentURL
			if consentURL == "" {
				consentURL = "https://tiddly.me/terms"
			}
			fmt.Fprintf(cmd.ErrOrStderr(), "  Visit %s to accept, then retry your command.\n", consentURL)
			return nil
		}
		// Non-451 errors: credentials stored but warn
		fmt.Fprintln(cmd.OutOrStdout(), "Logged in successfully.")
		fmt.Fprintf(cmd.ErrOrStderr(), "Warning: Could not verify user info: %v\n", err)
		return nil
	}

	msg := "Logged in successfully."
	if user.Email != "" {
		msg = fmt.Sprintf("Logged in as %s", user.Email)
	}
	fmt.Fprintln(cmd.OutOrStdout(), msg)
	return nil
}
