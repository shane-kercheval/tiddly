package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/mcp"
	"github.com/shane-kercheval/tiddly/cli/internal/skills"
	"github.com/spf13/cobra"
)

var validSkillsTools = []string{"claude-code", "codex", "claude-desktop"}

func newSkillsCmd() *cobra.Command {
	skillsCmd := &cobra.Command{
		Use:   "skills",
		Short: "Manage AI tool skills from your prompts",
		Long: `Export prompt templates as agent skills for AI tools.

  tiddly skills sync             Auto-detect tools and sync skills
  tiddly skills list             List available skills (prompts)`,
	}

	skillsCmd.AddCommand(newSkillsSyncCmd())
	skillsCmd.AddCommand(newSkillsListCmd())

	return skillsCmd
}

func newSkillsSyncCmd() *cobra.Command {
	var (
		scope    string
		tags     string
		tagMatch string
	)

	cmd := &cobra.Command{
		Use:   "sync [tool]",
		Short: "Download and install skills for AI tools",
		Long: `Sync your Tiddly prompts as skills for AI tools.

  tiddly skills sync                       Auto-detect tools and sync skills
  tiddly skills sync claude-code           Sync skills for a specific tool
  tiddly skills sync --scope project       Sync to project-level paths
  tiddly skills sync --tags python,skill   Only sync prompts with these tags`,
		ValidArgs: validSkillsTools,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Validate scope
			validScope := false
			for _, s := range skills.ValidScopes {
				if scope == s {
					validScope = true
					break
				}
			}
			if !validScope {
				return fmt.Errorf("invalid scope %q. Valid scopes: %s", scope, strings.Join(skills.ValidScopes, ", "))
			}

			// Resolve auth
			result, err := appDeps.TokenManager.ResolveToken(flagToken, false)
			if err != nil {
				if errors.Is(err, auth.ErrNotLoggedIn) {
					return fmt.Errorf("not logged in. Run 'tiddly login' first")
				}
				return err
			}

			client := api.NewClient(apiURL(), result.Token, result.AuthType)

			// Determine target tools
			var tools []string
			if len(args) > 0 {
				tools = args
			} else {
				// Auto-detect installed tools
				detected := mcp.DetectTools(appDeps.ExecLooker)
				for _, t := range detected {
					if t.Installed {
						tools = append(tools, t.Name)
					}
				}
				if len(tools) == 0 {
					return fmt.Errorf("no supported AI tools detected. Install Claude Code, Codex, or Claude Desktop first")
				}
			}

			tagList := parseTags(tags)

			ctx := cmd.Context()
			w := cmd.OutOrStdout()
			errW := cmd.ErrOrStderr()

			// Warn if --scope project is used outside a project directory
			if scope == skills.ScopeProject {
				warnIfNotProjectDir(errW)
			}

			var syncErrors []string
			synced := 0
			for _, tool := range tools {
				syncResult, err := skills.Sync(ctx, client, tool, tagList, tagMatch, scope)
				if err != nil {
					fmt.Fprintf(errW, "Error syncing %s: %v\n", tool, err)
					syncErrors = append(syncErrors, tool)
					continue
				}

				if syncResult.SkillCount == 0 {
					fmt.Fprintf(w, "%s: No skills to sync.\n", tool)
					if len(tagList) > 0 {
						fmt.Fprintf(errW, "  No prompts match tags: %s\n", strings.Join(tagList, ", "))
					}
					continue
				}

				synced++
				if syncResult.ZipPath != "" {
					// Claude Desktop: zip saved to temp
					fmt.Fprintf(w, "%s: %d skill(s) exported to %s\n", tool, syncResult.SkillCount, syncResult.ZipPath)
					fmt.Fprintf(w, "  Upload this file to Claude Desktop via Settings > Skills.\n")
				} else {
					fmt.Fprintf(w, "%s: Synced %d skill(s) to %s\n", tool, syncResult.SkillCount, syncResult.DestPath)
				}
			}

			// Return error if all tools failed with errors
			if len(syncErrors) > 0 && synced == 0 {
				return fmt.Errorf("skills sync failed for: %s", strings.Join(syncErrors, ", "))
			}

			return nil
		},
	}

	cmd.Flags().StringVar(&scope, "scope", "global", "Extraction scope: global (default) or project")
	cmd.Flags().StringVar(&tags, "tags", "", "Comma-separated tag filter")
	cmd.Flags().StringVar(&tagMatch, "tag-match", "", `Tag matching mode: "all" (default) or "any"`)

	return cmd
}

