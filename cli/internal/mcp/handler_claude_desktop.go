package mcp

import (
	"fmt"
	"os"
	"path/filepath"
)

// ClaudeDesktopHandler implements ToolHandler for Claude Desktop.
type ClaudeDesktopHandler struct {
	ConfigPathOverride string // set by tests; empty in production
}

func (h *ClaudeDesktopHandler) Name() string { return "claude-desktop" }

func (h *ClaudeDesktopHandler) SupportedScopes() []string { return []string{"user"} }

func (h *ClaudeDesktopHandler) Detect(looker ExecLooker) DetectedTool {
	tool := DetectedTool{Name: h.Name()}

	configPath := h.ConfigPathOverride
	if configPath == "" {
		var err error
		configPath, err = ClaudeDesktopConfigPath()
		if err != nil {
			return tool
		}
	}
	configDir := filepath.Dir(configPath)

	if info, err := os.Stat(configDir); err == nil && info.IsDir() {
		tool.Detected = true
		tool.ConfigPath = configPath
		tool.Reason = "config directory exists"
	}

	_, lookErr := looker.LookPath("npx")
	tool.HasNpx = lookErr == nil

	return tool
}

func (h *ClaudeDesktopHandler) ResolvePath(configPath, _, _ string) (string, error) {
	if configPath != "" {
		return configPath, nil
	}
	return ClaudeDesktopConfigPath()
}

func (h *ClaudeDesktopHandler) Configure(rc ResolvedConfig, contentPAT, promptPAT string, tool DetectedTool) ([]string, error) {
	if err := configureClaudeDesktop(rc.Path, contentPAT, promptPAT); err != nil {
		return nil, err
	}
	var warnings []string
	if !tool.HasNpx {
		warnings = append(warnings,
			"Claude Desktop requires Node.js for mcp-remote. Install from https://nodejs.org")
	}
	warnings = append(warnings,
		fmt.Sprintf("Tokens are stored in plaintext in %s. Manage tokens at https://tiddly.me/settings.", rc.Path))
	warnings = append(warnings, "Restart Claude Desktop to apply changes.")
	return warnings, nil
}

func (h *ClaudeDesktopHandler) Remove(rc ResolvedConfig, servers []string) error {
	return removeClaudeDesktop(rc.Path, servers)
}

func (h *ClaudeDesktopHandler) Status(rc ResolvedConfig) (StatusResult, error) {
	return statusClaudeDesktop(rc.Path)
}

func (h *ClaudeDesktopHandler) DryRun(rc ResolvedConfig, contentPAT, promptPAT string) (string, string, error) {
	return dryRunClaudeDesktop(rc.Path, contentPAT, promptPAT)
}

func (h *ClaudeDesktopHandler) ExtractPATs(rc ResolvedConfig) (string, string) {
	return extractClaudeDesktopPATs(rc.Path)
}
