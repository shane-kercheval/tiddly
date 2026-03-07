package cmd

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
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

  tiddly skills install          Auto-detect tools and install skills
  tiddly skills list             List available skills (prompts)`,
	}

	skillsCmd.AddCommand(newSkillsInstallCmd())
	skillsCmd.AddCommand(newSkillsListCmd())

	return skillsCmd
}

func newSkillsInstallCmd() *cobra.Command {
	var (
		scope    string
		tags     string
		tagMatch string
	)

	cmd := &cobra.Command{
		Use:   "install [tool...]",
		Short: "Install skills for AI tools",
		Long: `Install your Tiddly prompts as agent skills.

Each prompt is written as a Markdown skill file ({skill-name}/SKILL.md) to the tool's skills directory. The destination varies by tool and scope:
  claude-code (global)  — ~/.claude/skills/
  claude-code (project) — .claude/skills/
  codex (global)        — ~/.codex/skills/

Re-installing overwrites existing skill files but does not remove skills whose prompts have been deleted. For Claude Desktop, a .zip file is exported instead — upload it manually via Settings > Skills.

By default, only prompts tagged "skill" are installed (matching the frontend default). Use --tags "" to install all prompts.

Examples:
  tiddly skills install                         Auto-detect tools and install skills
  tiddly skills install claude-code             Install skills for a specific tool
  tiddly skills install --scope project         Install to project-level paths
  tiddly skills install --tags python,skill     Only install prompts with these tags
  tiddly skills install --tags ""               Install all prompts (no tag filter)`,
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

			var instErrors []string
			installed := 0
			for _, tool := range tools {
				instResult, err := skills.Install(ctx, client, tool, tagList, tagMatch, scope)
				if err != nil {
					fmt.Fprintf(errW, "Error installing %s: %v\n", tool, err)
					instErrors = append(instErrors, tool)
					continue
				}

				if instResult.SkillCount == 0 {
					fmt.Fprintf(w, "%s: No skills to install.\n", tool)
					if len(tagList) > 0 {
						fmt.Fprintf(errW, "  No prompts match tags: %s\n", strings.Join(tagList, ", "))
					}
					continue
				}

				installed++
				if instResult.ZipPath != "" {
					// Claude Desktop: zip saved to temp
					fmt.Fprintf(w, "%s: %d skill(s) exported to %s\n", tool, instResult.SkillCount, instResult.ZipPath)
					fmt.Fprintf(w, "  Upload this file to Claude Desktop via Settings > Skills.\n")
				} else {
					fmt.Fprintf(w, "%s: Installed %d skill(s) to %s\n", tool, instResult.SkillCount, instResult.DestPath)
				}
			}

			// Return error if all tools failed with errors
			if len(instErrors) > 0 && installed == 0 {
				return fmt.Errorf("skills install failed for: %s", strings.Join(instErrors, ", "))
			}

			return nil
		},
	}

	cmd.Flags().StringVar(&scope, "scope", "global", "Extraction scope: global (default) or project")
	cmd.Flags().StringVar(&tags, "tags", "skill", `Comma-separated tag filter (use "" for all)`)
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

By default, only prompts tagged "skill" are listed (matching the frontend default). Use --tags "" to list all prompts.

Prints a two-column table of prompt name and description. Use --tags to filter by tags and --tag-match to control matching mode ("all" requires every tag, "any" requires at least one).

Examples:
  tiddly skills list                               List skills (default: --tags skill)
  tiddly skills list --tags python,skill            List skills with specific tags
  tiddly skills list --tags ""                      List all prompts (no tag filter)
  tiddly skills list --tags python --tag-match any  Match any tag (default: all)`,
		RunE: func(cmd *cobra.Command, args []string) error {
			result, err := appDeps.TokenManager.ResolveToken(flagToken, false)
			if err != nil {
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

	cmd.Flags().StringVar(&tags, "tags", "skill", `Comma-separated tag filter (use "" for all)`)
	cmd.Flags().StringVar(&tagMatch, "tag-match", "", `Tag matching mode: "all" (default) or "any"`)

	return cmd
}

// parseTags splits a comma-separated tag string into a trimmed slice,
// filtering out empty strings from trailing commas or whitespace-only entries.
func parseTags(csv string) []string {
	if csv == "" {
		return nil
	}
	parts := strings.Split(csv, ",")
	var result []string
	for _, t := range parts {
		t = strings.TrimSpace(t)
		if t != "" {
			result = append(result, t)
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
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
