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
	Scope     string   // Tiddly scope: "user" (default) or "directory"
	Cwd       string   // working directory for directory scope resolution
	Servers   []string // which servers to configure: "content", "prompts" (default: both)
	ExpiresIn *int     // PAT expiration in days (nil = no expiration)
	Output    io.Writer
	ErrOutput io.Writer

	// AssumeYes bypasses the interactive consolidation prompt (set via --yes).
	AssumeYes bool
	// Stdin is the source for the interactive confirmation prompt.
	// Tests inject a *bytes.Buffer; production uses os.Stdin.
	Stdin io.Reader
	// IsInteractive reports whether stdin is connected to a terminal. When
	// nil, falls back to detecting stdin itself. Tests override to simulate
	// interactive vs non-interactive runs without a real TTY.
	IsInteractive func() bool
}

// ErrConsolidationDeclined is returned when the user says "no" at the
// interactive consolidation prompt. The cmd layer surfaces this with an
// actionable user message.
var ErrConsolidationDeclined = errors.New("consolidation declined by user")

// ErrConsolidationNeedsConfirmation is returned when the CLI detects that
// a configure would consolidate multiple tiddly entries but cannot prompt
// (non-interactive stdin) and --yes was not passed. The cmd layer wraps
// this with flag-name guidance; the sentinel itself is deliberately terse
// so the mcp package doesn't bake in knowledge of CLI flag names.
var ErrConsolidationNeedsConfirmation = errors.New("consolidation needs confirmation")

// preflightedTool holds per-tool state computed during Phase 1 (pre-flight)
// of RunConfigure. Everything here is gathered without mutating the user's
// filesystem or any server-side state — so a subsequent "no" at the
// confirmation gate leaves nothing to clean up.
type preflightedTool struct {
	tool           DetectedTool
	handler        ToolHandler
	rc             ResolvedConfig
	consolidations []ConsolidationGroup // nil when no consolidation would occur
}

// confirmConsolidations is the single cross-tool confirmation gate. Emits a
// combined warning covering every tool whose configure would collapse
// multiple existing Tiddly entries, then:
//   - opts.AssumeYes          → proceed, print "--yes" acknowledgment
//   - interactive stdin       → prompt y/N once (default No)
//   - non-interactive stdin   → return ErrConsolidationNeedsConfirmation
//
// Returning nil means either no consolidation is required or the user
// confirmed. Returning an error means the caller must abort before any
// writes or API mutations — no partial state.
func confirmConsolidations(opts ConfigureOpts, plan []preflightedTool, isPATAuth bool) error {
	anyConsolidation := false
	for _, pf := range plan {
		if len(pf.consolidations) > 0 {
			anyConsolidation = true
			break
		}
	}
	if !anyConsolidation {
		return nil
	}

	fmt.Fprintln(opts.Output, "Consolidation required:")
	for _, pf := range plan {
		if len(pf.consolidations) > 0 {
			writeConsolidationWarning(opts.Output, pf.tool.Name, pf.consolidations, isPATAuth)
		}
	}

	if opts.AssumeYes {
		fmt.Fprintln(opts.Output, "Proceeding (--yes).")
		return nil
	}

	interactive := opts.IsInteractive
	if interactive == nil {
		interactive = isStdinTerminal
	}
	if !interactive() {
		return ErrConsolidationNeedsConfirmation
	}

	stdin := opts.Stdin
	if stdin == nil {
		stdin = os.Stdin
	}
	ok, err := promptYesNo(opts.Output, stdin, "Continue? [y/N]: ")
	if err != nil {
		return err
	}
	if !ok {
		return ErrConsolidationDeclined
	}
	return nil
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

// BackupRecord points at a single timestamped backup file created before
// a destructive write. Captured as a typed struct rather than a display
// string so future consumers (e.g. a `tiddly mcp restore` subcommand) can
// work with the data directly instead of parsing formatted output.
type BackupRecord struct {
	Tool string // tool name (e.g. "claude-desktop")
	Path string // absolute path to the <original>.bak.<timestamp> file
}

// ConfigureResult captures what was done during configure.
type ConfigureResult struct {
	ToolsConfigured []string
	TokensCreated   []string
	TokensReused    []string
	Warnings        []string
	// Backups holds one record per tool whose config file existed before
	// configure and was copied to a timestamped backup. Surfaces to the
	// user so they know where their recovery copy landed.
	Backups []BackupRecord
}

// RunConfigure orchestrates MCP server configuration for the given tools in
// three phases: pre-flight (read-only discovery), confirmation gate (single
// y/N across all tools), and commit (PAT resolution + Configure). The split
// ensures no server-side token creation or filesystem writes happen before
// the user confirms — a "no" at the gate leaves the system untouched.
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

	// Phase 1: Pre-flight. Resolve paths, read current state, detect
	// consolidations. No filesystem writes, no server-side mutations.
	//
	// Status errors are tolerated in dry-run (the diff is still useful as
	// a preview), but fail-closed in a real configure: if we can't read
	// the existing config, we can't detect consolidation, and silently
	// proceeding would bypass the safety gate the user is relying on.
	plan := make([]preflightedTool, 0, len(tools))
	for _, tool := range tools {
		if !tool.Detected {
			continue
		}

		handler, ok := GetHandler(opts.Handlers, tool.Name)
		if !ok {
			return nil, fmt.Errorf("no handler for tool %q", tool.Name)
		}

		nativeScope := TranslateScope(opts.Scope, tool.Name)
		rc, err := ResolveToolConfig(handler, tool.ConfigPath, nativeScope, opts.Cwd)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", tool.Name, err)
		}

		var groups []ConsolidationGroup
		sr, statusErr := handler.Status(rc)
		switch {
		case statusErr != nil && opts.DryRun:
			// Supplementary warning only; diff is still informative.
		case statusErr != nil:
			return nil, fmt.Errorf("reading %s config for safety check: %w", tool.Name, statusErr)
		default:
			groups = detectConsolidations(sr, opts.Servers)
		}

		plan = append(plan, preflightedTool{tool: tool, handler: handler, rc: rc, consolidations: groups})
	}

	// Phase 2: Single confirmation gate. Skipped in dry-run — dry-run
	// emits per-tool warnings alongside each diff instead of gating.
	// Crucially this runs BEFORE resolveToolPATs so declining does not
	// leak server-side OAuth tokens.
	if !opts.DryRun {
		if err := confirmConsolidations(opts, plan, isPATAuth); err != nil {
			return nil, err
		}
	}

	// Phase 3: Commit. PAT resolution (which may create tokens server-side)
	// and the filesystem write happen here, after the user has confirmed.
	for _, pf := range plan {
		contentPAT, promptPAT, err := resolveToolPATs(opts, pf.handler, pf.tool, pf.rc, isPATAuth, result)
		if err != nil {
			return nil, fmt.Errorf("resolving tokens for %s: %w", pf.tool.Name, err)
		}

		if opts.DryRun {
			fmt.Fprintf(opts.Output, "\n--- %s ---\n", pf.tool.Name)
			if len(pf.consolidations) > 0 {
				writeConsolidationWarning(opts.Output, pf.tool.Name, pf.consolidations, isPATAuth)
			}
			before, after, err := pf.handler.DryRun(pf.rc, contentPAT, promptPAT)
			if err != nil {
				return nil, err
			}
			printDiff(opts.Output, pf.rc.Path, before, after)
			result.ToolsConfigured = append(result.ToolsConfigured, pf.tool.Name)
			continue
		}

		warnings, backupPath, err := pf.handler.Configure(pf.rc, contentPAT, promptPAT, pf.tool)
		if err != nil {
			return nil, fmt.Errorf("configuring %s: %w", pf.tool.Name, err)
		}
		result.Warnings = append(result.Warnings, warnings...)
		if backupPath != "" {
			result.Backups = append(result.Backups, BackupRecord{Tool: pf.tool.Name, Path: backupPath})
		}
		result.ToolsConfigured = append(result.ToolsConfigured, pf.tool.Name)
	}

	return result, nil
}

