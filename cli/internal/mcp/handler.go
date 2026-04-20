package mcp

// Compile-time interface checks.
var (
	_ ToolHandler = (*ClaudeDesktopHandler)(nil)
	_ ToolHandler = (*ClaudeCodeHandler)(nil)
	_ ToolHandler = (*CodexHandler)(nil)
)

// TiddlyPAT describes one Bearer token found in a tiddly-URL entry during a
// config walk. Callers consume []TiddlyPAT in canonical-first order when
// they need the full set of tokens (e.g. remove --delete-tokens must revoke
// every tiddly-URL token, not just the survivor ExtractPATs would pick).
type TiddlyPAT struct {
	ServerType string // ServerContent or ServerPrompts
	Name       string // config key name
	PAT        string // Bearer token value (never empty; entries without a PAT are filtered out)
}

// PATExtraction is the result of walking a tool's config to find reusable
// tiddly PATs. The *PAT fields hold Bearer token values (empty if none found
// or unextractable); the *Name fields hold the config key those PATs came
// from. Callers needing "which entry would survive a consolidation" (e.g.
// the consolidation warning) MUST use these names — parallel heuristics
// will drift when the selection rules evolve.
//
// Derived from AllTiddlyPATs by picking the first entry per ServerType
// (canonical-first ordering). Keeping the derivation in one place —
// survivorsOfAllTiddlyPATs — means "who's the survivor" has a single
// definition that both the consolidation warning and the commit-phase
// reuse share.
type PATExtraction struct {
	ContentPAT  string
	PromptPAT   string
	ContentName string
	PromptName  string
}

// ToolHandler encapsulates all tool-specific behavior for MCP server management.
// Each supported AI tool (claude-desktop, claude-code, codex) implements this interface.
type ToolHandler interface {
	Name() string
	SupportedScopes() []string
	Detect(looker ExecLooker) DetectedTool
	ResolvePath(configPath, scope, cwd string) (string, error)
	Configure(rc ResolvedConfig, contentPAT, promptPAT string, tool DetectedTool) (warnings []string, backupPath string, err error)
	Remove(rc ResolvedConfig, servers []string) (backupPath string, err error)
	Status(rc ResolvedConfig) (StatusResult, error)
	DryRun(rc ResolvedConfig, contentPAT, promptPAT string) (before, after string, err error)
	ExtractPATs(rc ResolvedConfig) PATExtraction
	// AllTiddlyPATs returns every extractable Bearer token in the tool's
	// config that points at a tiddly URL, in canonical-first order. Used
	// by `remove --delete-tokens` so multi-entry configs (e.g.
	// work_prompts + personal_prompts with distinct PATs) revoke every
	// token, not just the survivor.
	AllTiddlyPATs(rc ResolvedConfig) []TiddlyPAT
}

// survivorsOfAllTiddlyPATs picks the first non-empty PAT per ServerType
// from a canonical-first-ordered slice. This is the single definition of
// "who survives a consolidation"; both ExtractPATs (consumed by the
// commit-phase reuse logic) and the consolidation warning (via
// preflight-populated SurvivorName) route through this function.
func survivorsOfAllTiddlyPATs(all []TiddlyPAT) PATExtraction {
	var out PATExtraction
	for _, p := range all {
		switch p.ServerType {
		case ServerContent:
			if out.ContentPAT == "" {
				out.ContentPAT, out.ContentName = p.PAT, p.Name
			}
		case ServerPrompts:
			if out.PromptPAT == "" {
				out.PromptPAT, out.PromptName = p.PAT, p.Name
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
