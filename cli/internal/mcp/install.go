package mcp

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	toml "github.com/pelletier/go-toml/v2"
	"github.com/shane-kercheval/tiddly/cli/internal/api"
)

// dryRunPlaceholder is the token shown in dry-run output when a new token would be created.
const dryRunPlaceholder = "<new-token-would-be-created>"

// tokenPrefixLen is the number of leading characters the API stores as token_prefix.
const tokenPrefixLen = 12

// InstallOpts configures the MCP install flow.
type InstallOpts struct {
	Client    *api.Client
	AuthType  string // "oauth", "pat", "flag", "env"
	DryRun    bool
	Scope     string   // claude code scope: "user" (default) or "local"
	Servers   []string // which servers to install: "content", "prompts" (default: both)
	ExpiresIn *int     // PAT expiration in days (nil = no expiration)
	Output    io.Writer
	ErrOutput io.Writer
}

// wantServer returns true if the given server name is in the requested servers list.
func (o InstallOpts) wantServer(name string) bool {
	if len(o.Servers) == 0 {
		return true // default: both
	}
	for _, s := range o.Servers {
		if s == name {
			return true
		}
	}
	return false
}

// InstallResult captures what was done during install.
type InstallResult struct {
	ToolsConfigured []string
	TokensCreated   []string
	TokensReused    []string
	Warnings        []string
}