// resolveToolPATs determines the content and prompt PATs for a specific tool.
// For PAT auth: reuses the login token. For OAuth: extracts existing PATs from the
// tool's config, validates them, and creates new ones only if needed.
func resolveToolPATs(opts ConfigureOpts, handler ToolHandler, tool DetectedTool, rc ResolvedConfig, isPATAuth bool, result *ConfigureResult) (contentPAT, promptPAT string, err error) {
	if isPATAuth {
		pat := opts.Client.Token
		if opts.wantServer(ServerContent) {
			contentPAT = pat
		}
		if opts.wantServer(ServerPrompts) {
			promptPAT = pat
		}
		return contentPAT, promptPAT, nil
	}

	// OAuth: try to reuse existing PATs from the tool's config
	existingContent, existingPrompt := handler.ExtractPATs(rc)

	if opts.wantServer(ServerContent) {
		contentPAT, err = resolveServerPAT(opts, tool.Name, ServerContent, existingContent, result)
		if err != nil {
			return "", "", err
		}
	}
	if opts.wantServer(ServerPrompts) {
		promptPAT, err = resolveServerPAT(opts, tool.Name, ServerPrompts, existingPrompt, result)
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
	// the config as-is; a real configure will validate and replace stale PATs.
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
// Only returns tokens whose name matches the given tool and server types, so removing one
// server type doesn't report tokens for the other.
// Token names follow the pattern "cli-mcp-{tool}-{serverType}-{suffix}".
func CheckOrphanedTokens(ctx context.Context, client *api.Client, toolName string, serverTypes []string) ([]string, error) {
	tokens, err := client.ListTokens(ctx)
	if err != nil {
		return nil, err
	}

	// Build prefixes for the server types being removed
	var prefixes []string
	for _, st := range serverTypes {
		prefixes = append(prefixes, fmt.Sprintf("%s%s-%s-", tokenNamePrefix, toolName, st))
	}
	// Fallback: if no server types specified, match all tokens for this tool
	if len(prefixes) == 0 {
		prefixes = []string{fmt.Sprintf("%s%s-", tokenNamePrefix, toolName)}
	}

	var orphaned []string
	for _, t := range tokens {
		for _, p := range prefixes {
			if strings.HasPrefix(t.Name, p) {
				orphaned = append(orphaned, t.Name)
				break
			}
		}
	}
	return orphaned, nil
}
