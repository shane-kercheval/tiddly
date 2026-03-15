package cmd

import (
	"fmt"
	"os"
	"slices"
	"strings"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/mcp"
	"github.com/spf13/cobra"
)


// validScopes is the list of Tiddly-facing scope values accepted by --scope.
// Translated to handler-native values (e.g., "directory" → "local" for Claude Code)
// before passing to handlers.
var validScopes = []string{"user", "directory"}


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
		Long: `Configure and manage MCP (Model Context Protocol) servers for AI tools like Claude Desktop, Claude Code, and Codex.

  tiddly mcp configure           Auto-detect tools and configure MCP servers
  tiddly mcp status              Show MCP configuration for all tools
  tiddly mcp remove <tool>       Remove MCP configuration from a tool`,
	}

	mcpCmd.AddCommand(newMCPConfigureCmd())
	mcpCmd.AddCommand(newMCPStatusCmd())
	mcpCmd.AddCommand(newMCPRemoveCmd())

	return mcpCmd
}

func newMCPConfigureCmd() *cobra.Command {
	var (
		dryRun    bool
		scope     string
		expiresIn int
		servers   string
	)

	cmd := &cobra.Command{
		Use:   "configure [tool...]",
		Short: "Configure MCP servers for AI tools",
		Long: `Configure Tiddly MCP servers for AI tools.

Servers are identified by URL, not by name. If an existing entry points to a Tiddly MCP URL (regardless of its key name), it is replaced with the canonical entry. This means re-configuring and migrations from manual setups are safe.

Scope:
  The --scope flag controls where the MCP server config is written. The default is "user",
  which makes Tiddly servers available across all projects.

  user       Configuration available everywhere for the user
  directory  Configuration only applies when running tools from a specific directory

Examples:
  tiddly mcp configure                                  Auto-detect and configure for all found tools
  tiddly mcp configure claude-code                      Configure for a specific tool
  tiddly mcp configure claude-code --scope directory    Configure for the current directory only
  tiddly mcp configure --dry-run                        Preview changes without writing
  tiddly mcp configure --servers content                Configure only the content server`,
		ValidArgs: mcp.ValidToolNames(mcp.DefaultHandlers()),
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
			handlers := appDeps.handlers()
			toolNames := mcp.ValidToolNames(handlers)
			allTools := mcp.DetectAll(handlers, appDeps.ExecLooker)
			var targetTools []mcp.DetectedTool

			if len(args) > 0 {
				// Specific tools requested
				for _, arg := range args {
					if !isValidTool(arg, toolNames) {
						return fmt.Errorf("unknown tool %q. Valid tools: %s", arg, strings.Join(toolNames, ", "))
					}
					for _, t := range allTools {
						if t.Name == arg {
							if !t.Detected {
								return fmt.Errorf("%s is not installed on this system", arg)
							}
							targetTools = append(targetTools, t)
						}
					}
				}
			} else {
				// Auto-detect: use all detected tools, skip those that don't support the scope
				for _, t := range allTools {
					if !t.Detected {
						continue
					}
					if !mcp.IsTiddlyScopeSupported(scope, t.Name) {
						fmt.Fprintf(cmd.ErrOrStderr(), "Skipping %s: --scope %s is not supported\n",
							t.Name, scope)
						continue
					}
					targetTools = append(targetTools, t)
				}
			}

			// Pre-validate scope for all explicit tools before configuring
			if len(args) > 0 {
				var unsupported []string
				for _, t := range targetTools {
					if !mcp.IsTiddlyScopeSupported(scope, t.Name) {
						unsupported = append(unsupported, t.Name)
					}
				}
				if len(unsupported) > 0 {
					return fmt.Errorf("--scope %s is not supported by: %s", scope, strings.Join(unsupported, "; "))
				}
			}

			if len(targetTools) == 0 {
				fmt.Fprintln(cmd.OutOrStdout(), "No AI tools detected on this system.")
				fmt.Fprintln(cmd.OutOrStdout(), "Supported tools: "+strings.Join(toolNames, ", "))
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

			opts := mcp.ConfigureOpts{
				Ctx:       cmd.Context(),
				Client:    client,
				Handlers:  handlers,
				AuthType:  result.AuthType,
				DryRun:    dryRun,
				Scope:     scope,
				Cwd:       cwd,
				Servers:   serverList,
				ExpiresIn: expires,
				Output:    cmd.OutOrStdout(),
				ErrOutput: cmd.ErrOrStderr(),
			}

			configureResult, err := mcp.RunConfigure(opts, targetTools)
			if err != nil {
				return err
			}

			if !dryRun {
				// Print summary
				if len(configureResult.TokensCreated) > 0 {
					fmt.Fprintf(cmd.OutOrStdout(), "Created tokens: %s\n", strings.Join(configureResult.TokensCreated, ", "))
				}
				if len(configureResult.TokensReused) > 0 {
					fmt.Fprintf(cmd.OutOrStdout(), "Reused tokens: %s\n", strings.Join(configureResult.TokensReused, ", "))
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Configured: %s\n", strings.Join(configureResult.ToolsConfigured, ", "))
			}

			for _, warning := range configureResult.Warnings {
				fmt.Fprintf(cmd.ErrOrStderr(), "Warning: %s\n", warning)
			}

			return nil
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview changes without writing")
	cmd.Flags().StringVar(&scope, "scope", "user", "Config scope: user (all projects) or directory (current directory only)")
	cmd.Flags().IntVar(&expiresIn, "expires", 0, "PAT expiration in days (1-365, or 0 for no expiration)")
	cmd.Flags().StringVar(&servers, "servers", "content,prompts", "Which MCP servers to configure: content, prompts, or both")

	return cmd
}

// parseServersFlag validates and parses the --servers flag value.
func parseServersFlag(value string) ([]string, error) {
	parts := strings.Split(value, ",")
	seen := make(map[string]bool)
	var result []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if p != mcp.ServerContent && p != mcp.ServerPrompts {
			return nil, fmt.Errorf("invalid server %q in --servers flag. Valid values: %s, %s", p, mcp.ServerContent, mcp.ServerPrompts)
		}
		if !seen[p] {
			seen[p] = true
			result = append(result, p)
		}
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
  Not configured     — tool is detected but no MCP server entries at that scope
  Configured         — lists which server entries are present (content, prompts)

Use --path to specify which directory to inspect for directory-scoped configurations.
Defaults to the current working directory.

Examples:
  tiddly mcp status                          Show all tools at all scopes
  tiddly mcp status --path /path/to/project  Check a specific directory`,
		RunE: func(cmd *cobra.Command, args []string) error {
			resolvedProjectPath, err := resolveProjectPath(projectPath)
			if err != nil {
				return err
			}

			w := cmd.OutOrStdout()
			tools := mcp.DetectAll(appDeps.handlers(), appDeps.ExecLooker)
			projectPathExplicit := cmd.Flags().Changed("path")
			printMCPTree(w, tools, resolvedProjectPath, projectPathExplicit)

			return nil
		},
	}

	cmd.Flags().StringVar(&projectPath, "path", "", "Directory to inspect for directory-scoped configurations (default: cwd)")

	return cmd
}

func newMCPRemoveCmd() *cobra.Command {
	var (
		deleteTokens bool
		scope        string
		servers      string
	)

	cmd := &cobra.Command{
		Use:       "remove <tool>",
		Short:     "Remove MCP server configuration for a tool",
		Long: `Remove Tiddly MCP server entries from a tool's config file. All other config keys are preserved.

Servers are identified by URL, not by name. Any entry pointing to a Tiddly MCP URL is removed, even if the key name differs from the default.

With --delete-tokens (requires OAuth login), the CLI reads PATs from the tool's config before removing entries, then revokes those tokens from your account. Without --delete-tokens, warns about potentially orphaned tokens.

Claude Desktop users: restart Claude Desktop after removing.

Use --servers to selectively remove only the content or prompts server, preserving the other.

Examples:
  tiddly mcp remove claude-code                          Remove MCP entries
  tiddly mcp remove claude-code --delete-tokens          Remove entries and revoke PATs
  tiddly mcp remove codex --scope directory              Remove from directory config
  tiddly mcp remove claude-code --servers content        Remove only the content server
  tiddly mcp remove claude-code --servers content --delete-tokens  Remove content server and revoke its PAT`,
		Args:      cobra.ExactArgs(1),
		ValidArgs: mcp.ValidToolNames(mcp.DefaultHandlers()),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validateScope(scope); err != nil {
				return err
			}

			serverList, err := parseServersFlag(servers)
			if err != nil {
				return err
			}

			handlers := appDeps.handlers()
			toolNames := mcp.ValidToolNames(handlers)
			toolName := args[0]
			if !isValidTool(toolName, toolNames) {
				return fmt.Errorf("unknown tool %q. Valid tools: %s", toolName, strings.Join(toolNames, ", "))
			}

			handler, ok := mcp.GetHandler(handlers, toolName)
			if !ok {
				return fmt.Errorf("no handler for %q", toolName)
			}
			allTools := mcp.DetectAll(handlers, appDeps.ExecLooker)

			var tool *mcp.DetectedTool
			for _, t := range allTools {
				if t.Name == toolName {
					tool = &t
					break
				}
			}

			if tool == nil || !tool.Detected {
				return fmt.Errorf("%s is not installed on this system", toolName)
			}

			if !mcp.IsTiddlyScopeSupported(scope, toolName) {
				return fmt.Errorf("--scope %s is not supported by %s", scope, toolName)
			}

			cwd, err := getWorkingDir()
			if err != nil {
				return err
			}

			nativeScope := mcp.TranslateScope(scope, toolName)
			rc, err := mcp.ResolveToolConfig(handler, tool.ConfigPath, nativeScope, cwd)
			if err != nil {
				return err
			}

			// Extract PATs from config BEFORE removing entries, filtered by serverList
			var extractedPATs []string
			if deleteTokens {
				contentPAT, promptPAT := handler.ExtractPATs(rc)
				wantContent := slices.Contains(serverList, mcp.ServerContent)
				wantPrompts := slices.Contains(serverList, mcp.ServerPrompts)
				if wantContent && contentPAT != "" {
					extractedPATs = append(extractedPATs, contentPAT)
				}
				// Dedup: only skip if contentPAT was already added (wantContent && same value)
				if wantPrompts && promptPAT != "" && (!wantContent || promptPAT != contentPAT) {
					extractedPATs = append(extractedPATs, promptPAT)
				}
				// Warn when a shared PAT is being revoked while the other server is retained
				if contentPAT != "" && contentPAT == promptPAT && wantContent != wantPrompts {
					retained := mcp.ServerPrompts
					if wantPrompts {
						retained = mcp.ServerContent
					}
					fmt.Fprintf(cmd.ErrOrStderr(),
						"Warning: token is shared with %s server (still configured); it will also lose access.\n", retained)
				}
			}

			// Remove config entries
			if err := handler.Remove(rc, serverList); err != nil {
				return err
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
					orphaned, orphanErr := mcp.CheckOrphanedTokens(cmd.Context(), client, toolName, serverList)
					if orphanErr == nil && len(orphaned) > 0 {
						fmt.Fprintf(cmd.ErrOrStderr(),
							"Warning: PATs created for %s may still exist: %s\n", toolName, strings.Join(orphaned, ", "))
						suggestedCmd := fmt.Sprintf("tiddly mcp remove %s --delete-tokens", toolName)
						if len(serverList) == 1 {
							suggestedCmd += fmt.Sprintf(" --servers %s", serverList[0])
						}
						fmt.Fprintf(cmd.ErrOrStderr(),
							"Run '%s' to revoke, or manage tokens at https://tiddly.me/settings.\n", suggestedCmd)
					}
				}
			}

			if toolName == "claude-desktop" {
				fmt.Fprintln(cmd.ErrOrStderr(), "Restart Claude Desktop to apply changes.")
			}

			return nil
		},
	}

	cmd.Flags().BoolVar(&deleteTokens, "delete-tokens", false, "Revoke PATs extracted from config during removal")
	cmd.Flags().StringVar(&scope, "scope", "user", "Config scope: user (all projects) or directory (current directory only)")
	cmd.Flags().StringVar(&servers, "servers", "content,prompts", "Which servers to remove: content, prompts, or both")

	return cmd
}

func getWorkingDir() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("determining working directory: %w", err)
	}
	return cwd, nil
}

func isValidTool(name string, toolNames []string) bool {
	for _, t := range toolNames {
		if t == name {
			return true
		}
	}
	return false
}
