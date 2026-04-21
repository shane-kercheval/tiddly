package cmd

import (
	"fmt"
	"io"
	"os"
	"slices"
	"sort"
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
		force     bool
	)

	cmd := &cobra.Command{
		Use:   "configure [tool...]",
		Short: "Configure MCP servers for AI tools",
		Long: `Configure Tiddly MCP servers for AI tools.

Configure writes two CLI-managed entries: tiddly_notes_bookmarks (content server) and tiddly_prompts (prompt server). These are the only entries the CLI creates or modifies. If you have other entries pointing at Tiddly URLs under different names (for example, work_prompts and personal_prompts for multiple accounts), configure leaves them alone. After a run, configure lists any preserved non-CLI-managed entries so you can see what was left unchanged.

If a CLI-managed entry already exists but points at a URL that's not the expected Tiddly URL for its type, configure refuses by default and tells you which entry is mismatched. Either rename the entry in the config file to preserve it, or re-run with --force to overwrite. Use --dry-run to preview either path without committing (without --force, dry-run shows the diff plus warnings; with --force, dry-run shows the diff with the overwrite applied).

Before destructive writes, the existing config file is copied to <path>.bak.<timestamp> alongside the original.

Tools:
  claude-desktop, claude-code, codex (auto-detect if omitted)

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
  tiddly mcp configure --servers content                Configure only the content server
  tiddly mcp configure --force                          Overwrite a mismatched CLI-managed entry`,
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
				Force:     force,
			}

			configureResult, err := mcp.RunConfigure(opts, targetTools)

			// Print the partial summary BEFORE surfacing any error so a
			// user whose tool-2 failed can still see what tool-1 did.
			// Warnings are intentionally printed regardless of dry-run.
			if configureResult != nil {
				if !dryRun {
					printConfigureSummary(cmd.OutOrStdout(), configureResult, err != nil)
				}
				for _, warning := range configureResult.Warnings {
					fmt.Fprintf(cmd.ErrOrStderr(), "Warning: %s\n", warning)
				}
			}

			return err
		},
	}

	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview changes without writing")
	cmd.Flags().StringVar(&scope, "scope", "user", "Config scope: user (all projects) or directory (current directory only)")
	cmd.Flags().IntVar(&expiresIn, "expires", 0, "PAT expiration in days (1-365, or 0 for no expiration)")
	cmd.Flags().StringVar(&servers, "servers", "content,prompts", "Which MCP servers to configure: content, prompts, or both")
	cmd.Flags().BoolVar(&force, "force", false, "Overwrite CLI-managed entries that point at non-Tiddly URLs or wrong-type Tiddly URLs")

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
		Long: `Remove the CLI-managed entries (tiddly_notes_bookmarks, tiddly_prompts) from a tool's config file. Other entries pointing at Tiddly URLs under different names — e.g. work_prompts or personal_prompts — are preserved. A CLI-managed entry is removed regardless of what URL it currently points at. The prior config is saved to <path>.bak.<timestamp> before the write. If no CLI-managed entries exist, remove reports so and exits cleanly.

With --delete-tokens, the CLI only targets PATs attached to CLI-managed entries. If one of those PATs is also referenced by a preserved entry, the CLI warns that revoking will break the preserved binding and then proceeds. If a CLI-managed entry's PAT doesn't match any CLI-created server-side token, the CLI prints an informational note referencing that entry.

The shared-PAT warning and orphan-token filter consider only entries whose URL still points at a Tiddly MCP server. A CLI-managed key hand-edited to a non-Tiddly URL is invisible to these safeguards — its PAT will not participate in shared-PAT detection or orphan filtering.

Claude Desktop users: restart Claude Desktop after removing.

Use --servers to scope the removal to only content or only prompts, leaving the other CLI-managed entry untouched.

Tools:
  claude-desktop, claude-code, codex

Examples:
  tiddly mcp remove claude-code                          Remove CLI-managed entries
  tiddly mcp remove claude-code --delete-tokens          Remove entries and revoke their PATs
  tiddly mcp remove codex --scope directory              Remove from directory config
  tiddly mcp remove claude-code --servers content        Remove only tiddly_notes_bookmarks
  tiddly mcp remove claude-code --servers content --delete-tokens  Remove tiddly_notes_bookmarks and revoke its PAT`,
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

			// Collect revoke targets and retained PATs from pre-remove config
			// state. Done before handler.Remove so the shared-PAT warning and
			// orphan-token filter see the world as it was, not after the
			// canonical entries have already been deleted. Both branches
			// (--delete-tokens AND the orphan-warning path) need retainedPATs,
			// so this runs unconditionally; revokeReqs stays empty unless
			// --delete-tokens was requested.
			//
			// NOTE: do NOT dedupe by PAT here. One TokenRevokeRequest per
			// canonical entry is deliberate — DeleteTokensByPrefix dedupes
			// server-side deletions internally and mirrors the outcome back
			// to every request sharing a PAT. Pre-deduping at this layer
			// would collapse two canonical entries into one request and
			// silently drop per-entry attribution (the "no CLI-created token
			// matched" note and any per-request error).
			var revokeReqs []mcp.TokenRevokeRequest // one per canonical entry to revoke
			var retainedPATs []mcp.TiddlyPAT        // non-canonical entries keeping their PATs
			{
				targetTypes := map[string]bool{}
				if slices.Contains(serverList, mcp.ServerContent) {
					targetTypes[mcp.ServerContent] = true
				}
				if slices.Contains(serverList, mcp.ServerPrompts) {
					targetTypes[mcp.ServerPrompts] = true
				}
				for _, p := range handler.AllTiddlyPATs(rc) {
					canonicalType, isCanonical := mcp.ServerTypeForCanonicalName(p.Name)
					if isCanonical && targetTypes[canonicalType] {
						if deleteTokens {
							revokeReqs = append(revokeReqs, mcp.TokenRevokeRequest{
								EntryLabel: p.Name,
								PAT:        p.PAT,
							})
						}
					} else {
						retainedPATs = append(retainedPATs, p)
					}
				}
			}

			result, err := handler.Remove(rc, serverList)
			// Surface the backup path before anything else so the user
			// always sees where their recovery copy is — including on
			// write-failure paths.
			if result.BackupPath != "" {
				fmt.Fprintf(cmd.OutOrStdout(), "Backed up previous config to %s\n", result.BackupPath)
			}
			if err != nil {
				return err
			}

			if len(result.RemovedEntries) == 0 {
				fmt.Fprintf(cmd.OutOrStdout(), "No CLI-managed entries found in %s.\n", toolName)
				return nil
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Removed %s from %s.\n",
				strings.Join(result.RemovedEntries, ", "), toolName)

			// Shared-PAT warning: for each revoke target, surface which
			// retained entries share its PAT. One consolidated line per
			// canonical entry, retained names sorted.
			for _, req := range revokeReqs {
				var sharedBy []string
				for _, r := range retainedPATs {
					if r.PAT == req.PAT {
						sharedBy = append(sharedBy, r.Name)
					}
				}
				if len(sharedBy) > 0 {
					sort.Strings(sharedBy)
					fmt.Fprintf(cmd.ErrOrStderr(),
						"Warning: token from %s is also used by %s (still configured); revoking will break those bindings.\n",
						req.EntryLabel, strings.Join(sharedBy, ", "))
				}
			}

			// Token cleanup (auth resolution failure silently skips — pre-existing
			// rough edge, tracked separately).
			tokResult, tokErr := appDeps.TokenManager.ResolveToken(flagToken, true)
			if tokErr == nil {
				client := api.NewClient(apiURL(), tokResult.Token, tokResult.AuthType)

				if deleteTokens && len(revokeReqs) > 0 {
					results, delErr := mcp.DeleteTokensByPrefix(cmd.Context(), client, revokeReqs)
					if delErr != nil {
						fmt.Fprintf(cmd.ErrOrStderr(), "Warning: %v\n", delErr)
					}
					var allDeleted []string
					seenNames := make(map[string]bool)
					for _, r := range results {
						if len(r.DeletedNames) == 0 && r.Err == nil {
							// Unmatched PAT (or short/garbled) — nothing was
							// revoked. Inform the user, naming the specific entry.
							fmt.Fprintf(cmd.OutOrStdout(),
								"Note: no CLI-created token matched the token attached to %s; nothing was revoked. Manage tokens at https://tiddly.me/settings.\n",
								r.EntryLabel)
							continue
						}
						if r.Err != nil {
							fmt.Fprintf(cmd.ErrOrStderr(), "Warning: %v\n", r.Err)
						}
						for _, n := range r.DeletedNames {
							if !seenNames[n] {
								seenNames[n] = true
								allDeleted = append(allDeleted, n)
							}
						}
					}
					if len(allDeleted) > 0 {
						sort.Strings(allDeleted)
						fmt.Fprintf(cmd.OutOrStdout(), "Deleted tokens: %s\n", strings.Join(allDeleted, ", "))
					}
				} else if !deleteTokens {
					orphaned, orphanErr := mcp.CheckOrphanedTokens(cmd.Context(), client, toolName, serverList)
					if orphanErr == nil && len(orphaned) > 0 {
						// Filter out tokens whose TokenPrefix matches a PAT
						// still referenced by a retained entry on disk — those
						// aren't orphans, they're in active use by non-canonical
						// entries.
						retainedPrefixes := map[string]bool{}
						for _, p := range retainedPATs {
							if prefix := mcp.PATPrefix(p.PAT); prefix != "" {
								retainedPrefixes[prefix] = true
							}
						}
						var names []string
						for _, t := range orphaned {
							if retainedPrefixes[t.TokenPrefix] {
								continue
							}
							names = append(names, t.Name)
						}
						if len(names) > 0 {
							fmt.Fprintf(cmd.ErrOrStderr(),
								"Warning: PATs created for %s may still exist: %s\n", toolName, strings.Join(names, ", "))
							suggestedCmd := fmt.Sprintf("tiddly mcp remove %s --delete-tokens", toolName)
							if len(serverList) == 1 {
								suggestedCmd += fmt.Sprintf(" --servers %s", serverList[0])
							}
							fmt.Fprintf(cmd.ErrOrStderr(),
								"Run '%s' to revoke, or manage tokens at https://tiddly.me/settings.\n", suggestedCmd)
						}
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

// printConfigureSummary prints what configure did or partially did. When
// partial is true, the heading switches to "Partially configured" so a
// user staring at a follow-up error knows the listed tools still completed.
func printConfigureSummary(w io.Writer, result *mcp.ConfigureResult, partial bool) {
	if len(result.TokensCreated) > 0 {
		fmt.Fprintf(w, "Created tokens: %s\n", strings.Join(result.TokensCreated, ", "))
	}
	if len(result.TokensReused) > 0 {
		fmt.Fprintf(w, "Reused tokens: %s\n", strings.Join(result.TokensReused, ", "))
	}
	label := "Configured"
	if partial {
		label = "Partially configured (run aborted after these)"
	}
	if len(result.ToolsConfigured) > 0 {
		fmt.Fprintf(w, "%s: %s\n", label, strings.Join(result.ToolsConfigured, ", "))
	}
	// Backups are recorded per-tool only after a successful handler.Configure,
	// so on partial-failure runs this list reflects only tools that
	// completed — never the tool that failed mid-write.
	for _, b := range result.Backups {
		fmt.Fprintf(w, "Backed up %s config to %s\n", b.Tool, b.Path)
	}
	// Preserved non-CLI-managed entries, sorted by tool name for deterministic output.
	if len(result.PreservedEntries) > 0 {
		toolNames := make([]string, 0, len(result.PreservedEntries))
		for n := range result.PreservedEntries {
			toolNames = append(toolNames, n)
		}
		sort.Strings(toolNames)
		for _, n := range toolNames {
			fmt.Fprintf(w, "Preserved non-CLI-managed entries in %s: %s\n",
				n, strings.Join(result.PreservedEntries[n], ", "))
		}
	}
}
