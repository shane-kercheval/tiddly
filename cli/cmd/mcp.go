package cmd

import (
	"errors"
	"fmt"
	"strings"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/mcp"
	"github.com/spf13/cobra"
)

var validTools = []string{"claude-desktop", "claude-code", "codex"}

func newMCPCmd() *cobra.Command {
	mcpCmd := &cobra.Command{
		Use:   "mcp",
		Short: "Manage MCP server integrations",
	}

	mcpCmd.AddCommand(newMCPInstallCmd())
	mcpCmd.AddCommand(newMCPStatusCmd())
	mcpCmd.AddCommand(newMCPUninstallCmd())

	return mcpCmd
}

func newMCPInstallCmd() *cobra.Command {
	var (
		dryRun    bool
		scope     string
		expiresIn int
		servers   string
	)

	cmd := &cobra.Command{
		Use:   "install [tool...]",
		Short: "Install MCP servers for AI tools",
		Long: `Install Tiddly MCP servers for AI tools.

  tiddly mcp install                      Auto-detect and install for all found tools
  tiddly mcp install claude-code          Install for a specific tool
  tiddly mcp install --dry-run            Preview changes without writing
  tiddly mcp install --servers content    Install only the content server`,
		ValidArgs: validTools,
		RunE: func(cmd *cobra.Command, args []string) error {
			validScopes := []string{"user", "local", "project"}
			scopeValid := false
			for _, s := range validScopes {
				if scope == s {
					scopeValid = true
					break
				}
			}
			if !scopeValid {
				return fmt.Errorf("invalid scope %q. Valid scopes: %s", scope, strings.Join(validScopes, ", "))
			}

			// Parse and validate --servers flag
			serverList, err := parseServersFlag(servers)
			if err != nil {
				return err
			}

			// Resolve auth — prefer OAuth for token creation
			result, err := appDeps.TokenManager.ResolveToken(flagToken, true)
			if err != nil {
				if errors.Is(err, auth.ErrNotLoggedIn) {
					return fmt.Errorf("not logged in. Run 'tiddly login' first")
				}
				return err
			}

			client := api.NewClient(apiURL(), result.Token, result.AuthType)
			client.Stderr = cmd.ErrOrStderr()

			// Detect or filter tools
			allTools := mcp.DetectTools(appDeps.ExecLooker)
			var targetTools []mcp.DetectedTool

			if len(args) > 0 {
				// Specific tools requested
				for _, arg := range args {
					if !isValidTool(arg) {
						return fmt.Errorf("unknown tool %q. Valid tools: %s", arg, strings.Join(validTools, ", "))
					}
					for _, t := range allTools {
						if t.Name == arg {
							if !t.Installed {
								return fmt.Errorf("%s is not installed on this system", arg)
							}
							targetTools = append(targetTools, t)
						}
					}
				}
			} else {
				// Auto-detect: use all installed tools
				for _, t := range allTools {
					if t.Installed {
						targetTools = append(targetTools, t)
					}
				}
			}

			if len(targetTools) == 0 {
				fmt.Fprintln(cmd.OutOrStdout(), "No AI tools detected on this system.")
				fmt.Fprintln(cmd.OutOrStdout(), "Supported tools: "+strings.Join(validTools, ", "))
				return nil
			}

			var expires *int
			if expiresIn > 0 {
				expires = &expiresIn
			}

			opts := mcp.InstallOpts{
				Client:    client,
				AuthType:  result.AuthType,
				DryRun:    dryRun,
				Scope:     scope,
				Servers:   serverList,
				ExpiresIn: expires,
				Output:    cmd.OutOrStdout(),
				ErrOutput: cmd.ErrOrStderr(),
			}

			installResult, err := mcp.RunInstall(opts, targetTools)
			if err != nil {
				return err
			}

			if !dryRun {
				// Print summary
				if len(installResult.TokensCreated) > 0 {
					fmt.Fprintf(cmd.OutOrStdout(), "Created tokens: %s\n", strings.Join(installResult.TokensCreated, ", "))
				}
				if len(installResult.TokensReused) > 0 {
					fmt.Fprintf(cmd.OutOrStdout(), "Reused tokens: %s\n", strings.Join(installResult.TokensReused, ", "))
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Configured: %s\n", strings.Join(installResult.ToolsConfigured, ", "))
			}

			for _, warning := range installResult.Warnings {
				fmt.Fprintf(cmd.ErrOrStderr(), "Warning: %s\n", warning)
			}

			return nil
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview changes without writing")
	cmd.Flags().StringVar(&scope, "scope", "user", "Claude Code scope: user (global) or local (project)")
	cmd.Flags().IntVar(&expiresIn, "expires", 0, "PAT expiration in days (0 = no expiration)")
	cmd.Flags().StringVar(&servers, "servers", "content,prompts", "Which MCP servers to install: content, prompts, or both")

	return cmd
}

// parseServersFlag validates and parses the --servers flag value.
func parseServersFlag(value string) ([]string, error) {
	parts := strings.Split(value, ",")
	var result []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if p != "content" && p != "prompts" {
			return nil, fmt.Errorf("invalid server %q in --servers flag. Valid values: content, prompts", p)
		}
		result = append(result, p)
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("--servers flag requires at least one value: content, prompts")
	}
	return result, nil
}

func newMCPStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show MCP server configuration status",
		RunE: func(cmd *cobra.Command, args []string) error {
			w := cmd.OutOrStdout()
			tools := mcp.DetectTools(appDeps.ExecLooker)

			for _, tool := range tools {
				if !tool.Installed {
					fmt.Fprintf(w, "%-18s Not detected\n", tool.Name+":")
					continue
				}

				servers, err := getToolStatus(tool, "user")
				if err != nil {
					fmt.Fprintf(w, "%-18s Error: %v\n", tool.Name+":", err)
					continue
				}

				if len(servers) == 0 {
					fmt.Fprintf(w, "%-18s Not configured\n", tool.Name+":")
				} else {
					fmt.Fprintf(w, "%-18s Configured (%s)\n", tool.Name+":", strings.Join(servers, ", "))
				}
			}

			return nil
		},
	}
}

