package mcp

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	toml "github.com/pelletier/go-toml/v2"
	"github.com/shane-kercheval/tiddly/cli/internal/api"
)

// InstallOpts configures the MCP install flow.
type InstallOpts struct {
	Client    *api.Client
	Looker    ExecLooker
	Runner    CommandRunner
	AuthType  string // "oauth", "pat", "flag", "env"
	DryRun    bool
	Scope     string // claude code scope: "user" (default) or "local"
	ExpiresIn *int   // PAT expiration in days (nil = no expiration)
	Output    io.Writer
	ErrOutput io.Writer
}

// InstallResult captures what was done during install.
type InstallResult struct {
	ToolsConfigured []string
	TokensCreated   []string
	Warnings        []string
}

// RunInstall orchestrates MCP server installation for the given tools.
// If tools is empty, installs for all detected tools.
func RunInstall(opts InstallOpts, tools []DetectedTool) (*InstallResult, error) {
	if opts.Output == nil {
		opts.Output = os.Stdout
	}
	if opts.ErrOutput == nil {
		opts.ErrOutput = os.Stderr
	}

	result := &InstallResult{}

	// Determine PATs to use
	contentPAT, promptPAT, err := resolvePATs(opts, result)
	if err != nil {
		return nil, err
	}

	for _, tool := range tools {
		if !tool.Installed {
			continue
		}

		if opts.DryRun {
			if err := dryRunTool(opts, tool, contentPAT, promptPAT); err != nil {
				return nil, err
			}
			result.ToolsConfigured = append(result.ToolsConfigured, tool.Name)
			continue
		}

		if err := installTool(opts, tool, contentPAT, promptPAT, result); err != nil {
			return nil, fmt.Errorf("installing %s: %w", tool.Name, err)
		}
		result.ToolsConfigured = append(result.ToolsConfigured, tool.Name)
	}

	return result, nil
}

// resolvePATs determines the PATs to use for MCP server configuration.
func resolvePATs(opts InstallOpts, result *InstallResult) (contentPAT, promptPAT string, err error) {
	if opts.AuthType == "pat" || opts.AuthType == "flag" || opts.AuthType == "env" {
		// Reuse the current token for both servers
		result.Warnings = append(result.Warnings,
			"Using your current token for MCP servers. Login via 'tiddly login' to auto-create dedicated tokens per server.")
		return opts.Client.Token, opts.Client.Token, nil
	}

	// OAuth: create dedicated PATs
	// Check for existing tiddly-mcp tokens first
	existing, err := opts.Client.ListTokens()
	if err != nil {
		return "", "", fmt.Errorf("listing existing tokens: %w", err)
	}

	contentPAT = findExistingToken(existing, "tiddly-mcp-content")
	promptPAT = findExistingToken(existing, "tiddly-mcp-prompts")

	if contentPAT == "" {
		resp, err := opts.Client.CreateToken("tiddly-mcp-content", opts.ExpiresIn)
		if err != nil {
			return "", "", fmt.Errorf("creating content MCP token: %w", err)
		}
		contentPAT = resp.Token
		result.TokensCreated = append(result.TokensCreated, "tiddly-mcp-content")
	}

	if promptPAT == "" {
		resp, err := opts.Client.CreateToken("tiddly-mcp-prompts", opts.ExpiresIn)
		if err != nil {
			return "", "", fmt.Errorf("creating prompts MCP token: %w", err)
		}
		promptPAT = resp.Token
		result.TokensCreated = append(result.TokensCreated, "tiddly-mcp-prompts")
	}

	return contentPAT, promptPAT, nil
}

func findExistingToken(tokens []api.TokenInfo, name string) string {
	for _, t := range tokens {
		if t.Name == name {
			// Token exists but we can't retrieve the plaintext — need to create a new one
			return ""
		}
	}
	return ""
}

