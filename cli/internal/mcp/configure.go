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

// anyConsolidations reports whether any preflighted tool has at least one
// ConsolidationGroup. Used to decide whether to emit the leading header
// in both dry-run and gate paths.
func anyConsolidations(plan []preflightedTool) bool {
	for _, pf := range plan {
		if len(pf.consolidations) > 0 {
			return true
		}
	}
	return false
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
		interactive = defaultIsInteractive
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

		// Populate SurvivorName per group under OAuth so the warning's
		// "PAT from X will be reused" matches the entry ExtractPATs
		// actually picks during commit. Under PAT auth the warning
		// doesn't use SurvivorName — it frames the consolidation as a
		// rebind to the login account — so we skip the read.
		if !isPATAuth && len(groups) > 0 {
			ext := handler.ExtractPATs(rc)
			for i := range groups {
				groups[i].SurvivorName = survivorNameFor(ext, groups[i].ServerType)
			}
		}

		plan = append(plan, preflightedTool{tool: tool, handler: handler, rc: rc, consolidations: groups})
	}

	// Phase 2: Single confirmation gate. Skipped in dry-run — dry-run
	// emits per-tool warnings alongside each diff instead of gating,
	// but still prints a leading "Consolidation required:" header so the
	// dry-run and real-run outputs open the same way. A user who runs
	// dry-run followed by real shouldn't see formatting churn for what
	// is the same underlying event.
	if !opts.DryRun {
		if err := confirmConsolidations(opts, plan, isPATAuth); err != nil {
			return nil, err
		}
	} else if anyConsolidations(plan) {
		fmt.Fprintln(opts.Output, "Consolidation required:")
	}

	// Phase 3: Commit. PAT resolution (which may create tokens server-side)
	// and the filesystem write happen here, after the user has confirmed.
	//
	// Errors below return the partial result so the caller can display what
	// already succeeded. Crucially, any OAuth tokens minted for the FAILING
	// tool are revoked server-side — otherwise a Configure failure would
	// leave orphaned tokens on the user's account that they'd have to chase
	// down manually. Tokens minted for earlier successful tools stay put:
	// they're in those tools' written configs and must remain usable.
	for _, pf := range plan {
		res, err := resolveToolPATs(opts, pf.handler, pf.tool, pf.rc, isPATAuth)
		if err != nil {
			// Some mints may have already happened before the failing one
			// (content minted, prompts failed). Revoke what we have.
			err = withRevokeError(err, revokeMintedTokens(opts.Ctx, opts.Client, res.Minted))
			return result, fmt.Errorf("resolving tokens for %s: %w", pf.tool.Name, err)
		}

		if opts.DryRun {
			fmt.Fprintf(opts.Output, "\n--- %s ---\n", pf.tool.Name)
			if len(pf.consolidations) > 0 {
				writeConsolidationWarning(opts.Output, pf.tool.Name, pf.consolidations, isPATAuth)
			}
			before, after, dErr := pf.handler.DryRun(pf.rc, res.ContentPAT, res.PromptPAT)
			if dErr != nil {
				return nil, dErr
			}
			printDiff(opts.Output, pf.rc.Path, before, after)
			// Dry-run does not write anything, so ToolsConfigured stays empty.
			// The field's contract is "tools whose configs were actually
			// written to disk"; a future consumer (e.g. `tiddly mcp restore`
			// consulting result.Backups) must not be fooled by a dry-run
			// listing a tool as configured. Similarly TokensCreated stays
			// empty — no server-side mint happened under dry-run.
			result.TokensReused = append(result.TokensReused, res.Reused...)
			continue
		}

		warnings, backupPath, cErr := pf.handler.Configure(pf.rc, res.ContentPAT, res.PromptPAT, pf.tool)
		if cErr != nil {
			cErr = withRevokeError(cErr, revokeMintedTokens(opts.Ctx, opts.Client, res.Minted))
			return result, fmt.Errorf("configuring %s: %w", pf.tool.Name, cErr)
		}

		// Success: only now promote the mints and reuses into the visible
		// summary. If Configure had failed we'd have revoked them instead.
		for _, m := range res.Minted {
			result.TokensCreated = append(result.TokensCreated, m.Name)
		}
		result.TokensReused = append(result.TokensReused, res.Reused...)
		result.Warnings = append(result.Warnings, warnings...)
		if backupPath != "" {
			result.Backups = append(result.Backups, BackupRecord{Tool: pf.tool.Name, Path: backupPath})
		}
		result.ToolsConfigured = append(result.ToolsConfigured, pf.tool.Name)
	}

	return result, nil
}

// mintedToken records a server-side PAT created during a commit-phase run
// so we can revoke it if a subsequent step (another PAT mint, the config
// write) fails for the same tool. Keeping this local to the commit loop —
// instead of writing straight into ConfigureResult — means we only promote
// the records to the user-visible summary after the tool fully succeeds.
type mintedToken struct {
	ID    string
	Name  string
	Token string // plaintext value, used only to print a last-4 prefix on revoke failure
}

