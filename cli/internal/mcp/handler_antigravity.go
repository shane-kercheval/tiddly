package mcp

import (
	"fmt"
	"os"
)

// AntigravityHandler implements ToolHandler for Google Antigravity (the `agy`
// CLI and the Antigravity IDE, which share one MCP config file).
type AntigravityHandler struct {
	ConfigPathOverride string // set by tests; empty in production
}

func (h *AntigravityHandler) Name() string { return "antigravity" }

// SupportedScopes is user-only. agy 1.0.0 reads MCP config solely from the
// user-level ~/.gemini/config/mcp_config.json; M1 verification found no
// directory/project-scoped config path. Re-evaluate if a future agy release
// adds one.
func (h *AntigravityHandler) SupportedScopes() []string { return []string{"user"} }

func (h *AntigravityHandler) Detect(looker ExecLooker) DetectedTool {
	tool := DetectedTool{Name: h.Name()}

	configPath := h.ConfigPathOverride
	if configPath == "" {
		var err error
		configPath, err = AntigravityConfigPath()
		if err != nil {
			return tool
		}
	}

	if _, err := looker.LookPath("agy"); err == nil {
		tool.Detected = true
		tool.ConfigPath = configPath
		tool.Reason = "binary in PATH"
		return tool
	}

	dirs, err := antigravityInstallDirs()
	if err != nil {
		return tool
	}
	for _, dir := range dirs {
		if info, statErr := os.Stat(dir); statErr == nil && info.IsDir() {
			tool.Detected = true
			tool.ConfigPath = configPath
			tool.Reason = "config directory exists"
			return tool
		}
	}

	return tool
}

func (h *AntigravityHandler) ResolvePath(configPath, _, _ string) (string, error) {
	if configPath != "" {
		return configPath, nil
	}
	return AntigravityConfigPath()
}

func (h *AntigravityHandler) Configure(rc ResolvedConfig, contentPAT, promptPAT string, _ DetectedTool) ([]string, string, error) {
	backupPath, err := configureAntigravity(rc.Path, contentPAT, promptPAT)
	if err != nil {
		// Forward backup path on error; see ClaudeDesktopHandler.Configure.
		return nil, backupPath, err
	}
	warnings := []string{
		fmt.Sprintf("Tokens are stored in plaintext in %s. Manage tokens at https://tiddly.me/settings.", rc.Path),
	}
	return warnings, backupPath, nil
}

func (h *AntigravityHandler) Remove(rc ResolvedConfig, servers []string) (*RemoveResult, error) {
	return removeAntigravity(rc.Path, servers)
}

func (h *AntigravityHandler) Status(rc ResolvedConfig) (StatusResult, error) {
	return statusAntigravity(rc.Path)
}

func (h *AntigravityHandler) DryRun(rc ResolvedConfig, contentPAT, promptPAT string) (string, string, error) {
	return dryRunAntigravity(rc.Path, contentPAT, promptPAT)
}

func (h *AntigravityHandler) ExtractPATs(rc ResolvedConfig) PATExtraction {
	return extractAntigravityPATs(rc.Path)
}

func (h *AntigravityHandler) AllTiddlyPATs(rc ResolvedConfig) []TiddlyPAT {
	return extractAllAntigravityTiddlyPATs(rc.Path)
}
