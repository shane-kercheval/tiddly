package mcp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	Ctx       context.Context
	Client    *api.Client
	AuthType  string // "oauth", "pat", "flag", "env"
	DryRun    bool
	Scope     string   // config scope: "user" (default), "local", or "project"
	Cwd       string   // working directory for "local"/"project" scope resolution
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
	if opts.Ctx == nil {
		opts.Ctx = context.Background()
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

		rc, err := ResolveToolConfig(tool.Name, tool.ResolvedConfigPath(), opts.Scope, opts.Cwd)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", tool.Name, err)
		}

		// Resolve PATs per-tool
		contentPAT, promptPAT, err := resolveToolPATs(opts, tool, rc, isPATAuth, result)
		if err != nil {
			return nil, fmt.Errorf("resolving tokens for %s: %w", tool.Name, err)
		}

		if opts.DryRun {
			if err := dryRunTool(opts, tool, rc, contentPAT, promptPAT); err != nil {
				return nil, err
			}
			result.ToolsConfigured = append(result.ToolsConfigured, tool.Name)
			continue
		}

		if err := installTool(opts, tool, rc, contentPAT, promptPAT, result); err != nil {
			return nil, fmt.Errorf("installing %s: %w", tool.Name, err)
		}
		result.ToolsConfigured = append(result.ToolsConfigured, tool.Name)
	}

	return result, nil
}

// resolveToolPATs determines the content and prompt PATs for a specific tool.
// For PAT auth: reuses the login token. For OAuth: extracts existing PATs from the
// tool's config, validates them, and creates new ones only if needed.
func resolveToolPATs(opts InstallOpts, tool DetectedTool, rc ResolvedConfig, isPATAuth bool, result *InstallResult) (contentPAT, promptPAT string, err error) {
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
	existingContent, existingPrompt := ExtractPATsFromTool(tool, rc)

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
	if existingPAT != "" {
		valid, err := validatePAT(opts.Ctx, opts.Client.BaseURL, existingPAT)
		if err != nil {
			return "", fmt.Errorf("checking existing %s token for %s: %w", serverType, toolName, err)
		}
		if valid {
			result.TokensReused = append(result.TokensReused,
				fmt.Sprintf("%s/%s", toolName, serverType))
			return existingPAT, nil
		}
	}

	// Dry-run: don't create tokens
	if opts.DryRun {
		return dryRunPlaceholder, nil
	}

	// Create a new PAT
	name := generateTokenName(toolName, serverType)
	resp, err := opts.Client.CreateToken(opts.Ctx, name, opts.ExpiresIn)
	if err != nil {
		return "", fmt.Errorf("creating %s MCP token for %s: %w", serverType, toolName, err)
	}
	result.TokensCreated = append(result.TokensCreated, name)
	return resp.Token, nil
}

// tokenNamePrefix is the prefix for all CLI-created MCP tokens.
const tokenNamePrefix = "cli-mcp-"

// generateTokenName creates a unique token name like "cli-mcp-claude-code-content-a1b2c3".
func generateTokenName(tool, server string) string {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	suffix := hex.EncodeToString(b)
	return fmt.Sprintf("%s%s-%s-%s", tokenNamePrefix, tool, server, suffix)
}

// validatePAT checks whether a PAT is still valid by calling GET /users/me.
// Returns (true, nil) if the token works (200) or needs consent (451).
// Returns (false, nil) if the token is definitively invalid (401).
// Returns (false, err) if validation couldn't be determined (network error, 500, etc.).
func validatePAT(ctx context.Context, baseURL, pat string) (bool, error) {
	client := api.NewClient(baseURL, pat, "pat")
	_, err := client.GetMe(ctx)
	if err == nil {
		return true, nil
	}
	if apiErr, ok := err.(*api.APIError); ok {
		switch apiErr.StatusCode {
		case 451:
			return true, nil // consent needed but token is still valid
		case 401:
			return false, nil // definitively invalid
		}
	}
	return false, fmt.Errorf("validating token: %w", err)
}

// ExtractPATsFromTool dispatches to the appropriate Extract function for the tool.
func ExtractPATsFromTool(tool DetectedTool, rc ResolvedConfig) (contentPAT, promptPAT string) {
	switch tool.Name {
	case "claude-desktop":
		return ExtractClaudeDesktopPATs(rc.Path)
	case "claude-code":
		return ExtractClaudeCodePATs(rc)
	case "codex":
		return ExtractCodexPATs(rc)
	}
	return "", ""
}

