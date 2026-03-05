package cmd

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/export"
	"github.com/spf13/cobra"
)

func newExportCmd() *cobra.Command {
	var (
		types           string
		output          string
		includeArchived bool
	)

	cmd := &cobra.Command{
		Use:   "export",
		Short: "Export bookmarks, notes, and prompts as JSON",
		Long: `Export your content as streaming JSON.

  tiddly export                              Export all content to stdout
  tiddly export --types bookmark,note        Export only bookmarks and notes
  tiddly export --output backup.json         Export to a file
  tiddly export --include-archived           Include archived items`,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Parse and validate --types
			typeList, err := parseTypesFlag(types)
			if err != nil {
				return err
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
			client.Stderr = cmd.ErrOrStderr()

			// Determine output destination
			w := cmd.OutOrStdout()
			var progress = cmd.ErrOrStderr()

			if output != "" {
				f, err := os.Create(output)
				if err != nil {
					return fmt.Errorf("creating output file: %w", err)
				}
				defer f.Close() //nolint:errcheck
				w = f
			} else {
				// When writing to stdout, suppress progress to avoid mixing with JSON
				progress = nil
			}

			opts := export.Options{
				Types:           typeList,
				IncludeArchived: includeArchived,
				Progress:        progress,
			}

			exportResult, err := export.Run(cmd.Context(), client, opts, w)
			if err != nil {
				// Remove partial output file on error
				if output != "" {
					os.Remove(output) //nolint:errcheck
				}
				return err
			}

			// Print summary to stderr
			if output != "" {
				var parts []string
				for _, t := range typeList {
					count := exportResult.Counts[t]
					parts = append(parts, fmt.Sprintf("%d %ss", count, t))
				}
				fmt.Fprintf(cmd.ErrOrStderr(), "Exported %s to %s\n", strings.Join(parts, ", "), output)
			}

			return nil
		},
	}

	cmd.Flags().StringVar(&types, "types", "bookmark,note,prompt", "Comma-separated content types: bookmark, note, prompt")
	cmd.Flags().StringVar(&output, "output", "", "Output file path (default: stdout)")
	cmd.Flags().BoolVar(&includeArchived, "include-archived", false, "Include archived items")

	return cmd
}

// parseTypesFlag validates and parses the --types flag value.
func parseTypesFlag(value string) ([]string, error) {
	parts := strings.Split(value, ",")
	seen := make(map[string]bool)
	var result []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		valid := false
		for _, v := range export.ValidTypes {
			if p == v {
				valid = true
				break
			}
		}
		if !valid {
			return nil, fmt.Errorf("invalid type %q in --types flag. Valid values: %s", p, strings.Join(export.ValidTypes, ", "))
		}
		if !seen[p] {
			seen[p] = true
			result = append(result, p)
		}
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("--types flag requires at least one value: %s", strings.Join(export.ValidTypes, ", "))
	}
	return result, nil
}