// RunInstall orchestrates MCP server installation for the given tools.
func RunInstall(opts InstallOpts, tools []DetectedTool) (*InstallResult, error) {
	if opts.Output == nil {
		opts.Output = os.Stdout
	}
	if opts.ErrOutput == nil {
		opts.ErrOutput = os.Stderr
	}

	result := &InstallResult{}

	isPATAuth := opts.AuthType == "pat" || opts.AuthType == "flag" || opts.AuthType == "env"
	if isPATAuth {
		result.Warnings = append(result.Warnings,
			"Using your current token for MCP servers. Login via 'tiddly login' to auto-create dedicated tokens per server.")
	}

	for _, tool := range tools {
		if !tool.Installed {
			continue
		}

		// Resolve PATs per-tool
		contentPAT, promptPAT, err := resolveToolPATs(opts, tool, isPATAuth, result)
		if err != nil {
			return nil, fmt.Errorf("resolving tokens for %s: %w", tool.Name, err)
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

// resolveToolPATs determines the content and prompt PATs for a specific tool.
// For PAT auth: reuses the login token. For OAuth: extracts existing PATs from the
// tool's config, validates them, and creates new ones only if needed.
func resolveToolPATs(opts InstallOpts, tool DetectedTool, isPATAuth bool, result *InstallResult) (contentPAT, promptPAT string, err error) {
	if isPATAuth {
		pat := opts.Client.Token
		if opts.wantServer("content") {
			contentPAT = pat
		}
		if opts.wantServer("prompts") {
			promptPAT = pat
		}
		return contentPAT, promptPAT, nil
	}

	// OAuth: try to reuse existing PATs from the tool's config
	existingContent, existingPrompt := ExtractPATsFromTool(tool, opts.Scope)

	if opts.wantServer("content") {
		contentPAT, err = resolveServerPAT(opts, tool.Name, "content", existingContent, result)
		if err != nil {
			return "", "", err
		}
	}
	if opts.wantServer("prompts") {
		promptPAT, err = resolveServerPAT(opts, tool.Name, "prompts", existingPrompt, result)
		if err != nil {
			return "", "", err
		}
	}

	return contentPAT, promptPAT, nil
}

// resolveServerPAT resolves a single PAT for a specific server.
// If an existing PAT is found and valid, it's reused. Otherwise a new one is created.
func resolveServerPAT(opts InstallOpts, toolName, serverType, existingPAT string, result *InstallResult) (string, error) {
	// Try to reuse existing PAT
	if existingPAT != "" && validatePAT(opts.Client.BaseURL, existingPAT) {
		result.TokensReused = append(result.TokensReused,
			fmt.Sprintf("%s/%s", toolName, serverType))
		return existingPAT, nil
	}

	// Dry-run: don't create tokens
	if opts.DryRun {
		return dryRunPlaceholder, nil
	}

	// Create a new PAT
	name := generateTokenName(toolName, serverType)
	resp, err := opts.Client.CreateToken(name, opts.ExpiresIn)
	if err != nil {
		return "", fmt.Errorf("creating %s MCP token for %s: %w", serverType, toolName, err)
	}
	result.TokensCreated = append(result.TokensCreated, name)
	return resp.Token, nil
}

// generateTokenName creates a unique token name like "tiddly-mcp-claude-code-content-a1b2c3".
func generateTokenName(tool, server string) string {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	suffix := hex.EncodeToString(b)
	return fmt.Sprintf("tiddly-mcp-%s-%s-%s", tool, server, suffix)
}

// validatePAT checks whether a PAT is still valid by calling GET /users/me.
// Returns true if the token works (200) or needs consent (451, still valid).
func validatePAT(baseURL, pat string) bool {
	client := api.NewClient(baseURL, pat, "pat")
	_, err := client.GetMe()
	if err == nil {
		return true
	}
	// 451 = consent needed but token is still valid
	if apiErr, ok := err.(*api.APIError); ok && apiErr.StatusCode == 451 {
		return true
	}
	return false
}

// ExtractPATsFromTool dispatches to the appropriate Extract function for the tool.
func ExtractPATsFromTool(tool DetectedTool, scope string) (contentPAT, promptPAT string) {
	switch tool.Name {
	case "claude-desktop":
		return ExtractClaudeDesktopPATs(tool.ResolvedConfigPath())
	case "claude-code":
		return ExtractClaudeCodePATs(tool.ResolvedConfigPath(), scope)
	case "codex":
		return ExtractCodexPATs(tool.ResolvedConfigPath())
	}
	return "", ""
}

// DeleteTokensByPrefix finds and deletes tokens that match a PAT's prefix.
// Used by uninstall --delete-tokens. Returns the names of deleted tokens.
func DeleteTokensByPrefix(client *api.Client, pats []string) ([]string, error) {
	tokens, err := client.ListTokens()
	if err != nil {
		return nil, fmt.Errorf("listing tokens: %w", err)
	}

	var deleted []string
	for _, pat := range pats {
		if len(pat) < tokenPrefixLen {
			continue
		}
		prefix := pat[:tokenPrefixLen]
		for _, t := range tokens {
			if t.TokenPrefix == prefix {
				if err := client.DeleteToken(t.ID); err == nil {
					deleted = append(deleted, t.Name)
				}
			}
		}
	}
	return deleted, nil
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
		configPath := tool.ResolvedConfigPath()
		backedUp, err := backupIfMalformed(configPath)
		if err != nil {
			return err
		}
		if backedUp {
			result.Warnings = append(result.Warnings,
				fmt.Sprintf("Existing config at %s was malformed. Backup saved to %s.bak", configPath, configPath))
		}
		if err := InstallClaudeCode(configPath, contentPAT, promptPAT, opts.Scope); err != nil {
			return err
		}
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("Tokens are stored in plaintext in %s. Use 'tiddly tokens list' to audit.", configPath))

	case "codex":
		configPath := tool.ResolvedConfigPath()
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
		configPath := tool.ResolvedConfigPath()
		before, after, err := DryRunClaudeDesktop(configPath, contentPAT, promptPAT)
		if err != nil {
			return err
		}
		printDiff(opts.Output, configPath, before, after)

	case "claude-code":
		configPath := tool.ResolvedConfigPath()
		before, after, err := DryRunClaudeCode(configPath, contentPAT, promptPAT, opts.Scope)
		if err != nil {
			return err
		}
		printDiff(opts.Output, configPath, before, after)

	case "codex":
		configPath := tool.ResolvedConfigPath()
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
