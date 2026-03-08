package mcp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
)

// dryRunPlaceholder is the token shown in dry-run output when a new token would be created.
const dryRunPlaceholder = "<new-token-would-be-created>"

// tiddlyURLMatcher returns a predicate that matches only the server types being
// configured (indicated by non-empty PAT). When only one PAT is set, only that
// server type's URLs are matched, preserving the other. When both are set, all
// tiddly URLs are matched. When neither is set, nothing is matched (no-op).
func tiddlyURLMatcher(contentPAT, promptPAT string) func(string) bool {
	hasContent := contentPAT != ""
	hasPrompts := promptPAT != ""
	switch {
	case hasContent && hasPrompts:
		return isTiddlyURL
	case hasContent:
		return isTiddlyContentURL
	case hasPrompts:
		return isTiddlyPromptURL
	default:
		return func(string) bool { return false }
	}
}

// tokenPrefixLen is the number of leading characters the API stores as token_prefix.
const tokenPrefixLen = 12

// ConfigureOpts configures the MCP configure flow.
type ConfigureOpts struct {
	Ctx       context.Context
	Client    *api.Client
	Handlers  []ToolHandler // handler list for dispatch
	AuthType  string        // "oauth", "pat", "flag", "env"
	DryRun    bool
	Scope     string   // config scope: "user" (default), "local", or "project"
	Cwd       string   // working directory for "local"/"project" scope resolution
	Servers   []string // which servers to configure: "content", "prompts" (default: both)
	ExpiresIn *int     // PAT expiration in days (nil = no expiration)
	Output    io.Writer
	ErrOutput io.Writer
}

// wantServer returns true if the given server name is in the requested servers list.
func (o ConfigureOpts) wantServer(name string) bool {
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

// ConfigureResult captures what was done during configure.
type ConfigureResult struct {
	ToolsConfigured []string
	TokensCreated   []string
	TokensReused    []string
	Warnings        []string
}

// RunConfigure orchestrates MCP server configuration for the given tools.
func RunConfigure(opts ConfigureOpts, tools []DetectedTool) (*ConfigureResult, error) {
	if opts.Output == nil {
		opts.Output = os.Stdout
	}
	if opts.ErrOutput == nil {
		opts.ErrOutput = os.Stderr
	}
	if opts.Ctx == nil {
		opts.Ctx = context.Background()
	}

	result := &ConfigureResult{}

	isPATAuth := opts.AuthType == "pat" || opts.AuthType == "flag" || opts.AuthType == "env"
	if isPATAuth {
		result.Warnings = append(result.Warnings,
			"Using your current token for MCP servers. Login via 'tiddly login' to auto-create dedicated tokens per server.")
	}

	for _, tool := range tools {
		if !tool.Installed {
			continue
		}

		handler, ok := GetHandler(opts.Handlers, tool.Name)
		if !ok {
			return nil, fmt.Errorf("no handler for tool %q", tool.Name)
		}

		rc, err := ResolveToolConfig(handler, tool.ConfigPath, opts.Scope, opts.Cwd)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", tool.Name, err)
		}

		// Resolve PATs per-tool
		contentPAT, promptPAT, err := resolveToolPATs(opts, handler, tool, rc, isPATAuth, result)
		if err != nil {
			return nil, fmt.Errorf("resolving tokens for %s: %w", tool.Name, err)
		}

		if opts.DryRun {
			fmt.Fprintf(opts.Output, "\n--- %s ---\n", tool.Name)
			before, after, err := handler.DryRun(rc, contentPAT, promptPAT)
			if err != nil {
				return nil, err
			}
			printDiff(opts.Output, rc.Path, before, after)
			result.ToolsConfigured = append(result.ToolsConfigured, tool.Name)
			continue
		}

		warnings, err := handler.Configure(rc, contentPAT, promptPAT, tool)
		if err != nil {
			return nil, fmt.Errorf("configuring %s: %w", tool.Name, err)
		}
		result.Warnings = append(result.Warnings, warnings...)
		result.ToolsConfigured = append(result.ToolsConfigured, tool.Name)
	}

	return result, nil
}

// resolveToolPATs determines the content and prompt PATs for a specific tool.
// For PAT auth: reuses the login token. For OAuth: extracts existing PATs from the
// tool's config, validates them, and creates new ones only if needed.
func resolveToolPATs(opts ConfigureOpts, handler ToolHandler, tool DetectedTool, rc ResolvedConfig, isPATAuth bool, result *ConfigureResult) (contentPAT, promptPAT string, err error) {
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
	existingContent, existingPrompt := handler.ExtractPATs(rc)

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
func resolveServerPAT(opts ConfigureOpts, toolName, serverType, existingPAT string, result *ConfigureResult) (string, error) {
	// Dry-run: skip network calls entirely — show placeholder for new tokens,
	// optimistically reuse existing ones without validation. This previews
	// the config as-is; a real install will validate and replace stale PATs.
	if opts.DryRun {
		if existingPAT != "" {
			result.TokensReused = append(result.TokensReused,
				fmt.Sprintf("%s/%s", toolName, serverType))
			return existingPAT, nil
		}
		return dryRunPlaceholder, nil
	}

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


// DeleteTokensByPrefix finds and deletes tokens that match a PAT's prefix.
// Only deletes tokens whose name starts with tokenNamePrefix ("cli-mcp-") to avoid
// accidentally deleting user-created tokens that share a token prefix.
// Used by remove --delete-tokens. Returns the names of successfully deleted tokens
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

// CheckOrphanedTokens checks for cli-mcp-{toolName}-* tokens that may be orphaned after removal.
// Only returns tokens whose name matches the given tool, so uninstalling one tool
// doesn't report another tool's tokens.
func CheckOrphanedTokens(ctx context.Context, client *api.Client, toolName string) ([]string, error) {
	tokens, err := client.ListTokens(ctx)
	if err != nil {
		return nil, err
	}

	prefix := fmt.Sprintf("%s%s-", tokenNamePrefix, toolName)
	var orphaned []string
	for _, t := range tokens {
		if strings.HasPrefix(t.Name, prefix) {
			orphaned = append(orphaned, t.Name)
		}
	}
	return orphaned, nil
}