func installTool(opts InstallOpts, tool DetectedTool, contentPAT, promptPAT string, result *InstallResult) error {
	switch tool.Name {
	case "claude-desktop":
		if !tool.HasNpx {
			result.Warnings = append(result.Warnings,
				"Claude Desktop requires Node.js for mcp-remote. Install from https://nodejs.org")
		}
		if err := backupIfMalformed(tool.ConfigPath); err != nil {
			result.Warnings = append(result.Warnings,
				fmt.Sprintf("Existing config at %s was malformed. Backup saved to %s.bak", tool.ConfigPath, tool.ConfigPath))
		}
		if err := InstallClaudeDesktop(tool.ConfigPath, contentPAT, promptPAT); err != nil {
			return err
		}
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("Tokens are stored in plaintext in %s. Use 'tiddly tokens list' to audit.", tool.ConfigPath))
		result.Warnings = append(result.Warnings, "Restart Claude Desktop to apply changes.")

	case "claude-code":
		if err := InstallClaudeCode(opts.Runner, contentPAT, promptPAT, opts.Scope); err != nil {
			return err
		}

	case "codex":
		configPath := tool.ConfigPath
		if configPath == "" {
			configPath = codexConfigPath()
		}
		if err := backupIfMalformed(configPath); err != nil {
			result.Warnings = append(result.Warnings,
				fmt.Sprintf("Existing config at %s was malformed. Backup saved to %s.bak", configPath, configPath))
		}
		if err := InstallCodex(configPath, contentPAT, promptPAT); err != nil {
			return err
		}
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("Tokens are stored in plaintext in %s. Use 'tiddly tokens list' to audit.", configPath))
	}

	return nil
}

func dryRunTool(opts InstallOpts, tool DetectedTool, contentPAT, promptPAT string) error {
	fmt.Fprintf(opts.Output, "\n--- %s ---\n", tool.Name)

	switch tool.Name {
	case "claude-desktop":
		configPath := tool.ConfigPath
		if configPath == "" {
			configPath = claudeDesktopConfigPath()
		}
		before, after, err := DryRunClaudeDesktop(configPath, contentPAT, promptPAT)
		if err != nil {
			return err
		}
		printDiff(opts.Output, configPath, before, after)

	case "claude-code":
		cmds := DryRunClaudeCode(contentPAT, promptPAT, opts.Scope)
		fmt.Fprintln(opts.Output, "Commands that would be executed:")
		for _, cmd := range cmds {
			fmt.Fprintf(opts.Output, "  $ %s\n", cmd)
		}

	case "codex":
		configPath := tool.ConfigPath
		if configPath == "" {
			configPath = codexConfigPath()
		}
		before, after, err := DryRunCodex(configPath, contentPAT, promptPAT)
		if err != nil {
			return err
		}
		printDiff(opts.Output, configPath, before, after)
	}

	return nil
}

func printDiff(w io.Writer, path, before, after string) {
	fmt.Fprintf(w, "File: %s\n", path)
	if before == "" || before == "{}" || before == "{}\n" {
		fmt.Fprintln(w, "(new file)")
	}
	fmt.Fprintln(w, after)
}

// backupIfMalformed tries to parse the config file.
// If it fails to parse, creates a .bak copy and returns an error to signal the backup happened.
// Returns nil if file doesn't exist or parses fine.
func backupIfMalformed(path string) error {
	if path == "" {
		return nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil // file doesn't exist — nothing to backup
	}

	// Try to parse based on extension
	if strings.HasSuffix(path, ".json") {
		var raw map[string]any
		if err := json.Unmarshal(data, &raw); err != nil {
			return createBackup(path, data)
		}
	} else if strings.HasSuffix(path, ".toml") {
		var raw map[string]any
		if err := toml.Unmarshal(data, &raw); err != nil {
			return createBackup(path, data)
		}
	}

	return nil
}

func createBackup(path string, data []byte) error {
	backupPath := path + ".bak"
	if err := os.WriteFile(backupPath, data, 0644); err != nil {
		return fmt.Errorf("creating backup at %s: %w", backupPath, err)
	}
	return fmt.Errorf("malformed config backed up")
}

// CheckOrphanedTokens checks for tiddly-mcp-* tokens that may be orphaned after uninstall.
func CheckOrphanedTokens(client *api.Client) ([]string, error) {
	tokens, err := client.ListTokens()
	if err != nil {
		return nil, err
	}

	var orphaned []string
	for _, t := range tokens {
		if strings.HasPrefix(t.Name, "tiddly-mcp-") {
			orphaned = append(orphaned, t.Name)
		}
	}
	return orphaned, nil
}
