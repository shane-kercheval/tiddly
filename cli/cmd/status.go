package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/mcp"
	"github.com/spf13/cobra"
)

// cliVersion is set via -ldflags "-X github.com/shane-kercheval/tiddly/cli/cmd.cliVersion=x.y.z" at build time.
var cliVersion = "0.1.0"

func newStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show Tiddly CLI status overview",
		RunE: func(cmd *cobra.Command, args []string) error {
			w := cmd.OutOrStdout()
			fmt.Fprintf(w, "Tiddly CLI v%s\n", cliVersion)

			// --- Authentication ---
			fmt.Fprintln(w, "\nAuthentication:")
			result, authErr := appDeps.TokenManager.ResolveToken(flagToken, false)
			if authErr != nil {
				if errors.Is(authErr, auth.ErrNotLoggedIn) {
					fmt.Fprintln(w, "  Status:     Not logged in")
					fmt.Fprintln(w, "  Run 'tiddly login' to authenticate.")
				} else {
					fmt.Fprintf(w, "  Status:     Error (%v)\n", authErr)
				}
			} else {
				fmt.Fprintln(w, "  Status:     Logged in")
				fmt.Fprintf(w, "  Method:     %s\n", result.AuthType)
			}

			// --- API ---
			fmt.Fprintln(w, "\nAPI:")
			fmt.Fprintf(w, "  URL:        %s\n", apiURL())

			var client *api.Client
			apiReachable := false
			if result != nil {
				client = api.NewClient(apiURL(), result.Token, result.AuthType)
			}

			ctx := cmd.Context()
			if client != nil {
				start := time.Now()
				health, err := client.GetHealth(ctx)
				latency := time.Since(start)
				if err != nil {
					fmt.Fprintln(w, "  Status:     Unreachable")
					fmt.Fprintf(cmd.ErrOrStderr(), "  Check network connection or API URL.\n")
				} else {
					apiReachable = true
					fmt.Fprintf(w, "  Status:     %s\n", health.Status)
					fmt.Fprintf(w, "  Latency:    %dms\n", latency.Milliseconds())

					// User info
					user, userErr := client.GetMe(ctx)
					if userErr == nil && user.Email != "" {
						fmt.Fprintf(w, "\n  User:       %s\n", user.Email)
					}
				}
			} else {
				fmt.Fprintln(w, "  Status:     Not checked (not authenticated)")
			}

			// --- Content counts (parallel, only if API is reachable) ---
			if apiReachable {
				printContentCounts(ctx, w, cmd.ErrOrStderr(), client)
			}

			// --- MCP Servers ---
			fmt.Fprintln(w, "\nMCP Servers:")
			tools := mcp.DetectTools(appDeps.ExecLooker)
			cwd, cwdErr := os.Getwd()
			if cwdErr != nil {
				cwd = "" // non-fatal for global status; ResolveToolConfig handles empty cwd for "user" scope
			}

			for _, tool := range tools {
				if !tool.Installed {
					fmt.Fprintf(w, "  %-18s Not detected\n", tool.Name+":")
					continue
				}

				servers, err := getToolStatus(tool, "user", cwd)
				if err != nil {
					fmt.Fprintf(w, "  %-18s Detected, status unknown\n", tool.Name+":")
					continue
				}

				if len(servers) == 0 {
					label := fmt.Sprintf("  %-18s Detected, not configured", tool.Name+":")
					fmt.Fprintln(w, label)
					fmt.Fprintf(cmd.ErrOrStderr(), "  Run 'tiddly mcp install %s' to configure.\n", tool.Name)
				} else {
					fmt.Fprintf(w, "  %-18s Configured (%s)\n", tool.Name+":", strings.Join(servers, ", "))
					if tool.Name == "claude-desktop" && !tool.HasNpx {
						fmt.Fprintf(cmd.ErrOrStderr(), "  Warning: npx not found in PATH\n")
					}
				}
			}

			return nil
		},
	}
}

func printContentCounts(ctx context.Context, w io.Writer, errW io.Writer, client *api.Client) {
	type countResult struct {
		name  string
		count int
		err   error
	}

	types := []string{"bookmark", "note", "prompt"}
	results := make(chan countResult, len(types))

	var wg sync.WaitGroup
	for _, ct := range types {
		wg.Add(1)
		go func(contentType string) {
			defer wg.Done()
			count, err := client.GetContentCount(ctx, contentType)
			results <- countResult{name: contentType + "s", count: count, err: err}
		}(ct)
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	counts := make(map[string]int)
	errCount := 0
	for r := range results {
		if r.err == nil {
			counts[r.name] = r.count
		} else {
			errCount++
		}
	}

	if len(counts) > 0 {
		fmt.Fprintf(w, "\nContent:\n")
		for _, name := range []string{"bookmarks", "notes", "prompts"} {
			if count, ok := counts[name]; ok {
				fmt.Fprintf(w, "  %-18s %d\n", name+":", count)
			}
		}
	}

	if errCount == len(types) {
		fmt.Fprintln(errW, "  Warning: Could not fetch content counts. Token may be expired; run 'tiddly login'.")
	}
}

func getToolStatus(tool mcp.DetectedTool, scope, cwd string) ([]string, error) {
	rc, err := mcp.ResolveToolConfig(tool.Name, tool.ResolvedConfigPath(), scope, cwd)
	if err != nil {
		return nil, err
	}
	switch tool.Name {
	case "claude-desktop":
		return mcp.StatusClaudeDesktop(rc.Path)
	case "claude-code":
		return mcp.StatusClaudeCode(rc)
	case "codex":
		return mcp.StatusCodex(rc)
	}
	return nil, nil
}

// realExecLooker wraps exec.LookPath for production use.
type realExecLooker struct{}

func (r *realExecLooker) LookPath(file string) (string, error) {
	return exec.LookPath(file)
}
