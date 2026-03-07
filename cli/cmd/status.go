package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/shane-kercheval/tiddly/cli/internal/auth"
	"github.com/shane-kercheval/tiddly/cli/internal/mcp"
	"github.com/shane-kercheval/tiddly/cli/internal/skills"
	"github.com/spf13/cobra"
)

// cliVersion is set via -ldflags "-X github.com/shane-kercheval/tiddly/cli/cmd.cliVersion=x.y.z" at build time.
var cliVersion = "dev"

func newStatusCmd() *cobra.Command {
	var projectPath string

	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show Tiddly CLI status overview",
		Long: `Show a summary of CLI version, authentication, API connectivity, content counts, MCP server configuration, and installed skills.

Sections displayed:
  Authentication — login status and auth method (OAuth or PAT)
  API            — URL, reachability, and round-trip latency
  Content        — bookmark, note, and prompt counts (fetched in parallel)
  MCP Servers    — detected tools with configuration status across all scopes
  Skills         — installed skills across all tools and scopes

MCP servers are identified by URL, not by config key name. Content counts are only shown when the API is reachable and authenticated.

Use --project-path to specify which project directory to inspect for local/project scopes.
Defaults to the current working directory.

Examples:
  tiddly status                                Show full status overview
  tiddly status --project-path /path/to/project  Check a specific project`,
		RunE: func(cmd *cobra.Command, args []string) error {
			resolvedProjectPath, err := resolveProjectPath(projectPath)
			if err != nil {
				return err
			}

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
			tools := mcp.DetectAll(appDeps.handlers(), appDeps.ExecLooker)
			projectPathExplicit := cmd.Flags().Changed("project-path")
			printMCPTree(w, cmd.ErrOrStderr(), tools, resolvedProjectPath, projectPathExplicit)

			// --- Skills ---
			printSkillsSection(w, resolvedProjectPath)

			return nil
		},
	}

	cmd.Flags().StringVar(&projectPath, "project-path", "", "Project directory to inspect for local/project scopes (default: cwd)")
	return cmd
}

// resolveProjectPath resolves the --project-path flag to an absolute path.
// If empty, uses cwd. If cwd is unavailable, returns "".
func resolveProjectPath(flagValue string) (string, error) {
	if flagValue != "" {
		abs, err := filepath.Abs(flagValue)
		if err != nil {
			return "", fmt.Errorf("resolving project path: %w", err)
		}
		info, err := os.Stat(abs)
		if err != nil {
			if os.IsNotExist(err) {
				return "", fmt.Errorf("project path %q does not exist", flagValue)
			}
			return "", fmt.Errorf("project path %q: %w", flagValue, err)
		}
		if !info.IsDir() {
			return "", fmt.Errorf("project path %q is not a directory", flagValue)
		}
		return abs, nil
	}
	cwd, err := getWorkingDir()
	if err != nil {
		return "", nil // non-fatal; local/project scopes will show errors inline
	}
	return cwd, nil
}

// scopeStatus holds the result of checking a single scope for a tool.
type scopeStatus struct {
	Scope  string
	Result mcp.StatusResult
	Err    error
}

func getToolStatusAllScopes(tool mcp.DetectedTool, projectPath string) []scopeStatus {
	scopes := mcp.ToolSupportedScopes(tool.Name)
	results := make([]scopeStatus, 0, len(scopes))
	for _, scope := range scopes {
		sr, err := getToolStatus(tool, scope, projectPath)
		results = append(results, scopeStatus{Scope: scope, Result: sr, Err: err})
	}
	return results
}

func printMCPTree(w io.Writer, errW io.Writer, tools []mcp.DetectedTool, projectPath string, showProjectPath bool) {
	if showProjectPath && projectPath != "" {
		fmt.Fprintf(w, "\nMCP Servers (project: %s):\n", projectPath)
	} else {
		fmt.Fprintln(w, "\nMCP Servers:")
	}

	for _, tool := range tools {
		if !tool.Installed {
			fmt.Fprintf(w, "\n  %-18s Not detected\n", tool.Name)
			continue
		}
		printToolTree(w, errW, tool, projectPath)
	}
}

