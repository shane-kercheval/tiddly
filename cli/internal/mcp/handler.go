package mcp

// Compile-time interface checks.
var (
	_ ToolHandler = (*ClaudeDesktopHandler)(nil)
	_ ToolHandler = (*ClaudeCodeHandler)(nil)
	_ ToolHandler = (*CodexHandler)(nil)
)

// PATExtraction is the result of walking a tool's config to find reusable
// tiddly PATs. The *PAT fields hold Bearer token values (empty if none found
// or unextractable); the *Name fields hold the config key those PATs came
// from. Callers needing "which entry would survive a consolidation" (e.g.
// the consolidation warning) MUST use these names — parallel heuristics
// will drift when the selection rules evolve.
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
