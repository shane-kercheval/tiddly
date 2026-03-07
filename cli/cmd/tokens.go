package cmd

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

func newTokensCmd() *cobra.Command {
	tokensCmd := &cobra.Command{
		Use:   "tokens",
		Short: "Manage Personal Access Tokens",
		Long: `Manage Personal Access Tokens (PATs) for programmatic API access.

  tiddly tokens list                     List all tokens
  tiddly tokens create "My Token"        Create a new token
  tiddly tokens create "CI" --expires 90 Create a token expiring in 90 days
  tiddly tokens delete <id>              Delete a token

Token management requires OAuth login (browser-based). PAT authentication is not sufficient.`,
	}

	tokensCmd.AddCommand(newTokensListCmd())
	tokensCmd.AddCommand(newTokensCreateCmd())
	tokensCmd.AddCommand(newTokensDeleteCmd())

	return tokensCmd
}

// resolveOAuthToken resolves an OAuth token for token management commands.
// Returns a client or prints a helpful error and returns nil.
func resolveOAuthToken(cmd *cobra.Command) (*api.Client, error) {
	result, err := appDeps.TokenManager.ResolveToken(flagToken, true)
	if err != nil {
		return nil, err
	}

	client := api.NewClient(apiURL(), result.Token, result.AuthType)
	client.Stderr = cmd.ErrOrStderr()
	return client, nil
}

func newTokensListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all Personal Access Tokens",
		Long: `List all Personal Access Tokens for your account.

Displays a table with columns: ID, NAME, PREFIX, LAST USED, EXPIRES, CREATED.
Requires OAuth login (browser-based). PAT authentication cannot list tokens.

Examples:
  tiddly tokens list`,
		RunE: func(cmd *cobra.Command, args []string) error {
			client, err := resolveOAuthToken(cmd)
			if err != nil {
				return err
			}

			tokens, err := client.ListTokens(cmd.Context())
			if err != nil {
				return handleTokenAPIError(err)
			}

			if len(tokens) == 0 {
				fmt.Fprintln(cmd.OutOrStdout(), "No tokens found.")
				return nil
			}

			w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "ID\tNAME\tPREFIX\tLAST USED\tEXPIRES\tCREATED")
			for _, tok := range tokens {
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n",
					tok.ID,
					tok.Name,
					tok.TokenPrefix,
					formatOptionalDate(tok.LastUsedAt),
					formatOptionalDate(tok.ExpiresAt),
					formatDate(tok.CreatedAt),
				)
			}
			return w.Flush()
		},
	}
}

func newTokensCreateCmd() *cobra.Command {
	var expires int

	cmd := &cobra.Command{
		Use:   "create <name>",
		Short: "Create a new Personal Access Token",
		Long: `Create a new Personal Access Token for programmatic API access.

The token value is displayed once and cannot be retrieved again — copy it immediately. Requires OAuth login; PAT authentication cannot create tokens.

Without --expires, the token has no expiration. With --expires, provide a number of days (1-365).

Examples:
  tiddly tokens create "My Token"
  tiddly tokens create "CI Pipeline" --expires 90`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]

			client, err := resolveOAuthToken(cmd)
			if err != nil {
				return err
			}

			var expiresPtr *int
			if cmd.Flags().Changed("expires") {
				if expires < 1 || expires > 365 {
					return fmt.Errorf("--expires must be between 1 and 365 days")
				}
				expiresPtr = &expires
			}

			resp, err := client.CreateToken(cmd.Context(), name, expiresPtr)
			if err != nil {
				return handleTokenAPIError(err)
			}

			fmt.Fprintln(cmd.OutOrStdout(), "Token created successfully.")
			fmt.Fprintln(cmd.OutOrStdout())
			fmt.Fprintf(cmd.OutOrStdout(), "  %s\n", resp.Token)
			fmt.Fprintln(cmd.OutOrStdout())
			fmt.Fprintln(cmd.ErrOrStderr(), "Warning: This token will not be shown again. Copy it now.")

			if resp.ExpiresAt != nil {
				fmt.Fprintf(cmd.OutOrStdout(), "Expires: %s\n", *resp.ExpiresAt)
			}

			return nil
		},
	}

	cmd.Flags().IntVar(&expires, "expires", 0, "Expiration in days (1-365)")

	return cmd
}

func newTokensDeleteCmd() *cobra.Command {
	var force bool

	cmd := &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a Personal Access Token",
		Long: `Delete (revoke) a Personal Access Token by ID.

Prompts for confirmation before deleting. Use --force to skip the prompt.
Requires OAuth login (browser-based). PAT authentication cannot delete tokens.

Examples:
  tiddly tokens delete abc123            Delete with confirmation prompt
  tiddly tokens delete abc123 --force    Delete without confirmation`,
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			tokenID := args[0]

			client, err := resolveOAuthToken(cmd)
			if err != nil {
				return err
			}

			if !force {
				confirmed, err := confirmDelete(cmd, tokenID)
				if err != nil {
					return err
				}
				if !confirmed {
					return fmt.Errorf("deletion cancelled (use --force to skip confirmation)")
				}
			}

			if err := client.DeleteToken(cmd.Context(), tokenID); err != nil {
				return handleTokenAPIError(err)
			}

			fmt.Fprintln(cmd.OutOrStdout(), "Token deleted.")
			return nil
		},
	}

	cmd.Flags().BoolVar(&force, "force", false, "Skip confirmation prompt")

	return cmd
}

// confirmDelete prompts the user for confirmation.
// Returns (false, nil) if user declines, (false, error) if non-interactive or read fails.
func confirmDelete(cmd *cobra.Command, tokenID string) (bool, error) {
	in := cmd.InOrStdin()

	// Check if input is a TTY; non-*os.File streams are treated as non-interactive
	if f, ok := in.(*os.File); !ok || !term.IsTerminal(int(f.Fd())) {
		return false, fmt.Errorf("use --force to skip confirmation in non-interactive mode")
	}

	fmt.Fprintf(cmd.ErrOrStderr(), "Delete token %s? [y/N] ", tokenID)
	scanner := bufio.NewScanner(in)
	if scanner.Scan() {
		answer := strings.TrimSpace(strings.ToLower(scanner.Text()))
		return answer == "y" || answer == "yes", nil
	}
	if err := scanner.Err(); err != nil {
		return false, fmt.Errorf("reading confirmation: %w", err)
	}
	return false, nil
}

// handleTokenAPIError wraps 403 errors with a helpful message for token management.
func handleTokenAPIError(err error) error {
	var apiErr *api.APIError
	if errors.As(err, &apiErr) && apiErr.StatusCode == 403 {
		return fmt.Errorf("token management requires browser login. Run 'tiddly login' first")
	}
	return err
}

func formatOptionalDate(s *string) string {
	if s == nil {
		return "—"
	}
	return formatDate(*s)
}

func formatDate(s string) string {
	// Truncate ISO 8601 to date only for readability
	if len(s) >= 10 {
		return s[:10]
	}
	return s
}
