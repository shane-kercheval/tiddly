package cmd

import (
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/mcp"
	"github.com/spf13/cobra"
)

const cliVersion = "0.1.0"

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

			if client != nil {
				start := time.Now()
				health, err := client.GetHealth()
				latency := time.Since(start)
				if err != nil {
					fmt.Fprintln(w, "  Status:     Unreachable")
					fmt.Fprintf(cmd.ErrOrStderr(), "  Check network connection or API URL.\n")
				} else {
					apiReachable = true
					fmt.Fprintf(w, "  Status:     %s\n", health.Status)
					fmt.Fprintf(w, "  Latency:    %dms\n", latency.Milliseconds())

					// User info
					user, userErr := client.GetMe()
					if userErr == nil && user.Email != "" {
						fmt.Fprintf(w, "\n  User:       %s\n", user.Email)
					}
				}
			} else {
				fmt.Fprintln(w, "  Status:     Not checked (not authenticated)")
			}

			// --- Content counts (parallel, only if API is reachable) ---
			if apiReachable {
				printContentCounts(w, cmd.ErrOrStderr(), client)
			}

			// --- MCP Servers ---
			fmt.Fprintln(w, "\nMCP Servers:")
			tools := mcp.DetectTools(appDeps.ExecLooker)
			runner := appDeps.CmdRunner

			for _, tool := range tools {
				if !tool.Installed {
					fmt.Fprintf(w, "  %-18s Not detected\n", tool.Name+":")
					continue
				}

				servers, err := getToolStatus(tool, runner)
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

func printContentCounts(w io.Writer, errW io.Writer, client *api.Client) {
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
			count, err := client.GetContentCount(contentType)
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

func getToolStatus(tool mcp.DetectedTool, runner mcp.CommandRunner) ([]string, error) {
	switch tool.Name {
	case "claude-desktop":
		return mcp.StatusClaudeDesktop(tool.ConfigPath)
	case "claude-code":
		return mcp.StatusClaudeCode(runner)
	case "codex":
		configPath := tool.ConfigPath
		if configPath == "" {
			configPath = mcp.CodexConfigPath()
		}
		return mcp.StatusCodex(configPath)
	}
	return nil, nil
}

// realExecLooker wraps exec.LookPath for production use.
type realExecLooker struct{}

func (r *realExecLooker) LookPath(file string) (string, error) {
	return exec.LookPath(file)
}

// realCommandRunner wraps os/exec for production use.
type realCommandRunner struct{}

func (r *realCommandRunner) Run(name string, args ...string) (string, string, error) {
	cmd := exec.Command(name, args...)
	var stdout, stderr []byte
	var err error
	stdout, err = cmd.Output()
	if exitErr, ok := err.(*exec.ExitError); ok {
		stderr = exitErr.Stderr
	}
	return string(stdout), string(stderr), err
}
