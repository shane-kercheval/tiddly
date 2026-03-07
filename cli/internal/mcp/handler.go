package mcp

// Compile-time interface checks.
var (
	_ ToolHandler = (*ClaudeDesktopHandler)(nil)
	_ ToolHandler = (*ClaudeCodeHandler)(nil)
	_ ToolHandler = (*CodexHandler)(nil)
)

// ToolHandler encapsulates all tool-specific behavior for MCP server management.
// Each supported AI tool (claude-desktop, claude-code, codex) implements this interface.
type ToolHandler interface {
	Name() string
	SupportedScopes() []string
	Detect(looker ExecLooker) DetectedTool
	ResolvePath(configPath, scope, cwd string) (string, error)
	Install(rc ResolvedConfig, contentPAT, promptPAT string, tool DetectedTool) (warnings []string, err error)
	Uninstall(rc ResolvedConfig) error
	Status(rc ResolvedConfig) (StatusResult, error)
	DryRun(rc ResolvedConfig, contentPAT, promptPAT string) (before, after string, err error)
	ExtractPATs(rc ResolvedConfig) (contentPAT, promptPAT string)
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