// DeleteTokensByPrefix finds and deletes tokens that match a PAT's prefix.
// Only deletes tokens whose name starts with tokenNamePrefix ("cli-mcp-") to avoid
// accidentally deleting user-created tokens that share a token prefix.
// Used by uninstall --delete-tokens. Returns the names of successfully deleted tokens
// and any errors encountered during individual deletions.
func DeleteTokensByPrefix(ctx context.Context, client *api.Client, pats []string) ([]string, error) {
	tokens, err := client.ListTokens(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing tokens: %w", err)
	}

	var deleted []string
	var deleteErrors []error
	for _, pat := range pats {
		if len(pat) < tokenPrefixLen {
			continue
		}
		prefix := pat[:tokenPrefixLen]
		for _, t := range tokens {
			if t.TokenPrefix == prefix && strings.HasPrefix(t.Name, tokenNamePrefix) {
				if err := client.DeleteToken(ctx, t.ID); err != nil {
					deleteErrors = append(deleteErrors, fmt.Errorf("deleting token %s: %w", t.Name, err))
				} else {
					deleted = append(deleted, t.Name)
				}
			}
		}
	}
	if len(deleteErrors) > 0 {
		return deleted, errors.Join(deleteErrors...)
	}
	return deleted, nil
}

func installTool(opts InstallOpts, tool DetectedTool, rc ResolvedConfig, contentPAT, promptPAT string, result *InstallResult) error {
	switch tool.Name {
	case "claude-desktop":
		if !tool.HasNpx {
			result.Warnings = append(result.Warnings,
				"Claude Desktop requires Node.js for mcp-remote. Install from https://nodejs.org")
		}
		backedUp, err := backupIfMalformed(rc.Path)
		if err != nil {
			return err
		}
		if backedUp {
			result.Warnings = append(result.Warnings,
				fmt.Sprintf("Existing config at %s was malformed. Backup saved to %s.bak", rc.Path, rc.Path))
		}
		if err := InstallClaudeDesktop(rc.Path, contentPAT, promptPAT); err != nil {
			return err
		}
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("Tokens are stored in plaintext in %s. Manage tokens at https://tiddly.me/settings.", rc.Path))
		result.Warnings = append(result.Warnings, "Restart Claude Desktop to apply changes.")

	case "claude-code":
		backedUp, err := backupIfMalformed(rc.Path)
		if err != nil {
			return err
		}
		if backedUp {
			result.Warnings = append(result.Warnings,
				fmt.Sprintf("Existing config at %s was malformed. Backup saved to %s.bak", rc.Path, rc.Path))
		}
		if err := InstallClaudeCode(rc, contentPAT, promptPAT); err != nil {
			return err
		}
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("Tokens are stored in plaintext in %s. Manage tokens at https://tiddly.me/settings.", rc.Path))

	case "codex":
		backedUp, err := backupIfMalformed(rc.Path)
		if err != nil {
			return err
		}
		if backedUp {
			result.Warnings = append(result.Warnings,
				fmt.Sprintf("Existing config at %s was malformed. Backup saved to %s.bak", rc.Path, rc.Path))
		}
		if err := InstallCodex(rc, contentPAT, promptPAT); err != nil {
			return err
		}
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("Tokens are stored in plaintext in %s. Manage tokens at https://tiddly.me/settings.", rc.Path))
	}

	return nil
}

func dryRunTool(opts InstallOpts, tool DetectedTool, rc ResolvedConfig, contentPAT, promptPAT string) error {
	fmt.Fprintf(opts.Output, "\n--- %s ---\n", tool.Name)

	switch tool.Name {
	case "claude-desktop":
		before, after, err := DryRunClaudeDesktop(rc.Path, contentPAT, promptPAT)
		if err != nil {
			return err
		}
		printDiff(opts.Output, rc.Path, before, after)

	case "claude-code":
		before, after, err := DryRunClaudeCode(rc, contentPAT, promptPAT)
		if err != nil {
			return err
		}
		printDiff(opts.Output, rc.Path, before, after)

	case "codex":
		before, after, err := DryRunCodex(rc, contentPAT, promptPAT)
		if err != nil {
			return err
		}
		printDiff(opts.Output, rc.Path, before, after)
	}

	return nil
}

func printDiff(w io.Writer, path, before, after string) {
	fmt.Fprintf(w, "File: %s\n", path)
	if before == "" || before == "{}" || before == "{}\n" {
		fmt.Fprintln(w, "(new file)")
	} else {
		fmt.Fprintln(w, "Before:")
		fmt.Fprintln(w, before)
	}
	fmt.Fprintln(w, "After:")
	fmt.Fprintln(w, after)
}

// backupIfMalformed tries to parse the config file.
// If malformed, atomically renames the original to .bak so install can start fresh.
// Returns (true, nil) if backup was created, (false, nil) if file is fine or missing,
// and (false, err) if the rename failed.
func backupIfMalformed(path string) (bool, error) {
	if path == "" {
		return false, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, fmt.Errorf("reading config %s: %w", path, err)
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
	if err := os.Rename(path, backupPath); err != nil {
		return false, fmt.Errorf("backing up malformed config %s to %s: %w", path, backupPath, err)
	}
	return true, nil
}

// CheckOrphanedTokens checks for cli-mcp-* tokens that may be orphaned after uninstall.
func CheckOrphanedTokens(ctx context.Context, client *api.Client) ([]string, error) {
	tokens, err := client.ListTokens(ctx)
	if err != nil {
		return nil, err
	}

	var orphaned []string
	for _, t := range tokens {
		if strings.HasPrefix(t.Name, tokenNamePrefix) {
			orphaned = append(orphaned, t.Name)
		}
	}
	return orphaned, nil
}
