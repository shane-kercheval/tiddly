package mcp

// Compile-time interface checks.
var (
	_ ToolHandler = (*ClaudeDesktopHandler)(nil)
	_ ToolHandler = (*ClaudeCodeHandler)(nil)
	_ ToolHandler = (*CodexHandler)(nil)
)

// TiddlyPAT describes one Bearer token found in a tiddly-URL entry during a
// config walk. Callers consume []TiddlyPAT in canonical-first order when
// they need the full set of tokens.
type TiddlyPAT struct {
	ServerType string // ServerContent or ServerPrompts
	Name       string // config key name
	PAT        string // Bearer token value (never empty; entries without a PAT are filtered out)
}

// RemoveResult describes the outcome of a Remove operation.
// RemovedEntries lists canonical key names actually deleted from the config
// file. Empty when nothing matched (no file, no canonical entries, or the
// --servers scope excluded every canonical entry present). BackupPath is
// the timestamped backup file created before a write; empty when no write
// was attempted or no prior file existed.
//
// Handlers always return a non-nil *RemoveResult, even on error paths.
// In particular, a write failure AFTER the backup was taken returns
// (&RemoveResult{BackupPath: path, RemovedEntries: nil}, err) so callers
// can surface the recovery artifact before propagating the error.
type RemoveResult struct {
	RemovedEntries []string
	BackupPath     string
}

// PATExtraction is the result of walking a tool's config for PATs attached to
// CLI-managed entries (the canonical-named ones). Callers needing to reuse an
// existing CLI-managed PAT during configure read from here.
type PATExtraction struct {
	ContentPAT string
	PromptPAT  string
}

// ToolHandler encapsulates all tool-specific behavior for MCP server management.
// Each supported AI tool (claude-desktop, claude-code, codex) implements this interface.
type ToolHandler interface {
	Name() string
	SupportedScopes() []string
	Detect(looker ExecLooker) DetectedTool
	ResolvePath(configPath, scope, cwd string) (string, error)
	Configure(rc ResolvedConfig, contentPAT, promptPAT string, tool DetectedTool) (warnings []string, backupPath string, err error)
	Remove(rc ResolvedConfig, servers []string) (*RemoveResult, error)
	Status(rc ResolvedConfig) (StatusResult, error)
	DryRun(rc ResolvedConfig, contentPAT, promptPAT string) (before, after string, err error)
	ExtractPATs(rc ResolvedConfig) PATExtraction
	// AllTiddlyPATs returns every extractable Bearer token in the tool's
	// config from entries whose URL classifies as a Tiddly URL, in
	// canonical-first order. Used by `remove --delete-tokens`: the
	// canonical subset supplies revoke targets; the full output feeds
	// the retained-PAT set used for shared-PAT warnings and
	// orphan-subtraction.
	//
	// Known limitation: a canonical-named entry whose URL is NOT a Tiddly
	// URL (a repurposed slot) is not returned by this method. Such entries
	// do not participate in shared-PAT warnings or orphan-subtraction.
	// Accepted pre-GA limitation.
	AllTiddlyPATs(rc ResolvedConfig) []TiddlyPAT
}

// CanonicalName returns the canonical config-entry key name for a server
// type (e.g. ServerContent → "tiddly_notes_bookmarks"). Returns "" for
// unknown types. Exposed so cmd-layer callers can identify canonical
// entries without importing the private name constants.
func CanonicalName(serverType string) string {
	switch serverType {
	case ServerContent:
		return serverNameContent
	case ServerPrompts:
		return serverNamePrompts
	default:
		return ""
	}
}

// canonicalNamesForServers maps a set of requested server types (from
// --servers) to the canonical config key names Remove should delete. Used
// by every per-handler Remove to keep the filter in one place.
func canonicalNamesForServers(servers []string) map[string]bool {
	out := make(map[string]bool, 2)
	for _, s := range servers {
		switch s {
		case ServerContent:
			out[serverNameContent] = true
		case ServerPrompts:
			out[serverNamePrompts] = true
		}
	}
	return out
}

// canonicalEntryPATs picks the PAT attached to each canonical-named entry,
// but only when the entry's URL classifies to the server type its name
// implies. A cross-wired canonical slot (e.g. tiddly_prompts pointing at
// the content URL) contributes NO PAT — reusing its PAT would let an
// out-of-scope misconfigured slot leak its bearer into the in-scope write.
// The preflight mismatch check flags the cross-wiring separately; this
// function's job is to keep reuse strictly tied to correctly-wired slots.
func canonicalEntryPATs(all []TiddlyPAT) PATExtraction {
	var out PATExtraction
	for _, p := range all {
		switch {
		case p.Name == serverNameContent && p.ServerType == ServerContent:
			if out.ContentPAT == "" {
				out.ContentPAT = p.PAT
			}
		case p.Name == serverNamePrompts && p.ServerType == ServerPrompts:
			if out.PromptPAT == "" {
				out.PromptPAT = p.PAT
			}
		}
	}
	return out
}

// DefaultHandlers returns the production handler list.
// Order determines display order in CLI output (status, help, validation messages).
func DefaultHandlers() []ToolHandler {
	return []ToolHandler{
		&ClaudeDesktopHandler{},
		&ClaudeCodeHandler{},
		&CodexHandler{},
	}
}

// GetHandler finds a handler by name in the given slice.
func GetHandler(handlers []ToolHandler, name string) (ToolHandler, bool) {
	for _, h := range handlers {
		if h.Name() == name {
			return h, true
		}
	}
	return nil, false
}

// DetectAll runs detection for all handlers and returns the results in handler order.
func DetectAll(handlers []ToolHandler, looker ExecLooker) []DetectedTool {
	tools := make([]DetectedTool, len(handlers))
	for i, h := range handlers {
		tools[i] = h.Detect(looker)
	}
	return tools
}

// ValidToolNames returns the names of all handlers in order.
func ValidToolNames(handlers []ToolHandler) []string {
	names := make([]string, len(handlers))
	for i, h := range handlers {
		names[i] = h.Name()
	}
	return names
}