// toolPATResolution is the per-tool output of resolveToolPATs. It separates
// "attempted" (minted) from "settled" (reused) so the commit loop can decide
// what to promote to ConfigureResult after Configure either succeeds or
// fails and triggers revoke.
type toolPATResolution struct {
	ContentPAT string
	PromptPAT  string
	Minted     []mintedToken // server-side tokens created this run; revoke targets on failure
	Reused     []string      // "tool/serverType" labels for tokens that already existed and passed validation
}

// resolveToolPATs determines the content and prompt PATs for a specific tool.
// For PAT auth: reuses the login token (no server-side mutation). For OAuth:
// extracts existing PATs from the tool's config, validates them, and creates
// new ones only when needed. Newly-minted token metadata is returned in
// toolPATResolution.Minted so the caller can revoke on failure.
func resolveToolPATs(opts ConfigureOpts, handler ToolHandler, tool DetectedTool, rc ResolvedConfig, isPATAuth bool) (toolPATResolution, error) {
	var out toolPATResolution
	if isPATAuth {
		pat := opts.Client.Token
		if opts.wantServer(ServerContent) {
			out.ContentPAT = pat
		}
		if opts.wantServer(ServerPrompts) {
			out.PromptPAT = pat
		}
		return out, nil
	}

	// OAuth: try to reuse existing PATs from the tool's config
	ext := handler.ExtractPATs(rc)

	if opts.wantServer(ServerContent) {
		pat, minted, reused, err := resolveServerPAT(opts, tool.Name, ServerContent, ext.ContentPAT)
		if err != nil {
			return out, err
		}
		out.ContentPAT = pat
		if minted != nil {
			out.Minted = append(out.Minted, *minted)
		}
		if reused {
			out.Reused = append(out.Reused, fmt.Sprintf("%s/%s", tool.Name, ServerContent))
		}
	}
	if opts.wantServer(ServerPrompts) {
		pat, minted, reused, err := resolveServerPAT(opts, tool.Name, ServerPrompts, ext.PromptPAT)
		if err != nil {
			return out, err
		}
		out.PromptPAT = pat
		if minted != nil {
			out.Minted = append(out.Minted, *minted)
		}
		if reused {
			out.Reused = append(out.Reused, fmt.Sprintf("%s/%s", tool.Name, ServerPrompts))
		}
	}

	return out, nil
}

// resolveServerPAT resolves a single PAT for a specific server. If an
// existing PAT is found and valid, it's reused (reused=true, minted=nil).
// Otherwise a new one is created on the server (minted points to the
// new token record). No mutation of any shared result — the caller owns
// promoting records to the user-visible summary.
func resolveServerPAT(opts ConfigureOpts, toolName, serverType, existingPAT string) (pat string, minted *mintedToken, reused bool, err error) {
	// Dry-run: skip network calls entirely — show placeholder for new tokens,
	// optimistically reuse existing ones without validation. This previews
	// the config as-is; a real configure will validate and replace stale PATs.
	if opts.DryRun {
		if existingPAT != "" {
			return existingPAT, nil, true, nil
		}
		return dryRunPlaceholder, nil, false, nil
	}

	// Try to reuse existing PAT
	if existingPAT != "" {
		valid, vErr := validatePAT(opts.Ctx, opts.Client.BaseURL, existingPAT)
		if vErr != nil {
			return "", nil, false, fmt.Errorf("checking existing %s token for %s: %w", serverType, toolName, vErr)
		}
		if valid {
			return existingPAT, nil, true, nil
		}
	}

	// Create a new PAT
	name := generateTokenName(toolName, serverType)
	resp, cErr := opts.Client.CreateToken(opts.Ctx, name, opts.ExpiresIn)
	if cErr != nil {
		return "", nil, false, fmt.Errorf("creating %s MCP token for %s: %w", serverType, toolName, cErr)
	}
	return resp.Token, &mintedToken{ID: resp.ID, Name: resp.Name, Token: resp.Token}, false, nil
}

// withRevokeError appends revoke-failure context to a primary error. The
// primary error always wins (it describes what went wrong); the revoke
// error, if any, is grafted on so the user sees both the root cause and
// the specific tokens they now need to clean up manually.
func withRevokeError(primary, revoke error) error {
	if revoke == nil {
		return primary
	}
	return fmt.Errorf("%w (cleanup partially failed: %v)", primary, revoke)
}

// revokeMintedTokens best-effort deletes the given server-side tokens by ID.
// Used to clean up after a commit-phase failure so we don't leave orphaned
// tokens on the account.
//
// Returns nil if every token was deleted (or there were none to delete).
// Returns a summary error naming each token that could NOT be revoked so
// the user can finish the cleanup manually in their settings.
func revokeMintedTokens(ctx context.Context, client *api.Client, minted []mintedToken) error {
	if len(minted) == 0 {
		return nil
	}
	var orphans []string
	for _, m := range minted {
		if delErr := client.DeleteToken(ctx, m.ID); delErr != nil {
			prefix := m.Token
			if len(prefix) > 4 {
				prefix = "..." + prefix[len(prefix)-4:]
			}
			orphans = append(orphans, fmt.Sprintf("%s (%s)", m.Name, prefix))
		}
	}
	if len(orphans) == 0 {
		return nil
	}
	return fmt.Errorf("failed to revoke %d minted token(s); clean up manually at https://tiddly.me/settings: %s",
		len(orphans), strings.Join(orphans, ", "))
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
