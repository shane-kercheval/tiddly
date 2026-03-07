package mcp

import (
	"fmt"
	"os"
	"path/filepath"
)

// CodexHandler implements ToolHandler for Codex.
type CodexHandler struct {
	ConfigPathOverride string // set by tests; empty in production
}

func (h *CodexHandler) Name() string { return "codex" }

func (h *CodexHandler) SupportedScopes() []string { return []string{"user", "project"} }

func (h *CodexHandler) Detect(looker ExecLooker) DetectedTool {
	tool := DetectedTool{Name: h.Name()}

	if _, err := looker.LookPath("codex"); err == nil {
		tool.Installed = true
		tool.Reason = "binary in PATH"
		if h.ConfigPathOverride != "" {
			tool.ConfigPath = h.ConfigPathOverride
		}
		return tool
	}

	configPath := h.ConfigPathOverride
	if configPath == "" {
		var err error
		configPath, err = CodexConfigPath()
		if err != nil {
			return tool
		}
	}
	configDir := filepath.Dir(configPath)
	if info, err := os.Stat(configDir); err == nil && info.IsDir() {
		tool.Installed = true
		tool.ConfigPath = configPath
		tool.Reason = "config directory exists"
	}

	return tool
}

func (h *CodexHandler) ResolvePath(configPath, scope, cwd string) (string, error) {
	return resolveCodexPath(configPath, scope, cwd)
}

func (h *CodexHandler) Install(rc ResolvedConfig, contentPAT, promptPAT string, tool DetectedTool) ([]string, error) {
	if err := installCodex(rc, contentPAT, promptPAT); err != nil {
		return nil, err
	}
	warnings := []string{
		fmt.Sprintf("Tokens are stored in plaintext in %s. Manage tokens at https://tiddly.me/settings.", rc.Path),
	}
	return warnings, nil
}

func (h *CodexHandler) Uninstall(rc ResolvedConfig) error {
	return uninstallCodex(rc)
}

func (h *CodexHandler) Status(rc ResolvedConfig) (StatusResult, error) {
	return statusCodex(rc)
}

func (h *CodexHandler) DryRun(rc ResolvedConfig, contentPAT, promptPAT string) (string, string, error) {
	return dryRunCodex(rc, contentPAT, promptPAT)
}

func (h *CodexHandler) ExtractPATs(rc ResolvedConfig) (string, string) {
	return extractCodexPATs(rc)
}