func printToolTree(w io.Writer, errW io.Writer, tool mcp.DetectedTool, projectPath string) {
	fmt.Fprintf(w, "\n  %s\n", tool.Name)

	statuses := getToolStatusAllScopes(tool, projectPath)
	for i, ss := range statuses {
		isLast := i == len(statuses)-1
		connector := "├──"
		prefix := "│  "
		if isLast {
			connector = "└──"
			prefix = "   "
		}

		if ss.Err != nil {
			fmt.Fprintf(w, "  %s %-10s Error: %v\n", connector, ss.Scope, ss.Err)
			continue
		}

		configDisplay := displayPath(ss.Result.ConfigPath, projectPath, ss.Scope)
		if len(ss.Result.Servers) == 0 {
			fmt.Fprintf(w, "  %s %-10s %s\n", connector, ss.Scope, configDisplay)
			fmt.Fprintf(w, "  %s           Not configured\n", prefix)
			hint := fmt.Sprintf("tiddly mcp install %s", tool.Name)
			if ss.Scope != "user" {
				hint += " --scope " + ss.Scope
			}
			fmt.Fprintf(errW, "  %s           Run '%s' to configure.\n", prefix, hint)
		} else {
			labels := formatServerLabels(ss.Result.Servers)
			fmt.Fprintf(w, "  %s %-10s %s\n", connector, ss.Scope, configDisplay)
			fmt.Fprintf(w, "  %s           Configured. Installed servers:\n", prefix)
			for _, l := range labels {
				fmt.Fprintf(w, "  %s             - %s\n", prefix, l)
			}
			if tool.Name == "claude-desktop" && !tool.HasNpx {
				fmt.Fprintf(errW, "  Warning: npx not found in PATH\n")
			}
		}
	}
}

// shortenHome replaces the user's home directory prefix with ~.
func shortenHome(path string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	if strings.HasPrefix(path, home) {
		return "~" + path[len(home):]
	}
	return path
}

// displayPath formats a config path for display, shortening the home dir prefix.
// For local scope, appends the JSON path within the file.
func displayPath(configPath, projectPath, scope string) string {
	display := shortenHome(configPath)
	if scope == "local" && projectPath != "" {
		display += " → projects[" + shortenHome(projectPath) + "]"
	}
	return display
}

// printSkillsSection renders the Skills tree.
// NOTE: Skills use "global"/"project" scope terminology (from `tiddly skills install --scope`),
// while MCP uses "user"/"local"/"project" (from Claude Code's conventions). "user" and "global"
// refer to the same thing (~/ config). Changing either would break existing CLI contracts.
func printSkillsSection(w io.Writer, projectPath string) {
	fmt.Fprintln(w, "\nSkills:")
	fmt.Fprintln(w, "  Skills directories may include non-Tiddly skills.")

	results := skills.ScanAllSkills(projectPath)

	// Group results by tool, preserving order
	type toolGroup struct {
		tool    string
		scopes []skills.ScanResult
	}
	var groups []toolGroup
	groupIdx := map[string]int{}
	for _, r := range results {
		if idx, ok := groupIdx[r.Tool]; ok {
			groups[idx].scopes = append(groups[idx].scopes, r)
		} else {
			groupIdx[r.Tool] = len(groups)
			groups = append(groups, toolGroup{tool: r.Tool, scopes: []skills.ScanResult{r}})
		}
	}

	for _, g := range groups {
		fmt.Fprintf(w, "\n  %s\n", g.tool)
		for i, r := range g.scopes {
			isLast := i == len(g.scopes)-1
			connector := "├──"
			prefix := "│  "
			if isLast {
				connector = "└──"
				prefix = "   "
			}

			if r.Err != nil {
				fmt.Fprintf(w, "  %s %-10s Error: %v\n", connector, r.Scope, r.Err)
				continue
			}

			count := len(r.SkillNames)
			label := fmt.Sprintf("%d skills", count)
			if count == 1 {
				label = "1 skill"
			}
			path := shortenHome(r.Path)
			fmt.Fprintf(w, "  %s %-10s %s   %s\n", connector, r.Scope, label, path)
			for _, name := range r.SkillNames {
				fmt.Fprintf(w, "  %s             - %s\n", prefix, name)
			}
		}
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

func getToolStatus(tool mcp.DetectedTool, scope, cwd string) (mcp.StatusResult, error) {
	handler, ok := mcp.GetHandler(appDeps.handlers(), tool.Name)
	if !ok {
		return mcp.StatusResult{}, fmt.Errorf("unknown tool %q", tool.Name)
	}
	rc, err := mcp.ResolveToolConfig(handler, tool.ConfigPath, scope, cwd)
	if err != nil {
		return mcp.StatusResult{}, err
	}
	return handler.Status(rc)
}

// serverDisplayName maps internal server type to a user-friendly label.
var serverDisplayName = map[string]string{
	"content": "bookmarks/notes",
	"prompts": "prompts",
}

// formatServerLabels converts ServerMatch entries to user-friendly display labels.
func formatServerLabels(servers []mcp.ServerMatch) []string {
	labels := make([]string, 0, len(servers))
	for _, s := range servers {
		if name, ok := serverDisplayName[s.ServerType]; ok {
			labels = append(labels, name)
		} else {
			labels = append(labels, s.ServerType)
		}
	}
	return labels
}

// realExecLooker wraps exec.LookPath for production use.
type realExecLooker struct{}

func (r *realExecLooker) LookPath(file string) (string, error) {
	return exec.LookPath(file)
}
