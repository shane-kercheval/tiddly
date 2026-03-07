package mcp

import "fmt"

// ClaudeCodeHandler implements ToolHandler for Claude Code.
type ClaudeCodeHandler struct {
	ConfigPathOverride string // set by tests; empty in production
}

func (h *ClaudeCodeHandler) Name() string { return "claude-code" }

func (h *ClaudeCodeHandler) SupportedScopes() []string { return []string{"user", "local", "project"} }

func (h *ClaudeCodeHandler) Detect(looker ExecLooker) DetectedTool {
	tool := DetectedTool{Name: h.Name()}

	if _, err := looker.LookPath("claude"); err == nil {
		tool.Installed = true
		tool.Reason = "binary in PATH"
		if h.ConfigPathOverride != "" {
			tool.ConfigPath = h.ConfigPathOverride
		} else if p, err := ClaudeCodeConfigPath(); err == nil {
			tool.ConfigPath = p
		}
	}

	return tool
}

func (h *ClaudeCodeHandler) ResolvePath(configPath, scope, cwd string) (string, error) {
	return resolveClaudeCodePath(configPath, scope, cwd)
}

func (h *ClaudeCodeHandler) Install(rc ResolvedConfig, contentPAT, promptPAT string, tool DetectedTool) ([]string, error) {
	if err := installClaudeCode(rc, contentPAT, promptPAT); err != nil {
		return nil, err
	}
	warnings := []string{
		fmt.Sprintf("Tokens are stored in plaintext in %s. Manage tokens at https://tiddly.me/settings.", rc.Path),
	}
	return warnings, nil
}

func (h *ClaudeCodeHandler) Uninstall(rc ResolvedConfig) error {
	return uninstallClaudeCode(rc)
}

func (h *ClaudeCodeHandler) Status(rc ResolvedConfig) (StatusResult, error) {
	return statusClaudeCode(rc)
}

func (h *ClaudeCodeHandler) DryRun(rc ResolvedConfig, contentPAT, promptPAT string) (string, string, error) {
	return dryRunClaudeCode(rc, contentPAT, promptPAT)
}

func (h *ClaudeCodeHandler) ExtractPATs(rc ResolvedConfig) (string, string) {
	return extractClaudeCodePATs(rc)
}

