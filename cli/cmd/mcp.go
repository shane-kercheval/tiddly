package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/mcp"
	"github.com/spf13/cobra"
)

var validTools = []string{"claude-desktop", "claude-code", "codex"}

// validScopes is the flat list of all known scopes, used for early typo rejection
// before per-tool validation in ResolveToolConfig.
var validScopes = []string{"user", "local", "project"}

func validateScope(scope string) error {
	for _, s := range validScopes {
		if scope == s {
			return nil
		}
	}
	return fmt.Errorf("invalid scope %q. Valid scopes: %s", scope, strings.Join(validScopes, ", "))
}

func newMCPCmd() *cobra.Command {
	mcpCmd := &cobra.Command{
		Use:   "mcp",
		Short: "Manage MCP server integrations",
		Long: `Install, configure, and manage MCP (Model Context Protocol) servers for AI tools like Claude Desktop, Claude Code, and Codex.

  tiddly mcp install             Auto-detect tools and configure MCP servers
  tiddly mcp status              Show MCP configuration for all tools
  tiddly mcp uninstall <tool>    Remove MCP configuration from a tool`,
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

Servers are identified by URL, not by name. If an existing entry points to a Tiddly MCP URL (regardless of its key name), it is replaced with the canonical entry. This means re-installs and migrations from manual setups are safe.

Examples:
  tiddly mcp install                      Auto-detect and install for all found tools
  tiddly mcp install claude-code          Install for a specific tool
  tiddly mcp install --dry-run            Preview changes without writing
  tiddly mcp install --servers content    Install only the content server`,
		ValidArgs: validTools,
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validateScope(scope); err != nil {
				return err
			}

			// Parse and validate --servers flag
			serverList, err := parseServersFlag(servers)
			if err != nil {
				return err
			}

			// Resolve auth — prefer OAuth for token creation
			result, err := appDeps.TokenManager.ResolveToken(flagToken, true)
			if err != nil {
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
				// Auto-detect: use all installed tools, skip those that don't support the scope
				for _, t := range allTools {
					if !t.Installed {
						continue
					}
					if !mcp.IsScopeSupported(t.Name, scope) {
						supported := mcp.ToolSupportedScopes(t.Name)
						fmt.Fprintf(cmd.ErrOrStderr(), "Skipping %s: --scope %s is not supported (valid: %s)\n",
							t.Name, scope, strings.Join(supported, ", "))
						continue
					}
					targetTools = append(targetTools, t)
				}
			}

			// Pre-validate scope for all explicit tools before any installs
			if len(args) > 0 {
				var unsupported []string
				for _, t := range targetTools {
					if !mcp.IsScopeSupported(t.Name, scope) {
						supported := mcp.ToolSupportedScopes(t.Name)
						unsupported = append(unsupported, fmt.Sprintf("%s (valid: %s)", t.Name, strings.Join(supported, ", ")))
					}
				}
				if len(unsupported) > 0 {
					return fmt.Errorf("--scope %s is not supported by: %s", scope, strings.Join(unsupported, "; "))
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

			cwd, err := getWorkingDir()
			if err != nil {
				return err
			}

			opts := mcp.InstallOpts{
				Ctx:       cmd.Context(),
				Client:    client,
				AuthType:  result.AuthType,
				DryRun:    dryRun,
				Scope:     scope,
				Cwd:       cwd,
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
	cmd.Flags().StringVar(&scope, "scope", "user", "Config scope: user (global), local (claude-code only), or project")
	cmd.Flags().IntVar(&expiresIn, "expires", 0, "PAT expiration in days (1-365, or 0 for no expiration)")
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
	var projectPath string

	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show MCP server configuration status",
		Long: `Show MCP server configuration status for each supported AI tool.

Detects Tiddly MCP servers by URL, not by key name. Entries pointing to a Tiddly MCP URL are recognized regardless of their config key name.

Shows all applicable scopes per tool in a tree-style layout:
  Not detected       — binary or config directory not found
  Not configured     — tool is installed but no MCP server entries at that scope
  Configured         — lists which server entries are present (content, prompts)

Use --project-path to specify which project directory to inspect for local/project scopes.
Defaults to the current working directory.

Examples:
  tiddly mcp status                                Show all tools at all scopes
  tiddly mcp status --project-path /path/to/project  Check a specific project`,
		RunE: func(cmd *cobra.Command, args []string) error {
			resolvedProjectPath, err := resolveProjectPath(projectPath)
			if err != nil {
				return err
			}

			w := cmd.OutOrStdout()
			tools := mcp.DetectTools(appDeps.ExecLooker)
			projectPathExplicit := cmd.Flags().Changed("project-path")
			printMCPTree(w, cmd.ErrOrStderr(), tools, resolvedProjectPath, projectPathExplicit)

			return nil
		},
	}

	cmd.Flags().StringVar(&projectPath, "project-path", "", "Project directory to inspect for local/project scopes (default: cwd)")

	return cmd
}

func newMCPUninstallCmd() *cobra.Command {
	var (
		deleteTokens bool
		scope        string
	)

	cmd := &cobra.Command{
		Use:       "uninstall <tool>",
		Short:     "Remove MCP server configuration for a tool",
		Long: `Remove Tiddly MCP server entries from a tool's config file. All other config keys are preserved.

Servers are identified by URL, not by name. Any entry pointing to a Tiddly MCP URL is removed, even if the key name differs from the default.

With --delete-tokens (requires OAuth login), the CLI reads PATs from the tool's config before removing entries, then revokes those tokens from your account. Without --delete-tokens, warns about potentially orphaned tokens.

Claude Desktop users: restart Claude Desktop after uninstalling.

Examples:
  tiddly mcp uninstall claude-code                   Remove MCP entries
  tiddly mcp uninstall claude-code --delete-tokens   Remove entries and revoke PATs
  tiddly mcp uninstall codex --scope project         Remove from project config`,
		Args:      cobra.ExactArgs(1),
		ValidArgs: validTools,
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validateScope(scope); err != nil {
				return err
			}

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

			cwd, err := getWorkingDir()
			if err != nil {
				return err
			}

			rc, err := mcp.ResolveToolConfig(tool.Name, tool.ConfigPath, scope, cwd)
			if err != nil {
				return err
			}

			// Extract PATs from config BEFORE removing entries
			var extractedPATs []string
			if deleteTokens {
				contentPAT, promptPAT := mcp.ExtractPATsFromTool(*tool, rc)
				if contentPAT != "" {
					extractedPATs = append(extractedPATs, contentPAT)
				}
				if promptPAT != "" && promptPAT != contentPAT {
					extractedPATs = append(extractedPATs, promptPAT)
				}
			}

			// Remove config entries
			switch toolName {
			case "claude-desktop":
				if err := mcp.UninstallClaudeDesktop(rc.Path); err != nil {
					return err
				}
			case "claude-code":
				if err := mcp.UninstallClaudeCode(rc); err != nil {
					return err
				}
			case "codex":
				if err := mcp.UninstallCodex(rc); err != nil {
					return err
				}
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Removed Tiddly MCP servers from %s.\n", toolName)

			// Token cleanup
			result, err := appDeps.TokenManager.ResolveToken(flagToken, true)
			if err == nil {
				client := api.NewClient(apiURL(), result.Token, result.AuthType)

				if deleteTokens && len(extractedPATs) > 0 {
					deleted, delErr := mcp.DeleteTokensByPrefix(cmd.Context(), client, extractedPATs)
					if len(deleted) > 0 {
						fmt.Fprintf(cmd.OutOrStdout(), "Deleted tokens: %s\n", strings.Join(deleted, ", "))
					}
					if delErr != nil {
						fmt.Fprintf(cmd.ErrOrStderr(), "Warning: Some tokens could not be deleted: %v\n", delErr)
					}
				} else if !deleteTokens {
					orphaned, orphanErr := mcp.CheckOrphanedTokens(cmd.Context(), client, toolName)
					if orphanErr == nil && len(orphaned) > 0 {
						fmt.Fprintf(cmd.ErrOrStderr(),
							"Warning: PATs created for %s may still exist: %s\n", toolName, strings.Join(orphaned, ", "))
						fmt.Fprintf(cmd.ErrOrStderr(),
							"Run 'tiddly mcp uninstall %s --delete-tokens' to revoke, or manage tokens at https://tiddly.me/settings.\n", toolName)
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
	cmd.Flags().StringVar(&scope, "scope", "user", "Config scope: user (global), local (claude-code only), or project")

	return cmd
}

func getWorkingDir() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("determining working directory: %w", err)
	}
	return cwd, nil
}

func isValidTool(name string) bool {
	for _, t := range validTools {
		if t == name {
			return true
		}
	}
	return false
}
