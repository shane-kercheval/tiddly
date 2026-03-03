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

	// Delete any existing tiddly-mcp tokens so re-install is idempotent
	deleteExistingTokens(opts.Client, existing, "tiddly-mcp-content")
	deleteExistingTokens(opts.Client, existing, "tiddly-mcp-prompts")

	contentResp, err := opts.Client.CreateToken("tiddly-mcp-content", opts.ExpiresIn)
	if err != nil {
		return "", "", fmt.Errorf("creating content MCP token: %w", err)
	}
	contentPAT = contentResp.Token
	result.TokensCreated = append(result.TokensCreated, "tiddly-mcp-content")

	promptResp, err := opts.Client.CreateToken("tiddly-mcp-prompts", opts.ExpiresIn)
	if err != nil {
		return "", "", fmt.Errorf("creating prompts MCP token: %w", err)
	}
	promptPAT = promptResp.Token
	result.TokensCreated = append(result.TokensCreated, "tiddly-mcp-prompts")

	return contentPAT, promptPAT, nil
}

// deleteExistingTokens removes any tokens with the given name so re-install doesn't accumulate duplicates.
func deleteExistingTokens(client *api.Client, tokens []api.TokenInfo, name string) {
	for _, t := range tokens {
		if t.Name == name {
			_ = client.DeleteToken(t.ID) // best-effort; creation will fail if this matters
		}
	}
}

func installTool(opts InstallOpts, tool DetectedTool, contentPAT, promptPAT string, result *InstallResult) error {
	switch tool.Name {
	case "claude-desktop":
		if !tool.HasNpx {
			result.Warnings = append(result.Warnings,
				"Claude Desktop requires Node.js for mcp-remote. Install from https://nodejs.org")
		}
		backedUp, err := backupIfMalformed(tool.ConfigPath)
		if err != nil {
			return err
		}
		if backedUp {
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
			configPath = CodexConfigPath()
		}
		backedUp, err := backupIfMalformed(configPath)
		if err != nil {
			return err
		}
		if backedUp {
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
			configPath = ClaudeDesktopConfigPath()
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
			configPath = CodexConfigPath()
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
// If malformed, creates a .bak copy and removes the original so install can start fresh.
// Returns (true, nil) if backup was created, (false, nil) if file is fine or missing,
// and (false, err) if the backup write failed.
func backupIfMalformed(path string) (bool, error) {
	if path == "" {
		return false, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return false, nil // file doesn't exist — nothing to backup
	}

	malformed := false
	if strings.HasSuffix(path, ".json") {
		var raw map[string]any
		if json.Unmarshal(data, &raw) != nil {
			malformed = true
		}
	} else if strings.HasSuffix(path, ".toml") {
		var raw map[string]any
		if toml.Unmarshal(data, &raw) != nil {
			malformed = true
		}
	}

	if !malformed {
		return false, nil
	}

	backupPath := path + ".bak"
	if err := os.WriteFile(backupPath, data, 0600); err != nil {
		return false, fmt.Errorf("creating backup at %s: %w", backupPath, err)
	}
	if err := os.Remove(path); err != nil {
		return false, fmt.Errorf("removing malformed config at %s: %w", path, err)
	}
	return true, nil
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