func newMCPUninstallCmd() *cobra.Command {
	var (
		deleteTokens bool
		scope        string
	)

	cmd := &cobra.Command{
		Use:       "uninstall <tool>",
		Short:     "Remove MCP server configuration for a tool",
		Args:      cobra.ExactArgs(1),
		ValidArgs: validTools,
		RunE: func(cmd *cobra.Command, args []string) error {
			toolName := args[0]
			if !isValidTool(toolName) {
				return fmt.Errorf("unknown tool %q. Valid tools: %s", toolName, strings.Join(validTools, ", "))
			}

			tools := mcp.DetectTools(appDeps.ExecLooker)

			var tool *mcp.DetectedTool
			for _, t := range tools {
				if t.Name == toolName {
					tool = &t
					break
				}
			}

			if tool == nil || !tool.Installed {
				return fmt.Errorf("%s is not installed on this system", toolName)
			}

			// Extract PATs from config BEFORE removing entries
			var extractedPATs []string
			if deleteTokens {
				contentPAT, promptPAT := mcp.ExtractPATsFromTool(*tool, scope)
				if contentPAT != "" {
					extractedPATs = append(extractedPATs, contentPAT)
				}
				if promptPAT != "" {
					extractedPATs = append(extractedPATs, promptPAT)
				}
			}

			// Remove config entries
			switch toolName {
			case "claude-desktop":
				if err := mcp.UninstallClaudeDesktop(tool.ResolvedConfigPath()); err != nil {
					return err
				}
			case "claude-code":
				if err := mcp.UninstallClaudeCode(tool.ResolvedConfigPath(), scope); err != nil {
					return err
				}
			case "codex":
				if err := mcp.UninstallCodex(tool.ResolvedConfigPath()); err != nil {
					return err
				}
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Removed Tiddly MCP servers from %s.\n", toolName)

			// Token cleanup
			result, err := appDeps.TokenManager.ResolveToken(flagToken, true)
			if err == nil {
				client := api.NewClient(apiURL(), result.Token, result.AuthType)

				if deleteTokens && len(extractedPATs) > 0 {
					deleted, delErr := mcp.DeleteTokensByPrefix(client, extractedPATs)
					if delErr != nil {
						fmt.Fprintf(cmd.ErrOrStderr(), "Warning: Failed to delete tokens: %v\n", delErr)
					} else if len(deleted) > 0 {
						fmt.Fprintf(cmd.OutOrStdout(), "Deleted tokens: %s\n", strings.Join(deleted, ", "))
					}
				} else if !deleteTokens {
					orphaned, orphanErr := mcp.CheckOrphanedTokens(client)
					if orphanErr == nil && len(orphaned) > 0 {
						fmt.Fprintf(cmd.ErrOrStderr(),
							"Warning: PATs created for MCP servers still exist: %s\n", strings.Join(orphaned, ", "))
						fmt.Fprintln(cmd.ErrOrStderr(),
							"Run 'tiddly mcp uninstall <tool> --delete-tokens' to revoke, or 'tiddly tokens list' to review.")
					}
				}
			}

			if toolName == "claude-desktop" {
				fmt.Fprintln(cmd.ErrOrStderr(), "Restart Claude Desktop to apply changes.")
			}

			return nil
		},
	}

	cmd.Flags().BoolVar(&deleteTokens, "delete-tokens", false, "Revoke PATs extracted from config during uninstall")
	cmd.Flags().StringVar(&scope, "scope", "user", "Claude Code scope: user (global) or local (project)")

	return cmd
}

func isValidTool(name string) bool {
	for _, t := range validTools {
		if t == name {
			return true
		}
	}
	return false
}