func newSkillsListCmd() *cobra.Command {
	var (
		tags     string
		tagMatch string
	)

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List prompts available as skills",
		Long: `List prompts available for export as agent skills.

Shows prompt name and description for each prompt. Use --tags to filter
by tags and --tag-match to control matching mode.

Examples:
  tiddly skills list                          List all available skills
  tiddly skills list --tags python,skill      List skills with specific tags
  tiddly skills list --tags python --tag-match any  Match any tag (default: all)`,
		RunE: func(cmd *cobra.Command, args []string) error {
			result, err := appDeps.TokenManager.ResolveToken(flagToken, false)
			if err != nil {
				if errors.Is(err, auth.ErrNotLoggedIn) {
					return fmt.Errorf("not logged in. Run 'tiddly login' first")
				}
				return err
			}

			client := api.NewClient(apiURL(), result.Token, result.AuthType)
			ctx := cmd.Context()
			w := cmd.OutOrStdout()

			tagList := parseTags(tags)

			prompts, err := fetchAllPrompts(ctx, client, tagList, tagMatch)
			if err != nil {
				return fmt.Errorf("listing prompts: %w", err)
			}

			if len(prompts) == 0 {
				fmt.Fprintln(w, "No prompts found.")
				return nil
			}

			fmt.Fprintf(w, "Available skills (%d prompts):\n\n", len(prompts))
			for _, p := range prompts {
				name := p.Name
				if name == "" {
					name = p.ID
				}
				desc := p.Description
				if desc == "" {
					desc = p.Title
				}
				if desc != "" {
					fmt.Fprintf(w, "  %-30s %s\n", name, desc)
				} else {
					fmt.Fprintf(w, "  %s\n", name)
				}
			}

			return nil
		},
	}

	cmd.Flags().StringVar(&tags, "tags", "", "Comma-separated tag filter")
	cmd.Flags().StringVar(&tagMatch, "tag-match", "", `Tag matching mode: "all" (default) or "any"`)

	return cmd
}

// parseTags splits a comma-separated tag string into a trimmed slice.
func parseTags(csv string) []string {
	if csv == "" {
		return nil
	}
	parts := strings.Split(csv, ",")
	for i, t := range parts {
		parts[i] = strings.TrimSpace(t)
	}
	return parts
}

// projectMarkers are directories that indicate the CWD is a project root.
var projectMarkers = []string{".git", ".claude", ".agents"}

// warnIfNotProjectDir prints a warning to errW if the CWD doesn't look like a project directory.
func warnIfNotProjectDir(errW io.Writer) {
	for _, marker := range projectMarkers {
		if info, err := os.Stat(marker); err == nil && info.IsDir() {
			return
		}
	}
	fmt.Fprintln(errW, "Warning: current directory does not appear to be a project root (no .git, .claude, or .agents directory).")
}

// fetchAllPrompts paginates through all prompts.
func fetchAllPrompts(ctx context.Context, client *api.Client, tags []string, tagMatch string) ([]api.PromptInfo, error) {
	var all []api.PromptInfo
	offset := 0
	limit := 50

	for {
		resp, err := client.ListPrompts(ctx, tags, tagMatch, offset, limit)
		if err != nil {
			return nil, err
		}

		all = append(all, resp.Items...)

		if !resp.HasMore {
			break
		}
		offset += limit
	}

	return all, nil
}
